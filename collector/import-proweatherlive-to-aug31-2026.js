import { createClient } from "@base44/sdk";
import fs from "node:fs";

const APP = process.env.BASE44_APP_ID;
const EMAIL = process.env.COLLECTOR_EMAIL;
const PASS = process.env.COLLECTOR_PASSWORD;

const FILES = [
  "../imports/proweatherlive/PWLVRLS8D_2026-02-05_2026-04-13.csv",
  "../imports/proweatherlive/PWLO5021T_2026-04-15_2026-09-25.csv",
];

const END_LOCAL_DATE = "2026-08-31";
const BATCH_SIZE = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function num(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "---" || s === "**") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readCsv(path) {
  const text = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const o = {};
    header.forEach((h, j) => (o[h] = vals[j] ?? ""));
    if (o.Time) rows.push(o);
  }
  return rows;
}

function utcOffsetHours(date) {
  // 2026 in Italy: CET until 29 March, CEST from 29 March onward in this import window.
  if (date < "2026-03-29") return 1;
  return 2;
}

function localToUtcIso(local) {
  const [date, time] = local.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh - utcOffsetHours(date), mm, ss || 0);
  return new Date(utcMs).toISOString();
}

function windDir(deg) {
  const d = num(deg);
  if (d == null) return null;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(d / 45) % 8];
}

function statusOf(e) {
  return (
    e?.status ??
    e?.response?.status ??
    Number(String(e?.message ?? "").match(/\b(403|429|5\d\d)\b/)?.[1]) ??
    null
  );
}

async function retry(fn, label, attempts = 6) {
  let last;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const s = statusOf(e);
      if (a === attempts || !(s === 403 || s === 429 || (s >= 500 && s <= 599))) {
        throw e;
      }
      const wait = Math.min(30000, a * 5000);
      console.warn(`⚠ ${label}: ${e.message}; retry tra ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw last;
}

function loadAndMap() {
  const source = FILES.flatMap(readCsv)
    .filter((r) => r.Time.slice(0, 10) <= END_LOCAL_DATE)
    .sort((a, b) => a.Time.localeCompare(b.Time));

  const mapped = [];
  const rainyByMonth = new Map();
  const rainByDay = new Map();

  let previousDate = null;
  let previousDailyRain = null;

  for (const r of source) {
    const date = r.Time.slice(0, 10);
    const dailyRain = num(r["Daily rainfall"]);

    let rainfall = null;
    if (dailyRain != null) {
      if (date !== previousDate || previousDailyRain == null) {
        rainfall = dailyRain;
      } else {
        rainfall = Math.max(0, dailyRain - previousDailyRain);
      }
      previousDailyRain = dailyRain;
    }
    if (date !== previousDate) {
      previousDate = date;
      if (dailyRain == null) previousDailyRain = null;
    }

    if (dailyRain != null) {
      const old = rainByDay.get(date);
      rainByDay.set(date, old == null ? dailyRain : Math.max(old, dailyRain));
    }

    const t = num(r["Outdoor temperature"]);
    const payload = {
      timestamp: localToUtcIso(r.Time),
      temperature: t,
      temperature_high: t,
      temperature_low: t,
      humidity: num(r["Outdoor humidity"]),
      pressure: num(r["Barometric Pressure (Relative)"]),
      wind_speed: num(r["Wind speed"]),
      wind_direction: windDir(r["Wind Direction"]),
      rainfall,
      rain_rate: num(r["Rain rate"]),
      wind_gust: num(r["Wind gust"]),
      uv_index: num(r["UV index"]),
      // Il CSV contiene luce in lux, non radiazione in W/m².
      // Non falsifichiamo solar_radiation.
      solar_radiation: null,
    };

    mapped.push({ date, payload });
  }

  for (const [date, rain] of rainByDay) {
    if (rain >= 1.0) {
      const month = date.slice(0, 7);
      rainyByMonth.set(month, (rainyByMonth.get(month) ?? 0) + 1);
    }
  }

  return { source, mapped, rainByDay, rainyByMonth };
}

async function existingTimestamps(entity) {
  const start = "2026-02-05T00:00:00.000Z";
  const end = "2026-08-31T23:59:59.999Z";
  const set = new Set();
  let skip = 0;
  const limit = 5000;

  while (true) {
    const page = await retry(
      () => entity.filter({ timestamp: { $gte: start, $lte: end } }, "timestamp", limit, skip),
      `lettura Base44 skip=${skip}`
    );
    const arr = page ?? [];
    for (const r of arr) if (r.timestamp) set.add(r.timestamp);
    if (arr.length < limit) break;
    skip += arr.length;
  }
  return set;
}

async function main() {
  if (!APP || !EMAIL || !PASS) throw new Error("Credenziali Base44 mancanti");

  const { source, mapped, rainByDay, rainyByMonth } = loadAndMap();

  console.log(`• Righe PWL lette fino al 31/08: ${source.length}`);
  console.log("• Giorni piovosi PWL (>=1.0 mm):");
  for (const month of [...rainyByMonth.keys()].sort()) {
    console.log(`  ${month}: ${rainyByMonth.get(month)}`);
  }

  const expected = {
    "2026-02": 11, // solo 5-28 febbraio; con 1-4 febbraio già importati il totale mese è 14
    "2026-03": 7,
    "2026-04": 2,
    "2026-05": 8,
    "2026-06": 4,
    "2026-07": 2,
    "2026-08": 2,
  };
  for (const [m, n] of Object.entries(expected)) {
    const got = rainyByMonth.get(m) ?? 0;
    if (got !== n) throw new Error(`Controllo giorni pioggia fallito per ${m}: attesi ${n}, trovati ${got}`);
  }

  const dates = new Set(mapped.map((x) => x.date));
  for (const missing of ["2026-04-14", "2026-08-20"]) {
    if (!dates.has(missing)) console.warn(`⚠ Nessun run PWL disponibile per ${missing}`);
  }

  const usable = mapped.filter((x) => x.payload.temperature != null);
  const partial = mapped.length - usable.length;
  console.log(`• Righe importabili in WeatherReading: ${usable.length}`);
  console.log(`• Letture parziali senza temperatura non inseribili nello schema attuale: ${partial}`);
  console.log("  Restano comunque conservate integralmente nei CSV GitHub.");

  const base44 = createClient({ appId: APP });
  await retry(() => base44.auth.loginViaEmailPassword(EMAIL, PASS), "login Base44");
  const entity = base44.entities.WeatherReading;

  const existing = await existingTimestamps(entity);
  console.log(`• Timestamp già presenti nel periodo: ${existing.size}`);

  const pending = usable
    .map((x) => x.payload)
    .filter((p) => !existing.has(p.timestamp));

  console.log(`• Nuove letture da creare: ${pending.length}`);

  let created = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    await retry(() => entity.bulkCreate(batch), `bulkCreate ${i + 1}-${i + batch.length}`);
    created += batch.length;
    console.log(`✓ ${created}/${pending.length} create`);
    await sleep(1200);
  }

  console.log(`✓ Import PWL 05/02-31/08/2026 completato: ${created} nuove letture`);
  console.log("✓ Vento/raffica mantenuti numericamente in m/s, senza conversione da 'knots'");
  console.log("✓ Pioggia salvata come incremento tra cumulati giornalieri PWL, non come cumulato ripetuto");
  console.log("✓ Pressione relativa PWL conservata senza applicare automaticamente +12 hPa");
  console.log("✓ Lux non scritto in solar_radiation");
}

main().catch((e) => {
  console.error("✗ Import PWL fallito:", e.message);
  process.exit(1);
});
