// Run: node --experimental-strip-types tests/ps-core.test.ts
// The personal project manifest (supabase/ps-core.json, 5 Nov 2026): what PS's "Connect your own Supabase"
// setup puts on a project someone links themselves. Every table and database function the app calls must
// exist after these migrations alone; the developer's own feeds must never be part of it; and every migration and
// function in the repo must be sorted into one side, so a new one cannot be forgotten.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { kit, readManifest } from "../scripts/ps-kit.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const m = readManifest() as { migrations: string[]; functions: { slug: string; files: string[]; verify_jwt: boolean; secrets: string[] }[];
  redOnly: { migrations: string[]; functions: string[]; calls: string[] } };
const sqlOf = (files: string[]) => files.map((f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8")).join("\n");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const core = strip(sqlOf(m.migrations));
const redSql = strip(sqlOf(m.redOnly.migrations));

const tablesIn = (sql: string) => new Set([...sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/gi)].map((x) => x[1]));
const fnsIn = (sql: string) => new Set([...sql.matchAll(/create (?:or replace )?function public\.([a-z_]+)/gi)].map((x) => x[1]));
const coreTables = tablesIn(core), coreFns = fnsIn(core);

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "dev") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
// G Squad (src/squad/, V1.40) talks to the squad hub, its own project, never to the person's own project: it is
// checked below on its own and left out of the kit checks.
const SQUAD_DIR = join(ROOT, "src", "squad");
const src = walk(join(ROOT, "src")).filter((f) => !f.startsWith(SQUAD_DIR)).map((f) => [f, readFileSync(f, "utf8")] as const);
const calls = (re: RegExp) => new Set(src.flatMap(([, s]) => [...s.matchAll(re)].map((x) => x[1])));

ok("every migration in the repo is either core or the developer only, never both", () => {
  const all = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const both = m.migrations.filter((f) => m.redOnly.migrations.includes(f));
  assert.deepEqual(both, []);
  assert.deepEqual([...m.migrations, ...m.redOnly.migrations].sort(), all, "a migration is missing from supabase/ps-core.json");
  assert.deepEqual(m.migrations, [...m.migrations].sort(), "core migrations run in file order");
});

ok("every edge function in the repo is either core or the developer only", () => {
  const all = readdirSync(join(ROOT, "supabase/functions")).filter((f) => statSync(join(ROOT, "supabase/functions", f)).isDirectory()).sort();
  assert.deepEqual([...m.functions.map((f) => f.slug), ...m.redOnly.functions].sort(), all);
  assert.deepEqual(m.functions.map((f) => f.slug), ["vault-auth"], "the only function a personal project needs is vault-auth");
});

ok("The developer's own feeds never reach a personal project", () => {
  for (const bad of ["gmail", "instantly", "telegram", "followup", "drop_keys", "cron.", "net.http", "calendar_"]) {
    assert.ok(!core.toLowerCase().includes(bad), `a core migration mentions ${bad}`);
  }
  for (const f of ["008_gmail_inbox.sql", "014_instantly_inbox.sql", "017_telegram_inbox.sql", "018_followup_feed.sql", "024_pg_net_to_extensions.sql"]) {
    assert.ok(!m.migrations.includes(f), f);
  }
});

ok("every table the app reads or writes exists after the core migrations", () => {
  const used = calls(/\.from\("([a-z_]+)"\)/g);
  assert.ok(used.size >= 8);
  for (const t of used) assert.ok(coreTables.has(t), `the app uses table ${t}, which no core migration creates`);
});

ok("every database function the app calls exists after the core migrations (or is a the developer only feed's)", () => {
  const used = calls(/\.rpc\("([a-z_]+)"/g);
  for (const f of used) {
    if (m.redOnly.calls.includes(f)) { assert.ok(fnsIn(redSql).has(f), `${f} is listed the developer only but no the developer only migration makes it`); continue; }
    assert.ok(coreFns.has(f), `the app calls ${f}(), which no core migration creates`);
  }
  // and the ones vault-auth calls as service role
  const fn = readFileSync(join(ROOT, "supabase/functions/vault-auth/index.ts"), "utf8");
  for (const [, f] of fn.matchAll(/admin\.rpc\("([a-z_]+)"/g)) assert.ok(coreFns.has(f), `vault-auth calls ${f}()`);
  for (const [, t] of fn.matchAll(/admin\.from\("([a-z_]+)"\)/g)) assert.ok(coreTables.has(t), `vault-auth uses table ${t}`);
});

ok("every edge function the app calls is core or a the developer only feed's", () => {
  const used = new Set([...calls(/functions\.invoke\("([a-z-]+)"/g), ...calls(/\/functions\/v1\/([a-z-]+)/g)]);
  for (const f of used) assert.ok(m.functions.some((x) => x.slug === f) || m.redOnly.calls.includes(f), `the app calls the function ${f}`);
});

ok("G Squad calls only the hub's own function, on the hub, never the person's own project", () => {
  const hub = readFileSync(join(SQUAD_DIR, "hub.ts"), "utf8");
  assert.match(hub, /HUB_URL = "https:\/\/zxhvchchfrkfqxuyorqo\.supabase\.co"/);
  assert.match(hub, /HUB_FN = `\$\{HUB_URL\}\/functions\/v1\/squad`/);
  for (const f of walk(SQUAD_DIR)) {
    const s = readFileSync(f, "utf8");
    assert.ok(!/createClient|\.from\(|\.rpc\(/.test(s), `${f} never uses a Supabase client`);
    assert.ok(!/mxusokxekkecebwqgeru|YOUR_OTHER_PROJECT_REF/.test(s), `${f} never names the developer's projects`);
  }
});

ok("the private Realtime topics the app joins are allowed by core policies", () => {
  assert.match(core, /realtime\.topic\(\) = 'ps-presence'/);
  assert.match(core, /'inbox:' \|\|/);
  assert.match(core, /'second:' \|\|/);
});

ok("vault-auth needs no secrets of ours and lets PS on the Mac call it", () => {
  const f = m.functions[0];
  assert.deepEqual(f.secrets, []);
  assert.equal(f.verify_jwt, false, "the page calls vault-auth with the public key only, before anyone is signed in");
  const fn = readFileSync(join(ROOT, "supabase/functions/vault-auth/index.ts"), "utf8");
  assert.match(fn, /"ps:\/\/app"/);
  const env = [...fn.matchAll(/Deno\.env\.get\("([A-Z_]+)"\)/g)].map((x) => x[1]).sort();
  assert.deepEqual(env, ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"], "only the two values Supabase gives every function by itself");
});

ok("the kit lists every file with its hash, versions unique and in order", () => {
  const k = kit() as { kit: string; migrations: { version: string; sha256: string }[]; functions: { files: unknown[] }[] };
  assert.match(k.kit, /^[0-9a-f]{16}$/);
  const v = k.migrations.map((x) => x.version);
  assert.deepEqual(v, [...new Set(v)].sort());
  assert.equal(k.migrations.length, m.migrations.length);
  assert.ok(k.migrations.every((x) => /^[0-9a-f]{64}$/.test(x.sha256)));
  assert.equal(k.functions[0].files.length, 1);
});

ok("the first account of an empty project needs the one time setup code", () => {
  assert.match(core, /create table public\.setup_codes/);
  assert.match(core, /create trigger user_keys_consume_setup/);
  assert.match(core, /create trigger vault_signup_gate before insert on auth\.users/);
});

console.log(`ps-core: ${n} passed`);
