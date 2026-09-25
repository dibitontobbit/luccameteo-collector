import { createClient } from "@base44/sdk";
import fs from "node:fs";

const APP = process.env.BASE44_APP_ID;
const EMAIL = process.env.COLLECTOR_EMAIL;
const PASS = process.env.COLLECTOR_PASSWORD;

const EXPECTED_SEPTEMBER_MM = 45.21;
const EXPECTED_JAN_AUG_MM = 870.95;
const EXPECTED_YTD_MM = 916.16;
const TOLERANCE_MM = 0.20;

function localDate(ts) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ts));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  if (!APP || !EMAIL || !PASS) throw new Error("Credenziali Base44 mancanti");

  const base44 = createClient({ appId: APP });
  await base44.auth.loginViaEmailPassword(EMAIL, PASS);
  const entity = base44.entities.WeatherReading;

  const start = new Date("2026-08-31T22:00:00.000Z").getTime();
  const end = new Date("2026-09-26T21:59:59.999Z").getTime();

  let skip = 0;
  const limit = 500;
  const rows = [];

  while (true) {
    const page = await entity.list("-timestamp", limit, skip);
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

  const byDay = {};
  let septemberTotal = 0;
  let rainfallRows = 0;

  for (const r of rows) {
    const day = localDate(r.timestamp);
    if (!day.startsWith("2026-09-")) continue;

    const rain = num(r.rainfall);
    if (rain == null) continue;

    rainfallRows++;
    septemberTotal += rain;
    byDay[day] = (byDay[day] || 0) + rain;
  }

  const excel = JSON.parse(
    fs.readFileSync("../imports/history/september-2026-excel-overrides.json", "utf8")
  );

  const dailyChecks = [];
  for (const [day, values] of Object.entries(excel)) {
    if (typeof values.rain !== "number") continue;
    const actual = Number((byDay[day] || 0).toFixed(2));
    const expected = Number(values.rain.toFixed(2));
    const diff = Number((actual - expected).toFixed(2));
    dailyChecks.push({ day, expected, actual, diff });
  }

  const mismatches = dailyChecks.filter(x => Math.abs(x.diff) > TOLERANCE_MM);
  septemberTotal = Number(septemberTotal.toFixed(2));
  const ytd = Number((EXPECTED_JAN_AUG_MM + septemberTotal).toFixed(2));

  console.log("=== AUDIT PIOGGIA SETTEMBRE 2026 ===");
  console.log(`WeatherReading settembre: ${rows.length}`);
  console.log(`Record con rainfall numerico: ${rainfallRows}`);
  console.log(`Totale settembre nel DB: ${septemberTotal.toFixed(2)} mm`);
  console.log(`Totale settembre atteso: ${EXPECTED_SEPTEMBER_MM.toFixed(2)} mm`);
  console.log(`Totale annuo risultante: ${ytd.toFixed(2)} mm`);
  console.log(`Totale annuo atteso: ${EXPECTED_YTD_MM.toFixed(2)} mm`);

  for (const c of dailyChecks) {
    const mark = Math.abs(c.diff) <= TOLERANCE_MM ? "✓" : "✗";
    console.log(`${mark} ${c.day}: atteso ${c.expected.toFixed(2)} mm, DB ${c.actual.toFixed(2)} mm, diff ${c.diff.toFixed(2)}`);
  }

  if (mismatches.length) {
    throw new Error(
      `Audit fallito: ${mismatches.length} giorni Excel differiscono dal DB oltre ±${TOLERANCE_MM.toFixed(2)} mm`
    );
  }

  if (Math.abs(septemberTotal - EXPECTED_SEPTEMBER_MM) > TOLERANCE_MM) {
    throw new Error(
      `Audit fallito: settembre DB ${septemberTotal.toFixed(2)} mm vs atteso ${EXPECTED_SEPTEMBER_MM.toFixed(2)} mm`
    );
  }

  if (Math.abs(ytd - EXPECTED_YTD_MM) > TOLERANCE_MM) {
    throw new Error(
      `Audit fallito: YTD ${ytd.toFixed(2)} mm vs atteso ${EXPECTED_YTD_MM.toFixed(2)} mm`
    );
  }

  console.log("✓ Audit pioggia superato: mensile e annuale coerenti con i valori autorevoli.");
}

main().catch(e => {
  console.error("✗ " + e.message);
  process.exit(1);
});
