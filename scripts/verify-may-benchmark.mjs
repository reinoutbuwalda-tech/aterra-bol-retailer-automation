import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function parse(line){const out=[];let v="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){v+='"';i++}else q=!q}else if(c===","&&!q){out.push(v);v=""}else v+=c}out.push(v);return out}
const dir=join(homedir(),"Downloads");
const names=(await readdir(dir)).filter(n=>/^bolcom_1849734_artikelen-per-dag_.*\.csv$/.test(n));
const records=new Map(), conflicts=[];let duplicateRows=0;
for(const name of names){const lines=(await readFile(join(dir,name),"utf8")).split(/\r?\n/).filter(Boolean);if(lines.length<2)continue;const h=parse(lines[0]);for(const line of lines.slice(1)){const v=parse(line),r={date:v[h.indexOf("Datum")],ean:v[h.indexOf("EAN")],revenue:Number(v[h.indexOf("Omzet")]),sales:Number(v[h.indexOf("Verkopen")]),visits:Number(v[h.indexOf("Bezoeken")]),orders:Number(v[h.indexOf("Bestellingen")])};const key=`${r.date}|${r.ean}`,p=records.get(key);if(!p)records.set(key,r);else if(JSON.stringify(p)===JSON.stringify(r))duplicateRows++;else conflicts.push(key)}}
const may=[...records.values()].filter(r=>r.date.startsWith("2026-05"));
const total=may.reduce((a,r)=>({revenue:a.revenue+r.revenue,sales:a.sales+r.sales,orders:a.orders+r.orders,visits:a.visits+r.visits}),{revenue:0,sales:0,orders:0,visits:0});
const dates=new Set(may.map(r=>r.date)),eans=new Set(may.map(r=>r.ean));
const expected={revenue:3001.69,sales:118,orders:115,visits:1225};
const cents=n=>Math.round(n*100);
if(cents(total.revenue)!==cents(expected.revenue)||total.sales!==expected.sales||total.orders!==expected.orders||total.visits!==expected.visits||dates.size!==31||eans.size!==2||conflicts.length)throw new Error(`Benchmark mismatch: ${JSON.stringify({total,dates:dates.size,eans:eans.size,conflicts})}`);
const settlements=[[419.96,-.24,419.72],[499.03,-60.73,438.30],[1624,-50.87,1573.13]];
if(settlements.some(([g,a,n])=>cents(g+a)!==cents(n)))throw new Error("Settlement arithmetic mismatch");
console.log(JSON.stringify({status:"verified",files:names.length,overlapDuplicates:duplicateRows,conflicts:0,uniqueMayDates:dates.size,eans:eans.size,...total,settlements:"3/3 exact"},null,2));
