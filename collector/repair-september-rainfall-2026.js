import { createClient } from "@base44/sdk";

const APP = process.env.BASE44_APP_ID;
const EMAIL = process.env.COLLECTOR_EMAIL;
const PASS = process.env.COLLECTOR_PASSWORD;

const EXPECTED = new Map([
  ["2026-09-01",0],["2026-09-02",0],["2026-09-03",0],["2026-09-04",0],
  ["2026-09-05",0],["2026-09-06",0],["2026-09-07",0],["2026-09-08",0],
  ["2026-09-09",28.96],["2026-09-10",15.49],["2026-09-11",0.76],
  ["2026-09-12",0],["2026-09-13",0],["2026-09-14",0],["2026-09-15",0],
  ["2026-09-16",0],["2026-09-17",0],["2026-09-18",0],["2026-09-19",0],
  ["2026-09-20",0],["2026-09-21",0],["2026-09-22",0],["2026-09-23",0],
  ["2026-09-24",0],["2026-09-25",0]
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function localDate(ts) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ts));
}

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function statusOf(e) {
  const direct = e?.status ?? e?.response?.status ?? e?.cause?.status;
  if (direct != null) return Number(direct);
  const m = String(e?.message ?? "").match(/\b(403|429|5\d\d)\b/);
  return m ? Number(m[1]) : null;
}

async function retry(fn, label, attempts=6) {
  let last;
  for (let i=1; i<=attempts; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const s = statusOf(e);
      const transient = s === 403 || s === 429 || (s >= 500 && s <= 599);
      if (!transient || i === attempts) throw e;
      const wait = Math.min(30000, i * 5000);
      console.warn(`⚠ ${label}: ${e.message}; retry tra ${wait/1000}s`);
      await sleep(wait);
    }
  }
  throw last;
}

async function loadSeptember(entity) {
  const out = [];
  const start = new Date("2026-08-31T22:00:00.000Z").getTime();
  const end = new Date("2026-09-25T21:59:59.999Z").getTime();
  let skip = 0;
  const limit = 500;

  while (true) {
    const page = await retry(() => entity.list("-timestamp", limit, skip), `list skip=${skip}`);
    if (!page?.length) break;

    for (const r of page) {
      const t = r.timestamp ? new Date(r.timestamp).getTime() : NaN;
      if (Number.isFinite(t) && t >= start && t <= end) out.push(r);
    }

    const oldest = page[page.length - 1]?.timestamp;
    if (oldest && new Date(oldest).getTime() < start) break;
    if (page.length < limit) break;
    skip += page.length;
  }
  return out;
}

function summarize(rows) {
  const by = new Map();
  for (const r of rows) {
    const d = localDate(r.timestamp);
    if (!EXPECTED.has(d)) continue;
    if (!by.has(d)) by.set(d, []);
    by.get(d).push(r);
  }
  return by;
}

function daySum(rows) {
  return Number(rows.reduce((s,r) => s + (num(r.rainfall) ?? 0), 0).toFixed(2));
}

async function main() {
  if (!APP || !EMAIL || !PASS) throw new Error("Credenziali Base44 mancanti");

  const b = createClient({ appId: APP });
  await retry(() => b.auth.loginViaEmailPassword(EMAIL, PASS), "login");
  const e = b.entities.WeatherReading;

  const rows = await loadSeptember(e);
  const by = summarize(rows);

  const updates = [];

  for (const [day, expected] of EXPECTED) {
    const dayRows = by.get(day) ?? [];
    const current = daySum(dayRows);

    console.log(`• ${day}: attuale ${current.toFixed(2)} mm, atteso ${expected.toFixed(2)} mm, righe ${dayRows.length}`);

    if (expected === 0) {
      for (const r of dayRows) {
        const rain = num(r.rainfall);
        if (rain != null && rain > 0) {
          updates.push({ id:r.id, day, ts:r.timestamp, from:rain, to:0 });
        }
      }
      continue;
    }

    const delta = Number((expected - current).toFixed(2));
    if (Math.abs(delta) <= 0.001) continue;

    if (Math.abs(delta) > 0.25) {
      throw new Error(`${day}: differenza ${delta.toFixed(2)} mm troppo grande per una correzione fine automatica`);
    }

    const positive = dayRows
      .filter(r => (num(r.rainfall) ?? 0) > 0)
      .sort((a,b) => (num(b.rainfall) ?? 0) - (num(a.rainfall) ?? 0));

    if (!positive.length) throw new Error(`${day}: nessun run positivo da correggere`);

    const target = positive[0];
    const from = num(target.rainfall);
    const to = Number((from + delta).toFixed(2));
    if (to < 0) throw new Error(`${day}: correzione produrrebbe rainfall negativo`);

    updates.push({ id:target.id, day, ts:target.timestamp, from, to });
  }

  console.log(`• Correzioni da applicare: ${updates.length}`);

  let done = 0;
  for (const u of updates) {
    await retry(() => e.update(u.id, { rainfall:u.to }), `update ${u.ts}`);
    done++;
    if (done % 25 === 0 || done === updates.length) {
      console.log(`✓ ${done}/${updates.length} correzioni applicate`);
    }
    await sleep(500);
  }

  const verifyRows = await loadSeptember(e);
  const verifyBy = summarize(verifyRows);
  let month = 0;

  console.log("VERIFY_START");
  for (const [day, expected] of EXPECTED) {
    const actual = daySum(verifyBy.get(day) ?? []);
    month += actual;
    const ok = Math.abs(actual - expected) <= 0.01;
    console.log(`${ok ? "✓" : "✗"} ${day}: DB ${actual.toFixed(2)} mm / atteso ${expected.toFixed(2)} mm`);
    if (!ok) throw new Error(`Verifica fallita per ${day}`);
  }
  month = Number(month.toFixed(2));
  console.log(`✓ Settembre 1-25 verificato: ${month.toFixed(2)} mm`);
  if (Math.abs(month - 45.21) > 0.01) {
    throw new Error(`Totale settembre errato dopo repair: ${month.toFixed(2)} mm`);
  }
  console.log("✓ Repair pioggia settembre completato correttamente");
}

main().catch(e => {
  console.error("✗ Repair fallito:", e.message);
  process.exit(1);
});
