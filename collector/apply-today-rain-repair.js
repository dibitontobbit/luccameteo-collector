import { createClient } from "@base44/sdk";

const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

const fixes = [
  { id:"6af13177562e1fd8e07d38fc", timestamp:"2026-11-09T02:35:17Z" },
  { id:"6af137541b19e1602b028b04", timestamp:"2026-11-09T03:00:06Z" },
  { id:"6af13881416babe4d8f35099", timestamp:"2026-11-09T03:04:42Z" }
];

function italyDayKey(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Rome", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(new Date(timestamp));
  const v=Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}

async function main(){
  const base44=createClient({appId:BASE44_APP_ID});
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL,COLLECTOR_PASSWORD);

  for(const f of fixes){
    await base44.entities.WeatherReading.update(f.id,{rainfall:0});
    console.log("ZEROED",f.timestamp,f.id);
  }

  const rows=await base44.entities.WeatherReading.list("-timestamp",1000);
  let sum=0;
  for(const r of rows??[]){
    if(!r?.timestamp || italyDayKey(r.timestamp)!=="2026-11-09") continue;
    const rain=n(r.rainfall);
    if(rain!=null) sum+=rain;
  }
  console.log("TODAY_RAW_RAIN_TOTAL="+Math.round(sum*100)/100);
}
main().catch(e=>{console.error(e);process.exit(1);});
