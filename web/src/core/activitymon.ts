// Activity monitor (PS 1.65, the developer's request of 17 Nov 2026): the page's pure rules. The Mac reads the numbers
// (mac/Sources/ActivityMonitor.swift, its rules in ActivityCore.swift) and hands them over only while the screen is open;
// this file turns them into what views/ActivityMonitor.tsx draws: the process table (grouping, sorting, search, heat), the
// End task steps, the graphs' paths, App history and the words. No React, no DOM, no clock: tests/activitymon.test.ts checks it.
//
// GOLDEN RULE, checked again here: a row, a startup item or a history line that names 1Password or Signal is dropped before
// anything else looks at it (PS on the Mac already dropped them at its first read). Only the whole Mac totals include them.
import { isProtectedApp } from "./protected.ts";
import type { EditTone } from "./editsounds.ts";

export const ACTIVITY_FEATURE = "activity-monitor";

// ---------- what PS on the Mac sends ----------
/** One row's live numbers: pid, CPU % of the whole Mac, memory bytes, disk read and write per second, network received and
 *  sent per second (-1: not known), power in watts, threads. */
export type RowNums = [number, number, number, number, number, number, number, number, number];
/** What a row is (sent only when new or changed): name, bundle id (for the icon), the row it folds under (0: none), a Dock app,
 *  macOS's own, may be ended, is PS, start time (ms). */
export type Meta = { n: string; id: string; g: number; app: boolean; sys: boolean; end: boolean; ps?: boolean; st: number };
export type CpuInfo = { t: number; u: number; s: number; cores: number[]; kinds: string[]; name: string; up: number; procs: number; thr: number };
export type MemInfo = { total: number; used: number; app: number; wired: number; comp: number; cached: number; free: number; swap: number; swapT: number; press: "normal" | "warn" | "critical" };
export type DiskInfo = { r: number; w: number; act: number | null; vols: { n: string; total: number; free: number }[] };
export type Iface = { n: string; l: string; k: string; rx: number; tx: number };
export type NetInfo = { on: boolean; ifs: Iface[] };
export type GpuInfo = { u: number | null; name: string };
export type BatInfo = { pct: number; charging: boolean; ac: boolean; health?: number | null; cycles?: number | null; mins?: number | null; watts?: number | null };
export type Snap = {
  kind: "snap"; at: number; dt: number; fake?: boolean;
  cpu: CpuInfo; mem: MemInfo; disk: DiskInfo; net: NetInfo; gpu: GpuInfo; bat: BatInfo | null;
  rows: RowNums[]; meta: Record<string, Meta>; gone: number[]; self: { ms: number; cpu: number };
};

/** One process as the table uses it. */
export interface Proc extends Meta { pid: number; cpu: number; mem: number; dr: number; dw: number; nr: number; nt: number; w: number; thr: number }

/** The page's memory of what each pid is: merged from every snapshot's `meta`, emptied of gone pids. */
export type MetaMap = Map<number, Meta>;

/** Merge one snapshot into the known rows: new meta in, gone pids out, protected names dropped (the second check). */
export function applySnap(known: MetaMap, snap: Pick<Snap, "rows" | "meta" | "gone">): { known: MetaMap; procs: Proc[] } {
  const next = new Map(known);
  for (const [k, m] of Object.entries(snap.meta || {})) {
    const pid = Number(k);
    if (!Number.isFinite(pid) || !m || typeof m.n !== "string") continue;
    if (isProtectedApp(m.n) || isProtectedApp(m.id || "")) { next.delete(pid); continue; }
    next.set(pid, { n: m.n.slice(0, 120), id: String(m.id || "").slice(0, 200), g: Number(m.g) || 0, app: !!m.app, sys: !!m.sys, end: !!m.end, ps: !!m.ps, st: Number(m.st) || 0 });
  }
  for (const pid of snap.gone || []) next.delete(pid);
  const procs: Proc[] = [];
  for (const r of snap.rows || []) {
    if (!Array.isArray(r) || r.length < 9) continue;
    const m = next.get(r[0]);
    if (!m) continue;
    procs.push({ ...m, pid: r[0], cpu: r[1], mem: r[2], dr: r[3], dw: r[4], nr: r[5], nt: r[6], w: r[7], thr: r[8] });
  }
  return { known: next, procs };
}

