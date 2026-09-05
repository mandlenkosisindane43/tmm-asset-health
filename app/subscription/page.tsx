"use client";

import { useMemo, useState } from "react";

const plans = {
  Contractor: [
    {
      name: "Contractor Starter",
      fleet: "Up to 10 machines",
      sites: "1 site",
      monthly: 3500,
      six: 18900,
      setup: "R5,000",
      note: "For small contractors starting with one operating site.",
    },
    {
      name: "Contractor Multi-Site",
      fleet: "Up to 20 machines",
      sites: "Up to 3 sites",
      monthly: 7500,
      six: 40500,
      setup: "R6,500",
      note: "Best fit for contractors managing several crews or sites.",
      recommended: true,
    },
  ],
  Mine: [
    {
      name: "Mine Standard",
      fleet: "Up to 25 machines",
      sites: "1 mine site",
      monthly: 16500,
      six: 89100,
      setup: "R20,000",
      note: "Designed for a mine site with a medium TMM fleet.",
      recommended: true,
    },
    {
      name: "Mine Plus",
      fleet: "Up to 40 machines",
      sites: "1 mine site",
      monthly: 22000,
      six: 118800,
      setup: "R25,000",
      note: "For larger single-site fleets with heavier reporting demand.",
    },
    {
      name: "Mine Enterprise",
      fleet: "Up to 60 machines",
      sites: "Up to 2 sites",
      monthly: 32000,
      six: 172800,
      setup: "R35,000",
      note: "For large operations requiring wider fleet and site coverage.",
    },
    {
      name: "Enterprise+",
      fleet: "60+ machines",
      sites: "Multiple sites",
      monthly: 40000,
      six: 216000,
      setup: "Quoted after scope review",
      note: "Starting price for complex multi-site mine operations.",
      from: true,
    },
  ],
} as const;

type CustomerType = keyof typeof plans;
type Plan = (typeof plans)[CustomerType][number];

const money = (value: number) => `R${value.toLocaleString("en-ZA")}`;

