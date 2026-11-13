// Share a sound in the G Squad (V1.47, the Soundboard; the developer: "If possible, a Share button to share it in the G Squad").
// Two ways, both from a file's menu in the Soundboard:
//  1. Share the sound: an audio file of up to 10 MB is sealed with the squad key on this device (AES-256-GCM, 512 KB
//     pieces) and put on the hub through its own function `sb` (supabase/hub/functions/sb, tables sb_*). Squad members
//     see it under "From your squad" in their Soundboard and can save it into their own. It leaves the hub after 14
//     days. The hub only ever holds ciphertext, sizes and times.
//  2. Share the name and a note: one chat message ("Shared a sound: <name>"), nothing uploaded.
// Free plan care (500 MB database, 5 GB egress a month): 10 MB a file, 15 files and 80 MB per squad at once, 5 shares a
// member a day; the list is read only when the Soundboard's squad tab opens (no polling), each download is read once.
// Runs on the page that holds the squad keys (PS's main page on the Mac, the phone app). The Mac's Tab list sends
// `sbOp` to the main page and reads back the plain view (`sbsq` in the state), like the rest of G Squad.
// The website never talks to the hub (squad/engine.ts): it says so.
import { useSyncExternalStore } from "react";
import { PS } from "../ps";
import { GOS } from "../gos/bridge";
import { squadRecNow, squadView } from "./engine";
import { runChatOp } from "./chatengine";
import { open, seal } from "../core/squadcrypto";
import { SbError, openPart, sbAad, sbCall, sealPart } from "../core/sbseal";
import { currentKey, keyFor } from "../core/squadrec";
import { SHARE_MAX, SHARE_PART, SHARE_NOTE_MAX, canShare, extOf, oneLine, partsFor, sizeWords, AUDIO_EXT, type MediaItem } from "../core/soundboard";
import { mediaUrl, putBytes, readBytes, sbState, setPassive, startSb } from "../soundboard/store";
import { b64, unb64 } from "../core/crypto";

export interface SharedSound { id: string; by: string; mine: boolean; name: string; note: string; ext: string; size: number; at: string; until: string; parts: number; gen: number; pack: string }
export interface ShareView { files: SharedSound[]; busy: string | null; note: { text: string; bad: boolean } | null; loaded: boolean; can: boolean; saved: string[] }
export type SbOp =
  | { op: "list" }
  | { op: "share"; id: string; name: string; ext: string; size: number; note: string }
  | { op: "name"; name: string; note: string }
  | { op: "fetch"; file: string }
  | { op: "del"; file: string }
  // The Mac's Tab list hands a file it holds (an alarm library sound) to the main page in pieces, to be shared.
  | { op: "put"; tmp: string; n: number; parts: number; b64: string; name: string; ext: string; pack: string };

const EMPTY: ShareView = { files: [], busy: null, note: null, loaded: false, can: false, saved: [] };
let view: ShareView = EMPTY;
const subs = new Set<() => void>();
function set(p: Partial<ShareView>) { view = { ...view, ...p }; subs.forEach((f) => f()); }
export const sbShareView = () => view;
export const sbShareStore = { subscribe: (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; }, get: () => view };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO = new Set<string>(AUDIO_EXT);
export function cleanSbOp(v: unknown): SbOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const note = oneLine(o.note, SHARE_NOTE_MAX);
  switch (o.op) {
    case "list": return { op: "list" };
    case "share": {
      const ext = typeof o.ext === "string" ? o.ext.toLowerCase() : "";
      const size = Number(o.size);
      if (typeof o.id !== "string" || !/^[0-9a-f]{16}$/.test(o.id) || !AUDIO.has(ext) || !(size > 0 && size <= SHARE_MAX)) return null;
      return { op: "share", id: o.id, name: oneLine(o.name, 120) || "Untitled", ext, size, note };
    }
    case "name": { const name = oneLine(o.name, 120); return name ? { op: "name", name, note } : null; }
    case "fetch": case "del": return typeof o.file === "string" && UUID.test(o.file) ? { op: o.op, file: o.file.toLowerCase() } : null;
    case "put": {
      const ext = typeof o.ext === "string" ? o.ext.toLowerCase() : "";
      const parts = Number(o.parts), n = Number(o.n);
      if (typeof o.tmp !== "string" || !/^[0-9a-f]{16}$/.test(o.tmp) || !AUDIO.has(ext) || !Number.isInteger(parts) || parts < 1 || parts > 24
        || !Number.isInteger(n) || n < 0 || n >= parts || typeof o.b64 !== "string" || o.b64.length > 720_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.b64)) return null;
      return { op: "put", tmp: o.tmp, n, parts, b64: o.b64, name: oneLine(o.name, 120) || "Untitled", ext, pack: oneLine(o.pack, 60) };
    }
  }
  return null;
}

