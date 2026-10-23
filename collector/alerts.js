import { createClient } from "@base44/sdk";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// CFR Toscana Alert Collector — GitHub Actions (Node 20).
// Scarica il BOLLETTINO DI VALUTAZIONE DELLE CRITICITÀ del Centro FunzIONALE
// Regionale Toscana (sorgente ufficiale), estrae emission, scenari ufficiali
// (zona/rischio/tempi/livello) e descrizioni, e salva in Base44 (entity
// CfrAlert) SOLO se l'emissione non è già presente. Nessuna credenziale
// hardcoded. Nessun livello ricalcolato: quelli del bollettino.
// ---------------------------------------------------------------------------

const SOURCE_URL = "https://www.cfr.toscana.it/index.php?IDS=20&IDSS=76";
const BULLETIN_URL = "https://www.regione.toscana.it/allertameteo";
const SOURCE_NAME = "Centro Funzionale Regionale Toscana";
const SOURCE_PAGE = "https://www.cfr.toscana.it/index.php?IDS=20&IDSS=76";

// Zone di allerta da monitorare (CSV via env; default: S2 = Serchio-Lucca)
const ZONES = (process.env.ALERT_ZONES || "S2")
  .split(",")
  .map((z) => z.trim().toUpperCase())
  .filter(Boolean);

const ZONE_NAMES = {
  A1: "Arno-Casentino",
  A2: "Arno-Valdarno Sup.",
  A3: "Arno-Firenze",
  A4: "Valdarno Inf.",
  A5: "Valdelsa-Valdera",
  A6: "Arno-Costa",
  B: "Bisenzio e Ombr. Pt",
  C: "Valdichiana",
  E1: "Etruria",
  E2: "Etruria-Costa Nord",
  E3: "Etruria-Costa Sud",
  F1: "Fiora e Alb.",
  F2: "Fiora e Alb.-Costa e G",
  I: "Isole",
  L: "Lunigiana",
  M: "Mugello-Val di Sieve",
  O1: "Ombr. Gr-Alto",
  O2: "Ombr. Gr-Medio",
  O3: "Ombr. Gr-Costa",
  R1: "Reno",
  R2: "Romagna-Toscana",
  S1: "Serchio-Garf.-Lima",
  S2: "Serchio-Lucca",
  S3: "Serchio-Costa",
  T: "Valtiberina",
  V: "Versilia",
};

const MONTHS_IT = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// ── Europe/Rome: ora locale → epoch UTC e ISO con offset corretto (CET/CEST) ─

function romeOffsetMin(ts) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const o = {};
  for (const p of dtf.formatToParts(ts)) o[p.type] = p.value;

  const asUTC = Date.UTC(
    Number(o.year),
    Number(o.month) - 1,
    Number(o.day),
    Number(o.hour) % 24,
    Number(o.minute)
  );

  return Math.round((asUTC - ts) / 60000);
}

