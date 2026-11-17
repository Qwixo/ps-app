// The dev server only: a made up Mac for the Activity monitor (views/ActivityMonitor.tsx), so its screens can be tried and
// photographed without PS. It stands in for PS's side of the bridge (window.webkit.messageHandlers.ps): it answers "open" with
// the island's place, sends a fictional snapshot every sample, answers App history, Startup apps and End task. Every name and
// number is invented. Never shipped (src/dev is left out of release builds).
import { __amDev } from "../views/ActivityMonitor";
import type { Meta, RowNums, Snap } from "../core/activitymon";

type P = { pid: number; n: string; id: string; g?: number; app?: boolean; sys?: boolean; end?: boolean; ps?: boolean; cpu: number; mem: number; io?: number; net?: number; w?: number };
const MB = 1e6, GB = 1e9;
const PROCS: P[] = [
  { pid: 410, n: "Sample Browser", id: "com.example.browser", app: true, cpu: 6, mem: 620 * MB, io: 2e5, net: 4e5, w: 0.9 },
  { pid: 411, n: "Sample Browser Helper (Renderer)", id: "com.example.browser", g: 410, cpu: 9, mem: 840 * MB, net: 1.2e6, w: 1.4 },
  { pid: 412, n: "Sample Browser Helper (GPU)", id: "com.example.browser", g: 410, cpu: 4, mem: 310 * MB, w: 0.7 },
  { pid: 413, n: "Sample Browser Helper", id: "com.example.browser", g: 410, cpu: 0.6, mem: 90 * MB, net: 3e4 },
  { pid: 420, n: "Sample Code", id: "com.example.code", app: true, cpu: 3.5, mem: 540 * MB, io: 9e5, w: 0.5 },
  { pid: 421, n: "Sample Code Helper (Plugin)", id: "com.example.code", g: 420, cpu: 5.5, mem: 720 * MB, io: 3e5, w: 0.8 },
  { pid: 422, n: "Sample Code Helper (Renderer)", id: "com.example.code", g: 420, cpu: 2, mem: 410 * MB },
  { pid: 430, n: "Sample Music", id: "com.example.music", app: true, cpu: 1.2, mem: 260 * MB, net: 2.2e5, w: 0.3 },
  { pid: 440, n: "Sample Notes", id: "com.example.notes", app: true, cpu: 0.2, mem: 120 * MB },
  { pid: 450, n: "Sample Chat", id: "com.example.chat", app: true, cpu: 0.8, mem: 380 * MB, net: 6e4 },
  { pid: 451, n: "Sample Chat Helper", id: "com.example.chat", g: 450, cpu: 0.4, mem: 160 * MB },
  { pid: 460, n: "Sample Mail", id: "com.example.mail", app: true, cpu: 0.3, mem: 210 * MB, net: 1e4 },
  { pid: 470, n: "Finder", id: "com.apple.finder", app: true, sys: true, end: false, cpu: 0.1, mem: 140 * MB },
  { pid: 480, n: "PS", id: "com.cincee.ps", app: true, ps: true, end: false, cpu: 0.4, mem: 230 * MB },
  { pid: 481, n: "WebKit WebContent", id: "", g: 480, sys: true, end: false, cpu: 0.3, mem: 180 * MB },
  { pid: 500, n: "WindowServer", id: "", sys: true, end: false, cpu: 7, mem: 610 * MB, w: 1.1 },
  { pid: 510, n: "mds_stores", id: "", sys: true, end: false, cpu: 2.2, mem: 95 * MB, io: 6e6 },
  { pid: 520, n: "syncagent", id: "", cpu: 1.6, mem: 75 * MB, io: 1.1e6, net: 3.5e5 },
  { pid: 530, n: "backupd", id: "", sys: true, end: false, cpu: 0.6, mem: 48 * MB, io: 2.4e7 },
  { pid: 540, n: "sample-updater", id: "", cpu: 0.05, mem: 22 * MB },
  { pid: 550, n: "photoanalysisd", id: "", sys: true, end: false, cpu: 3.1, mem: 260 * MB, io: 4e5 },
  { pid: 560, n: "node", id: "", cpu: 12, mem: 980 * MB, net: 9e4, w: 2.1 },
  { pid: 570, n: "cloudd", id: "", sys: true, end: false, cpu: 0.4, mem: 60 * MB, net: 1.8e5 },
  { pid: 580, n: "coreaudiod", id: "", sys: true, end: false, cpu: 0.9, mem: 30 * MB },
  { pid: 590, n: "sample-indexer", id: "", cpu: 0.3, mem: 44 * MB, io: 2e5 },
];

