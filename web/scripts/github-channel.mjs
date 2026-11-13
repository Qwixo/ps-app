// The update channel on GitHub (V1.57, the developer, 13 Nov 2026: "Remove the IP address part so I can't see their IP address
// when [PS] asks Cincee for updates"). PS V1.57 and newer ask the public PS repo on GitHub for updates, never cincee.com:
//   Mac    https://github.com/RedbyPS/ps/releases/latest/download/ps-update.json  and the two zips it names
//   phone  https://github.com/RedbyPS/ps/releases/latest/download/gos-version.json and the APK it names
//   web    https://raw.githubusercontent.com/RedbyPS/ps/channel/web-version.json   (the website's "New version" note)
// GitHub shows the repo's owner download counts and visitor counts, no addresses.
// PS V1.56 and older still ask cincee.com/client/ps/ and /client/gos/: scripts/postbuild.mjs keeps filling those.
//
//   node scripts/github-channel.mjs plan                what would go up (reads ps-release/, gos-release/, dist/)
//   node scripts/github-channel.mjs publish [--dry-run] a GitHub release v<version> with exactly the files the notes
//                                                      name, marked latest, then web-version.json on the branch
//                                                      "channel" (one commit, no history). --dry-run prints the gh calls.
// scripts/release.sh runs publish right after the website deploy, only when the channel audit was clean.
// Needs `gh` signed in to an account that can write to the repo (PS_GH_REPO, default RedbyPS/ps).
// The release's text is the developer's approved public notes for the version (scripts/ps-public.mjs) or nothing: no new words.
// Nothing here signs anything or changes a check: the Mac verifies the note's Ed25519 signature and every file's
// SHA-256, the phone the APK's SHA-256 and its pinned signing certificate, wherever the files come from.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = process.env.PS_GH_REPO || "RedbyPS/ps";
export const CHANNEL_BRANCH = "channel";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const sha256 = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

/** One file the note names, checked here against the size and SHA-256 in the note before it goes up. */
function named(dir, file, size, sha, what) {
  if (typeof file !== "string" || !file) throw new Error(`${what}: the note names no file`);
  const name = basename(file);
  if (!NAME.test(name)) throw new Error(`${what}: strange file name ${JSON.stringify(file)}`);
  const from = join(dir, file);
  if (!existsSync(from)) throw new Error(`${what}: ${from} is missing`);
  if (statSync(from).size !== size) throw new Error(`${what}: ${from} is not the size the note says`);
  if (sha256(from) !== String(sha).toLowerCase()) throw new Error(`${what}: ${from} does not match the note's SHA-256`);
  return { from, name };
}

/** What goes up, from the staged channel (ps-release/), the phone's staged files (gos-release/) and the website's
 *  version.json (dist/). Throws on anything that does not add up; nothing is uploaded then. */
export function plan(root = process.cwd()) {
  const pub = join(root, "ps-release"), gos = join(root, "gos-release");
  const noteFile = join(pub, "ps-update.json");
  if (!existsSync(noteFile)) throw new Error(`${noteFile} is missing: nothing to publish`);
  const outer = readJson(noteFile);
  const signed = JSON.parse(Buffer.from(String(outer.signed || ""), "base64").toString("utf8"));
  if (signed.format !== 1 || !signed.web) throw new Error("ps-update.json is not a PS update note");
  const assets = [{ from: noteFile, name: "ps-update.json" }];
  if (signed.app) assets.push(named(pub, signed.app.file, signed.app.size, signed.app.sha256, "Mac app"));
  assets.push(named(pub, signed.web.file, signed.web.size, signed.web.sha256, "Mac web files"));

  // The phone: the same files cincee.com/client/gos/ gets (scripts/postbuild.mjs copies gos-release/ the same way).
  const gv = join(gos, "version.json");
  let phone = null;
  if (existsSync(gv)) {
    const g = readJson(gv);
    if (!Number.isInteger(g.versionCode) || typeof g.versionName !== "string") throw new Error("gos-release/version.json is not a phone note");
    if (!/^[A-Za-z0-9._-]+\.apk$/.test(String(g.apk || ""))) throw new Error("gos-release/version.json names a strange APK");
    assets.push({ from: gv, name: "gos-version.json" });
    assets.push(named(gos, g.apk, g.size, g.sha256, "phone APK"));
    phone = g.versionName;
  }

  const names = assets.map((a) => a.name);
  if (new Set(names).size !== names.length) throw new Error(`two files would have the same name: ${names.join(", ")}`);

  // The website: dist/client/version.json as it was deployed (the same src and built the live page carries; the
  // app lives under /client, so the build writes it there, not at dist/version.json).
  const wv = [join(root, "dist", "client", "version.json"), join(root, "dist", "version.json")].find((f) => existsSync(f)) || join(root, "dist", "client", "version.json");
  if (!existsSync(wv)) throw new Error(`${wv} is missing: build the website first (npm run build)`);
  const w = readJson(wv);
  if (!/^[0-9a-f]{8,64}$/.test(String(w.src)) || !ISO.test(String(w.built))) throw new Error(`${wv} is not a website version note`);
  const web = JSON.stringify({ src: w.src, built: w.built, compat: Number.isInteger(w.compat) && w.compat > 0 ? w.compat : 1 });

  const v = readJson(join(root, "ps-version.json"));
  if (!/^\d+\.\d{2}$/.test(String(v.version))) throw new Error("ps-version.json has no version");
  const keyword = (v.names && v.names[v.version]) || "";
  return { tag: `v${v.version}`, title: `PS V${v.version}${keyword ? ` · ${keyword}` : ""}`, assets, web, phone, mac: signed.name || null };
}

