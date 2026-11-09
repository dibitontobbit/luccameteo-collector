import { createClient } from "@base44/sdk";

const STATION_ID = process.env.STATION_ID || "ILUCCA95";
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

function italyDayKey(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }

async function main() {
  const url =
    "https://api.weather.com/v2/pws/history/daily" +
    "?stationId=" + encodeURIComponent(STATION_ID) +
    "&format=json&units=m&numericPrecision=decimal" +
    "&startDate=20261001&endDate=20261031" +
    "&apiKey=" + encodeURIComponent(WEATHER_API_KEY);

  const resp = await fetch(url);
  if (!resp.ok) throw new Error("TWC history HTTP " + resp.status + " " + (await resp.text()).slice(0,300));
  const twc = await resp.json();

  const official = new Map();
  for (const obs of twc?.observations ?? []) {
    const day = obs.obsTimeLocal ? String(obs.obsTimeLocal).slice(0,10) : italyDayKey(obs.obsTimeUtc);
    const total = n(obs?.metric?.precipTotal);
    if (total != null) official.set(day,total);
  }

  const base44 = createClient({appId:BASE44_APP_ID});
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL,COLLECTOR_PASSWORD);
  const rows = await base44.entities.WeatherReading.list("-timestamp",15000);
  console.log("WEATHERREADING_RANGE=" + JSON.stringify({count:(rows??[]).length,newest:rows?.[0]?.timestamp??null,oldest:rows?.[(rows?.length??1)-1]?.timestamp??null}));
  const saved = new Map();
  for(const row of rows??[]){
    if(!row?.timestamp) continue;
    const day=italyDayKey(row.timestamp);
    if(day<"2026-10-01"||day>"2026-10-31") continue;
    const rain=n(row.rainfall);
    if(rain==null||rain<=0) continue;
    saved.set(day,(saved.get(day)??0)+rain);
  }

  const corrections = await base44.entities.RainfallCorrection.list("-date",500);
  const corr = new Map((corrections??[]).filter(x=>x?.date?.startsWith("2026-10-")).map(x=>[x.date,n(x.rainfall_mm)]));

  const days = Array.from(new Set([...official.keys(),...saved.keys(),...corr.keys()])).sort();
  const result = days.map(day=>({
    day,
    official_twc_mm: official.has(day)?Math.round(official.get(day)*100)/100:null,
    base44_raw_sum_mm: Math.round((saved.get(day)??0)*100)/100,
    correction_mm: corr.has(day)?Math.round(corr.get(day)*100)/100:null,
    effective_mm: corr.has(day)?Math.round(corr.get(day)*100)/100:Math.round((saved.get(day)??0)*100)/100,
    diff_effective_vs_twc_mm: official.has(day)?Math.round(((corr.has(day)?corr.get(day):(saved.get(day)??0))-official.get(day))*100)/100:null
  }));

  console.log("OCTOBER_RAIN_AUDIT="+JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exit(1);});
