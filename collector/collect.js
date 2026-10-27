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
      attempts: 5,
      delays: [2000, 5000, 10000, 20000],
      shouldRetry: isWeatherTransient,
    }
  );
}
async function fetchCurrentObservationOnce() {
  const url =
    "https://api.weather.com/v2/pws/observations/current" +
    "?stationId=" + STATION_ID +
    "&format=json" +
    "&units=m" +
    "&numericPrecision=decimal" +
    "&apiKey=" + WEATHER_API_KEY;

  const resp = await fetch(url);

  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.text()).slice(0, 300);
    } catch {}

    const error = new Error(
      "Weather Current API HTTP " + resp.status + " " + resp.statusText + " " + detail
    );
    error.status = resp.status;
    throw error;
  }

  const raw = await resp.text();
  let json;

  try {
    json = JSON.parse(raw);
  } catch (error) {
    const parseError = new Error("Weather Current API invalid JSON: " + error.message);
    parseError.cause = error;
    throw parseError;
  }

  const current = json?.observations?.[0] ?? null;
  if (!current?.obsTimeUtc) {
    throw new Error("Weather Current API: nessuna osservazione corrente disponibile");
  }

  return current;
}

async function fetchCurrentObservation() {
  return withRetry(
    fetchCurrentObservationOnce,
    "Weather Current API",
    {
      attempts: 3,
      delays: [2000, 5000],
      shouldRetry: isWeatherTransient,
    }
  );
}

function normalizeCurrentObservation(obs) {
  const metric = obs?.metric ?? {};

  return {
    ...obs,
    humidityAvg: obs?.humidity ?? null,
    solarRadiationHigh: obs?.solarRadiation ?? null,
    uvHigh: obs?.uv ?? null,
    winddirAvg: obs?.winddir ?? null,
    metric: {
      tempAvg: metric?.temp ?? null,
      tempHigh: metric?.temp ?? null,
      tempLow: metric?.temp ?? null,
      windspeedAvg: metric?.windSpeed ?? null,
      windgustHigh: metric?.windGust ?? null,
      pressureMax: metric?.pressure ?? null,
      pressureMin: metric?.pressure ?? null,
      precipRate: metric?.precipRate ?? null,
      precipTotal: metric?.precipTotal ?? null,
    },
  };
}


function italyDayKey(timestamp) {
  // precipTotal è un cumulato giornaliero della stazione. Il confine corretto
  // è quindi il giorno locale di Lucca, inclusi automaticamente CET/CEST.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function hasUsableTemperature(obs) {
  const metric = obs?.metric ?? {};
  return (
    toFiniteNumber(metric.tempAvg) != null ||
    toFiniteNumber(metric.tempHigh) != null ||
    toFiniteNumber(metric.tempLow) != null
  );
}

// Preserva il picco reale di rain rate anche quando una o più osservazioni
// intermedie non hanno temperatura e non possono essere salvate come WeatherReading.
// Il massimo osservato viene associato alla successiva lettura valida dello stesso
// giorno locale. Se il giorno termina con sole letture incomplete, il picco viene
// associato all'ultima lettura valida di quel giorno, senza inventare temperature.
function deriveRainRatePeaks(observations) {
  const sorted = [...observations]
    .filter((obs) => obs?.obsTimeUtc)
    .sort((a, b) => new Date(a.obsTimeUtc).getTime() - new Date(b.obsTimeUtc).getTime());

  const byDay = new Map();

  for (const obs of sorted) {
    const day = italyDayKey(obs.obsTimeUtc);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(obs);
  }

  const peaks = new Map();

  for (const dayObservations of byDay.values()) {
    let pendingMax = null;
    let lastValidTimestamp = null;

    for (const obs of dayObservations) {
      const rate = toFiniteNumber(obs?.metric?.precipRate);
      if (rate != null) {
        pendingMax = pendingMax == null ? rate : Math.max(pendingMax, rate);
      }

      if (hasUsableTemperature(obs)) {
        if (pendingMax != null) {
          peaks.set(obs.obsTimeUtc, pendingMax);
        }
        lastValidTimestamp = obs.obsTimeUtc;
        pendingMax = null;
      }
    }

    // Caso limite: il picco arriva dopo l'ultima lettura completa della giornata.
    // Lo attribuiamo all'ultima lettura valida dello stesso giorno per non perderlo.
    if (pendingMax != null && lastValidTimestamp) {
      const current = toFiniteNumber(peaks.get(lastValidTimestamp));
      peaks.set(
        lastValidTimestamp,
        current == null ? pendingMax : Math.max(current, pendingMax)
      );
    }
  }

  return peaks;
}

