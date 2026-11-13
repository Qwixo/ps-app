// The Soundboard's state on this device (V1.47; the developer's words and the rules in core/soundboard.ts).
// Where the files are:
//  - PS on the Mac: ps-mac Sources/Soundboard.swift keeps them in a folder (Music > PS Soundboard, or one you pick) and
//    serves them at ps://app/client/media/<id>.<ext>. Messages "sb:*", answers through window.__psSb.
//  - PS on the phone: ps-gos Soundboard.kt, PS's own folder or one you pick through the phone's file access, served at
//    /client/media/<id>.<ext>. Answers as {type:"sb", ...}.
//  - The website (and the phone's browser): the browser's own private storage (OPFS), or a folder you pick where the
//    browser can (showDirectoryPicker). Timed plays there only play while the page is open.
// The full contract is in the shared notes (v147-soundboard-contract.md). Nothing here ever goes to the vault.
import { useSyncExternalStore } from "react";
import { psPost } from "../ps";
import { GOS, gosPost, onShell } from "../gos/bridge";
import {
  ACCEPT, cleanLib, cleanPrefs, dropGone, emptyPrefs, freeName, newId, planFor, planImport, dueBetween, soonest, kindOf, extOf, baseName,
  LOOP_MAX_MS, type Lib, type MediaItem, type Picked, type SbPrefs, type TimedPlay,
} from "../core/soundboard";

export type Where = "mac" | "phone" | "web";
// The build mode, not ps.ts's PS: ps.ts imports G Squad sharing, which imports this file (a loop at load time).
export const WHERE: Where = import.meta.env.MODE === "ps" ? "mac" : import.meta.env.MODE === "gos" ? "phone" : "web";
const FAKE = import.meta.env.DEV && typeof location !== "undefined" && location.search.includes("sbfake");

export interface Ring { plan: string; media: string; name: string; by: "shell" | "page" }
export interface SbState {
  lib: Lib;
  ready: boolean;
  busy: { done: number; total: number; name: string; what: "add" | "move" } | null;
  note: { text: string; bad: boolean } | null;
  drag: boolean;
  ring: Ring | null;
  prefs: SbPrefs;
  open: boolean;
  needsGrant: boolean;   // the website: a picked folder needs a click to be allowed again
}
const PREFS_KEY = "ps.sb.v1";
function loadPrefs(): SbPrefs {
  try { const raw = localStorage.getItem(PREFS_KEY); return raw ? cleanPrefs(JSON.parse(raw)) : emptyPrefs(); } catch { return emptyPrefs(); }
}
let st: SbState = { lib: { items: [], loc: { label: "", custom: false } }, ready: false, busy: null, note: null, drag: false, ring: null, prefs: emptyPrefs(), open: false, needsGrant: false };
const subs = new Set<() => void>();
function set(p: Partial<SbState>) { st = { ...st, ...p }; subs.forEach((f) => f()); }
export const sbState = () => st;
export function useSb(): SbState {
  start();
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
}

let saveT = 0;
export function setPrefs(p: Partial<SbPrefs>) {
  const prefs = { ...st.prefs, ...p, at: Date.now() };
  set({ prefs });
  window.clearTimeout(saveT);
  saveT = window.setTimeout(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private window */ } }, 250);
  if ("plays" in p) sendPlan();
}

/** A queue change made from the newest queue (never a copy from an earlier draw: quick taps used to undo each other). */
export function updQueue(f: (q: SbPrefs["queue"]) => SbPrefs["queue"]) { setPrefs({ queue: f(st.prefs.queue) }); }

let noteT = 0;
export function say(text: string, bad = false) {
  set({ note: { text, bad } });
  window.clearTimeout(noteT);
  noteT = window.setTimeout(() => set({ note: null }), bad ? 7000 : 3500);
}

