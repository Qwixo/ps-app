// Sounds for the phone layout editor (V1.56, the developer: "Obviously add cool sound effects in too"). Original, made here
// with WebAudio (filtered noise and soft tones, no recordings), at the list's own volume (ui/sfx.ts), silent at 0.
//
// The edit-nav chat is making a shared edit sound module (core/editsounds.ts, one "Edit mode sounds" switch that follows
// mute, Do Not Disturb and meetings). When it lands, point these five at it; every caller uses only these names.
import { sfx, sfxAudio } from "./sfx";

/** A soft whoosh: noise through a band pass that sweeps up (into the phone) or down (back to the Mac). */
function whoosh(up: boolean) {
  const { a, v } = sfxAudio();
  if (!a || v <= 0) return;
  try {
    const dur = 0.5, t0 = a.currentTime;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(up ? 380 : 2600, t0);
    bp.frequency.exponentialRampToValueAtTime(up ? 2600 : 380, t0 + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.32 * v, t0 + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(a.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
    // A small bell at the end, higher into the phone, lower back to the Mac.
    const o = a.createOscillator(), og = a.createGain();
    o.type = "sine"; o.frequency.value = up ? 1320 : 660;
    og.gain.setValueAtTime(0.0001, t0 + dur * 0.62);
    og.gain.exponentialRampToValueAtTime(0.09 * v, t0 + dur * 0.68);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.35);
    o.connect(og).connect(a.destination);
    o.start(t0 + dur * 0.62); o.stop(t0 + dur + 0.4);
  } catch { /* no audio here */ }
}
/** Two notes up: a phone just signed in ("Linked!"). */
function chime() {
  const { a, v } = sfxAudio();
  if (!a || v <= 0) return;
  try {
    for (const [f, at] of [[880, 0], [1318.5, 0.12]] as const) {
      const t0 = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16 * v, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(g).connect(a.destination);
      o.start(t0); o.stop(t0 + 0.65);
    }
  } catch { /* no audio here */ }
}
export const phoneSfx = {
  zoomIn: () => whoosh(true),
  zoomOut: () => whoosh(false),
  drop: () => sfx.drop(),
  click: () => sfx.click(),
  linked: () => chime(),
};
