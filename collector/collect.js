import { createClient } from "@base44/sdk";

const STATION_ID = process.env.STATION_ID || "ILUCCA95";
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;
const PRESSURE_CORRECTION_HPA = 12;

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatus(error) {
  const direct =
    error?.status ??
    error?.response?.status ??
    error?.cause?.status ??
    null;

  if (direct != null) return Number(direct);

  const match = String(error?.message ?? "").match(/\b(403|429|5\d\d)\b/);
  return match ? Number(match[1]) : null;
}

function isBase44Transient(error) {
  const status = getStatus(error);
  return status === 403 || status === 429 || (status >= 500 && status <= 599);
}

function isWeatherTransient(error) {
  const status = getStatus(error);
  const message = String(error?.message ?? "").toLowerCase();

  return (
    status === 429 ||
    (status >= 500 && status <= 599) ||
    message.includes("unexpected end of json") ||
    message.includes("invalid json") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econn")
  );
}

async function withRetry(
  fn,
  label,
  {
    attempts = 3,
    delays = [2000, 5000],
    shouldRetry = () => true,
  } = {}
) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }

      const delay = delays[Math.min(attempt - 1, delays.length - 1)] ?? 5000;
      console.warn(
        `⚠ ${label}: tentativo ${attempt}/${attempts} fallito (${error.message}). Riprovo tra ${delay / 1000}s...`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function windDir(deg) {
  if (deg == null || Number.isNaN(Number(deg))) return null;

  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(Number(deg) / 45) % 8];
}

async function fetchRecentObservationsOnce() {
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

    const error = new Error(
      `Weather API HTTP ${resp.status} ${resp.statusText} ${detail}`
    );
    error.status = resp.status;
    throw error;
  }

  const raw = await resp.text();
  let json;

  try {
    json = JSON.parse(raw);
  } catch (error) {
    const parseError = new Error(
      `Weather API invalid JSON: ${error.message}`
    );
    parseError.cause = error;
    throw parseError;
  }

  const observations = json?.observations ?? [];

  if (!observations.length) {
    throw new Error("Weather API: nessuna osservazione recente trovata");
  }

  return observations;
}

async function fetchRecentObservations() {
  return withRetry(
    fetchRecentObservationsOnce,
    "Weather API",
    {
      attempts: 3,
      delays: [2000, 5000],
      shouldRetry: isWeatherTransient,
    }
  );
}

function mapReading(obs) {
  const metric = obs.metric ?? {};

  const tempAvg = toFiniteNumber(metric.tempAvg);
  const tempHigh = toFiniteNumber(metric.tempHigh);
  const tempLow = toFiniteNumber(metric.tempLow);

  // Base44 richiede un valore numerico per "temperature".
  // Gli estremi tempHigh/tempLow sono però il dato prioritario da non perdere.
  // Se tempAvg manca ma gli estremi sono validi, usiamo un valore di appoggio
  // solo per il campo temperature, lasciando intatti i veri estremi.
  let temperature = tempAvg;

  if (temperature == null) {
    if (tempHigh != null && tempLow != null) {
      temperature = (tempHigh + tempLow) / 2;
    } else if (tempHigh != null) {
      temperature = tempHigh;
    } else if (tempLow != null) {
      temperature = tempLow;
    }
  }

  return {
    timestamp: obs.obsTimeUtc ?? new Date().toISOString(),

    // Temperatura media (o fallback tecnico) e veri estremi dell'intervallo
    temperature,
    temperature_high: tempHigh,
    temperature_low: tempLow,

    humidity: obs.humidityAvg ?? null,

    // La console/PWL sta trasmettendo la pressione relativa circa 12 hPa troppo bassa.
    // Per la lettura corrente usiamo il centro dell'intervallo min/max e applichiamo
    // la correzione di calibrazione, così il valore torna coerente con la pressione locale.
    pressure: (() => {
      const pMax = toFiniteNumber(metric.pressureMax);
      const pMin = toFiniteNumber(metric.pressureMin);

      if (pMax != null && pMin != null) {
        return ((pMax + pMin) / 2) + PRESSURE_CORRECTION_HPA;
      }

      if (pMax != null) return pMax + PRESSURE_CORRECTION_HPA;
      if (pMin != null) return pMin + PRESSURE_CORRECTION_HPA;
      return null;
    })(),

    // Weather Company units=m restituisce il vento in km/h; normalizziamo in m/s.
    wind_speed:
      toFiniteNumber(metric.windspeedAvg) == null
        ? null
        : toFiniteNumber(metric.windspeedAvg) / 3.6,
    wind_direction: windDir(obs.winddirAvg),

    // Pioggia
    rainfall: metric.precipTotal ?? null,
    rain_rate: metric.precipRate ?? null,

    // Picco di raffica dell'intervallo, convertito da km/h a m/s
    wind_gust:
      toFiniteNumber(metric.windgustHigh) == null
        ? null
        : toFiniteNumber(metric.windgustHigh) / 3.6,

    // UV massimo dell'intervallo
    uv_index: obs.uvHigh ?? null,

    // Radiazione solare massima dell'intervallo, in W/m²
    solar_radiation: obs.solarRadiationHigh ?? null,
  };
}


