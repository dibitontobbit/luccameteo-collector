import { createClient } from "@base44/sdk";

const STATION_ID=process.env.STATION_ID||"ILUCCA95";
const API=process.env.WEATHER_API_KEY;
const BASE44_APP_ID=process.env.BASE44_APP_ID;
const COLLECTOR_EMAIL=process.env.COLLECTOR_EMAIL;
const COLLECTOR_PASSWORD=process.env.COLLECTOR_PASSWORD;

function italyDayKey(timestamp){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Rome",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(timestamp));
  const v=Object.fromEntries(p.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function hasTemp(o){const m=o?.metric??{};return [m.tempAvg,m.tempHigh,m.tempLow,m.temp].some(v=>n(v)!=null);}

function deriveHistorical(obs){
  const sorted=[...obs].filter(o=>o?.obsTimeUtc&&hasTemp(o)).sort((a,b)=>new Date(a.obsTimeUtc)-new Date(b.obsTimeUtc));
  const inc=new Map(); let day=null,max=null;
  for(const o of sorted){
    const ts=o.obsTimeUtc,total=n(o?.metric?.precipTotal),d=italyDayKey(ts); let x=0;
    if(total!=null){
      if(day==null){day=d;max=total;x=0;}
      else if(d!==day){day=d;max=total;x=total>0?Math.round(total*100)/100:0;}
      else if(max==null){max=total;x=0;}
      else if(total>max){x=Math.round((total-max)*100)/100;max=total;}
      else{x=0;}
    }
    inc.set(ts,x);
  }
  return inc;
}

async function main(){
  const histUrl="https://api.weather.com/v2/pws/observations/all/1day?stationId="+encodeURIComponent(STATION_ID)+"&format=json&units=m&numericPrecision=decimal&apiKey="+encodeURIComponent(API);
  const curUrl="https://api.weather.com/v2/pws/observations/current?stationId="+encodeURIComponent(STATION_ID)+"&format=json&units=m&numericPrecision=decimal&apiKey="+encodeURIComponent(API);
  const [hr,cr]=await Promise.all([fetch(histUrl),fetch(curUrl)]);
  if(!hr.ok||!cr.ok) throw new Error("TWC HTTP hist="+hr.status+" current="+cr.status);
  const hist=(await hr.json())?.observations??[];
  const current=(await cr.json())?.observations?.[0]??null;
  const expected=deriveHistorical(hist);
  const todayHist=hist.filter(o=>o?.obsTimeUtc&&italyDayKey(o.obsTimeUtc)==="2026-11-10").sort((a,b)=>new Date(a.obsTimeUtc)-new Date(b.obsTimeUtc));
  const latestHist=todayHist.at(-1)?.obsTimeUtc??null;
  const histMax=Math.max(0,...todayHist.map(o=>n(o?.metric?.precipTotal)).filter(Number.isFinite));
  const currentTotal=n(current?.metric?.precipTotal);
  const currentTs=current?.obsTimeUtc??null;
  const tail=Math.max(0,(currentTotal??histMax)-histMax);

  const base44=createClient({appId:BASE44_APP_ID});
  await base44.auth.loginViaEmailPassword(COLLECTOR_EMAIL,COLLECTOR_PASSWORD);
  const rows=await base44.entities.WeatherReading.list("-timestamp",1500);
  const today=(rows??[]).filter(r=>r?.timestamp&&italyDayKey(r.timestamp)==="2026-11-10").sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp));

  let changed=0;
  for(const row of today){
    const rowId=row.id??row._id;
    if(!rowId) continue;
    let desired=0;
    if(expected.has(row.timestamp)) desired=expected.get(row.timestamp)??0;
    if(latestHist && new Date(row.timestamp)>new Date(latestHist)) desired=0;
    const cur=n(row.rainfall)??0;
    if(Math.abs(cur-desired)>0.001){
      await base44.entities.WeatherReading.update(rowId,{rainfall:desired});
      changed++;
      console.log("SET",row.timestamp,cur,"->",desired);
    }
  }

  if(tail>0 && currentTs){
    const target=today.filter(r=>r.timestamp===currentTs)[0] ?? today.filter(r=>new Date(r.timestamp)>new Date(latestHist??0)).at(-1);
    if(target?.id){
      const cur=n(target.rainfall)??0;
      if(Math.abs(cur-tail)>0.001){
        await base44.entities.WeatherReading.update(target.id,{rainfall:Math.round(tail*100)/100});
        changed++;
        console.log("TAIL",target.timestamp,cur,"->",Math.round(tail*100)/100);
      }
    }
  }

  const verify=await base44.entities.WeatherReading.list("-timestamp",1500);
  let sum=0;
  for(const r of verify??[]){
    if(r?.timestamp&&italyDayKey(r.timestamp)==="2026-11-10"){const v=n(r.rainfall);if(v!=null)sum+=v;}
  }
  console.log("REPAIR_RESULT="+JSON.stringify({latestHist,histMax,currentTs,currentTotal,tail,changed,base44Today:Math.round(sum*100)/100}));
}
main().catch(e=>{console.error(e);process.exit(1);});