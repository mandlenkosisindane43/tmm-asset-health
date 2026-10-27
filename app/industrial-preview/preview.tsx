"use client";

import { useState } from "react";
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

export default function IndustrialPreview() {
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
        <div className="industrial-info" role="status">This is an isolated design preview. No live OEM feed, production metrics, machine alerts or operational decisions are represented here.</div>
        {active === "Executive Overview" ? <>
          <div className="industrial-kpis">{cards.map(card => <article key={card.label} className={`industrial-kpi ${card.tone}`}><small>{card.label}</small><strong>{card.value}</strong><span>{card.detail}</span></article>)}</div>
          <div className="industrial-grid"><section className="industrial-panel industrial-wide"><div className="industrial-panelhead"><h2>Fleet performance trend</h2></div><FleetTrend /></section><section className="industrial-panel"><div className="industrial-panelhead"><h2>Fleet status</h2></div><FleetStatus /></section></div>
          <section className="industrial-panel" style={{marginBottom:14}}><div className="industrial-panelhead"><h2>Downtime Pareto by system</h2></div><DowntimePareto /></section>
          <div className="industrial-grid"><section className="industrial-panel"><div className="industrial-panelhead"><h2>Machine health overview</h2></div><div className="industrial-chart-empty compact"><strong>Awaiting machine records</strong><p>OEM, model, operating hours, site and condition indicators.</p></div></section><section className="industrial-panel"><div className="industrial-panelhead"><h2>Recent alerts</h2></div><div className="industrial-chart-empty compact"><strong>No connected fault feed</strong><p>OEM diagnostic codes, event timestamps and severity will appear here.</p></div></section></div>
        </> : <section className="industrial-panel"><div className="industrial-panelhead"><h2>{active}</h2></div><div className="industrial-chart-empty"><strong>Module design placeholder</strong><p>Existing workflows and Admin/Engineer permissions will be audited before this screen is connected to production data.</p></div></section>}
        <footer className="industrial-footer">TMM Asset Health · Development branch · Production remains unchanged</footer>
      </div>
    </section>
  </main>;
}