// ---------- columns, sorting, grouping ----------
export type Col = "name" | "cpu" | "mem" | "disk" | "net" | "energy" | "threads" | "pid";
export const COLUMNS: { id: Col; label: string; on: boolean }[] = [
  { id: "name", label: "Name", on: true },
  { id: "cpu", label: "CPU", on: true },
  { id: "mem", label: "Memory", on: true },
  { id: "disk", label: "Disk", on: true },
  { id: "net", label: "Network", on: true },
  { id: "energy", label: "Energy", on: true },
  { id: "threads", label: "Threads", on: false },
  { id: "pid", label: "Process ID", on: false },
];
/** The columns to show (Name always), in their fixed order. Anything unknown is dropped; nothing saved gives the defaults. */
export function cleanCols(v: unknown): Col[] {
  if (!Array.isArray(v)) return COLUMNS.filter((c) => c.on).map((c) => c.id);
  const want = new Set(v.filter((x): x is string => typeof x === "string"));
  want.add("name");
  return COLUMNS.filter((c) => want.has(c.id)).map((c) => c.id);
}
export type Sort = { col: Col; dir: 1 | -1 };
export const DEFAULT_SORT: Sort = { col: "cpu", dir: -1 };
/** A click on a header: the same column flips, a new one starts busiest first (names A to Z). */
export function nextSort(cur: Sort, col: Col): Sort {
  if (cur.col === col) return { col, dir: cur.dir === 1 ? -1 : 1 };
  return { col, dir: col === "name" ? 1 : -1 };
}

/** The numbers a row adds up (its own plus its helpers'). */
export type Sums = { cpu: number; mem: number; disk: number; net: number | null; w: number; thr: number };
const sumOf = (ps: Proc[]): Sums => {
  let cpu = 0, mem = 0, disk = 0, net = 0, w = 0, thr = 0, known = false;
  for (const p of ps) {
    cpu += p.cpu; mem += p.mem; disk += p.dr + p.dw; w += p.w; thr += p.thr;
    if (p.nr >= 0 && p.nt >= 0) { net += p.nr + p.nt; known = true; }
  }
  return { cpu, mem, disk, net: known ? net : null, w, thr };
};

export type Line =
  | { kind: "head"; key: string; label: string; count: number }
  | { kind: "row"; key: string; p: Proc; depth: 0 | 1; kids: number; open: boolean; sums: Sums; top: number };

export const SECTION = { apps: "Apps", bg: "Background processes" } as const;

/** The table's lines: "Apps" (Dock apps) then "Background processes", each row with its helpers folded under it (a chevron
 *  opens them), the group total on the parent row. Sorted inside each section by the group totals; the search keeps a group
 *  when its name or any helper's name matches, and opens it when only a helper matched. Protected names never get here. */
/** Two numbers this close (15%, or under a small floor) count as the same for the order: rows that were already in this order on
 *  screen (`prev`) stay put, so a row does not jump on every small wobble. A clear difference still reorders at once. */
