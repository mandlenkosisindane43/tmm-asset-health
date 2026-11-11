import currentApp from "./router-reliability-workflow";

// Telemetry delivery is owned by telemetry-automation.ts. Page visits must not
// invoke the old parallel dispatcher or expose another company's delivery log.
export default {
 async fetch(req:Request,env:never,ctx:never){
  if(new URL(req.url).pathname==="/automatic-alert-email")return new Response(null,{status:303,headers:{location:"/telemetry/connections/automation","cache-control":"no-store"}});
  return currentApp.fetch(req,env,ctx);
 },
 async scheduled(controller:never,env:never,ctx:never){
  const app=currentApp as unknown as {scheduled?:(c:never,e:never,x:never)=>Promise<void>|void};
  if(app.scheduled)return app.scheduled(controller,env,ctx);
 }
};
