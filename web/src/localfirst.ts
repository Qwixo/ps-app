// Local first (V1.44), the app's side: Start now, opening the local vault at launch, Turn on sync with its move into
// the person's new synced vault, the backup file, and the state the screens show. The safety rules live in
// core/localstore.ts (the local vault) and core/move.ts (the move); this file only decides WHEN, and never deletes.
//
// Where it runs: PS on the Mac (main page, the one that holds the vault; the Tab list asks it through "looks"), PS GOS
// and the mobile web app. Not on the website (cincee.com/client stays as it is), and never for the developer's own account: the
// move gate stands aside for the developer (core/vault.ts finishUnlock) and Start now only shows on a device nobody signed in on.
import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, type Settings } from "./core/model";
import { localKv, keepStorage } from "./core/localidb";
import { deviceHolder, localKeyMessage, shellHolder } from "./core/localholders";
import { createLocalVault, discardLocalBackup, loadLocalRows, nudgeDue, openLocalVault, readHead, updateHead, type KeyHolder, type LocalHead } from "./core/localstore";
import { type MoveProgress, type Payload } from "./core/move";
import { moveIntoAccount, type GateChoice } from "./core/movegate";
import { backupFileName, makeBackup, openBackup, planImport } from "./core/backup";
import * as C from "./core/crypto";
import { saveSettings } from "./core/actions";
import { PROJECT, docs, lastUsername, lock, put, seedNewOwner, setMoveGate, sync, unlockLocal, vaultStore } from "./core/vault";

type W = Window & { webkit?: { messageHandlers?: { ps?: { postMessage(m: string): void } } }; gosNative?: { postMessage(m: string): void }; __psMobile?: unknown };
const MODE = import.meta.env.MODE;
const isPs = MODE === "ps", isGos = MODE === "gos";
const isMweb = !isGos && (globalThis as { __psMobile?: unknown }).__psMobile === true;
/** Which kind of device this is, for local first. null: the website (no local first there). */
export const LOCAL_PLATFORM: "mac" | "phone" | "web" | null = isPs ? "mac" : isGos ? "phone" : isMweb ? "web" : null;
/** The page that holds the vault (not PS's Tab list or Second Computer window, which hold no keys). */
const mainPage = () => typeof location !== "undefined" && !(isPs && /\/(overlay|second-window|fitview)\/?$/.test(location.pathname));

const psPost = (m: object) => (window as W).webkit?.messageHandlers?.ps?.postMessage(JSON.stringify(m));
const gosPost = (m: object) => (window as W).gosNative?.postMessage(JSON.stringify(m));
let keychain: ReturnType<typeof shellHolder> | null = null;
function holders(): KeyHolder[] {
  if (LOCAL_PLATFORM === "mac") return [keychain ??= shellHolder("keychain", psPost)];
  if (LOCAL_PLATFORM === "phone") return [shellHolder("keystore", gosPost), deviceHolder];
  return [deviceHolder];
}
export { localKeyMessage };

// ---------- state the screens read ----------
export type MoveView =
  | { phase: "idle" }
  | { phase: "confirm"; count: number; existing: number }
  | { phase: "running"; progress: MoveProgress | null; count: number }
  | { phase: "failed"; code: string; message: string; failed: number; unreadable: boolean }
  | { phase: "key"; denied: boolean }
  | { phase: "done"; count: number };
/** What PS's Tab list gets from the main page (it holds no vault): the last note, and the copy kept after a move. */
export interface LocalMirror { note: string | null; backup: { movedAt: string; count: number } | null }
export interface LocalView {
  mirror: LocalMirror | null;     // PS's Tab list only
  ready: boolean;                 // the head was read once
  head: LocalHead | null;
  open: "idle" | "opening" | "denied" | "lost" | "error";
  error: string | null;
  move: MoveView;
  note: string | null;            // the last export or import, in plain words
}
let view: LocalView = { mirror: null, ready: false, head: null, open: "idle", error: null, move: { phase: "idle" }, note: null };
const subs = new Set<() => void>();
function set(p: Partial<LocalView>) { view = { ...view, ...p }; subs.forEach((f) => f()); }
export const localView = () => view;
export function localSubscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
/** Main page: what the Tab list needs. */
export function localMirrorOut(): LocalMirror | null {
  const h = view.head;
  const backup = h && h.state === "moved" ? { movedAt: h.movedAt || "", count: h.move?.verified?.count ?? 0 } : null;
  return view.note || backup ? { note: view.note, backup } : null;
}
/** The Tab list: the main page's copy. */
export function setLocalMirror(v: unknown) {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : null;
  const b = o?.backup && typeof o.backup === "object" ? o.backup as Record<string, unknown> : null;
  const next: LocalMirror | null = o ? { note: typeof o.note === "string" ? o.note.slice(0, 300) : null,
    backup: b && typeof b.movedAt === "string" ? { movedAt: b.movedAt, count: Number(b.count) || 0 } : null } : null;
  if (JSON.stringify(next) !== JSON.stringify(view.mirror)) set({ mirror: next });
}
export function useLocalView(): LocalView {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => view);
}

