// Alarm playlists and My library on this device (V1.47; the rules in core/alarmlist.ts, the settings in
// views/SleepWake.tsx). The library (names, lengths, order, which are ticked, the cycle) is in the vault settings,
// synced. The FILES stay on the device they were added on, like your own sound (V1.44): never uploaded by this module,
// never in the vault, so the free Supabase egress does not move. A file's id is the start of its SHA-256, so the same
// talk added on the Mac and on the phone is one entry, and each device says which files it has.
//  - Mac: PS's own Open panel (several at once) and drag and drop onto the playlist (ps-mac SecondDrop.swift takes the
//    drop natively, AlarmList.swift copies each file as it is into Application Support/PS/alarm-list). A file the page
//    already holds (from the Soundboard, a starter pack, the squad) is handed over in 512 KB pieces like on the phone.
//    Answers come back through window.__psAlarmList({have, added?, saved?, failed?, chunk?, error?, busy?}).
//  - Phone: the page's file picker; each file is checked, its id worked out, and handed to the shell in 512 KB pieces
//    ({type:"sleep:list:put", id, ext, i, n, b64}); ps-gos AlarmList.kt writes it to filesDir/alarm-list, checks the
//    SHA-256 matches the id, and answers {type:"sleep:list", have, saved?, failed?, chunk?, error?}.
//  - Browser: IndexedDB "ps-alarm-list", this browser only.
// Libraries to add from: the PS starter packs (public/alarm-packs in the build itself) and the G Squad's shared sounds.
// Sharing in the squad goes through the Soundboard's own share (one upload path, sealed with the squad key, its limits),
// by window events so neither module imports the other (the Soundboard's listeners: its branch src/squad/sbshare.ts):
//   "ps-alarm-file" {file, name}            the Soundboard's "Use as my alarm sound": this module adds it (preventDefault)
//   "ps-sound-share" {file, name, pack, done} this module asks the Soundboard to share a library file in the squad
//   "ps-squad-sounds" {reply}                this module asks for the squad's shared sounds
//   "ps-squad-sound-get" {id, reply}         this module asks for one of them, to add it to the library
// A file is played straight from its own bytes (never decoded whole), so a long talk costs its own size on the device
// and nothing else. Up to MAX_MB per file, MAX_TRACKS files.
import { useSyncExternalStore } from "react";
import { PS, psPost } from "../ps";
import { GOS, gosPost, onShell } from "../gos/bridge";
import { BASE, vaultStore } from "../core/vault";
import { settingsData } from "../core/select";
import { prefsOf, sleepModeOf } from "../core/sleepmode";
import { MAX_MB, MAX_TRACKS, SHARE_MAX_MB, addTracks, checkFile, cleanPacks, cleanTrack, dayIn, idFromDigest, removeTrack, trackName,
  type AlarmList, type Pack, type Track } from "../core/alarmlist";
import { taskMapActions } from "../views/TaskMap";
import type { Settings } from "../core/model";

