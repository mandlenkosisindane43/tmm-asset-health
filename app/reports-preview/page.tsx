"use client";

import { useMemo, useState } from "react";

type Period = "Daily" | "Weekly" | "Monthly";
type MachineRow = { fleet: string; type: string; availability: number; utilisation: number; downtime: number; faults: number; priority: "High" | "Medium" | "Low" };
const EXAMPLE: MachineRow[] = [
  { fleet: "ADT 027", type: "Articulated dump truck", availability: 82, utilisation: 71, downtime: 18, faults: 3, priority: "Medium" },
  { fleet: "FEL 001", type: "Front-end loader", availability: 94, utilisation: 83, downtime: 6, faults: 1, priority: "Low" },
  { fleet: "EX 003", type: "Excavator", availability: 76, utilisation: 65, downtime: 24, faults: 4, priority: "High" },
];
const DAYS: Record<Period, number> = { Daily: 1, Weekly: 7, Monthly: 30 };

function csvCell(value: string | number) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function downloadCsv(rows: MachineRow[], period: Period) {
  const data = [
    ["Machine", "Type", "Availability (%)", "Utilisation (%)", "Downtime (h)", "Fault observations", "Priority"],
    ...rows.map(r => [r.fleet, r.type, r.availability, r.utilisation, r.downtime, r.faults, r.priority]),
  ].map(row => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + data], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "tmm-engineering-report-" + period.toLowerCase() + "-DEMO.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPreview() {
  const [period, setPeriod] = useState<Period>("Monthly");
  const [from, setFrom] = useState("2026-10-15");
  const [to, setTo] = useState("2026-11-13");
  const [source, setSource] = useState<"example" | "live">("example");
  const rows = source === "example" ? EXAMPLE : [];
  const totalDown = rows.reduce((sum, r) => sum + r.downtime, 0);
  const avgAvailability = rows.length ? Math.round(rows.reduce((sum, r) => sum + r.availability, 0) / rows.length) : null;
  const avgUtilisation = rows.length ? Math.round(rows.reduce((sum, r) => sum + r.utilisation, 0) / rows.length) : null;
  const highest = useMemo(() => rows.length ? [...rows].sort((a, b) => b.downtime - a.downtime)[0] : null, [rows]);
  const dateValid = Boolean(from && to && from <= to);
  return <main className="report-page">
    <style>{`
      .report-page { min-height:100vh;background:#081426;color:#eaf2ff;font:14px/1.5 Arial,Helvetica,sans-serif;padding:32px 20px; }
      .report-page * {box-sizing:border-box}
      .report-wrap {max-width:1100px;margin:auto}
      .report-head {display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px;flex-wrap:wrap}
      .eyebrow {font-size:11px;font-weight:700;letter-spacing:2px;color:#51c9be}
      .report-head h1 {font-size:30px;margin:5px 0 4px;color:#fff}
      .muted {color:#a6bad5}
      .tag {display:inline-flex;background:#1a314b;color:#c9e7ff;border-radius:100px;padding:6px 11px;font-size:12px;font-weight:bold}
      .report-panel {background:#13253f;border:1px solid #29405f;border-radius:16px;padding:24px;margin-bottom:18px}
      .controls {display:flex;flex-wrap:wrap;gap:12px;align-items:end;justify-content:space-between}
      .control-group {display:flex;flex-wrap:wrap;gap:10px;align-items:end}
      .control {display:flex;flex-direction:column;gap:5px;font-size:12px;color:#afc3dd;font-weight:bold}
      .control input,.control select {background:#0c1c31;border:1px solid #395474;border-radius:8px;padding:10px;color:#fff;min-height:40px}
      .periods {display:flex;gap:4px;background:#0c1c31;padding:4px;border-radius:10px}
      .periods button {border:0;border-radius:8px;padding:10px 16px;color:#b6cbe5;background:transparent;cursor:pointer}
      .periods button.active {background:#216a67;color:white;font-weight:bold}
      .action {border:1px solid #47708e;background:#1c3757;color:white;padding:10px 14px;border-radius:9px;cursor:pointer}
      .action.primary {background:#167d77;border-color:#167d77}
      .action:disabled {opacity:.45;cursor:not-allowed}
      .metrics {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}
      .metric {background:#0e1f36;border:1px solid #28435f;border-radius:12px;padding:18px}
      .metric span {color:#acc2db;font-size:12px}
      .metric strong {display:block;font-size:30px;color:white;margin-top:7px}
      .panel-title {font-size:19px;margin:0 0 2px;color:#fff}
      .legend {display:flex;gap:18px;color:#b7cae2;font-size:12px}
      .legend b {display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px}
      .chart-area {display:flex;align-items:stretch;gap:12px;margin:24px 0 16px}
      .chart-ticks {display:flex;flex-direction:column;justify-content:space-between;width:40px;color:#a6bad5;text-align:right;font-size:12px;padding:0 0 22px}
      .plot {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;gap:18px;flex:1;min-height:260px;border-bottom:1px solid #3b516a;background:repeating-linear-gradient(to top,transparent 0,transparent calc(25% - 1px),#29415b 25%);}
      .chart-item {display:flex;flex-direction:column;align-items:center;justify-content:end;height:260px;gap:8px}
      .bar-pair {display:flex;align-items:end;justify-content:center;gap:5px;height:228px;width:100%}
      .bar {width:min(43%,90px);border-radius:7px 7px 0 0;display:flex;align-items:flex-start;justify-content:center;padding-top:7px;font-size:12px;font-weight:bold;min-height:2px}
      .bar.avail {background:#579af2;color:#051429}.bar.util {background:#67c682;color:#062314}
      .chart-label {font-size:12px;white-space:nowrap;color:#d5e5fa}
      .table-scroll {overflow-x:auto}
      table {width:100%;border-collapse:collapse;margin-top:14px;white-space:nowrap}
      th,td {padding:13px 10px;text-align:left;border-bottom:1px solid #29425e}
      th {color:#b2c7e0;font-size:12px}td {color:#e9f3ff}
      .priority {font-weight:bold}.priority.High {color:#ff7d88}.priority.Medium {color:#ffca69}.priority.Low {color:#70d6a6}
      .findings {background:#0d2035;border-left:4px solid #2db5a9;padding:16px 18px;border-radius:7px;margin-top:16px}
      .findings p {margin:6px 0 0;color:#c7daeb}
      .warning {padding:12px 16px;border-radius:10px;background:#3a2c1d;color:#f4dca9;margin:14px 0}
      .empty {padding:46px 12px;text-align:center;color:#afc6de;border:1px dashed #50647d;border-radius:12px;margin-top:16px}
      @media(max-width:670px){.metrics{grid-template-columns:1fr}.report-page{padding:18px 10px}.report-panel{padding:16px}.plot{gap:5px}.chart-ticks{width:30px}.bar{font-size:10px}.report-head h1{font-size:24px}}
      @media print{.report-page{background:white;color:#111;padding:0}.report-panel,.metric{background:white;border-color:#bbb;color:#111}.report-head h1,.panel-title,.metric strong,td{color:#111}.muted,.control,.metric span,th,.legend{color:#333}.no-print{display:none!important}.chart-label{color:#111}.findings{background:white}.findings p{color:#333}.tag{background:white;color:#111}.report-panel{break-inside:avoid}.bar{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
    `}</style>
    <div className="report-wrap">
      <header className="report-head"><div><div className="eyebrow">SINDANE ASSET SOLUTIONS · TMM ASSET HEALTH</div><h1>Fleet Engineering Report</h1><div className="muted">Fleet performance, downtime, faults and maintenance priorities.</div></div><span className="tag">STAGING PREVIEW · NOT PRODUCTION</span></header>
      <section className="report-panel no-print">
        <div className="controls">
          <div className="control-group">
            <div className="control"><span>Report period</span><div className="periods">{(["Daily","Weekly","Monthly"] as const).map(p=><button key={p} type="button" className={period===p?"active":""} onClick={()=>setPeriod(p)}>{p}</button>)}</div></div>
            <label className="control">From <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
            <label className="control">To <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
            <label className="control">Data source <select value={source} onChange={e=>setSource(e.target.value as "example"|"live")}><option value="example">Sample data (demo)</option><option value="live">Live OEM readings (not connected)</option></select></label>
          </div>
          <div className="control-group"><button className="action" type="button" disabled={!dateValid || !rows.length} onClick={()=>downloadCsv(rows,period)}>Export CSV / Excel</button><button className="action primary" type="button" disabled={!dateValid} onClick={()=>window.print()}>Print / Save PDF</button></div>
        </div>
        {!dateValid&&<div className="warning">Select a valid date range: the start date must not be after the end date.</div>}
      </section>
      <section className="report-panel">
        <div className="report-head"><div><div className="eyebrow">ENGINEERING PERFORMANCE SUMMARY</div><h2 className="panel-title">{period} performance report</h2><div className="muted">{from} to {to} · {DAYS[period]}-day period preset · {source==="example"?"Illustrative sample values":"Live connector not integrated"}</div></div><span className="tag">{source==="example"?"DEMO DATA — NOT LIVE":"AWAITING DATA"}</span></div>
        <div className="metrics"><div className="metric"><span>Availability</span><strong>{avgAvailability===null?"—":avgAvailability+"%"}</strong></div><div className="metric"><span>Utilisation</span><strong>{avgUtilisation===null?"—":avgUtilisation+"%"}</strong></div><div className="metric"><span>Breakdown hours</span><strong>{rows.length?totalDown+" h":"—"}</strong></div></div>
        <h3 className="panel-title">Machine performance comparison</h3><div className="muted">Availability versus utilisation by registered asset</div>
        {rows.length?<><div className="chart-area" aria-label="Machine availability and utilisation grouped bar chart"><div className="chart-ticks"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div className="plot">{rows.map(r=><div className="chart-item" key={r.fleet}><div className="bar-pair"><div className="bar avail" style={{height:r.availability+"%"}}>{r.availability}%</div><div className="bar util" style={{height:r.utilisation+"%"}}>{r.utilisation}%</div></div><div className="chart-label">{r.fleet}</div></div>)}</div></div><div className="legend"><span><b style={{background:"#579af2"}}/>Availability</span><span><b style={{background:"#67c682"}}/>Utilisation</span></div></>:<div className="empty">Awaiting authorised machine readings. No availability or utilisation can be calculated.</div>}
      </section>
      <section className="report-panel"><h3 className="panel-title">Faults, downtime and maintenance priorities</h3><div className="muted">Only source-confirmed events should appear in a connected report.</div>
        {rows.length?<div className="table-scroll"><table><thead><tr><th>Machine</th><th>Type</th><th>Downtime</th><th>Faults</th><th>Priority</th></tr></thead><tbody>{rows.map(r=><tr key={r.fleet}><td><strong>{r.fleet}</strong></td><td>{r.type}</td><td>{r.downtime} h</td><td>{r.faults}</td><td><span className={"priority "+r.priority}>{r.priority}</span></td></tr>)}</tbody></table></div>:<div className="empty">No confirmed fault or breakdown events have been received.</div>}
        <div className="findings"><strong>Engineering findings</strong><p>{highest?highest.fleet+" has the greatest example downtime ("+highest.downtime+" h). Review recurring confirmed fault events and investigate the cause before scheduling corrective actions.":"Engineering findings will appear once readings and machine events are received and validated."}</p></div>
      </section>
      <p className="muted">Preview only. The sample fleet and values are illustrative, not fetched from OEM APIs. Connecting real report queries, tenant isolation, report scheduling and saved snapshots requires a separate verified integration.</p>
    </div>
  </main>;
}
