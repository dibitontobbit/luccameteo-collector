import { createClient } from "@base44/sdk";
const BASE44_APP_ID=process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL=process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD=process.env.COLLECTOR_PASSWORD;

async function main(){
  const b=createClient({appId:BASE44_APP_ID});
  await b.auth.loginViaEmailPassword(COLLECTOR_EMAIL,COLLECTOR_PASSWORD);
  const e=b.entities.WeatherReading;
  const rows=await e.list("-timestamp",10000);
  const feb=(rows??[]).filter(r=>r.timestamp>="2025-02-01T00:00:00.000Z"&&r.timestamp<"2025-03-01T00:00:00.000Z")
    .sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp)));
  console.log("TOTAL",feb.length);
  if(feb.length){
    console.log("FIRST",feb[0].timestamp);
    console.log("LAST",feb[feb.length-1].timestamp);
  }
  const perDay={};
  for(const r of feb){
    const d=r.timestamp.slice(0,10);
    perDay[d]=(perDay[d]??0)+1;
  }
  console.log("PER_DAY",JSON.stringify(perDay));
}
main().catch(e=>{console.error(e);process.exit(1);});