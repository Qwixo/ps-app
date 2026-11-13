// Run: node --experimental-strip-types tests/phonelink.test.ts
// Link your iPhone by scan: the text in the QR code (project address and publishable key after the #, never a
// secret key), and how the phone reads it. Project refs and keys here are made up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeQr } from "../src/core/qrcode.ts";
import { PHONE_LINK_BASE, hasLinkFragment, phoneLinkUrl, readLinkText } from "../src/mobile/linkcode.ts";
import { SETTINGS } from "../src/core/settingsindex.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const URL1 = "https://abcdefghijklmnopqrst.supabase.co";
const PUB = "sb_publishable_madeUpTestKey0123456789";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${b64({ iss: "supabase", role })}.c2lnbmF0dXJlLW1hZGUtdXA`;
const good = () => { const r = phoneLinkUrl(URL1, PUB); assert.ok("ok" in r); return r.ok; };

ok("the link keeps the project and key after the #, on the phone web app", () => {
  const l = good();
  assert.equal(l, `${PHONE_LINK_BASE}#link=1&u=abcdefghijklmnopqrst&k=${PUB}`);
  const [before, after] = l.split("#");
  assert.ok(before.startsWith("https://cincee.com/todolist-mobile/"));
  assert.ok(!before.includes("sb_") && !before.includes("supabase"), "nothing of the project before the # (that part is sent to the server)");
  assert.ok(after.includes(PUB));
});
ok("the phone reads the whole link, the bare # part and location.hash alike", () => {
  const l = good();
  for (const t of [l, l.split("#")[1], `#${l.split("#")[1]}`, `  ${l}\n`]) {
    const r = readLinkText(t);
    assert.ok(r && "ok" in r, t);
    assert.deepEqual(r.ok, { url: URL1, key: PUB, schema: "public" });
  }
});
ok("a project that keeps PS in the ps schema survives the trip", () => {
  const r = phoneLinkUrl(URL1, PUB, "ps"); assert.ok("ok" in r);
  assert.ok(r.ok.endsWith("&s=ps"));
  const back = readLinkText(r.ok); assert.ok(back && "ok" in back); assert.equal(back.ok.schema, "ps");
});
ok("an older project's long JWT key travels and still fits a QR code", () => {
  const anon = jwt("anon");
  const r = phoneLinkUrl(URL1, anon); assert.ok("ok" in r);
  const back = readLinkText(r.ok); assert.ok(back && "ok" in back); assert.equal(back.ok.key, anon);
  assert.ok(makeQr(r.ok, "M").size > 20);
  assert.ok(makeQr(good(), "M").version <= 8, "the usual link is a small code a camera reads easily");
});
ok("the secret key is refused when making the code", () => {
  for (const k of ["sb_secret_madeUpSecretKey0123456789", jwt("service_role")]) {
    const r = phoneLinkUrl(URL1, k);
    assert.ok("error" in r, k); assert.match(r.error, /secret/i);
  }
});
ok("the secret key is refused when reading a code, even one made by hand", () => {
  for (const k of ["sb_secret_madeUpSecretKey0123456789", jwt("service_role")]) {
    const r = readLinkText(`${PHONE_LINK_BASE}#link=1&u=abcdefghijklmnopqrst&k=${k}`);
    assert.ok(r && "error" in r, k); assert.match(r.error, /secret/i);
  }
});
ok("anything that is not a good link is refused or ignored, never saved", () => {
  assert.equal(readLinkText(""), null);
  assert.equal(readLinkText("https://cincee.com/todolist-mobile/"), null, "no fragment: not a link");
  assert.equal(readLinkText("#add=6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b.abc"), null, "a G Squad invite is not this");
  assert.equal(readLinkText(`https://evil.example.com/#link=1&u=abcdefghijklmnopqrst&k=${PUB}`), null, "another website's address");
  assert.equal(readLinkText(`https://cincee.com.evil.example/#link=1&u=abcdefghijklmnopqrst&k=${PUB}`), null);
  for (const bad of [
    "#link=1", "#link=1&u=abcdefghijklmnopqrst", `#link=1&k=${PUB}`,
    `#link=1&u=notaprojectref&k=${PUB}`, `#link=1&u=evil.example.com&k=${PUB}`, `#link=1&u=https://evil.example.com&k=${PUB}`,
    "#link=1&u=abcdefghijklmnopqrst&k=hello", "#link=1&u=abcdefghijklmnopqrst&k=",
  ]) {
    const r = readLinkText(bad);
    assert.ok(r && "error" in r, bad);
  }
});
ok("hasLinkFragment only says yes to our own marker", () => {
  assert.equal(hasLinkFragment(good()), true);
  assert.equal(hasLinkFragment("#link=1&u=x"), true);
  assert.equal(hasLinkFragment("#add=abc"), false);
  assert.equal(hasLinkFragment("link=2&u=x"), false);
  assert.equal(hasLinkFragment(""), false);
});
ok("the Mac offers it in Settings under Sync and account, never to the developer", () => {
  const e = SETTINGS.find((s) => s.id === "link-iphone");
  assert.ok(e, "the setting is in the index");
  assert.equal(e.group, "sync"); assert.deepEqual(e.on, ["mac"]); assert.equal(e.notRed, true);
  const ctl = read("src/views/LinkIphone.tsx");
  assert.match(ctl, /onRedProject\(\)/, "hidden on the developer's project");
  assert.match(ctl, /phoneLinkUrl\(/);
  assert.ok(!/service_role|sb_secret/.test(ctl), "no secret anywhere in the control");
});
ok("the phone's boot reads the # before handing over the project, and takes it off the address", () => {
  const b = read("src/mobile/boot.ts");
  assert.ok(b.indexOf("takeFragment()") < b.indexOf("readLinked()"), "the link is saved before the project is read");
  assert.match(b, /history\.replaceState/);
});
ok("the phone may use the camera on its own address; no new network address", () => {
  const post = read("scripts/postbuild.mjs");
  assert.match(post, /Permissions-Policy: camera=\(self\)/);
  assert.ok(!/camera=\(\)/.test(post));
  assert.match(read("src/mobile/Scan.tsx"), /getUserMedia/);
});
ok("only a JWT whose role is exactly anon counts as publishable (an allowlist), and the shipped source never holds the secret role's name", () => {
  for (const role of ["service_role", "authenticated", "admin", "ANON", ""]) assert.ok("error" in phoneLinkUrl(URL1, jwt(role)), role);
  assert.ok("error" in phoneLinkUrl(URL1, "eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.c2ln"), "a JWT that cannot be read is refused");
  assert.ok("ok" in phoneLinkUrl(URL1, jwt("anon")));
  for (const f of ["src/mobile/link.ts", "src/mobile/linkcode.ts", "src/mobile/Scan.tsx", "src/mobile/boot.ts", "src/views/LinkIphone.tsx"]) {
    assert.ok(!/service_role/.test(read(f)), `${f} must not contain the secret role's name (the release audit blocks it)`);
  }
});
console.log(`\n${n} passed`);