const WHERE: "mac" | "phone" | "web" = PS ? "mac" : GOS ? "phone" : "web";
export interface SquadSound { id: string; name: string; ext: string; size: number; by: string; pack: string; until: string }
export interface ListState {
  have: Set<string>;        // the ids whose files are on this device
  busy: string | null;      // "Adding Les Brown (2 of 5)..."
  note: string | null;      // a plain sentence after something did not work (or a share went through)
  starter: Pack[] | null;   // the PS starter packs in this build (null: not read yet)
  squad: { files: SquadSound[]; loaded: boolean; can: boolean };   // can: the Soundboard answered (sharing works here)
}
let st: ListState = { have: new Set(), busy: null, note: null, starter: null, squad: { files: [], loaded: false, can: false } };
const subs = new Set<() => void>();
function set(p: Partial<ListState>) { st = { ...st, ...p }; subs.forEach((f) => f()); }
export function useAlarmList(): ListState {
  start();
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
}
export const listNow = () => st;
export const listPicksNatively = () => WHERE === "mac";
export const listDropsNatively = () => WHERE === "mac";
const today = () => dayIn(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

// ---------- the synced library ----------
/** The library as the settings have it now. */
export function currentList(): AlarmList { return sleepModeOf(settingsData(vaultStore.get())).wake.list; }
/** Saves a changed library (the whole sleepMode record goes, as every Sleep mode save does). */
export function saveList(next: AlarmList) {
  const v = sleepModeOf(settingsData(vaultStore.get()));
  if (JSON.stringify(v.wake.list) === JSON.stringify(next)) return;
  void taskMapActions.looks({ sleepMode: prefsOf({ ...v, wake: { ...v.wake, list: next } }) } as Partial<Settings>);
}
/** Files kept on this device go into the library (and the playlist, unless `play` is false). */
function adopt(raw: unknown[], play = true) {
  const ts = raw.map(cleanTrack).filter((t): t is Track => !!t);
  if (!ts.length) return;
  const l = currentList();
  const full = l.tracks.length + ts.filter((t) => !l.tracks.some((x) => x.id === t.id)).length > MAX_TRACKS;
  saveList(addTracks(l.tracks.length ? l : { ...l, on: true }, ts, today(), play));
  if (full) set({ note: `The library holds up to ${MAX_TRACKS} files. The rest were left out.` });
}

// ---------- the shell's answers ----------
const waiters = new Map<string, (ok: boolean) => void>();
const readers = new Map<string, (c: { off: number; size: number; b64: string } | null) => void>();
function fromShell(m: Record<string, unknown>) {
  const p: Partial<ListState> = {};
  if (Array.isArray(m.have)) p.have = new Set(m.have.filter((x): x is string => typeof x === "string"));
  if (Array.isArray(m.added)) adopt(m.added);
  if (typeof m.error === "string") p.note = m.error.slice(0, 300);
  if ("busy" in m) p.busy = typeof m.busy === "string" ? m.busy.slice(0, 120) : null;
  set(p);
  if (typeof m.saved === "string") { const w = waiters.get(m.saved); waiters.delete(m.saved); w?.(true); }
  if (typeof m.failed === "string") { const w = waiters.get(m.failed); waiters.delete(m.failed); w?.(false); }
  const c = m.chunk as Record<string, unknown> | undefined;
  if (c && typeof c === "object" && typeof c.id === "string") {
    const r = readers.get(c.id); readers.delete(c.id);
    r?.(typeof c.b64 === "string" ? { off: Number(c.off) || 0, size: Number(c.size) || 0, b64: c.b64 } : null);
  }
}
let started = false;
function start() {
  if (started) return;
  started = true;
  if (WHERE === "mac") {
    (window as Window & { __psAlarmList?: (m: Record<string, unknown>) => void }).__psAlarmList = (m) => { if (m && typeof m === "object") fromShell(m); };
    psPost({ type: "sleep:list:get" });
  } else if (WHERE === "phone") {
    onShell((m) => { if (m.type === "sleep:list") fromShell(m); });
    gosPost({ type: "sleep:list:get" });
  } else void webLoad();
}
/** Files on this device that left the library (deleted on another device) are deleted here, once the settings are
 *  really loaded (never from an empty default while the vault is still opening). The shell keeps any file under 10
 *  minutes old, so one being added right now is never caught. */
export function tidyFiles() {
  const s = vaultStore.get();
  if (s.status !== "unlocked" || !settingsData(s)?.sleepMode) return;
  const ids = currentList().tracks.map((t) => t.id);
  if (WHERE === "mac") psPost({ type: "sleep:list:keep", ids });
  else if (WHERE === "phone") gosPost({ type: "sleep:list:keep", ids });
  else void webKeep(ids);
}

// ---------- adding ----------
export const clearListNote = () => { if (st.note) set({ note: null }); };
export function pickOnMac() { set({ note: null }); psPost({ type: "sleep:list:pick" }); }
/** How long a file plays, read by the device's own player (cheap: only the start of the file is read). -1: it cannot
 *  play it; 0: unknown. */
function lengthOf(f: Blob): Promise<number> {
  return new Promise((ok) => {
    const a = document.createElement("audio"), url = URL.createObjectURL(f);
    const done = (v: number) => { window.clearTimeout(t); URL.revokeObjectURL(url); a.removeAttribute("src"); ok(Number.isFinite(v) && v > 0 ? v : v < 0 ? -1 : 0); };
    const t = window.setTimeout(() => done(0), 15_000);
    a.preload = "metadata";
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(-1);
    a.src = url;
  });
}
const PIECE = 512 * 1024;
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** Files picked on the phone or in a browser, dropped in a browser, or handed over by the Soundboard, a starter pack or
 *  the squad (on any device): each checked, kept on this device, then put in the library. One at a time, so a big talk
 *  never sits in memory twice. `play` false: the library only, not ticked into the playlist. `names`: shown names. */
export async function importFiles(files: File[], o: { play?: boolean; names?: (string | undefined)[] } = {}): Promise<void> {
  if (!files.length) return;
  if (st.busy) { set({ note: "Still adding the last files. Try again in a moment." }); return; }
  set({ note: null });
  const added: Track[] = [], bad: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i], shown = o.names?.[i]?.trim() ? o.names[i]!.trim().slice(0, 60) : trackName(f.name);
    set({ busy: `Adding ${shown}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ""}...` });
    try {
      const ok = checkFile(f.name, f.size, new Uint8Array(await f.slice(0, 16).arrayBuffer()));
      if (!ok.ok) { bad.push(ok.why); continue; }
      const secs = await lengthOf(f);
      if (secs < 0) { bad.push(`${shown}: this device cannot play that file.`); continue; }
      const buf = new Uint8Array(await f.arrayBuffer());
      const id = idFromDigest(await crypto.subtle.digest("SHA-256", buf));
      const t: Track = { id, name: shown, secs: Math.round(secs), bytes: f.size, ext: ok.ext };
      if (!st.have.has(id)) {
        const kept = WHERE === "web" ? await webSave(id, f) : await sendToShell(id, ok.ext, buf);
        if (!kept) { bad.push(`${t.name}: PS app could not keep it on this device.`); continue; }
        set({ have: new Set([...st.have, id]) });
      }
      added.push(t);
    } catch {
      bad.push(`${shown}: PS app could not read that file.`);
    }
  }
  set({ busy: null, note: bad.length ? bad.slice(0, 4).join(" ") : null });
  if (added.length) adopt(added, o.play !== false);
}
async function sendToShell(id: string, ext: string, buf: Uint8Array): Promise<boolean> {
  const post = WHERE === "mac" ? psPost : gosPost;
  const n = Math.max(1, Math.ceil(buf.length / PIECE));
  const done = new Promise<boolean>((ok) => { waiters.set(id, ok); window.setTimeout(() => { if (waiters.delete(id)) ok(false); }, 180_000); });
  for (let i = 0; i < n; i++) {
    post({ type: "sleep:list:put", id, ext, i, n, b64: b64(buf.subarray(i * PIECE, (i + 1) * PIECE)) });
    if (i % 8 === 7) await new Promise((r) => window.setTimeout(r, 0));   // let the page breathe between pieces
  }
  return done;
}
/** The Soundboard's "Use as my alarm sound" (its branch src/soundboard/store.ts useAsAlarm): taken here, added to the
 *  library and the playlist. Listening from the start, whichever page the Soundboard is open on. */
