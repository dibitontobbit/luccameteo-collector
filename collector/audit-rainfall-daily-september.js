import { createClient } from "@base44/sdk";

const APP = process.env.BASE44_APP_ID;
const EMAIL = process.env.COLLECTOR_EMAIL;
const PASS = process.env.COLLECTOR_PASSWORD;

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

async function main() {
  const b = createClient({ appId: APP });
  await b.auth.loginViaEmailPassword(EMAIL, PASS);
  const e = b.entities.WeatherReading;

  const start = new Date("2026-08-31T22:00:00.000Z").getTime();
  const end = new Date("2026-09-30T21:59:59.999Z").getTime();
  const rows = [];
  let skip = 0;
  const limit = 500;

  while (true) {
    const page = await e.list("-timestamp", limit, skip);
    if (!page?.length) break;
    for (const r of page) {
      const t = r.timestamp ? new Date(r.timestamp).getTime() : NaN;
      if (Number.isFinite(t) && t >= start && t <= end) rows.push(r);
    }
    const oldest = page[page.length - 1]?.timestamp;
    if (oldest && new Date(oldest).getTime() < start) break;
    if (page.length < limit) break;
    skip += page.length;
  }

  const by = new Map();
  for (const r of rows) {
    const d = localDate(r.timestamp);
    if (!d.startsWith("2026-09-")) continue;
    if (!by.has(d)) by.set(d, {rows:0, numeric:0, positive:0, sum:0, max:-Infinity, samples:[]});
    const a = by.get(d);
    a.rows++;
    const rain = num(r.rainfall);
    if (rain == null) continue;
    a.numeric++;
    a.sum += rain;
    a.max = Math.max(a.max, rain);
    if (rain > 0) {
      a.positive++;
      if (a.samples.length < 12) a.samples.push({ts:r.timestamp, rain});
    }
  }

  console.log("RAIN_DAILY_AUDIT_START");
  for (const d of [...by.keys()].sort()) {
    const a = by.get(d);
    console.log(`${d} rows=${a.rows} numeric=${a.numeric} positive=${a.positive} sum=${a.sum.toFixed(2)} max=${Number.isFinite(a.max)?a.max.toFixed(2):"—"}`);
    if (a.positive) console.log(`  samples=${JSON.stringify(a.samples)}`);
  }
  console.log("RAIN_DAILY_AUDIT_END");
}
main().catch(e => { console.error("AUDIT_ERROR", e.message); process.exit(1); });