// ---------- the shells ----------
function post(m: Record<string, unknown>) { if (WHERE === "mac") psPost(m); else if (WHERE === "phone") gosPost(m); }
function fromShell(m: Record<string, unknown>) {
  switch (m.ev) {
    case "lib": {
      const lib = cleanLib(m);
      set({ lib, ready: true, busy: st.busy?.done === st.busy?.total ? null : st.busy });
      afterLib();
      break;
    }
    case "progress": {
      const done = Number(m.done) || 0, total = Number(m.total) || 0;
      set({ busy: total > 0 && done < total ? { done, total, name: typeof m.name === "string" ? m.name.slice(0, 120) : "", what: st.busy?.what ?? "add" } : null });
      break;
    }
    case "added": {
      const n = Number(m.n) || 0, skipped = Number(m.skipped) || 0;
      set({ busy: null });
      say(n ? `Added ${n} file${n === 1 ? "" : "s"}${skipped ? `. Skipped ${skipped} that were not audio or video.` : "."}` : skipped ? `Nothing added: ${skipped} file${skipped === 1 ? " was" : "s were"} not audio or video.` : "Nothing added.");
      break;
    }
    case "error": set({ busy: null }); say(typeof m.text === "string" ? m.text.slice(0, 200) : "Something went wrong.", true); break;
    case "chunk": { const f = chunkWait.get(`${m.id}:${m.off}`); if (f) { chunkWait.delete(`${m.id}:${m.off}`); f(m); } break; }
    case "ring": if (typeof m.media === "string") set({ ring: { plan: String(m.plan || ""), media: m.media, name: typeof m.name === "string" ? m.name.slice(0, 120) : "", by: "shell" } }); break;
    case "ringEnd": if (st.ring?.by === "shell") set({ ring: null }); break;
    case "drag": set({ drag: m.on === true }); break;
  }
}
let started = false;
/** Starts this page's store without drawing anything (the alarm library's squad sounds on the Tab list). */
export function startSb() { start(); }
function start() {
  if (started) return;
  started = true;
  set({ prefs: loadPrefs() });
  if (FAKE) { void fakeStart(); return; }
  if (WHERE === "mac") {
    (window as Window & { __psSb?: (m: Record<string, unknown>) => void }).__psSb = (m) => { if (m && typeof m === "object") fromShell(m); };
    post({ type: "sb:get" });
  } else if (WHERE === "phone") {
    onShell((m) => { if (m.type === "sb") fromShell(m); });
    post({ type: "sb:get" });
  } else void web.list().then(() => afterLib());
  if (WHERE === "web") startWebClock();
}
/** Files that are gone leave the queue and the timed plays; the shell gets the plan again. */
function afterLib() {
  const have = new Set(st.lib.items.map((i) => i.id));
  const q = dropGone(st.prefs.queue, have);
  if (q !== st.prefs.queue) setPrefs({ queue: q });
  sendPlan();
}
let lastPlan = "";
let passive = false;
/** PS's main page on the Mac only reads and writes files for G Squad sharing: the Tab list owns the timed plays. */
export function setPassive() { passive = true; start(); }
function sendPlan() {
  if (!st.ready || passive) return;
  const items = planFor(st.prefs.plays, new Set(st.lib.items.map((i) => i.id)));
  const j = JSON.stringify(items);
  if (j === lastPlan) return;
  lastPlan = j;
  if (WHERE === "web") armWebClock(); else post({ type: "sb:plan", items });
}

