import { createClient } from "@base44/sdk";

const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

const FAILED_TIMESTAMPS = new Set([
  "2026-09-25T12:44:52Z",
  "2026-09-25T12:39:27Z",
  "2026-09-25T12:34:39Z",
  "2026-09-25T12:29:07Z",
  "2026-09-25T12:24:45Z",
  "2026-09-25T05:04:32Z",
  "2026-09-25T04:59:56Z",
  "2026-09-25T04:54:57Z",
  "2026-09-25T04:49:32Z",
  "2026-09-24T22:54:21Z",
  "2026-09-24T22:49:10Z",
  "2026-09-24T22:44:57Z",
  "2026-09-24T22:39:33Z",
  "2026-09-24T16:24:01Z",
  "2026-09-24T16:19:32Z",
  "2026-09-24T16:14:19Z",
  "2026-09-24T16:09:56Z",
  "2026-09-24T09:39:08Z",
  "2026-09-24T09:34:32Z",
  "2026-09-24T09:29:00Z",
  "2026-09-24T09:24:24Z",
  "2026-09-24T03:29:33Z",
  "2026-09-24T03:24:57Z",
  "2026-09-24T03:19:33Z",
  "2026-09-24T03:14:09Z",
  "2026-09-23T21:04:32Z",
  "2026-09-23T20:59:45Z",
  "2026-09-23T20:54:33Z",
  "2026-09-23T20:49:09Z",
  "2026-09-23T13:49:42Z",
  "2026-09-23T13:44:07Z",
  "2026-09-23T13:39:35Z",
  "2026-09-23T13:34:56Z",
  "2026-09-23T08:04:09Z",
  "2026-09-23T07:59:33Z",
  "2026-09-23T07:54:21Z",
  "2026-09-23T07:49:09Z",
  "2026-09-23T01:54:53Z",
  "2026-09-23T01:49:29Z",
  "2026-09-23T01:43:41Z",
  "2026-09-23T01:39:29Z",
  "2026-09-22T19:34:39Z",
  "2026-09-22T19:29:55Z",
  "2026-09-22T19:24:17Z",
  "2026-09-22T19:19:34Z",
  "2026-09-22T11:49:09Z",
  "2026-09-22T11:44:33Z",
  "2026-09-22T11:39:09Z",
  "2026-09-22T11:34:57Z",
  "2026-09-22T05:39:10Z",
  "2026-09-22T05:34:58Z",
  "2026-09-22T05:29:22Z",
  "2026-09-22T05:24:57Z",
  "2026-09-21T23:29:42Z",
  "2026-09-21T23:24:18Z",
  "2026-09-21T23:19:54Z",
  "2026-09-21T23:14:11Z",
  "2026-09-21T17:09:52Z",
  "2026-09-21T17:04:03Z",
  "2026-09-21T16:59:45Z",
  "2026-09-21T16:54:12Z",
  "2026-09-21T10:59:10Z",
  "2026-09-21T10:54:34Z",
  "2026-09-21T10:49:10Z",
  "2026-09-21T10:44:34Z",
  "2026-09-21T10:38:58Z",
  "2026-09-21T04:44:49Z",
  "2026-09-21T04:39:22Z",
  "2026-09-21T04:34:11Z",
  "2026-09-21T04:19:55Z",
  "2026-09-20T22:24:04Z",
  "2026-09-20T22:19:28Z",
  "2026-09-20T22:14:05Z",
  "2026-09-20T22:09:45Z",
  "2026-09-20T15:58:57Z",
  "2026-09-20T15:54:09Z",
  "2026-09-20T15:48:57Z",
  "2026-09-20T15:44:45Z",
  "2026-09-20T15:39:21Z",
  "2026-09-20T09:44:42Z",
  "2026-09-20T09:39:18Z",
  "2026-09-20T09:34:56Z",
  "2026-09-20T09:29:24Z",
  "2026-09-20T03:34:30Z",
  "2026-09-20T03:28:54Z",
  "2026-09-20T03:24:26Z",
  "2026-09-20T03:19:53Z",
  "2026-09-19T21:09:09Z",
  "2026-09-19T21:04:53Z",
  "2026-09-19T20:59:51Z",
  "2026-09-19T20:54:19Z",
  "2026-09-19T14:58:53Z",
  "2026-09-19T14:54:41Z",
  "2026-09-19T14:49:17Z",
  "2026-09-19T14:44:41Z",
  "2026-09-19T08:48:57Z",
  "2026-09-19T08:44:21Z",
  "2026-09-19T08:38:57Z",
  "2026-09-19T08:34:57Z",
  "2026-09-19T02:38:55Z",
  "2026-09-19T02:34:43Z",
  "2026-09-19T02:28:52Z",
  "2026-09-19T02:24:18Z",
  "2026-09-18T20:14:07Z",
  "2026-09-18T20:09:43Z",
  "2026-09-18T20:04:26Z",
  "2026-09-18T19:59:51Z",
  "2026-09-18T14:09:08Z",
  "2026-09-18T14:04:56Z",
  "2026-09-18T13:59:31Z",
  "2026-09-18T14:29:31Z",
  "2026-09-18T08:38:54Z",
  "2026-09-18T08:34:11Z",
  "2026-09-18T08:29:57Z",
  "2026-09-18T08:23:57Z",
  "2026-09-18T02:29:06Z",
  "2026-09-18T02:24:52Z",
  "2026-09-18T02:19:16Z",
  "2026-09-18T02:14:41Z",
  "2026-09-17T19:54:52Z",
  "2026-09-17T19:49:24Z",
  "2026-09-17T19:43:52Z",
  "2026-09-17T19:39:16Z",
  "2026-09-17T13:44:07Z",
  "2026-09-17T13:38:55Z",
  "2026-09-17T13:34:55Z",
  "2026-09-17T13:29:34Z",
  "2026-09-17T07:34:41Z",
  "2026-09-17T07:29:17Z",
  "2026-09-17T07:24:51Z",
  "2026-09-17T07:19:19Z",
  "2026-09-17T01:39:31Z",
  "2026-09-17T01:34:07Z",
  "2026-09-17T01:29:34Z",
  "2026-09-17T01:23:55Z",
  "2026-09-16T21:21:42Z",
  "2026-09-16T21:20:42Z",
  "2026-09-16T21:19:30Z",
  "2026-09-16T18:26:56Z",
  "2026-09-16T18:24:44Z",
  "2026-09-16T18:22:35Z",
  "2026-09-16T18:19:11Z",
  "2026-09-16T12:44:06Z",
  "2026-09-16T12:39:19Z",
  "2026-09-16T12:34:06Z",
  "2026-09-16T12:29:46Z",
  "2026-09-16T07:06:11Z",
  "2026-09-16T07:04:56Z",
  "2026-09-16T07:02:44Z",
  "2026-09-16T02:29:05Z",
  "2026-09-16T02:24:43Z",
  "2026-09-16T02:19:17Z",
  "2026-09-16T02:14:53Z",
  "2026-09-15T20:09:06Z",
  "2026-09-15T20:04:36Z",
  "2026-09-15T19:59:05Z",
  "2026-09-15T19:54:53Z",
  "2026-09-15T16:16:48Z",
  "2026-09-15T16:15:36Z",
  "2026-09-15T16:14:36Z",
  "2026-09-15T12:07:11Z",
  "2026-09-15T12:04:59Z",
  "2026-09-15T12:02:47Z",
  "2026-09-15T11:59:34Z",
  "2026-09-15T08:13:48Z",
  "2026-09-15T08:09:14Z",
  "2026-09-15T08:04:53Z",
  "2026-09-15T07:59:00Z",
  "2026-09-15T02:04:52Z",
  "2026-09-15T01:59:22Z",
  "2026-09-15T01:53:58Z",
  "2026-09-15T01:49:10Z",
  "2026-09-15T01:44:34Z",
  "2026-09-08T16:06:34Z",
  "2026-09-08T15:43:17Z",
  "2026-09-08T15:35:05Z",
  "2026-09-08T15:32:53Z"
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round2(value) {
  return Math.round((value / 3.6) * 100) / 100;
}

async function updateWithRetry(entity, id, data) {
  let lastError;

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await entity.update(id, data);
    } catch (error) {
      lastError = error;
      const status =
        error?.status ??
        error?.response?.status ??
        Number(String(error?.message ?? "").match(/\b(429|5\d\d)\b/)?.[1]);

      if (attempt === 5 || !(status === 429 || (status >= 500 && status <= 599))) {
        throw error;
      }

      const delay = attempt * 5000;
      console.warn(`⚠ Retry ${attempt}/5 dopo ${delay / 1000}s`);
      await sleep(delay);
    }
  }

  throw lastError;
}