const FLOOR: Record<Col, number> = { name: 0, cpu: 0.3, mem: 5e6, disk: 5e3, net: 5e3, energy: 0.03, threads: 1, pid: 0 };
export const close = (col: Col, a: number, b: number) => Math.abs(a - b) <= Math.max(FLOOR[col], 0.15 * Math.max(Math.abs(a), Math.abs(b)));
/** After a strict sort: put back pairs the person saw the other way round when their numbers are close. Deterministic, at most n passes. */
export function settle<T>(list: T[], key: (t: T) => string, value: (t: T) => number, col: Col, prev?: ReadonlyMap<string, number>): T[] {
  if (!prev || !prev.size || col === "name" || col === "pid") return list;
  const out = list.slice();
  for (let pass = 0; pass < out.length; pass++) {
    let moved = false;
    for (let i = 0; i + 1 < out.length; i++) {
      const pa = prev.get(key(out[i])), pb = prev.get(key(out[i + 1]));
      if (pa == null || pb == null || pb > pa || !close(col, value(out[i]), value(out[i + 1]))) continue;
      [out[i], out[i + 1]] = [out[i + 1], out[i]]; moved = true;
    }
    if (!moved) break;
  }
  return out;
}
export function tableLines(procs: Proc[], o: { sort: Sort; search: string; open: ReadonlySet<number>; prev?: ReadonlyMap<string, number> }): Line[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map<number, Proc[]>();
  const tops: Proc[] = [];
  for (const p of procs) {
    if (isProtectedApp(p.n) || isProtectedApp(p.id)) continue;
    if (p.g && p.g !== p.pid && byPid.has(p.g)) { const l = kids.get(p.g) || []; l.push(p); kids.set(p.g, l); }
    else tops.push(p);
  }
  const q = o.search.trim().toLowerCase();
  const hit = (p: Proc) => !q || p.n.toLowerCase().includes(q) || String(p.pid) === q;
  type G = { p: Proc; kids: Proc[]; sums: Sums; open: boolean };
  const groups: G[] = [];
  for (const p of tops) {
    const k = (kids.get(p.pid) || []).slice();
    const selfHit = hit(p), kidHit = k.some(hit);
    if (!selfHit && !kidHit) continue;
    groups.push({ p, kids: k, sums: sumOf([p, ...k]), open: o.open.has(p.pid) || (!!q && !selfHit && kidHit) });
  }
  const val = (g: { p: Proc; sums: Sums }): number | string => {
    switch (o.sort.col) {
      case "name": return g.p.n.toLowerCase();
      case "cpu": return g.sums.cpu;
      case "mem": return g.sums.mem;
      case "disk": return g.sums.disk;
      case "net": return g.sums.net ?? -1;
      case "energy": return g.sums.w;
      case "threads": return g.sums.thr;
      case "pid": return g.p.pid;
    }
  };
  const cmp = (a: { p: Proc; sums: Sums }, b: { p: Proc; sums: Sums }) => {
    const x = val(a), y = val(b);
    const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
    return c !== 0 ? c * o.sort.dir : a.p.n.localeCompare(b.p.n) || a.p.pid - b.p.pid;
  };
  const sorted = <T extends { p: Proc; sums: Sums }>(l: T[]) => settle([...l].sort(cmp), (g) => `p:${g.p.pid}`, (g) => val(g) as number, o.sort.col, o.prev);
  const out: Line[] = [];
  for (const [label, list] of [[SECTION.apps, groups.filter((g) => g.p.app)], [SECTION.bg, groups.filter((g) => !g.p.app)]] as const) {
    if (!list.length) continue;
    out.push({ kind: "head", key: `h:${label}`, label, count: list.length });
    for (const g of sorted(list)) {
      out.push({ kind: "row", key: `p:${g.p.pid}`, p: g.p, depth: 0, kids: g.kids.length, open: g.open, sums: g.sums, top: g.p.pid });
      if (g.open) {
        const ks = sorted(g.kids.map((k) => ({ p: k, sums: sumOf([k]) })));
        for (const k of ks) out.push({ kind: "row", key: `p:${k.p.pid}`, p: k.p, depth: 1, kids: 0, open: false, sums: k.sums, top: g.p.pid });
      }
    }
  }
  return out;
}

/** While the pointer is over the table the rows hold still (the developer: "pause reordering while the pointer is over the
 *  table"): the old order is kept, rows that are gone leave, new ones join at the end of their place. */
export function holdOrder(prev: readonly string[], next: readonly string[]): string[] {
  const now = new Set(next);
  const kept = prev.filter((k) => now.has(k));
  const had = new Set(kept);
  const out = kept.slice();
  for (let i = 0; i < next.length; i++) {
    const k = next[i];
    if (had.has(k)) continue;
    // a new line goes right after the line that comes before it in the new order (its section head, or its parent)
    const before = i > 0 ? out.indexOf(next[i - 1]) : -1;
    out.splice(before + 1, 0, k);
    had.add(k);
  }
  return out;
}

