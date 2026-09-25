import { createClient } from "@base44/sdk";

const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

// Fonte autorevole: foglio "Settembre" del file Excel storico dell'utente.
// Struttura: [data, Tmax, Tmin, pioggia, rainRate, URmax, URmin,
//             ventoMax, rafficaMax, UVmax, pressioneAlta, pressioneBassa]
const rows = [
  ["2024-09-01",34.9,17.9,0,0,94,26,3.7,3.8,9.8,1013,1008.8],
  ["2024-09-02",30.5,17.0,0.2,1.5,96,45,1.4,1.4,7.3,1011.9,1009.4],
  ["2024-09-03",32.7,18.1,0,0,93,33,3.4,3.5,8.2,1013.8,1010.8],
  ["2024-09-04",31.3,16.8,0.2,1.5,95,40,3.8,4.0,7.9,1012.8,1007.8],
  ["2024-09-05",27.4,17.9,4.0,10.6,95,66,1.8,2.0,8.7,1008.6,1005.0],
  ["2024-09-06",29.1,17.7,0,0,96,43,2.5,2.7,8.8,1011.8,1008.1],
  ["2024-09-07",32.0,15.1,0,0,96,43,2.0,2.1,8.0,1014.0,1011.4],
  ["2024-09-08",23.7,20.5,76.7,64.0,97,79,1.8,2.0,0.6,1012.7,1003.1],
  ["2024-09-09",26.3,18.6,2.0,7.6,98,61,3.4,3.6,9.7,1003.8,1000.6],
  ["2024-09-10",28.1,15.6,0,0,97,59,3.1,3.1,8.5,1007.0,1003.5],
  ["2024-09-11",27.5,15.6,0,0,97,60,3.4,3.5,8.5,1007.3,1004.7],
  ["2024-09-12",22.6,15.9,0.5,3.0,89,52,6.0,6.5,5.8,null,null],
  ["2024-09-13",21.4,9.5,3.0,4.5,94,33,2.1,2.3,8.9,1021.2,1011.9],
  ["2024-09-14",23.6,6.0,0,0,94,33,3.5,3.6,7.9,1023.2,1020.9],
  ["2024-09-15",24.2,8.6,0,0,94,47,3.4,3.5,8.8,1023.5,1020.3],
  ["2024-09-16",26.0,11.8,0,0,97,31,2.3,2.5,8.7,1022.1,1017.2],
  ["2024-09-17",24.0,14.0,8.8,3.3,96,38,3.1,3.6,9.8,1024.5,1019.0],
  ["2024-09-18",22.3,14.0,10.4,22.8,97,62,1.3,1.3,7.4,null,null],
  ["2024-09-19",25.4,13.2,0.2,1.5,97,49,1.5,1.8,6.2,1012.4,1009.2],
  ["2024-09-20",26.4,12.4,0,0,96,43,2.0,2.4,7.4,1016.0,1011.7],
  ["2024-09-21",28.2,10.7,0,0,97,41,2.0,2.1,7.9,1016.8,1013.7],
  ["2024-09-22",28.4,13.8,0,0,96,43,1.6,1.8,7.8,1015.9,1011.1],
  ["2024-09-23",23.8,16.8,2.2,3.0,96,72,2.5,2.9,8.0,1011.6,1004.7],
  ["2024-09-24",22.7,15.7,11.1,64.0,97,65,6.0,6.8,6.5,1010.0,1005.7],
  ["2024-09-25",23.9,13.6,2.5,4.5,98,63,2.4,2.9,7.5,1011.9,1009.3],
  ["2024-09-26",23.9,15.8,0,0,96,69,2.7,3.1,2.8,1011.0,1005.0],
  ["2024-09-27",24.9,16.7,0.2,1.5,91,65,5.0,6.7,6.0,1006.3,1003.4],
  ["2024-09-28",21.3,12.1,0,0,96,59,3.4,3.5,8.3,1014.3,1005.4],
  ["2024-09-29",26.4,10.8,0,0,97,32,2.1,2.3,7.7,1019.0,1014.2],
  ["2024-09-30",23.0,10.3,0,0,97,52,2.0,2.1,8.1,1018.8,1015.0]
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localSyntheticTimestamp(date, hourLocal) {
  // Settembre 2024 a Lucca era CEST (UTC+2).
  const utcHour = String(hourLocal - 2).padStart(2, "0");
  return `${date}T${utcHour}:00:00.000Z`;
}

function reading(date, phase, tMax, tMin, rain, rainRate, humMax, humMin, windMax, gustMax, uvMax, pHigh, pLow) {
  const morning = phase === "min";

  return {
    timestamp: localSyntheticTimestamp(date, morning ? 6 : 15),
    temperature: morning ? tMin : tMax,
    temperature_high: morning ? tMin : tMax,
    temperature_low: morning ? tMin : tMax,
    humidity: morning ? humMax : humMin,
    pressure: morning ? pHigh : pLow,
    wind_speed: morning ? 0 : windMax,
    wind_direction: null,
    rainfall: morning ? 0 : rain,
    rain_rate: morning ? 0 : rainRate,
    wind_gust: morning ? 0 : gustMax,
    uv_index: morning ? 0 : uvMax,
    solar_radiation: null
  };
}

async function updateWithRetry(entity, old, payload) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      if (old) return await entity.update(old.id, payload);
      return await entity.create(payload);
    } catch (error) {
      const status = error?.status ?? error?.response?.status ??
        Number(String(error?.message ?? "").match(/\b(429|5\d\d)\b/)?.[1]);

      if (attempt === 4 || !(status === 429 || (status >= 500 && status <= 599))) {
        throw error;
      }

      await sleep(attempt * 3000);
    }
  }
}

async function main() {
  if (!BASE44_APP_ID || !COLLECTOR_EMAIL || !COLLECTOR_PASSWORD) {
    throw new Error("Missing Base44 credentials");
  }

  const base44 = createClient({ appId: BASE44_APP_ID });
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL, COLLECTOR_PASSWORD);
  const entity = base44.entities.WeatherReading;

  const existing = await entity.list("-timestamp", 10000);
  const byTimestamp = new Map(
    (existing ?? []).filter(r => r.timestamp).map(r => [r.timestamp, r])
  );

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const [date, tMax, tMin, rain, rainRate, humMax, humMin, windMax, gustMax, uvMax, pHigh, pLow] = row;

    for (const phase of ["min", "max"]) {
      const payload = reading(
        date, phase, tMax, tMin, rain, rainRate,
        humMax, humMin, windMax, gustMax, uvMax, pHigh, pLow
      );

      const old = byTimestamp.get(payload.timestamp);
      await updateWithRetry(entity, old, payload);

      if (old) updated++;
      else created++;

      await sleep(500);
    }
  }

  const rainyDays = rows.filter(r => r[3] >= 1).length;
  const totalRain = rows.reduce((sum, r) => sum + r[3], 0);

  console.log(`✓ Settembre 2024 completato: ${created} create, ${updated} aggiornate`);
  console.log(`✓ Pioggia totale Excel: ${totalRain.toFixed(1)} mm`);
  console.log(`✓ Giorni di pioggia (>=1 mm): ${rainyDays}`);
  console.log("• Pressione 12 e 18 settembre lasciata NULL: nel foglio Excel il valore 0 indica dato assente, non 0 hPa.");
}

main().catch((e) => {
  console.error("✗ Import settembre 2024 fallito:", e.message);
  process.exit(1);
});
