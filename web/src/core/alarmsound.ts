// The alarm's sound (V1.44, a G Squad friend via the developer, 9 Nov 2026): "upload custom audio file to the alarm so that I
// can have for example YOU ARE BROKE as an alarm" and "being able to set and test the audio, how loud it will
// actually be. i want it to be loud. right now there is a couple options and only one of them is loud".
// Pure rules here (tests/alarmsound.test.ts). The Mac does the same maths in ps-mac Sources/SleepSound.swift and the
// phone plays the WAV this page makes for it (ps-gos Sleep.kt), so a sound is as loud on every device.
//  - The built in sounds (the soft chime and the alarm) are drawn from the tone tables below and brought to ONE level
//    (TARGET_DB, measured as the loudest 400 ms), so no wake style is quieter than Loud any more.
//  - Your own sound: an mp3, m4a, wav or aiff file, up to OWN_MAX_MB, its first OWN_MAX_SECS seconds, made mono and
//    brought to the same level, kept as a small WAV on that device only (never in the vault, never uploaded).
//  - Alarm loudness: one level for every alarm (LEVEL_DEF). On a Mac or the phone the device's own volume is set to
//    it while the alarm rings (and Test plays), then put back; a browser can only play at that share of its volume.

// ---------- measuring ----------
/** The highest sample, 0 to 1 (and over 1 if the samples clip). */
export function peakOf(x: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return p;
}
/** How loud a sound gets: the loudest `win` seconds (RMS, every `hop` seconds), 0 to 1. A short sound is measured
 *  whole. Like a loudness meter's "momentary max": a beep and a chime that read the same here sound as loud. */
export function loudestOf(x: ArrayLike<number>, rate: number, win = 0.4, hop = 0.1): number {
  const n = x.length;
  if (n === 0) return 0;
  const w = Math.max(1, Math.min(n, Math.round(win * rate))), h = Math.max(1, Math.round(hop * rate));
  // A running sum of squares, so a minute of sound is measured in one pass.
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  let best = 0;
  for (let s = 0; s + w <= n; s += h) best = Math.max(best, (sq[s + w] - sq[s]) / w);
  best = Math.max(best, (sq[n] - sq[n - w]) / w);   // the last window, wherever the hop ended
  return Math.sqrt(best);
}
export const toDb = (a: number) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
export const fromDb = (d: number) => Math.pow(10, d / 20);

// ---------- one level for every sound ----------
/** Every alarm sound is brought to this: its loudest 400 ms at 12 dB under full scale. Measured on 9 Nov 2026 (tests/
 *  alarmsound.test.ts prints it): the V1.43 alarm tone was at -19.6 dB and the soft chime at -18.7 dB, and the soft
 *  styles then started at 12 to 35% of that. Now every sound is at -12 dB, about 7 dB over the old Loud. */
export const TARGET_DB = -12;
/** A quiet file is raised by at most this much (a near silent file must not turn into loud hiss). */
export const MAX_GAIN_DB = 30;
/** Above this the soft limiter rounds the peaks off, so a raised file never clips (it never reaches 1). */
export const KNEE = 0.8;
/** The soft limiter: unchanged up to KNEE, then gently towards (never past) 1. */
export function soften(v: number): number {
  const a = Math.abs(v);
  if (a <= KNEE) return v;
  return Math.sign(v) * (KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE)));
}
/** The gain that brings a sound to TARGET_DB (capped at MAX_GAIN_DB; silence gets none). */
export function gainFor(loudest: number): number {
  if (!(loudest > 1e-6)) return 1;
  return Math.min(fromDb(MAX_GAIN_DB), fromDb(TARGET_DB) / loudest);
}
/** The sound brought to the one level: the gain, then the limiter. The limiter takes a little off a sound with sharp
 *  peaks, so up to two more passes add that back (never past MAX_GAIN_DB). A new array; the input is left alone. */
export function normalise(x: ArrayLike<number>, rate: number): Float32Array {
  const loud = loudestOf(x, rate), max = fromDb(MAX_GAIN_DB);
  let g = gainFor(loud);
  const out = new Float32Array(x.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < x.length; i++) out[i] = soften(x[i] * g);
    if (!(loud > 1e-6)) break;
    const got = loudestOf(out, rate), want = fromDb(TARGET_DB);
    if (got >= want * fromDb(-0.25) || g >= max) break;
    g = Math.min(max, g * want / got);
  }
  return out;
}

