// The tick beside the version looks for updates when clicked (the developer, 2 Nov 2026: "I can click on the tick
// icon, and it turns into a refresh icon, does an animation, refreshes (searches for updates), then goes
// back to the tick if it's still on the latest update"). Mac: the tick on "Updated to V1.xx" in the Tab
// list's gear menu (views/MacUpdate.tsx). Phone: the tick on "You are up to date" (gos/GosUpdate.tsx).
// The shells' own checks do the looking; this only times what the orb shows. Pure, so
// tests/updatetick.test.ts can run it.

/** What the shell's answer was: nothing newer, an update to offer, or the look failed. */
export type TickResult = "none" | "offer" | "error";
/** One click on the tick: when, and the shell's answer once it came. */
export type TickCheck = { at: number; result?: TickResult; resultAt?: number };
/** tick: resting. spin: the refresh arrow turns. fail: "Could not check" for a moment. offer: show the update. */
export type TickPhase = "tick" | "spin" | "fail" | "offer";

export const TICK_SPIN_MIN = 650;     // the arrow turns at least this long, so a quick answer never just flickers
export const TICK_TIMEOUT = 15_000;   // no answer by then: "Could not check"
export const TICK_FAIL_SHOW = 1_800;  // how long "Could not check" stays before the tick comes back

/** The shells' states (Mac and phone share these names) as an answer, or undefined while still looking. */
export function tickResult(state: string): TickResult | undefined {
  if (state === "none") return "none";
  if (state === "error") return "error";
  if (state === "available") return "offer";
  return undefined;
}

/** Keeps the first answer that came after the click. */
export function tickRecord(c: TickCheck | null, state: string, now: number): TickCheck | null {
  if (!c || c.result) return c;
  const result = tickResult(state);
  return result ? { ...c, result, resultAt: now } : c;
}

export function tickPhase(c: TickCheck | null, now: number): TickPhase {
  if (!c) return "tick";
  const late = c.at + TICK_TIMEOUT;
  // An update is always shown, even one found after the timeout (it is real).
  if (c.result === "offer") return now < Math.max(c.resultAt ?? now, c.at + TICK_SPIN_MIN) ? "spin" : "offer";
  if (!c.result || (c.resultAt ?? 0) >= late) return now < late ? "spin" : now < late + TICK_FAIL_SHOW ? "fail" : "tick";
  const shown = Math.max(c.resultAt ?? c.at, c.at + TICK_SPIN_MIN);
  if (now < shown) return "spin";
  return c.result === "error" && now < shown + TICK_FAIL_SHOW ? "fail" : "tick";
}

/** The next moment the phase can change by itself (one timer, no running clock), or null. */
export function tickNext(c: TickCheck | null, now: number): number | null {
  if (!c) return null;
  const late = c.at + TICK_TIMEOUT;
  const at = [c.at + TICK_SPIN_MIN, late, late + TICK_FAIL_SHOW];
  if (c.resultAt !== undefined) { const shown = Math.max(c.resultAt, c.at + TICK_SPIN_MIN); at.push(shown, shown + TICK_FAIL_SHOW); }
  const next = at.filter((t) => t > now);
  return next.length ? Math.min(...next) : null;
}

/** While the tick looks (or after it looked and found nothing, or failed), the card stays the up to date
 *  card with its tick instead of the plain "Looking for updates" or "Update stopped". */
export function tickHolds(state: string, phase: TickPhase, c: TickCheck | null): boolean {
  if (!c) return false;
  if (phase === "spin" || phase === "fail") return true;
  if (state === "none" || state === "idle" || state === "checking") return true;
  return state === "error" && c.result === "error";
}

/** An update that is downloading, installing or waiting to finish ends the tick's part. */
export function tickKeeps(state: string): boolean {
  return state === "done" || state === "none" || state === "idle" || state === "checking" || state === "error" || state === "available";
}
