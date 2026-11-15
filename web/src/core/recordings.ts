// Screen recorder, the recordings list and the cloud settings as the page sees them (PS 1.60, pull request 12c). Pure: no React, no DOM,
// no bridge. The Mac does the uploading, checking, deleting and playing (ps-mac ScreenRecCloud.swift, rules tested in
// mac/tests/screenrec-cloud-test.sh); this file holds what the page decides on its own:
//  - cleaning every message from the Mac (a recording row, the cloud state, the delete question);
//  - the list: newest first, where each recording is (This Mac, Cloud, both), the client matched from the meeting's attendees to the
//    client list (same matcher as Gmail replies), and what Play does on this device;
//  - what syncs: ONLY small metadata rows through the existing encrypted vault ("srec"), never the media, and only rows that changed.
//    A row is a title, a time, a length, a few addresses, flags and a tiny picture. No path, no token, no link that grants access.
//  - the words (every on screen string, so tests can read them: no dashes).
// Delete ASKS FIRST: the question comes from the Mac (one source of truth), the page only shows it with its buttons.
import { buildMatcher } from "./mail.ts";

export type RecProvider = "none" | "googleDrive" | "iCloud" | "dropbox" | "oneDrive" | "folder";
const PROVIDERS: RecProvider[] = ["none", "googleDrive", "iCloud", "dropbox", "oneDrive", "folder"];
export const PROVIDER_LABEL: Record<RecProvider, string> = {
  none: "Nowhere (keep on this Mac)", googleDrive: "Google Drive", iCloud: "iCloud Drive", dropbox: "Dropbox", oneDrive: "OneDrive", folder: "Any folder",
};
export const API_PROVIDERS: RecProvider[] = ["googleDrive", "dropbox", "oneDrive"];

export interface RecCloud { provider: RecProvider; encrypted: boolean; verified: boolean; openUrl: string | null }
export interface RecUpload { state: "waiting" | "uploading" | "verifying" | "done" | "unsure" | "failed" | "needsSignIn"; fraction: number; note: string | null }
export interface RecRow {
  id: string; title: string; startedAt: number; duration: number; meeting: string | null; attendees: string[];
  audioOnly: boolean; size: number; thumb: string | null;
  /** The file is on a Mac (the one that made it). */
  mac: boolean;
  cloud: RecCloud | null;
  /** Live upload progress: only on the Mac that is uploading, never synced. */
  upload: RecUpload | null;
  lowered: string[];
  /** Which Mac wrote the row (so one Mac never removes another Mac's rows). */
  device: string | null;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, n: number): string | null => (typeof v === "string" && v ? v.slice(0, n) : null);
const UPSTATE = ["waiting", "uploading", "verifying", "done", "unsure", "failed", "needsSignIn"];
const imgOk = (v: unknown): string | null => (typeof v === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 20_000 ? v : null);
const urlOk = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) && v.length < 600 ? v : null);

export function cleanRow(v: unknown, device: string | null = null): RecRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 64);
  if (!id) return null;
  const c = o.cloud && typeof o.cloud === "object" ? (o.cloud as Record<string, unknown>) : null;
  const up = o.upload && typeof o.upload === "object" ? (o.upload as Record<string, unknown>) : null;
  const provider = c && typeof c.provider === "string" && (PROVIDERS as string[]).includes(c.provider) && c.provider !== "none" ? (c.provider as RecProvider) : null;
  return {
    id, title: (str(o.title, 120) ?? "Recording").replace(/\s+/g, " ").trim() || "Recording", startedAt: num(o.startedAt), duration: Math.max(0, num(o.duration)),
    meeting: str(o.meeting, 120), attendees: Array.isArray(o.attendees) ? o.attendees.filter((a): a is string => typeof a === "string" && a.includes("@") && a.length < 200).slice(0, 20) : [],
    audioOnly: o.audioOnly === true, size: Math.max(0, num(o.size)), thumb: imgOk(o.thumb), mac: o.mac === true,
    cloud: provider ? { provider, encrypted: c!.encrypted === true, verified: c!.verified === true, openUrl: urlOk(c!.openUrl) } : null,
    upload: up && typeof up.state === "string" && UPSTATE.includes(up.state) ? { state: up.state as RecUpload["state"], fraction: Math.max(0, Math.min(1, num(up.fraction))), note: str(up.note, 200) } : null,
    lowered: Array.isArray(o.lowered) ? o.lowered.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 160)).slice(0, 6) : [],
    device: str(o.device, 64) ?? device,
  };
}
/** The Mac's list message. Anything odd gives null. */
export function cleanLib(v: unknown): { device: string | null; rows: RecRow[] } | null {
  if (!v || typeof v !== "object" || (v as { type?: unknown }).type !== "screenrecLib") return null;
  const o = v as Record<string, unknown>;
  const device = str(o.device, 64);
  const items = Array.isArray(o.items) ? o.items : [];
  return { device, rows: items.map((r) => cleanRow(r, device)).filter((r): r is RecRow => !!r).slice(0, 2000) };
}

