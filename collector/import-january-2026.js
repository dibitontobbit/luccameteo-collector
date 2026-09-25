import { createClient } from "@base44/sdk";
import fs from "node:fs";

const APP=process.env.BASE44_APP_ID, EMAIL=process.env.COLLECTOR_EMAIL, PASS=process.env.COLLECTOR_PASSWORD;
const rows=JSON.parse(fs.readFileSync("../imports/history/january-2026.json","utf8"));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function ts(date,h){return `${date}T${String(h-1).padStart(2,"0")}:00:00.000Z`;}
function payload(r,phase){
  const min=phase==="min";
  return {
    timestamp:ts(r.date,min?6:15),
    temperature:min?r.temperature_low:r.temperature_high,
    temperature_high:min?r.temperature_low:r.temperature_high,
    temperature_low:min?r.temperature_low:r.temperature_high,
    humidity:min?r.humidity_high:r.humidity_low,
    pressure:min?r.pressure_high:r.pressure_low,
    wind_speed:min?0:r.wind_max,
    wind_direction:null,
    rainfall:min?0:r.rainfall,
    rain_rate:min?0:r.rain_rate_max,
    wind_gust:min?0:r.wind_gust_max,
    uv_index:min?0:r.uv_max,
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
  const b=createClient({appId:APP});
  await b.auth.loginViaEmailPassword(EMAIL,PASS);
  const e=b.entities.WeatherReading;
  const existing=await e.list("-timestamp",10000);
  const map=new Map((existing??[]).filter(x=>x.timestamp).map(x=>[x.timestamp,x]));
  let created=0,updated=0;
  for(const r of rows){
    for(const phase of ["min","max"]){
      const p=payload(r,phase),old=map.get(p.timestamp);
      await write(e,old,p);
      old?updated++:created++;
      await sleep(700);
    }
  }
  const total=rows.reduce((s,r)=>s+(r.rainfall??0),0);
  const rainy=rows.filter(r=>(r.rainfall??0)>=1).length;
  console.log(`✓ Gennaio 2026 completato: ${created} create, ${updated} aggiornate`);
  console.log(`✓ Pioggia totale Excel: ${total.toFixed(2)} mm`);
  console.log(`✓ Giorni pioggia >=1 mm: ${rainy}`);
  console.log("✓ Light Max preservata nel JSON GitHub in lux");
}
main().catch(e=>{console.error("✗ Import gennaio 2026 fallito:",e.message);process.exit(1);});