export function romeTs(y, mo, d, h, mi) {
  let ts = Date.UTC(y, mo - 1, d, h, mi);

  for (let i = 0; i < 2; i++) {
    ts =
      Date.UTC(y, mo - 1, d, h, mi) -
      romeOffsetMin(ts) * 60000;
  }

  return ts;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function romeISO(ts, y, mo, d, h, mi) {
  const off = romeOffsetMin(ts);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);

  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${sign}${pad(
    Math.floor(a / 60)
  )}:${pad(a % 60)}`;
}

function rome(y, mo, d, h, mi) {
  const ts = romeTs(y, mo, d, h, mi);
  const off = romeOffsetMin(ts);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);

  return {
    iso: `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${sign}${pad(
      Math.floor(a / 60)
    )}:${pad(a % 60)}`,
    ts,
  };
}

// ── Mapping rischio ufficiale → categorie gestite ─

export function riskCategoriesForLabel(label) {
  const l = String(label || "")
    .toUpperCase()
    .replace(/\s+/g, " ");

  const out = [];

  if (l.includes("TEMPORALI")) out.push("temporali");
  if (l.includes("IDROGEOLOGICO")) out.push("idrogeologico");

  if (l.includes("IDRAULICO")) {
    if (l.includes("RETICOLO PRINCIPALE")) {
      out.push("idraulico");
    } else if (!l.includes("IDROGEOLOGICO")) {
      out.push("idrogeologico");
    }
  }

  if (l.includes("VENTO")) out.push("vento");
  if (l.includes("MAREGGIATE")) out.push("mareggiate");
  if (l.includes("NEVE")) out.push("neve");
  if (l.includes("GHIACCIO")) out.push("ghiaccio");

  return out;
}

// ── Parsing del bollettino ─

export function parseBulletin(html) {
  if (!html || typeof html !== "string") return null;

  // Emissione: "Emissione di <b>Venerdì, 23 Ottobre 2026</b>, ore <b>12.30</b>"
  const em = html.match(
    /Emissione di <b>([^<]+)<\/b>,\s*ore <b>(\d{1,2})[.,](\d{2})<\/b>/
  );

  if (!em) return null;

  const dm = em[1].match(
    /(\d{1,2})\s+([A-Za-zÀ-ù]+)\s+(\d{4})/
  );

  if (!dm) return null;

  const month = MONTHS_IT[dm[2].toLowerCase()];
  if (!month) return null;

  const emission = rome(
    Number(dm[3]),
    month,
    Number(dm[1]),
    Number(em[2]),
    Number(em[3])
  );

  const emissionLabel = `Emissione di ${em[1]}, ore ${em[2]}.${em[3]}`;

  // Tabella scenari
  const risksIdx = html.indexOf('<div id="Risks"');
  if (risksIdx < 0) return null;

  const risksHtml = html.slice(risksIdx);
  const tableEnd = risksHtml.indexOf("</table>");

  if (tableEnd < 0) return null;

  const tableHtml = risksHtml.slice(0, tableEnd + 8);

  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;

  let tr;

  while ((tr = trRe.exec(tableHtml))) {
    if (tr[1].includes("<th")) continue;

    const tds = [
      ...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g),
    ].map((t) => t[1]);

    if (tds.length < 4) continue;

    const levelRaw = stripTags(tds[3]).toUpperCase();

    const level = levelRaw.includes("ARANCIONE")
      ? "ARANCIONE"
      : levelRaw.includes("ROSSO")
      ? "ROSSO"
      : levelRaw.includes("GIALLO")
      ? "GIALLO"
      : null;

    if (!level) continue;

    const risk = stripTags(tds[1]).toUpperCase();
    if (!risk) continue;

    const zoneTokens = stripTags(tds[0])
      .split(/[\s,\/]+/)
      .filter((t) => /^[A-Z]\d?$/.test(t));

    if (zoneTokens.length === 0) continue;

    // Tempi:
    // "dalle ore 17.00 di Venerdì, 23 Ottobre 2026
    //  alle ore 23.59 di Venerdì, 23 Ottobre 2026"

    const tm = stripTags(tds[2]).match(
      /dalle ore (\d{1,2})[.,](\d{2})\s*di\s*(?:[A-Za-zÀ-ù]+,\s*)?(\d{1,2})\s*([A-Za-zÀ-ù]+)\s*(\d{4})\s*alle ore (\d{1,2})[.,](\d{2})\s*di\s*(?:[A-Za-zÀ-ù]+,\s*)?(\d{1,2})\s*([A-Za-zÀ-ù]+)\s*(\d{4})/i
    );

    if (!tm) continue;

    const mFrom = MONTHS_IT[tm[4].toLowerCase()];
    const mTo = MONTHS_IT[tm[9].toLowerCase()];

    if (!mFrom || !mTo) continue;

    const from = rome(
      Number(tm[5]),
      mFrom,
      Number(tm[3]),
      Number(tm[1]),
      Number(tm[2])
    );

    const to = rome(
      Number(tm[10]),
      mTo,
      Number(tm[8]),
      Number(tm[6]),
      Number(tm[7])
    );

    rows.push({
      zoneTokens,
      risk,
      level,
      valid_from: from.iso,
      valid_from_ts: from.ts,
      valid_to: to.iso,
      valid_to_ts: to.ts,
    });
  }

  // Descrizioni ufficiali degli scenari
  const descriptions = {};
  const descIdx = html.indexOf("DESCRIZIONE DEGLI SCENARI");

  if (descIdx >= 0) {
    const descHtml = html.slice(descIdx);

    const blockRe =
      /<b>([^<]{4,160})<\/b>\s*<br\s*\/?>\s*<div align="justify">/g;

    const starts = [...descHtml.matchAll(blockRe)];

    starts.forEach((s, i) => {
      const from = s.index + s[0].length;

      let to =
        i + 1 < starts.length
          ? starts[i + 1].index
          : descHtml.length;

      const imgCut = descHtml.indexOf("<img src=", from);

      if (imgCut >= 0 && imgCut < to) {
        to = imgCut;
      }

      const riskCut = descHtml.indexOf("<b>RISCHIO ", from);

      if (riskCut >= 0 && riskCut < to) {
        to = riskCut;
      }

      const blockHtml = descHtml.slice(from, to);

      const critRe =
        /<b>Criticità\s+(Giallo|Arancione|Rosso):<\/b>/gi;

      const hits = [...blockHtml.matchAll(critRe)];

      hits.forEach((h, j) => {
        const cFrom = h.index + h[0].length;

        const cTo =
          j + 1 < hits.length
            ? hits[j + 1].index
            : blockHtml.length;

        const text = stripTags(
          blockHtml.slice(cFrom, cTo)
        ).trim();

        if (text) {
          descriptions[
            `${stripTags(s[1]).toUpperCase()}|${h[1].toUpperCase()}`
          ] = text;
        }
      });
    });
  }

  return {
    emissionKey: emission.iso,
    emission: emission.iso,
    emissionTs: emission.ts,
    emissionLabel,
    rows,
    descriptions,
  };
}

// ── Record per Base44 ─

export function buildRecords(parsed, zones, fetchedAt) {
  const meta = {
    kind: "emission",
    emission_key: parsed.emissionKey,
    emission: parsed.emission,
    emission_ts: parsed.emissionTs,
    emission_label: parsed.emissionLabel,
    fetched_at: fetchedAt,
    source_url: SOURCE_URL,
    bulletin_url: BULLETIN_URL,
  };

  const alerts = [];

  for (const row of parsed.rows) {
    for (const z of zones) {
      if (!row.zoneTokens.includes(z)) continue;

      alerts.push({
        kind: "alert",
        emission_key: parsed.emissionKey,
        emission: parsed.emission,
        emission_ts: parsed.emissionTs,
        emission_label: parsed.emissionLabel,
        fetched_at: fetchedAt,
        source_url: SOURCE_URL,
        bulletin_url: BULLETIN_URL,
        zone_code: z,
        zone_name: ZONE_NAMES[z] || z,
        risk_label: row.risk,
        risk_categories: riskCategoriesForLabel(row.risk).join(";"),
        level: row.level,
        valid_from: row.valid_from,
        valid_from_ts: row.valid_from_ts,
        valid_to: row.valid_to,
        valid_to_ts: row.valid_to_ts,
        description:
          parsed.descriptions[
            `${row.risk}|${row.level}`
          ] || "",
      });
    }
  }

  return { meta, alerts };
}

async function fetchSource() {
  const resp = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "LuccaMeteo-Collector/1.0",
    },
  });

  if (!resp.ok) {
    throw new Error(
      `CFR HTTP ${resp.status} ${resp.statusText}`
    );
  }

  return resp.text();
}

async function main() {
  const BASE44_APP_ID = process.env.BASE44_APP_ID;
  const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
  const COLLECTOR_PASSWORD =
    process.env.COLLECTOR_PASSWORD;

  if (!BASE44_APP_ID) {
    return fail("Secret BASE44_APP_ID mancante");
  }

  if (!COLLECTOR_EMAIL || !COLLECTOR_PASSWORD) {
    return fail(
      "Secret COLLECTOR_EMAIL / COLLECTOR_PASSWORD mancanti"
    );
  }

  // 1) Sorgente ufficiale
  let html;

  try {
    html = await fetchSource();

    console.log(
      `✓ Bollettino CFR scaricato (${html.length} byte) — ${SOURCE_NAME}`
    );
  } catch (e) {
    return fail(
      `Sorgente ufficiale non raggiungibile: ${e.message}`
    );
  }

  // 2) Parsing
  const parsed = parseBulletin(html);

  if (!parsed) {
    return fail(
      "Struttura del bollettino CFR non riconosciuta: nessuna scrittura"
    );
  }

  console.log(
    `✓ Emissione: ${parsed.emissionLabel} — scenari: ${parsed.rows.length}`
  );

  // 3) Base44
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

  const existing =
    await base44.entities.CfrAlert.filter(
      {
        emission_key: parsed.emissionKey,
      },
      {
        limit: 1,
      }
    );

  if ((existing.items ?? existing ?? []).length > 0) {
    console.log(
      `• Emissione già presente (${parsed.emissionKey}) — nessuna duplicazione.`
    );
    return;
  }

  const { meta, alerts } = buildRecords(
    parsed,
    ZONES,
    new Date().toISOString()
  );

  const toCreate = [meta, ...alerts];

  try {
    await base44.entities.CfrAlert.bulkCreate(
      toCreate
    );

    console.log(
      `✓ Salvati ${toCreate.length} record (1 meta + ${alerts.length} scenari zone: ${ZONES.join(
        ", "
      )}).`
    );
  } catch (e) {
    return fail(
      `Errore Base44 create: ${e.message}`
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(process.argv[1]).href
) {
  main().catch((e) =>
    fail(`Errore imprevisto: ${e.message}`)
  );
}
