"use client";

import { useMemo, useState } from "react";

const sections = [
  "Dashboard",
  "Fleet",
  "Breakdowns",
  "Maintenance",
  "Work orders",
  "Production",
  "Documents",
  "Reports",
];

const fleet = [
  { unit: "ADT-01", type: "Articulated Dump Truck", site: "North Pit", status: "Operating", hours: 6842, service: 72 },
  { unit: "ADT-02", type: "Articulated Dump Truck", site: "North Pit", status: "Operating", hours: 6179, service: 118 },
  { unit: "EXC-01", type: "Excavator", site: "Box Cut", status: "Attention", hours: 9251, service: 18 },
  { unit: "EXC-02", type: "Excavator", site: "South Pit", status: "Operating", hours: 7714, service: 146 },
  { unit: "LDV-04", type: "Light Delivery Vehicle", site: "Workshop", status: "Operating", hours: 3120, service: 210 },
  { unit: "DOZ-01", type: "Dozer", site: "Discard", status: "Down", hours: 11032, service: 0 },
];

const breakdowns = [
  { unit: "DOZ-01", fault: "Hydraulic hose failure", opened: "29 Aug · 08:15", downtime: "2.8 h", priority: "Critical" },
  { unit: "EXC-01", fault: "Boom cylinder oil leak", opened: "29 Aug · 06:40", downtime: "1.2 h", priority: "High" },
  { unit: "ADT-02", fault: "Intermittent brake warning", opened: "28 Aug · 15:30", downtime: "0.7 h", priority: "Medium" },
];

const maintenance = [
  { unit: "EXC-01", task: "250 h service", due: "18 h", owner: "Workshop Team" },
  { unit: "ADT-01", task: "500 h service", due: "72 h", owner: "Mechanic A" },
  { unit: "ADT-02", task: "250 h service", due: "118 h", owner: "Mechanic B" },
  { unit: "EXC-02", task: "500 h service", due: "146 h", owner: "Workshop Team" },
];

