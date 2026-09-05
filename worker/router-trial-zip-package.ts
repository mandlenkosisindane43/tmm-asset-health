import currentApp from "./router-owner-licence-ui";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime: number; cron: string; noRetry(): void; }
interface Env { DB: D1Database; BUCKET?: R2Bucket; [key: string]: unknown; }
type Row = Record<string, unknown>;
type Session = { companyId:number; accountId:number; role:string; token:string; companyName:string };

const COOKIE = "sas_contractor_v2";
const enc = new TextEncoder();
function txt(v:unknown,n=300){return String(v??"").trim().slice(0,n)}
function lower(v:unknown){return txt(v).toLowerCase()}
function num(v:unknown,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
function esc(v:unknown){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c))}
function cookie(req:Request,name:string){for(const p of (req.headers.get("cookie")||"").split(";")){const i=p.indexOf("=");if(i>0&&p.slice(0,i).trim()===name)return p.slice(i+1).trim()}return ""}
async function hash(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(v))),b=>b.toString(16).padStart(2,"0")).join("")}
async function first(env:Env,sql:string,binds:unknown[]=[]){return env.DB.prepare(sql).bind(...binds).first<Row>()}
async function all(env:Env,sql:string,binds:unknown[]=[]){return (await env.DB.prepare(sql).bind(...binds).all<Row>()).results||[]}
async function session(req:Request,env:Env):Promise<Session|null>{
  const token=cookie(req,COOKIE); if(!token)return null;
  const r=await first(env,`SELECT s.company_id companyId,s.account_id accountId,COALESCE(NULLIF(s.active_role,''),a.role) role,c.name companyName FROM contractor_sessions s JOIN contractor_accounts a ON a.id=s.account_id JOIN companies c ON c.id=s.company_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') AND a.status='active' LIMIT 1`,[await hash(token)]).catch(()=>null);
  return r?{companyId:num(r.companyId),accountId:num(r.accountId),role:lower(r.role),token,companyName:txt(r.companyName)}:null;
}
async function ensure(env:Env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS demo_zip_packages_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,package_name TEXT NOT NULL,object_key TEXT,imported_by INTEGER NOT NULL,imported_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS demo_zip_sections_v1(id INTEGER PRIMARY KEY AUTOINCREMENT,package_id INTEGER NOT NULL,company_id INTEGER NOT NULL,section_key TEXT NOT NULL,file_name TEXT NOT NULL,row_count INTEGER NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_demo_zip_company ON demo_zip_packages_v1(company_id,id)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_demo_zip_sections ON demo_zip_sections_v1(company_id,package_id,section_key)`).run();
}
function u16(v:DataView,o:number){return v.getUint16(o,true)}
function u32(v:DataView,o:number){return v.getUint32(o,true)}
async function unzip(bytes:Uint8Array){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(u32(view,i)===0x06054b50){eocd=i;break}}
  if(eocd<0)throw new Error("Invalid ZIP file: end record not found.");
  const total=u16(view,eocd+10), central=u32(view,eocd+16); let p=central;
  const out:{name:string;bytes:Uint8Array}[]=[];
  for(let i=0;i<total;i++){
    if(u32(view,p)!==0x02014b50)throw new Error("Invalid ZIP directory.");
    const method=u16(view,p+10), compSize=u32(view,p+20), nameLen=u16(view,p+28), extraLen=u16(view,p+30), commentLen=u16(view,p+32), localOff=u32(view,p+42);
    const name=new TextDecoder().decode(bytes.slice(p+46,p+46+nameLen)); p+=46+nameLen+extraLen+commentLen;
    if(name.endsWith("/"))continue;
    if(u32(view,localOff)!==0x04034b50)throw new Error(`Invalid ZIP entry: ${name}`);
    const localName=u16(view,localOff+26), localExtra=u16(view,localOff+28), start=localOff+30+localName+localExtra, compressed=bytes.slice(start,start+compSize);
    let data:Uint8Array;
    if(method===0)data=compressed;
    else if(method===8){
      const ds=new DecompressionStream("deflate-raw" as CompressionFormat); const ab=await new Response(new Blob([compressed]).stream().pipeThrough(ds)).arrayBuffer(); data=new Uint8Array(ab);
    } else throw new Error(`ZIP compression method ${method} is not supported (${name}).`);
    out.push({name,bytes:data});
  }
  return out;
}
function csvLine(line:string){const out:string[]=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(c===","&&!q){out.push(cur.trim());cur=""}else cur+=c}out.push(cur.trim());return out}
function parseCsv(bytes:Uint8Array){const lines=new TextDecoder().decode(bytes).split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return [] as Row[];const h=csvLine(lines[0]);return lines.slice(1).map(line=>{const vals=csvLine(line),r:Row={};h.forEach((k,i)=>r[k]=vals[i]??"");return r})}
function normal(r:Row){const n:Row={};for(const[k,v]of Object.entries(r))n[k.toLowerCase().replace(/[^a-z0-9]/g,"")]=v;return n}
function sectionKey(name:string){const n=name.toLowerCase();if(n.includes("monthly_summary"))return "summary";if(n.includes("fleet_register"))return "fleet";if(n.includes("daily_production"))return "production";if(n.includes("breakdown"))return "breakdowns";if(n.includes("maintenance"))return "maintenance";if(n.includes("work_order"))return "work_orders";if(n.includes("quotation"))return "quotations";if(n.includes("purchase_order"))return "purchase_orders";if(n.includes("payment"))return "payments";if(n.includes("spares"))return "spares";return "other"}
async function importFleet(env:Env,s:Session,rows:Row[]){let created=0,updated=0;for(const raw of rows){const n=normal(raw);const fleet=txt(n.machineid||n.fleetnumber||n.machine||n.fleet,120);if(!fleet)continue;const category=txt(n.machinetype||n.type||n.category||"Machine",120),site=txt(n.sitearea||n.site||"Main Site",120);let status=lower(n.status||"operating");if(status==="active")status="operating";const hours=num(n.openinghourmeter??n.hourmeter??n.operatinghours),nextRaw=n.nextservicehour??n.nextservicehours,next=String(nextRaw??"").trim()===""?null:num(nextRaw);const ex=await first(env,"SELECT id FROM machines WHERE company_id=? AND lower(fleet_number)=lower(?) ORDER BY id LIMIT 1",[s.companyId,fleet]);if(ex){await env.DB.prepare("UPDATE machines SET fleet_number=?,category=?,site=?,status=?,operating_hours=?,next_service_hours=? WHERE id=? AND company_id=?").bind(fleet,category,site,status,hours,next,num(ex.id),s.companyId).run();updated++}else{await env.DB.prepare("INSERT INTO machines(company_id,fleet_number,category,site,status,operating_hours,availability_target,next_service_hours,created_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(s.companyId,fleet,category,site,status,hours,0.9,next,new Date().toISOString()).run();created++}}
  return {created,updated};
}
function redirect(msg:string,tone="ok"){return new Response(null,{status:303,headers:{location:`/trial-demo?msg=${encodeURIComponent(msg)}&tone=${tone}`,"cache-control":"no-store"}})}
async function importZip(req:Request,env:Env,s:Session){
  if(!["company_admin","admin"].includes(s.role))return redirect("Company Administrator authority is required.","err");
  const form=await req.formData(),csrf=txt(form.get("csrf")),file=form.get("file");
  if(csrf!==await hash(s.token+"|trial-demo"))return redirect("Security check failed. Sign in again.","err");
  if(!(file instanceof File)||!/\.zip$/i.test(file.name)||file.size===0)return redirect("Choose a non-empty ZIP package.","err");
  if(file.size>20*1024*1024)return redirect("ZIP package is too large. Keep it below 20 MB.","err");
  await ensure(env);
  const rawBytes=new Uint8Array(await file.arrayBuffer()),entries=await unzip(rawBytes);
  const csvEntries=entries.filter(e=>e.name.toLowerCase().endsWith(".csv")); if(!csvEntries.length)return redirect("No CSV files were found inside the ZIP package.","err");
  const sections=csvEntries.map(e=>({name:e.name,key:sectionKey(e.name),bytes:e.bytes,rows:parseCsv(e.bytes)}));
  const fleet=sections.find(x=>x.key==="fleet"),production=sections.find(x=>x.key==="production");
  if(!production)return redirect("ZIP package must contain a Daily Production CSV file.","err");
  let fleetMsg=""; if(fleet){const r=await importFleet(env,s,fleet.rows);fleetMsg=` ${r.created} fleet unit(s) registered and ${r.updated} updated.`}
  let objectKey=""; if(env.BUCKET){objectKey=`company/${s.companyId}/trial-demo/packages/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;await env.BUCKET.put(objectKey,rawBytes,{httpMetadata:{contentType:"application/zip"}})}
  const now=new Date().toISOString(),pkg=await env.DB.prepare("INSERT INTO demo_zip_packages_v1(company_id,package_name,object_key,imported_by,imported_at) VALUES(?,?,?,?,?)").bind(s.companyId,file.name,objectKey||null,s.accountId,now).run(),packageId=num(pkg.meta?.last_row_id);
  for(const sec of sections){await env.DB.prepare("INSERT INTO demo_zip_sections_v1(package_id,company_id,section_key,file_name,row_count,data_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(packageId,s.companyId,sec.key,sec.name,sec.rows.length,JSON.stringify(sec.rows),now).run()}
  const headers=new Headers(req.headers);headers.delete("content-type");headers.delete("content-length");const fwd=new FormData();fwd.set("csrf",csrf);fwd.set("file",new File([production.bytes],production.name,{type:"text/csv"}));
  const target=new URL(req.url);target.pathname="/trial-demo/import";target.search="";
  const result=await currentApp.fetch(new Request(target.toString(),{method:"POST",headers,body:fwd}),env as never,{} as never);
  if(result.status>=300&&result.status<400){const loc=result.headers.get("location")||"/trial-demo";const u=new URL(loc,req.url);const old=u.searchParams.get("msg")||"Production data imported.";u.searchParams.set("msg",`${old}${fleetMsg} ZIP sections saved: ${sections.map(x=>`${x.key} (${x.rows.length})`).join(", ")}.`);return new Response(null,{status:303,headers:{location:u.pathname+u.search,"cache-control":"no-store"}})}
  return result;
}
function table(rows:Row[],limit=100){if(!rows.length)return `<p class="zip-empty">No rows.</p>`;const keys=Object.keys(rows[0]).slice(0,12),shown=rows.slice(0,limit);return `<div class="zip-table-wrap"><table class="zip-table"><thead><tr>${keys.map(k=>`<th>${esc(k)}</th>`).join("")}</tr></thead><tbody>${shown.map(r=>`<tr>${keys.map(k=>`<td>${esc(r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${rows.length>limit?`<p class="zip-note">Showing first ${limit} of ${rows.length} rows. All ${rows.length} rows were imported/stored.</p>`:""}`}
const zipCss=`<style id="sas-zip-package-css">.zip-import{margin-bottom:12px;border:1px solid #cbd8d2;background:#fff;border-radius:12px;padding:16px}.zip-import h2{margin:0 0 6px;font-size:16px}.zip-import p{font-size:11px;color:#64736f}.zip-upload{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.zip-package{margin-top:12px}.zip-package>h2{margin:0 0 10px}.zip-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px}.zip-card{border:1px solid #dce5e1;border-radius:9px;padding:10px;background:#f9fbfa}.zip-card small,.zip-card b{display:block}.zip-card small{font-size:9px;color:#6b7a75}.zip-card b{font-size:18px;margin-top:4px}.zip-section{margin:9px 0;border:1px solid #e1e8e4;border-radius:9px;background:#fff}.zip-section summary{cursor:pointer;padding:11px;font-weight:800;font-size:12px}.zip-table-wrap{overflow:auto;max-height:430px;border-top:1px solid #edf1ef}.zip-table{width:100%;border-collapse:collapse;font-size:9px}.zip-table th{position:sticky;top:0;background:#f3f6f5;text-align:left;padding:7px;white-space:nowrap}.zip-table td{padding:7px;border-top:1px solid #edf1ef;white-space:nowrap}.zip-note,.zip-empty{padding:0 10px 10px;color:#718079;font-size:10px}@media(max-width:900px){.zip-summary{grid-template-columns:1fr 1fr}.zip-upload{display:block}}</style>`;
async function injectZip(req:Request,env:Env,s:Session,response:Response){
  if(req.method!=="GET"||new URL(req.url).pathname!=="/trial-demo")return response;const type=response.headers.get("content-type")||"";if(!type.includes("text/html")||response.status>=400)return response;await ensure(env);
  const pkg=await first(env,"SELECT * FROM demo_zip_packages_v1 WHERE company_id=? ORDER BY id DESC LIMIT 1",[s.companyId]);let packageHtml="";
  if(pkg){const secs=await all(env,"SELECT * FROM demo_zip_sections_v1 WHERE company_id=? AND package_id=? ORDER BY id",[s.companyId,num(pkg.id)]);const parsed=secs.map(x=>({...x,rows:(()=>{try{return JSON.parse(String(x.data_json||"[]")) as Row[]}catch{return [] as Row[]}})()}));const get=(k:string)=>parsed.find(x=>x.section_key===k);packageHtml=`<section class="panel zip-package"><h2>Complete ZIP Package · ${esc(pkg.package_name)}</h2><div class="zip-summary"><div class="zip-card"><small>Fleet</small><b>${num(get("fleet")?.row_count)}</b></div><div class="zip-card"><small>Production rows</small><b>${num(get("production")?.row_count)}</b></div><div class="zip-card"><small>Breakdowns</small><b>${num(get("breakdowns")?.row_count)}</b></div><div class="zip-card"><small>Work orders</small><b>${num(get("work_orders")?.row_count)}</b></div><div class="zip-card"><small>Commercial records</small><b>${num(get("quotations")?.row_count)+num(get("purchase_orders")?.row_count)+num(get("payments")?.row_count)}</b></div></div>${parsed.map(sec=>`<details class="zip-section" ${sec.section_key==="summary"?"open":""}><summary>${esc(String(sec.section_key).replaceAll("_"," ").toUpperCase())} · ${num(sec.row_count)} row(s) · ${esc(sec.file_name)}</summary>${table(sec.rows,sec.section_key==="production"?100:200)}</details>`).join("")}</section>`}
  const csrf=await hash(s.token+"|trial-demo"),admin=["company_admin","admin"].includes(s.role);const upload=admin?`<section class="zip-import"><h2>Import Complete Previous-Month ZIP Package</h2><p>Upload one ZIP containing Fleet, Daily Production, Breakdowns, Maintenance, Work Orders, Quotations, Purchase Orders, Payments and Spares CSV files. Fleet is matched/registered first, then production is analysed by the existing trial engine. Email alerts remain silent until you select recipients and press Send Alert Demonstration.</p><form class="zip-upload" method="post" action="/trial-demo/import-zip" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${csrf}"><label class="field">Complete ZIP package<input type="file" name="file" accept=".zip,application/zip" required></label><button class="btn" type="submit">Import ZIP & Analyse</button></form></section>`:"";
  let body=await response.text();body=body.replace("</head>",`${zipCss}</head>`);const marker='<div class="safe">';const idx=body.indexOf(marker);if(idx!==-1)body=body.slice(0,idx)+upload+body.slice(idx);else body=body.replace('<main class="wrap">',`<main class="wrap">${upload}`);body=body.replace("</main>",`${packageHtml}</main>`);const h=new Headers(response.headers);h.set("cache-control","private, no-store,max-age=0");h.delete("content-length");return new Response(body,{status:response.status,headers:h});
}
export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(req.url);if(req.method==="POST"&&url.pathname==="/trial-demo/import-zip"){const s=await session(req,env);if(!s)return new Response(null,{status:302,headers:{location:"/contractor-login?next=/trial-demo"}});try{return await importZip(req,env,s)}catch(e){return redirect(`ZIP import failed: ${e instanceof Error?e.message:String(e)}`,"err")}}
    const response=await currentApp.fetch(req,env as never,ctx as never);if(req.method==="GET"&&url.pathname==="/trial-demo"){const s=await session(req,env);if(s)try{return await injectZip(req,env,s,response)}catch(e){console.error("TRIAL_ZIP_UI_ERROR",e)}}return response;
  },
  async scheduled(controller:ScheduledController,env:Env,ctx:ExecutionContext){return currentApp.scheduled(controller as never,env as never,ctx as never)}
};