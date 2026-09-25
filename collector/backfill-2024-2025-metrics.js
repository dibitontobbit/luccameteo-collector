import { createClient } from "@base44/sdk";
import fs from "node:fs";

const APP=process.env.BASE44_APP_ID, EMAIL=process.env.COLLECTOR_EMAIL, PASS=process.env.COLLECTOR_PASSWORD;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const sourceFiles=[
  "import-august-2024.js","import-september-2024.js","import-october-2024.js",
  "import-november-2024.js","import-december-2024.js",
  "import-january-2025.js","import-february-2025.js","import-march-2025.js",
  "import-april-2025.js","import-may-2025.js"
];

function extractRows(path){
  const src=fs.readFileSync(path,"utf8");
  const m=src.match(/(?:const|let)\s+rows\s*=\s*(\[[\s\S]*?\]);/);
  if(!m) throw new Error("rows non trovate in "+path);
  return JSON.parse(m[1]);
}
function offset(date){
  const y=Number(date.slice(0,4)),m=Number(date.slice(5,7)),d=Number(date.slice(8,10));
  if(m<3||m>10) return 1;
  if(m>3&&m<10) return 2;
  // 2024: DST 31 Mar - 27 Oct; 2025: 30 Mar - 26 Oct
  if(m===3){
    const start=y===2024?31:30;
    return d>=start?2:1;
  }
  const end=y===2024?27:26;
  return d>=end?1:2;
}
function ts(date,h){return `${date}T${String(h-offset(date)).padStart(2,"0")}:00:00.000Z`;}
function patchFromRow(r,phase){
  const [date,tMax,tMin,rain,rainRate,humMax,humMin,windMax,gustMax,uvMax,pHigh,pLow]=r;
  const morning=phase==="morning";
  return {
    timestamp:ts(date,morning?6:15),
    temperature:morning?tMin:tMax,
    humidity:morning?humMax:humMin,
    pressure:morning?pHigh:pLow,
    wind_speed:morning?0:windMax,
    wind_gust:morning?0:gustMax,
    uv_index:morning?0:uvMax
  };
}
async function write(e,old,p){
  for(let a=1;a<=5;a++){
    try{return old?await e.update(old.id,p):await e.create({...p,temperature_high:p.temperature,temperature_low:p.temperature,wind_direction:null,rainfall:0,rain_rate:0,solar_radiation:null});}
    catch(err){
      const s=err?.status??err?.response?.status??Number(String(err?.message??"").match(/\b(429|5\d\d)\b/)?.[1]);
      if(a===5||!(s===429||(s>=500&&s<=599))) throw err;
      await sleep(a*5000);
    }
  }
}
async function main(){
  const rows=[];
  for(const f of sourceFiles) rows.push(...extractRows(f));
  const recent=JSON.parse(fs.readFileSync("../imports/history/jun-dec-2025.json","utf8"));
  rows.push(...Object.values(recent).flat());

  const b=createClient({appId:APP});
  await b.auth.loginViaEmailPassword(EMAIL,PASS);
  const e=b.entities.WeatherReading;
  const existing=await e.list("-timestamp",10000);
  const map=new Map((existing??[]).filter(x=>x.timestamp).map(x=>[x.timestamp,x]));

  let updated=0,created=0,skipped=0;
  for(const r of rows){
    const date=r[0];
    // 27/08/2024 è un evento speciale già corretto con punti 15:00/17:00/17:10.
    // Non ricreiamo la lettura mattutina né tocchiamo vento/raffica dell'evento.
    if(date==="2024-08-27"){
      const t=ts(date,15), old=map.get(t);
      if(old){
        const [,tMax,, , , ,humMin, , ,uvMax, ,pLow]=r;
        await write(e,old,{timestamp:t,temperature:tMax,humidity:humMin,pressure:pLow,uv_index:uvMax});
        updated++;
      } else skipped++;
      continue;
    }

    for(const phase of ["morning","afternoon"]){
      const p=patchFromRow(r,phase);
      const old=map.get(p.timestamp);
      await write(e,old,p);
      if(old) updated++; else {created++; map.set(p.timestamp,{timestamp:p.timestamp});}
      await sleep(650);
    }
  }
  console.log(`✓ Backfill 2024-2025 completato: ${updated} aggiornate, ${created} create, ${skipped} saltate`);
  console.log("✓ Campi: umidità, pressione, vento, raffica, UV");
  console.log("• Lux non scritto in solar_radiation: lux e W/m² non sono unità intercambiabili.");
}
main().catch(e=>{console.error("✗ Backfill fallito:",e.message);process.exit(1);});