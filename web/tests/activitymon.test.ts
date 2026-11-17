// Run: node --experimental-strip-types tests/activitymon.test.ts
// The Activity monitor's page rules (core/activitymon.ts, PS 1.65): merging what PS sends, helpers under their app, sorting, search,
// holding the order under the pointer, heat, the End task steps, graphs, App history, startup items, the burst box, the words.
// The Mac half (CPU from two samples, memory sums, reading, the End task rules) is mac/tests/activity-test.sh. Made up data only.
import { readFileSync } from "node:fs";
import {
  AM_SOUNDS, AM_WORDS, COLUMNS, burstFrames, DEFAULT_SORT, SECTION, applySnap, bytes, canEnd, cleanCols, cleanSpeed, duration, easeAt, endStep, endWords, graphPaths, heat,
  historyRows, holdOrder, islandBox, mem, nextSort, niceMax, pct, perfItems, pushPoint, rate, startupRows, tableLines, watts,
  type EndState, type Meta, type MetaMap, type Proc, type RowNums, type Snap,
} from "../src/core/activitymon.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };

const meta = (n: string, o: Partial<Meta> = {}): Meta => ({ n, id: "", g: 0, app: false, sys: false, end: true, st: 1000, ...o });
const row = (pid: number, cpu = 0, mem = 0, o: Partial<{ dr: number; dw: number; nr: number; nt: number; w: number; thr: number }> = {}): RowNums =>
  [pid, cpu, mem, o.dr ?? 0, o.dw ?? 0, o.nr ?? -1, o.nt ?? -1, o.w ?? 0, o.thr ?? 4];

// ---- merging what PS sends
const first = applySnap(new Map(), {
  meta: { 10: meta("Sample Browser", { id: "com.example.browser", app: true }), 11: meta("Sample Browser Helper", { g: 10 }), 12: meta("Sample Browser Helper (GPU)", { g: 10 }),
          20: meta("Sample Notes", { id: "com.example.notes", app: true }), 30: meta("syncagent"), 40: meta("1Password", { app: true }), 41: meta("x", { id: "org.whispersystems.signal-desktop" }),
          50: meta("WindowServer", { sys: true, end: false }), 60: meta("PS", { app: true, ps: true, end: false }) },
  rows: [row(10, 4, 4e8), row(11, 6, 2e8, { nr: 1000, nt: 50 }), row(12, 2, 1e8), row(20, 1, 9e7), row(30, 0.2, 2e7, { dr: 5e6 }), row(40, 9, 9e8), row(41, 9, 9e8), row(50, 3, 3e8), row(60, 0.3, 1e8), row(99, 1, 1)],
  gone: [],
});
ok("rows join their meta", first.procs.length === 7);
ok("a row PS never described is left out", !first.procs.some((p) => p.pid === 99));
ok("1Password and Signal are dropped again on the page, name or bundle", !first.procs.some((p) => p.pid === 40 || p.pid === 41) && !first.known.has(40) && !first.known.has(41));
const second = applySnap(first.known, { meta: {}, rows: [row(10, 5, 4e8), row(30, 0.1, 2e7)], gone: [11, 12] });
ok("the next sample needs no meta for known rows", second.procs.length === 2 && second.procs[0].n === "Sample Browser");
ok("gone pids are forgotten", !second.known.has(11) && !second.known.has(12));
ok("a broken row is ignored", applySnap(first.known, { meta: {}, rows: [[1, 2] as unknown as RowNums], gone: [] }).procs.length === 0);
const procs = first.procs;

