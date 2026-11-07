"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FleetTrend, FleetStatus, DowntimePareto } from "./graphics";

type Module = "Executive Overview" | "Fleet Intelligence" | "Reliability Engineering" | "Maintenance" | "Reports" | "Integrations";
const modules: Module[] = ["Executive Overview", "Fleet Intelligence", "Reliability Engineering", "Maintenance", "Reports", "Integrations"];
const icon: Record<Module, string> = {
  "Executive Overview": "▣", "Fleet Intelligence": "▤", "Reliability Engineering": "▥",
  "Maintenance": "⚙", "Reports": "▧", "Integrations": "↔",
};
const cards = [
  { label: "Fleet availability", value: "—", detail: "Awaiting verified operating data", tone: "green" },
  { label: "Utilisation", value: "—", detail: "No calculated period available", tone: "blue" },
  { label: "Machines reporting", value: "—", detail: "OEM connections not configured", tone: "amber" },
  { label: "Critical issues", value: "—", detail: "Fault feed not connected", tone: "red" },
];

type FleetRow = { id: number; fleetNumber: string; category: string; site: string; status: string; operatingHours: number };
type FaultRow = { id: number; fleetNumber: string; severity: string; description: string; status: string; openedAt: string };
type ProductionRow = { reportDate: string; shiftHours: number; plannedDowntime: number; unplannedDowntime: number; operatingHours: number; productiveHours: number };
type OverviewData = { fleet: FleetRow[]; faults: FaultRow[]; production: ProductionRow[]; generatedAt: string };