// ---------- what the screen asks for ----------
export function refresh() { if (FAKE) return; if (WHERE === "web") void web.list(); else post({ type: "sb:get" }); }
export function addFiles(what: "files" | "folder") {
  if (FAKE) { say("Fictional data: nothing added."); return; }
  if (WHERE !== "web") { set({ busy: { done: 0, total: 0, name: "", what: "add" } }); post({ type: "sb:add", what }); window.setTimeout(() => { if (st.busy?.total === 0) set({ busy: null }); }, 1500); return; }
  pickInBrowser(what === "folder");
}
/** Files dropped on the page (the website; the Mac takes drops natively). */
export function dropFiles(list: { file: File; path: string }[]) {
  if (WHERE !== "web" || FAKE) return;
  void web.add(list);
}
export function removeItems(ids: string[]) {
  if (!ids.length) return;
  if (FAKE) { set({ lib: { ...st.lib, items: st.lib.items.filter((i) => !ids.includes(i.id)) } }); afterLib(); return; }
  if (WHERE === "web") void web.remove(ids); else post({ type: "sb:remove", ids });
}
export function renameItem(id: string, name: string) {
  const n = name.trim().slice(0, 120);
  if (!n) return;
  if (FAKE) { set({ lib: { ...st.lib, items: st.lib.items.map((i) => (i.id === id ? { ...i, name: n } : i)) } }); return; }
  if (WHERE === "web") void web.rename(id, n); else post({ type: "sb:rename", id, name: n });
}
export function chooseLocation(act: "choose" | "default") {
  if (FAKE) return;
  if (WHERE === "web") { void web.move(act); return; }
  if (act === "choose") set({ busy: { done: 0, total: 0, name: "", what: "move" } });
  post({ type: "sb:location", act });
  window.setTimeout(() => { if (st.busy?.total === 0) set({ busy: null }); }, 1500);
}
export const canChooseFolder = () => WHERE !== "web" || typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
export function setOpen(on: boolean) {
  if (st.open === on) return;
  set({ open: on });
  if (WHERE === "mac") post({ type: "sb:open", on });
  if (on) refresh();
}
export function stopRing() {
  const r = st.ring;
  set({ ring: null });
  if (r?.by === "shell") post({ type: "sb:stop" });
  window.dispatchEvent(new Event("ps-sb-ring-stop"));
}
export function grantAgain() { void web.grant(); }

/** Where a file plays from. The shells serve it themselves; the browser makes an object URL (one at a time). */
let objUrl: { id: string; url: string } | null = null;
export async function mediaUrl(it: MediaItem): Promise<string | null> {
  if (FAKE) return fakeUrl(it);
  if (WHERE !== "web") return `${import.meta.env.BASE_URL}media/${it.id}.${it.ext}`;
  if (objUrl?.id === it.id) return objUrl.url;
  const f = await web.file(it.id);
  if (!f) return null;
  if (objUrl) URL.revokeObjectURL(objUrl.url);
  objUrl = { id: it.id, url: URL.createObjectURL(f) };
  return objUrl.url;
}
/** A second address for thumbnails (never the player's object URL, which it may revoke). Caller revokes web ones. */
export async function thumbUrl(it: MediaItem): Promise<{ url: string; free: () => void } | null> {
  if (FAKE) return null;
  if (WHERE !== "web") return { url: `${import.meta.env.BASE_URL}media/${it.id}.${it.ext}`, free: () => {} };
  const f = await web.file(it.id);
  if (!f) return null;
  const url = URL.createObjectURL(f);
  return { url, free: () => URL.revokeObjectURL(url) };
}

// ---------- the bytes of one file (sharing in the G Squad) ----------
const chunkWait = new Map<string, (m: Record<string, unknown>) => void>();
const CHUNK = 1024 * 1024;
export async function readBytes(it: MediaItem): Promise<Uint8Array> {
  if (WHERE === "web" || FAKE) {
    const f = FAKE ? new Blob([fakeWav(1)]) : await web.file(it.id);
    if (!f) throw new Error("That file is not on this device any more.");
    return new Uint8Array(await f.arrayBuffer());
  }
  const out = new Uint8Array(it.size);
  for (let off = 0; off < it.size; off += CHUNK) {
    const m = await new Promise<Record<string, unknown>>((res, rej) => {
      const key = `${it.id}:${off}`;
      chunkWait.set(key, res);
      post({ type: "sb:read", id: it.id, off, len: Math.min(CHUNK, it.size - off) });
      window.setTimeout(() => { if (chunkWait.delete(key)) rej(new Error("The file did not answer in time.")); }, 20_000);
    });
    const bin = atob(String(m.b64 || ""));
    for (let i = 0; i < bin.length && off + i < out.length; i++) out[off + i] = bin.charCodeAt(i);
  }
  return out;
}
/** A sound from the squad lands in "From your squad". */
export async function putBytes(name: string, ext: string, bytes: Uint8Array) {
  if (FAKE) return;
  if (WHERE === "web") { await web.add([{ file: new File([bytes as BlobPart], `${name}.${ext}`), path: `${name}.${ext}` }], "From your squad"); return; }
  const tmp = newId();
  for (let off = 0; off < bytes.length || off === 0; off += CHUNK) {
    const part = bytes.subarray(off, Math.min(bytes.length, off + CHUNK));
    let bin = "";
    for (let i = 0; i < part.length; i += 0x8000) bin += String.fromCharCode(...part.subarray(i, i + 0x8000));
    post({ type: "sb:put", tmp, name, ext, off, b64: btoa(bin), last: off + CHUNK >= bytes.length });
    if (bytes.length === 0) break;
  }
}