// ---------- when a move is wanted ----------
const projectId = () => PROJECT.ref || PROJECT.url;
/** A synced vault of the person's own is linked here and they asked to turn on sync (or a move already started). */
export function syncWanted(h: LocalHead | null): boolean {
  if (!h || h.state === "moved" || !PROJECT.custom || LOCAL_PLATFORM === "phone" || LOCAL_PLATFORM === null) return false;
  if (h.snoozedFor && h.snoozedFor === projectId()) return false;
  return !!h.syncIntent || h.state === "moving";
}
async function refreshHead(): Promise<LocalHead | null> {
  const h = (await readHead(localKv).catch(() => undefined)) ?? null;
  set({ head: h, ready: true });
  return h;
}
/** Is there a local vault database at all? Lets a device that never used local first skip opening one. */
async function maybeHasLocal(): Promise<boolean> {
  try {
    const list = await (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases?.();
    return Array.isArray(list) ? list.some((d) => d.name === "ps-local-vault") : true;
  } catch { return true; }
}

// ---------- launch ----------
/** Before a browser reopens a saved session: a move waiting means the person signs in again, so it runs first. */
export async function localMoveWanted(): Promise<boolean> {
  if (!LOCAL_PLATFORM || !mainPage() || !(await maybeHasLocal())) return false;
  return syncWanted(await refreshHead());
}
let booted = false;
/** Main page, once at launch: open the local vault (no password), or stand ready to move it. */
export async function bootLocal(): Promise<void> {
  if (booted || !LOCAL_PLATFORM || !mainPage()) { set({ ready: true }); return; }
  booted = true;
  if (!(await maybeHasLocal())) { set({ ready: true }); return; }
  const h = await refreshHead();
  if (!h || h.state === "moved") return;
  armGate();
  if (!syncWanted(h) && vaultStore.get().status === "locked") await openLocal();
}

/** Opens the local vault with the device's key. A key that cannot be read leaves the data exactly as it is. */
export async function openLocal(): Promise<boolean> {
  set({ open: "opening", error: null });
  try {
    const o = await openLocalVault(localKv, holders());
    if (o.status === "ok") { await unlockLocal(o.head, o.vk); set({ open: "idle", head: o.head }); return true; }
    set({ open: o.status === "denied" ? "denied" : o.status === "lost" ? "lost" : "idle", head: o.status === "none" ? null : o.head });
  } catch (e) {
    set({ open: "error", error: String((e as Error)?.message || e).slice(0, 200) });
  }
  return false;
}
/** Mac: a new PS build may read the Keychain only after the person allows it (their click). */
export async function allowAndOpen(): Promise<boolean> {
  if (keychain) { const g = await keychain.allow().catch(() => null); if (!g || g.status !== "ok") { set({ open: "denied" }); return false; } }
  return openLocal();
}

/** Can this device offer Start now? A device that once held a synced account (its last username) does not. */
export async function canStartHere(): Promise<boolean> {
  if (!LOCAL_PLATFORM || !mainPage()) return false;
  if (PROJECT.custom) return false;   // a project of their own is linked here: its Create account or Sign in instead
  if (await lastUsername().catch(() => "")) return false;
  return !(await readHead(localKv).catch(() => undefined));
}

/** Start now: nothing to fill in (V1.49: the first name went; an empty name is kept as no name). */
export async function startNow(name = ""): Promise<void> {
  const { head, vk } = await createLocalVault(localKv, holders(), name);
  void keepStorage();
  set({ head, open: "idle" });
  try { localStorage.setItem("psm.local", "1"); } catch { /* the mobile web app's start screen only */ }
  await unlockLocal(head, vk);
  await seedNewOwner(name);
}

// ---------- Turn on sync ----------
/** What happens: Mac opens PS's own Supabase setup (or the sign in when a project is linked already), the mobile web
 *  app its Connect screen. The phone app says it is not there yet. The local vault stays untouched either way. */
export async function turnOnSync(): Promise<{ ok: boolean; say?: string }> {
  const h = await refreshHead();
  if (!h) return { ok: false, say: "There is no data on this device to sync." };
  if (LOCAL_PLATFORM === "phone") return { ok: false, say: "Turn on sync is not in the Android app yet. Export a backup to keep a copy somewhere safe." };
  await updateHead(localKv, (x) => ({ ...x, syncIntent: new Date().toISOString(), snoozedFor: null }));
  await refreshHead();
  armGate();
  if (LOCAL_PLATFORM === "mac") {
    if (!PROJECT.custom) { psPost({ type: "project:setup", local: true }); return { ok: true }; }
    lock();   // the Sign in window: Create account on a new project, Sign in on one with an account
    return { ok: true };
  }
  // The mobile web app: its Connect screen, then the sign in.
  if (!PROJECT.custom) { try { sessionStorage.setItem("psm.connect", "1"); } catch { /* storage off */ } location.reload(); return { ok: true }; }
  lock();
  return { ok: true };
}
/** "Not now" under the sign in: back to the data on this device, and no more asking for this project. */
export async function notNow(): Promise<void> {
  if (!view.head) return;
  await updateHead(localKv, (x) => ({ ...x, syncIntent: null, snoozedFor: projectId() }));
  await refreshHead();
  await openLocal();
}

// ---------- the move gate (core/vault.ts finishUnlock calls it before an account opens) ----------
let choose: ((c: GateChoice) => void) | null = null;
/** The move screen's buttons. */
export function moveChoice(c: GateChoice) { const f = choose; choose = null; f?.(c); }
const wait = () => new Promise<GateChoice>((res) => { choose = res; });
class BackToLocal extends Error { constructor() { super("Back to your data on this device."); } }

function armGate() {
  setMoveGate(async ({ target, userId, fresh }) => {
    const h = await refreshHead();
    if (!h || !syncWanted(h)) return null;
    // The steps and every failure path live in core/movegate.ts (tested in tests/localfirst-gate.test.ts).
    const r = await moveIntoAccount({
      open: () => openLocalVault(localKv, holders()),
      rows: (x) => loadLocalRows(localKv, x),
      update: async (fn) => { const n = await updateHead(localKv, fn); set({ head: n }); return n; },
      ask: (v) => { set({ move: v }); return wait(); },
      show: (v) => set({ move: v }),
      allow: async () => { if (keychain) await keychain.allow().catch(() => null); },
      decrypt: (vk, r) => C.decryptJson<Payload>(vk, r.ct, C.aad.record(r.id, r.workspace_id)),
      project: projectId(),
    }, { target, userId, fresh });
    if (r.kind === "none") return null;
    if (r.kind === "back") return goBack();
    await refreshHead();
    set({ move: { phase: "done", count: r.count }, note: `Sync is on. All ${r.count} record${r.count === 1 ? "" : "s"} moved and checked. A copy stays on this ${LOCAL_PLATFORM === "mac" ? "Mac" : "device"} until you remove it in Settings.` });
    setMoveGate(null);
    return r.rows;
  });
}
async function goBack(): Promise<never> {
  // core/movegate.ts already put the head back to "local"; the local vault opens again as it was.
  set({ move: { phase: "idle" } });
  setTimeout(() => { void refreshHead().then(() => openLocal()); }, 0);
  throw new BackToLocal();
}

/** Settings, after a verified move: remove the copy kept on this device. */
export async function removeLocalBackup(confirmed: boolean): Promise<void> {
  await discardLocalBackup(localKv, holders(), confirmed);
  try { localStorage.removeItem("psm.local"); } catch { /* fine */ }
  await refreshHead();
}
/** On the sign in, after a move: open the copy on this device again (say, the synced account is gone). */
export async function reopenLocalBackup(): Promise<void> {
  const h = await refreshHead();
  if (!h || h.state !== "moved") return;
  await updateHead(localKv, (x) => ({ ...x, state: "local", syncIntent: null, snoozedFor: projectId() }));
  await refreshHead();
  armGate();
  await openLocal();
}

// ---------- the backup file ----------
function allRecords() {
  return [...vaultStore.get().docs.values()].filter((d) => !d.ws).map((d) => ({ id: d.id, kind: d.kind as string, data: d.data }));
}
/** Export my data: the encrypted file's text and a name for it. */
export async function exportBackup(pass: string): Promise<{ text: string; name: string; count: number }> {
  if (vaultStore.get().status !== "unlocked") throw new Error("Open PS first.");
  const recs = allRecords();
  const text = await makeBackup(recs, pass, { name: view.head?.name ?? "" });
  if (vaultStore.get().local) await updateHead(localKv, (x) => ({ ...x, exportedAt: new Date().toISOString() })).catch(() => {});
  await refreshHead();
  return { text, name: backupFileName(), count: recs.length };
}
/** Saves a text file the normal way (PS on the Mac asks where with its own Save panel). */
export function saveTextFile(text: string, name: string) {
  if (LOCAL_PLATFORM === "phone") { gosPost({ type: "file:save", name, text }); return; }   // the phone app writes it to Downloads
  const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
/** Import a backup: adds what this device does not have, folds the settings in, deletes nothing. */
export async function importBackup(text: string, pass: string): Promise<{ added: number; same: number; kept: number; skipped: number }> {
  if (vaultStore.get().status !== "unlocked") throw new Error("Open PS first.");
  const file = await openBackup(text, pass);
  const snap = vaultStore.get();
  const have = new Map([...snap.docs.values()].filter((d) => !d.ws).map((d) => [d.id, { kind: d.kind as string, data: d.data }]));
  const cur = docs<Settings>("settings", null).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const plan = planImport(file.records, have, cur ? { id: cur.id, data: cur.data as unknown as Record<string, unknown> } : null);
  let added = 0, skipped = 0;
  for (const r of plan.add) {
    try { await put(r.kind as Parameters<typeof put>[0], r.data, { id: r.id, ws: null }); added++; } catch { skipped++; }
  }
  if (plan.settings) await put<Settings>("settings", { ...DEFAULT_SETTINGS, ...(plan.settings.data as Partial<Settings>) }, { id: plan.settings.id || undefined, ws: null });
  await sync();
  set({ note: `Backup imported: ${added} added, ${plan.same} already here${plan.kept ? `, ${plan.kept} kept as they are on this device` : ""}${skipped ? `, ${skipped} skipped` : ""}.` });
  return { added, same: plan.same, kept: plan.kept, skipped };
}
export function setLocalNote(s: string | null) { set({ note: s }); }
/** The phone app's answer to file:save (ps-gos LocalKey.kt BackupSave). */
export function fileSavedMessage(m: { type?: unknown; ok?: unknown; name?: unknown }): boolean {
  if (m?.type !== "file:saved") return false;
  set({ note: m.ok === true ? `Saved to your Downloads as ${String(m.name || "a PS backup").slice(0, 80)}.` : "The phone could not save the file. Try again." });
  return true;
}

// ---------- the reminder card and the warning line ----------
/** The week old reminder: the local vault's start date and the Not now kept in settings (so the Tab list can write it). */
export function syncNudgeDue(local: { since: string } | null, dismissedAt: string | null | undefined, now = Date.now()): boolean {
  return !!local && nudgeDue(local.since, dismissedAt, now);
}

// ---------- PS's Tab list asks the main page (ps.ts "looks" patch localOp) ----------
let lastOp = 0;
export async function localOp(o: Record<string, unknown>): Promise<void> {
  if (!mainPage() || Date.now() - lastOp < 300) return;
  lastOp = Date.now();
  const op = o.op;
  try {
    if (op === "sync") { const r = await turnOnSync(); if (!r.ok && r.say) set({ note: r.say }); }
    else if (op === "export" && typeof o.pass === "string") {
      const r = await exportBackup(o.pass);
      saveTextFile(r.text, r.name);
      set({ note: LOCAL_PLATFORM === "phone" ? `Saving the backup (${r.count} records) to your Downloads...` : `Backup ready with ${r.count} records. Choose where to keep it.` });
    }
    else if (op === "import" && typeof o.text === "string" && typeof o.pass === "string" && o.text.length < 200_000_000) await importBackup(o.text, o.pass);
    else if (op === "removeBackup" && o.confirm === true) { await removeLocalBackup(true); set({ note: "The copy on this Mac was removed. Your data is in your synced account." }); }
    else if (op === "noteSeen") set({ note: null });
    else if (op === "nudgeOff") await saveSettings({ syncNudgeAt: new Date().toISOString() });
  } catch (e) {
    set({ note: String((e as Error)?.message || e).slice(0, 200) });
  }
}
