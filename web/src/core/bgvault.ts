// The developer's own background videos, from his vault, for his phone (PS GOS) and his Macs (PS).
// Private: never in an app file, never public, never on anyone else's PS (27 Oct 2026: PS is
// handed to other people too, so the videos left the app and its Drive folder for good).
//
// How they are stored (works with the vault as it is, no server change):
//  - The video is cut into 1.5 MB pieces. Each piece is one encrypted blob (AES-256-GCM with the
//    vault key, AAD = blob id, the same as every other vault file), so the server only ever holds
//    ciphertext and a size.
//  - A small list in the developer's own settings (settings.bgVault) names each video, its pieces, its size
//    and its portrait crop. Settings are owner only and encrypted like everything else.
//  - Egress: a device downloads each video ONCE (about 1.37 times the file size, base64), then keeps
//    it and plays it from there. Nothing is fetched again unless the video changes. A 20 MB loop
//    costs about 27 MB once per device.
//  - Automatic portrait crop: when a video is added, a few frames are sampled and the 9:16 window
//    with the most detail is picked; the phone plays it filling the screen around that spot.
//  - the developer's Mac: the silent copies PS makes from his Google Drive folder ("older") are put into the
//    vault once, piece by piece through the shell, so his other Macs and his phone get them too.
//  - The Drive folder sync (4 Nov 2026, ps-mac Backgrounds.swift, rules in ./bgsync.ts): a new video in
//    the folder goes into the vault once; a changed one replaces its old version (new id, the picked
//    background follows it, the old pieces are deleted); one that left the folder leaves the vault;
//    every 12 hours the vault is checked for every piece (ids only) and a lost video is put back; a
//    problem becomes one card with Copy error code (the Mac's card stack, a card on the phone).
// The shell protocol (the same on both): page -> shell bg:list {keep}, bg:put {id,name,index,total,
// data}, and on the Mac bg:read {id,index}, bg:adopt {from,id}, bg:status {problems}, bg:progress {id,pct} (a
// video the developer added with More settings, Add video: the Mac's progress card); shell -> page
// bg:have {ids, older?, gone?, drive?, check?, partial?}, and on the Mac bg:piece {id,index,total,data}.
import { useSyncExternalStore } from "react";
import { blobsPresent, deleteBlob, getBlob, putBlob, vaultStore, type Snapshot } from "./vault";
import { pickStandIns } from "./bgsync";
import { ADD_MAX, addNote, backoffMs, brokenVideos, driveFrom, errText, notKept, piecesToFetch, problem, problemKey, report, showable, twinOf, uploadCode, type BgProblem, type Older } from "./bgsync";
import { saveSettings } from "./actions";
import { settingsData } from "./select";
import { isRedAccount } from "./account";
import { bgKey, followReplaced } from "./bgcrop";
import { followPicks } from "./devicebg";
import { bgDesign } from "./prio";
import type { Settings } from "./model";
import { lpInterval } from "./lowpower.ts";

export type VaultVideo = { id: string; name: string; pieces: string[]; bytes: number; type: string; focus: number; addedAt: string; from?: string };
export type BgBridge = {
  post(m: object): void;
  /** Hands every shell message to `f` (only bg:have and bg:piece matter here). */
  listen(f: (m: Record<string, unknown>) => void): void;
  /** The videos on this device that can be picked (the phone; the Mac's shell tells its Tab list itself). */
  publish?(list: { id: string; name: string }[]): void;
  /** Portrait crop as CSS (the phone only). */
  crop?: boolean;
};
const PIECE = 1_500_000;

/** The developer's own account only (src/core/account.ts). Fails closed: anyone else, or not sure, gets nothing. */
export function bgAllowed(s: Snapshot) {
  return isRedAccount(s);
}