if (typeof window !== "undefined") {
  window.addEventListener("ps-alarm-file", (e) => {
    const d = (e as CustomEvent<{ file?: unknown; name?: unknown }>).detail;
    if (!d || !(d.file instanceof File)) return;
    e.preventDefault();
    start();
    void importFiles([d.file], { names: [typeof d.name === "string" ? d.name : undefined] });
  });
}

// ---------- removing ----------
/** Deletes a file from the library (every device) and its copy from this device. */
export function removeFile(id: string) {
  saveList(removeTrack(currentList(), id, today()));
  if (WHERE === "mac") psPost({ type: "sleep:list:remove", id });
  else if (WHERE === "phone") gosPost({ type: "sleep:list:remove", id });
  else void webDelete(id);
  const have = new Set(st.have); have.delete(id);
  set({ have });
}

// ---------- reading a file back (to share it) ----------
async function readFile(t: Track): Promise<File | null> {
  if (WHERE === "web") { const b = await webBlob(t.id); return b ? new File([b], `${t.name}.${t.ext}`) : null; }
  const post = WHERE === "mac" ? psPost : gosPost;
  const parts: Uint8Array[] = [];
  let off = 0, size = Infinity;
  while (off < size) {
    const c = await new Promise<{ off: number; size: number; b64: string } | null>((ok) => {
      readers.set(t.id, ok);
      window.setTimeout(() => { if (readers.delete(t.id)) ok(null); }, 30_000);
      post({ type: "sleep:list:read", id: t.id, off, len: 1 << 20 });
    });
    if (!c || c.off !== off) return null;
    const u = unb64(c.b64);
    size = c.size;
    if (!u.length && off < size) return null;
    parts.push(u); off += u.length;
    if (off > SHARE_MAX_MB * 1024 * 1024) return null;
  }
  return new File(parts as BlobPart[], `${t.name}.${t.ext}`);
}