export default function IndustrialPreview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [loadedCompanyId, setLoadedCompanyId] = useState<number | null>(null);
  async function loadCompany() {
    const id = Number(companyId);
    if (!/^\\d+$/.test(companyId.trim()) || !Number.isSafeInteger(id) || id <= 0) {
      setError("Enter a valid company ID."); setData(null); setLoadedCompanyId(null); return;
    }
    setLoading(true); setError(""); setData(null); setLoadedCompanyId(null);
    try {
      const response = await fetch("/api/industrial-overview?companyId=" + encodeURIComponent(String(id)), {
        credentials: "same-origin", cache: "no-store"
      });
      if (response.status === 401) throw new Error("Sign in to the staging account before loading records.");
      if (response.status === 403) throw new Error("Your account does not have access to this company.");
      if (!response.ok) throw new Error("Company records unavailable in this environment.");
      const result = await response.json() as OverviewData;
      setData(result); setLoadedCompanyId(id);
    } catch (err) { setError(err instanceof Error ? err.message : "Data unavailable"); }
    finally { setLoading(false); }
  }
  const metrics = useMemo(() => {
    if (!data) return null;
    const totalShift = data.production.reduce((sum, row) => sum + Number(row.shiftHours || 0), 0);
    const downtime = data.production.reduce((sum, row) => sum + Number(row.plannedDowntime || 0) + Number(row.unplannedDowntime || 0), 0);
    const available = Math.max(0, totalShift - downtime);
    const productive = data.production.reduce((sum, row) => sum + Number(row.productiveHours || 0), 0);
    return {
      availability: totalShift > 0 ? (100 * available / totalShift).toFixed(1) + "%" : "—",
      utilisation: available > 0 ? (100 * productive / available).toFixed(1) + "%" : "—",
      machines: String(data.fleet.length) + (data.fleet.length === 100 ? "+" : ""),
      alerts: String(data.faults.filter(f => f.status.toLowerCase() === "open" && f.severity.toLowerCase() === "critical").length) + (data.faults.length === 100 ? "+" : ""),
    };
  }, [data]);
  const [active, setActive] = useState<Module>("Executive Overview");
  return <main className="industrial">
    <aside className="industrial-side" aria-label="Preview navigation">
      <div className="industrial-logo"><span className="industrial-mark">▲</span><span><strong>TMM Asset Health</strong><small>SINDANE ASSET SOLUTIONS</small></span></div>
      <div className="industrial-navtitle">WORKSPACE</div>
      <nav aria-label="Industrial preview modules">{modules.map(name =>
        <button key={name} type="button" className={active === name ? "selected" : ""} onClick={() => setActive(name)} aria-current={active === name ? "page" : undefined}>
          <span aria-hidden="true">{icon[name]}</span>{name}
        </button>)}</nav>
      <div className="industrial-sidefoot"><strong>Design preview</strong><span>Stored records only · no live OEM feed</span><Link href="/operations">← Return to existing system</Link></div>
    </aside>
    <section className="industrial-main">
      <header className="industrial-top"><div><small>TMM ASSET HEALTH / DEVELOPMENT PREVIEW</small><strong>{active}</strong></div><span className="industrial-test">PREVIEW · STORED RECORDS</span></header>
      <div className="industrial-body">
        <div className="industrial-hero"><div><small>FLEET INTELLIGENCE PLATFORM</small><h1>{active === "Executive Overview" ? "Fleet health at a glance" : active}</h1><p>Industrial intelligence for safer, more reliable mining operations.</p></div><div className="industrial-hero-art" aria-hidden="true">▰<span>▰</span></div></div>
        <section className="industrial-panel" style={{marginBottom:14}}>
          <div className="industrial-panelhead"><h2>Company records · Read-only</h2></div>
          <p>Enter the company ID from this environment. Staging cannot access the production database.</p>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",marginTop:12}}>
            <label htmlFor="industrial-company-id">Company ID</label>
            <input id="industrial-company-id" inputMode="numeric" value={companyId}
              onChange={event => setCompanyId(event.target.value)} placeholder="e.g. 1"
              style={{padding:10,borderRadius:8,background:"#071827",color:"white",border:"1px solid #486077"}} />
            <button type="button" onClick={loadCompany} disabled={loading}
              style={{padding:"10px 16px",borderRadius:8,background:"#e4ac45",color:"#071827",fontWeight:700}}>
              {loading ? "Loading…" : "Load authorised company"}
            </button>
          </div>
          <div className="industrial-info" role="status">{loading ? "Loading company records…" : error ? error :
            loadedCompanyId !== null ? "Company " + loadedCompanyId + ": " + (data?.fleet.length ?? 0) + " stored machines loaded. These are not live OEM readings." :
            "No company loaded. All metrics remain blank until authorised records are retrieved."}</div>
        </section>
        {active === "Executive Overview" ? <>
          <div className="industrial-kpis">{cards.map((card, index) => <article key={card.label} className={`industrial-kpi ${card.tone}`}><small>{card.label}</small><strong>{metrics ? [metrics.availability, metrics.utilisation, metrics.machines, metrics.alerts][index] : card.value}</strong><span>{data ? ["Calculated from stored shift and downtime records", "Productive hours ÷ available hours", "Registered machines (up to 100 loaded)", "Open critical events (up to 100 recent events)"][index] : card.detail}</span></article>)}</div>
          <div className="industrial-grid"><section className="industrial-panel industrial-wide"><div className="industrial-panelhead"><h2>Fleet performance trend</h2></div><FleetTrend records={data?.production ?? []} /></section><section className="industrial-panel"><div className="industrial-panelhead"><h2>Fleet status</h2></div><FleetStatus fleet={data?.fleet ?? []} /></section></div>
          <section className="industrial-panel" style={{marginBottom:14}}><div className="industrial-panelhead"><h2>Recorded fault events by system</h2></div><DowntimePareto faults={data?.faults ?? []} /></section>
          <div className="industrial-grid"><section className="industrial-panel"><div className="industrial-panelhead"><h2>Machine health overview</h2></div><div className="industrial-chart-empty compact"><strong>{data?.fleet.length ? data.fleet.slice(0, 5).map(m => m.fleetNumber + " · " + m.category + " · " + m.status).join(" | ") : "Awaiting machine records"}</strong><p>OEM, model, operating hours, site and condition indicators.</p></div></section><section className="industrial-panel"><div className="industrial-panelhead"><h2>Recent alerts</h2></div><div className="industrial-chart-empty compact"><strong>{data?.faults.length ? data.faults.slice(0, 3).map(f => f.fleetNumber + ": " + f.description).join(" | ") : "No connected fault feed"}</strong><p>OEM diagnostic codes, event timestamps and severity will appear here.</p></div></section></div>
        </> : <section className="industrial-panel"><div className="industrial-panelhead"><h2>{active}</h2></div><div className="industrial-chart-empty"><strong>Module design placeholder</strong><p>Existing workflows and Admin/Engineer permissions will be audited before this screen is connected to production data.</p></div></section>}
        <footer className="industrial-footer">TMM Asset Health · Development branch · Production remains unchanged</footer>
      </div>
    </section>
  </main>;
}