// ---------- the hub ----------
const aad = sbAad;
async function call<T>(act: string, args: unknown): Promise<T> {
  const rec = squadRecNow();
  if (!rec) throw new Error("You are not in a squad.");
  try { return await sbCall<T>(rec, act, args); }
  catch (e) { throw new Error(hubWords(e instanceof SbError ? e.message : "")); }
}
function hubWords(e: string): string {
  if (e === "squad full") return "Your squad's shared sounds are full (15 files or 80 MB). Older ones leave after 14 days, or take one of yours off.";
  if (e === "too many today") return "You have shared 5 sounds today. Try again tomorrow.";
  if (e === "not a member") return "You are not in a squad any more.";
  if (e === "clock") return "This device's clock is off. Set the time automatically and try again.";
  if (e === "gone") return "That sound has left the hub.";
  return "The squad could not be reached. Try again in a moment.";
}

type Row = { id: string; member_id: string; meta_ct: string; gen: number; parts: number; size: number; created_at: string; expires_at: string };
async function list() {
  const rec = squadRecNow();
  if (!rec) { set({ files: [], loaded: true, can: false }); return; }
  set({ busy: "Looking", can: true });
  try {
    const r = await call<{ files: Row[] }>("sb_list", {});
    const names = new Map(squadView().members.map((m) => [m.id, m.me ? "You" : m.name]));
    const files: SharedSound[] = [];
    for (const x of r.files) {
      const raw = keyFor(rec, x.gen);
      if (!raw) continue;
      try {
        const m = await open<{ n: string; e: string; s: number; t: string; p?: string }>(raw, x.meta_ct, aad.meta(rec.squadId, x.id));
        const ext = typeof m.e === "string" ? m.e.toLowerCase() : "";
        if (!AUDIO.has(ext)) continue;
        files.push({ id: x.id, by: names.get(x.member_id) || "Someone", mine: x.member_id === rec.memberId, name: oneLine(m.n, 120) || "Untitled",
          note: oneLine(m.t, SHARE_NOTE_MAX), ext, size: Number(m.s) || 0, at: x.created_at, until: x.expires_at, parts: x.parts, gen: x.gen, pack: oneLine(m.p, 60) });
      } catch { /* not sealed for us, or tampered: never shown */ }
    }
    set({ files, loaded: true, busy: null });
  } catch (e) { set({ busy: null, loaded: true, note: { text: e instanceof Error ? e.message : "Could not load.", bad: true } }); }
}
async function share(o: Extract<SbOp, { op: "share" }>) {
  const rec = squadRecNow();
  if (!rec) throw new Error("Join a squad first (the G Squad button).");
  const it = sbState().lib.items.find((i) => i.id === o.id) ?? ({ id: o.id, name: o.name, ext: o.ext, kind: "audio", size: o.size, folder: "", added: 0 } as MediaItem);
  const ok = canShare(it);
  if (!ok.ok) throw new Error(ok.why);
  set({ busy: `Sealing "${o.name}"`, note: null });
  await shareBytes(await readBytes(it), o.name, o.ext, o.note, "");
}
/** Seals and uploads a sound (a Soundboard file, or an alarm library file with its pack name). */
async function shareBytes(bytes: Uint8Array, name: string, ext: string, note: string, pack: string) {
  const rec = squadRecNow();
  if (!rec) throw new Error("Join a squad first (the G Squad button).");
  if (!AUDIO.has(ext)) throw new Error("Only audio files can be shared in the squad.");
  if (bytes.length > SHARE_MAX) throw new Error(`Up to ${sizeWords(SHARE_MAX)} can be shared.`);
  const o = { name, ext, note };
  set({ busy: `Sealing "${name}"`, note: null });
  const { raw, gen } = currentKey(rec);
  const file = crypto.randomUUID();
  const parts = partsFor(bytes.length);
  const meta = await seal(raw, { n: o.name, e: o.ext, s: bytes.length, t: o.note, ...(pack ? { p: pack } : {}) }, aad.meta(rec.squadId, file));
  for (let n = 0; n < parts; n++) {
    set({ busy: `Sharing "${o.name}" ${Math.round((n / parts) * 100)}%` });
    const data = await sealPart(raw, bytes.subarray(n * SHARE_PART, (n + 1) * SHARE_PART), aad.part(rec.squadId, file, n));
    await call("sb_put", n === 0 ? { id: file, n, parts, gen, size: bytes.length, meta, data } : { id: file, n, data });
  }
  // A line in the chat so the squad sees it (the words only; the sound itself is in the Soundboard).
  sendChat(`Shared a sound: ${o.name}${o.note ? `. ${o.note}` : ""}`, o.name);
  set({ busy: null, note: { text: `"${o.name}" is shared with your squad for 14 days.`, bad: false } });
  await list();
}
function sendChat(text: string, label: string) {
  try { void runChatOp({ op: "send", text: text.slice(0, 1900), a: { k: "sound", l: label.slice(0, 140) } }); } catch { /* the chat is its own part */ }
}
/** One shared sound, opened (from the hub, piece by piece). */
async function fetchBytes(fileId: string): Promise<{ f: SharedSound; bytes: Uint8Array } | null> {
  const rec = squadRecNow();
  if (rec && !view.files.some((x) => x.id === fileId)) await list();
  const f = view.files.find((x) => x.id === fileId);
  if (!rec || !f) return null;
  const raw = keyFor(rec, f.gen);
  if (!raw) throw new Error("That sound was sealed with a key this device does not have.");
  const out: Uint8Array[] = [];
  for (let n = 0; n < f.parts; n++) {
    set({ busy: `Saving "${f.name}" ${Math.round((n / f.parts) * 100)}%` });
    const r = await call<{ data: string }>("sb_get", { id: fileId, n });
    out.push(await openPart(raw, r.data, aad.part(rec.squadId, fileId, n)));
  }
  const all = new Uint8Array(out.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of out) { all.set(p, at); at += p.length; }
  set({ busy: null });
  return { f, bytes: all };
}
async function fetchOne(fileId: string) {
  const got = await fetchBytes(fileId);
  if (!got) return;
  const { f, bytes: all } = got;
  await putBytes(f.name, f.ext, all);
  set({ busy: null, saved: [...view.saved, fileId], note: { text: `"${f.name}" is in your Soundboard, in "From your squad".`, bad: false } });
}

