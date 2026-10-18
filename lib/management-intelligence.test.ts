import { summarizeProduction, groupProduction, downtimePareto, downtimeEstimate, type ProductionRow, type BreakdownRow } from "./management-intelligence";
import test from "node:test";
import assert from "node:assert/strict";
const row:ProductionRow={companyId:1,reportDate:"2026-10-14",fleetNumber:"ADT-01",shiftHours:24,plannedDowntime:2,unplannedDowntime:4,operatingHours:16,productiveHours:12,tonnes:100};
test("KPI calculations use scheduled hours",()=>{
 const s=summarizeProduction([row]);
 assert.equal(s.availability,75);
 assert.equal(s.utilisation,50);
 assert.equal(s.downtimeHours,6);
});
test("missing records produce null KPIs",()=>{
 const s=summarizeProduction([]);
 assert.equal(s.availability,null);
 assert.equal(s.utilisation,null);
});
test("inconsistent hour totals are flagged and excluded",()=>{
 const s=summarizeProduction([{...row,unplannedDowntime:30}]);
 assert.equal(s.recordCount,0);
 assert.equal(s.anomalies.length,1);
});
test("period aggregation groups monthly and ISO Monday weeks",()=>{
 assert.equal(groupProduction([row],"month")[0].period,"2026-10");
 assert.equal(groupProduction([row],"week")[0].period,"2026-10-12");
});
test("downtime estimate requires a configured rate",()=>{
 assert.equal(downtimeEstimate(12,4500),54000);
 assert.equal(downtimeEstimate(12,null),null);
});
test("Pareto ranks failure systems by downtime",()=>{
 const events:BreakdownRow[]=[
  {companyId:1,fleetNumber:"A",system:"Hydraulic",downtimeHours:8,openedAt:"2026-10-14"},
  {companyId:1,fleetNumber:"B",system:"Engine",downtimeHours:2,openedAt:"2026-10-14"}
 ];
 const p=downtimePareto(events);
 assert.equal(p[0].system,"Hydraulic");
 assert.equal(p[0].cumulativePercent,80);
});