let bridge: BgBridge | null = null;
let local = new Set<string>();   // videos already on this device (from the shell)
let older: Older[] = [];         // copies on this Mac to put in the vault
let gone: string[] = [];         // videos that left the developer's Drive folder (the Mac that has it)
let drive = new Set<string>();   // the folder's videos (the Mac that has it): a lost one is put back, not reported
let partial: Record<string, number[]> = {};   // pieces of a stopped download (the phone)
let busy = "";
let note = "";                   // the last Add a video result, in plain words (the phone)
// The phone (V1.33): a video counts as here only once the shell says so (bg:have), never when the page has
// merely sent its pieces: the shell writes them on its own thread, and a tile or background offered before
// that asked for a file that was not there yet. Shell answers come in the order asked (one queue).
const waiting = new Set<string>();
let asked = 0, answered = 0, confirmAt = 0;
const subs = new Set<() => void>();
const problems = new Map<string, BgProblem>();
let snap = { list: [] as VaultVideo[], local: 0, busy: "", note: "", problem: null as BgProblem | null };
const onPhone = () => !!bridge?.crop;
function emit() {
  const list = videos();
  const p = [...problems.values()][0] ?? null;
  snap = { list, local: list.filter((v) => local.has(v.id)).length, busy, note, problem: p && showable(p, dismissedMark()) ? p : null };
  subs.forEach((f) => f());
}

// ---------- problems: the Mac shows them as cards in its stack, the phone as a card of its own ----------
let sentStatus = "";
function setProblem(code: string, p: BgProblem | null) {
  if (p) problems.set(code, p); else problems.delete(code);
  if (!bridge || onPhone()) return;
  const list = [...problems.values()];
  const key = JSON.stringify(list.map(problemKey));
  if (key === sentStatus) return;
  sentStatus = key;
  bridge.post({ type: "bg:status", problems: list });
}
const DISMISSED = "ps.bg.dismissed", LAST_OK = "ps.bg.lastOk";
function store$(k: string, v?: string | null): string | null {
  try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private storage off */ }
  return null;
}
function dismissedMark() { return store$(DISMISSED); }
function markOk() { store$(LAST_OK, new Date().toISOString().replace(/\.\d+Z$/, "Z")); }
/** The phone's card: Dismiss keeps it away until the problem changes. */
export function dismissBgProblem() {
  if (snap.problem) store$(DISMISSED, problemKey(snap.problem));
  emit();
}
/** The phone's card: the code and plain details for the clipboard. */
export function bgProblemReport(): string {
  const p = snap.problem;
  if (!p) return "";
  const v = typeof __PS_VERSION__ === "object" ? `${__PS_VERSION__.name}` : "?";
  return report(p, { device: onPhone() ? "Phone" : "Mac", version: v, at: new Date(), videos: snap.list.length, here: snap.local, lastOk: store$(LAST_OK) });
}

function videos(): VaultVideo[] {
  const s = vaultStore.get();
  if (!bgAllowed(s)) return [];
  const raw = (settingsData(s) as { bgVault?: unknown }).bgVault;
  return Array.isArray(raw) ? raw.filter((v): v is VaultVideo => !!v && typeof v.id === "string" && /^[a-z0-9-]{1,48}$/.test(v.id) && Array.isArray(v.pieces)) : [];
}

export function useVaultVideos() {
  const v = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
  return { ...v, add: addVideo, dismiss: dismissBgProblem, report: bgProblemReport };
}

/** The crop as CSS for the background layer (object-position across the width). */
function cropCss(list: VaultVideo[]) {
  let el = document.getElementById("gos-bg-crop") as HTMLStyleElement | null;
  if (!el) { el = document.createElement("style"); el.id = "gos-bg-crop"; document.head.appendChild(el); }
  el.textContent = list.map((v) => `.tm-bgvideo[data-id="${v.id}"]{object-position:${Math.round(Math.max(0, Math.min(1, v.focus)) * 100)}% 50%}`).join("\n");
}

let letGo = "";   // the older copies last let go (asked once per set, never in a loop)
let fetching = false;
let downFails = 0, nextDown = 0;
/** Bring every vault video onto this device that is not here yet (one at a time, quietly). Each one is
 * downloaded once; a stopped one picks up where it stopped (the phone keeps its pieces), and a
 * failure waits 30 min, then longer, before it tries again (egress). */