// ---- helpers under their app, sections, totals
const lines = tableLines(procs, { sort: DEFAULT_SORT, search: "", open: new Set() });
const heads = lines.filter((l) => l.kind === "head").map((l) => l.kind === "head" && l.label);
ok("Apps come first, then Background processes", JSON.stringify(heads) === JSON.stringify([SECTION.apps, SECTION.bg]));
const browser = lines.find((l) => l.kind === "row" && l.p.pid === 10);
ok("a helper folds under its app (closed: only the parent shows)", !lines.some((l) => l.kind === "row" && l.p.pid === 11) && browser?.kind === "row" && browser.kids === 2);
ok("the parent row shows the group total", browser?.kind === "row" && Math.abs(browser.sums.cpu - 12) < 1e-9 && browser.sums.mem === 7e8);
ok("network total known when any member is known", browser?.kind === "row" && browser.sums.net === 1050);
const notes = lines.find((l) => l.kind === "row" && l.p.pid === 20);
ok("network unknown stays unknown (not 0)", notes?.kind === "row" && notes.sums.net === null);
const opened = tableLines(procs, { sort: DEFAULT_SORT, search: "", open: new Set([10]) });
const at = (pid: number) => opened.findIndex((l) => l.kind === "row" && l.p.pid === pid);
ok("open: the helpers sit right under their app, one step in", at(11) === at(10) + 1 && at(12) === at(10) + 2 && opened[at(11)].kind === "row" && (opened[at(11)] as { depth: number }).depth === 1);
ok("open: helpers sorted busiest first too", at(11) < at(12));
ok("Dock apps sorted by CPU, busiest first", (() => { const rows = lines.filter((l) => l.kind === "row" && l.p.app); return rows[0].kind === "row" && rows[0].p.pid === 10; })());
const orphan = tableLines([...procs, { ...procs[1], pid: 77, g: 5555, n: "lost helper" }], { sort: DEFAULT_SORT, search: "", open: new Set() });
ok("a helper whose app is gone is a row of its own", orphan.some((l) => l.kind === "row" && l.p.pid === 77 && l.depth === 0));

// ---- sorting and search
const byName = tableLines(procs, { sort: { col: "name", dir: 1 }, search: "", open: new Set() }).filter((l) => l.kind === "row" && !l.p.app).map((l) => l.kind === "row" && l.p.n);
ok("sort by name A to Z inside a section", JSON.stringify(byName) === JSON.stringify(["syncagent", "WindowServer"]));
ok("clicking the same header flips it, a new one starts busiest first", nextSort(DEFAULT_SORT, "cpu").dir === 1 && nextSort(DEFAULT_SORT, "mem").dir === -1 && nextSort(DEFAULT_SORT, "name").dir === 1);
const memDesc = tableLines(procs, { sort: { col: "mem", dir: -1 }, search: "", open: new Set() }).filter((l) => l.kind === "row" && !l.p.app).map((l) => l.kind === "row" && l.p.pid);
ok("sort by memory, biggest first", memDesc[0] === 50);
const s1 = tableLines(procs, { sort: DEFAULT_SORT, search: "gpu", open: new Set() });
ok("search matching only a helper keeps its app and opens it", s1.some((l) => l.kind === "row" && l.p.pid === 10 && l.open) && s1.some((l) => l.kind === "row" && l.p.pid === 12));
ok("search hides what does not match (and empty sections)", !s1.some((l) => l.kind === "row" && l.p.pid === 30) && !s1.some((l) => l.kind === "head" && l.label === SECTION.bg));
ok("search by process number", tableLines(procs, { sort: DEFAULT_SORT, search: "30", open: new Set() }).some((l) => l.kind === "row" && l.p.pid === 30));
ok("search is not case sensitive", tableLines(procs, { sort: DEFAULT_SORT, search: "SYNC", open: new Set() }).some((l) => l.kind === "row" && l.p.pid === 30));
ok("nothing matches: no lines", tableLines(procs, { sort: DEFAULT_SORT, search: "zzz", open: new Set() }).length === 0);

