// Feature switches: one constant per feature that is switched off but kept, so it can come back with one line.

/** Cincee Campaigns in the PS app (the pink envelope left of Dimension X and its stats panel): OFF since V1.55
 *  (the developer, 12 Nov 2026: "It doesn't work and barely updates ... remove it in a way that is VERY easy to add back").
 *
 *  Off means: no button and no panel in the Tab list (Mac and phone), no "Campaign stats" in Edit mode's tray, no
 *  "Campaigns" in the phone's menu, no live refresh (no call to the campaigns-live function, no polling, no timer),
 *  no stats record handed to the Tab list, and no "Claude updated your vault: Cincee Campaigns" notice.
 *
 *  Kept, untouched: every view (views/CampaignStats.tsx, CampaignsLive.tsx, CsAccounts.tsx), the ops putCampaignStats
 *  and putCampaignsPage (still in App.tsx's KNOWN set, so an old or new package is accepted and its data kept), the
 *  "cstats" records, the campaigns-live edge function on Supabase, and the cincee.com/campaigns web page.
 *  The Mac shell (ps-mac) has no campaign code that runs: only self test steps (see ps-handover-notes/campaigns-off.md).
 *
 *  To bring it back: set this to true. Then see ps-handover-notes/campaigns-off.md for what to check. */
export const CAMPAIGNS_ON = false;

/** The five Notebook looks (Legal pad, Composition, Graph paper, Kraft dotted, Chalkboard, V1.30): OFF since V1.55
 *  (the developer, 12 Nov 2026: "They all look stupid and no one uses them ... remove them in a way that they can be added in later").
 *
 *  Off means: Settings, Appearance offers no Notebook column and no Notebook look (or its Preview), anything that lists
 *  the looks must use offeredLooks() in core/looks.ts (the one list, so the "Page look" menu is covered too), and
 *  anyone whose saved look is a Notebook look (look or tmNotebook) sees the normal look: resolveAppearance() in
 *  core/looks.ts hands out the fallback and the saved choice in the vault is left alone. notebook.css is not loaded
 *  (views/TaskMap.tsx), so no Notebook CSS runs and the four handwriting fonts are never fetched.
 *
 *  Kept, untouched: core/looks.ts's five look specs, core/notebook.ts, views/notebook.css, src/assets/fonts/notebook/
 *  (Sleep mode uses those fonts on its own), the engine's page turn, the settings fields look and tmNotebook.
 *
 *  To bring them back: set this to true. Then see ps-handover-notes/campaigns-off.md for what to check. */
export const NOTEBOOK_ON = false;

// ---------- the feature registry (V1.58, multiple developers; design: ps-handover-notes/v158-multidev-design.md section 3) ----------
// Core's features.json lists every SHARED feature (code in core); a person's layer lists their PRIVATE ones (code only in
// their layer; the developer's: ps-layer/features.json, never exported). vite.config.ts (the flip) hands both to the page in
// __PS_BUILD__.features. Each entry: id (lowercase words with hyphens), a short plain name, owner (the profile name of who
// made it; "core" for everything already there at the flip), scope (shared or private), since (the version it came in),
// parts (web, mac, phone) and default (on or off). "gate" says, in words, where the switch lives in the code today.
//
// Is a feature on? Made by this build's own person, or by core: the profile's override, else its default. Made by someone
// else: othersShared of the profile (and the feature's default), then the profile's override, then the person's own switch
// in Settings, "From the squad" (views/FromTheSquad.tsx), saved per account with the other settings (squadFeatures).
// A build with no profile (every V1.58 build made the V1.57 way) uses the per account answer instead: the developer's account is
// like his own profile, and on every account others' features stay off until the person switches them on. It never acts
// as the G Squad build (fails closed). Before anyone is signed in: nobody else's feature runs.
// The two switches above (CAMPAIGNS_ON, NOTEBOOK_ON) stay plain constants, so the bundle is exactly V1.57's; they are in
// core's features.json as "campaigns" and "notebook-looks" with the same default (tests/features.test.ts checks that).
import { ID_RE, NAME_RE, profile, buildFile, type Profile } from "./profile.ts";

export type Part = "web" | "mac" | "phone";
export interface Feature {
  id: string;
  name: string;
  owner: string;
  scope: "shared" | "private";
  since: string;
  parts: Part[];
  default: "on" | "off";
  gate?: string;
}
const PARTS: Part[] = ["web", "mac", "phone"];

/** One registry entry from JSON, or null when it is not a valid one. */
export function cleanFeature(v: unknown): Feature | null {
  if (!v || typeof v !== "object") return null;
  const f = v as Record<string, unknown>;
  if (typeof f.id !== "string" || !ID_RE.test(f.id) || f.id.length > 48) return null;
  if (typeof f.name !== "string" || !f.name.trim() || f.name.length > 60) return null;
  if (typeof f.owner !== "string" || !NAME_RE.test(f.owner)) return null;
  if (f.scope !== "shared" && f.scope !== "private") return null;
  if (typeof f.since !== "string" || !/^\d+\.\d+$/.test(f.since)) return null;
  if (!Array.isArray(f.parts) || !f.parts.length || !f.parts.every((p) => PARTS.includes(p as Part))) return null;
  if (f.default !== "on" && f.default !== "off") return null;
  if (f.owner === "core" && f.scope !== "shared") return null;
  const out: Feature = { id: f.id, name: f.name.trim(), owner: f.owner, scope: f.scope, since: f.since, parts: [...new Set(f.parts as Part[])], default: f.default };
  if (typeof f.gate === "string" && f.gate.trim()) out.gate = f.gate.trim().slice(0, 200);
  return out;
}