// ---------- the built in sounds ----------
// The same recipe as ps-mac Sfx.wav: each tone starts in 4 ms and fades by 60 dB over its length.
export interface Tone { f: number; dur: number; peak: number; wave: 0 | 1 | 2; at: number }   // wave: 0 sine, 1 triangle, 2 square
export type BuiltIn = "soft" | "alarm";
export const RATE = 44100;
/** One loop of each built in sound, and how long a loop is (it repeats while the alarm rings). The peaks are the
 *  V1.43 ones; normalise() sets the real level. */
export const TONES: Record<BuiltIn, { tones: Tone[]; loop: number }> = {
  soft: { loop: 2.6, tones: [{ f: 660, dur: 0.9, peak: 0.3, wave: 0, at: 0 }, { f: 880, dur: 0.9, peak: 0.28, wave: 0, at: 0.22 }, { f: 990, dur: 1.2, peak: 0.26, wave: 0, at: 0.44 }] },
  alarm: { loop: 1.3, tones: [0, 1, 2, 3].flatMap((i) => [{ f: 1046, dur: 0.12, peak: 0.3, wave: 2 as const, at: i * 0.16 }, { f: 784, dur: 0.12, peak: 0.34, wave: 0 as const, at: i * 0.16 }]) },
};
/** One loop of the tones as samples (not normalised). */
export function renderTones(tones: Tone[], loop: number, rate = RATE): Float32Array {
  const n = Math.round(loop * rate);
  const buf = new Float32Array(n);
  for (const t of tones) {
    const start = Math.round(t.at * rate), len = Math.round(t.dur * rate);
    let phase = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const x = i / rate;
      phase += t.f / rate;
      const p = phase - Math.floor(phase);
      const w = t.wave === 0 ? Math.sin(2 * Math.PI * p) : t.wave === 1 ? 4 * Math.abs(p - 0.5) - 1 : (p < 0.5 ? 1 : -1);
      const attack = 0.004;
      const env = x < attack ? x / attack : Math.exp(-6.9 * (x - attack) / Math.max(0.001, t.dur - attack));
      buf[start + i] += w * env * t.peak;
    }
  }
  return buf;
}
/** A built in sound, one loop, at the one level. */
export function builtInSound(kind: BuiltIn, rate = RATE): Float32Array {
  const t = TONES[kind];
  return normalise(renderTones(t.tones, t.loop, rate), rate);
}