export interface CloudLogin { clientSet: boolean; signedIn: boolean; label: string | null }
export interface CloudQueueItem { id: string; name: string; state: RecUpload["state"]; fraction: number; note: string | null }
export interface CloudState {
  enabled: boolean; provider: RecProvider; removeAfter: boolean; keepDays: number; encrypt: boolean; folderName: string | null;
  logins: Record<string, CloudLogin>; queue: CloudQueueItem[]; wait: string | null; problem: string | null; iCloudFound: boolean;
  /** The Mac has no recording key yet and needs one (sealed uploads are on, or sealed recordings exist). */
  needKey: boolean;
}
export function cleanCloud(v: unknown): CloudState | null {
  if (!v || typeof v !== "object" || (v as { type?: unknown }).type !== "screenrecCloud") return null;
  const o = v as Record<string, unknown>;
  const logins: Record<string, CloudLogin> = {};
  for (const p of API_PROVIDERS) {
    const l = (o.logins && typeof o.logins === "object" ? (o.logins as Record<string, unknown>)[p] : null) as Record<string, unknown> | null;
    logins[p] = { clientSet: l?.clientSet === true, signedIn: l?.signedIn === true, label: str(l?.label, 120) };
  }
  return {
    enabled: o.enabled === true, provider: typeof o.provider === "string" && (PROVIDERS as string[]).includes(o.provider) ? (o.provider as RecProvider) : "none",
    removeAfter: o.removeAfter !== false, keepDays: Math.max(0, Math.min(365, Math.round(num(o.keepDays, 7)))), encrypt: o.encrypt === true, folderName: str(o.folderName, 120),
    logins, wait: str(o.wait, 200), problem: str(o.problem, 300), iCloudFound: o.iCloudFound === true, needKey: o.needKey === true,
    queue: Array.isArray(o.queue) ? o.queue.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").slice(0, 12).map((x) => ({
      id: String(x.id ?? "").slice(0, 64), name: String(x.name ?? "").slice(0, 120), state: (UPSTATE.includes(x.state as string) ? x.state : "waiting") as RecUpload["state"],
      fraction: Math.max(0, Math.min(1, num(x.fraction))), note: str(x.note, 200),
    })) : [],
  };
}
// ---------- the key that seals uploads ----------
// Sealed uploads (Settings, Cloud, "Encrypt uploads") use a recording key that lives in the person's vault as "srkey" records, encrypted with the
// vault key like everything else, so every device that unlocks the vault can open a sealed recording. The page makes the key once, never deletes
// one (a recording sealed with an old key must stay openable), and hands the whole ring to the Mac, which keeps it in memory only. Two devices
// that each make a first key at the same moment both keep theirs: the ring has both, and each sealed file names the key it used.
export interface SealKeyDoc { kid: string; k: string; v: 1 }
const KID = /^[0-9a-f]{16}$/, B64_32 = /^[A-Za-z0-9+/]{43}=$/;
export function cleanKeyDoc(v: unknown): SealKeyDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.kid === "string" && KID.test(o.kid) && typeof o.k === "string" && B64_32.test(o.k) ? { kid: o.kid, k: o.k, v: 1 } : null;
}
/** Every good key in the vault, once per id, smallest id first (the Mac seals new uploads with the first). */
export function keyRing(have: unknown[]): SealKeyDoc[] {
  const by = new Map<string, SealKeyDoc>();
  for (const h of have) { const k = cleanKeyDoc(h); if (k && !by.has(k.kid)) by.set(k.kid, k); }
  return [...by.values()].sort((a, b) => (a.kid < b.kid ? -1 : 1));
}
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("");
/** A new recording key from a random source (the vault's crypto in the page, a fixed one in tests). */
export function newSealKey(rand: (n: number) => Uint8Array): SealKeyDoc { return { kid: hex(rand(8)), k: toB64(rand(32)), v: 1 }; }
/** What to do with the vault's keys: make one only when asked to and there is none. */
export function keyPlan(have: unknown[], wantNew: boolean): { ring: SealKeyDoc[]; create: boolean } {
  const ring = keyRing(have);
  return { ring, create: wantNew && ring.length === 0 };
}
/** The message to the Mac. `synced` is true only when the keys are saved in a vault that other devices read (not a vault that lives only on this device, and nothing still waiting to upload). */
export function keysMessage(ring: SealKeyDoc[], opts: { local: boolean; pending: boolean }): { keys: { kid: string; k: string }[]; synced: boolean } {
  return { keys: ring.map((r) => ({ kid: r.kid, k: r.k })), synced: !opts.local && !opts.pending && ring.length > 0 };
}