function deriveRainfallIncrements(observations) {
  const sorted = [...observations]
    .filter((obs) => {
      if (!obs?.obsTimeUtc) return false;

      // Il record verrà scartato più avanti se non esiste alcuna temperatura valida.
      // Non deve quindi avanzare il contatore della pioggia: in caso contrario
      // l'incremento caduto durante una lettura incompleta viene perso per sempre.
      return hasUsableTemperature(obs);
    })
    .sort((a, b) => new Date(a.obsTimeUtc).getTime() - new Date(b.obsTimeUtc).getTime());

  const increments = new Map();
  let previousTotal = null;
  let previousDay = null;

  for (const obs of sorted) {
    const ts = obs.obsTimeUtc;
    const total = toFiniteNumber(obs?.metric?.precipTotal);
    const currentDay = italyDayKey(ts);
    let increment = null;

    if (total != null) {
      if (previousTotal == null) {
        // Il primo punto della finestra non ha un predecessore affidabile.
        increment = 0;
      } else if (previousDay != null && currentDay !== previousDay) {
        // precipTotal si azzera a inizio giornata. Se la stazione è rimasta offline
        // attraversando la mezzanotte, la prima lettura valida può già contenere tutta
        // la pioggia caduta dal reset: quel cumulato è quindi nuovo incremento e non
        // deve essere scartato come una semplice diminuzione del contatore.
        increment = total > 0 ? Math.round(total * 100) / 100 : 0;
      } else {
        const delta = total - previousTotal;
        // Nello stesso giorno solo gli aumenti rappresentano nuova pioggia.
        // Valori costanti o diminuzioni anomale non producono pioggia artificiale.
        increment = delta > 0 ? Math.round(delta * 100) / 100 : 0;
      }

      previousTotal = total;
      previousDay = currentDay;
    }

    increments.set(ts, increment);
  }

  return increments;
}

function mapReading(obs, rainfallIncrement = null, rainRatePeak = null) {
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
        : Math.round((toFiniteNumber(metric.windspeedAvg) / 3.6) * 100) / 100,
    wind_direction: windDir(obs.winddirAvg),

    // Pioggia: precipTotal è un cumulato/contatore. Salviamo solo l'incremento
    // rispetto al run precedente, così la somma dei WeatherReading non moltiplica
    // lo stesso totale centinaia di volte.
    rainfall: rainfallIncrement,
    // Conserviamo il picco più alto osservato nell'intervallo, includendo eventuali
    // letture incomplete che non possono essere salvate autonomamente.
    rain_rate:
      toFiniteNumber(rainRatePeak) != null
        ? toFiniteNumber(rainRatePeak)
        : toFiniteNumber(metric.precipRate),

    // Picco di raffica dell'intervallo, convertito da km/h a m/s
    wind_gust:
      toFiniteNumber(metric.windgustHigh) == null
        ? null
        : Math.round((toFiniteNumber(metric.windgustHigh) / 3.6) * 100) / 100,

    // UV massimo dell'intervallo
    uv_index: obs.uvHigh ?? null,

    // Radiazione solare massima dell'intervallo, in W/m²
    solar_radiation: obs.solarRadiationHigh ?? null,
  };
}


function checkFreshness(observations) {
  // Il watchdog deve verificare che la stazione stia trasmettendo,
  // non che uno specifico sensore (es. temperatura) sia disponibile.
  const usable = observations
    .filter((obs) => obs?.obsTimeUtc)
    .sort(
      (a, b) =>
        new Date(b.obsTimeUtc).getTime() -
        new Date(a.obsTimeUtc).getTime()
    );

  if (!usable.length) {
    throw new Error(
      "WATCHDOG: nessuna osservazione con timestamp disponibile nelle ultime 24 ore"
    );
  }

  const latest = usable[0];
  const latestMs = new Date(latest.obsTimeUtc).getTime();
  const ageMinutes = (Date.now() - latestMs) / 60000;

  console.log(
    `• WATCHDOG: ultima trasmissione stazione ${latest.obsTimeUtc}, età ${ageMinutes.toFixed(1)} minuti`
  );

  if (!Number.isFinite(ageMinutes) || ageMinutes > 30) {
    console.error(
      `::error title=LuccaMeteo dati fermi::Ultima trasmissione vecchia di ${ageMinutes.toFixed(1)} minuti (${latest.obsTimeUtc})`
    );

    throw new Error(
      `WATCHDOG: ultima trasmissione vecchia di ${ageMinutes.toFixed(1)} minuti`
    );
  }
}