const incoming = new Map<string, { parts: (Uint8Array | null)[]; at: number }>();
/** Runs one op on the page with the keys. */
export async function runSbOp(o: SbOp): Promise<void> {
  if (PS && (window as Window & { __psOverlay?: unknown }).__psOverlay) return;   // never on the Tab list page
  setPassive();
  try {
    switch (o.op) {
      case "list": await list(); return;
      case "share": await share(o); return;
      case "name": {
        if (!squadRecNow()) throw new Error("Join a squad first (the G Squad button).");
        sendChat(`Sound: ${o.name}${o.note ? `. ${o.note}` : ""}`, o.name);
        set({ note: { text: "Sent to your squad's chat.", bad: false } });
        return;
      }
      case "fetch": await fetchOne(o.file); return;
      case "del": await call("sb_del", { id: o.file }); await list(); return;
      case "put": {
        const now = Date.now();
        for (const [k, v] of incoming) if (now - v.at > 5 * 60_000) incoming.delete(k);
        const got = incoming.get(o.tmp) ?? { parts: new Array<Uint8Array | null>(o.parts).fill(null), at: now };
        got.parts[o.n] = unb64(o.b64);
        incoming.set(o.tmp, got);
        if (got.parts.some((x) => !x)) return;
        incoming.delete(o.tmp);
        const all = new Uint8Array(got.parts.reduce((a, x) => a + x!.length, 0));
        let at = 0; for (const x of got.parts) { all.set(x!, at); at += x!.length; }
        await shareBytes(all, o.name, o.ext, "", o.pack);
        return;
      }
    }
  } catch (e) { set({ busy: null, note: { text: e instanceof Error ? e.message : "Something went wrong.", bad: true } }); }
}

