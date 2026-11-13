// Mac PS updates: what the gear menu may show (the store and bridge are in src/macupdate.ts, the
// native updater in ps-mac Sources/Updater.swift). Pure, so tests/macupdate.test.ts can run it.
export type MacUpdateState = "idle" | "checking" | "none" | "available" | "downloading" | "verifying" | "installing"
  | "ready" | "relaunching" | "done" | "error";
import { cleanBlocks, type NoteBlock } from "./notehistory.ts";
import { cleanMade } from "./releaseby.ts";

export type MacUpdate = {
  state: MacUpdateState;
  version?: string; keyword?: string;          // the update's "V1.23" and its word
  by?: string;                                 // V1.58: who made it ("jan", "gsquad"); none before V1.58
  current?: string; currentKeyword?: string;   // this Mac's version now
  kind?: "app" | "web";                        // app: a relaunch; web: the pages reload, no restart
  size?: number; progress?: number; notes?: string[]; error?: string;
  history?: NoteBlock[];                       // V1.52: the approved notes of the earlier versions, newest first
  unseen?: boolean;                            // done or error that the developer has not looked at yet (the gear's dot)
};

const STATES = new Set<MacUpdateState>(["idle", "checking", "none", "available", "downloading", "verifying", "installing", "ready", "relaunching", "done", "error"]);
const word = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Only known states and plain values reach the menu (it shows text, never HTML). */
export function cleanMacUpdate(x: unknown): MacUpdate {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const state = STATES.has(o.state as MacUpdateState) ? (o.state as MacUpdateState) : "idle";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const p = num(o.progress);
  return {
    state,
    version: word(o.version, 12), keyword: word(o.keyword, 20), current: word(o.current, 12), currentKeyword: word(o.currentKeyword, 20),
    kind: o.kind === "web" ? "web" : o.kind === "app" ? "app" : undefined,
    size: num(o.size) && num(o.size)! > 0 ? num(o.size) : undefined,
    progress: p === undefined ? undefined : Math.max(0, Math.min(1, p)),
    notes: Array.isArray(o.notes) ? o.notes.map((n) => word(n, 220)).filter((n): n is string => !!n).slice(0, 6) : undefined,
    history: Array.isArray(o.history) && o.history.length ? cleanBlocks(o.history) : undefined,
    error: word(o.error, 240), unseen: o.unseen === true,
    ...(cleanMade(o) ? { by: cleanMade(o)!.by } : {}),
  };
}

/** The gear wears a dot while something waits for the developer: an update to take, one to finish, news of one. */
export function macUpdateBadge(u: MacUpdate): "update" | "done" | "error" | null {
  if (u.state === "available" || u.state === "ready") return "update";
  if (u.state === "error" && u.unseen) return "error";
  if (u.state === "done" && u.unseen) return "done";
  return null;
}
