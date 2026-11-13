// Saved looks and Reset for the phones (V1.56). The developer, 13 Nov 2026: "save different appearance profiles ... save a version
// of the macOS that you like and ... of the GOS or iOS version ... so you can go back to it any point, you can rename the
// appearances as well" and a "reset to default button ... so if you fuck anything up you can reverse it".
//
// The store is the shared one (core/looksprofiles.ts, settings.looksSaved), kind "gos" for PS GOS and "ios" for the
// iPhone web app. What a phone look holds is the whole phone layout (core/phonelayout.ts): its pages, the panels on
// them, the navbar and every background and look. Used the same way by the phone's own Edit mode (gos/PhoneEditMode.tsx)
// and the Mac's phone canvas (views/PhoneEditor.tsx), through views/PhoneLooks.tsx.
//
// Pure functions only (tests/phonelooks.test.ts).
import { cleanPhoneLayout, defaultPhoneLayout, samePhoneLayout, type PhoneKind, type PhoneLayout } from "./phonelayout.ts";
import { backupLook, cleanLooksStore, findLook, looksOf, mergeLooksKinds, onlyKind, type LooksStore, type SavedLook } from "./looksprofiles.ts";

/** A phone look: the phone layout as it was, without its save time. */
export type PhoneLook = PhoneLayout;

/** The phone's setup right now, as a look (checked, so a saved look is always one the phone can draw). */
export function phoneSnapshot(l: PhoneLayout, red: boolean): PhoneLook {
  return { ...cleanPhoneLayout(l, l.phone, red), at: "" };
}
/** A look's data from the vault, checked for this phone kind. Null: not a phone layout. */
export function cleanPhoneLookData(kind: PhoneKind, d: unknown, red = true): PhoneLook | null {
  if (!d || typeof d !== "object" || !Array.isArray((d as { pages?: unknown }).pages)) return null;
  return { ...cleanPhoneLayout(d, kind, red), at: "" };
}
/** Putting a look on: the layout to save (a new save time, the phone kind it is on now). */
export function applyPhoneLook(look: unknown, kind: PhoneKind, red: boolean, now: string): PhoneLayout {
  return { ...cleanPhoneLayout(look, kind, red), phone: kind, at: now };
}
/** Reset to default: PS's own phone layout (Plan, List, Inbox, the usual navbar at the bottom, no backgrounds). */
export const phoneDefault = (kind: PhoneKind, red: boolean, now: string): PhoneLayout => ({ ...defaultPhoneLayout(kind, red), at: now });

/** This phone kind's looks: yours, then the automatic ones ("Before reset", "Before switching"). Bad ones left out. */
export function phoneLooks(store: LooksStore | null | undefined, kind: PhoneKind): SavedLook<PhoneLook>[] {
  return looksOf<PhoneLook>(store, kind).filter((x) => cleanPhoneLookData(kind, x.data) !== null);
}
/** Which of your looks the phone shows right now (the same pages, panels, navbar and looks), if any. */
export function currentLookId(store: LooksStore | null | undefined, l: PhoneLayout, red: boolean): string | null {
  for (const x of phoneLooks(store, l.phone)) {
    const d = cleanPhoneLookData(l.phone, x.data, red);
    if (d && samePhoneLayout({ ...d, phone: l.phone }, l, red)) return x.id;
  }
  return null;
}
/** Switch to a look: the setup now kept as "Before switching" first, then the look's layout. */
export function switchPhoneLook(store: LooksStore | null | undefined, l: PhoneLayout, id: string, red: boolean, now: string): { store: LooksStore; layout: PhoneLayout; backup: string } | null {
  const look = findLook<PhoneLook>(store, l.phone, id);
  if (!look || !cleanPhoneLookData(l.phone, look.data, red)) return null;
  const b = backupLook(store, l.phone, phoneSnapshot(l, red), "switch", now);
  return { store: b.store, layout: applyPhoneLook(look.data, l.phone, red, now), backup: b.id };
}
/** Reset: the setup now kept as "Before reset" first, then the default layout. */
export function resetPhone(store: LooksStore | null | undefined, l: PhoneLayout, red: boolean, now: string): { store: LooksStore; layout: PhoneLayout; backup: string } {
  const b = backupLook(store, l.phone, phoneSnapshot(l, red), "reset", now);
  return { store: b.store, layout: phoneDefault(l.phone, red, now), backup: b.id };
}
/** Undo a switch or a reset: the layout saved just before it, back on (it stays saved). */
export function undoTo(store: LooksStore | null | undefined, kind: PhoneKind, backup: string, red: boolean, now: string): PhoneLayout | null {
  const b = findLook<PhoneLook>(store, kind, backup);
  return b && cleanPhoneLookData(kind, b.data, red) ? applyPhoneLook(b.data, kind, red, now) : null;
}

/** What gets saved into settings.looksSaved: only this phone kind's list replaces the vault's (a phone never touches
 *  the Mac's looks or the other phone's), every look checked. */
export function looksToSave(current: LooksStore | null | undefined, next: LooksStore, kind: PhoneKind): LooksStore {
  const mine = cleanLooksStore(onlyKind(next, kind), (k, d) => (k === kind ? cleanPhoneLookData(kind, d) : null));
  return mergeLooksKinds(current, mine);
}