// ---------- "Use as my alarm sound" ----------
// The alarm playlists (V1.47, its own chat) listen for "ps-alarm-file" with a File and add it to the list. Nobody
// listening (an older build): we say so plainly.
export async function useAsAlarm(it: MediaItem): Promise<boolean> {
  if (it.kind !== "audio") { say("Only audio files can be an alarm sound.", true); return false; }
  try {
    const bytes = await readBytes(it);
    const file = new File([bytes as BlobPart], `${it.name}.${it.ext}`, { type: "" });
    const ev = new CustomEvent("ps-alarm-file", { detail: { file, name: it.name }, cancelable: true });
    window.dispatchEvent(ev);
    if (ev.defaultPrevented) { say(`Added "${it.name}" to your alarm sounds.`); return true; }
    say("Alarm sounds from the Soundboard are not in this version yet.", true);
  } catch (e) { say(e instanceof Error ? e.message : "Could not read that file.", true); }
  return false;
}

// ---------- the website: OPFS or a picked folder ----------
type Dir = FileSystemDirectoryHandle & {
  values?: () => AsyncIterable<FileSystemHandle>;
  queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
};
type IndexRec = { v: 1; items: { id: string; path: string; name: string; added: number; own?: boolean }[]; ignored?: string[] };
const INDEX = ".ps-soundboard.json";
function idb<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open("ps-soundboard", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onerror = () => res(undefined);
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", mode);
        const q = f(tx.objectStore("kv"));
        q.onsuccess = () => res(q.result); q.onerror = () => res(undefined);
        tx.oncomplete = () => r.result.close();
      };
    } catch { res(undefined); }
  });
}
export const metaGet = <T,>(key: string) => idb<T>("readonly", (s) => s.get(key) as IDBRequest<T>);
export const metaPut = (key: string, v: unknown) => idb("readwrite", (s) => s.put(v, key));

async function splitPath(root: Dir, path: string, create: boolean): Promise<{ dir: Dir; file: string } | null> {
  const parts = path.split("/").filter(Boolean);
  const file = parts.pop();
  if (!file) return null;
  let dir = root;
  try { for (const p of parts) dir = (await dir.getDirectoryHandle(p, { create })) as Dir; } catch { return null; }
  return { dir, file };
}
async function walk(dir: Dir, prefix: string, depth: number, out: Picked[], handles: Map<string, FileSystemFileHandle>) {
  if (!dir.values || depth > 4) return;
  for await (const h of dir.values()) {
    if (h.name.startsWith(".")) continue;
    if (h.kind === "directory") await walk(h as Dir, `${prefix}${h.name}/`, depth + 1, out, handles);
    else if (kindOf(h.name)) {
      const f = await (h as FileSystemFileHandle).getFile().catch(() => null);
      if (f) { out.push({ path: `${prefix}${h.name}`, size: f.size }); handles.set(`${prefix}${h.name}`, h as FileSystemFileHandle); }
    }
  }
}
async function writeFile(root: Dir, path: string, src: Blob): Promise<boolean> {
  const at = await splitPath(root, path, true);
  if (!at) return false;
  try {
    const h = await at.dir.getFileHandle(at.file, { create: true }) as FileSystemFileHandle & { createWritable?: () => Promise<FileSystemWritableFileStream> };
    if (!h.createWritable) return false;
    const w = await h.createWritable();
    await w.write(src); await w.close();
    return true;
  } catch { return false; }
}
async function takenIn(root: Dir, dirPath: string): Promise<Set<string>> {
  const out = new Set<string>();
  const at = await splitPath(root, `${dirPath}/x`, false);
  if (!at?.dir.values) return out;
  try { for await (const h of at.dir.values()) out.add(h.name.toLowerCase()); } catch { /* new folder */ }
  return out;
}

