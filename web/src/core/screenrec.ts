// Screen recorder, the page's rules (PS 1.60, pull request 12a). Pure: no React, no DOM, no bridge. The Mac does the recording
// and keeps every choice (ps-mac ScreenRec.swift, ScreenRecCore.swift, tested in mac/tests/screenrec-test.sh); this file holds
// what the page has to decide on its own:
//  - whether the Record button shows at all (feature on, PS on the Mac, the person's own yes: OFF until then);
//  - what a click does (first time: the picker; ready: start; recording: the small controls; macOS permission missing:
//    the explanation first), and the right click menu;
//  - the red dot and the timer, and private mode hiding both while the recording keeps going. The timer is worked out from the
//    start and pause times the Mac sent, never counted on the page, so it shows the real running time when it comes back;
//  - the words (every on screen string, so tests can read them: no dashes, nothing made up).
// 12b (the island) and 12c (the Soundboard and the cloud) read the same state: ScreenRecState below, kept by src/screenrec.ts.

export const SR_FEATURE = "screen-recording";

export type SRRun = "off" | "idle" | "starting" | "recording" | "paused" | "stopping";
export type SRPermState = "unknown" | "granted" | "denied";
export interface SRChoices {
  enabled: boolean;
  mode: "screenAndAudio" | "audioOnly";
  preset: "calls" | "sharp" | "tiny" | "custom";
  resolution: "p720" | "p1080" | "p1440" | "p2160" | "same";
  fps: 15 | 30 | 60;
  quality: "small" | "balanced" | "high" | "best";
  codec: "hevc" | "h264";
  audioQuality: "standard" | "high";
  source: { kind: "main" | "display" | "window"; id: number };
  micOn: boolean;
  micUID: string | null;
  computerSound: boolean;
  leftOut: string[];
  remind: boolean;
  sounds: boolean;
  picked: boolean;
  folderName: string | null;
}
/** The one small state the Mac sends (ps-mac ScreenRec.stateJSON). The button reads it now; the island (12b) and the Soundboard (12c) will. */
export interface ScreenRecState {
  featureOn: boolean;
  /** The gate is open: the feature is on in this build and the person said yes. */
  enabled: boolean;
  state: SRRun;
  startedAt: number | null;
  pausedAt: number | null;
  pausedTotal: number;
  fileName: string | null;
  folderNote: string | null;
  error: string | null;
  perms: { screen: SRPermState; mic: SRPermState };
  folder: { isDefault: boolean; name: string; missing?: boolean };
  mics: { uid: string; name: string }[];
  screen: { w: number; h: number };
  resolutions: SRChoices["resolution"][];
  space: string;
  tracks: number;
  needsScreen: boolean;
  problem: string | null;
  micViaStream: boolean;
  settings: SRChoices;
}