// ---------- the PS starter packs (in the build itself) ----------
export async function loadStarter() {
  if (st.starter) return;
  try {
    const r = await fetch(`${BASE}alarm-packs/index.json`, { cache: "no-cache" });
    set({ starter: r.ok ? cleanPacks(await r.json()) : [] });
  } catch { set({ starter: [] }); }
}
/** Adds a starter pack's files (all of them, or the ones picked) to the library and the playlist. */
export async function addFromPack(p: Pack, which?: string[]) {
  const files: File[] = [], names: string[] = [];
  set({ busy: `Getting ${p.name}...`, note: null });
  for (const f of p.files) {
    if (which && !which.includes(f.file)) continue;
    try {
      const r = await fetch(`${BASE}alarm-packs/${f.file.split("/").map(encodeURIComponent).join("/")}`);
      if (!r.ok) continue;
      files.push(new File([await r.blob()], f.file.split("/").pop() ?? "audio.mp3")); names.push(f.name);
    } catch { /* that one is missing from this build */ }
  }
  set({ busy: null });
  if (!files.length) { set({ note: `${p.name}: its files are not in this version of PS app.` }); return; }
  await importFiles(files, { names });
}

// ---------- the G Squad (through the Soundboard's share) ----------
const SQUAD_OFF = "Sharing in the G Squad comes with the Soundboard, which is not in this version of PS app yet.";
/** Asks the Soundboard for the squad's shared sounds. Nobody answering: sharing is not here (yet). */
export function loadSquad() {
  // The website never talks to the hub (the Soundboard answers there with an empty list): say where it works instead.
  if (WHERE === "web") { set({ squad: { files: [], loaded: true, can: false } }); return; }
  let got = false;
  const ev = new CustomEvent("ps-squad-sounds", { cancelable: true, detail: { reply: (list: unknown) => {
    got = true;
    const files = (Array.isArray(list) ? list : []).slice(0, 40).map((x) => (x && typeof x === "object" ? x : {}) as Record<string, unknown>)
      .filter((x) => typeof x.id === "string").map((x) => ({
        id: String(x.id).slice(0, 40), name: String(x.name ?? "").slice(0, 120) || "Untitled", ext: String(x.ext ?? "mp3").slice(0, 8).toLowerCase(),
        size: Number(x.size) || 0, by: String(x.by ?? "").slice(0, 40), pack: String(x.pack ?? "").slice(0, 60), until: String(x.until ?? "").slice(0, 40) }));
    set({ squad: { files, loaded: true, can: true } });
  } } });
  const taken = !window.dispatchEvent(ev);
  if (!taken && !got) set({ squad: { files: [], loaded: true, can: false } });
}
/** Adds one of the squad's shared sounds (or a whole pack of them) to the library and the playlist. */
export async function addFromSquad(ids: string[]) {
  const files: File[] = [], names: string[] = [];
  let why = "";
  for (const [i, id] of ids.entries()) {
    const s = st.squad.files.find((x) => x.id === id);
    set({ busy: `Getting ${s?.name ?? "a sound"}${ids.length > 1 ? ` (${i + 1} of ${ids.length})` : ""}...`, note: null });
    const f = await new Promise<File | null>((ok) => {
      const t = window.setTimeout(() => ok(null), 120_000);
      const ev = new CustomEvent("ps-squad-sound-get", { cancelable: true, detail: { id, reply: (file: unknown, w?: unknown) => {
        window.clearTimeout(t);
        if (!(file instanceof File) && typeof w === "string") why = w.slice(0, 200);
        ok(file instanceof File ? file : null);
      } } });
      if (window.dispatchEvent(ev)) { window.clearTimeout(t); ok(null); }
    });
    if (f) { files.push(f); names.push(s?.name ?? trackName(f.name)); }
  }
  set({ busy: null });
  if (!files.length) { set({ note: why || (st.squad.can ? "That sound could not be fetched from your squad." : SQUAD_OFF) }); return; }
  await importFiles(files, { names });
}
/** Shares a library file in the squad through the Soundboard (sealed with the squad key, up to 10 MB, 14 days). */
export async function shareToSquad(t: Track, pack: string) {
  if (t.bytes > SHARE_MAX_MB * 1024 * 1024) { set({ note: `${t.name} is over ${SHARE_MAX_MB} MB. Up to ${SHARE_MAX_MB} MB can be shared.` }); return; }
  set({ busy: `Reading ${t.name}...`, note: null });
  const file = await readFile(t);
  set({ busy: null });
  if (!file) { set({ note: `${t.name}: PS app could not read it on this device.` }); return; }
  const ev = new CustomEvent("ps-sound-share", { cancelable: true, detail: { file, name: t.name, pack: pack.trim().slice(0, 60),
    done: (text: unknown) => { if (typeof text === "string") set({ note: text.slice(0, 300) }); if (st.squad.can) loadSquad(); } } });
  if (window.dispatchEvent(ev)) set({ note: SQUAD_OFF });
  else set({ note: `Sharing ${t.name} with your squad. It shows in their Soundboard and their alarm libraries.` });
}

