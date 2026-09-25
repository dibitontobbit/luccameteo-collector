import { createClient } from "@base44/sdk";

const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

const START = new Date("2026-09-01T00:00:00Z").getTime();
const CUTOFF = new Date("2026-09-25T18:50:00Z").getTime();
const PAGE_SIZE = 500;
const PRESSURE_OFFSET = 12;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round2(value) {
  return Math.round((value + PRESSURE_OFFSET) * 100) / 100;
}

function isInRange(timestamp) {
  const t = new Date(timestamp).getTime();
  return Number.isFinite(t) && t >= START && t < CUTOFF;
}

async function updateWithRetry(entity, id, data) {
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await entity.update(id, data);
    } catch (error) {
      lastError = error;
      const status =
        error?.status ??
        error?.response?.status ??
        Number(String(error?.message ?? "").match(/\b(429|5\d\d)\b/)?.[1]);

      if (attempt === 4 || !(status === 429 || (status >= 500 && status <= 599))) {
        throw error;
      }

      await sleep(attempt * 1500);
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

  let skip = 0;
  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let failures = 0;

  while (true) {
    const rows = await entity.list("-timestamp", PAGE_SIZE, skip);

    if (!rows?.length) break;

    scanned += rows.length;

    const targets = rows.filter((row) => isInRange(row.timestamp));

    for (const row of targets) {
      if (typeof row.pressure !== "number" || !Number.isFinite(row.pressure)) {
        continue;
      }

      matched++;

      try {
        await updateWithRetry(entity, row.id, {
          pressure: round2(row.pressure),
        });
        updated++;

        if (updated % 100 === 0) {
          console.log(`✓ ${updated} letture pressione corrette`);
        }
      } catch (error) {
        failures++;
        console.error(`✗ ${row.timestamp}: ${error.message}`);
      }

      await sleep(40);
    }

    const oldest = rows[rows.length - 1];
    if (oldest?.timestamp && new Date(oldest.timestamp).getTime() < START) break;

    if (rows.length < PAGE_SIZE) break;
    skip += rows.length;
  }

  console.log(
    `✓ Migrazione pressione conclusa. Scansionate ${scanned}, candidate ${matched}, aggiornate ${updated}, errori ${failures}`
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("✗ Migrazione pressione fallita:", error.message);
  process.exit(1);
});