function checkFreshness(observations) {
  const usable = observations
    .map(mapReading)
    .filter((reading) => reading.temperature != null && reading.timestamp)
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() -
        new Date(a.timestamp).getTime()
    );

  if (!usable.length) {
    throw new Error(
      "WATCHDOG: nessuna lettura meteo valida disponibile nelle ultime 24 ore"
    );
  }

  const latest = usable[0];
  const latestMs = new Date(latest.timestamp).getTime();
  const ageMinutes = (Date.now() - latestMs) / 60000;

  console.log(
    `• WATCHDOG: ultima lettura valida ${latest.timestamp}, età ${ageMinutes.toFixed(1)} minuti`
  );

  if (!Number.isFinite(ageMinutes) || ageMinutes > 30) {
    console.error(
      `::error title=LuccaMeteo dati fermi::Ultima lettura valida vecchia di ${ageMinutes.toFixed(1)} minuti (${latest.timestamp})`
    );

    throw new Error(
      `WATCHDOG: ultima lettura valida vecchia di ${ageMinutes.toFixed(1)} minuti`
    );
  }
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
    await withRetry(
      () =>
        base44.auth.loginViaEmailPassword(
          COLLECTOR_EMAIL,
          COLLECTOR_PASSWORD
        ),
      "Autenticazione Base44",
      {
        attempts: 3,
        delays: [3000, 8000],
        shouldRetry: isBase44Transient,
      }
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

    checkFreshness(observations);
  } catch (e) {
    return fail(`Errore API Weather / watchdog: ${e.message}`);
  }

  let existing = [];

  try {
    existing = await withRetry(
      () =>
        base44.entities.WeatherReading.list(
          "-timestamp",
          500
        ),
      "Lettura Base44 per dedupe",
      {
        attempts: 3,
        delays: [3000, 8000],
        shouldRetry: isBase44Transient,
      }
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
    if (reading.temperature == null) {
      console.error(
        `✗ Lettura saltata ${reading.timestamp}: nessun dato temperatura valido (media/max/min); ` +
        `pressione ${reading.pressure ?? "—"} hPa; UR ${reading.humidity ?? "—"}%; ` +
        `vento ${reading.wind_speed ?? "—"} m/s; raffica ${reading.wind_gust ?? "—"} m/s; ` +
        `pioggia ${reading.rainfall ?? "—"} mm; rain rate ${reading.rain_rate ?? "—"} mm/h`
      );
      continue;
    }

    try {
      await withRetry(
        () => base44.entities.WeatherReading.create(reading),
        `Salvataggio Base44 ${reading.timestamp}`,
        {
          attempts: 3,
          delays: [3000, 8000],
          // Per gli inserimenti ritentiamo solo 403/429: sono rifiuti espliciti
          // e non lasciano ambiguità su un possibile inserimento già avvenuto.
          shouldRetry: (error) => {
            const status = getStatus(error);
            return status === 403 || status === 429;
          },
        }
      );

      saved++;

      console.log(
        `✓ Salvata ${reading.timestamp} — ` +
        `T media/fallback ${reading.temperature ?? "—"}°C, ` +
        `T max ${reading.temperature_high ?? "—"}°C, ` +
        `T min ${reading.temperature_low ?? "—"}°C, ` +
        `UR ${reading.humidity ?? "—"}%, ` +
        `pioggia ${reading.rainfall ?? "—"} mm, ` +
        `rate ${reading.rain_rate ?? "—"} mm/h, ` +
        `vento medio ${reading.wind_speed ?? "—"} m/s, ` +
        `raffica max ${reading.wind_gust ?? "—"} m/s, ` +
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
