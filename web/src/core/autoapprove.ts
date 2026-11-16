// Auto approve (the developer's friend, 12 Nov 2026: PS answers Yes to AI tools' permission prompts so long jobs keep going;
// questions still wait for a person). PS on the Mac does the work (ps-mac Sources/AutoApprove.swift): it keeps the
// three switches on that Mac and sends their state, why it is on now, the hook rows and a short log in
// psSettings.autoApprove. A click goes out as {type:"autoApprove:set", key, on}; Clear as {type:"autoApprove:clearLog"}.
// PS 1.65: In AI mode and In Sleep mode start On (Always stays Off), but only once the notice below was shown on that Mac;
// see APPROVE_DEFAULTS.
// Pure rules only (no React, no DOM), so tests/autoapprove.test.ts checks them.

export type ApproveKey = "ai" | "sleep" | "always";
export interface ApproveLog {
  /** Seconds since 1970. */
  at: number;
  /** Claude Code, Codex, Terminal, iTerm2, Warp, VS Code or Cursor. */
  app: string;
  /** hook: answered by the tool's own hook. key: PS pressed Return. waiting: seen, PS may not press keys now.
   *  stuck: pressed three times and the prompt stayed. */
  how: "hook" | "key" | "waiting" | "stuck";
  /** The command or file, shortened on the Mac with secrets taken out. */
  what: string;
  /** The folder's name only (hook lines). */
  where?: string;
}
export interface ApproveState {
  /** PS 1.65: at least one of AI mode and Sleep mode still stands on its default (the person never chose it on this Mac). */
  defaulted?: boolean;
  /** PS 1.65: which of the notice's switches this Mac has no choice saved for ("ai", "sleep"). */
  unset?: ApproveKey[];
  /** PS 1.65: the notice was shown on this Mac (until then a default acts as off). */
  noticed?: boolean;
  ai: boolean;
  sleep: boolean;
  always: boolean;
  /** On right now, and why: "AI mode", "Sleep mode" or "Always". */
  on: boolean;
  why?: string;
  /** One plain line per tool about its hook (claude, codex). */
  hooks?: Record<string, string>;
  /** One plain line about the key route (permissions it needs). */
  keys?: string;
  /** Newest first, at most 30. */
  log?: ApproveLog[];
}

// PS 1.65 (the developer's friend, 17 Nov 2026): "In AI mode" and "In Sleep mode" are ON until the person chooses; "Always" is OFF.
// The Mac keeps the rule (ApproveCore.resolve): a saved On or Off is never changed, only an unset switch takes the default, and
// only once the notice was shown on that Mac (until then the defaults act as off, so nothing is written anywhere).
export const APPROVE_DEFAULTS: Record<ApproveKey, boolean> = { ai: true, sleep: true, always: false };
/** What a switch is, given what the Mac saved (undefined: never chosen) and whether the defaults count there yet. */
export const approveResolve = (saved: Partial<Record<ApproveKey, boolean>>, live = true): Record<ApproveKey, boolean> => ({
  ai: saved.ai ?? (live && APPROVE_DEFAULTS.ai), sleep: saved.sleep ?? (live && APPROVE_DEFAULTS.sleep), always: saved.always ?? APPROVE_DEFAULTS.always,
});

/** The one notice, about a minute into 1.65 (the island feature intro, core/featureintro.ts). Words wait for the owner's approval. */
export const APPROVE_FEATURE = "auto-approve-defaults";
export const APPROVE_INTRO = {
  id: "auto-approve-165",
  headline: "Auto approve now comes on with AI mode and Sleep mode",
  ask: "While one is on, PS says Yes to your AI tools' permission prompts, so long jobs keep going. Questions still wait for you.",
  show: "Keep it on",
  later: "Turn off",
} as const;
/** The two switches the notice lets a person keep one by one. */
export const APPROVE_PICKS: { id: ApproveKey; label: string }[] = [
  { id: "ai", label: "In AI mode" },
  { id: "sleep", label: "In Sleep mode" },
];
/** The notice's switches this Mac still has no choice for (the only ones the card shows and the answer sends). */
export function approvePicksFor(s: ApproveState | undefined): { id: ApproveKey; label: string }[] {
  const open = s?.unset ?? [];
  return APPROVE_PICKS.filter((p) => open.includes(p.id));
}
/** What the notice's answer sends to the Mac, one {key, on, quiet} per switch still unset there. "Keep it on" keeps the switches
 *  still ticked and turns the others off; "Turn off" turns them all off. Each is the person's own choice, so the Mac saves it and
 *  the default no longer applies. Quiet: the Mac asks macOS nothing for an answer from the notice. */
