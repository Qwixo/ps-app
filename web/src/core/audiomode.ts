// Headphones mode (V1.40, G Squad): the Speakers | Headphones switch in the volume mixer. Per mode, a sound
// output and a microphone, each with a fallback order (first choice, then the next one connected). The Mac
// does the switching (ps-mac Sources/Headphones.swift); this file keeps the preferences, saved as
// settings.tmAudio so they sync like other PS settings. Which mode is on is kept per Mac, not here.
// Empty lists: Speakers plays through the built in speakers, Headphones through the first headphones connected,
// and an empty microphone list leaves the microphone as it is. The auto switch starts off on every account.

export interface AudioRef { uid: string; name: string }
export interface AudioPrefs {
  auto: boolean;                 // go to Headphones when they connect, back to Speakers when they go (default off)
  spkOut: AudioRef[]; spkMic: AudioRef[];
  hpOut: AudioRef[]; hpMic: AudioRef[];
}
export type AudioMode = "speakers" | "headphones";
export type AudioList = "spkOut" | "spkMic" | "hpOut" | "hpMic";
export const AUDIO_LISTS: AudioList[] = ["spkOut", "spkMic", "hpOut", "hpMic"];
export const AUDIO_MAX = 8;
export const AUDIO_DEFAULTS: AudioPrefs = { auto: false, spkOut: [], spkMic: [], hpOut: [], hpMic: [] };

/** A device as the Mac reports it (Headphones.swift push()). */
export interface AudioDev { uid: string; name: string; alive: boolean; hp: boolean; builtin: boolean }
/** What the Mac sends the Tab list: {type:"hpmode", ...}. */
export interface AudioState { mode: AudioMode; auto: boolean; note: string; outs: AudioDev[]; ins: AudioDev[]; out: string; mic: string }

const cleanRef = (v: unknown): AudioRef | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as { uid?: unknown; name?: unknown };
  if (typeof o.uid !== "string" || !o.uid || o.uid.length > 200) return null;
  return { uid: o.uid, name: typeof o.name === "string" ? o.name.slice(0, 100) : "" };
};
const cleanList = (v: unknown): AudioRef[] => {
  if (!Array.isArray(v)) return [];
  const out: AudioRef[] = [];
  for (const x of v) {
    const r = cleanRef(x);
    if (r && !out.some((y) => y.uid === r.uid)) out.push(r);
    if (out.length >= AUDIO_MAX) break;
  }
  return out;
};

/** Settings from the Tab list or another device, checked: known lists only, 8 devices at most each, no repeats. */
export function cleanAudio(v: unknown): AudioPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { auto: o.auto === true, spkOut: cleanList(o.spkOut), spkMic: cleanList(o.spkMic), hpOut: cleanList(o.hpOut), hpMic: cleanList(o.hpMic) };
}
/** The saved preferences, or the defaults. */
export const audioPrefs = (v: unknown): AudioPrefs => cleanAudio(v ?? AUDIO_DEFAULTS);

/** The lists for one mode. */
export const listsFor = (m: AudioMode): { out: AudioList; mic: AudioList } => m === "speakers" ? { out: "spkOut", mic: "spkMic" } : { out: "hpOut", mic: "hpMic" };

/** Add a device at the end of a list (a repeat is ignored; 8 at most). */
export function addTo(p: AudioPrefs, k: AudioList, d: { uid: string; name: string }): AudioPrefs {
  if (p[k].some((r) => r.uid === d.uid) || p[k].length >= AUDIO_MAX) return p;
  return { ...p, [k]: [...p[k], { uid: d.uid, name: d.name.slice(0, 100) }] };
}
export function removeFrom(p: AudioPrefs, k: AudioList, uid: string): AudioPrefs {
  return { ...p, [k]: p[k].filter((r) => r.uid !== uid) };
}
/** Move a device one place up (it becomes a higher choice). */
export function moveUp(p: AudioPrefs, k: AudioList, uid: string): AudioPrefs {
  const l = [...p[k]];
  const i = l.findIndex((r) => r.uid === uid);
  if (i <= 0) return p;
  [l[i - 1], l[i]] = [l[i], l[i - 1]];
  return { ...p, [k]: l };
}

/** Which listed device is in use now: its uid when connected (by id, else by name), mirroring Headphones.swift pick(). */
export function pickNow(refs: AudioRef[], devs: AudioDev[]): AudioDev | null {
  const live = devs.filter((d) => d.alive);
  for (const r of refs) {
    const d = live.find((x) => x.uid === r.uid) ?? (r.name ? live.find((x) => x.name.toLowerCase() === r.name.toLowerCase()) : undefined);
    if (d) return d;
  }
  return null;
}

/** The Mac's state message, checked (it comes from PS's own shell, but the page never trusts shapes). */
export function cleanAudioState(v: unknown): AudioState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.mode !== "speakers" && o.mode !== "headphones") return null;
  const devs = (x: unknown): AudioDev[] => Array.isArray(x) ? x.flatMap((d) => {
    if (!d || typeof d !== "object") return [];
    const e = d as Record<string, unknown>;
    if (typeof e.uid !== "string" || typeof e.name !== "string") return [];
    return [{ uid: e.uid, name: e.name.slice(0, 100), alive: e.alive !== false, hp: e.hp === true, builtin: e.builtin === true }];
  }).slice(0, 40) : [];
  return { mode: o.mode, auto: o.auto === true, note: typeof o.note === "string" ? o.note.slice(0, 200) : "", outs: devs(o.outs), ins: devs(o.ins),
    out: typeof o.out === "string" ? o.out : "", mic: typeof o.mic === "string" ? o.mic : "" };
}
