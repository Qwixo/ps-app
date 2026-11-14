// Run: node --experimental-strip-types tests/mailfunctions.test.ts
// Review fix: the four mail functions may only call database functions and tables that migrations 001 to 037 create
// (instantly-inbox and instantly-replies used calendar_get_config, which core never had, so their cron polls were
// refused on a clean project). Also: the cron jobs and functions never carry a project address of anyone's.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../supabase/", import.meta.url);
const sql = readdirSync(new URL("migrations/", root)).sort().map((f) => readFileSync(new URL(`migrations/${f}`, root), "utf8")).join("\n");
const fns = ["gmail-inbox", "instantly-inbox", "instantly-replies", "instantly-webhook"];
const src = (f: string) => readFileSync(new URL(`functions/${f}/index.ts`, root), "utf8");
const defined = (name: string) => new RegExp(`create (or replace )?function public\\.${name}\\b`, "i").test(sql);
const tabled = (name: string) => new RegExp(`create table (if not exists )?public\\.${name}\\b`, "i").test(sql);

let n = 0;
const ok = (name: string, f: () => void) => { f(); n++; console.log("ok - " + name); };

ok("every rpc a mail function calls is created by a migration", () => {
  for (const f of fns) for (const m of src(f).matchAll(/\.rpc\("([a-z_]+)"/g)) assert.ok(defined(m[1]), `${f} calls ${m[1]}`);
});
ok("every table a mail function reads or writes is created by a migration", () => {
  for (const f of fns) for (const m of src(f).matchAll(/\.from\("([a-z_]+)"\)/g)) assert.ok(tabled(m[1]), `${f} uses ${m[1]}`);
});
ok("instantly_get_config hands the functions the cron secret and the key (the cron jobs send gmail_cron_secret)", () => {
  assert.match(sql, /'cron_secret', \(select decrypted_secret from vault\.decrypted_secrets where name = 'gmail_cron_secret'\)/);
  assert.match(src("instantly-replies"), /cron: i\?\.cron_secret/);
  assert.match(src("instantly-inbox"), /instantly_get_config"\)\)\.data\?\.cron_secret/);
  assert.match(src("instantly-inbox"), /instantly_get_config"\)\)\.data\?\.api_key/);
});
ok("no project address or ref of anyone's in a function or a migration", () => {
  for (const t of [sql, ...fns.map(src)]) assert.ok(!/[a-z0-9]{20}\.supabase\.co/.test(t));
});
console.log(`mail function tests: ${n} passed`);
