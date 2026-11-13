// The one PS version for the Mac and the phone, with its numerology keyword (ps-version.json,
// scripts/ps-keywords.json), and since V1.58 who made each release and whether it is shared.
//   node scripts/ps-version.mjs        prints {"version","name","keyword","by","shared"} ("by" and "shared" only when known)
//   node scripts/ps-version.mjs bump [--by <name>] [--private]
//        adds 0.01 on this Mac alone (the V1.57 way), gives the new version the next keyword of its number that no
//        version has had before (the developer: unique every time, never "Truth"), and saves it with who made it.
//   node scripts/ps-version.mjs claim [--by <name>] [--private] [--remote <url>] [--dry-run]
//        the V1.58 way: claims the next number for everyone with a tag on the shared repo (tools/claim-version.mjs),
//        so two people can never take the same one, then saves it here. --dry-run fetches and prints, nothing else.
// ps-version.json: {"version","names":{"1.58":"Name"},"made":{"1.58":{"by":"red","shared":true}}}. A version with
// no "made" entry (every one before V1.58) simply has no "by": every reader treats that as before.
// --by defaults to the name in ps-layer/profile.json (this person's profile), else the last release's "by".
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "ps-version.json");
const words = JSON.parse(readFileSync(join(root, "scripts/ps-keywords.json"), "utf8"));
/** Where the shared repo is (the claim's tags live there). */
export const CORE_REMOTE = "https://github.com/RedbyPS/ps-app.git";

/** The numerology number of a version: the part after the dot, reduced unless it is 11, 22 or 33. */
export function numberOf(version) {
  let n = Number(String(version).split(".")[1] || 0);
  while (n > 9 && ![11, 22, 33].includes(n)) n = String(n).split("").reduce((a, d) => a + Number(d), 0);
  return n;
}

/** Names that may never be given again. */
export const banned = (name) => /^truth\b/i.test(String(name || "").trim());

/** The first word of the version's number that is not in used; past the list, "Wisdom II", "Wisdom III"...
 *  `used` is the names map ({"1.07":"Wisdom"}) or a list of names. */
export function keywordFor(version, used) {
  const list = words[String(numberOf(version))] || [];
  const taken = new Set((Array.isArray(used) ? used : Object.values(used || {})).map((w) => String(w).toLowerCase()));
  for (let round = 1; round < 50; round++) {
    const roman = ["", "", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][round];
    const suffix = round === 1 ? "" : ` ${roman || round}`;
    for (const w of list) if (!taken.has((w + suffix).toLowerCase()) && !banned(w + suffix)) return w + suffix;
  }
  return "";
}

