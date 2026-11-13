// Run: node --experimental-strip-types tests/phoneaccount.test.ts
// Link your iPhone, account kind (V1.55): the Mac's code also says whether the account was made with a username or is
// passphrase only, so a freshly linked phone signs in with the passphrase alone for both kinds. Proves: the code for
// both kinds, an older code still works, the phone remembers the username only for the project it came with, a username
// account opens with the username's keys (not the project's), a failed passphrase only sign in opens the username
// field, and the username stays out of logs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../src/core/crypto.ts";
import { accountDerive, accountLogin, failedSignIn, projectHandle, signInUsername } from "../src/core/accountid.ts";
import { chooseProject, RED_PROJECT_URL } from "../src/core/project.ts";
import { PHONE_LINK_BASE, phoneLinkUrl, readLinkText } from "../src/mobile/linkcode.ts";
import { readAccountName, saveAccountHint } from "../src/mobile/link.ts";

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log("ok -", name); };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const REF = "abcdefghijklmnopqrst";
const URL1 = `https://${REF}.supabase.co`;
const PUB = "sb_publishable_madeUpTestKey0123456789";
const project = chooseProject("ps", { url: URL1, key: PUB }, RED_PROJECT_URL, "sb_publishable_buildsownkey000000000");
const handle = projectHandle(project)!;
const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const made = (account: string | null) => { const r = phoneLinkUrl(URL1, PUB, "public", undefined, account, project); assert.ok("ok" in r); return r.ok; };
const back = (text: string) => { const r = readLinkText(text); assert.ok(r && "ok" in r); return r; };

await ok("a passphrase only account: the code says so, the phone saves no username", () => {
  const code = made(handle);
  assert.match(code, /&a=p$/);
  assert.ok(!code.includes("&n="));
  const r = back(code);
  assert.deepEqual(r.account, { kind: "project" });
  assert.equal(r.ok.url, URL1);
});

await ok("an account made with a username: the code carries it, only after the #", () => {
  const code = made("alex.smith");
  assert.match(code, /&n=alex\.smith$/);
  assert.ok(code.indexOf("#") < code.indexOf("alex.smith"), "the username is in the fragment, never in the path or query");
  assert.deepEqual(back(code).account, { kind: "name", name: "alex.smith" });
  // an odd username still survives the trip exactly
  const odd = "Alex & Co. #1 é";
  assert.deepEqual(back(made(odd)).account, { kind: "name", name: odd });
  // a username that is called project is a username, not the passphrase only kind
  assert.deepEqual(back(made("project")).account, { kind: "name", name: "project" });
});

await ok("an older code (no hint) still works exactly as before", () => {
  const old = `${PHONE_LINK_BASE}#link=1&u=${REF}&k=${PUB}`;
  const r = back(old);
  assert.equal(r.ok.key, PUB);
  assert.equal(r.account, null);
  assert.equal(made(null), old, "no account known: the same code as 1.53 made");
  const s = store();
  saveAccountHint(r.ok.url, r.account, s);
  assert.equal(readAccountName(URL1, s), "");
});

await ok("a bad or unusable hint never breaks the link", () => {
  const long = "x".repeat(65);
  for (const frag of [`&n=${long}`, "&n=", "&n=%00bad", "&a=zzz", "&n=line%0Abreak"]) {
    const r = back(`${PHONE_LINK_BASE}#link=1&u=${REF}&k=${PUB}${frag}`);
    assert.equal(r.account, null, frag);
  }
});

await ok("the phone remembers the username for this project only, and a passphrase only code clears it", () => {
  const s = store();
  saveAccountHint(URL1, { kind: "name", name: "alex.smith" }, s);
  assert.equal(readAccountName(URL1, s), "alex.smith");
  assert.equal(readAccountName("https://zyxwvutsrqponmlkjihg.supabase.co", s), "", "another project never gets it");
  saveAccountHint(URL1, null, s);
  assert.equal(readAccountName(URL1, s), "alex.smith", "an older code leaves it alone");
  saveAccountHint(URL1, { kind: "project" }, s);
  assert.equal(readAccountName(URL1, s), "", "a passphrase only code clears it");
});

await ok("with the remembered username a username account opens with ITS keys; passphrase only still uses the project's", async () => {
  const PASS = "correct horse battery staple 42";
  // the phone, freshly linked, before the fix: no remembered name, so the project's handle is used (wrong for this account)
  const before = signInUsername({ handle, typed: false, typedName: "", remembered: "" });
  assert.equal(before, handle);
  const wrongLogin = await accountLogin(before, project), rightLogin = await C.loginEmail("alex.smith");
  assert.notEqual(wrongLogin, rightLogin, "the bug: the handle gives a different account");
  // after: the code said alex.smith, the phone remembers it
  const who = signInUsername({ handle, typed: false, typedName: "", remembered: "alex.smith" });
  assert.equal(who, "alex.smith");
  assert.equal(await accountLogin(who, project), rightLogin);
  assert.equal((await accountDerive(PASS, who, project)).authPassword, (await C.deriveFromPassphrase(PASS, "alex.smith")).authPassword);
  // a passphrase only account: nothing remembered, the handle, the project's keys
  const solo = signInUsername({ handle, typed: false, typedName: "", remembered: "" });
  assert.equal((await accountDerive(PASS, solo, project)).authPassword, (await C.deriveForProject(PASS, REF)).authPassword);
});

await ok("a wrong passphrase on a passphrase only sign in opens the username field with plain words", () => {
  const f = failedSignIn({ handle, typed: false, setup: false, message: "Wrong username or passphrase." });
  assert.equal(f.openName, true);
  assert.match(f.text, /Signed up with a username\? Type it here\./);
  assert.ok(!/\u2014|\u2013/.test(f.text));
  // already typing a username, the developer's project (no handle), setting up, or some other error: said as it was
  assert.deepEqual(failedSignIn({ handle, typed: true, setup: false, message: "Wrong username or passphrase." }), { openName: false, text: "Wrong username or passphrase." });
  assert.equal(failedSignIn({ handle: null, typed: false, setup: false, message: "Wrong username or passphrase." }).openName, false);
  assert.equal(failedSignIn({ handle, typed: false, setup: true, message: "Wrong username or passphrase." }).openName, false);
  assert.deepEqual(failedSignIn({ handle, typed: false, setup: false, message: "You are offline." }), { openName: false, text: "You are offline." });
});

await ok("the wiring: Mac code, boot and scan save the hint, the sign in reads it, and nothing logs the username", () => {
  assert.match(read("src/views/LinkIphone.tsx"), /phoneLinkUrl\([^)]*v\.username/);
  assert.match(read("src/mobile/boot.ts"), /saveAccountHint\(r\.ok\.url, r\.account\)/);
  assert.match(read("src/mobile/Connect.tsx"), /saveAccountHint\(l\.url, account\)/);
  const lock = read("src/views/Lock.tsx");
  assert.match(lock, /readAccountName\(PROJECT\.url\)/);
  assert.match(lock, /failedSignIn\(/);
  for (const f of ["src/mobile/link.ts", "src/mobile/linkcode.ts", "src/mobile/boot.ts", "src/mobile/Scan.tsx", "src/views/LinkIphone.tsx"]) {
    const src = read(f);
    assert.ok(!/console\.(log|info|warn|error)\([^)]*(name|account|username)/i.test(src), `${f} logs no username`);
    assert.ok(!/service_role/.test(src), `${f} has no secret role name`);
    assert.ok(!/[\u2013\u2014]/.test(src), `${f} has no em or en dashes`);
  }
});

console.log(`\n${n} passed`);