function auditObservationGaps(observations) {
  const times = observations
    .map((obs) => obs?.obsTimeUtc)
    .filter(Boolean)
    .map((ts) => new Date(ts).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (times.length < 2) return;

  let maxGapMinutes = 0;
  let gapsOver10 = 0;

  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] - times[i - 1]) / 60000;
    maxGapMinutes = Math.max(maxGapMinutes, gap);
    if (gap > 10.5) gapsOver10++;
  }

  console.log(
    `• AUDIT 24h: ${times.length} osservazioni, gap massimo ${maxGapMinutes.toFixed(1)} min, gap >10 min: ${gapsOver10}`
  );

  if (gapsOver10 > 0) {
    console.warn(
      `⚠ AUDIT 24h: presenti ${gapsOver10} intervalli superiori a 10 minuti; il collector tenterà comunque il recupero di tutti i timestamp restituiti dalla Weather API.`
    );
  }
}

async function timestampExists(entity, timestamp) {
  const recent = await withRetry(
    () => entity.list("-timestamp", 500),
    `Verifica dedupe ${timestamp}`,
    {
      attempts: 3,
      delays: [2000, 5000],
      shouldRetry: isBase44Transient,
    }
  );

  return (recent ?? []).some((row) => row.timestamp === timestamp);
}

