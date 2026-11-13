// Run: node --experimental-strip-types tests/own-project.test.ts
// "Connect your own Supabase" (5 Nov 2026): PS on the Mac may use a Supabase project of the person's own.
// Checks the project the page picks (only PS takes the shell's choice, every field checked), that the developer's
// personal features can never switch on for the first owner of any other project (fails closed), and
// that the website and the phone stay locked to the developer's project.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RED_ONLY, accountKind, canUse, isRedAccount } from "../src/core/account.ts";
import { RED_PROJECT_URL, activeProject, chooseProject, cleanInjected, isRedProjectUrl, localDbName, onRedProject, setActiveProject, validProjectUrl } from "../src/core/project.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const FRIEND = "https://abcdefghijklmnopqrst.supabase.co";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ";
const PUB = "sb_publishable_AbCdEf0123456789xyz";
const RED_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyZWYiOiJyZWQifQ.cmVkLXNpZ25hdHVyZS14eA";
const redOwner = { status: "unlocked" as const, role: "owner" as const, red: true };

ok("nothing is the developer until the page knows it talks to the developer's project (fails closed)", () => {
  assert.equal(activeProject(), null);
  assert.equal(onRedProject(), false);
  assert.equal(accountKind(redOwner), "owner");
  assert.equal(isRedAccount(redOwner), false);
  for (const f of RED_ONLY) assert.equal(canUse(redOwner, f), false, f);
});

ok("the website and the phone always use the build's own project, whatever is injected", () => {
  for (const mode of ["production", "gos", "development"]) {
    const p = chooseProject(mode, { url: FRIEND, key: JWT, setupCode: "A".repeat(24) }, RED_PROJECT_URL, RED_KEY);
    assert.equal(p.url, RED_PROJECT_URL); assert.equal(p.key, RED_KEY);
    assert.equal(p.custom, false); assert.equal(p.red, true); assert.equal(p.setupCode, null);
  }
});

ok("PS takes the Mac's own project when the shell hands one in", () => {
  const p = chooseProject("ps", { url: FRIEND + "/", key: JWT, setupCode: "abcDEF-1234567890ab" }, RED_PROJECT_URL, RED_KEY);
  assert.deepEqual(p, { url: FRIEND, key: JWT, custom: true, red: false, ref: "abcdefghijklmnopqrst", setupCode: "abcDEF-1234567890ab", schema: "public" });
  assert.equal(chooseProject("ps", { url: FRIEND, key: PUB }, RED_PROJECT_URL, RED_KEY).key, PUB, "publishable keys too");
  assert.equal(chooseProject("ps", undefined, RED_PROJECT_URL, RED_KEY).url, RED_PROJECT_URL, "nothing injected: the developer's default, unchanged");
});

ok("a project shared with someone's own app keeps PS in the schema ps; anything else is public (7 Nov 2026)", () => {
  assert.equal(chooseProject("ps", { url: FRIEND, key: JWT, schema: "ps" }, RED_PROJECT_URL, RED_KEY).schema, "ps");
  for (const schema of [undefined, "public", "auth", "ps; drop", "PS", 1, null]) {
    assert.equal(chooseProject("ps", { url: FRIEND, key: JWT, schema }, RED_PROJECT_URL, RED_KEY).schema, "public", String(schema));
  }
  assert.equal(chooseProject("ps", { url: RED_PROJECT_URL, key: RED_KEY, schema: "ps" }, RED_PROJECT_URL, RED_KEY).schema, "public", "The developer's project is always public");
  assert.equal(chooseProject("production", { url: FRIEND, key: JWT, schema: "ps" }, RED_PROJECT_URL, RED_KEY).schema, "public", "the website never");
  const fn = readFileSync(new URL("../supabase/functions/vault-auth/index.ts", import.meta.url), "utf8");
  assert.equal(fn.split('const DB_SCHEMA: string = "public";').length, 2, "the line PS's setup rewrites is there exactly once");
});

ok("The developer's project never offers a setup code (no Create account there)", () => {
  const p = chooseProject("ps", { url: RED_PROJECT_URL, key: RED_KEY, setupCode: "A".repeat(24) }, RED_PROJECT_URL, RED_KEY);
  assert.equal(p.red, true); assert.equal(p.custom, false); assert.equal(p.setupCode, null);
});

