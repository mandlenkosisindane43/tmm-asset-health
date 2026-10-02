"use client";

import { FormEvent, useEffect, useState } from "react";
import { listOfflineEntries, removeOfflineEntry, saveOfflineEntry, type OfflineEntry } from "../../lib/offline-store";

export default function OfflineCapture() {
  const [kind, setKind] = useState<OfflineEntry["kind"]>("production");
  const [entries, setEntries] = useState<OfflineEntry[]>([]);
  const [message, setMessage] = useState("Records stay on this device until you sync them.");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([]);
  const [companyId, setCompanyId] = useState(0);

  async function refresh() { setEntries((await listOfflineEntries()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))); }
  useEffect(() => {
    setOnline(navigator.onLine);
    refresh().catch(() => setMessage("Local storage is unavailable. Do not enter a report on this device."));
    try {
      const saved = JSON.parse(localStorage.getItem("tmm-offline-company") || "null");
      if (saved && Number.isSafeInteger(saved.id)) { setCompanyId(saved.id); setCompanies([saved]); }
    } catch { /* A company must be selected while connected. */ }
    fetch("/api/offline-sync", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!response.ok) return;
      const available = (await response.json()).companies as { id: number; name: string }[];
      setCompanies(available);
      setCompanyId(current => available.some(c => c.id === current) ? current : 0);
    }).catch(() => undefined);
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = companies.find(c => c.id === companyId);
    if (!selected) { setMessage("Connect and sign in to select a company before recording offline."); return; }
    const form = event.currentTarget;
    const raw = Object.fromEntries(new FormData(form).entries());
    const data: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(raw)) data[key] = String(value).trim();
    if (kind === "production") {
      for (const field of ["shiftHours", "plannedDowntime", "unplannedDowntime", "operatingHours", "productiveHours", "tonnes"]) data[field] = Number(data[field] || 0);
      if (Number(data.operatingHours) + Number(data.plannedDowntime) + Number(data.unplannedDowntime) > Number(data.shiftHours)) {
        setMessage("Operating hours plus downtime exceed shift hours. Correct the entry before saving."); return;
      }
    } else data.downtimeHours = Number(data.downtimeHours || 0);
    try {
      await saveOfflineEntry({ id: crypto.randomUUID(), companyId, companyName: selected.name, kind, createdAt: new Date().toISOString(), data });
      await refresh(); form.reset();
      setMessage("Saved on this device. Sync when connected and signed in.");
    } catch { setMessage("Could not save locally. Keep a paper copy and check device storage."); }
  }

  async function sync() {
    setBusy(true);
    try {
      const pending = await listOfflineEntries();
      let completed = 0;
      for (const entry of pending) {
        const response = await fetch("/api/offline-sync", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(entry) });
        if (!response.ok) {
          setMessage(response.status === 401 ? "Session expired. Sign in online, then return here to sync." : `Sync stopped (${response.status}). ${completed} saved; remaining records are still on this device.`);
          await refresh(); return;
        }
        await removeOfflineEntry(entry.id);
        completed++;
      }
      await refresh(); setMessage(`${completed} record${completed === 1 ? "" : "s"} synced. The local copies were removed.`);
    } catch { setMessage("Sync could not finish. Remaining records are still saved on this device."); await refresh().catch(() => undefined); }
    finally { setBusy(false); }
  }

  return <main style={{maxWidth:760,margin:"auto",padding:24,fontFamily:"Arial,sans-serif",lineHeight:1.5}}>
    <a href="/operations">← Operations</a><h1>TMM offline capture</h1>
    <p>Record a shift or breakdown without internet. Open this page once while connected so it is available later on this device. Keep the device locked because unsynced records are stored locally.</p>
    <p role="status"><strong>{online ? "Connection available" : "Offline"}</strong> · {entries.length} pending · {message}</p>
    <p><button type="button" disabled={!online || busy || !entries.length} onClick={sync}>{busy ? "Syncing…" : "Sync pending records"}</button> {online && <a href="/login?return_to=%2Foffline-capture">Sign in to sync</a>}</p>
    <label>Company <select value={companyId} onChange={e => { const id = Number(e.target.value); setCompanyId(id); const choice = companies.find(c => c.id === id); if (choice) localStorage.setItem("tmm-offline-company", JSON.stringify(choice)); else localStorage.removeItem("tmm-offline-company"); }}><option value={0}>Select company while connected</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div><button type="button" onClick={() => setKind("production")} aria-pressed={kind === "production"}>Daily production</button> <button type="button" onClick={() => setKind("breakdown")} aria-pressed={kind === "breakdown"}>Breakdown</button></div>
    <form key={kind} onSubmit={save} style={{display:"grid",gap:12,marginTop:20}}>
      <label>Fleet number <input name="fleetNumber" required maxLength={60}/></label>
      {kind === "production" ? <>
        <label>Report date <input name="reportDate" type="date" required/></label>
        <label>Shift hours <input name="shiftHours" type="number" min="0.1" max="24" step="any" required/></label>
        <label>Planned downtime (hours) <input name="plannedDowntime" type="number" min="0" step="any" defaultValue="0" required/></label>
        <label>Unplanned downtime (hours) <input name="unplannedDowntime" type="number" min="0" step="any" defaultValue="0" required/></label>
        <label>Operating hours <input name="operatingHours" type="number" min="0" step="any" required/></label>
        <label>Productive hours <input name="productiveHours" type="number" min="0" step="any" required/></label>
        <label>Tonnes <input name="tonnes" type="number" min="0" step="any" defaultValue="0" required/></label>
      </> : <>
        <label>Fault description <textarea name="description" required maxLength={2000}/></label>
        <label>System <input name="system" required maxLength={100}/></label>
        <label>Downtime (hours) <input name="downtimeHours" type="number" min="0" step="any" defaultValue="0" required/></label>
      </>}
      <button type="submit">Save on this device</button>
    </form>
    <h2>Pending records</h2>
    <ul>{entries.map(entry => <li key={entry.id}>{entry.companyName} · {entry.kind === "production" ? "Production" : "Breakdown"} · {entry.data.fleetNumber} · {entry.kind === "production" ? entry.data.reportDate : new Date(entry.createdAt).toLocaleString("en-ZA")} · saved locally</li>)}</ul>
  </main>;
}
