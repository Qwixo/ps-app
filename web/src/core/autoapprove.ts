// Auto approve (the developer's friend, 12 Nov 2026: PS answers Yes to AI tools' permission prompts so long jobs keep going;
// questions still wait for a person). PS on the Mac does the work (ps-mac Sources/AutoApprove.swift): it keeps the
// three switches on that Mac and sends their state, why it is on now, the hook rows and a short log in
// psSettings.autoApprove. A click goes out as {type:"autoApprove:set", key, on}; Clear as {type:"autoApprove:clearLog"}.
// PS 1.65: In AI mode and In Sleep mode start On, see APPROVE_DEFAULTS below.
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
  /** PS 1.65: at least one of AI mode and Sleep mode still stands on its default (the person never chose it). */
  defaulted?: boolean;
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
// The Mac keeps the rule (ApproveCore.resolve): a saved On or Off is never changed, only an unset switch takes the default.
export const APPROVE_DEFAULTS: Record<ApproveKey, boolean> = { ai: true, sleep: true, always: false };
/** What a switch is, given what the Mac saved (undefined: never chosen). A saved answer always wins. */
export const approveResolve = (saved: Partial<Record<ApproveKey, boolean>>): Record<ApproveKey, boolean> => ({
  ai: saved.ai ?? APPROVE_DEFAULTS.ai, sleep: saved.sleep ?? APPROVE_DEFAULTS.sleep, always: saved.always ?? APPROVE_DEFAULTS.always,
});

/** The one notice, about a minute into 1.65 (the island feature intro, core/featureintro.ts). */
export const APPROVE_FEATURE = "auto-approve-defaults";
export const APPROVE_INTRO = {
  id: "auto-approve-165",
  headline: "Sentry mode now says Yes for you.",
  ask: "While Sentry or Sleep mode is on, Auto approve says Yes to your AI tools' permission prompts, so long jobs keep going. Questions still wait for you. Do you want this off?",
  show: "Keep it on",
  later: "Turn off",
} as const;
/** The two switches the notice lets a person keep one by one. */
export const APPROVE_PICKS: { id: ApproveKey; label: string }[] = [
  { id: "ai", label: "In AI mode" },
  { id: "sleep", label: "In Sleep mode" },
];
/** What the notice's answer sends to the Mac, one {key, on} per switch. "Keep it on" keeps the switches still ticked and turns the
 *  others off; "Turn off" turns both off. Each is the person's own choice, so it is saved and the default no longer applies. */
export function approveAnswer(turnOff: boolean, keep: readonly ApproveKey[]): { key: ApproveKey; on: boolean }[] {
  return APPROVE_PICKS.map((p) => ({ key: p.id, on: !turnOff && keep.includes(p.id) }));
}
/** Show the notice only while a default stands, and only when the Mac says so. Unknown state waits, never a guess. */
export function approveIntroProbe(s: ApproveState | undefined): "open" | "done" | "unknown" {
  if (!s) return "unknown";
  return s.defaulted ? "open" : "done";
}

/** The settings line: one plain sentence with the risk in it. */
export const APPROVE_LINE = "Says Yes to AI permission prompts, so nothing stops an AI that a web page or file tricks into harm.";

export const APPROVE_ROWS: { key: ApproveKey; name: string; line: string }[] = [
  { key: "ai", name: "In AI mode", line: "While Sentry mode is on." },
  { key: "sleep", name: "In Sleep mode", line: "While the sleep screen is up." },
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
  return { defaulted: o.defaulted === true, ai: o.ai === true, sleep: o.sleep === true, always: o.always === true, on: o.on === true,
    ...(typeof o.why === "string" ? { why: o.why } : {}), hooks, ...(typeof o.keys === "string" ? { keys: o.keys } : {}), log: log.slice(0, 30) };
}