ok("odd addresses, keys and codes from the shell are refused field by field", () => {
  for (const url of ["http://abcdefghijklmnopqrst.supabase.co", "https://abcdefghijklmnopqrst.supabase.co.evil.com", "https://evil.com",
    "https://ABCDEFGHIJKLMNOPQRST.supabase.co", "https://short.supabase.co", "javascript:alert(1)", "http://192.168.1.4:54321", 7, null]) {
    assert.equal(cleanInjected({ url, key: JWT }), null, String(url));
  }
  for (const key of ["", "service_role", "sb_secret_abcdefghijklmnop", "eyJ.a.b", 12, null]) assert.equal(cleanInjected({ url: FRIEND, key }), null, String(key));
  assert.equal(cleanInjected({ url: FRIEND, key: JWT, setupCode: "x y" })?.setupCode, null);
  assert.equal(cleanInjected({ url: FRIEND, key: JWT, setupCode: "<script>" + "a".repeat(20) })?.setupCode, null);
  for (const v of [null, "x", [], 1]) assert.equal(cleanInjected(v), null);
  const p = chooseProject("ps", { url: "https://evil.com", key: JWT }, RED_PROJECT_URL, RED_KEY);
  assert.equal(p.url, RED_PROJECT_URL, "a refused choice never becomes a half custom one");
  assert.ok(validProjectUrl("http://127.0.0.1:54321"), "a local Supabase for tests");
  assert.ok(!isRedProjectUrl("https://mxusokxekkecebwqgeru.supabase.co.evil.com"));
});

ok("the first owner of someone else's project never gets the developer's features", () => {
  setActiveProject(chooseProject("ps", { url: FRIEND, key: JWT, setupCode: "A".repeat(24) }, RED_PROJECT_URL, RED_KEY));
  assert.equal(onRedProject(), false);
  // vault_role() answers "red" for any project's first owner: the page sees red true, and it must not count.
  assert.equal(accountKind(redOwner), "owner");
  assert.equal(isRedAccount(redOwner), false);
  for (const f of RED_ONLY) assert.equal(canUse(redOwner, f), false, f);
  for (const f of ["numerology", "rules", "backgroundVideos", "gmail", "claude", "airpods"] as const) assert.equal(canUse(redOwner, f), false);
});

ok("The developer on his own project keeps every feature", () => {
  setActiveProject(chooseProject("ps", undefined, RED_PROJECT_URL, RED_KEY));
  assert.equal(onRedProject(), true);
  assert.equal(accountKind(redOwner), "red");
  for (const f of RED_ONLY) assert.equal(canUse(redOwner, f), true, f);
  assert.equal(accountKind({ status: "unlocked", role: "owner", red: false }), "owner");
  assert.equal(accountKind({ status: "unlocked", role: "client", red: true }), "client");
});

ok("each linked project keeps its own offline copy; the developer's keeps the old one", () => {
  assert.equal(localDbName(chooseProject("ps", undefined, RED_PROJECT_URL, RED_KEY)), "cincee-vault");
  assert.equal(localDbName(chooseProject("ps", { url: FRIEND, key: JWT }, RED_PROJECT_URL, RED_KEY)), "cincee-vault-abcdefghijklmnopqrst");
  assert.equal(localDbName(null), "cincee-vault");
});