function snap(t: number, gone: Set<number>, first: boolean): Snap {
  const wave = (k: number, lo: number, hi: number, ph = 0) => lo + (hi - lo) * (0.5 + 0.5 * Math.sin(t * k + ph));
  const live = PROCS.filter((p) => !gone.has(p.pid));
  const rows: RowNums[] = live.map((p, i) => {
    const j = wave(0.7 + (i % 7) * 0.21, 0.55, 1.45, i);
    return [p.pid, Math.round(p.cpu * j * 10) / 10, p.mem * (0.97 + 0.03 * j), (p.io || 0) * j * 0.6, (p.io || 0) * j * 0.4, p.net == null ? (p.sys ? -1 : 0) : p.net * j * 0.8, p.net == null ? (p.sys ? -1 : 0) : p.net * j * 0.2, (p.w || p.cpu * 0.04) * j, 6 + (i * 7) % 40];
  });
  const meta: Record<string, Meta> = {};
  if (first) for (const p of PROCS) meta[p.pid] = { n: p.n, id: p.id, g: p.g || 0, app: !!p.app, sys: !!p.sys, end: p.end !== false, ps: !!p.ps, st: 1_000 + p.pid };
  const cores = Array.from({ length: 10 }, (_, i) => wave(0.6 + i * 0.17, i < 6 ? 4 : 8, i < 6 ? 38 : 72, i));
  const total = cores.reduce((a, b) => a + b, 0) / cores.length;
  return {
    kind: "snap", at: Date.now(), dt: 1, fake: true,
    cpu: { t: total, u: total * 0.68, s: total * 0.32, cores, kinds: [..."eeeeeepppp"], name: "Sample chip", up: 3 * 86400 + 4 * 3600 + t, procs: 640, thr: 3184 },
    mem: { total: 16 * 2 ** 30, used: wave(0.15, 10.6, 11.4) * 2 ** 30, app: 6.4 * 2 ** 30, wired: 2.1 * 2 ** 30, comp: 2.4 * 2 ** 30, cached: 3.2 * 2 ** 30, free: 1.7 * 2 ** 30, swap: 1.1 * 2 ** 30, swapT: 3 * 2 ** 30, press: "normal" },
    disk: { r: wave(0.9, 2e5, 2.6e7), w: wave(0.55, 1e5, 9e6, 1), act: wave(0.8, 1, 23), vols: [{ n: "Sample Disk", total: 494 * GB, free: 168 * GB }, { n: "Sample Backup", total: 1000 * GB, free: 62 * GB }] },
    net: { on: true, ifs: [{ n: "en0", l: "Wi-Fi", k: "wifi", rx: wave(1.0, 2e4, 2.8e6), tx: wave(0.7, 4e3, 3.6e5, 2) }, { n: "utun4", l: "VPN", k: "vpn", rx: wave(1.0, 1.6e4, 2.4e6), tx: wave(0.7, 3e3, 3e5, 2) }] },
    gpu: { u: wave(0.45, 4, 38), name: "Sample GPU" },
    bat: { pct: 76, charging: false, ac: false, health: 96, cycles: 115, mins: 312, watts: wave(0.4, 6, 15) },
    rows, meta, gone: [], self: { ms: 1.3, cpu: 0.2 },
  };
}

/** Pretend to be PS: answer what the page asks, feed a snapshot every `speed` seconds while open. */
export function startActivityFake(opts: { place?: boolean; ticks?: number } = {}) {
  let timer = 0, t0 = performance.now() / 1000, first = true, speed = 1;
  const gone = new Set<number>();
  const send = (m: object) => window.setTimeout(() => __amDev.apply(m as { kind: string }), 0);
  let sent = 0;
  const tick = () => { if (opts.ticks && sent >= opts.ticks) { clearInterval(timer); return; } sent++; send(snap(performance.now() / 1000 - t0, gone, first)); first = false; };
  const today = new Date(), day = (k: number) => new Date(today.getTime() - k * 86400e3).toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, k) => day(k));
  const handler = (raw: string) => {
    const m = JSON.parse(raw) as { type: string; op?: string; speed?: number; pid?: number; step?: string };
    if (m.type !== "activity") return;
    if (m.op === "open") {
      if (opts.place !== false) send({ kind: "place", place: { x: window.innerWidth / 2, bottom: 32, w: 196, h: 32 } });
      first = true; speed = m.speed || 1; clearInterval(timer);
      window.setTimeout(tick, 120);
      timer = window.setInterval(tick, speed * 1000);
    } else if (m.op === "speed") { speed = m.speed || 1; clearInterval(timer); timer = window.setInterval(tick, speed * 1000); }
    else if (m.op === "close") clearInterval(timer);
    else if (m.op === "history") send({ kind: "history", fake: true, days,
      cpu: Object.fromEntries(days.map((d, k) => [d, [{ id: "com.example.browser", name: "Sample Browser", secs: 2600 - k * 140 }, { id: "com.example.code", name: "Sample Code", secs: 1900 - k * 90 },
        { id: "", name: "node", secs: 1400 - k * 60 }, { id: "com.example.music", name: "Sample Music", secs: 420 }, { id: "com.example.chat", name: "Sample Chat", secs: 260 }, { id: "com.example.mail", name: "Sample Mail", secs: 120 }]])),
      net: Object.fromEntries(days.map((d) => [d, { "Sample Browser": [1.9e9, 1.4e8], "Sample Music": [3.1e8, 4e6], "Sample Chat": [8e7, 2e7], syncagent: [2.4e8, 9.1e8] }])) });
    else if (m.op === "startup") send({ kind: "startup", hidden: true, items: [
      { label: "com.example.sync.agent", name: "Sample Sync", id: "com.example.sync", folder: "user", run: true, keep: true, off: false },
      { label: "com.example.music.helper", name: "Sample Music", id: "com.example.music", folder: "user", run: true, keep: false, off: false },
      { label: "org.example.updater", name: "org.example.updater", id: "", folder: "mac", run: true, keep: false, off: false },
      { label: "com.example.chat.launcher", name: "Sample Chat", id: "com.example.chat", folder: "user", run: false, keep: false, off: true }] });
    else if (m.op === "end" && m.pid) {
      const pid = m.pid, step = m.step;
      // "Sample Code" asks to save (still open after a normal quit), the rest quit at once
      window.setTimeout(() => { const alive = step === "quit" && pid === 420; if (!alive) gone.add(pid); send({ kind: "ended", pid, step, ok: true, alive }); }, 700);
    }
  };
  (window as unknown as { webkit: unknown }).webkit = { messageHandlers: { ps: { postMessage: handler } } };
}
