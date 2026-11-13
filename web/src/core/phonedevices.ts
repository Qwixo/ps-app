// Which phones an account has (V1.56 phone layout editor, the developer 13 Nov 2026: "first of all I think it should detect what
// devices you actually have connected. But if it's unsure then ask you GrapheneOS or iOS").
//
// Every phone that opens PS signed in (PS GOS, and the iPhone web app, whether it signed in by passphrase, by Remember
// me or by scanning the Mac) keeps one tiny encrypted vault record about itself (kind "phonedev"): which kind of phone,
// a name ("Pixel 8"), its screen in CSS pixels (so the Mac's editor draws it at its real shape) and when it was last
// seen. The phone writes it only when something changed or once a day (egress: change only). The Mac reads these.
// The V1.55 ps_devices table only lists phones paired by scanning, with no kind, name or last seen, so it is not used.
//
// Pure functions only (tests/phonedevices.test.ts).
import { isPhoneKind, phoneName, type PhoneKind } from "./phonelayout.ts";

export type PhoneDev = { dev: string; phone: PhoneKind; name: string; w: number; h: number; seen: string };
const DEV = /^[a-z0-9]{8,32}$/;
/** A phone not seen for this long is no longer counted as one of yours (it stays in the vault, it is just not offered). */
export const STALE_DAYS = 90;
/** A phone writes its record again at most this often when nothing changed. */
export const BEAT_HOURS = 20;

/** A device record checked: a known kind, a short plain name, a sane screen. Null: not a phone record. */
export function cleanPhoneDev(v: unknown): PhoneDev | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (typeof o.dev !== "string" || !DEV.test(o.dev) || !isPhoneKind(o.phone)) return null;
  const seen = typeof o.seen === "string" && !Number.isNaN(Date.parse(o.seen)) ? o.seen : "";
  if (!seen) return null;
  const num = (x: unknown) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n >= 240 && n <= 1600 ? n : 0; };
  const name = typeof o.name === "string" ? o.name.replace(/[\u0000-\u001f\u2013\u2014]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return { dev: o.dev, phone: o.phone, name, w: num(o.w), h: num(o.h), seen };
}
/** The account's phones, most recently seen first, each device once (its newest record), stale ones left out. */
export function phonesOf(records: unknown[], now = Date.now()): PhoneDev[] {
  const best = new Map<string, PhoneDev>();
  for (const r of records) {
    const d = cleanPhoneDev(r);
    if (!d) continue;
    if (now - Date.parse(d.seen) > STALE_DAYS * 864e5) continue;
    const had = best.get(d.dev);
    if (!had || Date.parse(d.seen) > Date.parse(had.seen)) best.set(d.dev, d);
  }
  return [...best.values()].sort((a, b) => Date.parse(b.seen) - Date.parse(a.seen) || a.dev.localeCompare(b.dev));
}
/** What the phone button does: open the only phone, offer a pick of several, or ask which kind when none is known. */
export type PhoneChoice = { open: PhoneDev } | { pick: PhoneDev[] } | { ask: true };
export function phoneChoice(devs: PhoneDev[]): PhoneChoice {
  if (!devs.length) return { ask: true };
  if (devs.length === 1) return { open: devs[0] };
  return { pick: devs };
}
/** "Pixel 8, GrapheneOS" or "iPhone". Two phones with the same name get a short tail so they can be told apart. */
export function phoneLabel(d: PhoneDev, all: PhoneDev[] = [d]): string {
  const base = d.phone === "gos" ? `${d.name || "Android phone"}, ${phoneName("gos")}` : d.name && d.name !== "iPhone" ? `${d.name}, iPhone` : "iPhone";
  const twins = all.filter((x) => x.phone === d.phone && x.name === d.name);
  return twins.length > 1 ? `${base} (${twins.indexOf(d) + 1})` : base;
}
/** The screen to draw in the editor, in CSS pixels, portrait: the phone's own, or a usual one for its kind. */
export function phoneScreen(d: Pick<PhoneDev, "phone" | "w" | "h"> | null, phone: PhoneKind): { w: number; h: number } {
  if (d && d.w && d.h) return { w: Math.min(d.w, d.h), h: Math.max(d.w, d.h) };
  return phone === "gos" ? { w: 412, h: 915 } : { w: 393, h: 852 };
}
/** Should the phone write its record now? Only when it is new, something about it changed, or a day went by. */
export function shouldBeat(prev: PhoneDev | null, next: Omit<PhoneDev, "seen">, now = Date.now()): boolean {
  if (!prev) return true;
  if (prev.phone !== next.phone || prev.name !== next.name || prev.w !== next.w || prev.h !== next.h) return true;
  return now - Date.parse(prev.seen) > BEAT_HOURS * 3600e3;
}
/** A friendly name from the GOS shell's Build.MANUFACTURER and MODEL ("Google", "Pixel 8" -> "Pixel 8"). */
export function androidName(maker: string, model: string): string {
  const mk = maker.trim(), md = model.trim();
  if (!md) return mk || "Android phone";
  return mk && !md.toLowerCase().startsWith(mk.toLowerCase()) && mk.toLowerCase() !== "google" ? `${mk} ${md}` : md;
}

/** Where the phone button sits in the Mac's Edit overview: top left, and below the Dynamic Island when the island is
 *  over that corner (the developer: the island must never cover it). island: the island's box in page pixels, or null. */
export type Box = { left: number; top: number; right: number; bottom: number };
export function phoneButtonSpot(island: Box | null, vw: number, opts: { size?: number; left?: number; top?: number } = {}): { left: number; top: number } {
  const size = opts.size ?? 40, left = opts.left ?? 20, top = opts.top ?? 16;
  const me: Box = { left, top, right: left + size, bottom: top + size };
  if (!island) return { left, top };
  const gap = 10;
  const hits = island.left < me.right + gap && island.right > me.left - gap && island.top < me.bottom + gap && island.bottom > me.top - gap;
  if (!hits) return { left, top };
  // Under the island, at the same left (never off the screen's right edge on a very narrow window).
  return { left: Math.min(left, Math.max(0, vw - size - 4)), top: Math.round(island.bottom + gap) };
}
/** The top a row of buttons at this box needs so the island never covers it: its own top, or just under the island. */
export function clearTop(island: Box | null, box: Box, gap = 10): number {
  if (!island) return box.top;
  const hits = island.left < box.right + gap && island.right > box.left - gap && island.top < box.bottom + gap && island.bottom > box.top - gap;
  return hits ? Math.round(island.bottom + gap) : box.top;
}
