import currentApp from "./router-pwa";

interface ExecutionContext { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void; }
interface ScheduledController { scheduledTime:number; cron:string; noRetry():void; }
interface Env { [key:string]: unknown; }

function patchInstallPage(body:string,path:string){
  const loginPath=path==="/install-owner-app"?"/owner-login":"/contractor-login";
  body=body.replace('<button class="btn dark" id="installBtn">','<button class="btn dark" id="installBtn" type="button" style="pointer-events:auto;position:relative;z-index:20">');
  body=body.replace(new RegExp(`<a class="btn gray" href="${loginPath.replace(/\//g,'\\/')}"`),`<a class="btn gray" href="${loginPath}" id="backLoginBtn" style="pointer-events:auto;position:relative;z-index:20"`);
  const fix=`<script>(function(){
    var installEvent=null;
    var installBtn=document.getElementById('installBtn');
    var backBtn=document.getElementById('backLoginBtn');
    var note=document.getElementById('installNote');
    window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();installEvent=e;if(installBtn){installBtn.disabled=false;installBtn.style.opacity='1';installBtn.style.cursor='pointer';}if(note)note.textContent='Ready to install on this device.';});
    if(installBtn){
      installBtn.disabled=false;
      installBtn.style.pointerEvents='auto';
      installBtn.addEventListener('click',async function(ev){
        ev.preventDefault();ev.stopPropagation();
        if(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches){if(note)note.textContent='TMM Asset Health is already installed on this device.';return;}
        if(installEvent){try{installEvent.prompt();await installEvent.userChoice;installEvent=null;}catch(_){}return;}
        if(note)note.innerHTML='If the install window does not open, use the browser menu and choose <b>Install TMM Asset Health</b> or <b>Apps → Install this site as an app</b>.';
      },true);
    }
    if(backBtn){backBtn.addEventListener('click',function(ev){ev.preventDefault();window.location.assign('${loginPath}');},true);}
  })();</script>`;
  return body.replace('</body>',fix+'</body>');
}

export default {
  async fetch(req:Request,env:Env,ctx:ExecutionContext){
    const url=new URL(req.url);
    const res=await currentApp.fetch(req,env as never,ctx as never);
    if(req.method!=="GET" || !["/install-app","/install-owner-app"].includes(url.pathname)) return res;
    const ct=res.headers.get("content-type")||"";
    if(!ct.includes("text/html")) return res;
    const body=patchInstallPage(await res.text(),url.pathname);
    const h=new Headers(res.headers);h.delete("content-length");h.set("cache-control","no-store");
    return new Response(body,{status:res.status,statusText:res.statusText,headers:h});
  },
  async scheduled(c:ScheduledController,env:Env,ctx:ExecutionContext){
    const app=currentApp as unknown as {scheduled?:(c:ScheduledController,e:Env,x:ExecutionContext)=>Promise<void>|void};
    if(app.scheduled)return app.scheduled(c,env,ctx);
  }
};
