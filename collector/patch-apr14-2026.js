import { createClient } from "@base44/sdk";

const APP=process.env.BASE44_APP_ID;
const EMAIL=process.env.COLLECTOR_EMAIL;
const PASS=process.env.COLLECTOR_PASSWORD;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const rows=[
  {
    timestamp:"2026-04-14T04:00:00.000Z",
    temperature:11.4,
    temperature_high:11.4,
    temperature_low:11.4,
    humidity:99,
    pressure:1019.64,
    wind_speed:0,
    wind_direction:null,
    rainfall:0,
    rain_rate:0,
    wind_gust:0,
    uv_index:0,
    solar_radiation:null
  },
  {
    timestamp:"2026-04-14T13:00:00.000Z",
    temperature:20.1,
    temperature_high:20.1,
    temperature_low:20.1,
    humidity:65,
    pressure:1010.16,
    wind_speed:8.2,
    wind_direction:null,
    rainfall:1.27,
    rain_rate:3.0,
    wind_gust:9.5,
    uv_index:9,
    solar_radiation:null
  }
];

function statusOf(e){
  return e?.status??e?.response?.status??Number(String(e?.message??"").match(/\b(403|429|5\d\d)\b/)?.[1])??null;
}

async function retry(fn,label){
  for(let a=1;a<=5;a++){
    try{return await fn();}
    catch(e){
      const s=statusOf(e);
      if(a===5 || !(s===403||s===429||(s>=500&&s<=599))) throw e;
      const wait=a*5000;
      console.warn(`⚠ ${label}: ${e.message}; retry tra ${wait/1000}s`);
      await sleep(wait);
    }
  }
}

async function main(){
  if(!APP||!EMAIL||!PASS) throw new Error("Credenziali Base44 mancanti");
  const b=createClient({appId:APP});
  await retry(()=>b.auth.loginViaEmailPassword(EMAIL,PASS),"login Base44");
  const e=b.entities.WeatherReading;
  const existing=await retry(()=>e.list("-timestamp",10000),"lettura Base44");
  const map=new Map((existing??[]).filter(x=>x.timestamp).map(x=>[x.timestamp,x]));
  let created=0,updated=0;
  for(const p of rows){
    const old=map.get(p.timestamp);
    if(old){
      await retry(()=>e.update(old.id,p),`update ${p.timestamp}`);
      updated++;
    }else{
      await retry(()=>e.create(p),`create ${p.timestamp}`);
      created++;
    }
  }
  console.log(`✓ 14 aprile 2026 completato: ${created} create, ${updated} aggiornate`);
  console.log("✓ Pioggia 1.27 mm => giorno piovoso");
  console.log("✓ Luce max 99568 lux conservata nell'audit, non scritta in solar_radiation");
}
main().catch(e=>{console.error("✗ Import 14 aprile fallito:",e.message);process.exit(1);});