// ---------- a browser keeps the files in its own storage ----------
const DB = "ps-alarm-list";
function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("f"); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  try {
    return await new Promise<T | undefined>((ok, no) => {
      const t = d.transaction("f", mode), r = f(t.objectStore("f"));
      t.oncomplete = () => ok(r ? r.result : undefined); t.onerror = () => no(t.error);
    });
  } finally { d.close(); }
}
async function webSave(id: string, f: File): Promise<boolean> {
  try { await tx("readwrite", (s) => { s.put({ blob: f, at: Date.now() }, id); }); return true; } catch { return false; }
}
async function webDelete(id: string) { try { await tx("readwrite", (s) => { s.delete(id); }); } catch { /* none */ } }
async function webLoad() {
  try { const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys()); set({ have: new Set((keys ?? []).map(String)) }); } catch { /* private browsing */ }
}
async function webKeep(ids: string[]) {
  try {
    const keep = new Set(ids), keys = (await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys())) ?? [];
    for (const k of keys) {
      if (keep.has(String(k))) continue;
      const v = await tx<{ at?: number }>("readonly", (s) => s.get(k));
      if (!v?.at || Date.now() - v.at > 10 * 60_000) await webDelete(String(k));
    }
    await webLoad();
  } catch { /* none */ }
}
async function webBlob(id: string): Promise<Blob | null> {
  try { const v = await tx<{ blob?: Blob }>("readonly", (s) => s.get(id)); return v?.blob ?? null; } catch { return null; }
}
/** The file of `id` in this browser, as a playable address (the caller revokes it), or null. */
export async function webFileUrl(id: string): Promise<string | null> {
  const b = await webBlob(id);
  return b ? URL.createObjectURL(b) : null;
}
export const MAX_FILE_MB = MAX_MB;
