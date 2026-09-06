import currentApp from "./router-security-recovery";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; BUCKET?:R2Bucket; [key:string]:unknown; }
type Row=Record<string,unknown>;

const COOKIE="sas_contractor_v2";
const enc=new TextEncoder();
const txt=(v:unknown,n=500)=>String(v??"").trim().slice(0,n);
const num=(v:unknown,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
async function sha256(v:string){const b=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v)));return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("")}
function cookie(req:Request){const raw=req.headers.get("cookie")||"";for(const p of raw.split(";")){const i=p.indexOf("=");if(i>0&&p.slice(0,i).trim()===COOKIE)return p.slice(i+1).trim()}return ""}
async function first(env:Env,sql:string,b:unknown[]=[]){try{return await env.DB.prepare(sql).bind(...b).first<Row>()}catch{return null}}
async function all(env:Env,sql:string,b:unknown[]=[]){try{return (await env.DB.prepare(sql).bind(...b).all<Row>()).results||[]}catch{return []}}

const TABLES:Record<string,string>={
 machine:"machines",
 daily_report:"daily_reports_v3",
 production:"production_records",
 breakdown:"events",
 document:"contractor_documents",
 alert_contact:"alert_contacts_v3",
 site:"company_sites",
 approval:"approvals_v3"
};

async function ensure(env:Env){for(const q of [
`CREATE TABLE IF NOT EXISTS recycle_bin_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,entity_type TEXT NOT NULL,source_table TEXT NOT NULL,source_id INTEGER NOT NULL,display_name TEXT,record_json TEXT NOT NULL,deleted_by INTEGER NOT NULL,deleted_by_email TEXT,deleted_at TEXT NOT NULL,restored_at TEXT,restored_by INTEGER,permanently_deleted_at TEXT,status TEXT NOT NULL DEFAULT 'trashed')`,
`CREATE INDEX IF NOT EXISTS idx_recycle_company_status ON recycle_bin_v1(company_id,status,deleted_at)`,
`CREATE UNIQUE INDEX IF NOT EXISTS idx_recycle_active_source ON recycle_bin_v1(company_id,source_table,source_id) WHERE status='trashed'`
])await env.DB.prepare(q).run()}

async function session(req:Request,env:Env){const token=cookie(req);if(!token)return null;const r=await first(env,`SELECT s.company_id,s.account_id,s.expires_at,a.email,a.role,a.status account_status,c.name company_name,c.licence_status,c.expires_at licence_expires,c.grace_days FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id AND a.company_id=s.company_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? LIMIT 1`,[await sha256(token)]);if(!r)return null;if(txt(r.account_status)!=="active")return null;if(new Date(txt(r.expires_at,60)).getTime()<Date.now())return null;const ls=txt(r.licence_status).toLowerCase();const end=new Date(txt(r.licence_expires,60)).getTime()+num(r.grace_days)*86400000;if(!["active","trial"].includes(ls)||Date.now()>end)return null;return r}
function allowed(s:Row|null){return !!s&&["company_admin","admin","engineer"].includes(txt(s.role).toLowerCase())}
function redirect(loc:string){return new Response(null,{status:303,headers:{location:loc,"cache-control":"no-store"}})}

function label(entity:string,row:Row){if(entity==="machine")return txt(row.fleet_number||row.id);if(entity==="daily_report")return `${txt(row.report_date)} · ${txt(row.fleet_number)}`;if(entity==="production")return `${txt(row.report_date)} · ${txt(row.fleet_number)}`;if(entity==="breakdown")return `${txt(row.fleet_number)} · ${txt(row.description,120)}`;if(entity==="document")return txt(row.file_name||row.id);if(entity==="alert_contact")return txt(row.name||row.email||row.id);if(entity==="site")return txt(row.name||row.id);if(entity==="approval")return txt(row.title||row.id);return txt(row.id)}

async function trash(req:Request,env:Env){await ensure(env);const s=await session(req,env);if(!allowed(s))return new Response("Forbidden",{status:403});const f=await req.formData();const entity=txt(f.get("entity_type"),60),id=num(f.get("record_id"));const table=TABLES[entity];if(!table||id<=0)return new Response("Invalid recycle request",{status:400});const row=await first(env,`SELECT * FROM ${table} WHERE id=? AND company_id=? LIMIT 1`,[id,num(s!.company_id)]);if(!row)return new Response("Record not found",{status:404});const now=new Date().toISOString();const display=label(entity,row);await env.DB.batch([
 env.DB.prepare(`INSERT INTO recycle_bin_v1(company_id,entity_type,source_table,source_id,display_name,record_json,deleted_by,deleted_by_email,deleted_at,status) VALUES(?,?,?,?,?,?,?,?,?,'trashed')`).bind(num(s!.company_id),entity,table,id,display,JSON.stringify(row),num(s!.account_id),txt(s!.email,200),now),
 env.DB.prepare(`DELETE FROM ${table} WHERE id=? AND company_id=?`).bind(id,num(s!.company_id))
]);return redirect("/recycle-bin?msg=Moved%20to%20Recycle%20Bin")}

