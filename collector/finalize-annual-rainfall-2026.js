import fs from "node:fs";

const path = "../imports/history/annual-rainfall-2026.json";
const data = JSON.parse(fs.readFileSync(path, "utf8"));

const SEPTEMBER_TO_DATE_MM = 45.21;
const JAN_AUG_MM = 870.95;
const YTD_MM = Number((JAN_AUG_MM + SEPTEMBER_TO_DATE_MM).toFixed(2));

data.status = "authoritative_through_2026-09-25";
data.monthly["2026-09"] = SEPTEMBER_TO_DATE_MM;
data.ytd_through_august_mm = JAN_AUG_MM;
data.ytd_through_2026_09_25_mm = YTD_MM;
data.note =
  "Authoritative rainfall through 2026-09-25. Jan-Aug total is 870.95 mm; September-to-date is 45.21 mm; YTD is 916.16 mm. This file is the reference total and must not be recreated by summing a limited recent WeatherReading window.";

fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

console.log(`✓ Pioggia 2026 aggiornata: gennaio-agosto ${JAN_AUG_MM.toFixed(2)} mm + settembre ${SEPTEMBER_TO_DATE_MM.toFixed(2)} mm = ${YTD_MM.toFixed(2)} mm`);
