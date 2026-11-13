// The developer's background videos, the pure rules of the Drive folder sync (4 Nov 2026). No vault, no DOM:
// src/core/bgvault.ts uses these, tests/bgsync.test.ts checks them.
//
// The developer: "after every 12 hours the PS app refreshes this folder, and any background videos in it get
// linked automatically and transferred to every device. If it fails to refresh, give a little pop up
// with a copy to clipboard error code that I can paste to you in chat."
//
// Egress (Supabase free plan, 5.5 GB a month for the whole org): the Mac that has the folder puts each
// video's silent copy in the vault once (an upload, which costs no egress), every other device
// downloads it once (about 1.37 times the copy, base64 in JSON) and keeps it. A download that stopped
// picks up at the piece where it stopped (the phone), and a failure waits longer each time.

export type BgProblem = { code: string; subject: string; text: string; detail: string };
export type Older = { id: string; name: string; size: number; sig?: string; replaces?: boolean; added?: boolean };
export type VideoLike = { id: string; name: string; bytes: number; pieces: string[]; from?: string };

/** The vault's mark on a video that came from the Drive folder: which file version it is. */
export const driveFrom = (o: { id: string; sig?: string }) => (o.sig ? `drive:${o.id}:${o.sig}` : `mac:${o.id}`);

/** Is this copy already in the vault (put in by this Mac before, or another Mac first)? */
export function twinOf<V extends VideoLike>(list: V[], o: Older): V | undefined {
  if (o.sig) return list.find((v) => v.from === driveFrom(o));
  return list.find((v) => v.from === `mac:${o.id}` || (v.name === o.name && v.bytes === o.size));
}

/** The text of anything thrown (Supabase errors are plain objects, not Error). Never more than 120 chars. */
export function errText(e: unknown): string {
  if (!e) return "unknown";
  if (typeof e === "string") return e.slice(0, 120);
  const o = e as { message?: unknown; code?: unknown; status?: unknown };
  const msg = typeof o.message === "string" ? o.message : String(e);
  const code = typeof o.code === "string" || typeof o.code === "number" ? ` (${o.code})` : "";
  return `${msg}${code}`.replace(/\s+/g, " ").slice(0, 120);
}

/** A failed upload: a full vault (the database went read only, or a size limit) or anything else. */
export function uploadCode(e: unknown): "BG-QUOTA" | "BG-UPLOAD" {
  return /read[- ]only|quota|exceed|insufficient|no space|disk full|storage limit|payload too large|\b413\b|\b25006\b|\b53100\b/i.test(errText(e)) ? "BG-QUOTA" : "BG-UPLOAD";
}

/** Waits between tries after a failure: 30 min, 1 h, 2 h ... at most 12 h. */
export function backoffMs(fails: number): number {
  if (fails <= 0) return 0;
  return Math.min(12 * 3600_000, 30 * 60_000 * 2 ** (fails - 1));
}

/** The plain sentence for each problem the page finds (the Mac's own ones are in Backgrounds.swift). */
export function problem(code: string, name: string, detail: string): BgProblem {
  const n = name || "a video";
  const text = code === "BG-QUOTA" ? `Your vault is full, so ${n} could not be sent to your phone and other Mac. It plays on this Mac.`
    : code === "BG-UPLOAD" ? `PS app could not put ${n} in your vault, so your phone and other Mac do not have it yet. It tries again later.`
    : code === "BG-REMOVE" ? `PS app could not take ${n} out of your vault after it left the folder. It tries again later.`
    : code === "BG-VAULT-MISSING" ? `Part of ${n} is missing from your vault, so a new device cannot download it. Add it again to fix it.`
    : code === "BG-DOWNLOAD" ? `PS app could not download ${n} from your vault onto this device. It tries again later.`
    : `Background videos did not sync.`;
  return { code, subject: name, text, detail };
}

/** One card per problem until it changes or the developer dismisses it: the mark a Dismiss keeps. */
export const problemKey = (p: BgProblem) => `${p.code}|${p.subject}`;
export function showable(p: BgProblem | null, dismissed: string | null): boolean {
  return !!p && dismissed !== problemKey(p);
}

/** The text Copy error code puts on the clipboard: a short code and plain details, nothing secret
 * (no key, no file, no folder path, no account). */
export function report(p: BgProblem, o: { device: string; version: string; at: Date; videos: number; here: number; lastOk?: string | null }): string {
  return [
    `PS error code ${p.code}`,
    `Device: ${o.device}, PS ${o.version || "?"}`,
    `When: ${o.at.toISOString().replace(/\.\d+Z$/, "Z")}`,
    `Problem: ${p.detail || p.text}`,
    `Videos in the vault: ${o.videos}, on this device: ${o.here}`,
    `Last good sync: ${o.lastOk || "never"}`,
  ].join("\n");
}

/** Which pieces still need downloading (a phone keeps the pieces of a stopped download). */
export function piecesToFetch(total: number, have: number[] | undefined): number[] {
  const got = new Set((have || []).filter((i) => Number.isInteger(i) && i >= 0 && i < total));
  const out: number[] = [];
  for (let i = 0; i < total; i++) if (!got.has(i)) out.push(i);
  return out;
}

/** The 12 hour check: videos with a piece the vault no longer holds. */
export function brokenVideos<V extends VideoLike>(list: V[], present: Set<string>): V[] {
  return list.filter((v) => v.pieces.some((p) => !present.has(p)));
}

/** Egress for one new video of `bytes` (the silent copy): what each device that downloads it costs. */
export function egressPerDevice(bytes: number): number {
  return Math.ceil(bytes / 3) * 4 + 200 * Math.ceil(bytes / 1_500_000);   // base64 plus a little JSON per piece
}

// ---------- the phone's own videos (V1.33) ----------
/** The biggest video the phone's Add a video takes (the Mac's limit for the vault, ps-mac Backgrounds.swift). */
export const ADD_MAX = 60_000_000;

/** The plain sentence under Add a video. */
export function addNote(kind: "big" | "bad" | "done" | "failed", name: string, mb = 0): string {
  const n = name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "That video";
  if (kind === "big") return `${n} is ${mb} MB. Videos up to ${ADD_MAX / 1e6} MB can go in your vault: trim it and add it again.`;
  if (kind === "bad") return `${n} does not play on this phone. Pick an mp4 or webm video.`;
  if (kind === "done") return `${n} is your background now, and it is on its way to your Macs.`;
  return `${n} could not be added. Check you are online and try again.`;
}

/** The phone: videos whose pieces were all sent that the shell still does not list as kept. Only those it
 *  lists are offered as tiles and played (a file asked for before it was written never plays). */
export function notKept(sent: Iterable<string>, kept: Set<string>): string[] {
  return [...sent].filter((id) => !kept.has(id));
}

// V1.47: while a newer copy of a video downloads to the phone, its older copy (same name, no longer in the vault) plays.
/** Vault video id to the older copy on this phone that plays for it (same name, no longer in the vault). */
export function pickStandIns(list: { id: string; name: string }[], here: Set<string>, names: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const inVault = new Set(list.map((v) => v.id));
  const spare = [...here].filter((id) => !inVault.has(id) && typeof names[id] === "string");
  for (const v of list) {
    if (here.has(v.id)) continue;
    const old = spare.find((id) => names[id] === v.name && ![...out.values()].includes(id));
    if (old) out.set(v.id, old);
  }
  return out;
}