const RUN: SRRun[] = ["off", "idle", "starting", "recording", "paused", "stopping"];
const PERM: SRPermState[] = ["unknown", "granted", "denied"];
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, n: number): string | null => (typeof v === "string" ? v.slice(0, n) : null);
export const DEFAULT_CHOICES: SRChoices = {
  enabled: false, mode: "screenAndAudio", preset: "calls", resolution: "p1080", fps: 15, quality: "balanced", codec: "hevc", audioQuality: "standard",
  source: { kind: "main", id: 0 }, micOn: true, micUID: null, computerSound: true, leftOut: [], remind: true, sounds: true, picked: false, folderName: null,
};
function pick<T extends string>(v: unknown, list: readonly T[], d: T): T { return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : d; }
export function cleanChoices(v: unknown): SRChoices {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const src = (o.source && typeof o.source === "object" ? o.source : {}) as Record<string, unknown>;
  const D = DEFAULT_CHOICES;
  const fps = o.fps === 30 || o.fps === 60 ? o.fps : 15;
  return {
    enabled: o.enabled === true, mode: pick(o.mode, ["screenAndAudio", "audioOnly"], D.mode), preset: pick(o.preset, ["calls", "sharp", "tiny", "custom"], D.preset),
    resolution: pick(o.resolution, ["p720", "p1080", "p1440", "p2160", "same"], D.resolution), fps, quality: pick(o.quality, ["small", "balanced", "high", "best"], D.quality),
    codec: pick(o.codec, ["hevc", "h264"], D.codec), audioQuality: pick(o.audioQuality, ["standard", "high"], D.audioQuality),
    source: { kind: pick(src.kind, ["main", "display", "window"], "main"), id: num(src.id) ?? 0 },
    micOn: o.micOn !== false, micUID: str(o.micUID, 200), computerSound: o.computerSound !== false,
    leftOut: Array.isArray(o.leftOut) ? o.leftOut.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, 60) : [],
    remind: o.remind !== false, sounds: o.sounds !== false, picked: o.picked === true, folderName: str(o.folderName, 120),
  };
}
/** The Mac's message, checked. Anything odd gives null (the page then shows nothing). */
export function cleanState(v: unknown): ScreenRecState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.type !== "screenrec") return null;
  const perms = (o.perms && typeof o.perms === "object" ? o.perms : {}) as Record<string, unknown>;
  const folder = (o.folder && typeof o.folder === "object" ? o.folder : {}) as Record<string, unknown>;
  const scr = (o.screen && typeof o.screen === "object" ? o.screen : {}) as Record<string, unknown>;
  return {
    featureOn: o.featureOn === true, enabled: o.enabled === true, state: pick(o.state, RUN, "off"),
    startedAt: num(o.startedAt), pausedAt: num(o.pausedAt), pausedTotal: Math.max(0, num(o.pausedTotal) ?? 0),
    fileName: str(o.fileName, 200), folderNote: str(o.folderNote, 300), error: str(o.error, 300),
    perms: { screen: pick(perms.screen, PERM, "unknown"), mic: pick(perms.mic, PERM, "unknown") },
    folder: { isDefault: folder.isDefault !== false, name: str(folder.name, 120) ?? "PS Recordings", missing: folder.missing === true },
    mics: Array.isArray(o.mics) ? o.mics.filter((m): m is { uid: string; name: string } => !!m && typeof (m as { uid?: unknown }).uid === "string" && typeof (m as { name?: unknown }).name === "string").slice(0, 30).map((m) => ({ uid: m.uid.slice(0, 200), name: m.name.slice(0, 80) })) : [],
    screen: { w: num(scr.w) ?? 1920, h: num(scr.h) ?? 1080 },
    resolutions: Array.isArray(o.resolutions) ? o.resolutions.filter((r): r is SRChoices["resolution"] => ["p720", "p1080", "p1440", "p2160", "same"].includes(r as string)) : ["same"],
    space: str(o.space, 60) ?? "", tracks: num(o.tracks) ?? 2, needsScreen: o.needsScreen !== false, problem: str(o.problem, 200), micViaStream: o.micViaStream === true,
    settings: cleanChoices(o.settings),
  };
}

export interface PickList {
  displays: { id: number; name: string; w: number; h: number; thumb: string | null }[];
  windows: { id: number; title: string; app: string; icon: string | null; suggested: boolean }[];
  apps: { id: string; name: string; icon: string | null }[];
}
const imgOk = (v: unknown, max: number): string | null => (typeof v === "string" && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < max ? v : null);
export function cleanList(v: unknown): PickList | null {
  if (!v || typeof v !== "object" || (v as { type?: unknown }).type !== "screenrecList") return null;
  const o = v as Record<string, unknown>;
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((r): r is Record<string, unknown> => !!r && typeof r === "object") : []);
  return {
    displays: arr(o.displays).slice(0, 8).map((d) => ({ id: Number(d.id) || 0, name: String(d.name ?? "Screen").slice(0, 80), w: Number(d.w) || 0, h: Number(d.h) || 0, thumb: imgOk(d.thumb, 200_000) })),
    windows: arr(o.windows).slice(0, 40).map((w) => ({ id: Number(w.id) || 0, title: String(w.title ?? "").slice(0, 80), app: String(w.app ?? "").slice(0, 60), icon: imgOk(w.icon, 20_000), suggested: w.suggested === true })),
    apps: arr(o.apps).slice(0, 80).map((a) => ({ id: String(a.id ?? "").slice(0, 200), name: String(a.name ?? "").slice(0, 60), icon: imgOk(a.icon, 20_000) })).filter((a) => a.id),
  };
}


// ---------- the gate and the button ----------
/** The Record button shows only in PS on the Mac's floating list, with the feature on in this build AND the person's own yes. */
export function buttonShows(o: { ps: boolean; docked: boolean; st: ScreenRecState | null }): boolean {
  return o.ps && !o.docked && !!o.st && o.st.featureOn && o.st.enabled;
}
/** Is Screen recording in Settings offered (so a person can say yes)? PS on the Mac with the feature on. */
export function settingsShows(o: { ps: boolean; st: ScreenRecState | null }): boolean { return o.ps && !!o.st && o.st.featureOn; }