export function approveAnswer(turnOff: boolean, keep: readonly string[], unset: readonly ApproveKey[] = ["ai", "sleep"]): { key: ApproveKey; on: boolean; quiet: true }[] {
  return APPROVE_PICKS.filter((p) => unset.includes(p.id)).map((p) => ({ key: p.id, on: !turnOff && keep.includes(p.id), quiet: true as const }));
}
/** The switches the notice turned off, kept with the person's settings (approveOff), so the answer reaches every one of their
 *  Macs: the ones already off from an earlier answer plus this answer's. */
export function approveOffAfter(before: unknown, sent: readonly { key: ApproveKey; on: boolean }[]): ApproveKey[] {
  const was = cleanApproveOff(before);
  return APPROVE_PICKS.map((p) => p.id).filter((k) => was.includes(k) || sent.some((x) => x.key === k && !x.on));
}
export function cleanApproveOff(v: unknown): ApproveKey[] {
  return Array.isArray(v) ? APPROVE_PICKS.map((p) => p.id).filter((k) => v.includes(k)) : [];
}
/** On a Mac: what to send so a Turn off given on another Mac applies here too. Only for a switch still on its default here (a
 *  choice saved on this Mac stands). Quiet: nothing is asked of macOS. */
export function approveSyncPosts(s: ApproveState | undefined, off: unknown): { key: ApproveKey; on: false; quiet: true }[] {
  if (!s) return [];
  const open = s.unset ?? [];
  return cleanApproveOff(off).filter((k) => open.includes(k)).map((key) => ({ key, on: false as const, quiet: true as const }));
}
/** Show the notice on a Mac while one of its switches still has no choice there (a Mac that has not seen it shows it). It retires
 *  once each one is chosen, here or by a synced Turn off. Unknown state waits, never a guess. */
export function approveIntroProbe(s: ApproveState | undefined, off?: unknown): "open" | "done" | "unknown" {
  if (!s) return "unknown";
  if (!s.defaulted) return "done";
  const left = (s.unset ?? []).filter((k) => !cleanApproveOff(off).includes(k));
  return left.length ? "open" : "unknown";   // only synced offs left: they apply in a moment, then it is done
}

/** The settings line: one plain sentence with the risk in it. */
export const APPROVE_LINE = "Says Yes to AI permission prompts, so nothing stops an AI that a web page or file tricks into harm.";

export const APPROVE_ROWS: { key: ApproveKey; name: string; line: string }[] = [
  { key: "ai", name: "In AI mode", line: "While Sentry mode is on." },
  { key: "sleep", name: "In Sleep mode", line: "While Sleep mode is on (not for an alarm alone)." },
  { key: "always", name: "Always auto approve", line: "All the time, while PS app is open." },
];

/** "Now: on (AI mode)" or "Now: off". */
export function approveNow(s: ApproveState | undefined): string {
  if (!s) return "Checking this Mac…";
  if (s.on) return `Now: on (${s.why ?? "Always"}).`;
  if (!s.ai && !s.sleep && !s.always) return "Now: off. Every switch is off.";
  return "Now: off. It turns on by itself in the mode you picked.";
}

/** A log line's words, as a person reads them. */
export function approveLogLine(l: ApproveLog): string {
  const where = l.where ? ` in ${l.where}` : "";
  if (l.how === "waiting" || l.how === "stuck") return `${l.app}: ${l.what}`;
  return `${l.app}${where}: ${l.what}${l.how === "key" ? " (Return pressed)" : ""}`;
}

/** The time of a log line: HH:MM today, else day and month too. */
export function approveTime(at: number, now = Date.now()): string {
  const d = new Date(at * 1000), n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === n.toDateString() ? hm : `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${hm}`;
}

/** The Mac's state checked field by field (an older PS app sends none: undefined). */
export function cleanApprove(v: unknown): ApproveState | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const hows = ["hook", "key", "waiting", "stuck"];
  const log = Array.isArray(o.log) ? o.log.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x): ApproveLog => ({ at: Number(x.at) || 0, app: String(x.app ?? "").slice(0, 40), how: (hows.includes(String(x.how)) ? x.how : "hook") as ApproveLog["how"],
      what: String(x.what ?? "").slice(0, 200), ...(x.where ? { where: String(x.where).slice(0, 40) } : {}) })) : [];
  const hooks: Record<string, string> = {};
  if (o.hooks && typeof o.hooks === "object") for (const [k, val] of Object.entries(o.hooks as Record<string, unknown>)) if (typeof val === "string") hooks[k] = val;
  const unset = Array.isArray(o.unset) ? (["ai", "sleep"] as ApproveKey[]).filter((k) => (o.unset as unknown[]).includes(k)) : [];
  return { defaulted: o.defaulted === true, unset, noticed: o.noticed === true, ai: o.ai === true, sleep: o.sleep === true, always: o.always === true, on: o.on === true,
    ...(typeof o.why === "string" ? { why: o.why } : {}), hooks, ...(typeof o.keys === "string" ? { keys: o.keys } : {}), log: log.slice(0, 30) };
}