const workOrders = [
  { no: "WO-1042", unit: "DOZ-01", job: "Replace failed hydraulic hose", status: "In progress" },
  { no: "WO-1041", unit: "EXC-01", job: "Inspect boom cylinder leak", status: "Assigned" },
  { no: "WO-1038", unit: "ADT-02", job: "Brake warning diagnosis", status: "Waiting test" },
];

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "warn" | "bad" | "neutral" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export default function ContractorDemo() {
  const [active, setActive] = useState("Dashboard");
  const [notice, setNotice] = useState("");

  const operating = useMemo(() => fleet.filter((m) => m.status === "Operating").length, []);
  const availability = ((operating + 0.5) / fleet.length) * 100;

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  return (
    <main className="contractor-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/sindane-logo.png" alt="Sindane Asset Solutions" />
          <div><strong>TMM Asset Health</strong><small>Contractor Workspace</small></div>
        </div>
        <div className="company-card">
          <span className="dot" />
          <div><strong>Mining Contractor Demo</strong><small>North Pit Operations</small></div>
        </div>
        <nav>
          {sections.map((name) => (
            <button key={name} className={active === name ? "active" : ""} onClick={() => setActive(name)}>
              <span>{name === "Dashboard" ? "⌂" : name === "Fleet" ? "▦" : name === "Breakdowns" ? "⚙" : name === "Maintenance" ? "◷" : name === "Work orders" ? "☑" : name === "Production" ? "P" : name === "Documents" ? "▣" : "▥"}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="licence">
          <span>● Licence active</span>
          <strong>Contractor Professional</strong>
          <small>Secure company workspace</small>
        </div>
        <div className="powered">Powered by <b>Sindane Asset Solutions</b></div>
      </aside>

      <section className="workspace">
        <header>
          <div>
            <small>CONTRACTOR PORTAL / {active.toUpperCase()}</small>
            <h1>{active === "Dashboard" ? "Operations Dashboard" : active}</h1>
          </div>
          <div className="header-actions">
            <span className="demo-badge">LIVE DEMO</span>
            <button onClick={() => window.print()}>Print</button>
            <button className="primary" onClick={() => flash("Quick capture opened for this demo workspace.")}>＋ Quick capture</button>
          </div>
        </header>

        {notice && <div className="toast">{notice}</div>}

        <div className="content">
          {active === "Dashboard" && (
            <>
              <div className="welcome">
                <div><small>Saturday, 29 August 2026</small><h2>Good morning, Contractor Team</h2><p>One view of fleet health, downtime, maintenance and production performance.</p></div>
                <button onClick={() => setActive("Breakdowns")}>View active breakdowns →</button>
              </div>
              <div className="metrics">
                <Metric label="Fleet availability" value={`${availability.toFixed(1)}%`} note="Target ≥ 90%" />
                <Metric label="Units operating" value={`${operating} / ${fleet.length}`} note="1 attention · 1 down" />
                <Metric label="Open breakdowns" value="3" note="2 require workshop action" />
                <Metric label="Production today" value="8 460 t" note="84.6% of 10 000 t target" />
              </div>

              <div className="grid-two">
                <section className="panel">
                  <div className="panel-title"><div><small>ASSET HEALTH</small><h3>Fleet status</h3></div><button onClick={() => setActive("Fleet")}>View fleet</button></div>
                  <div className="fleet-mini">
                    {fleet.slice(0, 5).map((m) => (
                      <div key={m.unit} className="mini-row"><b>{m.unit}</b><span>{m.type}</span><Pill tone={m.status === "Operating" ? "good" : m.status === "Down" ? "bad" : "warn"}>{m.status}</Pill></div>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-title"><div><small>DOWNTIME</small><h3>Latest breakdowns</h3></div><button onClick={() => setActive("Breakdowns")}>Open register</button></div>
                  {breakdowns.map((b) => (
                    <div key={b.unit + b.fault} className="break-row"><div><b>{b.unit}</b><span>{b.fault}</span><small>{b.opened}</small></div><div><strong>{b.downtime}</strong><Pill tone={b.priority === "Critical" ? "bad" : b.priority === "High" ? "warn" : "neutral"}>{b.priority}</Pill></div></div>
                  ))}
                </section>
              </div>

              <div className="grid-two lower">
                <section className="panel">
                  <div className="panel-title"><div><small>PLANNED WORK</small><h3>Maintenance due</h3></div><button onClick={() => setActive("Maintenance")}>Maintenance</button></div>
                  {maintenance.slice(0, 3).map((m) => <div key={m.unit} className="simple-row"><b>{m.unit}</b><span>{m.task}</span><strong>{m.due}</strong></div>)}
                </section>
                <section className="panel production-card">
                  <div className="panel-title"><div><small>SHIFT PERFORMANCE</small><h3>Production vs target</h3></div><b>84.6%</b></div>
                  <div className="bar"><span style={{ width: "84.6%" }} /></div>
                  <div className="prod-numbers"><div><small>Actual</small><strong>8 460 t</strong></div><div><small>Target</small><strong>10 000 t</strong></div><div><small>Variance</small><strong>-1 540 t</strong></div></div>
                </section>
              </div>
            </>
          )}

          {active === "Fleet" && (
            <Table title="Contractor fleet register" subtitle="Current machine status, site and service position" headers={["Fleet no.", "Machine", "Site", "Status", "Hours", "Service due"]} rows={fleet.map((m) => [m.unit, m.type, m.site, m.status, m.hours.toLocaleString(), `${m.service} h`])} />
          )}
          {active === "Breakdowns" && (
            <Table title="Breakdown register" subtitle="Open equipment faults and current downtime" headers={["Fleet no.", "Fault / reason", "Opened", "Downtime", "Priority"]} rows={breakdowns.map((b) => [b.unit, b.fault, b.opened, b.downtime, b.priority])} />
          )}
          {active === "Maintenance" && (
            <Table title="Planned maintenance" subtitle="Services and inspections approaching due hours" headers={["Fleet no.", "Task", "Due in", "Responsible"]} rows={maintenance.map((m) => [m.unit, m.task, m.due, m.owner])} />
          )}
          {active === "Work orders" && (
            <Table title="Work orders" subtitle="Track assigned maintenance actions to completion" headers={["Work order", "Fleet no.", "Job", "Status"]} rows={workOrders.map((w) => [w.no, w.unit, w.job, w.status])} />
          )}
          {active === "Production" && (
            <Table title="Daily production" subtitle="Contractor shift performance linked to equipment availability" headers={["Date", "Shift", "Target", "Actual", "Availability", "Utilisation"]} rows={[["29 Aug 2026", "Day", "10 000 t", "8 460 t", `${availability.toFixed(1)}%`, "79.4%"], ["28 Aug 2026", "Day", "10 000 t", "9 180 t", "91.7%", "84.2%"], ["27 Aug 2026", "Day", "10 000 t", "9 640 t", "94.1%", "87.0%"]]} />
          )}
          {active === "Documents" && (
            <Cards title="Contractor documents" items={["Purchase orders & quotations", "OEM manuals and service sheets", "Inspection documents", "Job card attachments", "Breakdown photos and evidence", "Maintenance certificates"]} onOpen={flash} />
          )}
          {active === "Reports" && (
            <Cards title="Reports available to contractor" items={["Daily operations report", "Weekly fleet summary", "Monthly availability report", "Downtime Pareto report", "Maintenance compliance report", "Production vs target report"]} onOpen={(name) => flash(`${name} selected. Export options are available in the full licensed workspace.`)} />
          )}
        </div>
      </section>

      <style>{`
        *{box-sizing:border-box}.contractor-shell{min-height:100vh;background:#f4f7fb;color:#14213d;font-family:Inter,Arial,sans-serif;display:grid;grid-template-columns:264px 1fr}.sidebar{background:#0c1b33;color:#fff;padding:22px 16px;display:flex;flex-direction:column;min-height:100vh;position:sticky;top:0;height:100vh}.brand{display:flex;align-items:center;gap:11px;padding:4px 6px 22px;border-bottom:1px solid #223552}.brand img{width:42px;height:42px;object-fit:contain;background:#fff;border-radius:9px;padding:4px}.brand strong,.brand small{display:block}.brand strong{font-size:15px}.brand small{font-size:11px;color:#8da4c6;margin-top:3px}.company-card{display:flex;gap:10px;align-items:center;margin:18px 4px 12px;padding:12px;border:1px solid #29405f;border-radius:12px;background:#112642}.company-card .dot{width:9px;height:9px;border-radius:50%;background:#33c27f}.company-card strong,.company-card small{display:block}.company-card strong{font-size:12px}.company-card small{font-size:10px;color:#91a8c8;margin-top:3px}.sidebar nav{display:flex;flex-direction:column;gap:4px}.sidebar nav button{border:0;background:transparent;color:#b6c6db;padding:10px 11px;border-radius:9px;text-align:left;display:flex;gap:11px;align-items:center;cursor:pointer;font-weight:650}.sidebar nav button span{width:20px;text-align:center;color:#7992b3}.sidebar nav button:hover,.sidebar nav button.active{background:#19385e;color:#fff}.sidebar nav button.active span{color:#5bb7ff}.licence{margin-top:auto;border:1px solid #25415e;background:#102846;border-radius:12px;padding:13px}.licence span,.licence strong,.licence small{display:block}.licence span{font-size:10px;color:#4dde93}.licence strong{font-size:12px;margin:5px 0}.licence small{font-size:10px;color:#8da4c6}.powered{font-size:9px;color:#7088a7;text-align:center;margin-top:15px}.workspace{min-width:0}.workspace header{height:86px;background:#fff;border-bottom:1px solid #dce4ef;padding:17px 28px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}.workspace header small{font-size:10px;color:#7c8aa2;font-weight:750;letter-spacing:.08em}.workspace header h1{font-size:23px;margin:4px 0 0}.header-actions{display:flex;gap:9px;align-items:center}.header-actions button,.panel-title button,.welcome button{border:1px solid #d5dfeb;background:#fff;border-radius:8px;padding:9px 12px;cursor:pointer;font-weight:700;color:#28405e}.header-actions .primary{background:#1267b3;color:#fff;border-color:#1267b3}.demo-badge{font-size:10px;font-weight:800;color:#7a4a00;background:#fff2c9;border:1px solid #f0d98d;padding:6px 8px;border-radius:999px}.content{padding:24px 28px 42px;max-width:1500px;margin:0 auto}.welcome{background:linear-gradient(125deg,#102b4d,#174f80);color:#fff;border-radius:16px;padding:25px 28px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 10px 28px rgba(18,52,90,.13)}.welcome small{color:#9fc4e8}.welcome h2{margin:4px 0 5px;font-size:25px}.welcome p{margin:0;color:#c4d8eb;font-size:13px}.welcome button{border-color:#5f83a6;background:#fff;color:#173c62}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:16px 0}.metric{background:#fff;border:1px solid #dde5ef;border-radius:13px;padding:17px;box-shadow:0 4px 12px rgba(31,55,82,.04)}.metric span,.metric small{display:block;color:#718198}.metric span{font-size:11px;font-weight:750}.metric strong{display:block;font-size:27px;margin:8px 0 5px;color:#102943}.metric small{font-size:10px}.grid-two{display:grid;grid-template-columns:1.1fr .9fr;gap:14px}.grid-two.lower{margin-top:14px}.panel,.table-panel{background:#fff;border:1px solid #dde5ef;border-radius:13px;padding:18px;box-shadow:0 4px 12px rgba(31,55,82,.04)}.panel-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.panel-title small{font-size:9px;color:#8190a5;font-weight:800;letter-spacing:.1em}.panel-title h3{margin:3px 0 0;font-size:16px}.panel-title button{padding:6px 8px;font-size:10px}.fleet-mini,.break-row{border-top:1px solid #edf1f6}.mini-row{display:grid;grid-template-columns:70px 1fr auto;gap:9px;align-items:center;padding:11px 2px;border-bottom:1px solid #edf1f6;font-size:12px}.mini-row span:nth-child(2){color:#62738b}.pill{display:inline-block;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:800;background:#edf2f7;color:#51627a}.pill.good{background:#e2f6eb;color:#177245}.pill.warn{background:#fff0d7;color:#9a5a00}.pill.bad{background:#ffe4e4;color:#a82828}.break-row{display:flex;justify-content:space-between;padding:11px 2px}.break-row>div:first-child b,.break-row span,.break-row small{display:block}.break-row>div:first-child b{font-size:12px}.break-row span{font-size:11px;margin:2px 0;color:#4e6079}.break-row small{font-size:9px;color:#8a97aa}.break-row>div:last-child{text-align:right}.break-row>div:last-child strong{display:block;font-size:12px;margin-bottom:4px}.simple-row{display:grid;grid-template-columns:80px 1fr auto;gap:8px;padding:12px 2px;border-top:1px solid #edf1f6;font-size:12px}.simple-row span{color:#5f7187}.simple-row strong{color:#9a5a00}.production-card .bar{height:10px;background:#e8eef5;border-radius:999px;overflow:hidden}.production-card .bar span{display:block;height:100%;background:#1d75bd;border-radius:999px}.prod-numbers{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:18px}.prod-numbers div{background:#f7f9fc;border-radius:9px;padding:10px}.prod-numbers small,.prod-numbers strong{display:block}.prod-numbers small{font-size:9px;color:#8190a5}.prod-numbers strong{margin-top:4px;font-size:13px}.table-panel{padding:0;overflow:hidden}.table-heading{padding:20px 22px;border-bottom:1px solid #e3e9f1}.table-heading h2{margin:0 0 5px;font-size:20px}.table-heading p{margin:0;color:#718198;font-size:12px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f7f9fc;color:#65758b;text-transform:uppercase;font-size:9px;letter-spacing:.05em;text-align:left;padding:11px 14px;border-bottom:1px solid #e2e8f0}td{padding:13px 14px;border-bottom:1px solid #edf1f5;color:#2d405a}tbody tr:hover{background:#fbfcfe}.card-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.action-card{background:#fff;border:1px solid #dde5ef;border-radius:13px;padding:20px;cursor:pointer;text-align:left;min-height:118px}.action-card:hover{border-color:#95bfe4;box-shadow:0 7px 18px rgba(31,74,114,.09)}.action-card small{display:block;color:#7e8da3;font-size:9px;font-weight:800}.action-card strong{display:block;margin:8px 0;color:#17324f;font-size:15px}.action-card span{font-size:11px;color:#1267b3;font-weight:750}.toast{position:fixed;right:28px;top:98px;background:#133c61;color:#fff;padding:12px 16px;border-radius:10px;font-size:12px;z-index:30;box-shadow:0 8px 30px rgba(0,0,0,.16)}
        @media(max-width:1000px){.contractor-shell{grid-template-columns:82px 1fr}.sidebar{padding:18px 10px}.brand div,.company-card div,.sidebar nav button:not(.active){font-size:0}.brand img{width:40px}.sidebar nav button{justify-content:center}.sidebar nav button span{font-size:15px}.licence,.powered{display:none}.metrics{grid-template-columns:repeat(2,1fr)}.grid-two{grid-template-columns:1fr}.card-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:680px){.contractor-shell{display:block}.sidebar{position:relative;height:auto;min-height:0;display:block}.brand{border:0;padding-bottom:10px}.brand div{display:block}.company-card,.licence,.powered{display:none}.sidebar nav{flex-direction:row;overflow:auto}.sidebar nav button,.sidebar nav button:not(.active){font-size:0;min-width:44px;padding:9px}.sidebar nav button span{font-size:15px}.workspace header{height:auto;padding:14px 16px;align-items:flex-start}.workspace header h1{font-size:18px}.demo-badge,.header-actions button:not(.primary){display:none}.header-actions .primary{font-size:0;padding:9px}.header-actions .primary:after{content:'＋';font-size:16px}.content{padding:14px}.welcome{display:block;padding:20px}.welcome button{margin-top:14px}.metrics{grid-template-columns:1fr 1fr}.metric strong{font-size:21px}.card-grid{grid-template-columns:1fr}.prod-numbers{grid-template-columns:1fr}.toast{right:14px;left:14px;top:90px}}
      `}</style>
    </main>
  );
}

function Table({ title, subtitle, headers, rows }: { title: string; subtitle: string; headers: string[]; rows: string[][] }) {
  return <section className="table-panel"><div className="table-heading"><h2>{title}</h2><p>{subtitle}</p></div><div className="table-wrap"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></section>;
}

function Cards({ title, items, onOpen }: { title: string; items: string[]; onOpen: (name: string) => void }) {
  return <><div className="table-heading" style={{ padding: "0 0 18px", border: 0 }}><h2>{title}</h2><p>Role-based access keeps each contractor company inside its own workspace.</p></div><div className="card-grid">{items.map((item) => <button key={item} className="action-card" onClick={() => onOpen(item)}><small>TMM ASSET HEALTH</small><strong>{item}</strong><span>Open module →</span></button>)}</div></>;
}
