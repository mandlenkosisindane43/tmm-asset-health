"use client";

import { useEffect, useMemo, useState } from "react";

type Machine={id:number;fleetNumber:string;category:string;site:string;status:string;operatingHours:number;nextServiceHours?:number|null};
type EventRow={id:number;fleetNumber:string;eventType:string;severity:string;system:string;description:string;openedAt:string;downtimeHours:number;status:string;action?:string|null};
type ProductionRow={id:number;reportDate:string;fleetNumber:string;shiftHours:number;plannedDowntime:number;unplannedDowntime:number;operatingHours:number;productiveHours:number;tonnes:number};
type Subscription={id:number;companyName:string;customerType:string;planName:string;status:string;licenceStatus:string;maxMachines:number;maxSites:number};

type View="Dashboard"|"Breakdowns"|"Maintenance"|"Production"|"Reports"|"Fleet";
const nav:View[]=["Dashboard","Breakdowns","Maintenance","Production","Reports","Fleet"];
const fmt=(n:number)=>Number(n||0).toLocaleString("en-ZA");
const pct=(n:number)=>`${Number.isFinite(n)?n.toFixed(1):"0.0"}%`;

export default function RealCompanyAdmin(){
 const [view,setView]=useState<View>("Dashboard");
 const [machines,setMachines]=useState<Machine[]>([]);
 const [events,setEvents]=useState<EventRow[]>([]);
 const [production,setProduction]=useState<ProductionRow[]>([]);
 const [sub,setSub]=useState<Subscription|null>(null);
 const [loading,setLoading]=useState(true);

 async function load(){
  setLoading(true);
  const [m,e,p,s]=await Promise.all([
   fetch("/api/machines",{cache:"no-store"}).then(r=>r.ok?r.json():{machines:[]}).catch(()=>({machines:[]})),
   fetch("/api/events",{cache:"no-store"}).then(r=>r.ok?r.json():{events:[]}).catch(()=>({events:[]})),
   fetch("/api/production",{cache:"no-store"}).then(r=>r.ok?r.json():{records:[]}).catch(()=>({records:[]})),
   fetch("/api/subscriptions",{cache:"no-store"}).then(r=>r.ok?r.json():{subscriptions:[]}).catch(()=>({subscriptions:[]})),
  ]);
  setMachines(m.machines||[]);setEvents(e.events||[]);setProduction(p.records||[]);setSub((s.subscriptions||[])[0]||null);setLoading(false);
 }
 useEffect(()=>{load()},[]);

 const openEvents=useMemo(()=>events.filter(e=>e.status!=="closed"),[events]);
 const operating=machines.filter(m=>String(m.status).toLowerCase()==="operating").length;
 const attention=machines.filter(m=>["attention","warning"].includes(String(m.status).toLowerCase())).length;
 const down=machines.filter(m=>String(m.status).toLowerCase()==="down").length;
 const total=machines.length;
 const latestDate=production[0]?.reportDate;
 const todayRows=latestDate?production.filter(r=>r.reportDate===latestDate):[];
 const shiftHours=todayRows.reduce((a,r)=>a+Number(r.shiftHours||0),0);
 const opHours=todayRows.reduce((a,r)=>a+Number(r.operatingHours||0),0);
 const prodHours=todayRows.reduce((a,r)=>a+Number(r.productiveHours||0),0);
 const downtime=todayRows.reduce((a,r)=>a+Number(r.unplannedDowntime||0),0);
 const availability=shiftHours?((shiftHours-downtime)/shiftHours)*100:(total?operating/total*100:0);
 const utilisation=opHours?prodHours/opHours*100:0;
 const tonnes=todayRows.reduce((a,r)=>a+Number(r.tonnes||0),0);
 const monthlyTonnes=production.reduce((a,r)=>a+Number(r.tonnes||0),0);
 const totalDowntime=events.reduce((a,e)=>a+Number(e.downtimeHours||0),0);
 const maintenance=machines.map(m=>({unit:m.fleetNumber,task:"Scheduled service",due:m.nextServiceHours==null?null:Math.max(0,Number(m.nextServiceHours)-Number(m.operatingHours||0)),owner:"Workshop / Planner"})).filter(x=>x.due!==null).sort((a,b)=>Number(a.due)-Number(b.due));
 const dueSoon=maintenance.filter(m=>Number(m.due)<50).length;
 const overdue=machines.filter(m=>m.nextServiceHours!=null&&Number(m.operatingHours||0)>=Number(m.nextServiceHours)).length;
 const company=sub?.companyName||"Company Workspace";
 const customerType=sub?.customerType||"Mine / Contractor";

 const pareto=Object.entries(events.reduce<Record<string,number>>((acc,e)=>{const k=e.system||"Other";acc[k]=(acc[k]||0)+Number(e.downtimeHours||0);return acc},{})).sort((a,b)=>b[1]-a[1]).slice(0,6);
 const maxPareto=Math.max(...pareto.map(x=>x[1]),1);

 return <main className="sas-shell">
  <aside className="sas-side">
   <div className="sas-brand"><img src="/sindane-logo-sidebar.svg" alt="Sindane Asset Solutions"/></div>
   <div className="workspace-title"><small>COMPANY ADMIN</small><strong>{company}</strong><span>{customerType} environment</span></div>
   <nav>{nav.map(x=><button key={x} onClick={()=>setView(x)} className={view===x?"active":""}>{x}</button>)}</nav>
   <div className="side-links"><a href="/operations">Work Orders & Operations</a><a href="/operations">Users & Roles</a><a href="/subscription">Payments / Subscription</a><a href="/operations">Settings</a></div>
   <div className="lic"><small>SOFTWARE LICENCE</small><b>{sub?.licenceStatus==="active"?"● Active":"● Pending / setup"}</b><span>{sub?.planName||"Select Mine or Contractor package"}</span></div>
  </aside>

  <section className="main">
   <header className="top"><div><h2>TMM Asset Health</h2><span>Mine. Contractor. Workshop. One Solution.</span></div><div className="top-actions"><button onClick={load}>↻ Refresh</button><a href="/subscription">Subscription</a></div></header>
   <div className="crumb">{company.toUpperCase()} / {view.toUpperCase()}</div>
   <div className="page-head"><h1>{view==="Dashboard"?"Company Operations Dashboard":view}</h1><div><button onClick={()=>window.print()}>Print</button><a href="/operations">+ Quick capture</a></div></div>
   <div className="content">
    {loading&&<div className="notice">Loading your real company data…</div>}
    {!loading&&view==="Dashboard"&&<>
      <section className="hero"><div><small>{latestDate||"NO PRODUCTION DATE YET"} · LIVE COMPANY DATA</small><h2>Mine performance at a glance</h2><p>Fleet health, production, breakdowns and maintenance are linked in one workspace so your team can act before downtime grows.</p></div><div><button onClick={()=>setView("Breakdowns")}>View active breakdowns</button><button onClick={()=>setView("Reports")}>Open management report</button></div></section>
      <div className="metrics"><Metric label="Fleet availability" value={pct(availability)} note="Calculated from recorded shift data"/><Metric label="Utilisation" value={pct(utilisation)} note="Productive hours ÷ operating hours"/><Metric label="Machines operating" value={`${operating} / ${total}`} note={`${down} down · ${attention} attention`}/><Metric label="Production" value={`${fmt(tonnes)} t`} note={latestDate?`Latest recorded date: ${latestDate}`:"No production loaded"}/><Metric label="Open breakdowns" value={String(openEvents.length)} note={`${openEvents.filter(e=>e.severity==="critical").length} critical`}/></div>
      <div className="grid3"><Panel title="Current machine status"><div className="status"><b>{operating}<small>Operating</small></b><b>{attention}<small>Attention</small></b><b>{down}<small>Down</small></b></div>{machines.filter(m=>String(m.status).toLowerCase()!=="operating").slice(0,5).map(m=><Row key={m.id} a={m.fleetNumber} b={`${m.category} · ${m.site}`} c={m.status}/>)}</Panel><Panel title="Breakdown priorities">{openEvents.slice(0,5).map(e=><Row key={e.id} a={e.fleetNumber} b={e.description} c={`${Number(e.downtimeHours||0).toFixed(1)} h · ${e.severity}`}/>)}</Panel><Panel title="Production vs target"><div className="big">{fmt(tonnes)} t</div><p className="muted">Target can be configured in the operational console.</p><div className="insight"><b>SAS insight:</b> Availability and utilisation should be reviewed together before deciding whether low production is a reliability problem.</div></Panel></div>
      <div className="grid3"><Panel title="Services approaching due">{maintenance.slice(0,5).map(m=><Row key={m.unit} a={m.unit} b={m.task} c={`${Math.round(Number(m.due))} h`}/>)}</Panel><Panel title="Where downtime is being lost">{pareto.length?pareto.map(([k,v])=><div className="pareto" key={k}><b>{k}</b><span><i style={{width:`${v/maxPareto*100}%`}}/></span><strong>{v.toFixed(1)} h</strong></div>):<Empty text="No downtime events recorded yet."/>}</Panel><Panel title="Recommended engineering actions"><Action n="1" text={pareto[0]?`Prioritise ${pareto[0][0]} failures — this is currently the highest recorded downtime category.`:"Start capturing breakdown systems and downtime to generate automatic priorities."}/><Action n="2" text={dueSoon?`${dueSoon} machine(s) are within 50 h of service. Lock the work into the maintenance plan.`:"No services are currently inside the 50 h warning window."}/><Action n="3" text={utilisation&&availability-utilisation>8?"Utilisation trails availability. Review dispatch, standby and operating delays.":"Continue monitoring availability, utilisation and production together."}/></Panel></div>
    </>}

    {!loading&&view==="Breakdowns"&&<><div className="metrics four"><Metric label="Open events" value={String(openEvents.length)} note="Current open breakdowns"/><Metric label="Current downtime" value={`${openEvents.reduce((a,e)=>a+Number(e.downtimeHours||0),0).toFixed(1)} h`} note="Open events only"/><Metric label="Total recorded downtime" value={`${totalDowntime.toFixed(1)} h`} note="All loaded events"/><Metric label="Critical events" value={String(openEvents.filter(e=>e.severity==="critical").length)} note="Requires priority response"/></div><Table title="Breakdown register" headers={["Fleet","System","Fault / reason","Opened","Downtime","Priority","Status"]} rows={events.map(e=>[e.fleetNumber,e.system,e.description,new Date(e.openedAt).toLocaleString("en-ZA"),`${Number(e.downtimeHours||0).toFixed(1)} h`,e.severity,e.status])}/></>}

    {!loading&&view==="Maintenance"&&<><div className="metrics four"><Metric label="Service compliance" value={overdue?"Review":"On track"} note="Based on current hour meters"/><Metric label="Due < 50 h" value={String(dueSoon)} note="Schedule before threshold"/><Metric label="Overdue services" value={String(overdue)} note="Operating hours at / above threshold"/><Metric label="Open work orders" value="—" note="Managed in Operations"/></div><Table title="Maintenance planner" headers={["Fleet","Task","Due in","Risk","Responsible"]} rows={maintenance.map(m=>[m.unit,m.task,`${Math.round(Number(m.due))} h`,Number(m.due)<50?"Due soon":"Plan",m.owner])}/></>}

    {!loading&&view==="Production"&&<><div className="metrics four"><Metric label="Latest actual" value={`${fmt(tonnes)} t`} note={latestDate||"No date"}/><Metric label="Availability" value={pct(availability)} note="Latest production period"/><Metric label="Utilisation" value={pct(utilisation)} note="Latest production period"/><Metric label="Records loaded" value={String(production.length)} note="Production history rows"/></div><Table title="Daily production history" headers={["Date","Fleet","Tonnes","Shift h","Operating h","Productive h","Downtime h"]} rows={production.map(r=>[r.reportDate,r.fleetNumber,`${fmt(r.tonnes)} t`,r.shiftHours,r.operatingHours,r.productiveHours,r.unplannedDowntime])}/></>}

    {!loading&&view==="Reports"&&<><section className="report-hero"><div><small>MANAGEMENT REPORT · LIVE COMPANY DATA</small><h2>Fleet performance report</h2><p>One management view combining production, reliability, maintenance and the engineering actions that need attention.</p></div><button onClick={()=>window.print()}>Print / PDF</button></section><div className="metrics"><Metric label="Average availability" value={pct(availability)} note="Based on current loaded records"/><Metric label="Average utilisation" value={pct(utilisation)} note="Based on current loaded records"/><Metric label="Production loaded" value={`${fmt(monthlyTonnes)} t`} note="All current records"/><Metric label="Total downtime" value={`${totalDowntime.toFixed(1)} h`} note={`${events.length} recorded events`}/><Metric label="Due < 50 h" value={String(dueSoon)} note="Maintenance attention"/></div><div className="grid2"><Panel title="Downtime Pareto">{pareto.length?pareto.map(([k,v])=><div className="pareto" key={k}><b>{k}</b><span><i style={{width:`${v/maxPareto*100}%`}}/></span><strong>{v.toFixed(1)} h</strong></div>):<Empty text="Capture breakdowns to build the Pareto."/>}</Panel><Panel title="Recommended engineering actions"><Action n="1" text={pareto[0]?`Investigate ${pareto[0][0]} as the leading downtime category.`:"No dominant failure category yet."}/><Action n="2" text={`${dueSoon} service(s) are within the 50 h planning window.`}/><Action n="3" text="Use production, availability and utilisation together in the monthly management review."/></Panel></div></>}

    {!loading&&view==="Fleet"&&<Table title="Fleet register" headers={["Fleet","Machine type","Site / area","Status","Operating hours","Next service"]} rows={machines.map(m=>[m.fleetNumber,m.category,m.site,m.status,fmt(m.operatingHours),m.nextServiceHours==null?"Not set":fmt(m.nextServiceHours)])}/>} 
   </div>
  </section>
  <style>{css}</style>
 </main>
}

