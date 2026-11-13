// The faster release (npm run release -- --app --wait --fast, the developer 8 Nov 2026): the parts of scripts/release.sh
// that decide and report, kept here so they can be tested without a real build.
//   node scripts/release-fast.mjs check [--assume=ok|low]   one line: go faster (exit 0) or fall back (exit 3)
//   node scripts/release-fast.mjs summary <mode> <total s> <rc> <dry|""> <label|secs|rc>...
// The Mac crashed from memory pressure before (Nov 2026), so the check is careful: when in doubt it says
// fall back, and the release then runs one build after the other as always.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GIB = 1024 ** 3;
// Side by side, the phone build (Gradle, -Xmx3g, plus its Kotlin compiler) and the Mac build (swiftc -O on
// every source) want about 5 to 6 GB at their peak. These leave room for everything else the developer has open.
export const NEED_FREE = 8 * GIB;            // with no other heavy build running
export const NEED_FREE_ONE_OTHER = 10 * GIB; // with one other heavy build running
export const MAX_OTHER_BUILDS = 1;           // two or more other heavy builds: always one after the other

// The options release.sh takes. Same rules as its own loop (that one runs first, so a typo stops before anything).
export function parseOptions(args) {
  const o = { app: false, wait: false, fast: false, dryRun: false };
  for (const a of args) {
    if (a === "--app") o.app = true;
    else if (a === "--wait") o.wait = true;
    else if (a === "--fast") o.fast = true;
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`unknown option ${a} (use --app, --wait, --fast and/or --dry-run)`);
  }
  return o;
}

// Can --fast run the two builds side by side at all? (Before any memory check.) Both builds must be due, and the
// Mac build must only build (--wait with PS installed): otherwise it would install PS on this Mac while the
// phone build could still fail, and the rule is that nothing changes anywhere when either build fails.
export function fastPossible({ needPhone, needMac, wait, installed }) {
  if (!needPhone && !needMac) return { ok: false, why: "neither app needs building" };
  if (!needPhone) return { ok: false, why: "the phone app is already built for this version, so only the Mac app builds" };
  if (!needMac) return { ok: false, why: "the Mac app is not part of this release (no --app), so only the phone app builds" };
  if (!wait || !installed) return { ok: false, why: "it needs --wait and PS installed here, so the Mac build only builds and never installs before the phone build has finished" };
  return { ok: true, why: "" };
}

// sysctl kern.memorystatus_level: the share of memory macOS itself counts as free (the "System-wide memory
// free percentage" of memory_pressure). kern.memorystatus_vm_pressure_level: 1 normal, 2 warn, 4 critical.
export function memoryFromSysctl({ levelPercent, pressureLevel, totalBytes }) {
  const pct = Number(levelPercent), lvl = Number(pressureLevel), total = Number(totalBytes);
  if (!Number.isFinite(pct) || !Number.isFinite(lvl) || !(total > 0)) return null;
  return { freePercent: pct, freeBytes: Math.round((pct / 100) * total), totalBytes: total, pressure: lvl };
}

const HEAVY = [
  { what: "Swift build", re: /(^|\/)(swift-frontend|swiftc|swift-build|xcodebuild)(\s|$)/ },
  { what: "Gradle build", re: /GradleDaemon|GradleWrapperMain|GradleWorkerMain|KotlinCompileDaemon/ },
  { what: "web build", re: /(^|\/)node\b.*(\bvite(\.js)?\s+build\b|\/tsc\b|\btsc\s|\bvitest\b|\besbuild\b|\bwebpack\b|\bnext\s+build\b)/ },
  { what: "web build", re: /(^|\/)esbuild(\s|$)/ },
];
const BUSY_CPU = 10; // an idle Gradle daemon or a dev server lingers for hours; only a busy one is a build

// `ps -Ao pid=,ppid=,pcpu=,command=` lines. Many processes of one build (swiftc and its swift-frontends, a
// Gradle daemon and its workers) count once: a heavy process under another heavy one is part of it.
export function heavyBuilds(psText, ignorePids = []) {
  const rows = [];
  for (const line of String(psText).split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, cpu, cmd] = m;
    const kind = HEAVY.find((h) => h.re.test(cmd));
    rows.push({ pid: +pid, ppid: +ppid, cpu: +cpu, cmd, what: kind ? kind.what : null });
  }
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const ignore = new Set(ignorePids.map(Number));
  const heavy = rows.filter((r) => r.what && !ignore.has(r.pid));
  const heavyPids = new Set(heavy.map((r) => r.pid));
  const roots = [];
  for (const r of heavy) {
    let p = byPid.get(r.ppid), inside = false;
    for (let hops = 0; p && hops < 50; hops++, p = byPid.get(p.ppid)) {
      if (heavyPids.has(p.pid)) { inside = true; break; }
      if (p.ppid === p.pid) break;
    }
    if (!inside) roots.push(r);
  }
  // A build counts while it (or anything under it) is busy.
  const busy = (root) => {
    if (root.cpu >= BUSY_CPU) return true;
    return heavy.some((r) => {
      for (let p = r, hops = 0; p && hops < 50; hops++, p = byPid.get(p.ppid)) if (p.pid === root.pid) return r.cpu >= BUSY_CPU;
      return false;
    });
  };
  return roots.filter(busy).map((r) => ({ pid: r.pid, what: r.what }));
}

export function gb(bytes) { return `${(bytes / GIB).toFixed(1)} GB`; }
const PRESSURE = { 1: "normal", 2: "warn", 4: "critical" };

