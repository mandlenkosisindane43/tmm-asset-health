type Row=Record<string,unknown>;
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
export function reliability(production:Row[],events:Row[],from:string,to:string){
 const inside=(date:unknown)=>String(date||'').slice(0,10)>=from&&String(date||'').slice(0,10)<=to;
 const faults=events.filter(e=>['breakdown','failure'].includes(String(e.eventType||'breakdown').toLowerCase()));
 const failures=faults.filter(e=>inside(e.openedAt));
 const repairs=faults.filter(e=>String(e.status).toLowerCase()==='closed'&&inside(e.closedAt));
 const operating=production.filter(r=>inside(r.reportDate)).reduce((sum,r)=>sum+Math.max(0,n(r.operatingHours)),0);
 const repairHours=repairs.reduce((sum,r)=>sum+Math.max(0,n(r.downtime)),0);
 return {operating,failures:failures.length,repairs:repairs.length,mtbf:failures.length&&operating>0?operating/failures.length:null,mttr:repairs.length?repairHours/repairs.length:null};
}
export function reliabilityTrend(production:Row[],events:Row[],from:string,to:string){
 const buckets=new Set([...production.map(r=>String(r.reportDate)),...events.flatMap(e=>[String(e.openedAt||'').slice(0,10),String(e.closedAt||'').slice(0,10)])].filter(d=>d>=from&&d<=to));
 const months=[...new Set([...buckets].map(d=>d.slice(0,7)))].sort();
 return months.map(month=>{const start=month+'-01',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);return {month,...reliability(production,events,start>from?start:from,end<to?end:to)};});
}
export function qualityIssues(production:Row[],daily:Row[]){
 const issues:{fleet:string;date:string;issue:string;record:string}[]=[];
 const add=(r:Row,issue:string,source:string)=>issues.push({fleet:String(r.fleet||''),date:String(r.reportDate||''),issue,record:source+' '+String(r.id||'')});
 const aggregate=new Map<string,number>();
 for(const r of production){
  const key=String(r.fleet)+'|'+String(r.reportDate);aggregate.set(key,(aggregate.get(key)||0)+1);
  const shift=n(r.shiftHours),op=n(r.operatingHours),down=n(r.plannedDowntime)+n(r.unplannedDowntime);
  if([r.shiftHours,r.operatingHours,r.plannedDowntime,r.unplannedDowntime,r.tonnes].some(v=>v!=null&&(!Number.isFinite(Number(v))||Number(v)<0)))add(r,'Negative or invalid numeric value','Production');
  if(op+down>shift+.01)add(r,'Operating hours plus downtime exceed scheduled hours','Production');
  if(n(r.productiveHours)>op+.01)add(r,'Productive hours exceed operating hours','Production');
 }
 for(const [key,count] of aggregate)if(count>1){const [fleet,date]=key.split('|');issues.push({fleet,date,issue:'Multiple production totals for this machine and date. Review for duplication.',record:count+' totals'});}
 const fingerprints=new Map<string,Row>();const previous=new Map<string,number>();
 for(const r of [...daily].sort((a,b)=>String(a.reportDate).localeCompare(String(b.reportDate))||n(a.id)-n(b.id))){
  const fingerprint=JSON.stringify([r.fleet,r.reportDate,r.activity,r.captureBasis,r.hourMeterStart,r.hourMeterEnd,r.duration,r.tonnes,r.faultReason,r.breakdownStart,r.breakdownEnd]);
  if(fingerprints.has(fingerprint))add(r,'Possible duplicate capture. Confirm before correcting.','Daily report');else fingerprints.set(fingerprint,r);
  if(r.hourMeterStart!=null&&r.hourMeterEnd!=null){const start=n(r.hourMeterStart),end=n(r.hourMeterEnd),last=previous.get(String(r.fleet));if(end<start)add(r,'Hour meter end is below its start','Daily report');if(last!=null&&start<last)add(r,'Hour meter decreased from the previous capture. Check readings or meter replacement.','Daily report');previous.set(String(r.fleet),end);}
 }
 return issues;
}
export function overdueRecommendation(r:Row,today:string){return !!r.due_date&&String(r.due_date)<today&&r.status!=='completed';}
export function demoDataset(){
 const machines=[{id:1,fleet:'DEMO-01',category:'Excavator',site:'Demo Site',status:'operating',hours:247,nextService:250},{id:2,fleet:'DEMO-02',category:'Truck',site:'Demo Site',status:'attention',hours:520,nextService:500}];
 const production=Array.from({length:14},(_,i)=>machines.map((m,j)=>({id:i*2+j+1,reportDate:`2026-10-${String(i+1).padStart(2,'0')}`,fleet:m.fleet,shiftHours:12,plannedDowntime:1,unplannedDowntime:i%4===j?2:0,operatingHours:8,productiveHours:7,tonnes:150+i*8+j*30}))).flat();
 const events=[{id:1,fleet:'DEMO-01',eventType:'breakdown',system:'Hydraulics',description:'Illustrative hydraulic fault',openedAt:'2026-10-03',closedAt:'2026-10-04',downtime:6,status:'closed'},{id:2,fleet:'DEMO-01',eventType:'breakdown',system:'Hydraulics',description:'Illustrative repeat fault',openedAt:'2026-10-08',closedAt:'2026-10-09',downtime:4,status:'closed'},{id:3,fleet:'DEMO-02',eventType:'breakdown',system:'Tyres',description:'Illustrative tyre damage',openedAt:'2026-10-10',closedAt:null,downtime:2,status:'open'}];
 return {machines,production,events,settings:{dailyTarget:450,availabilityTarget:90},users:[]};
}
