// Patch notes across versions (V1.52, the developer: when someone updates across several versions, for example 1.49 to
// 1.52, the notes must include everything from every version they skipped, not only the newest).
//
// One pure place that chooses WHICH versions to show, used by the update card (Mac, website, phone) and the
// What's new panel. The words themselves only ever come from notes the developer approved (scripts/ps-public.mjs writes
// them into release.json, the Mac's signed note, the phone's version.json and the build's bundle); this file
// checks them once more and never invents or joins anything. Private notes ("For you") are never here.
//
// Run: node --experimental-strip-types tests/notehistory.test.ts

import { cleanMade } from "./releaseby.ts";

/** `by` (V1.58): who made that release ("jan", "gsquad"); missing for releases from before V1.58. */
export type NoteBlock = { version: string; keyword: string; notes: string[]; by?: string };

/** The most versions one view carries (the files hold the last 20 approved ones). */
export const MAX_BLOCKS = 20;
/** A device that ran PS before but left no record of which version (V1.53): it gets the last few versions' notes, not
 *  only the newest (the developer: "the last few updates"). */
export const UNKNOWN_BACK = 5;
/** One version's own block stays short: at most this many lines of at most LINE_MAX characters. */
export const BLOCK_LINES = 6;
/** 300 like the current version's own notes (core/whatsnew.ts). V1.53: it was 220, which dropped V1.44's approved 222 character
 *  line and with it the whole V1.44 block from every list. */
export const LINE_MAX = 300;
const VER = /^\d{1,3}\.\d{1,3}$/;
const BAD = /[\u2013\u2014<>]/;

/** "1.50" or "V1.50" is a version, anything else is not. */
export function plainVersion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^V/, "");
  return VER.test(s) ? s : null;
}

/** 1.9 < 1.10 < 1.50: by numbers, not text. */
export function cmp(a: string, b: string): number {
  const p = (v: string) => v.split(".").map(Number);
  const [x, y] = [p(a), p(b)];
  return x[0] - y[0] || x[1] - y[1];
}

/** One version's notes as they may show: a real version, plain short lines, no long dashes, no HTML.
 *  A block with any bad line is dropped whole (never a partly shown list). */
export function cleanBlock(x: unknown): NoteBlock | null {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const version = plainVersion(o.version);
  if (!version || !Array.isArray(o.notes)) return null;
  const notes = o.notes.filter((n): n is string => typeof n === "string" && !!n.trim()).map((n) => n.trim());
  if (!notes.length || notes.length !== o.notes.length) return null;
  if (notes.some((n) => BAD.test(n) || n.length > LINE_MAX)) return null;
  const kw = typeof o.keyword === "string" && !BAD.test(o.keyword) ? o.keyword.trim().slice(0, 30) : "";
  const made = cleanMade(o);
  return { version, keyword: kw, notes: notes.slice(0, BLOCK_LINES), ...(made ? { by: made.by } : {}) };
}

/** A list of blocks from a file or the shell: bad ones dropped, one per version, newest first, at most MAX_BLOCKS. */
export function cleanBlocks(x: unknown): NoteBlock[] {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>();
  const out: NoteBlock[] = [];
  for (const b of x) {
    const c = cleanBlock(b);
    if (c && !seen.has(c.version)) { seen.add(c.version); out.push(c); }
  }
  return out.sort((a, b) => cmp(b.version, a.version)).slice(0, MAX_BLOCKS);
}

/** The versions to show for someone who runs `installed` and may update (or just updated) to `upTo`: every
 *  approved version strictly newer than `installed` and not newer than `upTo`, newest first. Versions with no
 *  approved notes simply are not there, so they are skipped. With no known installed version only `upTo`'s own
 *  notes show (never a guess at what was skipped). */
export function catchUp(all: unknown, installed: string | null | undefined, upTo?: string | null): NoteBlock[] {
  const blocks = cleanBlocks(all);
  const top = plainVersion(upTo) ?? blocks[0]?.version ?? null;
  const from = plainVersion(installed);
  const within = blocks.filter((b) => (!top || cmp(b.version, top) <= 0));
  if (!from) return within.filter((b) => b.version === top);   // unknown start: this version only
  return within.filter((b) => cmp(b.version, from) > 0);
}

/** The last `n` approved versions up to `upTo` (newest first), for a device that cannot say which version it came from.
 *  `since`, when this device does know something older than those n, widens it to every version after that one. */
export function recentBlocks(all: unknown, upTo: string | null | undefined, n = UNKNOWN_BACK, since?: string | null): NoteBlock[] {
  const blocks = cleanBlocks(all);
  const top = plainVersion(upTo) ?? blocks[0]?.version ?? null;
  const within = blocks.filter((b) => !top || cmp(b.version, top) <= 0);
  const last = within.slice(0, Math.max(1, n));
  const from = plainVersion(since);
  return from && last.length && cmp(from, last[last.length - 1].version) < 0 ? within.filter((b) => cmp(b.version, from) > 0) : last;
}

/** The versions a plan lists (core/whatsnew.ts whatsNewPlan): every one after `since`, or, with `back`, the last few. */
export function blocksFor(all: unknown, plan: { since: string | null; back: number }, upTo: string | null | undefined): NoteBlock[] {
  return plan.back > 0 ? recentBlocks(all, upTo, plan.back, plan.since) : catchUp(all, plan.since, upTo);
}

/** Which blocks start open: the newest always; with a few versions all of them (nothing to hunt for), with many
 *  only the newest two, the rest one tap away. */
export function startsOpen(index: number, total: number): boolean {
  return index === 0 || total <= 3 || (index === 1 && total <= 6);
}

/** "V1.50 · Curiosity" for a block's heading. */
export function blockTitle(b: { version: string; keyword: string }): string {
  return `V${b.version}${b.keyword ? ` · ${b.keyword}` : ""}`;
}

/** Plain lines to hand a card that only knows one list of strings (the phone's old single notes field):
 *  the newest block's lines. */
export function newestLines(blocks: NoteBlock[]): string[] {
  return blocks[0]?.notes ?? [];
}