export interface RecAsk { id: string; question: string; cloudQuestion: string; hasLocal: boolean; hasCloud: boolean; provider: string | null }
export function cleanAsk(v: unknown): RecAsk | null {
  if (!v || typeof v !== "object" || (v as { type?: unknown }).type !== "screenrecAsk") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 64), question = str(o.question, 400);
  if (!id || !question) return null;
  return { id, question, cloudQuestion: str(o.cloudQuestion, 400) ?? question, hasLocal: o.hasLocal === true, hasCloud: o.hasCloud === true, provider: str(o.provider, 40) };
}

// ---------- the list ----------
/** Newest first, then by title. */
export function sortRows<T extends Pick<RecRow, "startedAt" | "title">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.startedAt - a.startedAt || a.title.localeCompare(b.title));
}
export interface RecItem { row: RecRow; /** The file or the cloud login is on THIS Mac (so Play and Rename here work). */ thisMac: boolean }
/** This Mac's own list wins; rows other devices wrote (through the vault) are added. Newest first. */
export function mergeRows(macRows: RecRow[] | null, vaultRows: RecRow[]): RecItem[] {
  const mine = new Set((macRows ?? []).map((r) => r.id));
  const items: RecItem[] = [...(macRows ?? []).map((row) => ({ row, thisMac: true })), ...vaultRows.filter((r) => !mine.has(r.id)).map((row) => ({ row, thisMac: false }))];
  return items.sort((a, b) => b.row.startedAt - a.row.startedAt || a.row.title.localeCompare(b.row.title));
}
/** Where it is: This Mac, Cloud, or both (a row from another Mac says "Your Mac"). */
export function whereText(it: RecItem): string {
  const r = it.row;
  const local = r.mac ? (it.thisMac ? "This Mac" : "Your Mac") : null;
  const cloud = r.cloud ? `Cloud (${r.cloud.provider === "folder" ? "folder" : PROVIDER_LABEL[r.cloud.provider]})` : null;
  if (local && cloud) return `${local} and ${cloud}`;
  return local ?? cloud ?? "Not on this Mac";
}
export function lengthText(sec: number): string {
  const t = Math.max(0, Math.round(sec)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 ? `${h} h ${m} min` : m > 0 ? `${m} min${s && m < 5 ? ` ${s} s` : ""}` : `${s} s`;
}
export function dateText(ms: number, tz?: string): string {
  const d = new Date(ms);
  try { return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }); } catch { return d.toISOString().slice(0, 16).replace("T", " "); }
}

type ClientLike = { id: string; data: { email?: string | null; matchAddrs?: string[]; archived?: boolean; name: string } };
/** The client whose address matches the most people on the call (the same matcher as Gmail replies). Ties: the first one seen. */
export function matchClient(attendees: string[], clients: ClientLike[]): string | null {
  if (!attendees.length || !clients.length) return null;
  const match = buildMatcher(clients);
  const hits = new Map<string, number>(), order: string[] = [];
  for (const a of attendees) { const id = match(a); if (!id) continue; if (!hits.has(id)) order.push(id); hits.set(id, (hits.get(id) ?? 0) + 1); }
  let best: string | null = null;
  for (const id of order) if (best === null || (hits.get(id) ?? 0) > (hits.get(best) ?? 0)) best = id;
  return best;
}
export function forClient(items: RecItem[], clientId: string, clients: ClientLike[]): RecItem[] {
  return items.filter((it) => matchClient(it.row.attendees, clients) === clientId);
}

