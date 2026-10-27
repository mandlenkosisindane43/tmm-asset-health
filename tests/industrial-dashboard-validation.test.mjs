import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("production-compatible application bundle is emitted", async () => {
  const bundle = new URL("../dist/server/index.js", import.meta.url);
  const info = await stat(bundle);
  assert.ok(info.size > 0, "Cloudflare server bundle should not be empty");
});

test("authenticated company navigation includes Industrial Dashboard", async () => {
  const router = await readFile(new URL("../worker/router-company-admin-demo-ui-v2.ts", import.meta.url), "utf8");
  assert.match(router, /\["industrial","▣","Industrial Dashboard"\]/);
  assert.match(router, /if\(view==="industrial"&&req\.method==="GET"\)/);
  assert.match(router, /await data\(env,s\)/);
  assert.match(router, /return html\(shell\("industrial","Industrial Dashboard",s,frame\)\)/);
});

test("Engineer navigation permits the Industrial Dashboard", async () => {
  const access = await readFile(new URL("../worker/company-navigation-access.ts", import.meta.url), "utf8");
  assert.match(access, /new Set\(\['industrial', 'dashboard'/);
});

test("preview remains explicitly marked as demonstration data", async () => {
  const entry = await readFile(new URL("../worker/entry-with-pwa.ts", import.meta.url), "utf8");
  assert.match(entry, /industrial-preview/);
  assert.match(entry, /demonstration|synthetic|demo/i);
});