// ---------- heat (how busy a cell is, 0 calm to 5 very busy) ----------
const STEPS: Record<"cpu" | "mem" | "disk" | "net" | "energy", number[]> = {
  cpu: [0.5, 3, 10, 25, 50],                          // percent of the whole Mac
  mem: [100e6, 400e6, 1e9, 2e9, 4e9],                 // bytes
  disk: [100e3, 1e6, 8e6, 30e6, 100e6],               // bytes a second
  net: [10e3, 100e3, 1e6, 5e6, 20e6],                 // bytes a second
  energy: [0.05, 0.3, 1, 3, 8],                       // watts
};
export function heat(col: keyof typeof STEPS, v: number | null): 0 | 1 | 2 | 3 | 4 | 5 {
  if (v == null || !Number.isFinite(v) || v <= 0) return 0;
  const s = STEPS[col];
  let n = 0;
  for (const x of s) if (v >= x) n++;
  return n as 0 | 1 | 2 | 3 | 4 | 5;
}

// ---------- End task: ask first, a normal quit, a force quit only after a second click ----------
export type EndState =
  | { s: "idle" }
  | { s: "ask"; pid: number; st: number; name: string }
  | { s: "quitting"; pid: number; st: number; name: string }
  | { s: "stuck"; pid: number; st: number; name: string }
  | { s: "forcing"; pid: number; st: number; name: string }
  | { s: "done"; pid: number; name: string }
  | { s: "failed"; pid: number; name: string };
export type EndEvent =
  | { t: "start"; p: Proc }
  | { t: "confirm" }
  | { t: "cancel" }
  | { t: "ended"; pid: number; ok: boolean; alive: boolean };
/** What the Mac is asked to do after an event, if anything. */
export type EndSend = { pid: number; st: number; step: "quit" | "force" } | null;

/** May the page offer End task on this row? Only rows PS said may be ended, never macOS's own, PS or a protected app. */
export const canEnd = (p: Pick<Proc, "end" | "sys" | "ps" | "n" | "id">) => p.end && !p.sys && !p.ps && !isProtectedApp(p.n) && !isProtectedApp(p.id);

export function endStep(cur: EndState, e: EndEvent): { next: EndState; send: EndSend } {
  const keep = { next: cur, send: null };
  switch (e.t) {
    case "start":
      if (!canEnd(e.p) || (cur.s !== "idle" && cur.s !== "done" && cur.s !== "failed")) return keep;
      return { next: { s: "ask", pid: e.p.pid, st: e.p.st, name: e.p.n }, send: null };
    case "cancel":
      return cur.s === "ask" || cur.s === "stuck" || cur.s === "done" || cur.s === "failed" ? { next: { s: "idle" }, send: null } : keep;
    case "confirm":
      if (cur.s === "ask") return { next: { ...cur, s: "quitting" }, send: { pid: cur.pid, st: cur.st, step: "quit" } };
      if (cur.s === "stuck") return { next: { ...cur, s: "forcing" }, send: { pid: cur.pid, st: cur.st, step: "force" } };
      return keep;
    case "ended":
      if ((cur.s !== "quitting" && cur.s !== "forcing") || e.pid !== cur.pid) return keep;
      if (!e.ok) return { next: { s: "failed", pid: cur.pid, name: cur.name }, send: null };
      if (!e.alive) return { next: { s: "done", pid: cur.pid, name: cur.name }, send: null };
      return cur.s === "quitting" ? { next: { ...cur, s: "stuck" }, send: null } : { next: { s: "failed", pid: cur.pid, name: cur.name }, send: null };
  }
}
/** The confirm strip's words for each step (null: nothing to show). */
export function endWords(e: EndState): { line: string; button?: string; tone: "ask" | "warn" | "busy" | "good" | "bad" } | null {
  switch (e.s) {
    case "idle": return null;
    case "ask": return { line: `End ${e.name}? Unsaved work may be lost.`, button: "End task", tone: "ask" };
    case "quitting": return { line: `Asking ${e.name} to quit...`, tone: "busy" };
    case "stuck": return { line: `${e.name} is still open. It may be asking to save. Force quit it?`, button: "Force quit", tone: "warn" };
    case "forcing": return { line: `Force quitting ${e.name}...`, tone: "busy" };
    case "done": return { line: `${e.name} ended.`, tone: "good" };
    case "failed": return { line: `${e.name} could not be ended.`, tone: "bad" };
  }
}