// ---- rows do not jump on a small wobble
const wob = (cpuA: number, cpuB: number) => applySnap(new Map(), { meta: { 1: meta("Alpha"), 2: meta("Beta") }, rows: [row(1, cpuA), row(2, cpuB)], gone: [] }).procs;
const prevOrder = new Map([["p:2", 0], ["p:1", 1]]);
const near = tableLines(wob(5.2, 5.0), { sort: DEFAULT_SORT, search: "", open: new Set(), prev: prevOrder }).filter((l) => l.kind === "row").map((l) => l.kind === "row" && l.p.pid);
ok("close numbers keep the order already on screen", JSON.stringify(near) === JSON.stringify([2, 1]));
const far = tableLines(wob(9, 5), { sort: DEFAULT_SORT, search: "", open: new Set(), prev: prevOrder }).filter((l) => l.kind === "row").map((l) => l.kind === "row" && l.p.pid);
ok("a clear difference still reorders, busiest first", JSON.stringify(far) === JSON.stringify([1, 2]));
ok("idle rows sort together, by name", JSON.stringify(tableLines(wob(0, 0), { sort: DEFAULT_SORT, search: "", open: new Set() }).filter((l) => l.kind === "row").map((l) => l.kind === "row" && l.p.n)) === JSON.stringify(["Alpha", "Beta"]));

// ---- holding the order while the pointer is over the table
ok("same keys: the old order is kept", JSON.stringify(holdOrder(["a", "b", "c"], ["c", "b", "a"])) === JSON.stringify(["a", "b", "c"]));
ok("a row that is gone leaves", JSON.stringify(holdOrder(["a", "b", "c"], ["c", "a"])) === JSON.stringify(["a", "c"]));
ok("a new row joins after the line before it in the new order", JSON.stringify(holdOrder(["h", "a", "b"], ["h", "x", "b", "a"])) === JSON.stringify(["h", "x", "a", "b"]));
ok("opened helpers join right under their app", JSON.stringify(holdOrder(["h", "a", "b"], ["h", "b", "a", "a1", "a2"])) === JSON.stringify(["h", "a", "a1", "a2", "b"]));

// ---- columns
ok("default columns: Threads and Process ID hidden", JSON.stringify(cleanCols(undefined)) === JSON.stringify(["name", "cpu", "mem", "disk", "net", "energy"]));
ok("Name can never be hidden, unknown ids dropped, fixed order", JSON.stringify(cleanCols(["pid", "cpu", "bogus"])) === JSON.stringify(["name", "cpu", "pid"]));
ok("every column has a label", COLUMNS.every((c) => c.label.length > 1));

// ---- heat
ok("an idle cell is calm", heat("cpu", 0) === 0 && heat("cpu", null) === 0 && heat("net", -1) === 0);
ok("CPU heat climbs with busyness", heat("cpu", 0.6) === 1 && heat("cpu", 12) === 3 && heat("cpu", 80) === 5);
ok("memory heat by size", heat("mem", 5e7) === 0 && heat("mem", 1.5e9) === 3 && heat("mem", 9e9) === 5);
ok("a bad number is calm", heat("disk", Number.NaN) === 0);

