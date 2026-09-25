import fs from "node:fs";
import { createClient } from "@base44/sdk";
const BASE44_APP_ID=process.env.BASE44_APP_ID,COLLECTOR_EMAIL=process.env.COLLECTOR_EMAIL,COLLECTOR_PASSWORD=process.env.COLLECTOR_PASSWORD;
const data=JSON.parse(fs.readFileSync("../imports/history/2025-jun-dec-full.json","utf8"));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function offset(date){if(date<"2025-10-26")return 2;return 1;}
function ts(date,h){return `${date}T${String(h-offset(date)).padStart(2,"0")}:00:00.000Z`;}
function reading(r,phase){const [date,tMax,tMin,rain,rainRate,humMax,humMin,windMax,gustMax,lightMax,uvMax,pHigh,pLow]=r;const m=phase==="min";return {timestamp:ts(date,m?6:15),temperature:m?tMin:tMax,temperature_high:m?tMin:tMax,temperature_low:m?tMin:tMax,humidity:m?humMax:humMin,pressure:m?pHigh:pLow,wind_speed:m?0:windMax,wind_direction:null,rainfall:m?0:rain,rain_rate:m?0:rainRate,wind_gust:m?0:gustMax,uv_index:m?0:uvMax,solar_radiation:null};}
async function write(e,old,p){for(let a=1;a<=5;a++){try{return old?await e.update(old.id,p):await e.create(p);}catch(err){const s=err?.status??err?.response?.status??Number(String(err?.message??"").match(/\b(429|5\d\d)\b/)?.[1]);if(a===5||!(s===429||(s>=500&&s<=599)))throw err;await sleep(a*5000);}}}
async function main(){
 const b=createClient({appId:BASE44_APP_ID});
 await b.auth.loginViaEmailPassword(COLLECTOR_EMAIL,COLLECTOR_PASSWORD);
 const e=b.entities.WeatherReading;
 const ex=await e.list("-timestamp",10000);
 const map=new Map((ex??[]).filter(x=>x.timestamp).map(x=>[x.timestamp,x]));
 let c=0,u=0;
 for(const [month,rows] of Object.entries(data.months)){
   console.log("• "+month);
   for(const r of rows){
     for(const phase of ["min","max"]){
       const p=reading(r,phase),old=map.get(p.timestamp);
       await write(e,old,p);
       old?u++:c++;
       await sleep(750);
     }
   }
   const rainy=rows.filter(r=>r[3]>=data.rainy_day_threshold_mm).length;
   const total=rows.reduce((s,r)=>s+(r[3]??0),0);
   console.log(`✓ ${month}: pioggia ${total.toFixed(2)} mm, giorni pioggia ${rainy}`);
 }
 console.log(`✓ Import giugno-dicembre 2025 completato: ${c} create, ${u} aggiornate`);
 console.log("• Luce massima conservata integralmente nel JSON storico GitHub in lux; non scritta in solar_radiation perché lux != W/m².");
}
main().catch(e=>{console.error("✗ Import giugno-dicembre 2025 fallito:",e.message);process.exit(1);});