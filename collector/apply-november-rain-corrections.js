import { createClient } from "@base44/sdk";

const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

const corrections = [
  { date: "2026-11-02", rainfall_mm: 0.25, source: "Weather Company PWS storico giornaliero", notes: "LuccaMeteo/Base44 aveva 0,75 mm; totale ufficiale PWS 0,25 mm." },
  { date: "2026-11-03", rainfall_mm: 0.25, source: "Weather Company PWS storico giornaliero", notes: "LuccaMeteo/Base44 aveva 0,75 mm; totale ufficiale PWS 0,25 mm." },
  { date: "2026-11-06", rainfall_mm: 4.06, source: "Weather Company PWS storico giornaliero", notes: "LuccaMeteo/Base44 aveva 7,64 mm; totale ufficiale PWS 4,06 mm." },
  { date: "2026-11-07", rainfall_mm: 0.25, source: "Weather Company PWS storico giornaliero", notes: "LuccaMeteo/Base44 aveva 0,00 mm; totale ufficiale PWS 0,25 mm." },
  { date: "2026-11-09", rainfall_mm: 1.50, source: "console Bresser verificata", notes: "Alle 07:22 la console mostrava totale giornaliero 1,50 mm; LuccaMeteo/Base44 mostrava 2,29 mm." }
];

async function main() {
  const base44 = createClient({ appId: BASE44_APP_ID });
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL, COLLECTOR_PASSWORD);

  const existing = await base44.entities.RainfallCorrection.list("-date", 500);
  const byDate = new Map((existing ?? []).filter(x => x?.date).map(x => [x.date, x]));

  for (const item of corrections) {
    const payload = {
      date: item.date,
      rainfall_mm: item.rainfall_mm,
      reason: "Correzione cumulato pioggia duplicato/mancante nel collector",
      source: item.source,
      verified: true,
      notes: item.notes
    };

    const row = byDate.get(item.date);
    if (row?.id) {
      await base44.entities.RainfallCorrection.update(row.id, payload);
      console.log("UPDATED", item.date, item.rainfall_mm);
    } else {
      await base44.entities.RainfallCorrection.create(payload);
      console.log("CREATED", item.date, item.rainfall_mm);
    }
  }

  const verify = await base44.entities.RainfallCorrection.list("-date", 500);
  const result = (verify ?? [])
    .filter(x => corrections.some(c => c.date === x.date))
    .map(x => ({date:x.date, rainfall_mm:x.rainfall_mm, verified:x.verified, source:x.source}))
    .sort((a,b)=>a.date.localeCompare(b.date));

  console.log("VERIFY_CORRECTIONS=" + JSON.stringify(result));
}

main().catch(e => { console.error(e); process.exit(1); });
