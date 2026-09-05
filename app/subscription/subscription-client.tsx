"use client";

import { useEffect, useMemo, useState } from "react";

const plans = {
  Contractor: [
    { name: "Contractor Starter", fleet: "Up to 10 machines", sites: "1 site", monthly: 3500, setup: 5000, note: "For small contractors starting with one operating site." },
    { name: "Contractor Multi-Site", fleet: "Up to 20 machines", sites: "Up to 3 sites", monthly: 7500, setup: 6500, note: "Best fit for contractors managing several crews or sites.", recommended: true },
  ],
  Mine: [
    { name: "Mine Standard", fleet: "Up to 25 machines", sites: "1 mine site", monthly: 16500, setup: 20000, note: "Designed for a mine site with a medium TMM fleet.", recommended: true },
    { name: "Mine Plus", fleet: "Up to 40 machines", sites: "1 mine site", monthly: 22000, setup: 25000, note: "For larger single-site fleets with heavier reporting demand." },
    { name: "Mine Enterprise", fleet: "Up to 60 machines", sites: "Up to 2 sites", monthly: 32000, setup: 35000, note: "For large operations requiring wider fleet and site coverage." },
    { name: "Enterprise+", fleet: "60+ machines", sites: "Multiple sites", monthly: 40000, setup: 0, note: "Starting price for complex multi-site mine operations.", from: true },
  ],
} as const;

type CustomerType = keyof typeof plans;
type Plan = (typeof plans)[CustomerType][number];
type Subscription = {
  id: number;
  companyName: string;
  contactEmail?: string | null;
  customerType: string;
  planName: string;
  billingCycle: string;
  subscriptionAmount: number;
  implementationFee: number;
  maxMachines: number;
  maxSites: number;
  status: string;
  licenceKey: string;
  licenceStatus: string;
  updatedAt: string;
};

const money = (value: number) => `R${Number(value || 0).toLocaleString("en-ZA")}`;