async function fetchMissing() {
  if (fetching || !bridge || Date.now() < nextDown) return;
  const list = videos().filter((v) => !local.has(v.id) && !waiting.has(v.id));   // waiting: sent, the shell is writing it
  if (!list.length || !navigator.onLine) return;
  fetching = true;
  let cur: VaultVideo | null = null;
  try {
    for (const v of list) {
      cur = v;
      // The Mac's shell takes pieces in order from the first; the phone keeps each piece on its own.
      const todo = onPhone() ? piecesToFetch(v.pieces.length, partial[v.id]) : v.pieces.map((_, i) => i);
      for (let k = 0; k < todo.length; k++) {
        const i = todo[k];
        busy = `Downloading ${v.name}: ${Math.round(((v.pieces.length - todo.length + k) / v.pieces.length) * 100)}%`;
        emit();
        const bytes = await getBlob(v.pieces[i], null, { cache: false });   // never kept in memory: it is on the device now
        bridge.post({ type: "bg:put", id: v.id, name: v.name, index: i, total: v.pieces.length, data: b64(bytes) });
      }
      if (onPhone()) waiting.add(v.id); else local.add(v.id);
      delete partial[v.id];
    }
    // The phone: good only once the shell says it kept them (the bg:have handler below).
    if (waiting.size) confirmAt = postList();
    else downloadGood();
  } catch (e) {
    downFails++;
    nextDown = Date.now() + backoffMs(downFails);
    retryAt(nextDown);
    bridge.post({ type: "log", text: `background video download stopped: ${errText(e).slice(0, 80)}` });
    // A one off drop (a train tunnel) is not worth a card: the second failure in a row is.
    if (downFails >= 2) setProblem("BG-DOWNLOAD", problem("BG-DOWNLOAD", cur?.name ?? "", `downloading "${cur?.name ?? "?"}" stopped ${downFails} times in a row: ${errText(e)}`));
  } finally {
    fetching = false; busy = ""; emit(); publish();
  }
}

function downloadGood() {
  downFails = 0; nextDown = 0;
  setProblem("BG-DOWNLOAD", null);
  markOk();
}

/** Only the videos on this device can be picked as a background. The phone (V1.47): a video whose newer copy is
 *  still downloading plays its older copy meanwhile (the Mac replaces a video when its Drive file changes, and the
 *  phone used to drop the old copy at once, so the background was gone until the new one was in). */
function publish() {
  const list = videos();
  if (bridge?.crop) cropCss(list);
  const subs = standIns(list);
  bridge?.publish?.(list.filter((v) => local.has(v.id) || subs.has(v.id)).map((v) => ({ id: v.id, name: v.name, ...(local.has(v.id) ? {} : { file: subs.get(v.id) }) })));
}

// ---------- the phone: an older copy stands in while the newest downloads ----------
const NAMES = "ps.bg.names";
/** The name of every video this phone has seen in the vault (id to name, a few at most), kept on the phone only. */
function seenNames(list: VaultVideo[]): Record<string, string> {
  let o: Record<string, string> = {};
  try { const raw = JSON.parse(store$(NAMES) || "{}"); if (raw && typeof raw === "object") o = raw as Record<string, string>; } catch { /* none yet */ }
  let changed = false;
  for (const v of list) if (o[v.id] !== v.name) { o[v.id] = v.name; changed = true; }
  // Only names still useful: in the vault, or on the phone (known only once the shell has answered).
  if (answered > 0) for (const id of Object.keys(o)) if (!list.some((v) => v.id === id) && !local.has(id)) { delete o[id]; changed = true; }
  if (changed) store$(NAMES, JSON.stringify(o));
  return o;
}
/** The older copies the shell must not drop. Before its first answer the page does not know what is on the phone,
 *  so every older copy that could stand in is kept (the next list lets go of the ones not needed). */
function spareIds(list: VaultVideo[]): string[] {
  if (!onPhone() || !bridge) return [];
  if (answered > 0) return [...standIns(list).values()];
  const names = seenNames(list);
  return Object.keys(names).filter((id) => !list.some((v) => v.id === id) && list.some((v) => v.name === names[id]));
}
function standIns(list: VaultVideo[]): Map<string, string> {
  if (!onPhone() || !bridge) return new Map();
  return pickStandIns(list, local, seenNames(list));
}

/** Encrypts one video into the vault (pieces first, then the list). Returns its new id. `replaced`:
 * the old version of the same video, taken out of the list in the same save (its pieces go after). */