const web = {
  root: null as Dir | null,
  custom: false,
  index: { v: 1, items: [] } as IndexRec,
  paths: new Map<string, string>(),   // id -> path
  async getRoot(): Promise<Dir | null> {
    if (this.root) return this.root;
    const picked = await metaGet<Dir>("root");
    if (picked) {
      const p = await picked.queryPermission?.({ mode: "readwrite" }).catch(() => "denied" as PermissionState);
      if (p === "granted") { this.root = picked; this.custom = true; return picked; }
      set({ needsGrant: true });
    }
    try {
      const top = await (navigator.storage as StorageManager & { getDirectory?: () => Promise<Dir> }).getDirectory?.();
      if (!top) return null;
      this.root = (await top.getDirectoryHandle("soundboard", { create: true })) as Dir;
      this.custom = false;
      void navigator.storage.persist?.().catch(() => false);
      return this.root;
    } catch { return null; }
  },
  async grant() {
    const picked = await metaGet<Dir>("root");
    const p = await picked?.requestPermission?.({ mode: "readwrite" }).catch(() => "denied" as PermissionState);
    if (picked && p === "granted") { this.root = picked; this.custom = true; set({ needsGrant: false }); await this.list(); }
    else say("The folder was not allowed. Files stay in the browser.", true);
  },
  async readIndex(root: Dir): Promise<IndexRec> {
    try {
      const f = await (await root.getFileHandle(INDEX)).getFile(); const j = JSON.parse(await f.text());
      if (j && Array.isArray(j.items)) return { v: 1, items: j.items, ignored: Array.isArray(j.ignored) ? j.ignored.filter((x: unknown) => typeof x === "string").slice(0, 5000) : [] };
    } catch { /* none yet */ }
    return { v: 1, items: [], ignored: [] };
  },
  async saveIndex(root?: Dir) {
    const at = root ?? web.root;
    if (!at) return;
    await writeFile(at, INDEX, new Blob([JSON.stringify(this.index)], { type: "application/json" }));
  },
  async list() {
    const root = await this.getRoot();
    if (!root) { set({ ready: true, lib: { items: [], loc: { label: "This browser cannot keep files", custom: false } } }); return; }
    const idx = await this.readIndex(root);
    const found: Picked[] = [];
    const handles = new Map<string, FileSystemFileHandle>();
    await walk(root, "", 0, found, handles);
    const byPath = new Map(idx.items.map((x) => [x.path, x]));
    const ignored = new Set(idx.ignored ?? []);
    const items: MediaItem[] = [];
    const next: IndexRec = { v: 1, items: [], ignored: [...ignored] };
    for (const f of found) {
      if (ignored.has(f.path)) continue;
      const known = byPath.get(f.path);
      // A file PS did not put here (you copied it into the folder): adopted, never deleted by PS.
      const rec = known ? { ...known, own: known.own ?? !this.custom } : { id: newId(), path: f.path, name: baseName(f.path), added: Date.now(), own: false };
      next.items.push(rec);
      const parts = f.path.split("/"); parts.pop();
      const ext = extOf(f.path), kind = kindOf(f.path)!;
      items.push({ id: rec.id, name: rec.name, ext, kind, size: f.size, folder: parts.join("/"), added: rec.added });
    }
    const changed = JSON.stringify(next) !== JSON.stringify(idx);
    this.index = next;
    this.paths = new Map(next.items.map((x) => [x.id, x.path]));
    if (changed) await this.saveIndex(root);
    const label = this.custom ? `Your folder: ${root.name}` : "This browser's own storage";
    set({ lib: cleanLib({ items, loc: { label, custom: this.custom } }), ready: true });
    afterLib();
  },
  async file(id: string): Promise<File | null> {
    const root = await this.getRoot(), path = this.paths.get(id);
    if (!root || !path) return null;
    const at = await splitPath(root, path, false);
    try { return at ? await (await at.dir.getFileHandle(at.file)).getFile() : null; } catch { return null; }
  },
  async add(list: { file: File; path: string }[], into = "") {
    const root = await this.getRoot();
    if (!root) { say("This browser cannot keep files. Use PS app on the Mac or the phone.", true); return; }
    const top = into || (list.length && list[0].path.includes("/") ? list[0].path.split("/")[0] : "");
    const strip = !into && top ? `${top}/` : "";
    const plan = planImport(list.map((x) => ({ path: x.path.startsWith(strip) ? x.path.slice(strip.length) : x.path, size: x.file.size })), top, st.lib.items.length);
    const byPath = new Map(list.map((x) => [x.path.startsWith(strip) ? x.path.slice(strip.length) : x.path, x.file]));
    let n = 0;
    for (const t of plan.take) {
      set({ busy: { done: n, total: plan.take.length, name: t.name, what: "add" } });
      const taken = await takenIn(root, t.folder);
      const fileName = freeName(`${t.name}.${t.ext}`, taken);
      const path = t.folder ? `${t.folder}/${fileName}` : fileName;
      if (await writeFile(root, path, byPath.get(t.path)!)) {
        this.index.items.push({ id: newId(), path, name: t.name, added: Date.now() + n, own: true });
        n++;
      } else { set({ busy: null }); say("The browser would not save that file (it may be full).", true); break; }
    }
    await this.saveIndex(root);
    set({ busy: null });
    fromShell({ ev: "added", n, skipped: plan.skipped + (plan.take.length - n) });
    await this.list();
  },
  async remove(ids: string[]) {
    const root = await this.getRoot();
    if (!root) return;
    // PS deletes only files it put there; a file you put in the folder yourself is only hidden from the Soundboard.
    const ignored = new Set(this.index.ignored ?? []);
    for (const id of ids) {
      const x = this.index.items.find((y) => y.id === id);
      if (!x) continue;
      if (x.own === false) { ignored.add(x.path); continue; }
      const at = await splitPath(root, x.path, false);
      if (at) await at.dir.removeEntry(at.file).catch(() => {});
    }
    this.index.ignored = [...ignored].slice(-5000);
    this.index.items = this.index.items.filter((x) => !ids.includes(x.id));
    await this.saveIndex(root);
    await this.list();
  },
  async rename(id: string, name: string) {
    const x = this.index.items.find((y) => y.id === id);
    if (!x) return;
    x.name = name;
    await this.saveIndex();
    await this.list();
  },
  /** Moves every file to a picked folder (or back to the browser's own storage): copy all, check sizes, then delete. */
  async move(act: "choose" | "default") {
    const from = await this.getRoot();
    if (!from) return;
    let to: Dir;
    try {
      if (act === "choose") {
        const pick = (window as Window & { showDirectoryPicker?: (o: object) => Promise<Dir> }).showDirectoryPicker;
        if (!pick) { say("This browser cannot use a folder. Files stay in the browser.", true); return; }
        to = await pick({ mode: "readwrite", id: "ps-soundboard" });
      } else {
        const top = await (navigator.storage as StorageManager & { getDirectory?: () => Promise<Dir> }).getDirectory!();
        to = (await top.getDirectoryHandle("soundboard", { create: true })) as Dir;
      }
    } catch { return; }   // cancelled
    if (await to.isSameEntry(from)) return;
    const moved: string[] = [];
    const total = this.index.items.length;
    let ok = true;
    for (const x of this.index.items) {
      set({ busy: { done: moved.length, total, name: x.name, what: "move" } });
      const f = await this.file(x.id);
      if (!f || !(await writeFile(to, x.path, f))) { ok = false; break; }
      const back = await splitPath(to, x.path, false);
      const g = back ? await (await back.dir.getFileHandle(back.file)).getFile().catch(() => null) : null;
      if (!g || g.size !== f.size) { ok = false; break; }
      moved.push(x.path);
    }
    if (!ok) {
      for (const p of moved) { const at = await splitPath(to, p, false); if (at) await at.dir.removeEntry(at.file).catch(() => {}); }
      set({ busy: null }); say("Could not move the files. Nothing was changed.", true); return;
    }
    // Only PS's own copies leave the old place; files you put there yourself stay untouched. Every copy here is PS's.
    const kept = this.index.items.filter((x) => x.own === false);
    for (const x of this.index.items) if (x.own !== false) { const at = await splitPath(from, x.path, false); if (at) await at.dir.removeEntry(at.file).catch(() => {}); }
    this.index = { v: 1, items: this.index.items.map((x) => ({ ...x, own: true })), ignored: [] };
    await this.saveIndex(to);
    if (kept.length) await writeFile(from, INDEX, new Blob([JSON.stringify({ v: 1, items: kept, ignored: [] })], { type: "application/json" }));
    else await from.removeEntry(INDEX).catch(() => {});
    if (act === "choose") await metaPut("root", to); else await idb("readwrite", (s) => s.delete("root"));
    this.root = to; this.custom = act === "choose";
    set({ busy: null, needsGrant: false });
    say(act === "choose" ? `Moved ${total} file${total === 1 ? "" : "s"} to ${to.name}.` : "Your files are back in the browser's own storage.");
    await this.list();
  },
};