// ---------- graphs ----------
export const GRAPH_POINTS = 60;
/** Add a value to a graph's series, keeping the last `max`. Returns a new array. */
export function pushPoint(series: readonly number[], v: number, max = GRAPH_POINTS): number[] {
  const out = series.length >= max ? series.slice(series.length - max + 1) : series.slice();
  out.push(Number.isFinite(v) ? Math.max(0, v) : 0);
  return out;
}
/** A graph's line and filled area as SVG paths, `w` by `h`, the newest point at the right edge, `max` at the top. The points
 *  sit `w / (points - 1)` apart; the view slides the whole drawing left by one step per sample (a transform, no redraw between). */
export function graphPaths(series: readonly number[], w: number, h: number, max: number, points = GRAPH_POINTS): { line: string; area: string; step: number } {
  const step = w / (points - 1);
  if (series.length < 2 || max <= 0) return { line: "", area: "", step };
  const x0 = w - (series.length - 1) * step;
  const y = (v: number) => (h - Math.min(1, v / max) * (h - 2) - 1).toFixed(1);
  let line = "";
  series.forEach((v, i) => { line += `${i ? "L" : "M"}${(x0 + i * step).toFixed(1)} ${y(v)}`; });
  const area = `${line}L${w.toFixed(1)} ${h}L${x0.toFixed(1)} ${h}Z`;
  return { line, area, step };
}
/** A tidy top for a graph of rates: the next 1, 2 or 5 step above the busiest point (never 0). */
export function niceMax(series: readonly number[], floor = 1): number {
  const m = Math.max(floor, ...series);
  const p = 10 ** Math.floor(Math.log10(m));
  for (const k of [1, 2, 5, 10]) if (k * p >= m) return k * p;
  return 10 * p;
}

// ---------- numbers easing ----------
/** Ease out (cubic). */
export const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
/** Where an easing number is `t` (0 to 1) of the way from `from` to `to`. */
export const easeAt = (from: number, to: number, t: number) => from + (to - from) * easeOut(t);