async function store(buf: Uint8Array, name: string, type: string, from?: string, keepId?: string, replaced?: VaultVideo, onPct?: (n: number) => void, pick?: boolean): Promise<VaultVideo> {
  busy = "Finding the best portrait crop";
  emit();
  const focus = await autoFocus(new Blob([buf as Uint8Array<ArrayBuffer>], { type })).catch(() => 0.5);
  const pieces: string[] = [];
  try {
    for (let at = 0; at < buf.length; at += PIECE) {
      busy = `Encrypting and saving: ${Math.round((at / buf.length) * 100)}%`;
      emit();
      onPct?.(at / buf.length);
      pieces.push(await putBlob(null, buf.slice(at, at + PIECE), { cache: false }));
    }
    // An older Mac copy keeps its id, so a background the developer already picked (settings.tmBg) stays picked.
    const id = keepId && !videos().some((v) => v.id === keepId) ? keepId : `v-${crypto.randomUUID().slice(0, 18)}`;
    const v: VaultVideo = { id, name: name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Video", pieces, bytes: buf.length, type, focus, addedAt: new Date().toISOString(), ...(from ? { from } : {}) };
    const patch: Record<string, unknown> = { bgVault: [...videos().filter((x) => x.id !== replaced?.id), v] };
    // The new version of the background the developer picked stays picked.
    if (replaced && (settingsData(vaultStore.get()) as { tmBg?: string }).tmBg === `video:${replaced.id}`) patch.tmBg = `video:${id}`;
    // V1.47: the phone's own pick and its crop (core/bgcrop.ts) follow the new copy too.
    if (replaced) Object.assign(patch, followReplaced(settingsData(vaultStore.get()) as Settings, replaced.id, id));
    // PS 1.65: a device whose own pick was the old copy follows it too (core/devicebg.ts).
    if (replaced) { const fp = followPicks((settingsData(vaultStore.get()) as Settings).tmBgDev, `video:${replaced.id}`, `video:${id}`); if (fp) patch.tmBgDev = fp; }
    // A video the developer just added on the phone becomes the background (it plays there as soon as the shell has it): the
    // phone's own background when it has one, else the shared one as before.
    if (pick) patch[bgKey(settingsData(vaultStore.get()) as Settings, true, (b) => bgDesign(b) === b)] = `video:${id}`;
    await saveSettings(patch as never);
    return v;
  } catch (e) {
    void dropBlobs(pieces);   // no half video left behind in the vault
    throw e;
  }
}
async function dropBlobs(ids: string[]) {
  for (const id of ids) { try { await deleteBlob(id); } catch { /* the 12 hour check sees what is left */ } }
}

/** The phone's Add a video (GosBackgrounds, and the Looks tab's Add video tile): the file must play on this
 * phone and be at most ADD_MAX, then it is encrypted into the vault (the Macs download it from there), handed
 * to the shell from memory (no download), and picked as the background. */
async function addVideo(f: File) {
  if (busy || !bridge || !bgAllowed(vaultStore.get())) return;
  const say = (t: string) => { note = t; emit(); };
  const mb = (n: number) => Math.round(n / 1e6);
  if (f.size > ADD_MAX) { say(addNote("big", f.name, mb(f.size))); return; }
  if (f.size <= 0) { say(addNote("bad", f.name)); return; }
  busy = "Checking the video plays here";
  say("");
  try {
    if (!(await playsHere(f))) { say(addNote("bad", f.name)); return; }
    const buf = new Uint8Array(await f.arrayBuffer());
    const v = await store(buf, f.name, f.type || "video/mp4", undefined, undefined, undefined, undefined, onPhone());
    // This device already has it: hand it to the shell straight from memory.
    for (let i = 0; i < v.pieces.length; i++) bridge.post({ type: "bg:put", id: v.id, name: v.name, index: i, total: v.pieces.length, data: b64(buf.slice(i * PIECE, (i + 1) * PIECE)) });
    if (onPhone()) { waiting.add(v.id); confirmAt = postList(); } else local.add(v.id);
    note = addNote("done", v.name);
  } catch (e) {
    note = addNote("failed", f.name);
    bridge.post({ type: "log", text: `adding a video failed: ${(e instanceof Error ? e.message : "").slice(0, 80)}` });
  } finally {
    busy = ""; emit(); publish();
  }
}

/** Whether this device's player can open the file (a few seconds at most). */
function playsHere(f: Blob): Promise<boolean> {
  return new Promise((ok) => {
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    let done = false;
    const end = (r: boolean) => { if (done) return; done = true; window.clearTimeout(t); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); ok(r); };
    const t = window.setTimeout(() => end(false), 15_000);
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.onloadeddata = () => end(v.videoWidth > 0 && v.videoHeight > 0);
    v.onerror = () => end(false);
    v.src = url;
  });
}