function pickInBrowser(folder: boolean) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  if (folder) (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true; else input.accept = ACCEPT;
  input.style.display = "none";
  input.onchange = () => {
    const files = [...(input.files || [])].map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
    input.remove();
    if (files.length) void web.add(files);
  };
  document.body.appendChild(input);
  input.click();
}

// ---------- the website's own timer for timed plays (only while the page is open) ----------
let clockT = 0, lastLook = 0;
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
function startWebClock() {
  lastLook = Date.now();
  document.addEventListener("visibilitychange", () => look());
  window.addEventListener("focus", () => look());
}
function armWebClock() {
  window.clearTimeout(clockT);
  const next = soonest(st.prefs.plays.filter((p) => st.lib.items.some((i) => i.id === p.media)), Date.now(), deviceTz());
  if (next < 0) return;
  clockT = window.setTimeout(look, Math.min(next - Date.now() + 50, 60 * 60_000));
}
function look() {
  const now = Date.now();
  const due = dueBetween(st.prefs.plays, lastLook, now, deviceTz());
  lastLook = now;
  const last = due[due.length - 1];
  if (last) {
    set({ ring: { plan: last.play.id, media: last.play.media, name: last.play.name, by: "page" } });
    window.dispatchEvent(new CustomEvent<TimedPlay>("ps-sb-ring", { detail: last.play }));
  }
  armWebClock();
}
export const loopMaxMs = LOOP_MAX_MS;