// ---- End task
const brave: Proc = { ...procs.find((p) => p.pid === 10)! };
let e: EndState = { s: "idle" };
const step = (ev: Parameters<typeof endStep>[1]) => { const r = endStep(e, ev); e = r.next; return r.send; };
ok("End task asks first and sends nothing", step({ t: "start", p: brave }) === null && e.s === "ask");
ok("the question names the app and warns about unsaved work", endWords(e)?.line === "End Sample Browser? Unsaved work may be lost." && endWords(e)?.button === "End task");
const q1 = step({ t: "confirm" });
ok("the first confirm is a normal quit", q1?.step === "quit" && q1.pid === 10 && q1.st === 1000 && e.s === "quitting");
ok("a second confirm while quitting does nothing", step({ t: "confirm" }) === null && e.s === "quitting");
ok("an answer about another process is ignored", (step({ t: "ended", pid: 999, ok: true, alive: false }), e.s === "quitting"));
step({ t: "ended", pid: 10, ok: true, alive: true });
ok("still open after the quit: offer a force quit", e.s === "stuck" && endWords(e)?.button === "Force quit");
const q2 = step({ t: "confirm" });
ok("only the second click force quits", q2?.step === "force" && e.s === "forcing");
step({ t: "ended", pid: 10, ok: true, alive: false });
ok("gone: done", e.s === "done" && endWords(e)?.line === "Sample Browser ended.");
e = { s: "idle" }; step({ t: "start", p: brave }); step({ t: "confirm" }); step({ t: "ended", pid: 10, ok: true, alive: false });
ok("a quit that worked never offers a force quit", e.s === "done");
e = { s: "idle" }; step({ t: "start", p: brave }); step({ t: "cancel" });
ok("Cancel (or Esc) at the question ends it with nothing sent", e.s === "idle");
e = { s: "idle" }; step({ t: "start", p: brave }); step({ t: "confirm" }); step({ t: "ended", pid: 10, ok: false, alive: true });
ok("PS refused: failed, no force offered", e.s === "failed" && !endWords(e)?.button);
e = { s: "idle" }; step({ t: "start", p: brave }); step({ t: "confirm" }); step({ t: "ended", pid: 10, ok: true, alive: true }); step({ t: "confirm" }); step({ t: "ended", pid: 10, ok: true, alive: true });
ok("still there after a force quit: failed, nothing more", e.s === "failed");
e = { s: "idle" }; step({ t: "start", p: brave }); step({ t: "confirm" }); step({ t: "timeout" });
ok("no answer to a quit: failed, never stuck on Asking, a new End task can start", e.s === "failed" && (step({ t: "start", p: brave }), e.s === "ask"));
e = { s: "idle" }; step({ t: "start", p: brave }); step({ t: "confirm" }); step({ t: "ended", pid: 10, ok: true, alive: true }); step({ t: "confirm" }); step({ t: "timeout" });
ok("no answer to a force quit: failed", e.s === "failed");
e = { s: "idle" }; step({ t: "start", p: brave }); step({ t: "timeout" });
ok("a late timeout at the question changes nothing", e.s === "ask");
const sysP = procs.find((p) => p.pid === 50)!, psP = procs.find((p) => p.pid === 60)!;
ok("never offered for macOS's own processes", !canEnd(sysP) && (e = { s: "idle" }, step({ t: "start", p: sysP }) === null && e.s === "idle"));
ok("never offered for PS", !canEnd(psP) && (e = { s: "idle" }, step({ t: "start", p: psP }), e.s === "idle"));
ok("never offered when PS said no", !canEnd({ ...brave, end: false }));
ok("never for a protected name, even if a row slipped through", !canEnd({ ...brave, n: "1Password" }) && !canEnd({ ...brave, id: "org.whispersystems.signal-desktop" }));
ok("a background process of the person's own can be ended", canEnd(procs.find((p) => p.pid === 30)!));

// ---- graphs
let ser: number[] = [];
for (let i = 0; i < 70; i++) ser = pushPoint(ser, i);
ok("a graph keeps the last 60 points", ser.length === 60 && ser[0] === 10 && ser[59] === 69);
ok("a bad value draws as 0", pushPoint([], Number.NaN)[0] === 0 && pushPoint([], -5)[0] === 0);
const g = graphPaths([0, 50, 100], 590, 100, 100);
ok("the newest point is at the right edge, the top is the max", g.line.endsWith("L590.0 1.0") && g.step === 10);
ok("the area closes along the bottom", g.area.endsWith("Z") && g.area.includes("L590.0 100"));
ok("one point is not a line yet", graphPaths([3], 100, 50, 10).line === "");
ok("a nice top above the busiest point", niceMax([0, 3.2]) === 5 && niceMax([0, 120]) === 200 && niceMax([]) === 1 && niceMax([0, 0], 1e3) === 1e3);
ok("numbers ease out from where they were", easeAt(0, 100, 0) === 0 && easeAt(0, 100, 1) === 100 && easeAt(0, 100, 0.5) > 50 && easeAt(10, 0, 2) === 0);

