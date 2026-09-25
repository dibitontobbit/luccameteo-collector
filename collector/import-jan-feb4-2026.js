import { createClient } from "@base44/sdk";
import fs from "node:fs";
const APP=process.env.BASE44_APP_ID, EMAIL=process.env.COLLECTOR_EMAIL, PASS=process.env.COLLECTOR_PASSWORD;
const data=JSON.parse(fs.readFileSync("../imports/history/jan-feb4-2026.json","utf8"));
const rows=[...data.january_2026,...data.february_1_4_2026];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function ts(date,h){return `${date}T${String(h-1).padStart(2,"0")}:00:00.000Z`;}
function payload(r,phase){
 const [date,tMax,tMin,rain,rainRate,humMax,humMin,windMax,gustMax,lightMax,uvMax,pHigh,pLow]=r;
 const min=phase==="min";
 return {timestamp:ts(date,min?6:15),temperature:min?tMin:tMax,temperature_high:min?tMin:tMax,temperature_low:min?tMin:tMax,humidity:min?humMax:humMin,pressure:min?pHigh:pLow,wind_speed:min?0:windMax,wind_direction:null,rainfall:min?0:rain,rain_rate:min?0:rainRate,wind_gust:min?0:gustMax,uv_index:min?0:uvMax,solar_radiation:null};
}
async function write(e,old,p){for(let a=1;a<=5;a++){try{return old?await e.update(old.id,p):await e.create(p);}catch(err){const s=err?.status??err?.response?.status??Number(String(err?.message??"").match(/\b(429|5\d\d)\b/)?.[1]);if(a===5||!(s===429||(s>=500&&s<=599)))throw err;await sleep(a*5000);}}}
async function main(){
 const b=createClient({appId:APP});await b.auth.loginViaEmailPassword(EMAIL,PASS);
 const e=b.entities.WeatherReading;const ex=await e.list("-timestamp",10000);
 const map=new Map((ex??[]).filter(x=>x.timestamp).map(x=>[x.timestamp,x]));
 let c=0,u=0;
 for(const r of rows){for(const phase of ["min","max"]){const p=payload(r,phase),old=map.get(p.timestamp);await write(e,old,p);old?u++:c++;await sleep(700);}}
 console.log(`✓ Gennaio 2026 + 1-4 febbraio completati: ${c} create, ${u} aggiornate`);
 console.log(`✓ Gennaio: ${data.january_2026.length} giorni; 1-4 febbraio: ${data.february_1_4_2026.length} giorni`);
}
main().catch(e=>{console.error("✗ Import fallito:",e.message);process.exit(1);});