import { createClient } from "@base44/sdk";

const STATION_ID = process.env.STATION_ID || "ILUCCA95";
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

function windDir(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return null;

  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(Number(deg) / 45) % 8];
}

async function fetchRecentObservations() {
  const url =
    `https://api.weather.com/v2/pws/observations/all/1day` +
    `?stationId=${STATION_ID}` +
    `&format=json` +
    `&units=m` +
    `&numericPrecision=decimal` +
    `&apiKey=${WEATHER_API_KEY}`;

  const resp = await fetch(url);

  if (!resp.ok) {
    let detail = "";

    try {
      detail = (await resp.text()).slice(0, 300);
    } catch {}

    throw new Error(
      `Weather API HTTP ${resp.status} ${resp.statusText} ${detail}`
    );
  }

  const json = await resp.json();
  const observations = json?.observations ?? [];

  if (!observations.length) {
    throw new Error("Weather API: nessuna osservazione recente trovata");
  }

  return observations;
}

function mapReading(obs) {
  const metric = obs.metric ?? {};

  return {
    timestamp: obs.obsTimeUtc ?? new Date().toISOString(),

    // Temperatura media e veri estremi dell'intervallo
    temperature: metric.tempAvg ?? null,
    temperature_high: metric.tempHigh ?? null,
    temperature_low: metric.tempLow ?? null,

    humidity: obs.humidityAvg ?? null,
    pressure: metric.pressureMax ?? null,

    // Vento medio e direzione media
    wind_speed: metric.windspeedAvg ?? null,
    wind_direction: windDir(obs.winddirAvg),

    // Pioggia
    rainfall: metric.precipTotal ?? null,
    rain_rate: metric.precipRate ?? null,

    // Picco di raffica dell'intervallo
    wind_gust: metric.windgustHigh ?? null,

    // UV massimo dell'intervallo
    uv_index: obs.uvHigh ?? null,

    // Radiazione solare massima dell'intervallo, in W/m²
    solar_radiation: obs.solarRadiationHigh ?? null,
  };
}

async function main() {
  if (!WEATHER_API_KEY) {
    return fail("Secret WEATHER_API_KEY mancante");
  }

  if (!BASE44_APP_ID) {
    return fail("Secret BASE44_APP_ID mancante");
  }

  if (!COLLECTOR_EMAIL || !COLLECTOR_PASSWORD) {
    return fail("Secret COLLECTOR_EMAIL / COLLECTOR_PASSWORD mancanti");
  }

  const base44 = createClient({
    appId: BASE44_APP_ID,
  });

  try {
    await base44.auth.loginViaEmailPassword(
      COLLECTOR_EMAIL,
      COLLECTOR_PASSWORD
    );
  } catch (e) {
    return fail(`Errore autenticazione Base44: ${e.message}`);
  }

  console.log(`✓ Autenticato a Base44 come ${COLLECTOR_EMAIL}`);

  let observations;

  try {
    observations = await fetchRecentObservations();

    console.log(
      `✓ Recuperate ${observations.length} osservazioni delle ultime 24 ore`
    );
  } catch (e) {
    return fail(`Errore API Weather: ${e.message}`);
  }

  let existing = [];

  try {
    existing = await base44.entities.WeatherReading.list(
      "-timestamp",
      500
    );
  } catch (e) {
    return fail(`Errore lettura Base44 (dedupe): ${e.message}`);
  }

  const existingTimestamps = new Set(
    (existing ?? [])
      .map((r) => r.timestamp)
      .filter(Boolean)
  );

  const missing = observations
    .map(mapReading)
    .filter((reading) => !existingTimestamps.has(reading.timestamp))
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime()
    );

  if (!missing.length) {
    console.log("• Nessuna nuova lettura da inserire.");
    return;
  }

  console.log(
    `• Trovate ${missing.length} letture mancanti da salvare`
  );

  let saved = 0;

  for (const reading of missing) {
    try {
      await base44.entities.WeatherReading.create(reading);
      saved++;

      console.log(
        `✓ Salvata ${reading.timestamp} — ` +
        `T media ${reading.temperature ?? "—"}°C, ` +
        `T max ${reading.temperature_high ?? "—"}°C, ` +
        `T min ${reading.temperature_low ?? "—"}°C, ` +
        `UR ${reading.humidity ?? "—"}%, ` +
        `pioggia ${reading.rainfall ?? "—"} mm, ` +
        `rate ${reading.rain_rate ?? "—"} mm/h, ` +
        `vento medio ${reading.wind_speed ?? "—"} km/h, ` +
        `raffica max ${reading.wind_gust ?? "—"} km/h, ` +
        `radiazione solare ${reading.solar_radiation ?? "—"} W/m²`
      );
    } catch (e) {
      console.error(
        `✗ Errore salvataggio ${reading.timestamp}: ${e.message}`
      );
    }
  }

  console.log(
    `✓ Operazione completata: ${saved}/${missing.length} nuove letture salvate`
  );
}

main().catch((e) =>
  fail(`Errore imprevisto: ${e.message}`)
);
