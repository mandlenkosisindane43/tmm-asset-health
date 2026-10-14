import { and, eq, gte, lte } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { ensureCoreSchema } from "../../../../db/bootstrap";
import { getDb } from "../../../../db";
import { companies, events, machines, productionRecords, purchaseOrders, softwareUsers } from "../../../../db/schema";
import { downtimePareto, groupProduction, summarizeProduction, type ProductionRow } from "../../../../lib/management-intelligence";
export const dynamic = "force-dynamic";
export async function GET(request:Request){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:"Sign in required"},{status:401});
  // This endpoint is owner-only until contractor account authentication and
  // contractor_account_roles_v1 are integrated. Never trust caller-supplied role.
  await ensureCoreSchema();
  const db=getDb();
  const [owner]=await db.select().from(softwareUsers).where(eq(softwareUsers.email,user.email)).limit(1);
  if(!owner||owner.status!=="active"||owner.role!=="software_owner")
    return Response.json({error:"Software owner access required"},{status:403});
  const url=new URL(request.url);
  const companyId=Number(url.searchParams.get("companyId"));
  if(!Number.isSafeInteger(companyId)||companyId<1)return Response.json({error:"Valid companyId required"},{status:400});
  const [company]=await db.select({id:companies.id,name:companies.name}).from(companies).where(eq(companies.id,companyId)).limit(1);
  if(!company)return Response.json({error:"Company not found"},{status:404});
  const start=url.searchParams.get("start")||new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const end=url.searchParams.get("end")||new Date().toISOString().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)
    return Response.json({error:"Invalid date range"},{status:400});
  const [fleet,production,breakdowns,orders]=await Promise.all([
    db.select().from(machines).where(eq(machines.companyId,companyId)).limit(2000),
    db.select().from(productionRecords).where(and(eq(productionRecords.companyId,companyId),gte(productionRecords.reportDate,start),lte(productionRecords.reportDate,end))).limit(10000),
    db.select().from(events).where(and(eq(events.companyId,companyId),gte(events.openedAt,start),lte(events.openedAt,end+"T23:59:59"))).limit(10000),
    db.select().from(purchaseOrders).where(eq(purchaseOrders.companyId,companyId)).limit(2000)
  ]);
  const rows:ProductionRow[]=production.map(r=>({
    companyId:r.companyId,reportDate:r.reportDate,fleetNumber:r.fleetNumber,shiftHours:r.shiftHours,
    plannedDowntime:r.plannedDowntime,unplannedDowntime:r.unplannedDowntime,
    operatingHours:r.operatingHours,productiveHours:r.productiveHours,tonnes:r.tonnes
  }));
  return Response.json({company,range:{start,end},fleet,
    summary:summarizeProduction(rows),
    daily:groupProduction(rows,"day"),weekly:groupProduction(rows,"week"),monthly:groupProduction(rows,"month"),
    pareto:downtimePareto(breakdowns.map(e=>({companyId:e.companyId,fleetNumber:e.fleetNumber,system:e.system,downtimeHours:e.downtimeHours,openedAt:e.openedAt}))),
    repeatedFailures:Object.entries(breakdowns.reduce<Record<string,number>>((acc,e)=>{const key=e.fleetNumber+" / "+e.system;acc[key]=(acc[key]||0)+1;return acc;},{})).filter(([,count])=>count>1).sort((a,b)=>b[1]-a[1]).map(([failure,count])=>({failure,count})),
    breakdownCount:breakdowns.length,
    orders:orders.map(o=>({orderNumber:o.orderNumber,fleetNumber:o.fleetNumber,status:o.orderStatus,expectedDelivery:o.expectedDelivery,description:o.description})),
    note:"Read-only owner reporting. Contractor role enforcement is not yet implemented."
  });
}