// ---------- the Tab list's copy (Mac) ----------
let mirror: ShareView = EMPTY;
const mirrorSubs = new Set<() => void>();
export function setSbMirror(v: unknown) {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  const next: ShareView = !o ? EMPTY : {
    files: (Array.isArray(o.files) ? o.files : []).slice(0, 20).map((x: Record<string, unknown>) => ({
      id: String(x.id || "").slice(0, 40), by: oneLine(x.by, 40), mine: x.mine === true, name: oneLine(x.name, 120), note: oneLine(x.note, SHARE_NOTE_MAX),
      ext: extOf(`x.${String(x.ext || "")}`), size: Number(x.size) || 0, at: String(x.at || "").slice(0, 40), until: String(x.until || "").slice(0, 40), parts: Number(x.parts) || 1, gen: Number(x.gen) || 1, pack: oneLine(x.pack, 60) })),
    busy: typeof o.busy === "string" ? o.busy.slice(0, 120) : null,
    note: o.note && typeof o.note === "object" ? { text: oneLine((o.note as { text?: unknown }).text, 200), bad: (o.note as { bad?: unknown }).bad === true } : null,
    loaded: o.loaded === true, can: o.can === true,
    saved: (Array.isArray(o.saved) ? o.saved : []).filter((x): x is string => typeof x === "string").slice(-40),
  };
  if (JSON.stringify(next) === JSON.stringify(mirror)) return;
  mirror = next;
  mirrorSubs.forEach((f) => f());
}
const tabList = () => PS && !!(window as Window & { __psOverlay?: unknown }).__psOverlay;
const mirrorStore = { subscribe: (l: () => void) => { mirrorSubs.add(l); return () => { mirrorSubs.delete(l); }; }, get: () => mirror };
export function useSbShare(): ShareView {
  const s = tabList() ? mirrorStore : sbShareStore;
  return useSyncExternalStore(s.subscribe, s.get);
}
/** Where sharing works: PS on the Mac and the phone (the website never talks to the hub). */
export const shareHere = () => PS || GOS;
type W = Window & { webkit?: { messageHandlers?: { ps?: { postMessage(m: string): void } } } };
export function sbOp(o: SbOp) {
  if (!shareHere()) return;
  if (!tabList()) { void runSbOp(o); return; }
  try { (window as W).webkit?.messageHandlers?.ps?.postMessage(JSON.stringify({ type: "looks", patch: { sbOp: o } })); } catch { /* not inside PS */ }
}
export function clearShareNote() { if (tabList()) { mirror = { ...mirror, note: null }; mirrorSubs.forEach((f) => f()); } else set({ note: null }); }

