type Row = Record<string, unknown>;
export const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
export function dashboardFilters(url:URL,now=new Date()) {
 const today=now.toISOString().slice(0,10), valid=(v:string|null)=>!!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 let from=valid(url.searchParams.get('from'))?url.searchParams.get('from')!:today.slice(0,7)+'-01';
 let to=valid(url.searchParams.get('to'))?url.searchParams.get('to')!:today;
 if(from>to)[from,to]=[to,from];
 return {from,to,site:url.searchParams.get('site')||'',fleet:url.searchParams.get('fleet')||''};
}
export function analyseDashboard(d:{machines:Row[];production:Row[];events:Row[];settings:Row|null},f:ReturnType<typeof dashboardFilters>){
 const machines=d.machines.filter(m=>(!f.site||m.site===f.site)&&(!f.fleet||m.fleet===f.fleet));
 const fleets=new Set(machines.map(m=>String(m.fleet)));
 const allowed=(r:Row)=>(!f.site||fleets.has(String(r.fleet)))&&(!f.fleet||r.fleet===f.fleet);
 const within=(date:unknown)=>String(date||'').slice(0,10)>=f.from&&String(date||'').slice(0,10)<=f.to;
 const production=d.production.filter(r=>allowed(r)&&within(r.reportDate));
 const events=d.events.filter(r=>allowed(r)&&within(r.openedAt));
 const grouped=new Map<string,Row[]>();for(const r of production){const key=String(r.reportDate);grouped.set(key,[...(grouped.get(key)||[]),r]);}
 const totals=(rows:Row[])=>{const sum=(key:string)=>rows.reduce((a,r)=>a+n(r[key]),0),scheduled=sum('shiftHours'),planned=sum('plannedDowntime'),unplanned=sum('unplannedDowntime'),available=Math.max(0,scheduled-planned-unplanned),operating=sum('operatingHours');return {availability:scheduled?available/scheduled*100:null,utilisation:available?operating/available*100:null,tonnes:sum('tonnes'),planned,unplanned,scheduled,available,operating};};
 const trend=[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([date,rows])=>({date,...totals(rows)}));
 const recurring=new Map<string,number>();for(const e of events){const key=String(e.fleet)+' · '+String(e.system||'Unspecified');recurring.set(key,(recurring.get(key)||0)+1);}
 const repeat=[...recurring].filter(([,count])=>count>1).sort((a,b)=>b[1]-a[1]);
 const maintenance=machines.filter(m=>m.nextService!=null).map(m=>({...m,remaining:n(m.nextService)-n(m.hours)})).sort((a,b)=>a.remaining-b.remaining);
 const target=n(d.settings?.dailyTarget);
 return {machines,production,events,trend,repeat,maintenance,target,...totals(production),causePareto:paretoRows(events,'system'),machinePareto:paretoRows(events,'fleet')};
}
export function paretoRows(events:Row[],key:string){
 const values=new Map<string,number>();for(const e of events){const value=Math.max(0,n(e.downtime));if(value)values.set(String(e[key]||'Unspecified'),(values.get(String(e[key]||'Unspecified'))||0)+value);}
 const ordered=[...values].sort((a,b)=>b[1]-a[1]),total=ordered.reduce((a,[,v])=>a+v,0);let running=0;
 return ordered.map(([label,hours])=>({label,hours,cumulative:(running+=hours)/total*100}));
}
export function chart(title:string,labels:string[],series:{name:string;color:string;values:(number|null)[]}[],kind:'line'|'bar'='line',unit=''){
 if(!labels.length||!series.some(s=>s.values.some(v=>v!==null)))return `<section class="panel chart"><h2>${escapeHtml(title)}</h2><p class="empty">No data for this period.</p></section>`;
 const w=Math.max(640,labels.length*32),h=250,left=52,right=20,top=22,bottom=58,plotH=h-top-bottom,plotW=w-left-right,max=Math.max(1,...series.flatMap(s=>s.values.filter(v=>v!==null) as number[])),scale=unit==='%'?Math.max(100,max):max*1.12;
 const x=(i:number)=>left+(i+.5)*plotW/labels.length,y=(v:number)=>top+plotH-v/scale*plotH;
 const ticks=[0,.25,.5,.75,1].map(t=>`<line x1="${left}" x2="${w-right}" y1="${y(scale*t)}" y2="${y(scale*t)}" stroke="#e5eaf0"/><text x="${left-7}" y="${y(scale*t)+4}" text-anchor="end">${(scale*t).toFixed(0)}${unit}</text>`).join('');
 const marks=series.map((s,j)=>kind==='bar'?s.values.map((v,i)=>v===null?'':`<rect x="${x(i)-plotW/labels.length*.35+j*plotW/labels.length*.7/series.length}" y="${y(v)}" width="${plotW/labels.length*.7/series.length}" height="${v/scale*plotH}" fill="${s.color}"><title>${escapeHtml(labels[i])}: ${escapeHtml(s.name)} ${v.toFixed(1)}${unit}</title></rect>`).join(''):`<polyline points="${s.values.map((v,i)=>v===null?'':`${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.5"/>${s.values.map((v,i)=>v===null?'':`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"><title>${escapeHtml(labels[i])}: ${escapeHtml(s.name)} ${v.toFixed(1)}${unit}</title></circle>`).join('')}`).join('');
 const axis=labels.map((l,i)=>`<text x="${x(i)}" y="${h-bottom+20}" text-anchor="middle">${escapeHtml(l)}</text>`).join('');
 return `<section class="panel chart"><h2>${escapeHtml(title)}</h2><p>${series.map(s=>`<span style="color:${s.color}">● ${escapeHtml(s.name)}</span>`).join(' · ')}</p><div class="chart-scroll"><svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${w} ${h}" style="min-width:${w}px">${ticks}${marks}${axis}</svg></div><details><summary>View chart data</summary><div class="chart-scroll"><table><thead><tr><th>Date</th>${series.map(s=>`<th>${escapeHtml(s.name)}</th>`).join('')}</tr></thead><tbody>${labels.map((l,i)=>`<tr><td>${escapeHtml(l)}</td>${series.map(s=>`<td>${s.values[i]==null?'—':s.values[i]!.toFixed(1)+unit}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></section>`;
}
export function paretoChart(title:string,rows:ReturnType<typeof paretoRows>){
 if(!rows.length)return `<section class="panel chart"><h2>${escapeHtml(title)}</h2><p class="empty">No recorded downtime for this period.</p></section>`;
 const w=Math.max(640,rows.length*100),h=320,left=50,right=50,top=25,bottom=105,ph=h-top-bottom,pw=w-left-right,max=rows[0].hours*1.15,x=(i:number)=>left+(i+.5)*pw/rows.length,y=(v:number)=>top+ph-v/max*ph;
 return `<section class="panel chart"><h2>${escapeHtml(title)}</h2><p>Blue bars: downtime hours · Orange line: cumulative percentage</p><div class="chart-scroll"><svg role="img" aria-label="${escapeHtml(title)}" viewBox="0 0 ${w} ${h}" style="min-width:${w}px"><text x="5" y="15">Hours</text><text x="${w-45}" y="15">%</text>${[0,.25,.5,.75,1].map(t=>`<line x1="${left}" x2="${w-right}" y1="${top+ph*(1-t)}" y2="${top+ph*(1-t)}" stroke="#e5eaf0"/><text x="${left-7}" y="${top+ph*(1-t)+4}" text-anchor="end">${(max*t).toFixed(1)}</text><text x="${w-right+8}" y="${top+ph*(1-t)+4}">${t*100}</text>`).join('')}<line x1="${left}" x2="${w-right}" y1="${top+ph*.2}" y2="${top+ph*.2}" stroke="#d97706" stroke-dasharray="5 5"/>${rows.map((r,i)=>`<rect x="${x(i)-pw/rows.length*.3}" y="${y(r.hours)}" width="${pw/rows.length*.6}" height="${r.hours/max*ph}" fill="#294467"><title>${escapeHtml(r.label)}: ${r.hours.toFixed(1)} h; cumulative ${r.cumulative.toFixed(1)}%</title></rect><text transform="translate(${x(i)},${h-bottom+16}) rotate(35)" text-anchor="start">${escapeHtml(r.label)}</text>`).join('')}<polyline fill="none" stroke="#d97706" stroke-width="3" points="${rows.map((r,i)=>`${x(i)},${top+ph*(1-r.cumulative/100)}`).join(' ')}"/>${rows.map((r,i)=>`<circle cx="${x(i)}" cy="${top+ph*(1-r.cumulative/100)}" r="3" fill="#d97706"/>`).join('')}</svg></div><details><summary>View Pareto data</summary><table><thead><tr><th>Category</th><th>Hours</th><th>Cumulative %</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.label)}</td><td>${r.hours.toFixed(1)}</td><td>${r.cumulative.toFixed(1)}%</td></tr>`).join('')}</tbody></table></details></section>`;
}
export const analyticsStyle=`<style>.chart{min-width:0}.chart-scroll{overflow-x:auto}.chart svg{width:100%;height:auto;font:11px Arial;display:block}.chart table,.recommendations table{width:100%;border-collapse:collapse;font-size:12px}.chart th,.chart td,.recommendations th,.recommendations td{padding:8px;text-align:left;border-bottom:1px solid #e5eaf0}.dashboard-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin-bottom:16px}.dashboard-filters label{display:grid;gap:5px;font-size:12px}.dashboard-filters input,.dashboard-filters select,.recommendations input,.recommendations textarea,.recommendations select{padding:9px;border:1px solid #ccd6e2;border-radius:6px;max-width:100%}.recommendations textarea{display:block;width:100%;min-height:80px}.recommendations article{border-top:1px solid #e5eaf0;padding:15px 0}.recommendations p{white-space:pre-wrap;font-size:13px}.recommendations form{display:grid;gap:10px}.chart details{font-size:12px;margin-top:8px}.role-links{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:15px}@media print{.side,.top,.dashboard-filters,.recommendations form,.actions,.role-links{display:none!important}.app{display:block!important}.chart-scroll{overflow:visible}.chart svg{min-width:0!important}.panel{break-inside:avoid}.content{width:100%!important;min-width:0!important}}</style>`;