// ---- formats
ok("bytes read plainly", bytes(0) === "0 B" && bytes(999) === "999 B" && bytes(1500) === "1.5 KB" && bytes(2.5e9) === "2.5 GB" && bytes(250e6) === "250 MB");
ok("memory counts in 1024s like macOS (16 GB, not 17.2)", mem(16 * 2 ** 30) === "16.0 GB" && mem(512 * 2 ** 20) === "512 MB" && bytes(16 * 2 ** 30) === "17.2 GB");
ok("rates", rate(-1) === "-" && rate(0) === "0 B/s" && rate(1.2e6) === "1.2 MB/s");
ok("percent", pct(0) === "0%" && pct(3.25) === "3.3%" && pct(42.6) === "43%" && pct(Number.NaN) === "0%");
ok("watts", watts(0) === "0 W" && watts(0.05) === "< 0.1 W" && watts(2.345) === "2.3 W" && watts(14.4) === "14 W");
ok("durations", duration(30) === "30 s" && duration(45 * 60) === "45 min" && duration(2 * 3600 + 5 * 60) === "2 h 5 min" && duration(3 * 86400 + 4 * 3600) === "3 days 4 h" && duration(86400) === "1 day");
ok("sampling speed: 0.5, 1 or 2 seconds, else 1", cleanSpeed(0.5) === 0.5 && cleanSpeed(2) === 2 && cleanSpeed(5) === 1 && cleanSpeed("fast") === 1);

// ---- Performance list
const snap: Snap = {
  kind: "snap", at: 0, dt: 1, cpu: { t: 23, u: 15, s: 8, cores: [10, 20], kinds: ["e", "p"], name: "Sample chip", up: 100, procs: 600, thr: 3000 },
  mem: { total: 16e9, used: 8e9, app: 5e9, wired: 2e9, comp: 1e9, cached: 3e9, free: 5e9, swap: 0, swapT: 0, press: "normal" },
  disk: { r: 1e6, w: 2e6, act: 4, vols: [] }, net: { on: true, ifs: [{ n: "en0", l: "Wi-Fi", k: "wifi", rx: 1e5, tx: 1e4 }, { n: "utun4", l: "VPN", k: "vpn", rx: 9e4, tx: 9e3 }] },
  gpu: { u: null, name: "" }, bat: null, rows: [], meta: {}, gone: [], self: { ms: 2, cpu: 0.3 },
};
const items = perfItems(snap);
ok("Performance lists CPU, Memory, Disk, each network (the VPN too) and GPU", JSON.stringify(items.map((i) => i.id)) === JSON.stringify(["cpu", "mem", "disk", "net:en0", "net:utun4", "gpu"]));
ok("no battery on a Mac without one; a GPU that says nothing is said plainly", !items.some((i) => i.id === "bat") && items.find((i) => i.id === "gpu")!.sub === "Not shared");
ok("a Mac with a battery lists it", perfItems({ ...snap, bat: { pct: 76, charging: true, ac: true } }).some((i) => i.id === "bat" && i.sub === "76%, charging"));

// ---- App history
const screen = new Map([["2026-11-17", { apps: [{ id: "com.example.browser", name: "Sample Browser", secs: 3600 }, { id: "com.1password.1password", name: "1Password", secs: 999 }] }],
                        ["2026-11-16", { apps: [{ id: "com.example.browser", name: "Sample Browser", secs: 1800 }] }]]);
const hist = { days: ["2026-11-17", "2026-11-16"], cpu: { "2026-11-17": [{ id: "com.example.browser", name: "Sample Browser", secs: 120 }, { id: "", name: "syncagent", secs: 30 }, { id: "x", name: "Signal", secs: 9 }] },
               net: { "2026-11-17": { "Sample Browser": [4e8, 3e7] as [number, number], "Signal": [1, 1] as [number, number], "curl": [5e5, 1e4] as [number, number] } } };
