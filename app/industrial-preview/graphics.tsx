"use client";

import { useMemo, useState } from "react";

/** Preview-only charts. These values are synthetic and must never be presented as live mine data. */
const samples = {
  "7 days": { labels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], availability: [86,89,87,93,91,94,92], utilisation: [65,70,68,74,76,79,77] },
  "30 days": { labels: ["W1","W2","W3","W4"], availability: [84,88,90,92], utilisation: [62,69,73,77] },
  "90 days": { labels: ["M1","M2","M3"], availability: [83,87,92], utilisation: [61,70,77] }
} as const;
type Period = keyof typeof samples;

function path(values: readonly number[]) {
  return values.map((v,i)=>`${i===0?"M":"L"} ${42+i*(600/Math.max(values.length-1,1))} ${220-(v-40)*2.8}`).join(" ");
}
export function FleetTrend() {
  const [period,setPeriod] = useState<Period>("7 days");
  const [hover,setHover] = useState<number|null>(null);
  const data = samples[period];
  const hovered = hover===null?null:Math.min(hover,data.labels.length-1);
  return <div className="ig-graphic">
    <div className="ig-toolbar"><span><i className="ig-dot amber"/>Availability <i className="ig-dot blue"/>Utilisation</span><label>Period <select value={period} onChange={e=>{setPeriod(e.target.value as Period);setHover(null)}}>{Object.keys(samples).map(p=><option key={p}>{p}</option>)}</select></label></div>
    <svg className="ig-trend" viewBox="0 0 680 260" role="img" aria-label={`Illustrative ${period} availability and utilisation line chart`}>
      {[40,60,80,100].map(v=><g key={v}><line x1="42" x2="642" y1={220-(v-40)*2.8} y2={220-(v-40)*2.8} stroke="#294459" strokeDasharray="4 5"/><text x="8" y={225-(v-40)*2.8} fill="#9cb4c8" fontSize="12">{v}%</text></g>)}
      <path d={path(data.availability)} stroke="#f4ba45" strokeWidth="3.5" fill="none" strokeLinejoin="round" className="ig-line"/>
      <path d={path(data.utilisation)} stroke="#409cff" strokeWidth="3.5" fill="none" strokeLinejoin="round" className="ig-line"/>
      {data.labels.map((label,i)=>{const x=42+i*600/Math.max(data.labels.length-1,1);return <g key={label} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}><rect x={x-20} y="10" width="40" height="216" fill="transparent"/><circle cx={x} cy={220-(data.availability[i]-40)*2.8} r={hovered===i?6:4} fill="#f4ba45"/><circle cx={x} cy={220-(data.utilisation[i]-40)*2.8} r={hovered===i?6:4} fill="#409cff"/><text x={x} y="248" textAnchor="middle" fontSize="12" fill="#b7c9d8">{label}</text></g>})}
    </svg>
    <div className="ig-readout" aria-live="polite">{hovered===null?"Move over the chart to inspect a period":`${data.labels[hovered]} · Availability ${data.availability[hovered]}% · Utilisation ${data.utilisation[hovered]}%`}</div>
    <p className="ig-sample">Illustrative demonstration values — not OEM or production records.</p>
  </div>;
}
const downtime=[["Hydraulic",32],["Engine",18],["Electrical",12],["Undercarriage",8],["Other",6]] as const;
export function DowntimePareto() {
 const total=useMemo(()=>downtime.reduce((s,x)=>s+x[1],0),[]);
 let cumulative=0;
 return <div className="ig-pareto" role="img" aria-label="Illustrative downtime Pareto: hydraulic 32 hours, engine 18, electrical 12, undercarriage 8, other 6">
 {downtime.map(([name,hours])=>{cumulative+=hours;return <div key={name} className="ig-pareto-row"><span>{name}</span><div className="ig-track"><div style={{width:`${hours/32*100}%`}}/></div><strong>{hours}h</strong><small>{Math.round(cumulative/total*100)}% cum.</small></div>})}
 <p className="ig-sample">Illustrative demonstration values — not recorded downtime.</p></div>;
}
export function FleetStatus() {
 return <div className="ig-status"><div className="ig-donut" role="img" aria-label="Illustrative fleet: 20 operating, 2 idle, 2 unavailable"><div><strong>24</strong><span>Machines</span></div></div><div className="ig-statuslegend"><span><i className="ig-dot green"/>Operating <b>20</b></span><span><i className="ig-dot amber"/>Idle <b>2</b></span><span><i className="ig-dot red"/>Unavailable <b>2</b></span></div><p className="ig-sample">Illustrative machine counts only.</p></div>;
}
