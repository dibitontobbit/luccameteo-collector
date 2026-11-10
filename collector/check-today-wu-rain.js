const STATION_ID=process.env.STATION_ID||"ILUCCA95";
const API=process.env.WEATHER_API_KEY;
async function main(){
 const u="https://api.weather.com/v2/pws/observations/all/1day?stationId="+encodeURIComponent(STATION_ID)+"&format=json&units=m&numericPrecision=decimal&apiKey="+encodeURIComponent(API);
 const r=await fetch(u); if(!r.ok) throw new Error("HTTP "+r.status);
 const j=await r.json();
 const obs=(j.observations||[]).filter(o=>o.obsTimeUtc);
 const rows=obs.map(o=>({t:o.obsTimeUtc,total:Number(o?.metric?.precipTotal),rate:Number(o?.metric?.precipRate)})).filter(x=>Number.isFinite(x.total));
 rows.sort((a,b)=>new Date(a.t)-new Date(b.t));
 const today=rows.filter(x=>new Date(x.t).getTime()>=Date.parse("2026-11-09T23:00:00Z"));
 console.log("TODAY_WU="+JSON.stringify({first:today[0],last:today.at(-1),min:Math.min(...today.map(x=>x.total)),max:Math.max(...today.map(x=>x.total)),count:today.length,nonzero:today.filter(x=>x.rate>0).slice(-30)}));
}
main().catch(e=>{console.error(e);process.exit(1)});