const today = historyRows(["2026-11-17"], screen, hist);
ok("history joins screen time and CPU time by bundle id, network by name", today[0].name === "Sample Browser" && today[0].front === 3600 && today[0].cpu === 120 && today[0].rx === 4e8);
ok("1Password and Signal never appear in App history", !today.some((r) => /1password|signal/i.test(r.name)));
ok("an app with only network gets its own line", today.some((r) => r.name === "curl" && r.rx === 5e5));
ok("busiest CPU first", today[0].cpu >= today[1].cpu);
ok("the week adds the days up", historyRows(["2026-11-17", "2026-11-16"], screen, hist)[0].front === 5400);
ok("no history from the Mac yet: screen time still shows", historyRows(["2026-11-17"], screen, null)[0].front === 3600);

// ---- Startup apps
const st = startupRows([{ label: "com.example.sync", name: "Sample Sync", id: "com.example.sync", folder: "user", run: true, keep: true, off: false },
                        { label: "com.1password.helper", name: "1Password", id: "", folder: "user", run: true, keep: false, off: false },
                        { label: "org.example.old", name: "Old Thing", id: "", folder: "mac", run: true, keep: false, off: true }, { bad: true }, null]);
ok("startup items: protected dropped, broken dropped, switched off ones last", st.length === 2 && st[0].name === "Sample Sync" && st[1].off);
ok("startup items from a bad message: none", startupRows("nope").length === 0);

// ---- the burst out of the island
ok("the island's box from its place", JSON.stringify(islandBox({ x: 700, bottom: 30, w: 200, h: 32 })) === JSON.stringify({ left: 600, top: -2, width: 200, height: 32 }));
ok("no place, or a broken one: no box (the window grows from its button)", islandBox(null) === null && islandBox({ x: 1 }) === null && islandBox({ x: 1, bottom: 2, w: 3 }) === null);

// ---- the burst keyframes
const WIN = { left: 29, top: 20, width: 1382, height: 860 }, ISL = { left: 622, top: 0, width: 196, height: 32 };
const bf = burstFrames(WIN, ISL, "in");
const parse = (f: { transform: string }) => f.transform.match(/-?[\d.]+/g)!.map(Number);
const [tx0, ty0, sx0, sy0] = parse(bf[0]);
ok("the burst starts exactly on the island", Math.abs(WIN.left + tx0 - ISL.left) < 0.05 && Math.abs(WIN.top + ty0 - ISL.top) < 0.05 && Math.abs(sx0 * WIN.width - ISL.width) < 0.2 && Math.abs(sy0 * WIN.height - ISL.height) < 0.2);
const [txN, tyN, sxN, syN] = parse(bf[bf.length - 1]);
ok("and ends exactly as the window", Math.abs(txN) < 0.01 && Math.abs(tyN) < 0.01 && Math.abs(sxN - 1) < 0.0001 && Math.abs(syN - 1) < 0.0001);
const mid = bf.find((f) => Math.abs(f.offset - 0.36) < 0.02)!;
const [, tyM, sxM, syM] = parse(mid);
ok("first it stretches sideways, still attached at the top, before it unfolds", sxM * WIN.width > ISL.width * 3 && syM * WIN.height < ISL.height * 2 && Math.abs(WIN.top + tyM - ISL.top) < 0.05);
ok("offsets run 0 to 1 in order, every number finite", bf.every((f, i) => i === 0 || f.offset > bf[i - 1].offset) && bf[bf.length - 1].offset === 1 && bf.every((f) => parse(f).every(Number.isFinite)));
const fold = burstFrames(WIN, ISL, "out");
ok("folding back is the same path backwards", fold[0].transform === bf[bf.length - 1].transform && fold[fold.length - 1].transform === bf[0].transform && fold[fold.length - 1].offset === 1);

