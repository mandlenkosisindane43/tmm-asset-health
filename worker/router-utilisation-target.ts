import currentApp from "./router-automatic-month-archive";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { DB:D1Database; [key:string]:unknown; }

type Row=Record<string,unknown>;
const COOKIE="sas_contractor_v2";
const enc=new TextEncoder();
const txt=(v:unknown,n=240)=>String(v??"").trim().slice(0,n);
const num=(v:unknown,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
async function hash(v:string){const b=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v)));return Array.from(b,x=>x.toString(16).padStart(2,"0")).join("")}
function cookie(req:Request){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>0&&p.slice(0,i).trim()===COOKIE)return p.slice(i+1).trim()}return ""}
async function first(env:Env,sql:string,b:unknown[]=[]){try{return await env.DB.prepare(sql).bind(...b).first<Row>()}catch{return null}}
async function companyId(req:Request,env:Env){const token=cookie(req);if(!token)return 0;const r=await first(env,`SELECT company_id FROM contractor_sessions WHERE token_hash=? AND datetime(expires_at)>datetime('now') LIMIT 1`,[await hash(token)]);return num(r?.company_id)}
let ensured=false;
async function ensure(env:Env){if(ensured)return;try{await env.DB.prepare(`ALTER TABLE company_settings_v3 ADD COLUMN utilisation_target REAL NOT NULL DEFAULT 85`).run()}catch{}ensured=true}

function addField(body:string,value:number){if(body.includes('name="utilisationTarget"'))return body;const avail=`<label class="field">Availability target (%)<input name="availabilityTarget" type="number" min="0" max="100" step="0.1" value="`;
const i=body.indexOf(avail);if(i<0)return body;
const end=body.indexOf('</label>',i);if(end<0)return body;
const field=`<label class="field">Utilisation target (%)<input name="utilisationTarget" type="number" min="0" max="100" step="0.1" value="${value.toFixed(1)}"></label>`;
return body.slice(0,end+8)+field+body.slice(end+8)}

export default {
 async fetch(req:Request,env:Env,ctx:ExecutionContext){
  await ensure(env);
  const url=new URL(req.url);
  if(req.method==="POST"&&url.pathname==="/company-admin/setup/save"){
    const clone=req.clone();
    let utilisation=85;
    try{const f=await clone.formData();utilisation=Math.max(0,Math.min(100,num(f.get("utilisationTarget"),85)))}catch{}
    const res=await currentApp.fetch(req,env as never,ctx as never);
    const cid=await companyId(clone,env);
    if(cid)await env.DB.prepare(`UPDATE company_settings_v3 SET utilisation_target=?,updated_at=? WHERE company_id=?`).bind(utilisation,new Date().toISOString(),cid).run();
    return res;
  }
  const res=await currentApp.fetch(req,env as never,ctx as never);
  if(req.method!=="GET"||url.pathname!=="/contractor"||!["settings","setup"].includes(url.searchParams.get("view")||""))return res;
  const ct=res.headers.get("content-type")||"";if(!ct.includes("text/html"))return res;
  const cid=await companyId(req,env);let target=85;if(cid){const r=await first(env,"SELECT utilisation_target FROM company_settings_v3 WHERE company_id=?",[cid]);target=num(r?.utilisation_target,85)}
  let body=await res.text();body=addField(body,target);
  const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","private, no-store");return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
 },
 async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){await ensure(env);const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};if(app.scheduled)return app.scheduled(c,env,ctx)}
};