// ---------- words and formats ----------
/** Sizes and rates count in thousands (as Finder does); memory counts in 1024s (as macOS shows memory: 16 GB, not 17.2). */
export function bytes(n: number, base: 1000 | 1024 = 1000): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= (base === 1024 ? 1000 : base) && i < u.length - 1) { v /= base; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
export const mem = (n: number) => bytes(n, 1024);
export const rate = (n: number) => (n < 0 ? "-" : n < 1 ? "0 B/s" : `${bytes(n)}/s`);
export const pct = (n: number) => `${!Number.isFinite(n) || n < 0 ? 0 : n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`;
export const watts = (n: number) => (n <= 0 ? "0 W" : n < 0.1 ? "< 0.1 W" : `${n < 10 ? n.toFixed(1) : Math.round(n)} W`);
/** "3 days 4 h", "2 h 5 min", "45 min", "30 s". */
export function duration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} day${d > 1 ? "s" : ""}${h ? ` ${h} h` : ""}`;
  if (h) return `${h} h${m ? ` ${m} min` : ""}`;
  if (m) return `${m} min`;
  return `${s} s`;
}
export const PRESSURE_WORD: Record<MemInfo["press"], string> = { normal: "Fine", warn: "Tight", critical: "Very tight" };

/** The sampling speeds the person can pick (seconds). */
export const SPEEDS = [0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];
export const cleanSpeed = (v: unknown): Speed => (SPEEDS as readonly number[]).includes(v as number) ? (v as Speed) : 1;

// ---------- the Performance list ----------
export type PerfId = "cpu" | "mem" | "disk" | "gpu" | "bat" | `net:${string}`;
export type PerfItem = { id: PerfId; title: string; sub: string; value: number; max: number };
/** The left list of Performance: CPU, Memory, Disk, one Network per interface (the VPN tunnel too), GPU, Battery (only on a Mac with one). */
export function perfItems(s: Snap): PerfItem[] {
  const out: PerfItem[] = [
    { id: "cpu", title: "CPU", sub: pct(s.cpu.t), value: s.cpu.t, max: 100 },
    { id: "mem", title: "Memory", sub: `${mem(s.mem.used)} of ${mem(s.mem.total)}`, value: s.mem.total ? (s.mem.used / s.mem.total) * 100 : 0, max: 100 },
    { id: "disk", title: "Disk", sub: `${rate(s.disk.r + s.disk.w)}`, value: s.disk.r + s.disk.w, max: 0 },
  ];
  for (const i of s.net.ifs) out.push({ id: `net:${i.n}`, title: i.k === "vpn" ? "VPN" : i.l || i.n, sub: `${i.n} · ↓ ${rate(i.rx)}`, value: i.rx + i.tx, max: 0 });
  out.push({ id: "gpu", title: "GPU", sub: s.gpu.u == null ? "Not shared" : pct(s.gpu.u), value: s.gpu.u ?? 0, max: 100 });
  if (s.bat) out.push({ id: "bat", title: "Battery", sub: `${s.bat.pct}%${s.bat.charging ? ", charging" : ""}`, value: s.bat.pct, max: 100 });
  return out;
}

// ---------- App history ----------
export type HistoryMsg = { days: string[]; cpu: Record<string, { id: string; name: string; secs: number }[]>; net: Record<string, Record<string, [number, number]>>; fake?: boolean };
export type HistoryRow = { key: string; id: string; name: string; front: number; cpu: number; rx: number; tx: number };
/** One line per app over `days`: time in front (screen time), CPU time (PS's own minute tally) and network (the Network
 *  monitor's history). Screen time and CPU are joined by bundle id, network by app name. Busiest first. Protected never. */
export function historyRows(days: readonly string[], screen: Map<string, { apps: { id: string; name: string; secs: number }[] }>, h: HistoryMsg | null): HistoryRow[] {
  const rows = new Map<string, HistoryRow>();
  const byName = new Map<string, string>();
  const row = (id: string, name: string) => {
    const key = id || `name:${name}`;
    let r = rows.get(key);
    if (!r) { r = { key, id, name, front: 0, cpu: 0, rx: 0, tx: 0 }; rows.set(key, r); }
    byName.set(name.toLowerCase(), key);
    return r;
  };
  const bad = (id: string, name: string) => isProtectedApp(id) || isProtectedApp(name);
  for (const d of days) {
    for (const a of screen.get(d)?.apps || []) { if (!bad(a.id, a.name) && a.secs > 0) row(a.id, a.name).front += a.secs; }
    for (const a of h?.cpu[d] || []) { if (!bad(a.id, a.name) && a.secs > 0) row(a.id, a.name).cpu += a.secs; }
  }
  for (const d of days) {
    for (const [name, v] of Object.entries(h?.net[d] || {})) {
      if (bad("", name) || !Array.isArray(v)) continue;
      const key = byName.get(name.toLowerCase());
      const r = key ? rows.get(key)! : row("", name);
      r.rx += Math.max(0, Number(v[0]) || 0); r.tx += Math.max(0, Number(v[1]) || 0);
    }
  }
  return [...rows.values()].filter((r) => r.front > 0 || r.cpu > 0 || r.rx + r.tx > 0)
    .sort((a, b) => b.cpu - a.cpu || b.front - a.front || b.rx + b.tx - (a.rx + a.tx) || a.name.localeCompare(b.name));
}

// ---------- Startup apps ----------
export type StartupItem = { label: string; name: string; id: string; folder: "user" | "mac"; run: boolean; keep: boolean; off: boolean };
export function startupRows(items: unknown): StartupItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((x): x is StartupItem => !!x && typeof x.label === "string" && typeof x.name === "string")
    .filter((x) => !isProtectedApp(x.label) && !isProtectedApp(x.name) && !isProtectedApp(x.id || ""))
    .map((x) => ({ label: x.label.slice(0, 200), name: x.name.slice(0, 120), id: String(x.id || ""), folder: x.folder === "mac" ? "mac" as const : "user" as const, run: !!x.run, keep: !!x.keep, off: !!x.off }))
    .sort((a, b) => Number(a.off) - Number(b.off) || a.name.localeCompare(b.name));
}

// ---------- the burst out of the island ----------
export type Place = { x: number; bottom: number; w: number; h?: number };
/** The box the window starts from (and folds back into): the island's own shape, in the page's points. Bad numbers: null (the
 *  window then grows out of its button). */
export function islandBox(p: unknown): { left: number; top: number; width: number; height: number } | null {
  if (!p || typeof p !== "object") return null;
  const { x, bottom, w, h } = p as Place;
  if (![x, bottom, w].every((n) => typeof n === "number" && Number.isFinite(n)) || w < 20) return null;
  const height = typeof h === "number" && Number.isFinite(h) && h > 8 ? h : 32;
  return { left: x - w / 2, top: bottom - height, width: w, height };
}

/** The burst's keyframes (the developer: "the island stretches into a glowing frame that unfolds into the full window"). Two parts:
 *  first the island's black shape stretches sideways and only a little down (still attached at the top), then it unfolds into the
 *  window with a soft overshoot. `win`: the window's box, `isl`: the island's box. Transform only (plus round corners on the Mac),
 *  sampled along the curve; "out" is the same path backwards. Pure, so tests can hold its ends. */
export function burstFrames(win: { left: number; top: number; width: number; height: number }, isl: { left: number; top: number; width: number; height: number },
  dir: "in" | "out", radius = 26): { transform: string; borderRadius: string; offset: number }[] {
  const N = 32, split = 0.36, out: { transform: string; borderRadius: string; offset: number }[] = [];
  const back = (x: number) => { const c1 = 0.9, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
  const cx = isl.left + isl.width / 2;
  const midW = Math.max(isl.width, win.width * 0.56), midH = Math.max(isl.height, Math.min(win.height, isl.height * 1.7));
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    let w: number, h: number, left: number, top: number;
    if (t <= split) {
      const u = easeOut(t / split);
      w = isl.width + (midW - isl.width) * u; h = isl.height + (midH - isl.height) * u; left = cx - w / 2; top = isl.top;
    } else {
      const u = back((t - split) / (1 - split));
      w = midW + (win.width - midW) * u; h = midH + (win.height - midH) * u;
      left = (cx - midW / 2) + (win.left - (cx - midW / 2)) * u; top = isl.top + (win.top - isl.top) * u;
    }
    const sx = Math.max(0.001, w / win.width), sy = Math.max(0.001, h / win.height);
    const r = t <= split ? isl.height / 2 : isl.height / 2 + (radius - isl.height / 2) * Math.min(1, (t - split) / (1 - split));
    out.push({ transform: `translate(${(left - win.left).toFixed(2)}px, ${(top - win.top).toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
      borderRadius: `${(r / sx).toFixed(2)}px / ${(r / sy).toFixed(2)}px`, offset: t });
  }
  return dir === "in" ? out : out.reverse().map((f, i) => ({ ...f, offset: i / N }));
}

