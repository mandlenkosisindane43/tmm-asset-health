import { desc } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { purchaseOrders } from "../../../db/schema";
import { ensureCoreSchema } from "../../../db/bootstrap";

const allowed = new Set(["application/pdf","image/png","image/jpeg","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

export async function GET(){
  await ensureCoreSchema();
  try{return Response.json({orders:await getDb().select().from(purchaseOrders).orderBy(desc(purchaseOrders.id)).limit(200)});}
  catch{return Response.json({orders:[]});}
}

export async function POST(request:Request){
  await ensureCoreSchema();
  const form=await request.formData();
  const required=["orderNumber","supplier","description","orderDate"];
  for(const field of required)if(!String(form.get(field)||"").trim())return Response.json({error:`${field} is required`},{status:400});
  const now=new Date().toISOString();
  const file=form.get("document");
  let attachmentKey:string|undefined,attachmentName:string|undefined;
  if(file instanceof File&&file.size){
    if(file.size>10_000_000)return Response.json({error:"Document must be 10 MB or smaller"},{status:400});
    if(!allowed.has(file.type))return Response.json({error:"Upload PDF, Word, Excel, PNG or JPG"},{status:400});
    attachmentName=file.name;
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"-");
    attachmentKey=`company-${Number(form.get("companyId")||1)}/orders/${crypto.randomUUID()}-${safe}`;
    await env.BUCKET.put(attachmentKey,file.stream(),{httpMetadata:{contentType:file.type}});
  }
  const [order]=await getDb().insert(purchaseOrders).values({companyId:Number(form.get("companyId")||1),orderNumber:String(form.get("orderNumber")),documentType:String(form.get("documentType")||"purchase_order"),supplier:String(form.get("supplier")),storeContact:String(form.get("storeContact")||""),fleetNumber:String(form.get("fleetNumber")||""),description:String(form.get("description")),amount:Number(form.get("amount")||0),orderDate:String(form.get("orderDate")),expectedDelivery:String(form.get("expectedDelivery")||""),paymentStatus:String(form.get("paymentStatus")||"not_paid"),orderStatus:String(form.get("orderStatus")||"quotation_requested"),attachmentKey,attachmentName,responsiblePerson:String(form.get("responsiblePerson")||""),reminderEmail:form.get("reminderEmail")==="true",reminderSms:form.get("reminderSms")==="true",nextReminderAt:String(form.get("nextReminderAt")||""),notes:String(form.get("notes")||""),createdAt:now,updatedAt:now}).returning();
  return Response.json({order},{status:201});
}
