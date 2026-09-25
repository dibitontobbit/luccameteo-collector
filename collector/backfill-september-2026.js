import { createClient } from "@base44/sdk";
import fs from "node:fs";

const APP = process.env.BASE44_APP_ID;
const EMAIL = process.env.COLLECTOR_EMAIL;
const PASS = process.env.COLLECTOR_PASSWORD;

const CSV = "../imports/proweatherlive/PWLO5021T_2026-04-15_2026-09-25.csv";
const START_LOCAL = "2026-09-01 00:00:00";
const END_LOCAL = "2026-09-25 23:59:59";
const PRESSURE_CORRECTION = 12;
const SLOT_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function readCsv() {
  const text = fs.readFileSync(CSV, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const o = {};
    header.forEach((h, j) => o[h] = vals[j] ?? "");
    if (o.Time && o.Time >= START_LOCAL && o.Time <= END_LOCAL) rows.push(o);
  }
  return rows;
}

function num(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "---" || s === "**") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function localToUtc(local) {
  const [d,t] = local.split(" ");
  const [y,m,day] = d.split("-").map(Number);
  const [hh,mm,ss] = t.split(":").map(Number);
  return new Date(Date.UTC(y,m-1,day,hh-2,mm,ss||0)).toISOString();
}

function slotKey(iso) {
  return Math.round(new Date(iso).getTime() / SLOT_MS);
}

function windDir(deg) {
  const d = num(deg);
  if (d == null) return null;
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(d / 45) % 8];
}

function statusOf(e) {
  return e?.status ?? e?.response?.status ??
    Number(String(e?.message ?? "").match(/\b(403|429|5\d\d)\b/)?.[1]) ?? null;
}

async function retry(fn,label,attempts=6) {
  let last;
  for (let a=1;a<=attempts;a++) {
    try { return await fn(); }
    catch(e) {
      last=e;
      const s=statusOf(e);
      if (a===attempts || !(s===403 || s===429 || (s>=500 && s<=599))) throw e;
      const wait=Math.min(30000,a*5000);
      console.warn(`⚠ ${label}: ${e.message}; retry tra ${wait/1000}s`);
      await sleep(wait);
    }
  }
  throw last;
}

async function getSeptemberExisting(entity) {
  const out = [];
  let skip = 0;
  const limit = 500;
  const start = new Date("2026-08-31T22:00:00.000Z").getTime();
  const end = new Date("2026-09-25T21:59:59.999Z").getTime();

  while (true) {
    const rows = await retry(() => entity.list("-timestamp",limit,skip), `list skip=${skip}`);
    if (!rows?.length) break;

    for (const r of rows) {
      const t = r.timestamp ? new Date(r.timestamp).getTime() : NaN;
      if (Number.isFinite(t) && t >= start && t <= end) out.push(r);
    }

    const oldest = rows[rows.length-1]?.timestamp;
    if (oldest && new Date(oldest).getTime() < start) break;
    if (rows.length < limit) break;
    skip += rows.length;
  }
  return out;
}

function buildPwl(rows) {
  const out = [];
  let prevDate = null;
  let prevDaily = null;

  for (const r of rows) {
    const localDate = r.Time.slice(0,10);
    const daily = num(r["Daily rainfall"]);
    let rain = null;

    if (daily != null) {
      if (localDate !== prevDate || prevDaily == null) rain = daily;
      else rain = Math.max(0, daily - prevDaily);
      prevDaily = daily;
    }
    if (localDate !== prevDate) {
      prevDate = localDate;
      if (daily == null) prevDaily = null;
    }

    const temp = num(r["Outdoor temperature"]);
    const iso = localToUtc(r.Time);

    out.push({
      localDate,
      slot: slotKey(iso),
      payload: {
        timestamp: iso,
        temperature: temp,
        temperature_high: temp,
        temperature_low: temp,
        humidity: num(r["Outdoor humidity"]),
        pressure: (() => {
          const p = num(r["Barometric Pressure (Relative)"]);
          return p == null ? null : p + PRESSURE_CORRECTION;
        })(),
        wind_speed: num(r["Wind speed"]),
        wind_direction: windDir(r["Wind Direction"]),
        rainfall: rain,
        rain_rate: num(r["Rain rate"]),
        wind_gust: num(r["Wind gust"]),
        uv_index: num(r["UV index"]),
        solar_radiation: null
      }
    });
  }
  return out;
}

async function main() {
  if (!APP || !EMAIL || !PASS) throw new Error("Credenziali Base44 mancanti");

  const raw = readCsv();
  const pwl = buildPwl(raw);

  const b = createClient({appId:APP});
  await retry(() => b.auth.loginViaEmailPassword(EMAIL,PASS),"login Base44");
  const e = b.entities.WeatherReading;

  const existing = await getSeptemberExisting(e);
  const occupiedSlots = new Set(existing.filter(r => r.timestamp).map(r => slotKey(r.timestamp)));

  const byDay = new Map();
  for (const x of pwl) {
    if (!byDay.has(x.localDate)) byDay.set(x.localDate,{source:0,existingSlots:0,created:0,partialSkipped:0});
    byDay.get(x.localDate).source++;
  }
  for (const r of existing) {
    const t = new Date(r.timestamp);
    const local = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"}).format(t);
    if (byDay.has(local)) byDay.get(local).existingSlots++;
  }

  const pending = [];
  for (const x of pwl) {
    const a = byDay.get(x.localDate);
    if (occupiedSlots.has(x.slot)) continue;

    if (x.payload.temperature == null) {
      a.partialSkipped++;
      continue;
    }

    pending.push(x);
    occupiedSlots.add(x.slot);
  }

  console.log(`• Run PWL settembre disponibili: ${pwl.length}`);
  console.log(`• Letture Base44 settembre già presenti: ${existing.length}`);
  console.log(`• Slot da integrare senza sovrascrittura: ${pending.length}`);

  let created = 0;
  for (const x of pending) {
    await retry(() => e.create(x.payload), `create ${x.payload.timestamp}`);
    created++;
    byDay.get(x.localDate).created++;
    if (created % 250 === 0) console.log(`✓ ${created}/${pending.length} integrate`);
    await sleep(25);
  }

  console.log("DAY_AUDIT_START");
  for (const d of [...byDay.keys()].sort()) {
    const a = byDay.get(d);
    console.log(`${d} source=${a.source} existing=${a.existingSlots} created=${a.created} partial_skipped=${a.partialSkipped}`);
  }
  console.log("DAY_AUDIT_END");
  console.log(`✓ Backfill settembre completato: ${created} nuovi run aggiunti, 0 run esistenti modificati`);
  console.log("✓ Pressione PWL importata con +12 hPa");
  console.log("✓ Vento PWL mantenuto numericamente in m/s");
  console.log("✓ Lux non scritto in solar_radiation");
}

main().catch(e => { console.error("✗ Backfill settembre fallito:",e.message); process.exit(1); });
