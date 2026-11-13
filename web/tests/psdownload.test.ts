// Run: node --experimental-strip-types tests/psdownload.test.ts
// The PS install script and download page (ps-download/): the pinned checker hash, the update key and
// certificate PS itself trusts, no long dashes, and the vault's service worker leaving them alone.
// The real install runs (tamper cases, fake Applications) are in ps-download/test-install.sh.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const sh = read("ps-download/install.sh");

ok("install.sh pins the SHA-256 of ps-verify.js exactly", () => {
  const sha = createHash("sha256").update(readFileSync(new URL("../ps-download/ps-verify.js", import.meta.url))).digest("hex");
  assert.equal(/local verify_sha="([0-9a-f]{64})"/.exec(sh)?.[1], sha);
});
ok("install.sh trusts the same update key and certificate as PS's updater", () => {
  const core = new URL("../../mac/Sources/UpdateCore.swift", import.meta.url);
  if (!existsSync(core)) { console.log("   (ps-mac not next to this checkout, skipped)"); return; }
  const swift = readFileSync(core, "utf8");
  // V1.58: the G Squad channel's keys too (UpdateRoute.gsquad trusts both keys and both certificate roots).
  const pubs = (/local pubs="([^"]+)"/.exec(sh)?.[1] || "").split(" ");
  const req = /local req='([^']+)'/.exec(sh)?.[1] || "";
  for (const k of ["UPDATE_PUBLIC_KEY", "UPDATE_GSQUAD_PUBLIC_KEY"]) {
    const v = new RegExp(`let ${k} = "([^"]*)"`).exec(swift)?.[1];
    if (v) assert.ok(pubs.includes(v), `install.sh trusts ${k}`);
  }
  for (const k of ["PS_CERT_ROOT_RED", "PS_CERT_ROOT_GSQUAD"]) {
    const v = new RegExp(`let ${k} = "([^"]*)"`).exec(swift)?.[1];
    if (v) assert.ok(req.includes(`certificate root = H"${v}"`), `install.sh accepts ${k}`);
  }
  assert.ok(req.startsWith('identifier "com.cincee.ps" and '));
});
ok("install.sh never uses sudo and only fetches from cincee.com over HTTPS", () => {
  assert.ok(!/\bsudo\b/.test(sh.replace(/^#.*$/gm, "")));
  assert.match(sh, /local base="https:\/\/cincee\.com\/client\/ps\/"/);
  assert.match(sh, /local proto="=https"/);
});
ok("install.sh runs only once fully downloaded (everything inside main)", () => {
  assert.match(sh.trimEnd(), /\nmain "\$@"$/);
});
ok("no long dashes in the script or the page", () => {
  const files = ["ps-download/install.sh", ...readdirSync(new URL("../ps-download/download", import.meta.url)).map((f) => "ps-download/download/" + f)];
  for (const f of files) assert.ok(!/[–—]/.test(read(f)), f);
});
ok("the page is noindex and loads nothing from other sites", () => {
  const html = read("ps-download/download/index.html");
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.ok(!/(src|href)="https?:\/\//.test(html));
});
ok("the vault's service worker never caches /client/ps/ or /client/gos/ as its shell", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /startsWith\("\/client\/ps\/"\)/);
  assert.match(sw, /startsWith\("\/client\/gos\/"\)/);
  assert.match(sw, /content-type/);
});

ok("nothing from ps-download/ deploys until the developer approved the exact files (no approval by default)", () => {
  const pb = read("scripts/postbuild.mjs");
  assert.match(pb, /if \(psDownloadApproved\(\)\)/);
  assert.ok(!existsSync(new URL("../ps-download/approved.json", import.meta.url)) || process.env.PS_DOWNLOAD_APPROVED_OK === "1",
    "ps-download/approved.json exists: only after the developer's yes (set PS_DOWNLOAD_APPROVED_OK=1 then)");
});

console.log(`\n${n} PS download checks passed`);