async function createWithConfirmation(entity, reading) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await entity.create(reading);
      return { created: true, confirmedExisting: false };
    } catch (error) {
      lastError = error;
      const status = getStatus(error);
      const ambiguous =
        status == null ||
        status === 429 ||
        status === 403 ||
        (status >= 500 && status <= 599);

      if (!ambiguous) throw error;

      // Un 5xx o un errore di rete può arrivare dopo che Base44 ha già
      // accettato la scrittura. Prima di ritentare controlliamo quindi
      // se il timestamp è comparso, evitando doppioni.
      try {
        if (await timestampExists(entity, reading.timestamp)) {
          return { created: false, confirmedExisting: true };
        }
      } catch (verifyError) {
        console.warn(
          `⚠ Impossibile verificare ${reading.timestamp} dopo errore di scrittura: ${verifyError.message}`
        );
      }

      if (attempt >= 3) throw error;

      const delay = attempt === 1 ? 3000 : 8000;
      console.warn(
        `⚠ Salvataggio ${reading.timestamp}: tentativo ${attempt}/3 fallito (${error.message}). Timestamp non trovato, riprovo tra ${delay / 1000}s...`
      );
      await sleep(delay);
    }
  }

  throw lastError;
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

    const latestDiagnostics = [...observations]
      .filter((obs) => obs?.obsTimeUtc)
      .sort((a, b) => new Date(b.obsTimeUtc) - new Date(a.obsTimeUtc))
      .slice(0, 5);

    console.log("• DIAGNOSTICA WEATHER API — ultime 5 osservazioni:");
    for (const obs of latestDiagnostics) {
      const metric = obs?.metric ?? {};
      console.log(JSON.stringify({
        obsTimeUtc: obs?.obsTimeUtc ?? null,
        topLevelKeys: Object.keys(obs ?? {}),
        metricKeys: Object.keys(metric),
        temp: metric?.temp ?? null,
        tempAvg: metric?.tempAvg ?? null,
        tempHigh: metric?.tempHigh ?? null,
        tempLow: metric?.tempLow ?? null,
        humidityAvg: obs?.humidityAvg ?? null
      }));
    }

    try {
      const currentRaw = await fetchCurrentObservation();
      const current = normalizeCurrentObservation(currentRaw);

      const latestValidHistorical = [...observations]
        .filter((obs) => obs?.obsTimeUtc && hasUsableTemperature(obs))
        .sort((a, b) => new Date(b.obsTimeUtc).getTime() - new Date(a.obsTimeUtc).getTime())[0] ?? null;

      const currentTs = new Date(current.obsTimeUtc).getTime();
      const historicalTs = latestValidHistorical
        ? new Date(latestValidHistorical.obsTimeUtc).getTime()
        : -Infinity;

      console.log(
        "• CURRENT API: " + current.obsTimeUtc +
        ", temperatura " + (current.metric?.tempAvg ?? "—") + "°C, UR " +
        (current.humidityAvg ?? "—") + "%"
      );

      if (
        hasUsableTemperature(current) &&
        Number.isFinite(currentTs) &&
        currentTs > historicalTs &&
        !observations.some((obs) => obs?.obsTimeUtc === current.obsTimeUtc)
      ) {
        observations.push(current);
        console.log("✓ Fallback CURRENT utilizzato: " + current.obsTimeUtc);
      } else if (!hasUsableTemperature(current)) {
        console.warn("⚠ CURRENT API: osservazione corrente senza temperatura valida");
      } else {
        console.log("• CURRENT API: nessun fallback necessario");
      }
    } catch (currentError) {
      console.warn("⚠ CURRENT API non disponibile: " + currentError.message);
    }

    checkFreshness(observations);
    auditObservationGaps(observations);
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

  const rainfallIncrements = deriveRainfallIncrements(observations);
  const rainRatePeaks = deriveRainRatePeaks(observations);

  const mappedReadings = observations
    .map((obs) =>
      mapReading(
        obs,
        rainfallIncrements.get(obs.obsTimeUtc) ?? null,
        rainRatePeaks.get(obs.obsTimeUtc) ?? null
      )
    );

  // Se il picco di rain rate è emerso da una lettura incompleta successiva,
  // potremmo dover aggiornare una WeatherReading già salvata. In questo modo
  // la deduplica per timestamp non può farci perdere il massimo reale giornaliero.
  const existingByTimestamp = new Map();
  for (const row of existing ?? []) {
    if (!row?.timestamp) continue;
    if (!existingByTimestamp.has(row.timestamp)) {
      existingByTimestamp.set(row.timestamp, []);
    }
    existingByTimestamp.get(row.timestamp).push(row);
  }

  let rainRatePeaksUpdated = 0;

  for (const reading of mappedReadings) {
    const peak = toFiniteNumber(reading.rain_rate);
    if (peak == null) continue;

    const rows = existingByTimestamp.get(reading.timestamp) ?? [];
    for (const row of rows) {
      const current = toFiniteNumber(row.rain_rate);
      const rowId = row.id ?? row._id ?? null;

      if (rowId && (current == null || peak > current)) {
        try {
          await withRetry(
            () => base44.entities.WeatherReading.update(rowId, { rain_rate: peak }),
            `Aggiornamento rain rate max ${reading.timestamp}`,
            {
              attempts: 3,
              delays: [2000, 5000],
              shouldRetry: isBase44Transient,
            }
          );
          row.rain_rate = peak;
          rainRatePeaksUpdated++;
          console.log(
            `✓ Rain rate max aggiornato ${reading.timestamp}: ${current ?? "—"} → ${peak} mm/h`
          );
        } catch (e) {
          console.error(
            `✗ Impossibile aggiornare rain rate max ${reading.timestamp}: ${e.message}`
          );
        }
      }
    }
  }

  const missing = mappedReadings
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
  let confirmedAfterAmbiguousError = 0;
  let skippedNoTemperature = 0;
  let failed = 0;

  for (const reading of missing) {
    if (reading.temperature == null) {
      skippedNoTemperature++;
      console.error(
        `✗ Lettura saltata ${reading.timestamp}: nessun dato temperatura valido (media/max/min); ` +
        `pressione ${reading.pressure ?? "—"} hPa; UR ${reading.humidity ?? "—"}%; ` +
        `vento ${reading.wind_speed ?? "—"} m/s; raffica ${reading.wind_gust ?? "—"} m/s; ` +
        `pioggia ${reading.rainfall ?? "—"} mm; rain rate ${reading.rain_rate ?? "—"} mm/h`
      );
      continue;
    }

    try {
      const result = await createWithConfirmation(
        base44.entities.WeatherReading,
        reading
      );

      if (result.created) saved++;
      if (result.confirmedExisting) confirmedAfterAmbiguousError++;

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
      failed++;
      console.error(
        `✗ Errore salvataggio ${reading.timestamp}: ${e.message}`
      );
    }
  }

  console.log(
    `✓ Operazione completata: ${saved} nuove letture salvate, ` +
    `${rainRatePeaksUpdated} rain rate max aggiornati, ` +
    `${confirmedAfterAmbiguousError} già presenti dopo errore ambiguo, ` +
    `${skippedNoTemperature} saltate per temperatura assente, ` +
    `${failed} errori definitivi`
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) =>
  fail(`Errore imprevisto: ${e.message}`)
);