/** What a click on the button does. */
export type SRClick = "picker" | "start" | "controls" | "none" | "explainScreen" | "explainMic";
export function missingPermission(st: ScreenRecState): "screen" | "mic" | null {
  if (st.needsScreen && st.perms.screen !== "granted") return "screen";
  if (st.settings.micOn && st.perms.mic !== "granted") return "mic";
  return null;
}
export function clickAction(st: ScreenRecState): SRClick {
  switch (st.state) {
    case "recording": case "paused": return "controls";
    case "starting": case "stopping": case "off": return "none";
    default: break;
  }
  if (!st.settings.picked) return "picker";
  const m = missingPermission(st);
  if (m) return m === "screen" ? "explainScreen" : "explainMic";
  return "start";
}

/** The right click menu, in the order the brief gives. */
export type SRMenuId = "start" | "stop" | "screen" | "mic" | "leaveOut" | "folder" | "settings";
export function menuItems(st: ScreenRecState): { id: SRMenuId; label: string }[] {
  const rec = st.state === "recording" || st.state === "paused";
  return [
    rec ? { id: "stop", label: SR_WORDS.menuStop } : { id: "start", label: SR_WORDS.menuStart },
    { id: "screen", label: SR_WORDS.menuScreen }, { id: "mic", label: SR_WORDS.menuMic }, { id: "leaveOut", label: SR_WORDS.menuLeave },
    { id: "folder", label: SR_WORDS.menuFolder }, { id: "settings", label: SR_WORDS.menuSettings },
  ];
}

