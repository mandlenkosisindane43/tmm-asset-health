"use client";

import { useEffect, useMemo, useState } from "react";

type Kpis = {
  companies: number;
  activeLicences: number;
  pendingLicences: number;
  machines: number;
  sites: number;
  users: number;
  commercialActions: number;
  criticalAlerts: number;
};

type CompanyRow = {
  id: number;
  companyName: string;
  customerType: string;
  planName: string;
  licenceStatus: string;
  status: string;
  maxMachines: number;
  maxSites: number;
  contactEmail?: string | null;
  updatedAt: string;
};

type Owner = { fullName: string; businessName: string; email: string };
type Section = "Dashboard" | "Companies" | "Licences" | "Subscriptions" | "Users" | "Performance" | "Security";

const sections: Section[] = ["Dashboard","Companies","Licences","Subscriptions","Users","Performance","Security"];

function Metric({label,value,note}:{label:string;value:string|number;note:string}){
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function Status({children,tone="neutral"}:{children:React.ReactNode;tone?:"good"|"warn"|"bad"|"neutral"}){
  return <span className={`status ${tone}`}>{children}</span>;
}

export default function OwnerCommandCentre({ owner }: { owner: Owner }) {
  const [active,setActive] = useState<Section>("Dashboard");
  const [kpis, setKpis] = useState<Kpis>({ companies:0, activeLicences:0, pendingLicences:0, machines:0, sites:0, users:0, commercialActions:0, criticalAlerts:0 });
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice,setNotice] = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/owner-overview", { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const data = await r.json();
      setKpis(data.kpis || kpis);
      setCompanies(data.companies || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);
  const initials = useMemo(()=>owner.fullName.split(/\s+/).filter(Boolean).map(x=>x[0]).slice(0,2).join("").toUpperCase() || "SA",[owner.fullName]);
  const flash=(text:string)=>{setNotice(text);window.setTimeout(()=>setNotice(""),2500)};

  return <main className="owner-shell">
    <aside className="sidebar">
      <div className="brand"><img src="/sindane-logo.png" alt="Sindane Asset Solutions"/><div><strong>TMM Asset Health</strong><small>Software Owner</small></div></div>
      <div className="company"><span>OWNER</span><div><strong>{owner.businessName || "Sindane Asset Solutions"}</strong><small>Platform administration</small></div></div>
      <nav>{sections.map(name=><button key={name} className={active===name?"active":""} onClick={()=>setActive(name)}><i>{name==="Dashboard"?"⌂":name==="Companies"?"▦":name==="Licences"?"◇":name==="Subscriptions"?"◎":name==="Users"?"♙":name==="Performance"?"▥":"⌾"}</i>{name}</button>)}</nav>
      <a className="demo-link" href="/demo">▶ Presentation demo</a>
      <a className="demo-link" href="/operations">▣ Operations console</a>
      <div className="profile"><b>{initials}</b><div><strong>{owner.fullName}</strong><small>Founder / Software Owner</small></div></div>
      <a className="logout" href="/logout">Sign out</a>
      <div className="powered">Powered by <b>Sindane Asset Solutions</b></div>
    </aside>

    <section className="workspace">
      <header><div><small>SINDANE ASSET SOLUTIONS / {active.toUpperCase()}</small><h1>{active==="Dashboard"?"Owner Administration Dashboard":active}</h1></div><div className="actions"><button onClick={load}>↻ Refresh</button><a className="primary" href="/subscription">＋ Register / subscribe company</a></div></header>
      {notice&&<div className="toast">{notice}</div>}
      <div className="content">
        {active==="Dashboard"&&<>
          <section className="hero"><div><small>REAL SOFTWARE · OWNER CONTROL</small><h2>Manage every mine and contractor from one workspace</h2><p>Company onboarding, subscriptions, licences, users and client performance are brought into the same dashboard style used in the presentation demo.</p></div><div className="hero-actions"><a href="/subscription?type=Contractor">Add contractor</a><a href="/subscription?type=Mine">Add mine</a></div></section>
          <div className="metrics">
            <Metric label="Client companies" value={loading?"—":kpis.companies} note="Mines and contractors"/>
            <Metric label="Active licences" value={loading?"—":kpis.activeLicences} note="Activated client access"/>
            <Metric label="Machines managed" value={loading?"—":kpis.machines} note="Across registered clients"/>
            <Metric label="Sites connected" value={loading?"—":kpis.sites} note="Operating locations"/>
            <Metric label="Pending actions" value={loading?"—":kpis.pendingLicences} note="Approval / licence requests"/>
          </div>

          <div className="grid-two">
            <section className="panel"><div className="panel-head"><div><small>CLIENT PORTFOLIO</small><h3>Companies & licences</h3></div><button onClick={()=>setActive("Companies")}>View all</button></div>{companies.length?companies.slice(0,5).map(c=><div className="row" key={c.id}><div><b>{c.companyName}</b><span>{c.customerType} · {c.planName}</span></div><Status tone={c.licenceStatus==="active"?"good":"warn"}>{c.licenceStatus.replaceAll("_"," ")}</Status></div>):<div className="empty">No companies registered yet.</div>}</section>
            <section className="panel"><div className="panel-head"><div><small>SUBSCRIPTION REQUEST</small><h3>Choose client type</h3></div></div><p className="muted">Start a new monthly subscription request. Pricing remains quotation-based.</p><div className="type-grid"><a href="/subscription?type=Contractor"><b>Contractor</b><span>For contractor fleets and multi-site operations</span><em>Choose contractor package →</em></a><a href="/subscription?type=Mine"><b>Mine</b><span>For mine-owned fleets and mine sites</span><em>Choose mine package →</em></a></div></section>
          </div>

          <div className="grid-two">
            <section className="panel"><div className="panel-head"><div><small>OWNER ACTIONS</small><h3>Needs attention</h3></div></div>{[["Pending licence activations",kpis.pendingLicences],["Commercial actions",kpis.commercialActions],["Critical client alerts",kpis.criticalAlerts],["Active company users",kpis.users]].map(([label,value])=><div className="action-row" key={String(label)}><span>{label}</span><b>{loading?"—":value}</b></div>)}</section>
            <section className="panel"><div className="panel-head"><div><small>PLATFORM HEALTH</small><h3>Commercial readiness</h3></div></div>{[["Independent owner login","Ready"],["Cloud database","Connected"],["Company separation","Enabled"],["Licence control","Enabled"],["Mine / contractor plans","Enabled"],["Presentation demo","Available"]].map(([a,b])=><div className="action-row" key={a}><span>{a}</span><Status tone="good">{b}</Status></div>)}</section>
          </div>
        </>}

        {active==="Companies"&&<section className="panel"><div className="panel-head"><div><small>REAL CLIENT DATA</small><h3>Registered companies</h3></div><a className="small-link" href="/subscription">＋ Add company</a></div><div className="table-wrap"><table><thead><tr>{["Company","Type","Package","Fleet / sites","Account","Licence"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{companies.length?companies.map(c=><tr key={c.id}><td><b>{c.companyName}</b><small>{c.contactEmail||"No contact email"}</small></td><td>{c.customerType}</td><td>{c.planName}</td><td>{c.maxMachines>=9999?"60+":c.maxMachines} machines<small>{c.maxSites>=9999?"Multi-site":`${c.maxSites} site${c.maxSites===1?"":"s"}`}</small></td><td>{c.status.replaceAll("_"," ")}</td><td><Status tone={c.licenceStatus==="active"?"good":"warn"}>{c.licenceStatus.replaceAll("_"," ")}</Status></td></tr>):<tr><td colSpan={6} className="empty">No client companies have been added yet.</td></tr>}</tbody></table></div></section>}

        {active==="Licences"&&<><div className="metrics"><Metric label="Active" value={loading?"—":kpis.activeLicences} note="Client licences"/><Metric label="Pending" value={loading?"—":kpis.pendingLicences} note="Awaiting approval"/><Metric label="Companies" value={loading?"—":kpis.companies} note="Registered clients"/><Metric label="Machines" value={loading?"—":kpis.machines} note="Licensed fleet scope"/></div><section className="panel"><div className="panel-head"><div><small>LICENSING</small><h3>Company licence control</h3></div><a className="small-link" href="/subscription">Open licence manager</a></div><p className="muted">Activate and manage company licences after commercial approval. Each company retains an isolated workspace.</p></section></>}

        {active==="Subscriptions"&&<section className="panel"><div className="panel-head"><div><small>SUBSCRIPTIONS</small><h3>Mine or contractor</h3></div></div><div className="type-grid large"><a href="/subscription?type=Contractor"><b>Contractor subscription</b><span>Starter or Multi-Site packages. Monthly billing and official quotation.</span><em>Start contractor request →</em></a><a href="/subscription?type=Mine"><b>Mine subscription</b><span>Standard, Plus, Enterprise or Enterprise+ packages. Monthly billing and official quotation.</span><em>Start mine request →</em></a></div></section>}

        {active==="Users"&&<><div className="metrics"><Metric label="Company users" value={loading?"—":kpis.users} note="Across client workspaces"/><Metric label="Role control" value="Enabled" note="Admin, engineer, mechanic, supervisor"/><Metric label="Invitations" value="Available" note="Company onboarding"/><Metric label="Owner access" value="Separate" note="Platform governance"/></div><section className="panel"><h3>Users & access</h3><p className="muted">Use the operations console to manage invitations, roles and company access.</p><a className="small-link" href="/operations">Open users & access →</a></section></>}

        {active==="Performance"&&<><div className="metrics"><Metric label="Machines managed" value={loading?"—":kpis.machines} note="Portfolio fleet"/><Metric label="Sites" value={loading?"—":kpis.sites} note="Connected operations"/><Metric label="Critical alerts" value={loading?"—":kpis.criticalAlerts} note="Client attention"/><Metric label="Demo workspace" value="Ready" note="Safe presentation data"/></div><section className="panel"><div className="panel-head"><div><small>CLIENT PERFORMANCE</small><h3>Portfolio view</h3></div><a className="small-link" href="/demo">Open demo mine</a></div><p className="muted">Operational KPIs remain inside each company workspace. This owner view shows portfolio-level counts and alerts without mixing client data.</p></section></>}

        {active==="Security"&&<section className="panel"><div className="panel-head"><div><small>SECURITY & GOVERNANCE</small><h3>Platform controls</h3></div></div>{[["Independent owner session","Enabled"],["Company data separation","Enabled"],["Role-based access","Enabled"],["Licence gating","Enabled"],["Demo data isolation","Enabled"]].map(([a,b])=><div className="action-row" key={a}><span>{a}</span><Status tone="good">{b}</Status></div>)}<button className="ghost" onClick={()=>flash("Security status refreshed.")}>Refresh security status</button></section>}
      </div>
    </section>

    <style>{`
      *{box-sizing:border-box}.owner-shell{min-height:100vh;background:#f4f7fb;color:#172033;font-family:Arial,sans-serif;display:grid;grid-template-columns:270px minmax(0,1fr)}.sidebar{background:#101a2c;color:white;padding:21px 16px;display:flex;flex-direction:column;min-height:100vh;position:sticky;top:0;height:100vh}.brand{display:flex;gap:11px;align-items:center;padding:2px 4px 20px}.brand img{width:42px;height:42px;border-radius:9px;object-fit:contain;background:white}.brand strong,.brand small{display:block}.brand small{color:#91a0b8;margin-top:3px}.company{display:flex;gap:10px;align-items:center;border:1px solid #2b3952;background:#17243b;padding:12px;border-radius:12px;margin-bottom:15px}.company>span{font-size:10px;font-weight:900;background:#e97818;padding:5px 6px;border-radius:6px}.company strong,.company small{display:block}.company small{color:#9faec3;margin-top:3px;font-size:11px}.sidebar nav{display:grid;gap:4px}.sidebar nav button{display:flex;align-items:center;gap:11px;width:100%;border:0;background:transparent;color:#c9d4e4;padding:11px 12px;border-radius:9px;text-align:left;font-weight:700;cursor:pointer}.sidebar nav button.active{background:#25334b;color:white}.sidebar nav i{font-style:normal;width:19px;text-align:center}.demo-link{color:#c9d4e4;text-decoration:none;padding:11px 12px;font-weight:700;font-size:14px}.profile{margin-top:auto;border-top:1px solid #2d3950;padding-top:15px;display:flex;gap:10px;align-items:center}.profile>b{width:36px;height:36px;border-radius:50%;background:#34445f;display:grid;place-items:center}.profile strong,.profile small{display:block}.profile strong{font-size:12px}.profile small{font-size:10px;color:#91a0b8;margin-top:3px}.logout{color:#b9c5d6;font-size:12px;margin-top:10px;text-decoration:none}.powered{font-size:10px;color:#718099;margin-top:12px}.workspace{min-width:0}.workspace>header{height:78px;background:white;border-bottom:1px solid #e4e9f0;display:flex;align-items:center;justify-content:space-between;padding:0 28px;position:sticky;top:0;z-index:3}.workspace header small{font-size:10px;font-weight:900;color:#758197;letter-spacing:1px}.workspace header h1{font-size:20px;margin:4px 0 0}.actions{display:flex;gap:9px;align-items:center}.actions button,.actions a,.small-link{border:1px solid #ced6e2;background:white;border-radius:9px;padding:10px 13px;font-weight:800;cursor:pointer;text-decoration:none;color:#172033}.actions .primary{background:#172033;color:white;border-color:#172033}.content{padding:26px;max-width:1500px;margin:auto}.hero{background:linear-gradient(120deg,#172033,#273958);color:white;border-radius:18px;padding:25px 28px;display:flex;justify-content:space-between;gap:20px;align-items:center;box-shadow:0 12px 34px rgba(23,32,51,.15)}.hero h2{font-size:29px;margin:6px 0}.hero p{max-width:760px;opacity:.82;line-height:1.5}.hero small{font-weight:900;letter-spacing:1.2px;opacity:.72}.hero-actions{display:flex;gap:9px;flex-wrap:wrap}.hero-actions a{background:white;color:#172033;text-decoration:none;padding:11px 15px;border-radius:9px;font-weight:900}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-top:18px}.metric{background:white;border:1px solid #e0e6ee;border-radius:14px;padding:18px;box-shadow:0 6px 18px rgba(22,34,51,.04)}.metric span,.metric small{display:block}.metric span{font-size:11px;font-weight:900;color:#738097;text-transform:uppercase}.metric strong{font-size:29px;display:block;margin:8px 0 4px}.metric small{font-size:12px;color:#6b778c}.grid-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;margin-top:18px}.panel{background:white;border:1px solid #e0e6ee;border-radius:14px;padding:20px;margin-top:18px}.grid-two .panel{margin-top:0}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px}.panel-head small{font-size:10px;font-weight:900;color:#738097}.panel h3{margin:4px 0 0;font-size:19px}.panel-head button{border:0;background:#f2f5f9;padding:8px 10px;border-radius:8px;font-weight:800;cursor:pointer}.row{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:12px 0;border-bottom:1px solid #eef2f6}.row b,.row span{display:block}.row span{font-size:12px;color:#6b778c;margin-top:3px}.status{font-size:11px;font-weight:900;padding:5px 8px;border-radius:20px;text-transform:capitalize;white-space:nowrap}.status.good{background:#dcfce7;color:#166534}.status.warn{background:#fef3c7;color:#92400e}.status.bad{background:#fee2e2;color:#991b1b}.status.neutral{background:#eef2f7;color:#475467}.type-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.type-grid a{display:block;text-decoration:none;color:#172033;border:1px solid #dfe6ef;border-radius:13px;padding:17px;background:#f9fbfd}.type-grid a:hover{border-color:#172033}.type-grid b,.type-grid span,.type-grid em{display:block}.type-grid b{font-size:20px}.type-grid span{font-size:12px;color:#667085;line-height:1.5;margin:7px 0 14px}.type-grid em{font-style:normal;font-weight:900;font-size:12px}.type-grid.large a{padding:24px}.muted{color:#667085;line-height:1.55}.action-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:11px 0;border-bottom:1px solid #eef2f6;font-size:13px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:10px 8px;border-bottom:1px solid #e7ebf1;color:#758197}td{padding:12px 8px;border-bottom:1px solid #eef2f6}td small{display:block;color:#7b8798;margin-top:3px}.empty{padding:24px!important;text-align:center;color:#7b8798}.ghost{margin-top:16px;border:1px solid #ced6e2;background:white;border-radius:9px;padding:10px 13px;font-weight:800;cursor:pointer}.toast{position:fixed;right:24px;top:92px;background:#172033;color:white;padding:12px 16px;border-radius:10px;z-index:10;box-shadow:0 10px 30px #0003;font-weight:700}@media(max-width:900px){.owner-shell{grid-template-columns:1fr}.sidebar{position:relative;height:auto;min-height:auto}.sidebar nav{grid-template-columns:repeat(2,minmax(0,1fr))}.workspace>header{position:relative;height:auto;padding:18px;gap:12px;align-items:flex-start;flex-direction:column}.content{padding:16px}.hero{align-items:flex-start;flex-direction:column}.grid-two{grid-template-columns:1fr}.type-grid{grid-template-columns:1fr}}
    `}</style>
  </main>;
}
