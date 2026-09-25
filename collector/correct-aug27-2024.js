import { createClient } from "@base44/sdk";

const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

async function main() {
  const base44 = createClient({ appId: BASE44_APP_ID });
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL, COLLECTOR_PASSWORD);
  const entity = base44.entities.WeatherReading;

  const rows = await entity.list("-timestamp", 10000);
  const byTs = new Map((rows ?? []).filter(r => r.timestamp).map(r => [r.timestamp, r]));

  const oldMorningTs = "2024-08-27T04:00:00.000Z"; // 06:00 CEST
  const oldMorning = byTs.get(oldMorningTs);
  if (oldMorning) {
    await entity.delete(oldMorning.id);
    console.log("✓ Rimossa vecchia Tmin sintetica mattutina");
  }

  const payloads = [
    {
      timestamp: "2024-08-27T13:00:00.000Z", // 15:00 CEST
      temperature: 35.4,
      temperature_high: 35.4,
      temperature_low: 35.4,
      humidity: 33,
      pressure: 1011.2,
      wind_speed: 0,
      wind_direction: null,
      rainfall: 0,
      rain_rate: 0,
      wind_gust: 0,
      uv_index: 8.7,
      solar_radiation: null
    },
    {
      timestamp: "2024-08-27T15:00:00.000Z", // 17:00 CEST
      temperature: 32.6,
      temperature_high: 32.6,
      temperature_low: 32.6,
      humidity: 96,
      pressure: 1011.2,
      wind_speed: 16.67,
      wind_direction: null,
      rainfall: 0,
      rain_rate: 108.45,
      wind_gust: 30.56,
      uv_index: 0,
      solar_radiation: null
    },
    {
      timestamp: "2024-08-27T15:10:00.000Z", // 17:10 CEST
      temperature: 17.6,
      temperature_high: 17.6,
      temperature_low: 17.6,
      humidity: 96,
      pressure: 1011.2,
      wind_speed: 16.67,
      wind_direction: null,
      rainfall: 18.4,
      rain_rate: 108.45,
      wind_gust: 30.56,
      uv_index: 0,
      solar_radiation: null
    }
  ];

  for (const payload of payloads) {
    const existing = byTs.get(payload.timestamp);
    if (existing) {
      await entity.update(existing.id, payload);
      console.log(`✓ Aggiornato ${payload.timestamp}`);
    } else {
      await entity.create(payload);
      console.log(`✓ Creato ${payload.timestamp}`);
    }
  }

  console.log("✓ Correzione tempesta 27/08/2024 completata");
  console.log("• Grandine documentata: diametro fino a 6 cm (nota storica, non presente nello schema WeatherReading)");
}

main().catch(e => {
  console.error("✗ Correzione fallita:", e.message);
  process.exit(1);
});
