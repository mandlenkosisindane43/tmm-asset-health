/**
 * Shared TMM reporting calculations.
 * All percentages are 0–100. Missing values remain null, never fabricated zeroes.
 */
export type ProductionRow = {
  companyId:number; reportDate:string; fleetNumber:string;
  shiftHours:number; plannedDowntime:number; unplannedDowntime:number;
  operatingHours:number; productiveHours:number; tonnes:number;
};
export type BreakdownRow = {
  companyId:number; fleetNumber:string; system:string;
  downtimeHours:number; openedAt:string;
};
export type FleetSummary = {
  scheduledHours:number; downtimeHours:number; availableHours:number;
  operatingHours:number; productiveHours:number; tonnes:number;
  availability:number|null; utilisation:number|null;
  recordCount:number; anomalies:string[];
};
const finiteNonnegative=(n:number)=>Number.isFinite(n)&&n>=0;
const round=(n:number)=>Math.round(n*100)/100;
export function summarizeProduction(rows:ProductionRow[]):FleetSummary {
  const totals={scheduledHours:0,downtimeHours:0,availableHours:0,operatingHours:0,productiveHours:0,tonnes:0};
  const anomalies:string[]=[];
  let valid=0;
  for(const r of rows){
    const nums=[r.shiftHours,r.plannedDowntime,r.unplannedDowntime,r.operatingHours,r.productiveHours,r.tonnes];
    if(!nums.every(finiteNonnegative)){anomalies.push(`Invalid numeric values: ${r.fleetNumber} / ${r.reportDate}`);continue;}
    const downtime=r.plannedDowntime+r.unplannedDowntime;
    if(downtime>r.shiftHours || r.operatingHours>r.shiftHours || r.productiveHours>r.operatingHours){
      anomalies.push(`Inconsistent hours: ${r.fleetNumber} / ${r.reportDate}`);continue;
    }
    valid++;
    totals.scheduledHours+=r.shiftHours;
    totals.downtimeHours+=downtime;
    totals.availableHours+=r.shiftHours-downtime;
    totals.operatingHours+=r.operatingHours;
    totals.productiveHours+=r.productiveHours;
    totals.tonnes+=r.tonnes;
  }
  return {...totals,availability:totals.scheduledHours>0?round(100*totals.availableHours/totals.scheduledHours):null,
    utilisation:totals.scheduledHours>0?round(100*totals.productiveHours/totals.scheduledHours):null,
    recordCount:valid,anomalies};
}
export function downtimeEstimate(hours:number,ratePerHour:number|null):number|null {
  if(!finiteNonnegative(hours)||ratePerHour===null||!finiteNonnegative(ratePerHour))return null;
  return round(hours*ratePerHour);
}
export function groupProduction(rows:ProductionRow[],period:"day"|"week"|"month"){
  const buckets=new Map<string,ProductionRow[]>();
  for(const r of rows){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.reportDate))continue;
    let key=r.reportDate;
    if(period==="month")key=key.slice(0,7);
    if(period==="week"){
      const date=new Date(key+"T00:00:00Z");
      if(Number.isNaN(date.getTime()))continue;
      const weekday=(date.getUTCDay()+6)%7;
      date.setUTCDate(date.getUTCDate()-weekday);
      key=date.toISOString().slice(0,10);
    }
    buckets.set(key,[...(buckets.get(key)||[]),r]);
  }
  return [...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([period,items])=>({period,...summarizeProduction(items)}));
}
export function downtimePareto(events:BreakdownRow[]){
  const grouped=new Map<string,number>();
  for(const e of events){
    if(!finiteNonnegative(e.downtimeHours))continue;
    const system=e.system.trim()||"Unspecified";
    grouped.set(system,(grouped.get(system)||0)+e.downtimeHours);
  }
  const total=[...grouped.values()].reduce((a,b)=>a+b,0);
  let cumulative=0;
  return [...grouped].sort((a,b)=>b[1]-a[1]).map(([system,hours])=>{
    cumulative+=hours;
    return {system,hours:round(hours),sharePercent:total?round(hours/total*100):0,
      cumulativePercent:total?round(cumulative/total*100):0};
  });
}
