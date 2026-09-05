"use client";

import { useEffect, useState } from "react";

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

type Owner = {
  fullName: string;
  businessName: string;
  email: string;
};

const cards = [
  ["Client Companies", "companies", "Independent contractor and mine workspaces"],
  ["Active Licences", "activeLicences", "Paid and activated client access"],
  ["Machines Managed", "machines", "Registered fleet assets across clients"],
  ["Sites Connected", "sites", "Operating sites represented in the platform"],
  ["Pending Actions", "pendingLicences", "Licences awaiting approval or activation"],
] as const;

export default function OwnerCommandCentre({ owner }: { owner: Owner }) {
  const [kpis, setKpis] = useState<Kpis>({ companies:0, activeLicences:0, pendingLicences:0, machines:0, sites:0, users:0, commercialActions:0, criticalAlerts:0 });
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  const initials = owner.fullName.split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase();
  const linkStyle = { display:"flex",alignItems:"center",gap:11,padding:"11px 13px",borderRadius:10,textDecoration:"none",color:"#dce5f2",fontWeight:700,fontSize:14 } as const;

  return (
    <main style={{minHeight:"100vh",background:"#f4f7fb",fontFamily:"Arial, sans-serif",color:"#162033",display:"grid",gridTemplateColumns:"260px minmax(0,1fr)"}}>
      <aside style={{background:"#111a2b",color:"white",padding:"22px 18px",display:"flex",flexDirection:"column",minHeight:"100vh",position:"sticky",top:0,height:"100vh",boxSizing:"border-box"}}>
        <div style={{display:"flex",gap:11,alignItems:"center",padding:"4px 4px 24px"}}>
          <img src="/sindane-logo.png" alt="Sindane Asset Solutions" style={{width:42,height:42,borderRadius:9,objectFit:"contain",background:"white"}}/>
          <div><strong style={{display:"block",fontSize:15}}>TMM Asset Health</strong><small style={{color:"#91a0b8"}}>Software Owner</small></div>
        </div>

        <nav style={{display:"grid",gap:4}}>
          <a href="/" style={{...linkStyle,background:"#24324a",color:"white"}}>⌂ Overview</a>
          <a href="/subscription" style={linkStyle}>◎ Companies & licences</a>
          <a href="/subscription" style={linkStyle}>◇ Subscriptions & licensing</a>
          <a href="/operations" style={linkStyle}>▣ Commercial centre</a>
          <a href="/operations" style={linkStyle}>♙ Users & access</a>
          <a href="/operations" style={linkStyle}>▥ Client performance</a>
          <a href="/operations" style={linkStyle}>⌾ Security & audit</a>
          <a href="#platform-health" style={linkStyle}>◈ Platform health</a>
          <a href="/contractor-demo" style={linkStyle}>▶ Presentation demo</a>
        </nav>

        <div style={{marginTop:"auto",borderTop:"1px solid #2d3950",paddingTop:16}}>
          <div style={{display:"flex",gap:10,alignItems:"center"}}><b style={{width:36,height:36,borderRadius:"50%",background:"#34445f",display:"grid",placeItems:"center"}}>{initials}</b><div><strong style={{fontSize:13,display:"block"}}>{owner.fullName}</strong><small style={{color:"#91a0b8"}}>Founder / Software Owner</small></div></div>
          <a href="/signout-with-chatgpt?return_to=/" style={{display:"block",marginTop:12,color:"#b9c5d6",fontSize:12}}>Sign out</a>
        </div>
      </aside>

      <section style={{minWidth:0}}>
        <header style={{height:72,background:"white",borderBottom:"1px solid #e4e9f0",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 28px",position:"sticky",top:0,zIndex:3}}>
          <div><small style={{fontWeight:800,color:"#758197",letterSpacing:.8}}>SINDANE ASSET SOLUTIONS</small><strong style={{display:"block",fontSize:17}}>Software Owner Command Centre</strong></div>
          <div style={{display:"flex",gap:9}}><button onClick={load} style={{border:"1px solid #ced6e2",background:"white",borderRadius:9,padding:"9px 12px",fontWeight:800,cursor:"pointer"}}>↻ Refresh</button><a href="/subscription" style={{background:"#172033",color:"white",textDecoration:"none",borderRadius:9,padding:"10px 14px",fontWeight:800}}>＋ Add / manage company</a></div>
        </header>

        <div style={{padding:28,maxWidth:1500,margin:"0 auto"}}>
          <section style={{background:"linear-gradient(120deg,#172033,#273958)",color:"white",borderRadius:18,padding:"26px 28px",display:"flex",justifyContent:"space-between",gap:20,alignItems:"center",flexWrap:"wrap",boxShadow:"0 12px 34px rgba(23,32,51,.15)"}}>
            <div><small style={{fontWeight:900,letterSpacing:1.2,opacity:.7}}>OWNER OVERVIEW</small><h1 style={{margin:"7px 0 7px",fontSize:31}}>Control every client company from one place</h1><p style={{margin:0,opacity:.82,maxWidth:760,lineHeight:1.55}}>Manage contractors and mines, licences, subscriptions, users, commercial actions and platform readiness while each client keeps an isolated operational workspace.</p></div>
            <div style={{display:"flex",gap:9,flexWrap:"wrap"}}><a href="/operations" style={{background:"white",color:"#172033",textDecoration:"none",padding:"11px 15px",borderRadius:9,fontWeight:900}}>Open operations console</a><a href="/contractor-demo" style={{border:"1px solid rgba(255,255,255,.35)",color:"white",textDecoration:"none",padding:"11px 15px",borderRadius:9,fontWeight:900}}>Presentation demo</a></div>
          </section>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginTop:18}}>
            {cards.map(([label,key,note])=><article key={key} style={{background:"white",border:"1px solid #e0e6ee",borderRadius:14,padding:18,boxShadow:"0 6px 18px rgba(22,34,51,.04)"}}><small style={{fontWeight:800,color:"#738097"}}>{label.toUpperCase()}</small><strong style={{fontSize:31,display:"block",margin:"8px 0 4px"}}>{loading?"—":kpis[key]}</strong><span style={{fontSize:12,color:"#6b778c",lineHeight:1.4}}>{note}</span></article>)}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.7fr) minmax(280px,.8fr)",gap:18,marginTop:18}}>
            <section style={{background:"white",border:"1px solid #e0e6ee",borderRadius:14,padding:20}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",marginBottom:14}}><div><small style={{fontWeight:800,color:"#738097"}}>CLIENT PORTFOLIO</small><h2 style={{margin:"5px 0 0",fontSize:20}}>Companies & licences</h2></div><a href="/subscription" style={{fontWeight:800,color:"#172033"}}>Manage licences →</a></div>
              <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}><thead><tr>{["Company","Type","Package","Fleet / sites","Account","Licence"].map(h=><th key={h} style={{textAlign:"left",padding:"10px 8px",borderBottom:"1px solid #e7ebf1",color:"#758197"}}>{h}</th>)}</tr></thead><tbody>{companies.length?companies.map(c=><tr key={c.id}><td style={{padding:"12px 8px",borderBottom:"1px solid #eef2f6"}}><b>{c.companyName}</b><small style={{display:"block",color:"#7b8798"}}>{c.contactEmail || "No contact email"}</small></td><td style={{padding:"12px 8px",borderBottom:"1px solid #eef2f6"}}>{c.customerType}</td><td style={{padding:"12px 8px",borderBottom:"1px solid #eef2f6"}}>{c.planName}</td><td style={{padding:"12px 8px",borderBottom:"1px solid #eef2f6"}}>{c.maxMachines>=9999?"60+":c.maxMachines} machines<small style={{display:"block"}}>{c.maxSites>=9999?"Multi-site":`${c.maxSites} site${c.maxSites===1?"":"s"}`}</small></td><td style={{padding:"12px 8px",borderBottom:"1px solid #eef2f6",textTransform:"capitalize"}}>{c.status.replaceAll("_"," ")}</td><td style={{padding:"12px 8px",borderBottom:"1px solid #eef2f6"}}><span style={{fontWeight:900,color:c.licenceStatus==="active"?"#0f766e":"#9a6700"}}>{c.licenceStatus.replaceAll("_"," ")}</span></td></tr>):<tr><td colSpan={6} style={{padding:26,textAlign:"center",color:"#7b8798"}}>No client companies have been added yet.</td></tr>}</tbody></table></div>
            </section>

            <aside style={{display:"grid",gap:18}}>
              <section style={{background:"white",border:"1px solid #e0e6ee",borderRadius:14,padding:20}}><small style={{fontWeight:800,color:"#738097"}}>NEEDS ATTENTION</small><h2 style={{fontSize:19,margin:"5px 0 14px"}}>Owner actions</h2>{[["Pending licence activations",kpis.pendingLicences],["Commercial actions",kpis.commercialActions],["Critical client alerts",kpis.criticalAlerts],["Active company users",kpis.users]].map(([label,value])=><div key={String(label)} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"11px 0",borderBottom:"1px solid #eef2f6"}}><span style={{fontSize:13,color:"#5f6c80"}}>{label}</span><b>{loading?"—":value}</b></div>)}</section>
              <section id="platform-health" style={{background:"white",border:"1px solid #e0e6ee",borderRadius:14,padding:20}}><small style={{fontWeight:800,color:"#738097"}}>PLATFORM HEALTH</small><h2 style={{fontSize:19,margin:"5px 0 14px"}}>Presentation readiness</h2>{[["Secure sign-in","Ready"],["Cloud database","Connected"],["Company separation","Enabled"],["Licence control","Enabled"],["Report imports","Available"],["Email alerts","Provider dependent"]].map(([a,b])=><div key={a} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"9px 0",fontSize:13}}><span>{a}</span><b style={{color:b==="Provider dependent"?"#9a6700":"#0f766e"}}>{b}</b></div>)}</section>
            </aside>
          </div>

          <section style={{marginTop:18,background:"white",border:"1px solid #e0e6ee",borderRadius:14,padding:20}}><small style={{fontWeight:800,color:"#738097"}}>PRESENTATION FLOW</small><h2 style={{fontSize:20,margin:"5px 0 14px"}}>Demonstrate the business and engineering value in one journey</h2><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}}>{["1. Owner overview","2. Select demo company","3. Company admin","4. Fleet & breakdown","5. Maintenance alert","6. Weekly / monthly report","7. Licence control"].map(x=><div key={x} style={{padding:13,borderRadius:10,background:"#f6f8fb",fontWeight:800,fontSize:13}}>{x}</div>)}</div></section>
        </div>
      </section>
    </main>
  );
}
