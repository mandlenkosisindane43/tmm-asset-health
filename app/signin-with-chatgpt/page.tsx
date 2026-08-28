"use client";

import { FormEvent, useState } from "react";

export default function AdminLogin() {
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
    <main style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#08111f",padding:20,fontFamily:"Arial,sans-serif"}}>
      <form onSubmit={submit} style={{width:"min(420px,100%)",background:"white",borderRadius:18,padding:32,boxShadow:"0 20px 60px #0008"}}>
        <div style={{color:"#e97818",fontWeight:800,letterSpacing:1,fontSize:13}}>SINDANE ASSET SOLUTIONS</div>
        <h1 style={{margin:"10px 0 6px",color:"#111827"}}>Company administrator</h1>
        <p style={{color:"#64748b",lineHeight:1.5}}>Sign in to manage fleet, production, purchase orders and reports.</p>
        <label style={{display:"grid",gap:8,color:"#334155",fontWeight:700,marginTop:24}}>
          Administrator password
          <input name="password" type="password" required autoFocus autoComplete="current-password" style={{padding:14,border:"1px solid #cbd5e1",borderRadius:9,fontSize:16}} />
        </label>
        {message && <p style={{color:"#b91c1c",background:"#fee2e2",padding:10,borderRadius:8}}>{message}</p>}
        <button disabled={busy} style={{width:"100%",marginTop:20,padding:14,border:0,borderRadius:9,background:"#ea7617",color:"white",fontSize:16,fontWeight:800,cursor:"pointer"}}>
          {busy ? "Signing in…" : "Sign in securely"}
        </button>
        <p style={{fontSize:12,color:"#94a3b8",marginTop:18}}>Protected administrator access · Session expires after 8 hours</p>
      </form>
    </main>
  );
}
