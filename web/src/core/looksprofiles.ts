// Saved looks (V1.56). The developer, 13 Nov 2026: "I want a reset to default button ... so if you fuck anything up you can reverse
// it. And also add a save button as well. So you can save different appearance profiles ... save a version of the
// macOS that you like and ... of the GOS or iOS version ... so you can go back to it any point, you can rename the
// appearances as well."
//
// One store in the vault settings (settings.looksSaved), synced like every setting, with a list per device kind:
// "mac" (PS on a Mac and the website's Tab list, which share one layout), "gos" (the GrapheneOS app) and "ios" (the
// iPhone web app). Each device only ever reads and writes its own kind. What a look holds is up to that device
// (core/maclook.ts for the Mac); this module only keeps, names, swaps and backs them up, so the phones' Edit modes use
// it unchanged. Every function is pure: it takes the store and returns a new one.

export type DeviceKind = "mac" | "gos" | "ios";
export const DEVICE_KINDS: readonly DeviceKind[] = ["mac", "gos", "ios"];
export const isDeviceKind = (v: unknown): v is DeviceKind => v === "mac" || v === "gos" || v === "ios";

/** Why a look was saved by itself, just before a reset or a switch (so nothing is ever lost). */
export type AutoWhy = "reset" | "switch";
export const AUTO_NAMES: Record<AutoWhy, string> = { reset: "Before reset", switch: "Before switching" };

export interface SavedLook<T = unknown> {
  id: string;
  name: string;
  at: string;            // when it was saved (ISO)
  data: T;               // the device's own snapshot (core/maclook.ts MacLook for "mac")
  auto?: AutoWhy;        // saved by itself: one of each kind at most, always the newest
}
export type LooksStore = Partial<Record<DeviceKind, SavedLook[]>>;

/** Looks you saved yourself, per device kind (the automatic ones come on top of these). */
export const LOOKS_MAX = 12;
export const LOOK_NAME_MAX = 32;
const ID = /^l[a-z0-9]{6,12}$/;

/** A new look id. rand: for the tests. */
export function newLookId(rand = Math.random): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 36).toString(36);
  return "l" + s;
}
/** A name as typed: trimmed, spaces squeezed, at most 32 characters. Empty: null. */
export function tidyLookName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, LOOK_NAME_MAX).trim();
  return s || null;
}

/** The looks of one device kind: yours in the order you saved them, then the automatic ones. */
export function looksOf<T = unknown>(store: LooksStore | null | undefined, kind: DeviceKind): SavedLook<T>[] {
  const l = (store?.[kind] ?? []) as SavedLook<T>[];
  return [...l.filter((x) => !x.auto), ...l.filter((x) => x.auto)];
}
const put = (store: LooksStore | null | undefined, kind: DeviceKind, list: SavedLook[]): LooksStore => {
  // An empty list stays (as []), so a merge into the vault knows every look of this kind was deleted.
  return { ...(store ?? {}), [kind]: list };
};
const ownOf = (store: LooksStore | null | undefined, kind: DeviceKind) => (store?.[kind] ?? []).filter((x) => !x.auto);

/** The first free "Look N" (N counts up from how many you have, so names never repeat while they are all there). */
export function nextLookName(store: LooksStore | null | undefined, kind: DeviceKind): string {
  const taken = new Set(looksOf(store, kind).map((x) => x.name.toLowerCase()));
  for (let n = ownOf(store, kind).length + 1; ; n++) if (!taken.has(`look ${n}`)) return `Look ${n}`;
}
/** A look of yours with this name already (case does not matter): saving under it asks first. */
export function lookNamed(store: LooksStore | null | undefined, kind: DeviceKind, name: string, exceptId?: string): SavedLook | null {
  const n = tidyLookName(name)?.toLowerCase();
  if (!n) return null;
  return ownOf(store, kind).find((x) => x.id !== exceptId && x.name.toLowerCase() === n) ?? null;
}
/** Room for one more of your own looks? */
export const canSaveMore = (store: LooksStore | null | undefined, kind: DeviceKind) => ownOf(store, kind).length < LOOKS_MAX;

