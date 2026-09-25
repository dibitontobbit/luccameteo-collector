import { createClient } from "@base44/sdk";
import fs from "node:fs";

const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

let rows = [
  [
    "2024-08-14",
    33.4,
    19.5,
    0,
    0,
    91,
    33,
    3.7,
    3.8,
    9.8,
    1017.9,
    1014.6
  ],
  [
    "2024-08-15",
    30.1,
    19.1,
    0.7,
    3,
    92,
    47,
    4.9,
    5.5,
    5.9,
    1022,
    1017.6
  ],
  [
    "2024-08-16",
    32.6,
    19.2,
    0,
    0,
    95,
    41,
    2.5,
    2.9,
    9.6,
    1021.1,
    1018.2
  ],
  [
    "2024-08-17",
    30,
    21.7,
    2.2,
    10.6,
    90,
    52,
    3.7,
    3.8,
    10.2,
    1020,
    1014.9
  ],
  [
    "2024-08-18",
    26.2,
    19.7,
    13.9,
    16.7,
    96,
    73,
    2.3,
    2.5,
    9.8,
    1015.8,
    1011.1
  ],
  [
    "2024-08-19",
    26.4,
    18.1,
    2,
    3,
    97,
    61,
    0.5,
    0.5,
    5.4,
    1013.8,
    1010.3
  ],
  [
    "2024-08-20",
    30,
    17.5,
    0,
    0,
    97,
    54,
    2.2,
    2.4,
    11.2,
    1015.6,
    1013.4
  ],
  [
    "2024-08-21",
    29.6,
    18.3,
    0,
    0,
    97,
    61,
    4,
    4.9,
    9.5,
    1017.1,
    1014.8
  ],
  [
    "2024-08-22",
    31.1,
    19.1,
    0,
    0,
    95,
    51,
    3.1,
    3.1,
    8.8,
    1017.4,
    1015.3
  ],
  [
    "2024-08-23",
    30.1,
    18.5,
    0,
    0,
    97,
    53,
    3.3,
    3.3,
    8.9,
    1021,
    1017.6
  ],
  [
    "2024-08-24",
    30.2,
    17.2,
    0,
    0,
    97,
    40,
    3.5,
    3.6,
    8.9,
    1022.4,
    1019.5
  ],
  [
    "2024-08-25",
    29.5,
    15.5,
    0,
    0,
    97,
    50,
    4.1,
    4.7,
    9.8,
    1021.6,
    1017.9
  ],
  [
    "2024-08-26",
    30.8,
    18,
    0,
    0,
    97,
    50,
    3.5,
    3.6,
    8.8,
    1018.7,
    1015.6
  ],
  [
    "2024-08-27",
    35.4,
    17.6,
    18.4,
    108.45,
    96,
    33,
    16.67,
    30.56,
    8.7,
    1018.7,
    1011.2
  ],
  [
    "2024-08-28",
    32.5,
    18,
    1.2,
    4.5,
    96,
    40,
    2,
    2.1,
    8.9,
    1015,
    1012.3
  ],
  [
    "2024-08-29",
    32,
    18.1,
    0,
    0,
    96,
    44,
    3.3,
    3.6,
    8.8,
    1015.3,
    1012.4
  ],
  [
    "2024-08-30",
    33.4,
    18,
    0,
    0,
    96,
    31,
    2.2,
    2.4,
    8.8,
    1014.9,
    1011.5
  ],
  [
    "2024-08-31",
    34.3,
    18,
    0.7,
    4.5,
    95,
    32,
    3.3,
    3.3,
    7.9,
    1014.7,
    1011.5
  ]
];

if (process.env.HISTORY_FILE) {
  rows = JSON.parse(fs.readFileSync(process.env.HISTORY_FILE, "utf8"));
}

function localSyntheticTimestamp(date, hourLocal) {
  // Agosto 2024 a Lucca era CEST (UTC+2).
  const utcHour = String(hourLocal - 2).padStart(2, "0");
  return `${date}T${utcHour}:00:00.000Z`;
}