// ---------- your own sound ----------
export const OWN_MAX_MB = 20;
export const OWN_MAX_SECS = 60;
/** Your own sound is kept at this rate, mono (a minute is under 4 MB). */
export const OWN_RATE = 32000;
export const OWN_EXT = ["mp3", "m4a", "wav", "aiff", "aif"];
export const OWN_ACCEPT = ".mp3,.m4a,.wav,.aiff,.aif,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/aiff,audio/x-aiff";
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
/** What the file's first bytes say it is (never the name alone), or null. */
export function sniffAudio(head: Uint8Array): "mp3" | "m4a" | "wav" | "aiff" | null {
  if (head.length < 12) return null;
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WAVE") return "wav";
  if (ascii(head, 0, 4) === "FORM" && (ascii(head, 8, 4) === "AIFF" || ascii(head, 8, 4) === "AIFC")) return "aiff";
  if (ascii(head, 4, 4) === "ftyp") return "m4a";
  if (ascii(head, 0, 3) === "ID3") return "mp3";
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "mp3";   // an MPEG frame with no tag
  return null;
}
/** Can this file be your own sound? A plain sentence when not. */
export function checkOwnFile(name: string, size: number, head: Uint8Array): { ok: true } | { ok: false; why: string } {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (!OWN_EXT.includes(ext)) return { ok: false, why: "Pick an mp3, m4a, wav or aiff file." };
  if (!(size > 0)) return { ok: false, why: "That file is empty." };
  if (size > OWN_MAX_MB * 1024 * 1024) return { ok: false, why: `That file is over ${OWN_MAX_MB} MB. A shorter clip works.` };
  if (!sniffAudio(head)) return { ok: false, why: "That file does not look like a sound file PS app can play." };
  return { ok: true };
}
/** The name shown for your own sound: the file name without its ending, tidy and short. */
export function ownName(file: string): string {
  const base = file.replace(/\.[^.]+$/, "").replace(/[\u0000-\u001f]/g, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Your sound").slice(0, 40);
}
/** Mixes the file's channels to one and keeps the first OWN_MAX_SECS seconds. */
export function toMono(channels: ArrayLike<number>[], rate: number): Float32Array {
  const len = Math.min(channels[0]?.length ?? 0, Math.round(OWN_MAX_SECS * rate));
  const out = new Float32Array(len);
  if (!channels.length) return out;
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i] / channels.length;
  return out;
}
/** Trims silence off both ends (a file that starts with 3 seconds of nothing would wake you 3 seconds late). */
export function trimSilence(x: Float32Array, floor = fromDb(-50)): Float32Array {
  let a = 0, b = x.length;
  while (a < b && Math.abs(x[a]) < floor) a++;
  while (b > a && Math.abs(x[b - 1]) < floor) b--;
  return x.subarray(a, b);
}
/** 16 bit mono WAV bytes. */
export function wavBytes(x: ArrayLike<number>, rate: number): Uint8Array {
  const n = x.length, out = new Uint8Array(44 + n * 2), v = new DataView(out.buffer);
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), true);
  return out;
}
/** Back from WAV bytes (16 bit mono, as wavBytes writes them) to samples and the rate. Null for anything else. */
export function wavSamples(b: Uint8Array): { x: Float32Array; rate: number } | null {
  if (b.length < 44 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint16(22, true) !== 1 || v.getUint16(34, true) !== 16) return null;
  const rate = v.getUint32(24, true), n = Math.floor(Math.min(v.getUint32(40, true), b.length - 44) / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = v.getInt16(44 + i * 2, true) / 32767;
  return { x, rate };
}
/** Your own sound, ready to keep: one channel, silence trimmed, at the one level, as WAV bytes. Null: nothing to hear. */
export function ownSound(channels: ArrayLike<number>[], rate: number): { wav: Uint8Array; secs: number } | null {
  const x = trimSilence(toMono(channels, rate));
  if (x.length < rate * 0.1) return null;   // under a tenth of a second (or silent): nothing to wake you
  return { wav: wavBytes(normalise(x, rate), rate), secs: Math.round((x.length / rate) * 10) / 10 };
}
export interface OwnSound { name: string; secs: number }
export function cleanOwn(v: unknown): OwnSound | null {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o || typeof o.name !== "string" || !o.name.trim()) return null;
  const secs = Number(o.secs);
  return { name: o.name.slice(0, 40), secs: Number.isFinite(secs) && secs > 0 ? Math.min(OWN_MAX_SECS, secs) : 0 };
}

// ---------- how loud the alarm rings ----------
export const LEVEL_MIN = 0.1, LEVEL_DEF = 0.8;
/** The alarm loudness, 0.1 to 1 in steps of 0.05 (anything else: the default). */
export function okLevel(v: unknown): number {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return LEVEL_DEF;
  return Math.round(Math.max(LEVEL_MIN, Math.min(1, n)) * 20) / 20;
}
export const pct = (level: number) => `${Math.round(okLevel(level) * 100)}%`;
/** The device volume an alarm sets while it rings: the loudness, and Loud always the whole way up. */
export const ringLevel = (loud: boolean, level: number) => (loud ? 1 : okLevel(level));
/** The plain line under the slider, per device. */
export function levelLine(where: "mac" | "phone" | "web"): string {
  if (where === "mac") return "While an alarm rings, PS app sets this Mac's volume to this level and unmutes it, then puts your volume back when you stop it. Test does the same. Loud always rings at 100%.";
  if (where === "phone") return "While an alarm rings, PS app sets the phone's alarm volume to this level, then puts it back when you stop it. Test does the same. Loud always rings at 100%.";
  return "In a browser PS app cannot change your volume: alarms play at this share of it. Turn your volume up before you sleep.";
}
/** The Test button's words while it plays and after, and how long Test plays before it stops by itself. */
export const TEST_FOR = 10_000;
