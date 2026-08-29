export function ownerContractorsPage(): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create Contractor</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#14213d;padding:28px}.card{max-width:760px;margin:auto;background:#fff;border:1px solid #dce5ef;border-radius:16px;padding:25px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:grid;gap:6px;font-size:12px;font-weight:800}.field input,.field select{padding:12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px}.wide{grid-column:1/-1}.btn{border:0;background:#1267b3;color:#fff;padding:13px 18px;border-radius:9px;font-weight:900;margin-top:18px;cursor:pointer}.btn:disabled{opacity:.6;cursor:wait}.msg{white-space:pre-wrap;margin-top:18px;padding:12px;background:#f8fafc;border-radius:8px;font-size:12px;line-height:1.5}.msg.ok{background:#e8f7ee;color:#17633a}.msg.err{background:#fff0f0;color:#a11b1b}.hint{font-size:11px;color:#64748b;margin-top:5px}@media(max-width:650px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}}
  </style></head><body><div class="card"><h1>Create real contractor account</h1><p>This creates an isolated company licence and contractor administrator.</p><form id="f" class="grid">
  <label class="field wide">Sindane owner password<input name="ownerPassword" type="password" required autocomplete="current-password"><span class="hint">Use the same ADMIN_PASSWORD configured in Cloudflare.</span></label>
  <label class="field wide">Company name<input name="companyName" required></label>
  <label class="field">Administrator full name<input name="fullName" required></label>
  <label class="field">Administrator email<input name="email" type="email" required></label>
  <label class="field">Contractor password<input name="password" type="password" minlength="10" required><span class="hint">Minimum 10 characters.</span></label>
  <label class="field">Licence days<input name="licenceDays" type="number" min="1" value="30" required></label>
  <label class="field">Role<select name="role"><option value="company_admin">Company Admin</option><option value="engineer">Engineer</option><option value="manager">Manager</option></select></label>
  <div class="wide"><button id="submitBtn" class="btn" type="submit">Create contractor</button><div id="msg" class="msg">Ready. Fill in every field, then click Create contractor.</div></div>
  </form></div><script>
  var form=document.getElementById('f'),msg=document.getElementById('msg'),btn=document.getElementById('submitBtn');
  function show(text,kind){msg.textContent=text;msg.className='msg'+(kind?' '+kind:'');}
  form.addEventListener('submit',async function(e){
    e.preventDefault();
    if(!form.reportValidity()){show('Please correct the highlighted field(s). The contractor password must be at least 10 characters and the email must be valid.','err');return;}
    var f=new FormData(form);var pwd=String(f.get('password')||'');
    if(pwd.length<10){show('Contractor password must contain at least 10 characters.','err');return;}
    btn.disabled=true;btn.textContent='Creating...';show('Creating contractor account and licence...');
    try{
      var payload={companyName:f.get('companyName'),fullName:f.get('fullName'),email:f.get('email'),password:pwd,licenceDays:Number(f.get('licenceDays')),role:f.get('role')};
      var r=await fetch('/api/admin/contractors',{method:'POST',headers:{'content-type':'application/json','x-admin-password':String(f.get('ownerPassword')||'')},body:JSON.stringify(payload)});
      var raw=await r.text();var j={};try{j=raw?JSON.parse(raw):{}}catch(_){j={error:raw||'The server returned an unreadable response.'}}
      if(!r.ok){show((j.error||'Creation failed.')+'\nHTTP status: '+r.status,'err');return;}
      show('CREATED SUCCESSFULLY\nCompany: '+j.companyName+'\nLogin email: '+j.email+'\nLicence: '+j.licenceKey+'\nExpires: '+j.expiresAt,'ok');
    }catch(error){show('Network/API error: '+(error&&error.message?error.message:String(error)),'err');}
    finally{btn.disabled=false;btn.textContent='Create contractor';}
  });
  </script></body></html>`;
  return new Response(body,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"}});
}
