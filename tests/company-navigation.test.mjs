import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const compile = async (entry) => {
  const result = await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'legacy-fallback',setup(b){b.onResolve({filter:/^\.\/router-company-admin-demo-ui$/},()=>({path:'legacy',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default {fetch:async()=>new Response("Unexpected legacy fallback",{status:500})}'}));}}]});
  const mod={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);
  return mod.exports;
};
const { handleCompanyAdminV3 } = await compile('worker/company-admin-v3.ts');
const { filterCompanyForms, canChangeCompanyPage } = await compile('worker/company-navigation-access.ts');
function environment(role) {
  return {DB:{async batch(){return []},prepare(sql){return {bind(){return this},async run(){return {success:true}},async all(){return {results:[]}},async first(){
    if(sql.includes('FROM contractor_sessions')) return {companyId:3,accountId:8,email:'staff@example.com',fullName:'Staff',role,accountStatus:'active',sessionExpires:'2099-01-01',companyName:'Test Mine',licenceStatus:'active',licenceExpires:'2099-01-01',graceDays:0};
    return null;
  }}}}};
}
for(const role of ['manager','engineer','supervisor','mechanic']) {
  for(const [view,title] of [['fleet','Fleet'],['daily','Daily Reports'],['alerts','Alerts'],['documents','Documents'],['reports-admin','Reports']]) {
    test(`${role} opens ${view} instead of the role dashboard`,async()=>{
      const response=await handleCompanyAdminV3(new Request(`https://example.com/contractor?view=${view}`,{headers:{cookie:'sas_contractor_v2=test'}}),environment(role));
      assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(`<title>${title} ·`));
      assert.ok(!html.includes('action="/company-admin/fleet/delete-all"'));
    });
  }
  test(`${role} cannot access user management or delete fleet`,async()=>{
    const env=environment(role),headers={cookie:'sas_contractor_v2=test'};
    assert.equal((await handleCompanyAdminV3(new Request('https://example.com/contractor?view=users',{headers}),env)).status,403);
    assert.equal((await handleCompanyAdminV3(new Request('https://example.com/company-admin/fleet/delete-all',{method:'POST',headers,body:new URLSearchParams({confirmation:'DELETE ALL'})}),env)).status,403);
  });
}
test('capture controls follow server permissions',()=>{
  const form='<form method="post" action="/company-admin/daily/manual"><button>Save daily</button></form>';
  assert.ok(filterCompanyForms(form,'engineer').includes('Save daily'));
  assert.equal(filterCompanyForms(form,'manager'),'');
  assert.equal(canChangeCompanyPage('mechanic','/company-admin/users/roles'),false);
});

const { default: navigation } = await compile('worker/router-company-admin-safe.ts');
for(const role of ['manager','engineer','supervisor','mechanic']) {
  for(const view of ['dashboard','breakdowns','maintenance','production','reports-live']) {
    test(`${role} navigates to live ${view}`,async()=>{
      const response=await navigation.fetch(new Request(`https://example.com/contractor?view=${view}`,{headers:{cookie:'sas_contractor_v2=test'}}),environment(role),{});
      assert.equal(response.status,200);const html=await response.text();
      assert.ok(!html.includes('data-nav="users"'));
      assert.ok(html.includes(`data-nav="${view}" class="active"`));
      assert.ok(html.includes('data-nav="previous" href="/contractor?view=previous"'));
    });
  }
}
test('previous month opens actual company report for September 2026',async()=>{
  const response=await navigation.fetch(new Request('https://example.com/contractor?view=previous',{headers:{cookie:'sas_contractor_v2=test'}}),environment('engineer'),{});
  assert.equal(response.status,303);
  const now=new Date(),expected=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
  assert.equal(response.headers.get('location'),`/contractor-reports?type=monthly&month=${expected}`);
});
