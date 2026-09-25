import { createClient } from "@base44/sdk";

const APP=process.env.BASE44_APP_ID;
const EMAIL=process.env.COLLECTOR_EMAIL;
const PASS=process.env.COLLECTOR_PASSWORD;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const rows=[
  {
    timestamp:"2026-08-20T04:00:00.000Z",
    temperature:21.0,
    temperature_high:21.0,
    temperature_low:21.0,
    humidity:99,
    pressure:1013.85,
    wind_speed:null,
    wind_direction:null,
    rainfall:0,
    rain_rate:0,
    wind_gust:null,
    uv_index:null,
    solar_radiation:null
  },
  {
    timestamp:"2026-08-20T13:00:00.000Z",
    temperature:34.5,
    temperature_high:34.5,
    temperature_low:34.5,
    humidity:47,
    pressure:1010.84,
    wind_speed:null,
    wind_direction:null,
    rainfall:23.09,
    rain_rate:22.81,
    wind_gust:null,
    uv_index:null,
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
      await sleep(a*5000);
    }
  }
}
async function main(){
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
  console.log(`✓ 20 agosto 2026 completato: ${created} create, ${updated} aggiornate`);
  console.log("✓ Pioggia 23.09 mm => giorno piovoso");
  console.log("• Vento, raffica, UV e lux lasciati null: dati Excel non ancora disponibili.");
}
main().catch(e=>{console.error("✗ Import 20 agosto fallito:",e.message);process.exit(1);});
