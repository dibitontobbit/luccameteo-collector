import fs from "node:fs";

const data = JSON.parse(
  fs.readFileSync("../imports/history/annual-rainfall-2026.json","utf8")
);

const months = Object.entries(data.monthly);
const completed = months.filter(([,v]) => typeof v === "number" && Number.isFinite(v));
const total = completed.reduce((sum,[,v]) => sum + v, 0);

console.log(`2026 rainfall total from authoritative monthly summaries: ${total.toFixed(2)} mm`);
console.log(`Completed months: ${completed.length}`);

if (completed.length >= 8 && Math.abs(total - data.ytd_through_august_mm) > 0.005) {
  throw new Error(
    `Annual rainfall summary mismatch: calculated ${total.toFixed(2)} vs expected ${data.ytd_through_august_mm.toFixed(2)}`
  );
}