/** A registry from JSON: one file ({schema: 1, features: [...]}), a list of entries, or a list of files (core first,
 *  then the layer). Bad entries are left out; a repeated id keeps the first (CI refuses a repeat in core). */
export function cleanRegistry(v: unknown): Feature[] {
  const out: Feature[] = [];
  const seen = new Set<string>();
  const add = (e: unknown) => {
    if (e && typeof e === "object" && !Array.isArray(e) && Array.isArray((e as { features?: unknown }).features)) {
      if ((e as { schema?: unknown }).schema !== 1) return;
      (e as { features: unknown[] }).features.forEach(add);
      return;
    }
    if (Array.isArray(e)) { e.forEach(add); return; }
    const f = cleanFeature(e);
    if (f && !seen.has(f.id)) { seen.add(f.id); out.push(f); }
  };
  add(v);
  return out;
}

let regMemo: { from: unknown; reg: Feature[] } | null = null;
/** This build's registry (core's shared features, then the layer's private ones), empty when the build has none. */
export function registry(): Feature[] {
  const from = buildFile()?.features;
  if (!regMemo || regMemo.from !== from) regMemo = { from, reg: cleanRegistry(from ?? []) };
  return regMemo.reg;
}

/** Whose build this is, for the rules above. */
export interface Who { name: string; othersShared: "on" | "off"; overrides: Record<string, boolean> }
/** account: "red" (the developer's own account), "other" (anyone else signed in), null (nobody signed in yet). */
export type Account = "red" | "other" | null;
export function whoFor(p: Profile | null, account: Account): Who {
  if (p) return { name: p.name, othersShared: p.othersShared, overrides: p.features };
  // No profile (core's dev server, an open-source.mjs build): never act as the G Squad build. Others' features start off
  // on every account (fails closed, as on the Mac and the phone); the developer's own account still owns his features.
  if (account === "red") return { name: "red", othersShared: "off", overrides: {} };
  return { name: "", othersShared: "off", overrides: {} };
}

/** True when this feature is made by someone else than this build's person (and not core): the ones with a switch. */
export const othersFeature = (f: Feature, who: Who): boolean => f.owner !== "core" && f.owner !== who.name;

/** Is this feature on, for this build and this person's own switches (Settings, "From the squad")? */
export function featureOn(f: Feature, who: Who, mine: Record<string, boolean> | undefined): boolean {
  if (!othersFeature(f, who)) return who.overrides[f.id] ?? f.default === "on";
  if (f.scope !== "shared") return false;   // someone else's private feature: its code is not in this build
  let on = who.othersShared === "on" && f.default === "on";
  if (typeof who.overrides[f.id] === "boolean") on = who.overrides[f.id];
  if (mine && typeof mine[f.id] === "boolean") on = mine[f.id];
  return on;
}

/** Settings, "From the squad": every shared feature made by someone else, newest first, then by name. */
export function squadList(reg: Feature[], who: Who): Feature[] {
  const v = (s: string) => s.split(".").map(Number);
  return reg.filter((f) => f.scope === "shared" && othersFeature(f, who))
    .sort((a, b) => { const x = v(a.since), y = v(b.since); return (y[0] - x[0]) || (y[1] - x[1]) || a.name.localeCompare(b.name); });
}

/** Every feature's answer, for the Mac and the phone (they store it and ask Features.on). */
export function featureAnswers(reg: Feature[], who: Who, mine: Record<string, boolean> | undefined): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  for (const f of reg) o[f.id] = featureOn(f, who, mine);
  return o;
}

/** A person's switches from settings: only feature ids and true or false, at most 200. */
export function cleanSwitches(v: unknown): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return o;
  let n = 0;
  for (const [k, b] of Object.entries(v as Record<string, unknown>)) {
    if (n >= 200) break;
    if (ID_RE.test(k) && k.length <= 48 && typeof b === "boolean") { o[k] = b; n++; }
  }
  return o;
}

// ---------- the one question the code asks ----------
let ctx: { account: Account; mine: Record<string, boolean> } = { account: null, mine: {} };
/** Who is signed in and their own switches (views/FromTheSquad.tsx startFeatureSync keeps this current). */
export function setFeatureContext(account: Account, mine: Record<string, boolean> | undefined): void {
  ctx = { account, mine: cleanSwitches(mine) };
}
/** Is this feature on here? An id the registry does not know is off. */
export function feature(id: string): boolean {
  const f = registry().find((x) => x.id === id);
  return f ? featureOn(f, whoFor(profile(), ctx.account), ctx.mine) : false;
}

// ---------- the words of Settings, "From the squad" (views/FromTheSquad.tsx), in one place: the developer approves them ----------
/** "red" -> "Owner", "gsquad" -> "the G Squad". */
export function ownerWords(owner: string): string {
  return owner === "gsquad" ? "the G Squad" : owner.charAt(0).toUpperCase() + owner.slice(1);
}
export const SQUAD_WORDS = {
  empty: "Nothing from the squad yet. When a friend shares a feature, it shows here with its own switch.",
  startsOff: "Each one stays off until you switch it on.",
  startsOn: "Each one is on until you switch it off.",
  by: (f: Pick<Feature, "owner" | "since">) => `Made by ${ownerWords(f.owner)}, in V${f.since}`,
};
