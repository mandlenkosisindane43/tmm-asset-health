import {analyseDashboard,chart,paretoChart,analyticsStyle,escapeHtml as esc} from './dashboard-analytics';
type Row=Record<string,unknown>;
type Env={DB:D1Database};
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const fmt=(v:unknown)=>n(v).toLocaleString('en-ZA',{maximumFractionDigits:1});
async function query(env:Env,sql:string,binds:unknown[]){
 try{return {rows:(await env.DB.prepare(sql).bind(...binds).all<Row>()).results||[],available:true};}
 catch{return {rows:[] as Row[],available:false};}
}
function table(title:string,heads:string[],rows:unknown[][],note=''){
 return `<section class="panel chart"><h2>${esc(title)}</h2>${note?`<p>${esc(note)}</p>`:''}<div class="chart-scroll"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}">No matching records.</td></tr>`}</tbody></table></div></section>`;
}
export function missingReports(machines:Row[],production:Row[],start:string,end:string,today:string){
 const captured=new Set(production.map(r=>`${r.reportDate}|${r.fleet}`)),missing:unknown[][]=[];
 for(let day=start;day<end&&day<today;day=new Date(Date.parse(day)+86400000).toISOString().slice(0,10)){
  for(const m of machines){if(['inactive','retired'].includes(String(m.status).toLowerCase())||String(m.created_at||'').slice(0,10)>day)continue;
   if(!captured.has(`${day}|${m.fleet}`))missing.push([day,m.fleet,m.site||'—']);
  }
 }
 return missing;
}
export async function completePeriodSummary(env:Env,companyId:number,start:string,end:string,historical?:{production:Row[];events:Row[]}){
 const binds=[companyId,start,end];
 const [machines,production,events,parts,orders,settings]=await Promise.all([
  query(env,'SELECT fleet_number fleet,site,status,created_at,operating_hours hours,next_service_hours nextService FROM machines WHERE company_id=?',[companyId]),
  historical?Promise.resolve({rows:historical.production,available:true}):query(env,'SELECT report_date reportDate,fleet_number fleet,shift_hours shiftHours,planned_downtime plannedDowntime,unplanned_downtime unplannedDowntime,operating_hours operatingHours,tonnes,fault_reason fault FROM production_records WHERE company_id=? AND report_date>=? AND report_date<? ORDER BY report_date',binds),
  historical?Promise.resolve({rows:historical.events,available:true}):query(env,'SELECT fleet_number fleet,system_name system,component,description,opened_at openedAt,closed_at closedAt,downtime_hours downtime,status,spares_status spares FROM events WHERE company_id=? AND date(opened_at)>=? AND date(opened_at)<? ORDER BY opened_at',binds),
  query(env,"SELECT machine,part_name part,quantity,status,created_at FROM role_parts_requests_v4 WHERE company_id=? AND date(created_at)<? AND lower(status) NOT IN ('received','delivered','completed','cancelled','rejected') ORDER BY created_at",[companyId,end]),
  query(env,"SELECT order_number,supplier,fleet_number,description,amount,order_date,expected_delivery,actual_delivery,order_status,payment_status FROM purchase_orders WHERE company_id=? AND order_date<? AND document_type='purchase_order' AND lower(order_status) NOT IN ('cancelled','closed') AND (actual_delivery IS NULL OR actual_delivery='') ORDER BY expected_delivery,order_date",[companyId,end]),
  query(env,'SELECT daily_production_target dailyTarget FROM contractor_report_settings WHERE company_id=?',[companyId]),
 ]);
 const last=new Date(Date.parse(end)-86400000).toISOString().slice(0,10),today=new Date(Date.now()+7200000).toISOString().slice(0,10);
 const a=analyseDashboard({machines:machines.rows,production:production.rows,events:events.rows,settings:settings.rows[0]||null},{from:start,to:last,site:'',fleet:''});
 const missing=missingReports(machines.rows,production.rows,start,end,today);
 const labels:string[]=[],byDay=new Map(a.trend.map(t=>[t.date,t]));
 for(let day=start;day<end;day=new Date(Date.parse(day)+86400000).toISOString().slice(0,10))labels.push(day);
 const reasons=new Map<string,{fleet:unknown;reason:unknown;count:number;hours:number}>();
 for(const e of events.rows){const reason=String(e.description||e.component||e.system||'Unclassified').trim(),key=String(e.fleet)+'|'+reason.toLowerCase();const item=reasons.get(key)||{fleet:e.fleet,reason,count:0,hours:0};item.count++;item.hours+=n(e.downtime);reasons.set(key,item);}
 // Daily fault records are a fallback; never count the same breakdown twice.
 if(!events.rows.length)for(const r of production.rows){if(!String(r.fault||'').trim())continue;const reason=String(r.fault).trim(),key=String(r.fleet)+'|'+reason.toLowerCase(),item=reasons.get(key)||{fleet:r.fleet,reason,count:0,hours:0};item.count++;item.hours+=n(r.unplannedDowntime);reasons.set(key,item);}
 const ranked=[...reasons.values()].sort((x,y)=>y.hours-x.hours),repeat=ranked.filter(r=>r.count>1);
 const card=(label:string,value:string)=>`<div class="metric"><small>${esc(label)}</small><b>${esc(value)}</b></div>`;
 const warnings=[!production.available?'Production data unavailable.':'',!events.available?'Breakdown data unavailable.':'',!machines.available?'Fleet register unavailable; report coverage cannot be calculated.':''].filter(Boolean);
 return `${analyticsStyle}<section class="period-summary"><div class="panel"><h2>Complete operational summary</h2><p>${esc(start)} to ${esc(last)} · ${historical?'Imported historical production and breakdowns':'Recorded company production and breakdowns'}</p>${warnings.map(w=>`<p>${esc(w)}</p>`).join('')}<div class="metrics">${card('Utilisation',a.utilisation==null?'—':fmt(a.utilisation)+'%')}${card('Repeated failure groups',String(repeat.length))}${card('Missing machine-days',machines.available&&production.available?String(missing.length):'Unavailable')}${card('Outstanding part requests',parts.available?String(parts.rows.length):'Unavailable')}${card('Open delivery POs',orders.available?String(orders.rows.length):'Unavailable')}</div><p>Parts, PO and service statuses below are current statuses for items created before the selected period end; historical status snapshots are unavailable.</p></div>
 ${chart('Availability and utilisation trend',labels,[{name:'Availability',color:'#2563eb',values:labels.map(d=>byDay.get(d)?.availability??null)},{name:'Utilisation',color:'#0f766e',values:labels.map(d=>byDay.get(d)?.utilisation??null)}],'line','%')}
 ${chart('Daily production trend',labels,[{name:'Production',color:'#2563eb',values:labels.map(d=>byDay.has(d)?byDay.get(d)!.tonnes:null)}],'bar',' t')}
 ${chart('Downtime trend',labels,[{name:'Planned',color:'#64748b',values:labels.map(d=>byDay.has(d)?byDay.get(d)!.planned:null)},{name:'Unplanned',color:'#dc2626',values:labels.map(d=>byDay.has(d)?byDay.get(d)!.unplanned:null)}],'bar',' h')}
 ${paretoChart('Downtime Pareto by cause',a.causePareto)}${paretoChart('Downtime Pareto by machine',a.machinePareto)}
 ${table('Downtime reasons',['Machine','Reason','Occurrences','Downtime h'],ranked.map(r=>[r.fleet,r.reason,r.count,fmt(r.hours)]),'Breakdowns opened in the period. Daily fault records are used only when no breakdown events exist; event hours may differ from daily totals.')}
 ${table('Repeated failures',['Machine','Repeated fault','Occurrences','Downtime h'],repeat.map(r=>[r.fleet,r.reason,r.count,fmt(r.hours)]),'Two or more records with the same machine and fault description.')}
 ${table('Missing daily reports',['Date','Machine','Site'],machines.available&&production.available?missing:[],'Coverage assumes one daily record per currently active registered machine, from its registration date. Only completed days are checked; historical rosters and shift schedules are unavailable.')}
 ${table('Outstanding / missing parts',['Machine','Part','Quantity','Status','Requested'],parts.rows.map(r=>[r.machine,r.part,r.quantity,r.status,r.created_at]),parts.available?'Current request status for requests created before the period end.':'Parts data unavailable; no zero-count conclusion can be drawn.')}
 ${table('Parts delaying breakdown repairs',['Machine','Reason','Spares status','Breakdown status'],events.rows.filter(e=>e.spares&&String(e.status).toLowerCase()!=='closed').map(e=>[e.fleet,e.description,e.spares,e.status]))}
 ${table('Purchase orders awaiting delivery',['PO','Supplier','Machine','Description','Amount R','Expected delivery','Delivery status','Payment'],orders.rows.map(r=>[r.order_number,r.supplier,r.fleet_number||'—',r.description,fmt(r.amount),r.expected_delivery||'Not set',r.expected_delivery&&String(r.expected_delivery).slice(0,10)<today?'Overdue today':r.order_status,r.payment_status]),orders.available?'Current delivery/payment statuses; overdue evaluated today, '+today+'.':'Purchase-order data unavailable.')}
 ${table('Service due / overdue',['Machine','Site','Hours remaining','Status'],a.maintenance.filter(m=>m.remaining<=50).map(m=>[m.fleet,m.site,fmt(m.remaining),m.remaining<=0?'Overdue':'Due within 50 h']),'Current hour meters and service thresholds.')}
 <div class="panel"><h2>Priority follow-up</h2><ul><li>${ranked.length?`Investigate ${esc(ranked[0].reason)} on ${esc(ranked[0].fleet)} (${fmt(ranked[0].hours)} h recorded downtime).`:'Capture breakdown reasons to identify the leading downtime cause.'}</li><li>Review ${repeat.length} repeated fault groups and verify corrective actions.</li><li>${machines.available&&production.available?`Reconcile ${missing.length} missing machine-days against the operating roster.`:'Restore source data before assessing reporting completeness.'}</li><li>Follow up outstanding parts, late deliveries and overdue services above.</li></ul></div></section>`;
}