export default function SubscriptionClient({ userEmail }: { userEmail: string }) {
  const [type, setType] = useState<CustomerType>("Contractor");
  const [selected, setSelected] = useState<Plan | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [records, setRecords] = useState<Subscription[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const visiblePlans = useMemo(() => plans[type], [type]);

  async function load() {
    const r = await fetch("/api/subscriptions", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const data = await r.json();
    setRecords(data.subscriptions || []);
  }

  useEffect(() => { load(); }, []);

  async function saveSelection() {
    if (!selected || !companyName.trim()) {
      setMessage("Enter the company name and select a package first.");
      return;
    }
    setSaving(true);
    setMessage("");
    const r = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName,
        contactEmail,
        customerType: type,
        planName: selected.name,
        billingCycle: "Monthly",
      }),
    }).catch(() => null);

    if (!r?.ok) {
      const x = await r?.json().catch(() => ({}));
      setMessage(x?.error || "Could not save the subscription selection.");
    } else {
      setMessage("✓ Monthly subscription saved. The company is now waiting for SAS approval/payment activation.");
      await load();
    }
    setSaving(false);
  }

  async function activate(record: Subscription) {
    const r = await fetch("/api/subscriptions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: record.id, status: "active", licenceStatus: "active" }),
    }).catch(() => null);
    setMessage(r?.ok ? `✓ ${record.companyName} licence activated.` : "Could not activate this licence.");
    if (r?.ok) await load();
  }

  return (
    <main style={{minHeight:"100vh",background:"#f4f7fb",padding:"32px",fontFamily:"Arial, sans-serif",color:"#172033"}}>
      <div style={{maxWidth:1220,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:20,alignItems:"center",marginBottom:28,flexWrap:"wrap"}}>
          <div>
            <small style={{fontWeight:800,letterSpacing:1.3,color:"#53627c"}}>SINDANE ASSET SOLUTIONS · TMM ASSET HEALTH</small>
            <h1 style={{fontSize:34,margin:"7px 0 8px"}}>Payments & Subscription</h1>
            <p style={{margin:0,color:"#667085",maxWidth:760}}>Choose a contractor or mine package. All SAS software subscriptions are billed monthly.</p>
          </div>
          <div style={{textAlign:"right"}}>
            <a href="/" style={{display:"inline-block",textDecoration:"none",border:"1px solid #cbd5e1",borderRadius:10,padding:"11px 16px",fontWeight:700,color:"#172033",background:"white"}}>← Back to dashboard</a>
            <small style={{display:"block",marginTop:8,color:"#667085"}}>{userEmail}</small>
          </div>
        </div>

        <section style={{background:"white",border:"1px solid #dfe6ef",borderRadius:16,padding:20,marginBottom:20,boxShadow:"0 8px 24px rgba(22,34,51,.05)"}}>
          <b style={{display:"block",marginBottom:12}}>Company details</b>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:12}}>
            <label style={{fontWeight:700,fontSize:13}}>Registered / trading company name
              <input value={companyName} onChange={e=>setCompanyName(e.target.value)} placeholder="e.g. ABC Mining (Pty) Ltd" style={{display:"block",width:"100%",boxSizing:"border-box",marginTop:6,padding:11,border:"1px solid #cbd5e1",borderRadius:9}}/>
            </label>
            <label style={{fontWeight:700,fontSize:13}}>Company admin / contact email
              <input value={contactEmail} onChange={e=>setContactEmail(e.target.value)} type="email" placeholder="admin@company.co.za" style={{display:"block",width:"100%",boxSizing:"border-box",marginTop:6,padding:11,border:"1px solid #cbd5e1",borderRadius:9}}/>
            </label>
          </div>
          <div style={{display:"flex",gap:18,flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",marginTop:18}}>
            <div>
              <b style={{display:"block",marginBottom:8}}>1. Customer type</b>
              <div style={{display:"flex",gap:8}}>
                {(["Contractor","Mine"] as CustomerType[]).map(item=><button key={item} onClick={()=>{setType(item);setSelected(null)}} style={{border:"1px solid #cbd5e1",borderRadius:9,padding:"10px 18px",fontWeight:800,cursor:"pointer",background:type===item?"#172033":"white",color:type===item?"white":"#172033"}}>{item}</button>)}
              </div>
            </div>
            <div style={{padding:"12px 16px",background:"#f7f9fc",border:"1px solid #dfe6ef",borderRadius:10}}>
              <small style={{display:"block",color:"#667085",fontWeight:800}}>BILLING CYCLE</small>
              <b>Monthly subscription</b>
            </div>
          </div>
        </section>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:16}}>
          {visiblePlans.map(plan=><article key={plan.name} style={{background:"white",border:plan.recommended?"2px solid #172033":"1px solid #dfe6ef",borderRadius:16,padding:22,position:"relative",boxShadow:"0 8px 24px rgba(22,34,51,.05)"}}>
            {plan.recommended&&<span style={{position:"absolute",right:16,top:16,fontSize:11,fontWeight:900,background:"#172033",color:"white",padding:"6px 8px",borderRadius:20}}>RECOMMENDED</span>}
            <small style={{fontWeight:800,color:"#667085"}}>SAS {type.toUpperCase()}</small>
            <h2 style={{fontSize:22,margin:"10px 0 5px",paddingRight:plan.recommended?95:0}}>{plan.name}</h2>
            <p style={{color:"#667085",minHeight:48}}>{plan.note}</p>
            <div style={{fontSize:31,fontWeight:900,margin:"18px 0 5px"}}>{"from" in plan&&plan.from?"From ":""}{money(plan.monthly)}</div>
            <small style={{color:"#667085"}}>per month · excluding VAT where applicable</small>
            <div style={{margin:"20px 0",padding:"14px",background:"#f7f9fc",borderRadius:10,lineHeight:1.8}}>
              <b>{plan.fleet}</b><br/>
              <span>{plan.sites}</span><br/>
              <span>Once-off implementation: <b>{plan.setup ? money(plan.setup) : "Quoted after scope review"}</b></span>
            </div>
            <ul style={{paddingLeft:20,lineHeight:1.8,color:"#475467"}}>
              <li>Fleet and production tracking</li>
              <li>Breakdown and maintenance control</li>
              <li>Availability and utilisation KPIs</li>
              <li>Weekly and monthly reporting</li>
              <li>Role-based company workspace</li>
            </ul>
            <button onClick={()=>setSelected(plan)} style={{width:"100%",border:0,borderRadius:10,padding:"12px 14px",fontWeight:900,cursor:"pointer",background:selected?.name===plan.name?"#0f766e":"#172033",color:"white"}}>{selected?.name===plan.name?"✓ Selected":"Select this package"}</button>
          </article>)}
        </div>

        {selected&&<section style={{marginTop:22,background:"#172033",color:"white",borderRadius:16,padding:22,display:"flex",justifyContent:"space-between",gap:20,alignItems:"center",flexWrap:"wrap"}}>
          <div>
            <small style={{fontWeight:800,opacity:.75}}>SELECTED MONTHLY SUBSCRIPTION</small>
            <h2 style={{margin:"7px 0"}}>{companyName || "Company not entered"} · {selected.name}</h2>
            <p style={{margin:0,opacity:.85}}>{selected.fleet} · {selected.sites} · Monthly</p>
          </div>
          <div style={{textAlign:"right"}}>
            <b style={{fontSize:27}}>{"from" in selected&&selected.from?"From ":""}{money(selected.monthly)} / month</b>
            <div style={{fontSize:13,opacity:.8}}>Implementation: {selected.setup ? money(selected.setup) : "Quoted"}</div>
            <button onClick={saveSelection} disabled={saving} style={{marginTop:12,border:0,borderRadius:9,padding:"11px 17px",fontWeight:900,cursor:"pointer"}}>{saving?"Saving…":"Save monthly subscription"}</button>
          </div>
        </section>}

        {message&&<div style={{marginTop:16,padding:13,borderRadius:10,background:"white",border:"1px solid #dfe6ef",fontWeight:700}}>{message}</div>}

        <section style={{marginTop:28,background:"white",border:"1px solid #dfe6ef",borderRadius:16,padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
            <div><small style={{fontWeight:800,color:"#667085"}}>SAS OWNER CONTROL</small><h2 style={{margin:"5px 0"}}>Company subscriptions & licences</h2></div>
            <button onClick={load} style={{border:"1px solid #cbd5e1",background:"white",borderRadius:9,padding:"9px 13px",fontWeight:800,cursor:"pointer"}}>Refresh</button>
          </div>
          <div style={{overflowX:"auto",marginTop:12}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr>{["Company","Type / plan","Billing","Limits","Monthly subscription","Status","Licence","Action"].map(h=><th key={h} style={{textAlign:"left",padding:"10px",borderBottom:"1px solid #e5e7eb",color:"#667085"}}>{h}</th>)}</tr></thead>
              <tbody>{records.length?records.map(r=><tr key={r.id}>
                <td style={{padding:10,borderBottom:"1px solid #eef2f6"}}><b>{r.companyName}</b><small style={{display:"block",color:"#667085"}}>{r.contactEmail || "No contact email"}</small></td>
                <td style={{padding:10,borderBottom:"1px solid #eef2f6"}}>{r.customerType}<small style={{display:"block"}}>{r.planName}</small></td>
                <td style={{padding:10,borderBottom:"1px solid #eef2f6"}}>Monthly</td>
                <td style={{padding:10,borderBottom:"1px solid #eef2f6"}}>{r.maxMachines>=9999?"60+":r.maxMachines} machines<small style={{display:"block"}}>{r.maxSites>=9999?"Multi-site":`${r.maxSites} site${r.maxSites===1?"":"s"}`}</small></td>
                <td style={{padding:10,borderBottom:"1px solid #eef2f6"}}><b>{money(r.subscriptionAmount)}</b><small style={{display:"block"}}>Setup {r.implementationFee?money(r.implementationFee):"Quoted"}</small></td>
                <td style={{padding:10,borderBottom:"1px solid #eef2f6"}}>{r.status.replaceAll("_"," ")}</td>
                <td style={{padding:10,borderBottom:"1px solid #eef2f6"}}><b>{r.licenceStatus.replaceAll("_"," ")}</b><small style={{display:"block",maxWidth:180,wordBreak:"break-all",color:"#667085"}}>{r.licenceKey}</small></td>
                <td style={{padding:10,borderBottom:"1px solid #eef2f6"}}><button disabled={r.licenceStatus==="active"} onClick={()=>activate(r)} style={{border:0,borderRadius:8,padding:"8px 10px",fontWeight:800,cursor:"pointer",background:r.licenceStatus==="active"?"#e5e7eb":"#172033",color:r.licenceStatus==="active"?"#667085":"white"}}>{r.licenceStatus==="active"?"Active":"Activate"}</button></td>
              </tr>):<tr><td colSpan={8} style={{padding:22,textAlign:"center",color:"#667085"}}>No company subscriptions saved yet.</td></tr>}</tbody>
            </table>
          </div>
        </section>

        <p style={{fontSize:12,color:"#7b879a",marginTop:20}}>All new SAS subscriptions are monthly. Package selection creates the commercial subscription record and licence key. Real payment collection is not automatic yet; SAS owner approval controls licence activation.</p>
      </div>
    </main>
  );
}