// ---------- what Play does on this device ----------
export type PlayDevice = "mac" | "phone" | "web";
export type PlayAction = { kind: "play"; label: string } | { kind: "open"; label: string; url: string } | { kind: "macOnly"; label: string };
/** Honest rules (no server of ours ever sits between a person and their cloud):
 *  - This Mac: Play in PS (local file, or streamed or downloaded from the cloud with this Mac's own login, or opened from the Mac's sealed copy).
 *  - Phone and website: only an unsealed copy in Google Drive, Dropbox or OneDrive that gave a link opens, in that cloud's own player. Sealed
 *    recordings, iCloud Drive, folders and Mac only files say "Play on your Mac". */
export function playAction(it: RecItem, device: PlayDevice): PlayAction {
  const r = it.row;
  if (device === "mac" && it.thisMac && (r.mac || r.cloud)) return { kind: "play", label: "Play" };
  if (r.cloud && !r.cloud.encrypted && API_PROVIDERS.includes(r.cloud.provider) && r.cloud.openUrl) return { kind: "open", label: `Open in ${PROVIDER_LABEL[r.cloud.provider]}`, url: r.cloud.openUrl };
  return { kind: "macOnly", label: "Play on your Mac" };
}

// ---------- sync: only small metadata rows, only the ones that changed ----------
export type RecDoc = Omit<RecRow, "upload">;
export function toDoc(r: RecRow): RecDoc { const { upload: _u, ...d } = r; void _u; return d; }
const stable = (d: RecDoc): string => JSON.stringify({ ...d, attendees: [...d.attendees], lowered: [...d.lowered] });
/** What to write to the vault: rows that are new or changed, and the rows this Mac wrote that are gone from its list. Nothing else. */
export function syncPlan(vault: { id: string; data: RecDoc }[], macRows: RecRow[], device: string | null): { put: RecDoc[]; remove: string[] } {
  const have = new Map(vault.map((d) => [d.data.id, d]));
  const put: RecDoc[] = [];
  for (const r of macRows) {
    const doc = toDoc({ ...r, device: r.device ?? device });
    const was = have.get(doc.id);
    if (!was || stable(was.data) !== stable(doc)) put.push(doc);
  }
  const live = new Set(macRows.map((r) => r.id));
  const remove = device ? vault.filter((d) => d.data.device === device && !live.has(d.data.id)).map((d) => d.data.id) : [];
  return { put, remove };
}

// ---------- the delete question ----------
export type DeleteButton = { id: "cancel" | "mac" | "both" | "cloud" | "ok"; label: string; danger?: boolean; also: boolean };
/** The buttons under the Mac's question. A recording that is in the cloud too gets two real choices; Cancel is always there and first. */
export function deleteButtons(a: RecAsk): DeleteButton[] {
  const cancel: DeleteButton = { id: "cancel", label: "Cancel", also: false };
  if (a.hasLocal && a.hasCloud) return [cancel, { id: "mac", label: "Delete from this Mac only", danger: true, also: false }, { id: "both", label: `Delete from this Mac and ${a.provider ?? "the cloud"}`, danger: true, also: true }];
  if (a.hasCloud) return [cancel, { id: "cloud", label: `Delete from ${a.provider ?? "the cloud"}`, danger: true, also: true }];
  if (a.hasLocal) return [cancel, { id: "mac", label: "Delete from this Mac", danger: true, also: false }];
  return [cancel, { id: "ok", label: "Remove from the list", danger: true, also: false }];
}
export function deleteQuestion(a: RecAsk, also: boolean): string { return also ? a.cloudQuestion : a.question; }

// ---------- words ----------
export const REC_WORDS = {
  tab: "Recordings",
  empty: "No recordings yet. When you record a call it shows up here.",
  emptyOff: "Screen recording is off. Switch it on in Settings, Screen recording.",
  search: "Search recordings",
  rename: "Rename", delete: "Delete", showInFinder: "Show in Finder", openCloud: "Open in the cloud", upload: "Upload now", retry: "Try again",
  client: "Client", noClient: "No client",
  uploading: "Uploading", uploaded: "Uploaded", waiting: "Waiting to upload",
  audioOnly: "Audio only",
  clientSection: "Recordings",
  clientEmpty: "No recordings of calls with this client yet.",
  lowered: "PS made this recording lighter because the Mac was struggling.",
  save: "Save", cancel: "Cancel",
  sealedNote: "Sealed. Plays only in PS on a Mac where your vault is unlocked.",
};
export const UP_LABEL: Record<RecUpload["state"], string> = {
  waiting: "Waiting to upload", uploading: "Uploading", verifying: "Checking the copy", done: "Uploaded", unsure: "Uploaded, not confirmed. Kept on this Mac.", failed: "Upload stopped. Kept on this Mac.", needsSignIn: "Sign in to upload",
};