/** "1.57" plus one hundredth: "1.58" (and "1.99" gives "2.00"). */
export function next(version) {
  const [major, minor] = String(version).split(".").map(Number);
  const n = major * 100 + minor + 1;
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

/** Who made a version and whether it went to everyone, as saved (null for versions before V1.58). */
export function madeOf(data, version) {
  const m = data && data.made && data.made[version];
  return m && typeof m.by === "string" && m.by ? { by: m.by, shared: m.shared !== false } : null;
}

/** What the scripts print and the builds carry (dist-ps/ps-version.json). */
export function describe(data) {
  const m = madeOf(data, data.version);
  return { version: data.version, name: `V${data.version}`, keyword: (data.names || {})[data.version] || "", ...(m ? { by: m.by, shared: m.shared } : {}) };
}

/** The default "by": this person's profile name, else whoever made the last release. */
export function defaultBy(data, dir = root) {
  try { const p = JSON.parse(readFileSync(join(dir, "ps-layer/profile.json"), "utf8")); if (typeof p.name === "string" && /^[a-z][a-z0-9-]{0,30}$/.test(p.name)) return p.name; } catch { /* no profile */ }
  const last = Object.entries(data.made || {}).sort(([a], [b]) => Number(b.replace(".", "")) - Number(a.replace(".", "")))[0];
  return last ? last[1].by : "";
}

/** Saves a new version: its name (never one used before) and who made it. Returns the new data. */
export function record(data, version, { by, shared, name }) {
  const out = { ...data, names: { ...(data.names || {}) }, made: { ...(data.made || {}) } };
  out.version = version;
  if (!out.names[version]) {
    const others = Object.fromEntries(Object.entries(out.names).filter(([v]) => v !== version));
    const n = name || keywordFor(version, others);
    if (Object.values(others).some((w) => String(w).toLowerCase() === String(n).toLowerCase()) || banned(n)) throw new Error(`the name ${n} may not be used again`);
    out.names[version] = n;
  }
  if (by) out.made[version] = { by, shared: shared !== false };
  return out;
}

/** The claim tool: core-root/tools/ in this repo, tools/ at the root of the shared repo (two folders up from web/scripts). */
async function claimTool() {
  for (const p of [join(root, "core-root/tools/claim-version.mjs"), join(root, "../tools/claim-version.mjs")]) if (existsSync(p)) return import(pathToFileURL(p).href);
  throw new Error("tools/claim-version.mjs is missing");
}

/** Claims the next number on the shared repo (a tag), in a throwaway repository that holds only the tags and main.
 *  PS_CORE_DIR: a clone of the shared repo to claim from instead (its HEAD is tagged). */
export async function claimNext(data, { by, shared, remote = process.env.PS_CORE_REMOTE || CORE_REMOTE, dryRun = false, coreDir = process.env.PS_CORE_DIR, log = () => {} } = {}) {
  const tool = await claimTool();
  const tmp = coreDir ? null : mkdtempSync(join(tmpdir(), "ps-claim-"));
  try {
    let commit = "HEAD";
    if (tmp) {
      execFileSync("git", ["init", "--quiet", "--bare", tmp]);
      execFileSync("git", ["fetch", "--quiet", "--no-tags", remote, "+refs/heads/main:refs/heads/main"], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
      commit = "main";
    }
    const usedHere = Object.values(data.names || {});
    const r = tool.claim({ git: tool.gitIn(coreDir || tmp), remote, commit, by, kind: shared === false ? "private" : "shared", floor: data.version,
      pickName: (v, usedThere) => keywordFor(v, [...usedHere, ...usedThere]), dryRun, log });
    return r;
  } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
}

function options(argv) {
  const o = { by: "", shared: true, remote: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--by") o.by = argv[++i] || "";
    else if (a === "--private") o.shared = false;
    else if (a === "--shared") o.shared = true;
    else if (a === "--remote") o.remote = argv[++i];
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

const isMain = !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  try {
    let data = JSON.parse(readFileSync(file, "utf8"));
    data.names ||= {};
    const cmd = process.argv[2];
    if (cmd === "bump" || cmd === "claim") {
      const o = options(process.argv.slice(3));
      const by = o.by || defaultBy(data);
      if (by && !/^[a-z][a-z0-9-]{0,30}$/.test(by)) throw new Error(`--by must be a lowercase profile name, not ${JSON.stringify(by)}`);
      if (cmd === "bump") {
        data = record(data, next(data.version), { by, shared: o.shared });
        writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
      } else {
        if (!by) throw new Error("claim needs --by <your profile name>");
        const r = await claimNext(data, { by, shared: o.shared, remote: o.remote, dryRun: o.dryRun, log: (s) => console.error(s) });
        const after = record(data, r.version, { by, shared: o.shared, name: r.name });
        if (o.dryRun) { process.stdout.write(JSON.stringify({ ...describe(after), dryRun: true }) + "\n"); process.exit(0); }
        data = after;
        writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
      }
    } else if (cmd) {
      throw new Error("usage: node scripts/ps-version.mjs [bump | claim] [--by <name>] [--private] [--remote <url>] [--dry-run]");
    } else if (!data.names[data.version]) {
      // An unnamed version gets its name in what is printed (and saved by the next bump or claim).
      const others = Object.fromEntries(Object.entries(data.names).filter(([v]) => v !== data.version));
      data.names[data.version] = keywordFor(data.version, others);
    }
    process.stdout.write(JSON.stringify(describe(data)) + "\n");
  } catch (e) {
    console.error(`STOP (ps-version): ${e.message}`);
    process.exit(1);
  }
}
