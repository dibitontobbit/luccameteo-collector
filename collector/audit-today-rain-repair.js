import { createClient } from "@base44/sdk";

const STATION_ID = process.env.STATION_ID || "ILUCCA95";
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const BASE44_APP_ID = process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL = process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD = process.env.COLLECTOR_PASSWORD;

function italyDayKey(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const v = Object.fromEntries(parts.filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function hasTemp(obs){ const m=obs?.metric??{}; return [m.tempAvg,m.tempHigh,m.tempLow,m.temp].some(v=>n(v)!=null); }

function derive(observations){
  const sorted=[...observations].filter(o=>o?.obsTimeUtc && hasTemp(o))
    .sort((a,b)=>new Date(a.obsTimeUtc)-new Date(b.obsTimeUtc));
  const out=new Map(); let day=null,max=null;
  for(const o of sorted){
    const ts=o.obsTimeUtc,total=n(o?.metric?.precipTotal),d=italyDayKey(ts); let inc=null;
    if(total!=null){
      if(day==null){ day=d; max=total; inc=0; }
      else if(d!==day){ day=d; max=total; inc=total>0?Math.round(total*100)/100:0; }
      else if(max==null){ max=total; inc=0; }
      else if(total>max){ inc=Math.round((total-max)*100)/100; max=total; }
      else inc=0;
    }
    out.set(ts,inc);
  }
  return out;
}

async function main(){
  const url="https://api.weather.com/v2/pws/observations/all/1day?stationId="+encodeURIComponent(STATION_ID)+
    "&format=json&units=m&numericPrecision=decimal&apiKey="+encodeURIComponent(WEATHER_API_KEY);
  const resp=await fetch(url);
  if(!resp.ok) throw new Error("TWC "+resp.status+" "+(await resp.text()).slice(0,300));
  const json=await resp.json();
  const obs=json?.observations??[];
  const expected=derive(obs);

  const base44=createClient({appId:BASE44_APP_ID});
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL,COLLECTOR_PASSWORD);
  const rows=await base44.entities.WeatherReading.list("-timestamp",1000);

  const today=(rows??[]).filter(r=>r?.timestamp && italyDayKey(r.timestamp)==="2026-11-09");
  const mismatches=[];
  let currentSum=0,expectedSum=0;
  for(const r of today){
    const current=n(r.rainfall)??0;
    currentSum+=current;
    const exp=expected.has(r.timestamp)?(expected.get(r.timestamp)??0):null;
    if(exp!=null) expectedSum+=exp;
    if(exp!=null && Math.abs(current-exp)>0.001){
      mismatches.push({id:r.id,timestamp:r.timestamp,current,expected:exp});
    }
  }
  const positives=today.filter(r=>(n(r.rainfall)??0)>0).map(r=>({
    id:r.id,timestamp:r.timestamp,rainfall:n(r.rainfall),
    apiExpected:expected.has(r.timestamp)?(expected.get(r.timestamp)??0):null
  })).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  console.log("TODAY_RAIN_REPAIR_AUDIT="+JSON.stringify({
    currentSum:Math.round(currentSum*100)/100,
    expectedSum:Math.round(expectedSum*100)/100,
    mismatches,
    positives
  }));
}
main().catch(e=>{console.error(e);process.exit(1);});