export const CLOUD_WORDS = {
  title: "Cloud",
  line: "Where finished recordings go. PS uploads after the recording ends, never during one.",
  provider: "Where recordings go",
  signIn: "Sign in", signOut: "Sign out", signedInAs: "Signed in", notSignedIn: "Not signed in",
  googleFile: "Pick your Google client file", dropboxKey: "Dropbox app key", msId: "Microsoft application (client) ID", saveKey: "Save",
  chooseFolder: "Choose folder", folderNone: "No folder chosen yet.", iCloudFound: "PS will use a folder called PS Recordings in your iCloud Drive.", iCloudMissing: "iCloud Drive was not found on this Mac. Choose a folder inside it.",
  removeAfter: "Remove from this Mac after upload", removeAfterLine: "Only after PS has checked the cloud copy. If anything is unsure, the file stays.",
  keepDays: "Keep the last", days: "days on this Mac", keepLine: "A checked upload is removed from this Mac after this many days. 0 means right away.",
  encrypt: "Encrypt uploads so only PS can play them", encryptLine: "Off by default, so recordings still play in the cloud itself. On: PS seals each file with a recording key before it uploads, and opens it again to play. The key is kept in your PS vault, encrypted like the rest of your data, so any Mac where you unlock your vault can open a sealed recording. It plays only in PS on a Mac, not in the cloud, on the phone or on the website. Turn on sync first: without sync the key lives only on this device, and PS keeps the Mac copy of every sealed recording until it is saved safely.",
  syncNote: "Your list of recordings syncs through your encrypted vault: title, time, length, the other people's addresses and a tiny picture of the screen. Never the recording itself.",
  dropboxRedirect: "http://127.0.0.1:53682/cb",
  testingNote: "A Google project left in Testing mode signs PS out every 7 days. Publish the project (OAuth consent screen, Publish app) to stop that.",
  howTitle: "How to make your own app",
  howLine: "Each person uses their own app registration, so your recordings never touch anyone else's account or server. It takes about five minutes, once.",
  nothing: "Recordings stay on this Mac.",
  queue: "Uploads", none: "Nothing is waiting.",
  help: {
    googleDrive: [
      { text: "Open the Google Cloud console and make a project.", href: "https://console.cloud.google.com/projectcreate" },
      { text: "Switch on the Google Drive API.", href: "https://console.cloud.google.com/apis/library/drive.googleapis.com" },
      { text: "Set up the consent screen, then publish it (see the note about Testing mode).", href: "https://console.cloud.google.com/apis/credentials/consent" },
      { text: "Make an OAuth client ID of type Desktop app, then download its JSON file.", href: "https://console.cloud.google.com/apis/credentials" },
      { text: "Pick that file here and press Sign in. PS only asks for the drive.file permission: it sees only the files it makes." },
    ],
    dropbox: [
      { text: "Open the Dropbox app console and make an app with Scoped access.", href: "https://www.dropbox.com/developers/apps" },
      { text: "Under Permissions switch on files.content.write, files.content.read and files.metadata.read, then Submit." },
      { text: "Under Settings add this redirect address exactly: http://127.0.0.1:53682/cb (PS uses that port only for the Dropbox sign in, so close any program that uses it). Then copy the App key." },
      { text: "Paste the App key here and press Sign in." },
    ],
    oneDrive: [
      { text: "Open Microsoft Entra, App registrations, and make a New registration. Choose accounts in any directory and personal Microsoft accounts.", href: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
      { text: "Add a Public client redirect address: http://localhost/cb (under Authentication, Mobile and desktop applications). Switch on Allow public client flows." },
      { text: "Under API permissions add Microsoft Graph, Delegated, Files.ReadWrite." },
      { text: "Copy the Application (client) ID, paste it here and press Sign in." },
    ],
  } as Record<string, { text: string; href?: string }[]>,
};