// ---------- the alarm libraries (V1.47, the alarm playlist chat): three window events, no imports between us ----------
// "ps-sound-share" {file, name, pack, done?}: seal and share an alarm library sound in the squad, with its pack name.
// "ps-squad-sounds" {reply(list)}: the squad's shared sounds [{id, name, ext, size, by, pack, until}].
// "ps-squad-sound-get" {id, reply(file, why?)}: one of them, opened, as a File. On the Mac's Tab list each goes through
// the main page (it holds the keys); a sound fetched there lands in the Soundboard's "From your squad" first.
type Done = (text: string, bad: boolean) => void;
const NOT_HERE = "Sharing in the squad works in PS app on the Mac and the phone.";
const viewNow = () => (tabList() ? mirror : view);
function waitView(ok: (v: ShareView) => boolean, ms: number): Promise<ShareView> {
  return new Promise((res) => {
    const st = tabList() ? mirrorStore : sbShareStore;
    if (ok(st.get())) { res(st.get()); return; }
    let off = () => {};
    const t = window.setTimeout(() => { off(); res(st.get()); }, ms);
    off = st.subscribe(() => { if (ok(st.get())) { window.clearTimeout(t); off(); res(st.get()); } });
  });
}
const listed = (v: ShareView) => v.files.map((f) => ({ id: f.id, name: f.name, ext: f.ext, size: f.size, by: f.by, pack: f.pack, until: f.until }));
async function soundShare(file: File, name: string, pack: string, done?: Done) {
  const tell = (text: string, bad: boolean) => { try { done?.(text, bad); } catch { /* theirs */ } };
  const ext = extOf(file.name);
  const nm = oneLine(name, 120) || "Untitled";
  if (!AUDIO.has(ext)) { tell("Only audio files can be shared in the squad.", true); return; }
  if (file.size > SHARE_MAX) { tell(`Up to ${sizeWords(SHARE_MAX)} can be shared.`, true); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!tabList()) {
    try { setPassive(); await shareBytes(bytes, nm, ext, "", oneLine(pack, 60)); tell(view.note?.text || `"${nm}" is shared with your squad for 14 days.`, false); }
    catch (e) { const t = e instanceof Error ? e.message : "Something went wrong."; set({ busy: null, note: { text: t, bad: true } }); tell(t, true); }
    return;
  }
  const before = mirror.note;
  const tmp = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const parts = partsFor(bytes.length);
  for (let n = 0; n < parts; n++) sbOp({ op: "put", tmp, n, parts, b64: b64(bytes.subarray(n * SHARE_PART, (n + 1) * SHARE_PART)), name: nm, ext, pack: oneLine(pack, 60) });
  const v = await waitView((x) => !x.busy && !!x.note && x.note !== before, 180_000);
  if (v.note && v.note !== before) tell(v.note.text, v.note.bad); else tell("The squad did not answer in time.", true);
}
async function soundGet(id: string): Promise<{ file: File | null; why?: string }> {
  if (!tabList()) {
    try { setPassive(); const got = await fetchBytes(id); if (!got) return { file: null, why: "That sound has left the hub." };
      return { file: new File([got.bytes as BlobPart], `${got.f.name}.${got.f.ext}`) }; }
    catch (e) { set({ busy: null }); return { file: null, why: e instanceof Error ? e.message : "Could not open it." }; }
  }
  // The Tab list: the main page opens it into the Soundboard ("From your squad"); then it is read back from there.
  startSb();
  const f = mirror.files.find((x) => x.id === id);
  if (!f) return { file: null, why: "That sound has left the hub." };
  const had = new Set(sbState().lib.items.map((i) => i.id));
  sbOp({ op: "fetch", file: id });
  const it = await new Promise<import("../core/soundboard").MediaItem | null>((res) => {
    const t0 = Date.now();
    const look = () => {
      const x = sbState().lib.items.find((i) => !had.has(i.id) && i.folder === "From your squad" && i.ext === f.ext);
      if (x) res(x); else if (Date.now() - t0 > 90_000) res(null); else window.setTimeout(look, 400);
    };
    look();
  });
  if (!it) return { file: null, why: mirror.note?.bad ? mirror.note.text : "The sound did not arrive in time." };
  const url = await mediaUrl(it);
  if (!url) return { file: null, why: "Could not read it back." };
  const blob = await (await fetch(url)).blob();
  return { file: new File([blob], `${f.name}.${f.ext}`) };
}
let eventsOn = false;
export function startSoundEvents() {
  if (eventsOn || typeof window === "undefined") return;
  eventsOn = true;
  window.addEventListener("ps-sound-share", (e) => {
    const d = (e as CustomEvent<{ file?: File; name?: string; pack?: string; done?: Done }>).detail;
    if (!d || !(d.file instanceof Blob)) return;
    e.preventDefault();
    if (!shareHere()) { try { d.done?.(NOT_HERE, true); } catch { /* theirs */ } return; }
    void soundShare(d.file as File, d.name || (d.file as File).name || "", d.pack || "", d.done);
  });
  window.addEventListener("ps-squad-sounds", (e) => {
    const d = (e as CustomEvent<{ reply?: (list: unknown[]) => void }>).detail;
    if (typeof d?.reply !== "function") return;
    e.preventDefault();
    if (!shareHere()) { d.reply([]); return; }
    const v = viewNow();
    if (v.loaded) { d.reply(listed(v)); sbOp({ op: "list" }); return; }
    sbOp({ op: "list" });
    void waitView((x) => x.loaded, 20_000).then((x) => d.reply!(listed(x)));
  });
  window.addEventListener("ps-squad-sound-get", (e) => {
    const d = (e as CustomEvent<{ id?: string; reply?: (file: File | null, why?: string) => void }>).detail;
    if (typeof d?.reply !== "function" || typeof d.id !== "string") return;
    e.preventDefault();
    if (!shareHere()) { d.reply(null, NOT_HERE); return; }
    if (!UUID.test(d.id)) { d.reply(null, "That sound has left the hub."); return; }
    void soundGet(d.id.toLowerCase()).then((r) => d.reply!(r.file, r.why));
  });
}
startSoundEvents();