function safeColumns(row:Row){return Object.keys(row).filter(k=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))}
async function restore(req:Request,env:Env){await ensure(env);const s=await session(req,env);if(!allowed(s))return new Response("Forbidden",{status:403});const f=await req.formData();const binId=num(f.get("bin_id"));const bin=await first(env,`SELECT * FROM recycle_bin_v1 WHERE id=? AND company_id=? AND status='trashed' LIMIT 1`,[binId,num(s!.company_id)]);if(!bin)return new Response("Recycle item not found",{status:404});const table=txt(bin.source_table,80);if(!Object.values(TABLES).includes(table))return new Response("Unsupported record type",{status:400});let row:Row;try{row=JSON.parse(txt(bin.record_json,200000)) as Row}catch{return new Response("Stored record is damaged",{status:500})}if(num(row.company_id)!==num(s!.company_id))return new Response("Company mismatch",{status:403});const cols=safeColumns(row);if(!cols.length)return new Response("Nothing to restore",{status:400});const exists=await first(env,`SELECT id FROM ${table} WHERE id=? LIMIT 1`,[num(row.id)]);if(exists)return new Response("Cannot restore because that record ID is already in use",{status:409});const sql=`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(()=>"?").join(",")})`;await env.DB.batch([
 env.DB.prepare(sql).bind(...cols.map(c=>row[c]??null)),
 env.DB.prepare(`UPDATE recycle_bin_v1 SET status='restored',restored_at=?,restored_by=? WHERE id=? AND company_id=?`).bind(new Date().toISOString(),num(s!.account_id),binId,num(s!.company_id))
]);return redirect("/recycle-bin?msg=Record%20restored")}

async function purge(req:Request,env:Env){await ensure(env);const s=await session(req,env);if(!s||!["company_admin","admin"].includes(txt(s.role).toLowerCase()))return new Response("Forbidden",{status:403});const f=await req.formData();const binId=num(f.get("bin_id"));const bin=await first(env,`SELECT * FROM recycle_bin_v1 WHERE id=? AND company_id=? AND status='trashed' LIMIT 1`,[binId,num(s.company_id)]);if(!bin)return new Response("Recycle item not found",{status:404});if(txt(bin.entity_type)==="document"&&env.BUCKET){try{const row=JSON.parse(txt(bin.record_json,200000)) as Row;const key=txt(row.object_key,500);if(key)await env.BUCKET.delete(key)}catch{}}
await env.DB.prepare(`UPDATE recycle_bin_v1 SET status='permanently_deleted',permanently_deleted_at=? WHERE id=? AND company_id=?`).bind(new Date().toISOString(),binId,num(s.company_id)).run();return redirect("/recycle-bin?msg=Permanently%20deleted")}

async function page(req:Request,env:Env){await ensure(env);const s=await session(req,env);if(!allowed(s))return redirect("/contractor");const rows=await all(env,`SELECT id,entity_type,display_name,deleted_by_email,deleted_at FROM recycle_bin_v1 WHERE company_id=? AND status='trashed' ORDER BY id DESC LIMIT 250`,[num(s!.company_id)]);const msg=txt(new URL(req.url).searchParams.get("msg"),200);const tr=rows.map(r=>`<tr><td>${esc(String(r.deleted_at||"").slice(0,19).replace("T"," "))}</td><td>${esc(txt(r.entity_type).replaceAll("_"," "))}</td><td><b>${esc(r.display_name||"Record")}</b></td><td>${esc(r.deleted_by_email||"System")}</td><td><form method="post" action="/recycle-bin/restore" style="display:inline"><input type="hidden" name="bin_id" value="${num(r.id)}"><button class="restore">Restore</button></form>${["company_admin","admin"].includes(txt(s!.role).toLowerCase())?` <form method="post" action="/recycle-bin/purge" style="display:inline" onsubmit="return confirm('Permanently delete this item? This cannot be undone.')"><input type="hidden" name="bin_id" value="${num(r.id)}"><button class="purge">Delete permanently</button></form>`:""}</td></tr>`).join("");return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recycle Bin</title><style>body{font-family:Arial;background:#f4f7fb;color:#10203a;margin:0}.w{max-width:1200px;margin:auto;padding:24px}.p{background:#fff;border:1px solid #dce4ef;border-radius:12px;padding:18px}.note{background:#eef8f3;border:1px solid #b8dfca;padding:12px;border-radius:9px;margin:12px 0}.msg{background:#eaf5ff;border:1px solid #b8d7f3;padding:10px;border-radius:8px;margin-bottom:12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:10px;border-top:1px solid #e7edf4;text-align:left}button{border:0;border-radius:7px;padding:8px 11px;font-weight:700;cursor:pointer}.restore{background:#0a7a49;color:white}.purge{background:#f2e5e5;color:#9b1c1c}</style></head><body><main class="w"><p><a href="/contractor">← Company Admin</a> · <a href="/security-recovery">Security & Recovery</a></p><h1>Recycle Bin</h1><p>Deleted company records can be restored here. Nothing in this bin is removed automatically.</p>${msg?`<div class="msg">${esc(msg)}</div>`:""}<div class="note"><b>Safe delete:</b> Supported records are copied here before deletion. Uploaded document files are kept in R2 while they remain in the Recycle Bin.</div><section class="p"><table><tr><th>Deleted</th><th>Type</th><th>Record</th><th>Deleted by</th><th>Action</th></tr>${tr||`<tr><td colspan="5">Recycle Bin is empty.</td></tr>`}</table></section></main></body></html>`,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store"}})}

export default {async fetch(req:Request,env:Env,ctx:ExecutionContext){const u=new URL(req.url);if(u.pathname==="/recycle-bin"&&req.method==="GET")return page(req,env);if(u.pathname==="/recycle-bin/trash"&&req.method==="POST")return trash(req,env);if(u.pathname==="/recycle-bin/restore"&&req.method==="POST")return restore(req,env);if(u.pathname==="/recycle-bin/purge"&&req.method==="POST")return purge(req,env);return currentApp.fetch(req,env as never,ctx as never)},async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};if(app.scheduled)return app.scheduled(c,env,ctx)}};