export default function SubscriptionPage() {
  const [type, setType] = useState<CustomerType>("Contractor");
  const [cycle, setCycle] = useState<"Monthly" | "Six months">("Monthly");
  const [selected, setSelected] = useState<Plan | null>(null);
  const visiblePlans = useMemo(() => plans[type], [type]);

  return (
    <main style={{minHeight:"100vh",background:"#f4f7fb",padding:"32px",fontFamily:"Arial, sans-serif",color:"#172033"}}>
      <div style={{maxWidth:1180,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:20,alignItems:"center",marginBottom:28,flexWrap:"wrap"}}>
          <div>
            <small style={{fontWeight:800,letterSpacing:1.3,color:"#53627c"}}>SINDANE ASSET SOLUTIONS</small>
            <h1 style={{fontSize:34,margin:"7px 0 8px"}}>Payments & Subscription</h1>
            <p style={{margin:0,color:"#667085",maxWidth:720}}>Choose whether the operation is a contractor or a mine, then select the fleet package and billing cycle that matches the site.</p>
          </div>
          <a href="/" style={{textDecoration:"none",border:"1px solid #cbd5e1",borderRadius:10,padding:"11px 16px",fontWeight:700,color:"#172033",background:"white"}}>← Back to dashboard</a>
        </div>

        <section style={{background:"white",border:"1px solid #dfe6ef",borderRadius:16,padding:20,marginBottom:20,boxShadow:"0 8px 24px rgba(22,34,51,.05)"}}>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <b style={{display:"block",marginBottom:8}}>1. Select customer type</b>
              <div style={{display:"flex",gap:8}}>
                {(["Contractor","Mine"] as CustomerType[]).map((item)=><button key={item} onClick={()=>{setType(item);setSelected(null)}} style={{border:"1px solid #cbd5e1",borderRadius:9,padding:"10px 18px",fontWeight:800,cursor:"pointer",background:type===item?"#172033":"white",color:type===item?"white":"#172033"}}>{item}</button>)}
              </div>
            </div>
            <div>
              <b style={{display:"block",marginBottom:8}}>2. Select billing cycle</b>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setCycle("Monthly")} style={{border:"1px solid #cbd5e1",borderRadius:9,padding:"10px 18px",fontWeight:800,cursor:"pointer",background:cycle==="Monthly"?"#172033":"white",color:cycle==="Monthly"?"white":"#172033"}}>Monthly</button>
                <button onClick={()=>setCycle("Six months")} style={{border:"1px solid #cbd5e1",borderRadius:9,padding:"10px 18px",fontWeight:800,cursor:"pointer",background:cycle==="Six months"?"#172033":"white",color:cycle==="Six months"?"white":"#172033"}}>6 months · save 10%</button>
              </div>
            </div>
          </div>
        </section>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:16}}>
          {visiblePlans.map((plan)=><article key={plan.name} style={{background:"white",border:plan.recommended?"2px solid #172033":"1px solid #dfe6ef",borderRadius:16,padding:22,position:"relative",boxShadow:"0 8px 24px rgba(22,34,51,.05)"}}>
            {plan.recommended&&<span style={{position:"absolute",right:16,top:16,fontSize:11,fontWeight:900,background:"#172033",color:"white",padding:"6px 8px",borderRadius:20}}>RECOMMENDED</span>}
            <small style={{fontWeight:800,color:"#667085"}}>SAS {type.toUpperCase()}</small>
            <h2 style={{fontSize:22,margin:"10px 0 5px",paddingRight:plan.recommended?95:0}}>{plan.name}</h2>
            <p style={{color:"#667085",minHeight:48}}>{plan.note}</p>
            <div style={{fontSize:31,fontWeight:900,margin:"18px 0 5px"}}>{(plan as any).from?"From ":""}{money(cycle==="Monthly"?plan.monthly:plan.six)}</div>
            <small style={{color:"#667085"}}>per {cycle==="Monthly"?"month":"6-month term"} · excluding VAT where applicable</small>
            <div style={{margin:"20px 0",padding:"14px",background:"#f7f9fc",borderRadius:10,lineHeight:1.8}}>
              <b>{plan.fleet}</b><br/>
              <span>{plan.sites}</span><br/>
              <span>Once-off implementation: <b>{plan.setup}</b></span>
            </div>
            <ul style={{paddingLeft:20,lineHeight:1.8,color:"#475467"}}>
              <li>Fleet and production tracking</li>
              <li>Breakdown and maintenance control</li>
              <li>Availability and utilisation KPIs</li>
              <li>Weekly and monthly reporting</li>
              <li>Role-based company workspace</li>
            </ul>
            <button onClick={()=>setSelected(plan)} style={{width:"100%",border:0,borderRadius:10,padding:"12px 14px",fontWeight:900,cursor:"pointer",background:"#172033",color:"white"}}>Select this package</button>
          </article>)}
        </div>

        {selected&&<section style={{marginTop:22,background:"#172033",color:"white",borderRadius:16,padding:22,display:"flex",justifyContent:"space-between",gap:20,alignItems:"center",flexWrap:"wrap"}}>
          <div>
            <small style={{fontWeight:800,opacity:.75}}>SELECTED SUBSCRIPTION</small>
            <h2 style={{margin:"7px 0"}}>{selected.name}</h2>
            <p style={{margin:0,opacity:.85}}>{selected.fleet} · {selected.sites} · {cycle}</p>
          </div>
          <div style={{textAlign:"right"}}>
            <b style={{fontSize:27}}>{(selected as any).from?"From ":""}{money(cycle==="Monthly"?selected.monthly:selected.six)}</b>
            <div style={{fontSize:13,opacity:.8}}>Implementation: {selected.setup}</div>
          </div>
        </section>}

        <p style={{fontSize:12,color:"#7b879a",marginTop:20}}>Plan selection records the commercial choice only. Payment gateway, invoice generation and licence activation remain subject to the approved quotation and SAS owner controls.</p>
      </div>
    </main>
  );
}