/** Asks the shell for bg:have (it also drops videos no longer in the vault). Returns the ask's number. */
function postList(): number {
  const list = videos();
  // The phone keeps an older copy that stands in for a video still downloading (publish above).
  bridge?.post({ type: "bg:list", keep: [...list.map((v) => v.id), ...spareIds(list)] });
  return ++asked;
}

// ---------- the Mac: older copies from Drive go into the vault once ----------
const pieceWait = new Map<string, (d: string | null) => void>();
function askPiece(id: string, index: number): Promise<string | null> {
  return new Promise((ok) => {
    const k = `${id}:${index}`;
    pieceWait.set(k, ok);
    bridge?.post({ type: "bg:read", id, index });
    window.setTimeout(() => { if (pieceWait.get(k) === ok) { pieceWait.delete(k); ok(null); } }, 30_000);
  });
}
let adopting = false;
let upFails = 0, nextUp = 0;
async function adoptOlder() {
  if (adopting || busy || !bridge || !older.length || !navigator.onLine || !bgAllowed(vaultStore.get()) || Date.now() < nextUp) return;
  adopting = true;
  let cur: Older | null = null;
  try {
    for (const o of [...older]) {
      cur = o;
      // Already in the vault (this Mac before, or another Mac first): only marked here.
      const twin = twinOf(videos(), o);
      if (twin) { bridge.post({ type: "bg:adopt", from: o.id, id: twin.id }); local.add(twin.id); continue; }
      const total = Math.ceil(o.size / PIECE), parts: Uint8Array[] = [];
      // A video the developer added with Add video: the Mac's progress card shows how far it is (reading 0 to 20%, saving to 100%).
      let lastPct = -1;
      const tell = (f: number) => { const pct = Math.round(f * 100); if (o.added && pct !== lastPct) { lastPct = pct; bridge?.post({ type: "bg:progress", id: o.id, pct }); } };
      for (let i = 0; i < total; i++) {
        busy = `Putting ${o.name} in your vault: ${Math.round((i / total) * 100)}%`;
        emit();
        tell((i / total) * 0.2);
        const d = await askPiece(o.id, i);
        if (!d) throw new Error("the shell did not hand over a piece");
        parts.push(unb64(d));
      }
      const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      parts.reduce((at, p) => { buf.set(p, at); return at + p.length; }, 0);
      if (buf.length !== o.size) throw new Error("a video changed while it was read");
      // A changed file in the Drive folder: its old version is in the vault under the same id.
      const replaced = videos().find((v) => v.id === o.id);
      const v = await store(buf, o.name, "video/mp4", driveFrom(o), o.id, replaced, (f) => tell(0.2 + f * 0.8));
      tell(1);
      bridge.post({ type: "bg:adopt", from: o.id, id: v.id });
      local.add(v.id);
      if (replaced) { local.delete(replaced.id); void dropBlobs(replaced.pieces); }
    }
    older = [];
    upFails = 0; nextUp = 0;
    setProblem("BG-UPLOAD", null); setProblem("BG-QUOTA", null);
    markOk();
  } catch (e) {
    upFails++;
    nextUp = Date.now() + backoffMs(upFails);
    retryAt(nextUp);
    bridge.post({ type: "log", text: `putting videos in the vault stopped: ${errText(e).slice(0, 80)}` });
    const code = uploadCode(e), name = cur?.name ?? "";
    const detail = `putting "${name}" (${Math.round((cur?.size ?? 0) / 1e6)} MB) in the vault failed ${upFails} time${upFails === 1 ? "" : "s"} in a row: ${errText(e)}`;
    setProblem(code === "BG-QUOTA" ? "BG-UPLOAD" : "BG-QUOTA", null);
    // A video the developer just added himself: the card at once (he is waiting for it).
    if (code === "BG-QUOTA" || upFails >= 2 || cur?.added) setProblem(code, problem(code, name, detail));
  } finally {
    adopting = false; busy = ""; emit(); publish();
  }
}