// The one decision: side by side, or one after the other. Always a single line the developer can read.
export function decideFast(mem, others) {
  const n = others.length;
  const builds = n === 0 ? "no other heavy builds" : n === 1 ? `1 other heavy build (${others[0].what})` : `${n} other heavy builds`;
  if (!mem) return { fast: false, line: "Faster release: could not read the memory figures, so the normal order is used (one build after the other)." };
  const facts = `${mem.freePercent}% memory free (${gb(mem.freeBytes)}), pressure ${PRESSURE[mem.pressure] || mem.pressure}, ${builds}`;
  let why = "";
  if (mem.pressure !== 1) why = "macOS already reports memory pressure";
  else if (n > MAX_OTHER_BUILDS) why = "too many other builds are running";
  else if (n === 1 && mem.freeBytes < NEED_FREE_ONE_OTHER) why = `with another build running it needs ${gb(NEED_FREE_ONE_OTHER)} free`;
  else if (mem.freeBytes < NEED_FREE) why = `it needs ${gb(NEED_FREE)} free`;
  if (why) return { fast: false, line: `Faster release: ${facts}; ${why}, so the normal order is used (one build after the other).` };
  return { fast: true, line: `Faster release: ${facts}. The Mac and phone builds run side by side.` };
}

function readMemory() {
  try {
    const out = execFileSync("sysctl", ["-n", "kern.memorystatus_level", "kern.memorystatus_vm_pressure_level", "hw.memsize"], { encoding: "utf8" }).trim().split("\n");
    return memoryFromSysctl({ levelPercent: out[0], pressureLevel: out[1], totalBytes: out[2] });
  } catch { return null; }
}
function readProcesses() {
  try { return execFileSync("ps", ["-Ao", "pid=,ppid=,pcpu=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); }
  catch { return null; }
}

// ---- the time summary ----
const NAMES = {
  phone: "Phone app build and sign", web: "PS web build", mac: "Mac app build and sign", both: "Mac and phone side by side",
  stage: "Public channel staged", "audit-apk": "Phone APK audit", audit: "Security audit", channel: "Public channel swapped in",
  prompt: "Build prompt page", notes: "Private notes sealed", site: "Website build", deploy: "Netlify deploy",
  drive: "Google Drive copy", install: "PS web files installed here",
};
export function duration(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(s / 60), r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}
export function parseTimes(items) {
  return items.filter(Boolean).map((it) => {
    const [label, secs, rc] = String(it).split("|");
    return { label, secs: Number(secs) || 0, rc: Number(rc) || 0 };
  });
}
export function formatSummary({ mode, total, rc, dry, times, previous = {} }) {
  const lines = [];
  lines.push(`Release times (${mode}${dry ? ", dry run" : ""}):`);
  const inside = times.some((t) => t.label === "both");
  for (const t of times) {
    const name = NAMES[t.label] || t.label;
    const ind = inside && (t.label === "phone" || t.label === "mac") ? "    " : "  ";
    const tag = t.rc ? "  FAILED" : "";
    lines.push(`${ind}${(name + (ind.length > 2 ? " (inside)" : "")).padEnd(40 - ind.length)} ${duration(t.secs).padStart(7)}${tag}`);
  }
  lines.push(`  ${"Total".padEnd(38)} ${duration(total).padStart(7)}${Number(rc) ? "  (stopped)" : ""}`);
  for (const m of ["slower", "faster"]) {
    const p = previous[m];
    if (p) lines.push(`Last ${m} release: ${duration(p.total)} (V${p.version}, ${p.date}).`);
  }
  return lines.join("\n");
}

// One line per finished real release, so the two modes can be compared over time.
export const timesFile = () => process.env.PS_RELEASE_TIMES || join(homedir(), "Library", "Logs", "ps-release-times.tsv");
export function lastByMode(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const [date, version, mode, total] = line.split("\t");
    if (!total || !/^(slower|faster)$/.test(mode)) continue;
    out[mode] = { date, version, total: Number(total) };
  }
  return out;
}
// "slower (fell back from faster)" is still a slower release for comparing.
export const modeKey = (mode) => (String(mode).startsWith("faster") ? "faster" : "slower");

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "check") {
    const assume = (rest.find((a) => a.startsWith("--assume=")) || "").slice(9);
    let mem, others;
    if (assume === "ok") { mem = { freePercent: 50, freeBytes: 12 * GIB, totalBytes: 24 * GIB, pressure: 1 }; others = []; }
    else if (assume === "low") { mem = { freePercent: 15, freeBytes: 3.6 * GIB, totalBytes: 24 * GIB, pressure: 2 }; others = []; }
    else {
      mem = readMemory();
      const ps = readProcesses();
      others = ps == null ? [{ pid: 0, what: "unknown (ps failed)" }, { pid: 0, what: "unknown" }] : heavyBuilds(ps, [process.pid, process.ppid]);
    }
    const d = decideFast(mem, others);
    console.log(d.line);
    process.exit(d.fast ? 0 : 3);
  }
  if (cmd === "summary") {
    const [mode, total, rc, dry, ...items] = rest;
    const times = parseTimes(items);
    let previous = {};
    const file = timesFile();
    try { if (existsSync(file)) previous = lastByMode(readFileSync(file, "utf8")); } catch {}
    console.log("");
    console.log(formatSummary({ mode, total, rc, dry: dry === "dry", times, previous }));
    if (!dry && Number(rc) === 0) {
      try {
        const v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "ps-version.json"), "utf8")).version;
        mkdirSync(dirname(file), { recursive: true });
        const steps = times.map((t) => `${t.label}=${t.secs}`).join(",");
        appendFileSync(file, `${new Date().toLocaleString("sv-SE").slice(0, 16)}\t${v}\t${modeKey(mode)}\t${total}\t${steps}\n`);
      } catch {}
    }
    return;
  }
  console.error("use: node scripts/release-fast.mjs check [--assume=ok|low] | summary <mode> <total> <rc> <dry|''> <label|secs|rc>...");
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
