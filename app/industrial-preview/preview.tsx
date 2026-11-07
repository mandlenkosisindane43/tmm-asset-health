"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/industrial-overview", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Unable to retrieve fleet records"); return response.json() as Promise<OverviewData>; })
      .then(setData).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Data unavailable"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
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
      alerts: String(data.faults.filter(f => f.status.toLowerCase() === "open" && f.severity.toLowerCase() === "critical").length) + (data.faults.length === 30 ? "+" : ""),
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
      <div className="industrial-sidefoot"><strong>Design preview</strong><span>No live telemetry connected</span><Link href="/operations">← Return to existing system</Link></div>
    </aside>
    <section className="industrial-main">
      <header className="industrial-top"><div><small>TMM ASSET HEALTH / DEVELOPMENT PREVIEW</small><strong>{active}</strong></div><span className="industrial-test">PREVIEW · NOT LIVE</span></header>
      <div className="industrial-body">
        <div className="industrial-hero"><div><small>FLEET INTELLIGENCE PLATFORM</small><h1>{active === "Executive Overview" ? "Fleet health at a glance" : active}</h1><p>Industrial intelligence for safer, more reliable mining operations.</p></div><div className="industrial-hero-art" aria-hidden="true">▰<span>▰</span></div></div>
        <div className="industrial-info" role="status">{loading ? "Loading existing fleet records…" : error ? error : "Connected to existing TMM Asset Health records. This is not an OEM live telemetry feed; values reflect stored records and may be incomplete."}</div>
        {active === "Executive Overview" ? <>
          <div className="industrial-kpis">{cards.map((card, index) => <article key={card.label} className={`industrial-kpi ${card.tone}`}><small>{card.label}</small><strong>{metrics ? [metrics.availability, metrics.utilisation, metrics.machines, metrics.alerts][index] : card.value}</strong><span>{data ? ["Calculated from stored shift and downtime records", "Productive hours ÷ available hours", "Registered machines (up to 100 loaded)", "Open critical events (up to 30 recent events)"][index] : card.detail}</span></article>)}</div>
          <div className="industrial-grid"><section className="industrial-panel industrial-wide"><div className="industrial-panelhead"><h2>Fleet performance trend</h2></div><FleetTrend /></section><section className="industrial-panel"><div className="industrial-panelhead"><h2>Fleet status</h2></div><FleetStatus /></section></div>
          <section className="industrial-panel" style={{marginBottom:14}}><div className="industrial-panelhead"><h2>Downtime Pareto by system</h2></div><DowntimePareto /></section>
          <div className="industrial-grid"><section className="industrial-panel"><div className="industrial-panelhead"><h2>Machine health overview</h2></div><div className="industrial-chart-empty compact"><strong>{data?.fleet.length ? data.fleet.slice(0, 5).map(m => m.fleetNumber + " · " + m.category + " · " + m.status).join(" | ") : "Awaiting machine records"}</strong><p>OEM, model, operating hours, site and condition indicators.</p></div></section><section className="industrial-panel"><div className="industrial-panelhead"><h2>Recent alerts</h2></div><div className="industrial-chart-empty compact"><strong>{data?.faults.length ? data.faults.slice(0, 3).map(f => f.fleetNumber + ": " + f.description).join(" | ") : "No connected fault feed"}</strong><p>OEM diagnostic codes, event timestamps and severity will appear here.</p></div></section></div>
        </> : <section className="industrial-panel"><div className="industrial-panelhead"><h2>{active}</h2></div><div className="industrial-chart-empty"><strong>Module design placeholder</strong><p>Existing workflows and Admin/Engineer permissions will be audited before this screen is connected to production data.</p></div></section>}
        <footer className="industrial-footer">TMM Asset Health · Development branch · Production remains unchanged</footer>
      </div>
    </section>
  </main>;
}
