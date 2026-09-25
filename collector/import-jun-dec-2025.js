import { createClient } from "@base44/sdk";
import fs from "node:fs";

const APP=process.env.BASE44_APP_ID, EMAIL=process.env.COLLECTOR_EMAIL, PASS=process.env.COLLECTOR_PASSWORD;
const data=JSON.parse(fs.readFileSync("../imports/history/jun-dec-2025.json","utf8"));
const rows=Object.values(data).flat();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function utcOffset(date){
  const m=Number(date.slice(5,7)), d=Number(date.slice(8,10));
  if(m<3||m>10) return 1;
  if(m>3&&m<10) return 2;
  if(m===3) return d>=30?2:1;
  return d>=26?1:2;
}
function ts(date,h){return `${date}T${String(h-utcOffset(date)).padStart(2,"0")}:00:00.000Z`;}
function payload(r,phase){
  const [date,tMax,tMin,rain,rainRate,humMax,humMin,windMax,gustMax,lightMax,uvMax,pHigh,pLow]=r;
  const min=phase==="min";
  return {
    timestamp:ts(date,min?6:15),
    temperature:min?tMin:tMax,
    temperature_high:min?tMin:tMax,
    temperature_low:min?tMin:tMax,
    humidity:min?humMax:humMin,
    pressure:min?pHigh:pLow,
    wind_speed:min?0:windMax,
    wind_direction:null,
    rainfall:min?0:rain,
    rain_rate:min?0:rainRate,
    wind_gust:min?0:gustMax,
    uv_index:min?0:uvMax,
    solar_radiation:null
  };
}
async function write(entity,old,p){
  for(let a=1;a<=5;a++){
    try{return old?await entity.update(old.id,p):await entity.create(p);}
    catch(e){
      const s=e?.status??e?.response?.status??Number(String(e?.message??"").match(/\b(429|5\d\d)\b/)?.[1]);
      if(a===5||!(s===429||(s>=500&&s<=599))) throw e;
      await sleep(a*5000);
    }
  }
}
async function main(){
  if(!APP||!EMAIL||!PASS) throw new Error("Missing Base44 credentials");
  const b=createClient({appId:APP});
  await b.auth.loginViaEmailPassword(EMAIL,PASS);
  const e=b.entities.WeatherReading;
  const existing=await e.list("-timestamp",10000);
  const map=new Map((existing??[]).filter(x=>x.timestamp).map(x=>[x.timestamp,x]));
  let created=0,updated=0;
  for(const r of rows){
    for(const phase of ["min","max"]){
      const p=payload(r,phase), old=map.get(p.timestamp);
      await write(e,old,p);
      old?updated++:created++;
      await sleep(700);
    }
  }
  console.log(`✓ Giugno-dicembre 2025 completato: ${created} create, ${updated} aggiornate, ${rows.length} giorni`);
}
main().catch(e=>{console.error("✗ Import giugno-dicembre 2025 fallito:",e.message);process.exit(1);});