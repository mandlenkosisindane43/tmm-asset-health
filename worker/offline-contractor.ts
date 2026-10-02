interface Env { DB: D1Database }

const cookieName = "sas_contractor_v2";
async function session(req: Request, env: Env) {
  const token = (req.headers.get("cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
  if (!token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  const row = await env.DB.prepare(`SELECT s.company_id companyId,s.account_id accountId,s.expires_at expiresAt,a.status accountStatus,c.name companyName,c.licence_status licenceStatus,c.expires_at licenceExpires,c.grace_days graceDays FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1`).bind(hash).first<Record<string, unknown>>();
  if (!row || row.accountStatus !== "active" || Date.parse(String(row.expiresAt)) <= Date.now()) return null;
  if (!["active", "trial"].includes(String(row.licenceStatus).toLowerCase()) || Date.parse(String(row.licenceExpires)) + Number(row.graceDays || 0) * 86400000 <= Date.now()) return null;
  return { companyId: Number(row.companyId), accountId: Number(row.accountId), companyName: String(row.companyName) };
}

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
const shell = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="manifest" href="/app.webmanifest"><title>Offline capture · TMM Asset Health</title><style>body{font:16px system-ui;margin:0;background:#f3f6f8;color:#10283a}main{max-width:660px;margin:auto;padding:22px}h1{font-size:26px}form,section{background:white;padding:20px;border-radius:14px;margin:16px 0;box-shadow:0 2px 10px #10283a15}label{display:block;margin:12px 0;font-weight:650}input,select,textarea{display:block;width:100%;box-sizing:border-box;padding:10px;margin-top:5px;border:1px solid #b9c9d0;border-radius:7px;font:inherit}button{border:0;border-radius:8px;background:#118358;color:white;padding:12px 16px;font:inherit;font-weight:700;margin:5px 5px 5px 0}button:disabled{opacity:.5}small{display:block;color:#536574}li{margin:12px 0}a{color:#086b54}</style></head><body><main><a href="/contractor">← Contractor dashboard</a><h1>Offline shift & breakdown capture</h1><p id="identity">Checking company…</p><p id="status" role="status"></p><form id="form"><label>Date<input name="reportDate" type="date" required></label><label>Site<input name="site" maxlength="100" required></label><label>Fleet number<input name="fleetNumber" maxlength="100" required></label><label>Activity<select name="activity"><option value="operating">Shift / operating</option><option value="breakdown">Breakdown</option></select></label><label>Hours<input name="hours" type="number" min="0" max="24" step="0.01" required></label><label>Tonnes (optional)<input name="tonnes" type="number" min="0" step="0.01"></label><label>Fault or shift note<textarea name="faultReason" maxlength="1000"></textarea></label><button type="submit">Save on this device</button></form><section><h2>Pending records</h2><button id="sync" type="button">Sync now</button><small>Records stay on this device until the server confirms them. Use a trusted device; offline records can be read by someone with access to this browser.</small><ul id="list"></ul></section></main><script>
const $=id=>document.getElementById(id), dbName='tmm-contractor-offline-v1';let identity=null,db;
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(dbName,1);r.onupgradeneeded=()=>r.result.createObjectStore('records',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function tx(mode,fn){return new Promise((resolve,reject)=>{const t=db.transaction('records',mode),s=t.objectStore('records'),r=fn(s);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
const all=()=>tx('readonly',s=>s.getAll());const put=v=>tx('readwrite',s=>s.put(v));const del=id=>tx('readwrite',s=>s.delete(id));
function message(v){$('status').textContent=v}async function render(){const items=await all();$('list').replaceChildren();for(const item of items){const li=document.createElement('li');li.textContent=item.reportDate+' · '+item.fleetNumber+' · '+item.activity+' ('+item.state+')';$('list').append(li)}$('sync').disabled=!identity||!navigator.onLine||!items.length}
async function identify(){if(!navigator.onLine)return;try{const r=await fetch('/api/contractor/offline-identity',{cache:'no-store'});if(!r.ok){identity=null;message('Sign in online to unlock capture and sync.');return}identity=await r.json();const prior=localStorage.getItem('tmm-offline-company');if(prior&&prior!==String(identity.companyId)){identity=null;message('Different company on this device. Resolve its pending records before using this browser for another company.');return}localStorage.setItem('tmm-offline-company',String(identity.companyId));localStorage.setItem('tmm-offline-name',identity.companyName);$('identity').textContent=identity.companyName;await render()}catch{message('Connection unavailable. Saved records remain on this device.')}}
async function sync(){if(!identity||!navigator.onLine)return;for(const item of await all()){if(item.companyId!==identity.companyId){message('Company mismatch. Sync stopped.');return}try{const r=await fetch('/api/contractor/offline-sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(item)});if(r.status===401||r.status===403){identity=null;message('Sign in online to sync.');return}if(!r.ok){message('Sync paused: '+(await r.json()).error);return}await del(item.id)}catch{message('Connection lost. Records remain pending.');return}}message('Sync complete.');await render()}
(async()=>{db=await openDB();$('form').reportDate.valueAsDate=new Date();if(localStorage.getItem('tmm-offline-company')){$('identity').textContent=localStorage.getItem('tmm-offline-name')+' · offline access';identity={companyId:Number(localStorage.getItem('tmm-offline-company'))};}await render();await identify();$('form').addEventListener('submit',async e=>{e.preventDefault();if(!identity){message('Sign in online once before capturing offline.');return}const v=Object.fromEntries(new FormData(e.target));await put({...v,id:crypto.randomUUID(),companyId:identity.companyId,state:'pending'});e.target.reset();e.target.reportDate.valueAsDate=new Date();message('Saved on this device. Sync when connected.');await render()});$('sync').onclick=sync;addEventListener('online',async()=>{await identify();await sync()});addEventListener('offline',()=>{message('Offline. You can continue capturing.');render()})})();
</script></body></html>`;

export async function offlineContractor(req: Request, env: Env): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path === "/contractor/offline" && req.method === "GET") return new Response(shell, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'" } });
  const s = await session(req, env);
  if (!s) return json({ error: "Sign in online to continue." }, 401);
  if (path === "/api/contractor/offline-identity" && req.method === "GET") return json({ companyId: s.companyId, companyName: s.companyName });
  if (path !== "/api/contractor/offline-sync" || req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(req.headers.get("content-type") || "").startsWith("application/json") || Number(req.headers.get("content-length") || 0) > 10000) return json({ error: "Invalid request" }, 400);
  if (req.headers.get("origin") !== new URL(req.url).origin) return json({ error: "Invalid origin" }, 403);
  let v: Record<string, unknown>;
  try { v = await req.json() as Record<string, unknown> } catch { return json({ error: "Invalid JSON" }, 400) }
  if (Number(v.companyId) !== s.companyId || !/^[0-9a-f-]{36}$/i.test(String(v.id)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(v.reportDate)) || !Number.isFinite(Date.parse(String(v.reportDate))) || !["operating", "breakdown"].includes(String(v.activity))) return json({ error: "Invalid record" }, 400);
  const site = String(v.site || "").trim(), fleet = String(v.fleetNumber || "").trim(), note = String(v.faultReason || "").trim(), hours = Number(v.hours), tonnes = v.tonnes === "" ? null : Number(v.tonnes);
  if (!site || site.length > 100 || !fleet || fleet.length > 100 || note.length > 1000 || !Number.isFinite(hours) || hours < 0 || hours > 24 || tonnes !== null && (!Number.isFinite(tonnes) || tonnes < 0)) return json({ error: "Invalid fields" }, 400);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS offline_capture_receipts (company_id INTEGER NOT NULL, client_id TEXT NOT NULL, report_id INTEGER, PRIMARY KEY(company_id,client_id))").run();
  // A single D1 batch is transactional: a duplicate client ID aborts both inserts.
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO offline_capture_receipts(company_id,client_id) VALUES(?,?)").bind(s.companyId, v.id),
      env.DB.prepare("INSERT INTO daily_reports_v3(company_id,report_date,site,fleet_number,activity,capture_basis,time_value,time_unit,duration_hours,tonnes,fault_reason,severity,source_kind,created_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(s.companyId, v.reportDate, site, fleet, v.activity, "time", hours, "hours", hours, tonnes, note || null, "medium", "offline", s.accountId, "saved", new Date().toISOString())
    ]);
  } catch (error) {
    const existing = await env.DB.prepare("SELECT client_id FROM offline_capture_receipts WHERE company_id=? AND client_id=?").bind(s.companyId, v.id).first();
    if (existing) return json({ ok: true, duplicate: true });
    throw error;
  }
  return json({ ok: true });
}
