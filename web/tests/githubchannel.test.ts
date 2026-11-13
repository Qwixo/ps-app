// Run: node --experimental-strip-types tests/githubchannel.test.ts
// The update channel on GitHub (scripts/github-channel.mjs, V1.57): exactly the files the notes name go up, under the
// names PS asks for, checked against the notes first; web-version.json goes on its own one-commit branch; the PS apps
// and the website ask GitHub, never cincee.com. A temp folder with FICTIONAL files; gh is never run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const G = await import("../scripts/github-channel.mjs");
const W = await import("../src/core/webupdate.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function fake(o: { phone?: boolean; badSha?: boolean; badName?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ps-ghc-test-"));
  mkdirSync(join(root, "ps-release/updates"), { recursive: true });
  mkdirSync(join(root, "gos-release")); mkdirSync(join(root, "dist"));
  const app = Buffer.from("fictional app"), web = Buffer.from("fictional web");
  writeFileSync(join(root, "ps-release/updates/PS-app-2611131200.zip"), app);
  writeFileSync(join(root, "ps-release/updates/PS-web-20261113120000000.zip"), web);
  const signed = { format: 1, kind: "app", made: "2026-11-13T12:00:00Z", name: "V1.57", keyword: "Test",
    app: { build: 2611131200, file: o.badName ? "updates/../x y.zip" : "updates/PS-app-2611131200.zip", size: app.length, sha256: hex(app) },
    web: { src: "abcdef0123456789", built: "2026-11-13T12:00:00.000Z", file: "updates/PS-web-20261113120000000.zip", size: web.length, sha256: o.badSha ? hex("other") : hex(web) } };
  writeFileSync(join(root, "ps-release/ps-update.json"), JSON.stringify({ key: "ps-update-1", sig: "fictional", signed: Buffer.from(JSON.stringify(signed)).toString("base64") }));
  if (o.phone !== false) {
    const apk = Buffer.from("fictional apk");
    writeFileSync(join(root, "gos-release/ps-gos-1.57.apk"), apk);
    writeFileSync(join(root, "gos-release/version.json"), JSON.stringify({ versionCode: 62, versionName: "V1.57", apk: "ps-gos-1.57.apk", sha256: hex(apk), size: apk.length }));
  }
  writeFileSync(join(root, "dist/version.json"), JSON.stringify({ src: "abcdef0123456789", built: "2026-11-13T12:01:00.000Z", compat: 1 }));
  writeFileSync(join(root, "ps-version.json"), JSON.stringify({ version: "1.57", names: { "1.57": "Test" } }));
  return root;
}