ok("the page's own gates: every place that sets the developer's flag checks the project", () => {
  const v = read("src/core/vault.ts");
  assert.match(v, /if \(patch\.red && !onRedProject\(\)\) patch = \{ \.\.\.patch, red: false \};/, "emit never lets red through");
  assert.match(v, /red: role === "owner" && red && onRedProject\(\)/, "finishUnlock");
  assert.match(v, /r\.red = r\.red && onRedProject\(\);/, "confirmRole");
  assert.match(v, /red: s\.role === "owner" && \(s\.red \?\? true\) && onRedProject\(\)/, "saved session");
  // Local first (V1.44): a moved local vault brings its own settings and tasks, so the seed is skipped after a move.
  assert.match(v, /const red = onRedProject\(\);\s*const moved = await finishUnlock\(login, username\.trim\(\), userId, "owner", keys, vkLocked, red, true\);\s*if \(!moved\) await seedOwner\(red, name\);/, "owner setup");
  assert.match(v, /indexedDB\.open\(localDbName\(PROJECT\), 1\)/);
  assert.match(v, /chooseProject\(import\.meta\.env\.MODE, \(globalThis as \{ __psProject\?: unknown \}\)\.__psProject,/);
  // the shell hears {type:"owner", red} from bgAllowed, which is isRedAccount
  assert.match(read("src/ps.ts"), /const red = bgAllowed\(s\);\s*if \(red !== ownerSaid\) \{ ownerSaid = red; psPost\(\{ type: "owner", red \}\); \}/);
  assert.match(read("src/core/bgvault.ts"), /export function bgAllowed\(s: Snapshot\) \{\s*return isRedAccount\(s\);/);
});

ok("the website's and the phone's CSP stay locked to the developer's project", () => {
  const pb = read("scripts/postbuild.mjs");
  assert.match(pb, /const SB = "https:\/\/mxusokxekkecebwqgeru\.supabase\.co";/);
  // G Squad chat (V1.40): the website also reaches the G Squad hub, exactly that one project and nothing else.
  assert.match(pb, /`connect-src 'self' \$\{SB\} \$\{SB\.replace\("https", "wss"\)\} \$\{SQUAD_HUB\}`/);
  assert.match(pb, /const SQUAD_HUB = "https:\/\/zxhvchchfrkfqxuyorqo\.supabase\.co";/);
  // G Squad, the mobile web app (/todolist-mobile/), talks to each friend's OWN project: its policy alone has the
  // wildcard, made from the website's by swapping connect-src. The website's own policy never has it.
  const web = pb.slice(pb.indexOf("const csp = ["), pb.indexOf('].join("; ");'));
  assert.ok(web.length > 100 && !/\*\.supabase\.co/.test(web), "no wildcard on the website");
  assert.deepEqual(pb.match(/\*\.supabase\.co/g), ["*.supabase.co"], "the wildcard is written once, as MOBILE_SB");
  assert.match(pb, /const MOBILE_SB = "https:\/\/\*\.supabase\.co";/);
  assert.match(pb, /\/client\/\*\n  Content-Security-Policy: \$\{csp\}/, "the website's pages keep the locked policy");
  assert.match(pb, /\/todolist-mobile\/\*\n  Content-Security-Policy: \$\{mobileCsp\}/);
  const vc = read("vite.config.ts");
  assert.ok(!/\*\.supabase\.co/.test(vc), "no wildcard on the phone");
});

ok("Create account only in PS, only on a linked project with a setup code", () => {
  const c = read("src/views/PsCreate.tsx");
  assert.match(c, /export const psCanCreate = \(\) => PS && PROJECT\.custom && !!PROJECT\.setupCode && !spent;/);
  assert.match(c, /\(key\) => \{ spent = true; setRecovery\(key\); psPost\(\{ type: "project:created" \}\); \}/, "once made, Create account is gone and the shell forgets the code");
  // V1.49: passphrase only, the project's hidden handle in the username's place (core/accountid.ts).
  assert.match(c, /ownerSetup\(PROJECT\.setupCode \|\| "", PROJECT_HANDLE, pass,/);
  assert.ok(!/autoComplete="username"|autoComplete="given-name"/.test(c), "no username and no first name field");
  const l = read("src/views/Lock.tsx");
  // Local first (V1.44): only the data on this Mac (no password) or Start now on a Mac nobody used come before it.
  assert.match(l, /if \(PS\) \{\s*if \(localHere\) return [^\n]*\n\s*if \(startHere\) \{[\s\S]{0,600}?\n    \}\n    if \(create\) return <PsCreateAccount/);
});

ok("a signed out PS still shows updates (the gear is not on the signed out list)", () => {
  const p = read("src/views/PsApp.tsx");
  const locked = p.slice(p.indexOf("function OverlayLocked"), p.indexOf("function OverlayControls"));
  assert.match(locked, /\{!locked && <div className="ps-locked-upd"><MacUpdateRow menuOpen \/><\/div>\}/);
  // and the list says hello to the updater signed in or not (so the background check feeds this row)
  assert.match(read("src/macupdate.ts"), /if \(PS && \/\\\/overlay\\\/\?\$\/\.test\(location\.pathname\)\) startMacUpdate\(\);/);
});

console.log(`own-project: ${n} passed`);
