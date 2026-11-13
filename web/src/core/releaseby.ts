// Who made a release (V1.58, multiple developers): "V1.59 by Jan", "V1.60 by the G Squad".
// Every release records its maker's profile name ("by": "jan", "gsquad" for the shared build everyone gets) and
// whether it went to everyone ("shared"). scripts/ps-public.mjs writes both into the bundled What's new, release.json
// and the update notes; versions from before V1.58 have neither and show exactly as before (no "by" line).
// A private release by someone else moves the number for everyone but brings nothing to this build: the history never
// lists it, so What's new says nothing about it.
//
// Run: node --experimental-strip-types tests/releaseby.test.ts

export type Made = { by: string; shared: boolean };

const BY = /^[a-z][a-z0-9-]{0,30}$/;
/** The shared build's maker name. */
export const GSQUAD = "gsquad";

/** {by, shared} from anything read from a file or the shell; null when there is no valid maker (an old release). */
export function cleanMade(x: unknown): Made | null {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return typeof o.by === "string" && BY.test(o.by) ? { by: o.by, shared: o.shared !== false } : null;
}

/** How a maker is named: "the G Squad" for the shared build, else the profile name with capitals ("jan" -> "Jan",
 *  "mary-jane" -> "Mary-Jane"). Empty for anything that is not a profile name. */
export function byName(by: unknown): string {
  if (typeof by !== "string" || !BY.test(by)) return "";
  if (by === GSQUAD) return "the G Squad";
  return by.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
}

/** "by Jan" ("" for an old release with no maker). */
export function byLine(by: unknown): string {
  const n = byName(by);
  return n ? `by ${n}` : "";
}

/** "V1.59 by Jan", or "V1.59" alone for an old release. */
export function versionBy(version: string, by?: unknown): string {
  const v = version.startsWith("V") ? version : `V${version}`;
  const b = byLine(by);
  return b ? `${v} ${b}` : v;
}

/** May this build list that release in its history? Old releases and shared ones: yes. A private one: only in its own
 *  maker's build (`me`, the maker of the build being run; empty when unknown, which lists no private release). */
export function listable(x: unknown, me: string): boolean {
  const m = cleanMade(x);
  return !m || m.shared || (!!me && m.by === me);
}

/** The maker of the build this page runs, from what the build carries: the bundled What's new ("by", "shared"), or the
 *  build file (__PS_BUILD__, from the multiple developers build: ps-version.json's "made" for the running version,
 *  wherever it sits in that file). Null for builds from before V1.58. */
export function madeOfBuild(whatsNew: unknown, build: unknown, version: string): Made | null {
  const direct = cleanMade(whatsNew);
  if (direct) return direct;
  const b = (build && typeof build === "object" ? build : {}) as Record<string, unknown>;
  for (const holder of [b, b.version, b.psVersion, b["ps-version"]]) {
    const h = (holder && typeof holder === "object" ? holder : {}) as Record<string, unknown>;
    const made = (h.made && typeof h.made === "object" ? h.made : {}) as Record<string, unknown>;
    const m = cleanMade(made[version]);
    if (m) return m;
  }
  return null;
}
