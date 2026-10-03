import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const result=await build({entryPoints:['worker/account-roles.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const mod={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const {ACCOUNT_ROLES,validRoles,TWO_ROLE_MIGRATION_SQL}=mod.exports;
test('only administrator and engineer are assignable',()=>{
 assert.deepEqual([...ACCOUNT_ROLES],['company_admin','engineer']);
 assert.deepEqual(validRoles(['mechanic','supervisor','manager']),[]);
 assert.deepEqual(validRoles(['company_admin','engineer']),['company_admin','engineer']);
});
test('real SQLite migration preserves accounts, admin access and reports; repeated runs are safe',()=>{
 const python=`
import json,sys,sqlite3
sql=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.executescript('''CREATE TABLE contractor_accounts(id INTEGER,company_id INTEGER,role TEXT);
CREATE TABLE contractor_account_roles_v1(account_id INTEGER,company_id INTEGER,role TEXT,created_at TEXT,PRIMARY KEY(account_id,role));
CREATE TABLE contractor_sessions(account_id INTEGER,active_role TEXT);
CREATE TABLE reports(created_by INTEGER,tonnes INTEGER);
INSERT INTO contractor_accounts VALUES(1,4,'company_admin'),(2,4,'mechanic'),(3,4,'supervisor'),(4,4,'manager'),(5,4,'admin');
INSERT INTO contractor_account_roles_v1 VALUES(1,4,'company_admin','x'),(1,4,'mechanic','x'),(2,4,'mechanic','x'),(3,4,'supervisor','x'),(4,4,'manager','x'),(5,4,'admin','x');
INSERT INTO contractor_sessions VALUES(1,'company_admin'),(2,'mechanic'),(3,'supervisor'),(4,'manager'),(5,'admin');
INSERT INTO reports VALUES(2,450);''')
for repeat in range(2):
 for stmt in sql: db.execute(stmt)
assert db.execute('SELECT role FROM contractor_accounts ORDER BY id').fetchall()==[('company_admin',),('engineer',),('engineer',),('engineer',),('company_admin',)]
assert db.execute("SELECT count(*) FROM contractor_account_roles_v1 WHERE role NOT IN ('company_admin','engineer')").fetchone()[0]==0
assert db.execute('SELECT active_role FROM contractor_sessions ORDER BY account_id').fetchall()==[('company_admin',),('engineer',),('engineer',),('engineer',),('company_admin',)]
assert db.execute('SELECT * FROM reports').fetchall()==[(2,450)]
print('Migration passed')`;
 const p=spawnSync('python',['-c',python],{input:JSON.stringify(TWO_ROLE_MIGRATION_SQL),encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);
});
test('user invitation form offers neither removed roles nor their old default',()=>{
 const src=readFileSync('worker/company-admin-v3.ts','utf8');
 assert.ok(!/<option value="(manager|supervisor|mechanic)"/.test(src));
 const invite=readFileSync('worker/user-invitations.ts','utf8');
 assert.ok(invite.includes('const allowed = ["engineer", "company_admin"]'));
 assert.ok(!invite.includes(': "mechanic"'));
});