function Metric({label,value,note}:{label:string;value:string;note:string}){return <article className="metric"><small>{label}</small><strong>{value}</strong><span>{note}</span></article>}
function Panel({title,children}:{title:string;children:React.ReactNode}){return <section className="panel"><h3>{title}</h3>{children}</section>}
function Row({a,b,c}:{a:string;b:string;c:string}){return <div className="row"><b>{a}</b><span>{b}</span><strong>{c}</strong></div>}
function Action({n,text}:{n:string;text:string}){return <div className="action"><b>{n}</b><span>{text}</span></div>}
function Empty({text}:{text:string}){return <p className="muted">{text}</p>}
function Table({title,headers,rows}:{title:string;headers:string[];rows:(string|number)[][]}){return <section className="table-card"><h2>{title}</h2><div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>):<tr><td colSpan={headers.length} className="emptycell">No records yet. Use Quick capture / Operations to add real company data.</td></tr>}</tbody></table></div></section>}

const css=`
*{box-sizing:border-box}.sas-shell{min-height:100vh;background:#f4f7fb;color:#0f1d36;font-family:Arial,sans-serif;display:grid;grid-template-columns:255px minmax(0,1fr)}.sas-side{background:#102039;color:#fff;min-height:100vh;padding:20px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}.sas-brand img{width:205px;max-height:76px}.workspace-title{margin:18px 4px;padding:13px;border:1px solid #304563;border-radius:12px}.workspace-title small,.workspace-title strong,.workspace-title span{display:block}.workspace-title small{font-size:10px;color:#8fa5c5;font-weight:900}.workspace-title strong{font-size:14px;margin:5px 0}.workspace-title span{font-size:11px;color:#b7c5d8}.sas-side nav{display:grid;gap:5px}.sas-side nav button,.side-links a{border:0;background:transparent;color:#dfe8f6;text-align:left;padding:12px 14px;border-radius:9px;font-weight:800;text-decoration:none;cursor:pointer}.sas-side nav button.active{background:#263d60;border-left:4px solid #e7b63f;color:white}.side-links{display:grid;margin-top:14px;border-top:1px solid #324763;padding-top:11px}.side-links a{font-size:13px}.lic{margin-top:auto;border-top:1px solid #324763;padding:16px 6px}.lic small,.lic b,.lic span{display:block}.lic small{color:#8fa5c5;font-size:10px;font-weight:900}.lic b{color:#7be0a9;margin:7px 0}.lic span{font-size:11px;color:#c1cee0}.main{min-width:0}.top{height:70px;background:#fff;border-bottom:1px solid #dce4ee;padding:0 25px;display:flex;justify-content:space-between;align-items:center}.top h2{margin:0;font-size:22px}.top span{font-size:12px;color:#5f6f87}.top-actions{display:flex;gap:8px}.top-actions button,.top-actions a,.page-head button,.page-head a,.hero button,.report-hero button{border:1px solid #cbd6e5;background:white;padding:9px 13px;border-radius:9px;font-weight:900;color:#13213a;text-decoration:none;cursor:pointer}.crumb{padding:18px 25px 5px;font-size:10px;font-weight:900;color:#70809b;letter-spacing:.7px}.page-head{background:white;border-bottom:1px solid #dce4ee;padding:5px 25px 16px;display:flex;justify-content:space-between;align-items:center}.page-head h1{margin:0;font-size:24px}.page-head>div{display:flex;gap:8px}.page-head a{background:#102039;color:#fff}.content{padding:22px;max-width:1550px;margin:auto}.notice{padding:15px;background:#fff4cf;border:1px solid #f0d47d;border-radius:10px}.hero,.report-hero{background:linear-gradient(110deg,#172945,#304b72);color:white;border-radius:17px;padding:24px 27px;display:flex;justify-content:space-between;gap:20px;align-items:center}.hero h2,.report-hero h2{font-size:29px;margin:7px 0}.hero p,.report-hero p{margin:0;max-width:760px;line-height:1.5;color:#e5edf8}.hero>div:last-child{display:grid;gap:8px}.metrics{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:13px;margin-top:16px}.metrics.four{grid-template-columns:repeat(4,minmax(180px,1fr))}.metric,.panel,.table-card{background:#fff;border:1px solid #dce4ee;border-radius:14px;box-shadow:0 5px 18px rgba(25,42,66,.03)}.metric{padding:18px}.metric small{font-weight:900;color:#71809a;display:block}.metric strong{font-size:29px;display:block;margin:9px 0}.metric span{font-size:11px;color:#56677f;line-height:1.4}.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:16px}.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}.panel{padding:19px}.panel h3{font-size:19px;margin:0 0 14px}.status{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:13px}.status b{padding:13px;border-radius:10px;background:#f4f7fb;font-size:23px}.status small{display:block;font-size:10px;color:#65768f}.row{display:grid;grid-template-columns:80px 1fr auto;gap:10px;padding:11px 0;border-bottom:1px solid #edf1f6;align-items:center;font-size:12px}.row span{color:#40516a}.row strong{font-size:11px}.big{font-size:34px;font-weight:900}.muted{color:#6a7890;font-size:12px}.insight{margin-top:17px;background:#edf5fc;padding:13px;border-radius:9px;font-size:12px;line-height:1.45}.pareto{display:grid;grid-template-columns:90px 1fr 55px;gap:10px;align-items:center;margin:11px 0;font-size:11px}.pareto span{height:13px;background:#e8edf3;border-radius:8px;overflow:hidden}.pareto i{display:block;height:100%;background:#29476f;border-radius:8px}.action{display:grid;grid-template-columns:30px 1fr;gap:10px;border:1px solid #e1e7ef;border-radius:10px;padding:11px;margin:9px 0;font-size:12px;line-height:1.4}.action b{width:28px;height:28px;border-radius:50%;background:#edf2f8;display:grid;place-items:center}.table-card{overflow:hidden}.table-card h2{padding:20px;margin:0;border-bottom:1px solid #e1e7ef}.table-wrap{overflow:auto}.table-card table{width:100%;border-collapse:collapse;font-size:12px}.table-card th{text-align:left;background:#f6f8fb;color:#65758e;font-size:10px;letter-spacing:.7px;padding:13px}.table-card td{padding:13px;border-top:1px solid #e7ecf2}.emptycell{text-align:center!important;color:#78879d;padding:28px!important}.report-hero{margin-bottom:0}.report-hero button{align-self:flex-start}@media(max-width:1100px){.metrics,.metrics.four{grid-template-columns:repeat(2,1fr)}.grid3{grid-template-columns:1fr}.grid2{grid-template-columns:1fr}}@media(max-width:760px){.sas-shell{grid-template-columns:1fr}.sas-side{position:relative;height:auto;min-height:0}.sas-side nav{grid-template-columns:repeat(2,1fr)}.main{width:100%}.top{height:auto;padding:14px}.page-head{align-items:flex-start;gap:12px;flex-direction:column}.metrics,.metrics.four{grid-template-columns:1fr}.hero,.report-hero{flex-direction:column;align-items:flex-start}.content{padding:12px}}
`;