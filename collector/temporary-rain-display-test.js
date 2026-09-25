import { createClient } from "@base44/sdk";

const APP = process.env.BASE44_APP_ID;
const EMAIL = process.env.COLLECTOR_EMAIL;
const PASS = process.env.COLLECTOR_PASSWORD;
const TEST_DELTA = 36.01;
const TARGET_DAY = "2026-09-26";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function localDate(ts) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ts));
}

async function main() {
  if (!APP || !EMAIL || !PASS) throw new Error("Credenziali Base44 mancanti");

  const b = createClient({ appId: APP });
  await b.auth.loginViaEmailPassword(EMAIL, PASS);
  const e = b.entities.WeatherReading;

  const rows = await e.list("-timestamp", 500);
  const today = rows.filter(r => r.timestamp && localDate(r.timestamp) === TARGET_DAY);

  if (!today.length) throw new Error(`Nessun WeatherReading trovato per ${TARGET_DAY}`);

  // Idempotenza: il test deve essere applicato una sola volta.
  const already = today.find(r => num(r.rainfall) >= 30);
  if (already) {
    console.log(`TEST_ALREADY_APPLIED timestamp=${already.timestamp} rainfall=${num(already.rainfall).toFixed(2)}`);
    return;
  }

  const target = today[0];
  const before = num(target.rainfall);
  const after = Number((before + TEST_DELTA).toFixed(2));

  await e.update(target.id, { rainfall: after });

  console.log("TEMP_RAIN_TEST_APPLIED");
  console.log(`timestamp=${target.timestamp}`);
  console.log(`before=${before.toFixed(2)}`);
  console.log(`delta=${TEST_DELTA.toFixed(2)}`);
  console.log(`after=${after.toFixed(2)}`);
  console.log("NOTE=Valore fittizio temporaneo per test visualizzazione; rimuovere appena possibile.");
}

main().catch(e => {
  console.error("TEMP_RAIN_TEST_FAILED", e.message);
  process.exit(1);
});
