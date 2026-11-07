"use client";

import { useState } from "react";

export type ProductionPoint = { reportDate: string; shiftHours: number; plannedDowntime: number; unplannedDowntime: number; productiveHours: number };
export type FleetPoint = { status: string };
export type FaultPoint = { system?: string | null; status: string; severity: string };

const finite = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, n) : 0; };
function seriesPath(values: number[], max: number) {
  return values.map((v,i) => `${i ? "L" : "M"} ${42 + i * 600 / Math.max(values.length - 1, 1)} ${220 - Math.min(100,Math.max(0,v)) * 1.8}`).join(" ");
}

export function FleetTrend({ records }: { records: ProductionPoint[] }) {
  const [period, setPeriod] = useState(7);
  const cutoff = new Date(); cutoff.setHours(0,0,0,0); cutoff.setDate(cutoff.getDate()-period+1);
  const grouped = new Map<string, { shift:number; downtime:number; productive:number }>();
  for (const r of records) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.reportDate || "") || r.reportDate < cutoff.toISOString().slice(0,10)) continue;
    const v=grouped.get(r.reportDate) || {shift:0,downtime:0,productive:0};
    v.shift+=finite(r.shiftHours);v.downtime+=finite(r.plannedDowntime)+finite(r.unplannedDowntime);v.productive+=finite(r.productiveHours);
    grouped.set(r.reportDate,v);
  }
  const days=[...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([day,v])=>({day,availability:v.shift>0?100*Math.max(0,v.shift-v.downtime)/v.shift:0,utilisation:v.shift>v.downtime?100*v.productive/(v.shift-v.downtime):0,valid:v.shift>0}));
  const valid=days.filter(x=>x.valid);
  return <div className="ig-graphic">
    <div className="ig-toolbar"><span><i className="ig-dot amber"/>Availability <i className="ig-dot blue"/>Utilisation</span><label>Period <select value={period} onChange={e=>setPeriod(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label></div>
    {!valid.length ? <div className="industrial-chart-empty"><strong>No dated production records for this period</strong><p>Recorded shift hours and downtime are needed to calculate trends.</p></div> : <>
      <svg className="ig-trend" viewBox="0 0 680 260" role="img" aria-label="Availability and utilisation derived from stored production records">
        {[0,25,50,75,100].map(v=><g key={v}><line x1="42" x2="642" y1={220-v*1.8} y2={220-v*1.8} stroke="#294459" strokeDasharray="4 5"/><text x="8" y={225-v*1.8} fill="#9cb4c8" fontSize="12">{v}%</text></g>)}
        <path d={seriesPath(valid.map(x=>x.availability),100)} stroke="#f4ba45" strokeWidth="3" fill="none"/>
        <path d={seriesPath(valid.map(x=>x.utilisation),100)} stroke="#409cff" strokeWidth="3" fill="none"/>
        {valid.map((v,i)=><text key={v.day} x={42+i*600/Math.max(valid.length-1,1)} y="250" textAnchor="middle" fontSize="11" fill="#b7c9d8">{v.day.slice(5)}</text>)}
      </svg><p className="ig-sample">Stored production records · {valid.length} reported dates; missing dates are omitted.</p>
    </>}
  </div>;
}

export function DowntimePareto({ faults }: { faults: FaultPoint[] }) {
  const counts=new Map<string,number>();
  for(const f of faults){const key=(f.system || "Unclassified").trim() || "Unclassified";counts.set(key,(counts.get(key)||0)+1);}
  const rows=[...counts.entries()].sort((a,b)=>b[1]-a[1]);
  const total=rows.reduce((s,x)=>s+x[1],0);let cumulative=0;
  if(!total)return <div className="industrial-chart-empty compact"><strong>No recorded fault events</strong><p>Fault categories will appear once records are available.</p></div>;
  return <div className="ig-pareto" aria-label="Fault event counts by system">{rows.map(([name,count])=>{cumulative+=count;return <div className="ig-pareto-row" key={name}><span>{name}</span><div className="ig-track"><div style={{width:`${count/rows[0][1]*100}%`}}/></div><strong>{count}</strong><small>{Math.round(cumulative/total*100)}% cum.</small></div>})}<p className="ig-sample">Fault event counts, not downtime hours · limited to the latest retrieved records.</p></div>;
}

export function FleetStatus({ fleet }: { fleet: FleetPoint[] }) {
  const counts=new Map<string,number>();for(const f of fleet){const s=(f.status||"Unknown").trim()||"Unknown";counts.set(s,(counts.get(s)||0)+1);}
  if(!fleet.length)return <div className="industrial-chart-empty"><strong>No fleet records</strong><p>Machine status will appear when equipment is registered.</p></div>;
  return <div className="ig-status"><div className="ig-statuslegend">{[...counts].map(([status,n])=><span key={status}><i className="ig-dot blue"/>{status} <b>{n}</b></span>)}</div><p className="ig-sample">{fleet.length} stored fleet records; status reflects the last saved value, not live telemetry.</p></div>;
}