function stormReadingsAug27(tMax, tMin, rain, rainRate, humMax, humMin, windMax, gustMax, uvMax, pHigh, pLow) {
  // Evento documentato dall'utente: violenta tempesta nel pomeriggio del 27/08/2024.
  // Tmax mantenuta alle 15:00; alle 17:00 circa la temperatura era ~15°C sopra la minima,
  // poi in ~10 minuti raggiunge la Tmin.
  const preStormTemp = Math.round((tMin + 15) * 10) / 10;

  return [
    {
      timestamp: localSyntheticTimestamp("2024-08-27", 15),
      temperature: tMax,
      temperature_high: tMax,
      temperature_low: tMax,
      humidity: humMin,
      pressure: pLow,
      wind_speed: 0,
      wind_direction: null,
      rainfall: 0,
      rain_rate: 0,
      wind_gust: 0,
      uv_index: uvMax,
      solar_radiation: null
    },
    {
      timestamp: "2024-08-27T15:00:00.000Z", // 17:00 CEST
      temperature: preStormTemp,
      temperature_high: preStormTemp,
      temperature_low: preStormTemp,
      humidity: humMax,
      pressure: pLow,
      wind_speed: windMax,
      wind_direction: null,
      rainfall: 0,
      rain_rate: rainRate,
      wind_gust: gustMax,
      uv_index: 0,
      solar_radiation: null
    },
    {
      timestamp: "2024-08-27T15:10:00.000Z", // 17:10 CEST
      temperature: tMin,
      temperature_high: tMin,
      temperature_low: tMin,
      humidity: humMax,
      pressure: pLow,
      wind_speed: windMax,
      wind_direction: null,
      rainfall: rain,
      rain_rate: rainRate,
      wind_gust: gustMax,
      uv_index: 0,
      solar_radiation: null
    }
  ];
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

async function main() {
  if (!BASE44_APP_ID || !COLLECTOR_EMAIL || !COLLECTOR_PASSWORD) {
    throw new Error("Missing Base44 credentials");
  }

  const base44 = createClient({ appId: BASE44_APP_ID });
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL, COLLECTOR_PASSWORD);
  const entity = base44.entities.WeatherReading;

  const existing = await entity.list("-timestamp", 10000);
  const byTimestamp = new Map((existing ?? []).filter(r => r.timestamp).map(r => [r.timestamp, r]));

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const [date, tMax, tMin, rain, rainRate, humMax, humMin, windMax, gustMax, uvMax, pHigh, pLow] = row;

    if (date === "2024-08-27") {
      const oldMorningTs = localSyntheticTimestamp(date, 6);
      const oldMorning = byTimestamp.get(oldMorningTs);
      if (oldMorning) {
        await entity.delete(oldMorning.id);
        byTimestamp.delete(oldMorningTs);
        console.log(`✓ Rimossa vecchia sintetica mattutina ${oldMorningTs}`);
      }

      for (const payload of stormReadingsAug27(tMax, tMin, rain, rainRate, humMax, humMin, windMax, gustMax, uvMax, pHigh, pLow)) {
        const old = byTimestamp.get(payload.timestamp);
        if (old) {
          await entity.update(old.id, payload);
          updated++;
          console.log(`✓ Aggiornato evento tempesta ${payload.timestamp}`);
        } else {
          await entity.create(payload);
          created++;
          console.log(`✓ Creato evento tempesta ${payload.timestamp}`);
        }
      }
      continue;
    }

    for (const phase of ["min", "max"]) {
      const payload = reading(date, phase, tMax, tMin, rain, rainRate, humMax, humMin, windMax, gustMax, uvMax, pHigh, pLow);
      const old = byTimestamp.get(payload.timestamp);

      if (old) {
        await entity.update(old.id, payload);
        updated++;
        console.log(`✓ Aggiornata sintetica ${payload.timestamp}`);
      } else {
        await entity.create(payload);
        created++;
        console.log(`✓ Creata sintetica ${payload.timestamp}`);
      }
    }
  }

  const rainyDays = rows.filter(r => r[3] >= 1).length;
  const totalRain = rows.reduce((s, r) => s + r[3], 0);

  console.log(`✓ Agosto 2024 completato: ${created} create, ${updated} aggiornate`);
  console.log(`✓ Pioggia totale Excel: ${totalRain.toFixed(1)} mm`);
  console.log(`✓ Giorni di pioggia (>=1 mm): ${rainyDays}`);
}

main().catch((e) => {
  console.error("✗ Import agosto 2024 fallito:", e.message);
  process.exit(1);
});