ok("the plan: the note, the two zips it names, the phone's note as gos-version.json and its APK", () => {
  const root = fake();
  try {
    const p = G.plan(root);
    assert.equal(p.tag, "v1.57");
    assert.equal(p.title, "PS V1.57 · Test");
    assert.deepEqual(p.assets.map((a: { name: string }) => a.name), ["ps-update.json", "PS-app-2611131200.zip", "PS-web-20261113120000000.zip", "gos-version.json", "ps-gos-1.57.apk"]);
    assert.deepEqual(JSON.parse(p.web), { src: "abcdef0123456789", built: "2026-11-13T12:01:00.000Z", compat: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
ok("no phone files staged: only the Mac's go up", () => {
  const root = fake({ phone: false });
  try { assert.equal(G.plan(root).assets.length, 3); } finally { rmSync(root, { recursive: true, force: true }); }
});
ok("a file that does not match its note, or a strange name, stops everything", () => {
  for (const o of [{ badSha: true }, { badName: true }]) {
    const root = fake(o);
    try { assert.throws(() => G.plan(root)); } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
ok("first publish: one release marked latest, then web-version.json as a commit with no parent on 'channel'", () => {
  const root = fake();
  try {
    const calls: { args: string[]; input?: string }[] = [];
    const run = (args: string[], input?: string) => {
      calls.push({ args, input });
      if (args[0] === "release" && args[1] === "view") throw new Error("not found");
      if (args[0] === "api" && args.includes("PATCH")) throw new Error("no branch yet");
      if (args[0] === "api") return JSON.stringify({ sha: "s" + calls.length });
      return "";
    };
    G.publish(G.plan(root), run, "New: fictional.");
    const create = calls.find((c) => c.args[1] === "create")!;
    assert.ok(create && create.args.includes("--latest") && create.args.includes("v1.57") && create.args.includes(G.REPO));
    assert.deepEqual(create.args.filter((a) => /\.(json|zip|apk)$/.test(a)).map((a) => a.split("/").pop()),
      ["ps-update.json", "PS-app-2611131200.zip", "PS-web-20261113120000000.zip", "gos-version.json", "ps-gos-1.57.apk"]);
    const commit = calls.find((c) => c.args[1]?.endsWith("/git/commits"))!;
    assert.deepEqual(JSON.parse(commit.input!).parents, []);
    const tree = calls.find((c) => c.args[1]?.endsWith("/git/trees"))!;
    assert.deepEqual(JSON.parse(tree.input!).tree.map((t: { path: string }) => t.path), ["web-version.json"]);
    assert.ok(calls.some((c) => c.args.includes("POST") && JSON.parse(c.input!).ref === "refs/heads/channel"));
    assert.ok(!calls.some((c) => (c.input || "").includes("cincee")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
ok("publishing again: the same release's files replaced and marked latest, the branch moved", () => {
  const root = fake();
  try {
    const calls: string[][] = [];
    const run = (args: string[]) => { calls.push(args); return args[0] === "api" ? '{"sha":"x"}' : ""; };
    G.publish(G.plan(root), run);
    assert.ok(calls.some((a) => a[1] === "upload" && a.includes("--clobber")));
    assert.ok(calls.some((a) => a[1] === "edit" && a.includes("--latest")));
    assert.ok(!calls.some((a) => a[1] === "create"));
    assert.ok(calls.some((a) => a.includes("PATCH")) && !calls.some((a) => a.includes("POST")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
ok("the apps and the website ask the same repo on GitHub, never cincee.com", () => {
  assert.equal(W.WEB_CHANNEL, `https://raw.githubusercontent.com/${G.REPO}/${G.CHANNEL_BRANCH}/web-version.json`);
  const note = readFileSync(new URL("../src/views/WebUpdateNote.tsx", import.meta.url), "utf8");
  assert.ok(/fetch\(WEB_CHANNEL,/.test(note) && !/version\.json\?v=/.test(note) && /referrerPolicy: "no-referrer"/.test(note) && /credentials: "omit"/.test(note));
  const post = readFileSync(new URL("../scripts/postbuild.mjs", import.meta.url), "utf8");
  assert.ok(/connect-src 'self' \$\{SB\} \$\{SB\.replace\("https", "wss"\)\} \$\{SQUAD_HUB\} \$\{GH_RAW\}/.test(post) && post.includes('const GH_RAW = "https://raw.githubusercontent.com";'));
  const rel = readFileSync(new URL("../scripts/release.sh", import.meta.url), "utf8");
  assert.ok(/step github node scripts\/github-channel\.mjs publish/.test(rel), "release.sh publishes the GitHub channel");
});
ok("a note on GitHub no newer than this page says nothing (a deploy without a release never loops)", () => {
  const mine = { src: "aaaa1111bbbb2222", compat: 1, built: "2026-11-13T12:00:00.000Z" };
  assert.equal(W.webNote(mine, { src: "cccc3333dddd4444", built: "2026-11-12T09:00:00.000Z", compat: 1 }), null);
  assert.equal(W.webNote(mine, { src: "cccc3333dddd4444", built: "2026-11-13T12:00:00.000Z", compat: 1 }), null);
  assert.deepEqual(W.webNote(mine, { src: "cccc3333dddd4444", built: "2026-11-13T13:00:00.000Z", compat: 1 }), { kind: "new" });
  assert.deepEqual(W.webNote(mine, { src: "cccc3333dddd4444", built: "2026-11-12T09:00:00.000Z", compat: 2 }), { kind: "must" });
  assert.deepEqual(W.webNote(mine, { src: "cccc3333dddd4444", built: "not a date", compat: 1 }), { kind: "new" });
  assert.deepEqual(W.webNote({ src: "aaaa1111bbbb2222", compat: 1 }, { src: "cccc3333dddd4444", built: "2026-11-12T09:00:00.000Z" }), { kind: "new" });
});
console.log(`${n} passed`);
