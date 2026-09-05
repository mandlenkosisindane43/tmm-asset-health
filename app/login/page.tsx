"use client";

import { FormEvent, useState } from "react";

export default function OwnerLogin() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: form.get("password") })
    });

    if (response.ok) {
      const requested = new URLSearchParams(window.location.search).get("return_to") || "/";
      window.location.assign(requested.startsWith("/") && !requested.startsWith("//") ? requested : "/");
      return;
    }

    const result = await response.json().catch(() => ({}));
    setMessage(result.error || "Sign-in failed.");
    setBusy(false);
  }

  return (
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"linear-gradient(135deg,#07111f,#0d1b2a)",padding:20,fontFamily:"Arial,sans-serif"}}>
      <form onSubmit={submit} style={{width:"min(440px,100%)",background:"white",borderRadius:20,padding:34,boxShadow:"0 24px 70px #0008"}}>
        <div style={{color:"#e97818",fontWeight:900,letterSpacing:1.2,fontSize:13}}>SINDANE ASSET SOLUTIONS</div>
        <h1 style={{margin:"12px 0 6px",color:"#111827",fontSize:28}}>Software Owner Login</h1>
        <p style={{color:"#64748b",lineHeight:1.55,marginTop:0}}>Secure access to TMM Asset Health, client companies, licences, fleet intelligence and reports.</p>

        <label style={{display:"grid",gap:8,color:"#334155",fontWeight:700,marginTop:24}}>
          Owner password
          <input name="password" type="password" required autoFocus autoComplete="current-password" style={{padding:15,border:"1px solid #cbd5e1",borderRadius:10,fontSize:16,outline:"none"}} />
        </label>

        {message && <p style={{color:"#b91c1c",background:"#fee2e2",padding:11,borderRadius:8}}>{message}</p>}

        <button disabled={busy} style={{width:"100%",marginTop:22,padding:15,border:0,borderRadius:10,background:"#ea7617",color:"white",fontSize:16,fontWeight:900,cursor:"pointer"}}>
          {busy ? "Signing in…" : "Open Owner Command Centre"}
        </button>

        <div style={{marginTop:20,paddingTop:16,borderTop:"1px solid #e5e7eb",fontSize:12,color:"#94a3b8",lineHeight:1.5}}>
          Independent Sindane Asset Solutions authentication · Cloudflare hosted · Session expires after 8 hours
        </div>
      </form>
    </main>
  );
}
