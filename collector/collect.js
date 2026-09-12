import { createClient } from "@base44/sdk";

// Weather Collector per Lucca Meteo

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

async function fetchObservation() {
  const url =
    `https://api.weather.com/v2/pws/observations/current` +
    `?stationId=${STATION_ID}` +
    `&format=json` +
    `&units=m` +
    `&numericPrecision=decimal` +
    `&apiKey=${WEATHER_API_KEY}`;

  const resp = await fetch(url);

  if (!resp.ok) {
    let detail = "";

    try {
      detail = (await resp.text()).slice(0, 200);
    } catch {}

    throw new Error(
      `Weather API HTTP ${resp.status} ${resp.statusText} ${detail}`
    );
  }

  const json = await resp.json();
  const obs = json?.observations?.[0];

  if (!obs) {
    throw new Error("Weather API: nessuna osservazione nella risposta");
  }

  return obs;
}

function mapReading(obs) {
  const metric = obs.metric ?? {};

  return {
    timestamp: obs.obsTimeUtc ?? new Date().toISOString(),
    temperature: metric.temp ?? null,
    humidity: obs.humidity ?? null,
    pressure: metric.pressure ?? null,
    wind_speed: metric.windSpeed ?? null,
    wind_direction: windDir(obs.winddir),
    rainfall: metric.precipTotal ?? null,
    rain_rate: metric.precipRate ?? null,
    wind_gust: metric.windGust ?? null,
    uv_index: obs.uv ?? null,
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
    return fail(
      "Secret COLLECTOR_EMAIL / COLLECTOR_PASSWORD mancanti"
    );
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
    return fail(
      `Errore autenticazione Base44: ${e.message}`
    );
  }

  console.log(
    `✓ Autenticato a Base44 come ${COLLECTOR_EMAIL}`
  );

  let obs;

  try {
    obs = await fetchObservation();

    console.log(
      `✓ Osservazione recuperata — obsTimeUtc: ${obs.obsTimeUtc}`
    );
  } catch (e) {
    return fail(`Errore API Weather: ${e.message}`);
  }

  const reading = mapReading(obs);

  let recent = [];

  try {
    recent = await base44.entities.WeatherReading.list(
      "-timestamp",
      20
    );
  } catch (e) {
    return fail(
      `Errore lettura Base44 (dedupe): ${e.message}`
    );
  }

  const exists = (recent ?? []).some(
    (r) => r.timestamp === reading.timestamp
  );

  if (exists) {
    console.log(
      `• Lettura già presente (timestamp ${reading.timestamp}) — nessuna nuova creazione.`
    );
    return;
  }

  try {
    await base44.entities.WeatherReading.create(reading);

    console.log(
      `✓ Nuova lettura salvata — timestamp ${reading.timestamp}, ` +
      `temp ${reading.temperature}°C, umidità ${reading.humidity}%, ` +
      `pioggia ${reading.rainfall}mm (rate ${reading.rain_rate}mm/h), ` +
      `vento ${reading.wind_speed}km/h ${reading.wind_direction ?? "—"}.`
    );
  } catch (e) {
    return fail(
      `Errore Base44 create: ${e.message}`
    );
  }
}

main().catch((e) =>
  fail(`Errore imprevisto: ${e.message}`)
);
