import { createClient } from "@base44/sdk";

const APP = process.env.BASE44_APP_ID;
const EMAIL = process.env.COLLECTOR_EMAIL;
const PASS = process.env.COLLECTOR_PASSWORD;
const TARGET_TS = "2026-09-25T23:14:30Z";

async function main() {
  if (!APP || !EMAIL || !PASS) throw new Error("Credenziali Base44 mancanti");

  const b = createClient({ appId: APP });
  await b.auth.loginViaEmailPassword(EMAIL, PASS);
  const e = b.entities.WeatherReading;

  const rows = await e.list("-timestamp", 500);
  const target = rows.find(r => r.timestamp === TARGET_TS);
  if (!target) throw new Error("Lettura test non trovata");

  const before = Number(target.rainfall ?? 0);
  await e.update(target.id, { rainfall: 0 });

  console.log("TEMP_RAIN_TEST_REVERTED");
  console.log(`timestamp=${TARGET_TS}`);
  console.log(`before=${before.toFixed(2)}`);
  console.log("after=0.00");
}

main().catch(e => {
  console.error("TEMP_RAIN_TEST_REVERT_FAILED", e.message);
  process.exit(1);
});