// ---------- sounds (short and quiet; the Tab list's sound volume in Settings, 0 is off) ----------
// The same numbers as mac/Sources/Sfx.swift "am-*" (PS plays them itself; the website plays these).
export const AM_SOUNDS: Record<"am-open" | "am-close" | "am-tab" | "am-end", EditTone[]> = {
  "am-open": [{ f: 900, to: 2400, dur: 0.26, peak: 0.05, wave: 3, at: 0 }, { f: 523.25, to: 784, dur: 0.16, peak: 0.06, wave: 0, at: 0.05 }, { f: 1568, dur: 0.22, peak: 0.035, wave: 0, at: 0.17 }],
  "am-close": [{ f: 2200, to: 700, dur: 0.24, peak: 0.045, wave: 3, at: 0 }, { f: 784, to: 440, dur: 0.18, peak: 0.05, wave: 0, at: 0.04 }],
  "am-tab": [{ f: 1760, to: 1480, dur: 0.03, peak: 0.04, wave: 1, at: 0 }],
  "am-end": [{ f: 330, to: 140, dur: 0.16, peak: 0.12, wave: 0, at: 0 }, { f: 1200, to: 600, dur: 0.06, peak: 0.03, wave: 1, at: 0.01 }],
};

// ---------- every word on screen (wait for the developer's approval) ----------
export const AM_WORDS = {
  button: "Open the activity monitor",
  buttonTitle: "Activity monitor (this Mac only)",
  eyebrow: "This Mac only",
  title: "Activity",
  close: "Back to the Tab list (Esc)",
  tabs: { procs: "Processes", perf: "Performance", history: "App history", startup: "Startup apps" },
  reading: "Reading this Mac...",
  thru: "Nothing here leaves this Mac",
  selfCost: (ms: number, cpu: number) => `This screen costs ${pct(cpu)} CPU, ${ms.toFixed(1)} ms a sample`,
  speed: "Update every",
  speedNames: { 0.5: "0.5 s", 1: "1 s", 2: "2 s" } as Record<Speed, string>,
  search: "Search processes",
  columns: "Columns",
  endTask: "End task",
  cancel: "Cancel",
  cannotEnd: "macOS and PS processes cannot be ended here",
  helpers: (n: number) => `${n} helper${n === 1 ? "" : "s"}`,
  noMatch: "No process matches.",
  netOff: "Network numbers need the Network monitor switched on",
  sys: "macOS",
  you: "PS",
  cpu: { util: "Utilisation", user: "Apps", system: "macOS", up: "Up for", procs: "Processes", threads: "Threads in your apps", cores: "Cores",
    e: "Efficiency", p: "Performance", perCore: "Each core" },
  mem: { used: "Used", app: "App memory", wired: "Kept by macOS", comp: "Compressed", cached: "Cached files", free: "Free", swap: "Swap used", pressure: "Memory pressure", of: "of" },
  disk: { read: "Read", write: "Write", active: "Active time", noActive: "macOS does not share it", vols: "Disks", free: (f: string) => `${f} free` },
  net: { rx: "Received", tx: "Sent", vpn: "VPN tunnel" },
  gpu: { util: "Utilisation", none: "macOS does not share the GPU's load on this Mac." },
  bat: { charge: "Charge", charging: "Charging", onBattery: "On battery", plugged: "Plugged in", health: "Health", cycles: "Charge cycles", left: "Time left", toFull: "Until full",
    draw: "Power draw", unknown: "Working it out" },
  history: { today: "Today", week: "Last 7 days", app: "App", front: "Time in front", cpu: "CPU time", net: "Network",
    none: "Nothing counted yet. CPU time is counted once a minute while PS runs and screen time is on.",
    note: "Time in front comes from screen time. CPU time is counted once a minute while PS runs. Network counts while the Network or Activity monitor is open." },
  startup: { name: "App", runs: "Starts", atLogin: "At login", kept: "Kept running", off: "Off", folder: "For", user: "You", mac: "Everyone on this Mac",
    hidden: "macOS keeps the apps under Open at Login to itself, so they are not listed here.", open: "Open Login Items", none: "No launch agents found." },
  intro: { headline: "New: the Activity monitor.", ask: "See what your Mac is doing: the chart button next to Network in the Tab list.", show: "Ok" },
  tour: { title: "Activity monitor", line: "See what your Mac is doing, live, and end a stuck app.", where: "The chart button next to Network, top right of the Tab list. Switch: Settings, Mac, Activity monitor" },
  setting: { name: "Activity monitor", line: "The chart button: what your Mac is doing, live.", on: "On", off: "Off",
    noteOn: "On: the chart button next to Network. It reads this Mac only while it is open, and nothing it sees leaves this Mac.",
    noteOff: "Off: no chart button, and PS reads nothing for it.", speed: "Update every" },
} as const;