/** Videos that left the developer's Drive folder leave the vault (and every device); their pieces are deleted. */
let removing = false;
async function removeGone() {
  if (removing || !gone.length || !bgAllowed(vaultStore.get())) return;
  const out = videos().filter((v) => gone.includes(v.id));
  // Already out of the vault: the shell only needs the list again to let go of its copy.
  if (!out.length) { postList(); return; }
  removing = true;
  try {
    await saveSettings({ bgVault: videos().filter((v) => !gone.includes(v.id)) } as never);
    for (const v of out) await dropBlobs(v.pieces);
    setProblem("BG-REMOVE", null);
  } catch (e) {
    setProblem("BG-REMOVE", problem("BG-REMOVE", out[0].name, `taking "${out[0].name}" out of the vault failed: ${errText(e)}`));
  } finally { removing = false; }
}

/** The 12 hour check (the Mac with the folder asks): the vault still holds every piece of every video
 * (ids only, a few bytes each). A folder video with a lost piece is taken out, so the Mac puts it back. */
async function vaultCheck() {
  const list = videos();
  if (!list.length || !navigator.onLine) return;
  try {
    const broken = brokenVideos(list, await blobsPresent(list.flatMap((v) => v.pieces)));
    const fixable = broken.filter((v) => drive.has(v.id)), other = broken.filter((v) => !drive.has(v.id));
    if (fixable.length) {
      await saveSettings({ bgVault: videos().filter((v) => !fixable.some((f) => f.id === v.id)) } as never);
      for (const v of fixable) await dropBlobs(v.pieces);
      bridge?.post({ type: "log", text: `12 hour check: ${fixable.length} video(s) missing pieces go back in` });
    }
    setProblem("BG-VAULT-MISSING", other.length ? problem("BG-VAULT-MISSING", other[0].name, `${other.length} video(s) miss pieces in the vault (first: "${other[0].name}")`) : null);
    if (!broken.length) markOk();
  } catch (e) {
    bridge?.post({ type: "log", text: `12 hour vault check stopped: ${errText(e).slice(0, 80)}` });
  }
}

let retryTimer = 0;
/** Tries again when a wait after a failure is over (the shell answers bg:list with bg:have). */
function retryAt(at: number) {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => { ask(); }, Math.max(1000, at - Date.now() + 1000));
}
function ask() {
  const s = vaultStore.get();
  if (!bridge || !bgAllowed(s) || ![...s.docs.values()].some((d) => d.kind === "settings")) return;
  postList();
}

/** Samples 6 frames at 64 px high and picks the 9:16 window with the most edges in it. */
async function autoFocus(f: Blob): Promise<number> {
  const url = URL.createObjectURL(f);
  try {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
    await new Promise<void>((ok, bad) => { v.onloadeddata = () => ok(); v.onerror = () => bad(new Error("no video")); });
    const h = 64, w = Math.max(1, Math.round((v.videoWidth / v.videoHeight) * h));
    const win = Math.round(h * 9 / 16);
    if (w <= win) return 0.5;   // already portrait
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    const energy = new Float64Array(w);
    for (let k = 1; k <= 6; k++) {
      v.currentTime = (v.duration || 1) * k / 7;
      await new Promise<void>((ok) => { v.onseeked = () => ok(); });
      g.drawImage(v, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) {
        const i = (y * w + x) * 4, j = i - 4;
        energy[x] += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
      }
    }
    let best = 0, bestAt = 0, sum = 0;
    for (let x = 0; x < win; x++) sum += energy[x];
    best = sum;
    for (let x = win; x < w; x++) { sum += energy[x] - energy[x - win]; if (sum > best) { best = sum; bestAt = x - win + 1; } }
    return (bestAt) / Math.max(1, w - win);   // object-position: 0 = left edge, 1 = right edge
  } finally { URL.revokeObjectURL(url); }
}

