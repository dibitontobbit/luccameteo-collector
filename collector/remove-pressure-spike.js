import { createClient } from "@base44/sdk";
const APP=process.env.BASE44_APP_ID, EMAIL=process.env.COLLECTOR_EMAIL, PASS=process.env.COLLECTOR_PASSWORD;
async function main(){
  const b=createClient({appId:APP});
  await b.auth.loginViaEmailPassword(EMAIL,PASS);
  const e=b.entities.WeatherReading;
  const rows=await e.list("-timestamp",10000);
  const target="2026-09-25T18:49:44Z";
  const hit=(rows??[]).find(r=>r.timestamp===target);
  if(!hit){console.log("• Nessun record Base44 al timestamp 20:49:44 locale: nulla da rimuovere.");return;}
  await e.update(hit.id,{pressure:null});
  console.log(`✓ Pressione anomala rimossa da ${target}`);
}
main().catch(e=>{console.error("✗ Correzione pressione fallita:",e.message);process.exit(1);});