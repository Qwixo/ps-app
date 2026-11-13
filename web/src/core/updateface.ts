// The update card in the Tab list itself (V1.40, the developer: "whenever there's an update, make sure it comes up in the
// PS Tab overlay, like saying hey, update available, here's all the changes, update now, and do an animation
// when it updates ... I want it to be in your face"). The gear menu row stays; this is the same update, shown
// on the list as soon as the developer holds Tab (views/UpdateFace.tsx). Pure, so tests/updateface.test.ts runs it.
//
// What it shows:
//   offer:    an update is waiting. Update now, or Later (it hides for this hold and comes back on the next one,
//             every hold, until it is installed).
//   progress: Download, Verify, Install with the bar, then Relaunch to finish (every hold until it is done).
//   done:     "Updated to V1.xx" with the changes, once (Got it, or a hold that showed it for a while).
//   error:    the update stopped, once, with Try again.
// Never while the welcome tour or the What's new panel is open (they go first).
import type { MacUpdate } from "./macupdate";

export type FaceKind = "offer" | "progress" | "done" | "error";

/** A shown "done" card counts as seen once it was on screen this long (a hold that ended sooner shows it again). */
export const FACE_SEEN_AFTER = 2500;

const BUSY = new Set(["downloading", "verifying", "installing", "ready", "relaunching"]);

/** One update's name, so Later for one never hides a newer one. */
export function faceKey(u: MacUpdate): string {
  return `${u.version ?? ""}|${u.keyword ?? ""}|${u.kind ?? ""}|${u.size ?? 0}`;
}

/** What the card shows now, or null. `later`: the key the developer pressed Later on during this hold. */
export function faceFor(u: MacUpdate, o: { later: string | null; blocked: boolean }): FaceKind | null {
  if (o.blocked) return null;
  if (u.state === "available") return o.later === faceKey(u) ? null : "offer";
  if (BUSY.has(u.state)) return "progress";
  if (u.state === "done" && u.unseen) return "done";
  if (u.state === "error" && u.unseen) return "error";
  return null;
}

/** The changes under "Updated to": this build's approved notes, only when they are for the version it runs now. */
export function doneNotes(current: string | undefined, bundle: { version: string; notes: string[] } | null): string[] {
  const v = (current ?? "").replace(/^V/, "");
  return bundle && v && bundle.version === v ? bundle.notes : [];
}
