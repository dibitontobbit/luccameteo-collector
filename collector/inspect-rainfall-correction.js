import { createClient } from "@base44/sdk";

const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

async function main() {
  const base44 = createClient({ appId: BASE44_APP_ID });
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL, COLLECTOR_PASSWORD);
  const rows = await base44.entities.RainfallCorrection.list("-created_date", 20);
  console.log("RAINFALL_CORRECTION_SAMPLE=" + JSON.stringify(rows ?? []));
}
main().catch(e => { console.error(e); process.exit(1); });