// ---------- fictional data for screenshots (dev only, ?sbfake) ----------
function fakeWav(secs: number): ArrayBuffer {
  const rate = 8000, n = rate * secs, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, n * 2, true);
  return b;   // silence
}
const fakeUrls = new Map<string, string>();
function fakeUrl(it: MediaItem): string {
  if (!fakeUrls.has(it.id)) fakeUrls.set(it.id, URL.createObjectURL(new Blob([fakeWav(it.kind === "video" ? 3 : 2)], { type: "audio/wav" })));
  return fakeUrls.get(it.id)!;
}
async function fakeStart() {
  const names: [string, string, string, number][] = [
    ["Morning hype talk", "mp3", "Wake up", 4.2], ["Rain on a tin roof", "m4a", "Sleep", 38], ["Deep focus 40 Hz", "flac", "Focus", 61],
    ["Gym walkout", "mp3", "Gym", 6.1], ["Leg day pep talk", "mp4", "Gym", 210], ["Airhorn", "wav", "", 0.3], ["Crowd cheer", "wav", "", 0.9],
    ["Sunrise timelapse", "mov", "Videos", 480], ["Lo fi beats 2", "mp3", "Focus", 9.4], ["Boxing bell", "mp3", "Gym", 0.2],
    ["Ocean waves", "m4a", "Sleep", 22], ["Trailer cut", "mp4", "Videos", 96],
  ];
  const items = names.map(([name, ext, folder, mb], i) => ({ id: newId(), name, ext, kind: kindOf(`x.${ext}`), size: Math.round(mb * 1024 * 1024), folder, added: Date.now() - i * 3_600_000 }));
  set({ lib: cleanLib({ items, loc: { label: "Music > PS Soundboard", custom: false } }), ready: true });
  afterLib();
}
