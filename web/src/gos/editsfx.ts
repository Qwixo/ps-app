// The Edit mode sounds on the phones (V1.56): the phone editor's sounds (ui/phonesfx.ts) under the shared Edit sound
// rules (core/editsounds.ts), and only when the phone is not on silent. The developer, 13 Nov 2026: the phone's Edit mode follows the phone's
// silent mode.
// - PS GOS: the WebView plays on the media stream, which Android never mutes for Silent or Vibrate, so the shell says
//   the ring mode (ps-gos Ringer.kt, "ringer:get"); anything but "normal" is quiet. An older shell never answers: then
//   it plays as the rest of PS does.
// - The iPhone web app: while Edit mode is open its audio session is "ambient" (Safari 17 and later), which the
//   ring/silent switch mutes; it goes back to what it was when Edit mode closes.
// Also quiet when Edit mode sounds are off (Settings), the sound volume is 0 or muted, Do Not Disturb mutes sounds, or a
// meeting is on (core/editsounds.ts editSoundOk).
import type { EditSound } from "../core/editsounds";
import { phoneSfx } from "../ui/phonesfx";
import { GOS, gosPost, onShell } from "./bridge";

import { isSilent, phoneEditSoundOk, type Ringer } from "./phoneedit";
export type { Ringer };
let ringer: Ringer = "unknown";
let gate = { on: true, volume: 0.4, dndMutesSounds: false, meetingNow: false };
let open = false;
let askTimer = 0;
let offShell: (() => void) | null = null;
let sessionWas: string | null = null;

export { isSilent, phoneEditSoundOk };
export const ringerNow = () => ringer;
/** What the list knows: set each time Edit mode draws. volume: 0 to 1. */
export function setPhoneEditGate(g: typeof gate) { gate = g; }

type AudioSessionNav = Navigator & { audioSession?: { type: string } };
/** Edit mode opened: ask the shell for the ring mode now and every few seconds (the volume keys can change it), and on
 *  the iPhone let the silent switch mute these sounds. */
export function editSoundsOpen() {
  if (open) return;
  open = true;
  if (GOS) {
    offShell = onShell((m) => { if (m.type === "ringer") ringer = m.mode === "silent" || m.mode === "vibrate" ? m.mode : "normal"; });
    const ask = () => gosPost({ type: "ringer:get" });
    ask();
    askTimer = window.setInterval(ask, 4000);
  } else {
    try {
      const s = (navigator as AudioSessionNav).audioSession;
      if (s) { sessionWas = s.type; s.type = "ambient"; }
    } catch { /* not this browser */ }
  }
}
/** Edit mode closed: stop asking, give the audio session back. */
export function editSoundsClose() {
  if (!open) return;
  open = false;
  window.clearInterval(askTimer);
  offShell?.(); offShell = null;
  try {
    const s = (navigator as AudioSessionNav).audioSession;
    if (s && sessionWas !== null) s.type = sessionWas;
  } catch { /* ignore */ }
  sessionWas = null;
}

/** The shared Edit sound names, played through the phone editor's own sounds (ui/phonesfx.ts, one sound module for
 *  the phone work): into and out of Edit mode the whoosh, setting things down the drop, the rest a soft click. */
export const PHONE_SOUND: Record<EditSound, keyof typeof phoneSfx> = {
  "edit-in": "zoomOut", "edit-out": "zoomIn", "edit-fly": "click", "edit-tick": "click", "edit-drop": "drop",
  "edit-page-add": "click", "edit-page-remove": "drop", "edit-save": "linked", "edit-switch": "click", "edit-reset": "drop",
};
/** Play one of the Edit sounds (or nothing: see phoneEditSoundOk). */
export function phoneEditSfx(name: EditSound) {
  if (!phoneEditSoundOk(gate, ringer)) return;
  phoneSfx[PHONE_SOUND[name]]();
}