async function main() {
  if (!BASE44_APP_ID || !COLLECTOR_EMAIL || !COLLECTOR_PASSWORD) {
    throw new Error("Missing Base44 credentials");
  }

  const base44 = createClient({ appId: BASE44_APP_ID });
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL, COLLECTOR_PASSWORD);

  const entity = base44.entities.WeatherReading;
  const rows = await entity.list("-timestamp", 10000);

  const targets = (rows ?? []).filter((row) => FAILED_TIMESTAMPS.has(row.timestamp));

  console.log(`• Timestamp falliti unici: ${FAILED_TIMESTAMPS.size}`);
  console.log(`• Record trovati da correggere: ${targets.length}`);

  let updated = 0;
  let failures = 0;

  for (const row of targets) {
    const changes = {};

    if (typeof row.wind_speed === "number" && Number.isFinite(row.wind_speed)) {
      changes.wind_speed = round2(row.wind_speed);
    }

    if (typeof row.wind_gust === "number" && Number.isFinite(row.wind_gust)) {
      changes.wind_gust = round2(row.wind_gust);
    }

    if (!Object.keys(changes).length) continue;

    try {
      await updateWithRetry(entity, row.id, changes);
      updated++;
      if (updated % 25 === 0) {
        console.log(`✓ ${updated}/${targets.length} record vento recuperati`);
      }
    } catch (error) {
      failures++;
      console.error(`✗ ${row.timestamp}: ${error.message}`);
    }

    // Molto più lento della prima migrazione per evitare il rate limit.
    await sleep(750);
  }

  console.log(`✓ Retry vento concluso: ${updated} aggiornati, ${failures} errori`);

  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("✗ Retry vento fallito:", error.message);
  process.exit(1);
});
