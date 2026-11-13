// Auto approve (the developer's friend, 12 Nov 2026: PS answers Yes to AI tools' permission prompts so long jobs keep going;
// questions still wait for a person). PS on the Mac does the work (ps-mac Sources/AutoApprove.swift): it keeps the
// three switches on that Mac and sends their state, why it is on now, the hook rows and a short log in
// psSettings.autoApprove. A click goes out as {type:"autoApprove:set", key, on}; Clear as {type:"autoApprove:clearLog"}.
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
  return { ai: o.ai === true, sleep: o.sleep === true, always: o.always === true, on: o.on === true,
    ...(typeof o.why === "string" ? { why: o.why } : {}), hooks, ...(typeof o.keys === "string" ? { keys: o.keys } : {}), log: log.slice(0, 30) };
}