// ---- sounds and words
ok("four short quiet sounds", Object.keys(AM_SOUNDS).length === 4 && Object.values(AM_SOUNDS).flat().every((t) => t.peak <= 0.12 && t.dur <= 0.3));
const mac = readFileSync(new URL("../../mac/Sources/Sfx.swift", import.meta.url), "utf8");
ok("the Mac plays the same sounds by name", Object.keys(AM_SOUNDS).every((k) => mac.includes(`"${k}"`)));
const words = JSON.stringify(AM_WORDS) + JSON.stringify(COLUMNS);
ok("no dashes in any word", !/[–—]/.test(words));
ok("never called Task Manager on screen", !/task manager/i.test(words));
ok("the End task question is the one the developer asked for", endWords({ s: "ask", pid: 1, st: 1, name: "Brave" })!.line === "End Brave? Unsaved work may be lost.");


// ---- the registries: the switch, the intro folded into the 1.65 tour, the feature entry
const features = JSON.parse(readFileSync(new URL("../../features.json", import.meta.url), "utf8")) as { features: { id: string; owner: string; scope: string; since: string; default: string; parts: string[] }[] };
const f = features.features.find((x) => x.id === "activity-monitor");
ok("features.json: Activity monitor, by jan, shared, since 1.65, on, web and mac", !!f && f.owner === "jan" && f.scope === "shared" && f.since === "1.65" && f.default === "on" && f.parts.includes("mac"));
const featuresMd = readFileSync(new URL("../../FEATURES.md", import.meta.url), "utf8");
ok("FEATURES.md has its line with the switch", /\| Activity monitor \|.*Settings, Mac, "Activity monitor"/.test(featuresMd));
const { INTROS } = await import("../src/core/featureintro.ts");
const { TOUR_FOLDS, TOUR_STEPS } = await import("../src/core/tour.ts");
ok("an island intro exists and is folded into the 1.65 tour", INTROS.some((d) => d.id === "activity-monitor-165") && TOUR_FOLDS.includes("activity-monitor-165"));
ok("the tour has a Mac only step for it", TOUR_STEPS.some((st) => st.ids.includes("activity-monitor") && st.on?.length === 1 && st.on[0] === "mac"));
const { SETTINGS } = await import("../src/core/settingsindex.ts");
ok("Settings, Mac, Activity monitor exists", SETTINGS.some((x) => x.id === "activity" && x.group === "mac" && x.name === AM_WORDS.setting.name));
const tm = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
ok("the button sits as a Slot right after Network", /<Slot id="net"><NetButton \/><\/Slot>\}\n\s*\{activityOn && !docked && <Slot id="activity"><ActivityButton/.test(tm));
ok("the button is gated by the feature and the person's switch", /feature\(ACTIVITY_FEATURE\) && st\.activityMonitor !== false/.test(tm));

// ---- Esc, Reduce Motion, clicks only (source checks: the window itself is drawn by React)
const view = readFileSync(new URL("../src/views/ActivityMonitor.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/views/activitymonitor.css", import.meta.url), "utf8");
ok("Esc closes it (the key and PS's own Esc hook), a pop up inside first", /e\.key === "Escape"/.test(view) && /__psDimxClose = escape/.test(view) && /if \(inner\.current\(\)\) return true; close\(\)/.test(view));
ok("it opens on a click only, never on hover", /onClick=\{\(e\) => \{ if \(e\.button === 0\) click\(\); \}\}/.test(view) && !/onMouseEnter=\{[^}]*open/.test(view) && !/onPointerEnter=\{[^}]*open/.test(view));
ok("Reduce Motion turns the glides, slides and drawing in off", /@media \(prefers-reduced-motion: reduce\)/.test(css) && /\.am-tr, \.am-sec/.test(css.slice(css.indexOf("prefers-reduced-motion"))) && /reduced\(\)/.test(view));
ok("nothing animates forever (no infinite animation but the small wait spinner)", (css.match(/infinite/g) || []).length === 2 && /am-spin \.9s linear infinite/.test(css) && /am-breathe 1\.2s ease-in-out infinite/.test(css));
ok("the moving stripe of the shared window style is stopped here", /\.am-win::before \{ animation: none;/.test(css));

console.log(fails ? `${fails} of ${n} FAILED` : `all ${n} passed`);
process.exit(fails ? 1 : 0);