/** Save the setup as a new look (a name already used is the caller's question: ask, then replaceLook). */
export function saveLook<T>(store: LooksStore | null | undefined, kind: DeviceKind, data: T, o: { name?: string; now: string; rand?: () => number }): { store: LooksStore; id: string | null } {
  if (!canSaveMore(store, kind)) return { store: store ?? {}, id: null };
  const id = newLookId(o.rand);
  const look: SavedLook = { id, name: tidyLookName(o.name) ?? nextLookName(store, kind), at: o.now, data };
  return { store: put(store, kind, [...(store?.[kind] ?? []), look]), id };
}
/** Save over a look you have (after "Replace Look 2?"): new contents, same place and name unless a new one is given. */
export function replaceLook<T>(store: LooksStore | null | undefined, kind: DeviceKind, id: string, data: T, now: string, name?: string): LooksStore {
  const list = store?.[kind] ?? [];
  if (!list.some((x) => x.id === id)) return store ?? {};
  return put(store, kind, list.map((x) => (x.id === id ? { ...x, data, at: now, name: tidyLookName(name) ?? x.name, auto: undefined } : x)).map(dropUndef));
}
const dropUndef = (x: SavedLook): SavedLook => { const y = { ...x }; if (y.auto === undefined) delete y.auto; return y; };
/** Rename a look (an empty name changes nothing). An automatic look you rename becomes one of yours. */
export function renameLook(store: LooksStore | null | undefined, kind: DeviceKind, id: string, name: string): LooksStore {
  const n = tidyLookName(name);
  const list = store?.[kind] ?? [];
  if (!n || !list.some((x) => x.id === id)) return store ?? {};
  return put(store, kind, list.map((x) => (x.id === id ? dropUndef({ ...x, name: n, auto: undefined }) : x)));
}
/** What a delete took away, so Undo can put it back exactly where it was. */
export type Removed = { kind: DeviceKind; look: SavedLook; index: number };
export function deleteLook(store: LooksStore | null | undefined, kind: DeviceKind, id: string): { store: LooksStore; removed: Removed | null } {
  const list = store?.[kind] ?? [];
  const index = list.findIndex((x) => x.id === id);
  if (index < 0) return { store: store ?? {}, removed: null };
  return { store: put(store, kind, list.filter((x) => x.id !== id)), removed: { kind, look: list[index], index } };
}
/** Undo a delete: back at its place (unless a look with its id is there again). */
export function restoreLook(store: LooksStore | null | undefined, r: Removed): LooksStore {
  const list = [...(store?.[r.kind] ?? [])];
  if (list.some((x) => x.id === r.look.id)) return store ?? {};
  list.splice(Math.min(r.index, list.length), 0, r.look);
  return put(store, r.kind, list);
}
/** Just before a reset or a switch: the setup as it is, as "Before reset" or "Before switching". Only the newest of
 *  each is kept (it replaces the last one), so they never pile up and never count against your own looks. */
export function backupLook<T>(store: LooksStore | null | undefined, kind: DeviceKind, data: T, why: AutoWhy, now: string, rand?: () => number): { store: LooksStore; id: string } {
  const list = (store?.[kind] ?? []).filter((x) => x.auto !== why);
  const id = newLookId(rand);
  return { store: put(store, kind, [...list, { id, name: AUTO_NAMES[why], at: now, data, auto: why }]), id };
}
export function findLook<T = unknown>(store: LooksStore | null | undefined, kind: DeviceKind, id: string): SavedLook<T> | null {
  return ((store?.[kind] ?? []).find((x) => x.id === id) as SavedLook<T> | undefined) ?? null;
}

/** The store from the vault: only well formed looks, per kind, each look's data checked by its device's own cleaner
 *  (a look whose data does not pass is dropped). */
export function cleanLooksStore(v: unknown, cleanData: (kind: DeviceKind, d: unknown) => unknown | null = (_k, d) => d ?? null): LooksStore {
  if (!v || typeof v !== "object") return {};
  const out: LooksStore = {};
  for (const kind of DEVICE_KINDS) {
    const raw = (v as Record<string, unknown>)[kind];
    if (!Array.isArray(raw)) continue;
    const list: SavedLook[] = [];
    const autos = new Set<AutoWhy>();
    let own = 0;
    for (const x of raw) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const name = tidyLookName(o.name);
      if (typeof o.id !== "string" || !ID.test(o.id) || !name || typeof o.at !== "string" || o.at.length > 40 || list.some((y) => y.id === o.id)) continue;
      const auto = o.auto === "reset" || o.auto === "switch" ? o.auto : undefined;
      if (auto ? autos.has(auto) : own >= LOOKS_MAX) continue;
      const data = cleanData(kind, o.data);
      if (data === null || data === undefined) continue;
      if (auto) autos.add(auto); else own++;
      list.push(auto ? { id: o.id, name, at: o.at, data, auto } : { id: o.id, name, at: o.at, data });
    }
    out[kind] = list;
  }
  return out;
}
/** Saving: only the device kinds a change names replace the vault's (a Mac never overwrites the phones' looks). */
export function mergeLooksKinds(current: LooksStore | null | undefined, change: LooksStore): LooksStore {
  const out: LooksStore = { ...(current ?? {}) };
  for (const k of DEVICE_KINDS) if (change[k]) out[k] = change[k];
  return out;
}
/** Only one device kind's part of a store (what a device sends when it saves). */
export const onlyKind = (store: LooksStore, kind: DeviceKind): LooksStore => ({ [kind]: store[kind] ?? [] });