function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string) {
  const b = atob(s), out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function startBgVault(b: BgBridge) {
  if (bridge) return;
  bridge = b;
  b.listen((m) => {
    if (m.type === "bg:piece" && typeof m.id === "string" && typeof m.index === "number") {
      const k = `${m.id}:${m.index}`, f = pieceWait.get(k);
      if (f) { pieceWait.delete(k); f(typeof m.data === "string" ? m.data : null); }
      return;
    }
    if (m.type !== "bg:have" || !Array.isArray(m.ids)) return;
    const okId = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9-]{1,48}$/.test(x);
    local = new Set((m.ids as unknown[]).filter(okId));
    answered++;
    // The phone: the answer to the ask made after a video's last piece. Missing still means the shell could
    // not keep it: that is a failed download (wait, then only its missing pieces again), not an endless retry.
    if (waiting.size && answered >= confirmAt) {
      const lost = notKept(waiting, local);
      waiting.clear();
      if (!lost.length) downloadGood();
      else {
        downFails++;
        nextDown = Date.now() + backoffMs(downFails);
        retryAt(nextDown);
        b.post({ type: "log", text: `background video not kept by the phone: ${lost.length}` });
        const name = videos().find((v) => v.id === lost[0])?.name ?? "";
        if (downFails >= 2) setProblem("BG-DOWNLOAD", problem("BG-DOWNLOAD", name, `the phone did not keep "${name}" after downloading it, ${downFails} times in a row`));
      }
    }
    older = Array.isArray(m.older) ? (m.older as unknown[]).filter((o): o is Older =>
      !!o && okId((o as { id?: unknown }).id)
      && typeof (o as { name?: unknown }).name === "string" && typeof (o as { size?: unknown }).size === "number" && (o as { size: number }).size > 0)
      .map((o) => ({ id: o.id, name: o.name, size: o.size, ...(typeof o.sig === "string" && /^[0-9-]{1,40}$/.test(o.sig) ? { sig: o.sig } : {}), ...(o.replaces === true ? { replaces: true } : {}), ...(o.added === true ? { added: true } : {}) })) : [];
    gone = Array.isArray(m.gone) ? (m.gone as unknown[]).filter(okId) : [];
    if (Array.isArray(m.drive)) drive = new Set((m.drive as unknown[]).map((d) => (d as { id?: unknown })?.id).filter(okId));
    partial = {};
    if (m.partial && typeof m.partial === "object") {
      for (const [id, v] of Object.entries(m.partial as Record<string, unknown>)) if (okId(id) && Array.isArray(v)) partial[id] = v.filter((i): i is number => Number.isInteger(i));
    }
    // The 12 hour check: everything is tried again now, whatever a failure said to wait.
    if (m.check === true) { nextUp = 0; nextDown = 0; }
    emit(); publish();
    // The phone: an older copy that no longer stands in for anything (its newer copy is here) is let go, once.
    if (onPhone()) {
      const list = videos(), keep = new Set([...list.map((v) => v.id), ...standIns(list).values()]);
      const extra = [...local].filter((id) => !keep.has(id)).sort().join(",");
      if (extra && extra !== letGo) { letGo = extra; postList(); }
    }
    void removeGone().then(() => fetchMissing()).then(() => adoptOlder()).then(() => (m.check === true ? vaultCheck() : undefined));
  });
  let last = "";
  vaultStore.subscribe(() => {
    const s = vaultStore.get();
    if (!bgAllowed(s)) return;   // locked, or not the developer: keep what the device has, ask for nothing
    // Not before the settings are in: an empty list too early would remove every video here.
    if (![...s.docs.values()].some((d) => d.kind === "settings")) return;
    const key = JSON.stringify(videos().map((v) => v.id));
    if (key === last) return;
    last = key;
    emit();
    postList();   // the shell answers with bg:have (and drops removed ones)
  });
  // Every 12 hours: the device makes sure it has every video in the vault (the phone's own refresh;
  // the Mac with the folder also runs its full check on its own clock).
  lpInterval("backgrounds", () => { nextDown = 0; ask(); }, 12 * 3600_000, { catchUp: false });   // PS 1.65: asleep in Low power mode
}