// ---------- the red dot and the timer ----------
/** The real running time in ms (a pause does not count): from the start and pause times, never from a counter on the page. */
export function elapsedMs(st: Pick<ScreenRecState, "state" | "startedAt" | "pausedAt" | "pausedTotal">, now: number): number {
  if ((st.state !== "recording" && st.state !== "paused") || st.startedAt === null) return 0;
  const end = st.pausedAt ?? now;
  return Math.max(0, end - st.startedAt - st.pausedTotal);
}
export function timerText(ms: number): string {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
export interface SRSigns { dot: boolean; pulsing: boolean; timer: string | null; paused: boolean }
/** What the button draws. Private mode (settings.privateMode) shows NOTHING: no dot, no timer, no "Paused". The recording itself keeps going. */
export function signs(st: ScreenRecState | null, now: number, privateMode: boolean): SRSigns {
  const none: SRSigns = { dot: false, pulsing: false, timer: null, paused: false };
  if (!st || (st.state !== "recording" && st.state !== "paused") || privateMode) return none;
  return { dot: true, pulsing: st.state === "recording", timer: timerText(elapsedMs(st, now)), paused: st.state === "paused" };
}
/** Is a recording running (whatever is or is not drawn)? */
export const isRecording = (st: ScreenRecState | null) => !!st && (st.state === "recording" || st.state === "paused");

/** The button's name for a screen reader: in private mode it never says it is recording. */
export function buttonLabel(st: ScreenRecState | null, privateMode: boolean): string {
  if (!st || privateMode || !isRecording(st)) return SR_WORDS.button;
  return st.state === "paused" ? SR_WORDS.buttonPaused : SR_WORDS.buttonRecording;
}

// ---------- the choices, as words ----------
export const PRESET_LIST: { id: "calls" | "sharp" | "tiny" | "custom"; label: string; line: string }[] = [
  { id: "calls", label: "Calls", line: "1080p, 15 frames a second, Balanced. Plenty for slides and calls." },
  { id: "sharp", label: "Sharp", line: "Same as your screen, 30 frames a second, High. For fast moving screens." },
  { id: "tiny", label: "Tiny", line: "720p, 15 frames a second, Small file. The smallest files." },
  { id: "custom", label: "Custom", line: "Your own mix." },
];
export const RES_LABEL: Record<SRChoices["resolution"], string> = { p720: "720p", p1080: "1080p", p1440: "1440p", p2160: "4K", same: "Same as screen" };
export const QUALITY_LABEL: Record<SRChoices["quality"], string> = { small: "Small file", balanced: "Balanced", high: "High", best: "Best" };
export const CODEC_LABEL: Record<SRChoices["codec"], string> = { hevc: "HEVC (smaller files)", h264: "H.264 (plays everywhere)" };
export const AUDIO_LABEL: Record<SRChoices["audioQuality"], string> = { standard: "Standard", high: "High" };
export const FPS_LIST: (15 | 30 | 60)[] = [15, 30, 60];

/** Settings the Mac is told to change; the Mac checks each one again. */
export function patchFor(key: keyof SRChoices, value: unknown): Record<string, unknown> {
  if (key === "source") { const s = value as SRChoices["source"]; return { sourceKind: s.kind, sourceId: s.id }; }
  return { [key]: value };
}

/** Where the "How to switch it off" help sends people: the macOS Privacy pages. */
export const PRIVACY_PANES = { screen: "Screen and System Audio Recording", mic: "Microphone" } as const;

// ---------- every word on screen ----------
export const SR_WORDS = {
  tab: "Screen recording",
  tabLine: "Record your sales calls and client calls. Off until you switch it on.",
  button: "Record screen",
  buttonRecording: "Recording. Click for Pause and Stop.",
  buttonPaused: "Recording paused. Click for Resume and Stop.",
  gear: "Screen recording settings",
  paused: "Paused",
  menuStart: "Start recording", menuStop: "Stop recording", menuScreen: "Pick screen", menuMic: "Pick mic", menuLeave: "Leave out apps", menuFolder: "Save folder", menuSettings: "Settings",
  pause: "Pause", resume: "Resume", stop: "Stop and save", switchMic: "Switch mic",
  remind: "Let everyone on the call know you are recording.",
  remindSwitch: "Show a reminder before each recording",
  // opt in
  askTitle: "Do you want PS to be able to record sales meetings and client calls?",
  askLine: "PS records only when you say so. Recordings stay on your Mac and in the cloud storage you pick.",
  yes: "Yes", no: "No",
  on: "Record sales meetings and client calls",
  onLine: "Off until you switch it on. While it is off, PS never asks macOS for screen or microphone access.",
  // off switch and privacy
  offTitle: "Switching it off",
  offLine: "Switching it off stops any recording and saves it first. To remove PS from macOS completely, open the Privacy settings and take PS out of the list.",
  openScreen: "Open Screen and System Audio Recording",
  openMic: "Open Microphone",
  menuBarNote: "macOS shows its own recording icon in the menu bar while this runs. PS cannot hide it, and neither can private mode.",
  privateNote: "While private mode is on, PS hides the red dot and the timer. The recording keeps going.",
  // permissions, explained before each macOS prompt
  permScreenTitle: "Let PS see your screen",
  permScreenWhy: "To record your screen and the sound of the call, macOS needs you to allow PS under Screen and System Audio Recording. PS only records when you press Record.",
  permScreenGo: "Allow screen recording",
  permScreenWait: "Waiting for you in System Settings. Switch PS on there, then come back. macOS may ask you to restart PS.",
  permMicTitle: "Let PS hear your microphone",
  permMicWhy: "So your voice is saved too, on its own sound track. macOS asks once. PS only listens when you press Record.",
  permMicGo: "Allow the microphone",
  permDone: "Done. macOS says yes.",
  permDenied: "macOS says no for now. You can switch it on in System Settings, Privacy and Security.",
  // picker
  pickerTitle: "What to record",
  modeScreen: "Screen and audio", modeAudio: "Audio only",
  whole: "A whole screen", window: "One window", suggested: "Meeting window",
  mainScreen: "Main screen",
  micTitle: "Microphone", micDefault: "The Mac's own microphone", micOff: "No microphone",
  computerSound: "Computer sound",
  computerSoundLine: "The other people on the call are heard through this.",
  leaveTitle: "Leave out these apps", leaveLine: "Their sound and their windows are not recorded. PS itself is always left out.",
  start: "Start recording", cancel: "Cancel", noList: "Loading screens and windows",
  allowFirst: "Allow screen recording first, then pick what to record.",
  audioOnlyLine: "Audio only saves the mic and the computer sound to a small .m4a file.",
  // quality
  presets: "Quality", resolution: "Resolution", frameRate: "Frames a second", quality: "File size and quality", format: "Format", audioQuality: "Sound quality",
  space: "That takes",
  tracksLine: "The mic (Me) and the computer sound (Them) are saved as two separate sound tracks in one file.",
  // folder
  folderTitle: "Save folder", folderDefault: "Movies, PS Recordings", choose: "Choose folder", useDefault: "Use the default folder", show: "Show in Finder",
  folderMissing: "That folder is not there (is the drive plugged in?). PS will save to the default folder until it is back.",
  namesLine: "Files are named by date and meeting, like 2026-11-14 Call with Sam.mov.",
  // settings extras
  soundsLabel: "Sounds", soundsLine: "A soft sound when recording starts and stops.",
  test: "Test recording", testLine: "Records 5 seconds and shows you the file.",
  defaultsTitle: "What it records",
  // errors
  noRoom: "There is not enough room to record. Free some space and try again.",
  needPerm: "Allow screen recording first.",
  failed: "The recording could not start.",
  close: "Close",
} as const;

/** Every sentence the page shows for screen recording, plus the presets (the no-dash test reads this). */
export function screenRecCopy(): string[] {
  return [...Object.values(SR_WORDS), ...PRESET_LIST.flatMap((p) => [p.label, p.line]), ...Object.values(RES_LABEL), ...Object.values(QUALITY_LABEL), ...Object.values(CODEC_LABEL), ...Object.values(AUDIO_LABEL)];
}