/** The gh calls for a plan, in order. `run(args, input?)` runs gh (or prints it on a dry run) and returns its output. */
export function publish(p, run, notes = "") {
  const dir = mkdtempSync(join(tmpdir(), "ps-gh-channel-"));
  try {
    // Each file under the name PS asks for (GitHub keeps no folders).
    const files = p.assets.map((a) => { const to = join(dir, a.name); copyFileSync(a.from, to); return to; });
    const notesFile = join(dir, "notes.txt"); writeFileSync(notesFile, notes);
    let exists = true;
    try { run(["release", "view", p.tag, "--repo", REPO, "--json", "tagName"]); } catch { exists = false; }
    if (exists) {
      // A release run again (say after a failed upload): the same files replaced, the release marked latest.
      run(["release", "upload", p.tag, ...files, "--repo", REPO, "--clobber"]);
      run(["release", "edit", p.tag, "--repo", REPO, "--latest", "--title", p.title, "--notes-file", notesFile]);
    } else {
      run(["release", "create", p.tag, ...files, "--repo", REPO, "--latest", "--title", p.title, "--notes-file", notesFile]);
    }
    // web-version.json on the branch "channel": one commit with that one file and no parent, so it never grows.
    const blob = JSON.parse(run(["api", `repos/${REPO}/git/blobs`, "--input", "-"], JSON.stringify({ content: Buffer.from(p.web).toString("base64"), encoding: "base64" })) || '{"sha":"DRY"}');
    const tree = JSON.parse(run(["api", `repos/${REPO}/git/trees`, "--input", "-"], JSON.stringify({ tree: [{ path: "web-version.json", mode: "100644", type: "blob", sha: blob.sha }] })) || '{"sha":"DRY"}');
    const commit = JSON.parse(run(["api", `repos/${REPO}/git/commits`, "--input", "-"], JSON.stringify({ message: `web-version.json for ${p.tag}`, tree: tree.sha, parents: [] })) || '{"sha":"DRY"}');
    try {
      run(["api", "-X", "PATCH", `repos/${REPO}/git/refs/heads/${CHANNEL_BRANCH}`, "--input", "-"], JSON.stringify({ sha: commit.sha, force: true }));
    } catch {
      run(["api", "-X", "POST", `repos/${REPO}/git/refs`, "--input", "-"], JSON.stringify({ ref: `refs/heads/${CHANNEL_BRANCH}`, sha: commit.sha }));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** After a real publish: GitHub's "latest" note must be the one just staged, byte for byte. GitHub can answer 404 for
 *  a few seconds after a new release (seen on V1.57), so it asks again for up to 2 minutes before giving up. */
async function verify(p) {
  const want = readFileSync(p.assets[0].from);
  let status = 0;
  for (let i = 0; i < 12; i++) {
    if (i) await new Promise((r) => setTimeout(r, 10_000));
    const r = await fetch(`https://github.com/${REPO}/releases/latest/download/ps-update.json`, { cache: "no-store" });
    const got = Buffer.from(await r.arrayBuffer());
    status = r.status;
    if (r.ok && got.equals(want)) return;
  }
  throw new Error(`GitHub's latest ps-update.json is not the one just published (HTTP ${status})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...rest] = process.argv.slice(2);
  const dry = rest.includes("--dry-run");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const p = plan(root);
    if (cmd === "plan") {
      console.log(`${REPO} ${p.tag} "${p.title}" (Mac ${p.mac || "?"}, phone ${p.phone || "none"})`);
      for (const a of p.assets) console.log(`  ${a.name}  <-  ${a.from}`);
      console.log(`  branch ${CHANNEL_BRANCH}: web-version.json ${p.web}`);
    } else if (cmd === "publish") {
      let notes = "";
      try { notes = execFileSync("node", [join(root, "scripts/ps-public.mjs"), "notes-text"], { encoding: "utf8" }).trim(); } catch { notes = ""; }
      const run = dry
        ? (args, input) => { console.log(`DRY  gh ${args.join(" ")}${input ? `  <<< ${input.length > 160 ? input.slice(0, 160) + "..." : input}` : ""}`); if (args[1] === "view") throw new Error("dry"); return ""; }
        : (args, input) => execFileSync("gh", args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
      publish(p, run, notes);
      if (!dry) { await verify(p); console.log(`GitHub channel: ${p.tag} is the latest release (${p.assets.map((a) => a.name).join(", ")}), web-version.json on ${CHANNEL_BRANCH}.`); }
    } else {
      console.log("usage: node scripts/github-channel.mjs plan | publish [--dry-run]");
      process.exit(2);
    }
  } catch (e) {
    console.error(`STOP (GitHub channel): ${e.message}`);
    process.exit(1);
  }
}
