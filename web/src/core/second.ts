// Outsource work to your other computer (PS 1.65). The rules, the keys and the sealed messages between two of your own
// computers, with no screen and no network in here, so tests/second.test.ts can check every rule with a fake second computer.
//
// How it works in plain words:
//  - Each computer makes two key pairs once (one to SIGN, one to SEAL). The private halves stay on that computer (the Mac keeps
//    them in the Keychain through core/secondbridge.ts). The public halves travel through the person's own vault, which only
//    the owner can read.
//  - Pairing: the other computer shows a one time code. You type it on the main computer. Both then trust each other's public
//    keys. Nothing in a pairing mentions an app version, so an update or a restart never asks to pair again.
//  - A job or a command is a small body. It is SIGNED by the main computer and SEALED so only the other computer can open it
//    (ECDH P-256 plus AES-256-GCM, a fresh key per message). The other computer accepts it only if: it opens, the signature is the
//    paired main computer's, it is addressed to this computer, it has not expired, it was not seen before (replay), it is not from
//    the future, and it carries no secret (looksSecret).
//  - The other computer never pushes, merges, releases, deploys or sends anything: a job only hands back a git bundle and a report.
// Vault kinds used (all owner only, core/vault.ts OWNER_KINDS): sdev (a computer's public keys), spair (pairing), sojob (a sealed job),
// sores (a sealed result), sstat (a sealed status), scmd (a sealed command), sjobst (a sealed job progress).
import { b64url, unb64url, randomBytes } from "./crypto";

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder(), td = new TextDecoder();
type Bytes = Uint8Array<ArrayBuffer>;
const bytes = (s: string): Bytes => te.encode(s) as Bytes;

// ---------- limits (one place) ----------
export const MB = 1024 * 1024;
export const FILE_MAX = 64 * MB;           // one bundle, at most
export const WAITING_MAX = 256 * MB;
export const STREAM_MAX = 8 * MB;
export const MONTH_MAX = 2048 * MB;        // what one month of results may add up to in the vault
export const CHUNK = 192 * 1024;           // matches BRIDGE_CHUNK in core/secondbridge.ts
export const MSG_MAX = 4000;
export const PROMPT_MAX = 20_000;
export const ONLINE_MS = 3 * 60 * 1000;    // heard from within 3 minutes means awake and ready
export const JOB_MAX_AGE = 24 * 3600_000;  // a job nobody picks up in a day expires
export const FILE_MAX_AGE = 7 * 24 * 3600_000;
export const FUTURE_SKEW = 5 * 60_000;     // clocks may differ by this much
export const TAIL_RUNNING = 2000;
export const TAIL_FINAL = 6000;
export const CMD_MAX_AGE = 2 * 60_000;     // a restart command is good for two minutes
export const IDX_MAX = 500;
export const OJOB_MINUTES = 30;            // default time limit of an outsourced job
export const OJOB_MAX_MINUTES = 240;
export const OJOB_MAX_RUNNING = 1;
export const KEEP_MSGS = 100;
export const JOB_KEEP_MS = 30 * 24 * 3600_000;
export const FILE_KEEP_MS = 14 * 24 * 3600_000;
export const JOB_MINUTES = { selftest: 2, build: 30, tests: 30, claude: OJOB_MINUTES, research: 15 };

// ---------- types (the names the rest of the app already imports) ----------
export type Role = "primary" | "secondary" | "none";
export type BodyType = "stat" | "msg" | "job" | "cmd" | "pair" | "get" | "jobst" | "dev" | "pairok" | "file" | "ack" | "idx";
export type BodyBase = { v: number; t: BodyType; id: string; from: string; to: string; at: number; [k: string]: unknown };
export type JobType = "selftest" | "build" | "tests" | "claude" | "research" | "cancel";
export type TestPreset = { id: string; label: string };
export const TEST_PRESETS: TestPreset[] = [];
export type BundleRef = { project: string; file: string; head: string; base?: string };
export type JobArgs = {
  title: string; repo: string; base: string; prompt: string;
  returns?: { bundle?: boolean; report?: boolean; screenshots?: boolean };
  minutes?: number; tool?: "claude" | "codex";
};
export type JobBody = BodyBase & { t: "job"; exp: number; type: JobType; args: JobArgs; bundles?: BundleRef[] };
export type JobState = "accepted" | "refused" | "queued" | "running" | "done" | "failed" | "cancelled" | "timeout";
export type JobStatusBody = BodyBase & {
  t: "jobst"; job: string; state: JobState; reason?: string; startedAt?: number; endedAt?: number; exit?: number; step?: string;
  tail: string; summary?: string; files?: unknown[]; result?: { bundle?: { name: string; sha256: string; size: number; n: number }; shots?: string[] };
};
export type Machine = {
  awake?: boolean; locked?: boolean; fileVault?: "on" | "off" | "unknown"; passwordImmediately?: boolean;
  timer?: { on?: boolean; hours: number; deadline: number | string; mode?: RebootSetMode; asked?: RebootSetMode; live?: boolean; safeMode?: boolean; lastWould?: number;
    minutes?: number; postponed?: number; postpone?: boolean; set?: boolean; lockedAt?: number; signedIn?: boolean; periods?: LockPeriod[] };
  helper?: "approved" | "needs approval" | "not set up" | "missing"; bootedAt?: number; lastRestart?: { at: number; kind: string };
};
export type LockPeriod = { lockedAt: number; endedAt: number; ran: number; end: string; postponed?: number; would?: number };
export type StatBody = BodyBase & {
  t: "stat"; cpu: number; mem?: number; battery: number; charging: boolean; power: "ac" | "battery"; busy: boolean; queue: number; have: string[];
  disk?: number; app?: string; sleepSoon?: boolean; machine?: Machine;
};
export type FileBody = BodyBase & { t: "file"; name: string; size: number; sha256: string; mime: string; purpose: "user" | "bundle" | "result" | "share"; job?: string; chunk: string; n: number; pack?: "zip" };
export type MsgBody = BodyBase & { t: "msg"; text: string; files?: unknown[] };
export type RebootSetMode = "off" | "watch" | "active";
export type CmdAction = "restart" | "shutdown" | "lock" | "postpone" | "set";
export type CmdBody = BodyBase & { t: "cmd"; exp: number; action: CmdAction; mode?: RebootSetMode; minutes?: number };
export type IdxEntry = { p: string; d?: boolean; s: number; m: number; k?: "image" | "pdf" | "text" | "other" };
export type IdxBody = BodyBase & { t: "idx"; root: string; name: string; entries: IdxEntry[] };
export type GetBody = BodyBase & { t: "get"; root: string; path: string; as: "download" | "preview" };
export type DevBody = BodyBase & { t: "dev"; name: string; model?: string; chip?: string; role: Role; pub: string; encPub?: string; app?: string };
export type PairBody = BodyBase & {
  t: "pair" | "pairok"; primary: string; primaryPub: string; primaryEnc?: string; secondary: string; secondaryPub: string; secondaryEnc?: string;
  names?: { p?: string; s?: string }; proof?: string;
};
export type AckBody = BodyBase & { t: "ack"; ref: string; ok: boolean; reason?: string; path?: string };
export type Peer = { device: string; name?: string; pub: string; encPub: string; role: Role };
export type Check<T = unknown> = { ok: true; body: T } | { ok: false; why: string };
export type DropTarget = "other" | "main" | "none";
export type Keys = { device: string; pub: string; encPub: string; priv: string };
/** The envelope that sits in a vault record: the sealed body, the signature over the plain body and who signed. */
export type Env = { body: { e: string; iv: string; ct: string } | unknown; sig: string; by: string; v?: number };

export const CMD_ACTIONS: CmdAction[] = ["restart", "shutdown", "lock", "postpone", "set"];
export const cmdAction = (a: unknown): a is CmdAction => typeof a === "string" && (CMD_ACTIONS as string[]).includes(a);
export const JOB_LABEL: Record<JobType, string> = { selftest: "Self test", build: "Build", tests: "Tests", claude: "AI job", research: "Research", cancel: "Cancel" };
export const DONE_STATES: JobState[] = ["done", "failed", "cancelled", "timeout", "refused"];
export const isDone = (s: unknown): boolean => (DONE_STATES as unknown[]).includes(s);

// ---------- small text helpers ----------
export function fmtSize(n: unknown): string {
  const x = typeof n === "number" && isFinite(n) && n > 0 ? n : 0;
  if (x < 1024) return `${Math.round(x)} B`;
  if (x < MB) return `${(x / 1024).toFixed(x < 10 * 1024 ? 1 : 0)} KB`;
  if (x < 1024 * MB) return `${(x / MB).toFixed(x < 10 * MB ? 1 : 0)} MB`;
  return `${(x / 1024 / MB).toFixed(1)} GB`;
}
export function cleanName(n: unknown): string {
  const raw = typeof n === "string" ? n : "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const s = base.replace(/[\u0000-\u001f<>:"|?*]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
  return s || "file";
}
export function freeName(name: unknown, taken: (n: string) => boolean): string {
  const n = cleanName(name);
  if (!taken(n)) return n;
  const dot = n.lastIndexOf(".");
  const stem = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : "";
  for (let i = 2; i < 1000; i++) if (!taken(`${stem} ${i}${ext}`)) return `${stem} ${i}${ext}`;
  return `${stem} ${Date.now()}${ext}`;
}
export function tail(text: unknown, max = TAIL_FINAL): string {
  const s = typeof text === "string" ? text : "";
  if (s.length <= max) return s;
  const cut = s.slice(s.length - max);
  const nl = cut.indexOf("\n");
  return nl >= 0 && nl < 200 ? cut.slice(nl + 1) : cut;
}
export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
export const chunkCount = (size: number) => Math.max(1, Math.ceil((Number.isFinite(size) && size > 0 ? size : 0) / CHUNK));

/** A short title for a job in lists: the person's words, cut to one line. */
export function outsourceTitle(j: { args?: { title?: unknown } } | { title?: unknown } | string | null | undefined): string {
  const t = typeof j === "string" ? j : (j && "args" in j && j.args ? (j.args as { title?: unknown }).title : j && "title" in j ? (j as { title?: unknown }).title : "");
  const s = (typeof t === "string" ? t : "").replace(/\s+/g, " ").trim();
  return (s || "Untitled job").slice(0, 80);
}

// ---------- time words and online ----------
export function isOnline(st: { at?: number } | null | undefined, now = Date.now()): boolean {
  return !!st && typeof st.at === "number" && now - st.at >= -FUTURE_SKEW && now - st.at < ONLINE_MS;
}
export function seenText(at: unknown, now = Date.now()): string {
  if (typeof at !== "number" || !isFinite(at) || at <= 0) return "never";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
export function machineMs(d: unknown): number {
  if (typeof d === "number") return isFinite(d) ? d : 0;
  if (typeof d === "string") { const t = Date.parse(d); return isFinite(t) ? t : 0; }
  return 0;
}
export const timerOn = (m: Machine | null | undefined): boolean => !!m?.timer?.on;
export function rebootSet(x: unknown): { mode: RebootSetMode; minutes: number } {
  const o = (x && typeof x === "object" ? x : {}) as { mode?: unknown; minutes?: unknown };
  const mode: RebootSetMode = o.mode === "watch" || o.mode === "active" ? o.mode : "off";
  const m = typeof o.minutes === "number" && isFinite(o.minutes) ? Math.round(o.minutes) : 0;
  return { mode, minutes: Math.min(1440, Math.max(0, m)) };
}
export function prune<T extends { at?: number }>(list: T[] | null | undefined, now = Date.now(), keepMs = JOB_KEEP_MS): T[] {
  return (list ?? []).filter((x) => typeof x?.at === "number" && now - x.at < keepMs);
}

// ---------- secrets: nothing secret goes into a job ----------
const SECRET_RES: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\bsk-[A-Za-z0-9_-]{16,}/, "an API key"],
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, "a database key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "a GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{12,}/, "a cloud key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a chat token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, "a login token"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i, "a link with a password in it"],
  [/\b(?:password|passwd|passphrase|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b\s*[:=]\s*["']?[^\s"']{6,}/i, "a password or key written out"],
  [/^\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS)\s*=\s*\S{6,}/m, "an env file line with a key"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/, "a bearer token"],
];
/** "" when the text looks clean, else what it looks like (for example "a private key"). Best effort: a person still checks. */
export function looksSecret(text: unknown): string {
  const s = typeof text === "string" ? text : "";
  if (!s) return "";
  for (const [re, what] of SECRET_RES) if (re.test(s)) return what;
  for (const w of s.split(/[\s"'`,;()<>]+/)) {
    if (w.length >= 40 && /^[A-Za-z0-9+/_=-]+$/.test(w) && /[A-Za-z]/.test(w) && /\d/.test(w) && !/^[0-9a-f]{40}$/i.test(w) && !/^[0-9a-f]{64}$/i.test(w) && new Set(w).size > 14) return "a long secret looking string";
  }
  return "";
}
const SECRET_PATH = /(^|\/)(\.env(\..*)?|\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.docker|\.kube|id_(rsa|ed25519|ecdsa)[^/]*|credentials(\.json)?|secrets?(\.[a-z]+)?|keychains?|Library\/Keychains)(\/|$)|\.(pem|p12|pfx|key|keystore|kdbx)$/i;
export const secretPath = (p: unknown): boolean => typeof p === "string" && SECRET_PATH.test(p.replace(/\\/g, "/"));
export function sharePathOk(p: unknown): boolean {
  if (typeof p !== "string" || !p || p.length > 500 || p.startsWith("/") || p.includes("\0")) return false;
  const parts = p.replace(/\\/g, "/").split("/");
  return !parts.includes("..") && !secretPath(p);
}
export function checkGet(g: unknown): string {
  const b = g as Partial<GetBody> | null;
  if (!b || b.t !== "get") return "not a file request";
  if (typeof b.root !== "string" || !b.root) return "no folder named";
  if (!sharePathOk(b.path)) return "that path is not allowed";
  if (b.as !== "download" && b.as !== "preview") return "unknown request";
  return "";
}
export const shareLink = (device: string, root: string, path: string): string => `ps-share://${encodeURIComponent(device)}/${encodeURIComponent(root)}/${path.split("/").map(encodeURIComponent).join("/")}`;
export function parseShareLink(s: unknown): { device: string; root: string; path: string } {
  const m = typeof s === "string" ? /^ps-share:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(s) : null;
  if (!m) return { device: "", root: "", path: "" };
  try { const path = m[3].split("/").map(decodeURIComponent).join("/"); return sharePathOk(path) ? { device: decodeURIComponent(m[1]), root: decodeURIComponent(m[2]), path } : { device: "", root: "", path: "" }; } catch { return { device: "", root: "", path: "" }; }
}
export function listDir(entries: IdxEntry[] | null | undefined, dir = ""): IdxEntry[] {
  const pre = dir ? dir.replace(/\/$/, "") + "/" : "";
  return (entries ?? []).filter((e) => e.p.startsWith(pre) && !e.p.slice(pre.length).includes("/") && e.p.length > pre.length && !secretPath(e.p));
}
export function fileRefusal(name: unknown, size: unknown): string {
  if (secretPath(typeof name === "string" ? name : "")) return "That file looks like it holds secrets, so it stays here.";
  if (typeof size !== "number" || size <= 0) return "That file is empty.";
  if (size > FILE_MAX) return `That file is over ${fmtSize(FILE_MAX)}.`;
  return "";
}
export const sendRefusal = fileRefusal;
export const dropTargetOk = (t: unknown): boolean => t === "other" || t === "main";
export function suiteWords(s: unknown): "unknown" | "X-Wing (ML-KEM-768 + X25519, post-quantum)" | "P-256 ECDH + AES-256-GCM (not post-quantum)" {
  return s === "p256" ? "P-256 ECDH + AES-256-GCM (not post-quantum)" : s === "xwing" ? "X-Wing (ML-KEM-768 + X25519, post-quantum)" : "unknown";
}

// ---------- keys ----------
const SIGN = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
type KeyCache = { sign?: CryptoKey; enc?: CryptoKey };
const privCache = new Map<string, KeyCache>();
const pubCache = new Map<string, CryptoKey>();

async function rawPub(k: CryptoKey): Promise<string> { return b64url(new Uint8Array(await subtle.exportKey("raw", k))); }

/** Makes this computer's two key pairs. `priv` is one string to keep safe on this computer only (the Keychain). */
export async function makeKeys(device?: string): Promise<Keys> {
  const sg = await subtle.generateKey(SIGN, true, ["sign", "verify"]);
  const en = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const priv = JSON.stringify({ s: await subtle.exportKey("jwk", sg.privateKey), e: await subtle.exportKey("jwk", en.privateKey) });
  return { device: device || b64url(randomBytes(12)), pub: await rawPub(sg.publicKey), encPub: await rawPub(en.publicKey), priv: b64url(bytes(priv)) };
}
async function privOf(keys: Keys): Promise<KeyCache & { sign: CryptoKey; enc: CryptoKey }> {
  let c = privCache.get(keys.priv);
  if (!c?.sign || !c.enc) {
    const j = JSON.parse(td.decode(unb64url(keys.priv))) as { s: JsonWebKey; e: JsonWebKey };
    c = { sign: await subtle.importKey("jwk", j.s, SIGN, false, ["sign"]), enc: await subtle.importKey("jwk", j.e, ECDH, false, ["deriveBits"]) };
    privCache.set(keys.priv, c);
  }
  return c as KeyCache & { sign: CryptoKey; enc: CryptoKey };
}
async function pubSign(pub: string): Promise<CryptoKey> {
  const k = "s" + pub; let c = pubCache.get(k);
  if (!c) { c = await subtle.importKey("raw", unb64url(pub), SIGN, false, ["verify"]); pubCache.set(k, c); }
  return c;
}
async function pubEnc(pub: string): Promise<CryptoKey> {
  const k = "e" + pub; let c = pubCache.get(k);
  if (!c) { c = await subtle.importKey("raw", unb64url(pub), ECDH, false, []); pubCache.set(k, c); }
  return c;
}

// ---------- envelopes: sign, then seal ----------
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
async function aesFor(shared: Bytes, info: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: bytes("ps-second-1"), info: bytes(info) }, base, { name: "AES-GCM", length: 256 }, false, usage);
}

/** Signs `body` with this computer's key and seals it so only `toEncPub` (the other computer) can read it. */
export async function signBody(keys: Keys, body: BodyBase, toEncPub: string): Promise<Env> {
  const p = await privOf(keys);
  const plain = canon(body);
  const sig = b64url(new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, p.sign, bytes(`${body.from}>${body.to}|${plain}`))));
  const eph = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: await pubEnc(toEncPub) }, eph.privateKey, 256)) as Bytes;
  const key = await aesFor(shared, `${body.from}>${body.to}`, ["encrypt"]);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: bytes(`${body.from}>${body.to}`) }, key, bytes(plain)));
  return { body: { e: await rawPub(eph.publicKey), iv: b64url(iv), ct: b64url(ct) }, sig, by: keys.device, v: 1 };
}

/** Opens a sealed envelope and checks the signature against `from`'s public key. Never throws: a bad one is { ok:false, why }. */
export async function openEnv<T extends BodyBase = BodyBase>(keys: Keys, env: unknown, from: Peer | null | undefined): Promise<Check<T>> {
  try {
    const e = env as Env | null;
    if (!e || typeof e !== "object" || typeof e.sig !== "string" || typeof e.by !== "string") return { ok: false, why: "not a sealed message" };
    if (!from) return { ok: false, why: "not paired with that computer" };
    if (e.by !== from.device) return { ok: false, why: "signed by a computer that is not paired" };
    const s = e.body as { e?: unknown; iv?: unknown; ct?: unknown };
    if (!s || typeof s.e !== "string" || typeof s.iv !== "string" || typeof s.ct !== "string") return { ok: false, why: "not a sealed message" };
    const p = await privOf(keys);
    const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: await pubEnc(s.e) }, p.enc, 256)) as Bytes;
    const dir = `${from.device}>${keys.device}`;
    const key = await aesFor(shared, dir, ["decrypt"]);
    let plain: string;
    try { plain = td.decode(await subtle.decrypt({ name: "AES-GCM", iv: unb64url(s.iv), additionalData: bytes(dir) }, key, unb64url(s.ct))); } catch { return { ok: false, why: "it was not sealed for this computer" }; }
    const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await pubSign(from.pub), unb64url(e.sig), bytes(`${dir}|${plain}`));
    if (!ok) return { ok: false, why: "the signature does not match" };
    const body = JSON.parse(plain) as T;
    if (!body || body.from !== from.device || body.to !== keys.device) return { ok: false, why: "addressed to someone else" };
    return { ok: true, body };
  } catch { return { ok: false, why: "could not be opened" }; }
}

// ---------- pairing ----------
/** A one time code to type on the other computer: 8 digits shown as 1234-5678. */
export function makeCode(): string {
  const r = new Uint32Array(2); globalThis.crypto.getRandomValues(r);
  const n = String(((r[0] % 10000) * 10000) + (r[1] % 10000)).padStart(8, "0");
  return `${n.slice(0, 4)}-${n.slice(4)}`;
}
export const cleanCode = (c: unknown): string => (typeof c === "string" ? c.replace(/\D/g, "") : "");
export const codeOk = (c: unknown): boolean => cleanCode(c).length === 8;
export const PAIR_CODE_MS = 10 * 60_000;
/** Pairing proof: what the other computer shows is the code; the proof is a hash that needs the code, so the vault holds no code. */
export async function pairCode(code: string, ...parts: string[]): Promise<string> {
  const d = await subtle.digest("SHA-256", bytes(`ps-pair-1|${cleanCode(code)}|${parts.join("|")}`));
  return b64url(new Uint8Array(d));
}

// ---------- checking a job or a command ----------
export type Seen = Record<string, number>;
export type Ctx = { keys: Keys; peer: Peer | null | undefined; seen: Seen; now?: number };
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
/** Safe repo: a git link without credentials, or a plain folder name. Never a path that climbs out. */
export function repoOk(r: unknown): string {
  if (typeof r !== "string" || !r.trim()) return "no repo named";
  if (r.length > 300) return "the repo name is too long";
  if (/\s/.test(r)) return "the repo name has spaces";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(r)) {
    if (!/^(https|ssh|git):\/\//i.test(r)) return "only https, ssh or git links";
    if (/^[a-z]+:\/\/[^/]*@/i.test(r) && !/^ssh:\/\/git@/i.test(r)) return "a repo link must not carry a name or password";
    return "";
  }
  if (/^git@[\w.-]+:[\w./-]+$/.test(r)) return "";
  if (r.startsWith("/") || r.startsWith("~") || r.includes("..") || r.includes("\\")) return "use a folder name, not a path";
  return /^[\w.-]+$/.test(r) ? "" : "the repo name has odd characters";
}
/** "" when the job body is fine to run now, else the plain reason. */
export function checkJob(j: unknown, now = Date.now()): string {
  const b = j as Partial<JobBody> | null;
  if (!b || typeof b !== "object" || b.t !== "job") return "not a job";
  if (b.v !== 1) return "a job from a newer or older version of PS";
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return "the job has no valid id";
  if (typeof b.from !== "string" || typeof b.to !== "string" || !b.from || !b.to) return "the job has no sender or receiver";
  if (typeof b.at !== "number" || typeof b.exp !== "number") return "the job has no times";
  if (b.at > now + FUTURE_SKEW) return "the job is dated in the future";
  if (b.exp <= now) return "the job expired";
  if (b.exp - b.at > JOB_MAX_AGE + FUTURE_SKEW) return "the job lives too long";
  if (now - b.at > JOB_MAX_AGE + FUTURE_SKEW) return "the job is too old";
  if (b.type === "cancel") return typeof (b.args as { job?: unknown } | undefined)?.job === "string" ? "" : "cancel has no job";
  const a = b.args as JobArgs | undefined;
  if (!a || typeof a !== "object") return "the job has no details";
  if (typeof a.title !== "string" || !a.title.trim() || a.title.length > 200) return "the job needs a short title";
  const re = repoOk(a.repo); if (re) return re;
  if (typeof a.base !== "string" || !/^[\w./-]{1,100}$/.test(a.base) || a.base.includes("..")) return "the base commit is not valid";
  if (typeof a.prompt !== "string" || !a.prompt.trim()) return "the job has no instructions";
  if (a.prompt.length > PROMPT_MAX) return `the instructions are over ${PROMPT_MAX} characters`;
  if (a.minutes !== undefined && (typeof a.minutes !== "number" || !(a.minutes >= 1) || a.minutes > OJOB_MAX_MINUTES)) return `the time limit must be 1 to ${OJOB_MAX_MINUTES} minutes`;
  if (a.tool !== undefined && a.tool !== "claude" && a.tool !== "codex") return "unknown AI tool";
  for (const [label, t] of [["title", a.title], ["repo", a.repo], ["base", a.base], ["instructions", a.prompt]] as const) {
    const s = looksSecret(t); if (s) return `the ${label} looks like it holds ${s}`;
  }
  return "";
}
export function checkCmd(c: unknown, now = Date.now()): string {
  const b = c as Partial<CmdBody> | null;
  if (!b || typeof b !== "object" || b.t !== "cmd" || b.v !== 1) return "not a command";
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return "the command has no valid id";
  if (typeof b.at !== "number" || typeof b.exp !== "number") return "the command has no times";
  if (b.at > now + FUTURE_SKEW) return "the command is dated in the future";
  if (b.exp <= now) return "the command expired";
  if (b.exp - b.at > CMD_MAX_AGE + FUTURE_SKEW) return "the command lives too long";
  if (!cmdAction(b.action)) return "unknown command";
  return "";
}
/** The replay list: ids already taken. Old ones go (a job that old is refused anyway, so forgetting them is safe). */
export function remember(seen: Seen, id: string, at: number, now = Date.now()): Seen {
  const out: Seen = {};
  for (const [k, t] of Object.entries(seen)) if (now - t < JOB_MAX_AGE + 2 * FUTURE_SKEW) out[k] = t;
  out[id] = at;
  return out;
}
export type Accepted<T> = { ok: true; body: T; seen: Seen } | { ok: false; why: string };
async function accept<T extends BodyBase>(env: unknown, ctx: Ctx, t: "job" | "cmd", check: (b: unknown, now: number) => string): Promise<Accepted<T>> {
  const now = ctx.now ?? Date.now();
  const peer = ctx.peer;
  if (!peer || peer.role !== "primary") return { ok: false, why: "only the paired main computer may send this" };
  const o = await openEnv<T>(ctx.keys, env, peer);
  if (!o.ok) return o;
  if (o.body.t !== t) return { ok: false, why: `not a ${t}` };
  const why = check(o.body, now);
  if (why) return { ok: false, why };
  if (ctx.seen[o.body.id] !== undefined) return { ok: false, why: "seen before (replay)" };
  return { ok: true, body: o.body, seen: remember(ctx.seen, o.body.id, o.body.at, now) };
}
/** The other computer's gate for a job. Order: open, signed by the paired main computer, addressed here, not expired, no secret, not a replay. */
export const acceptJob = (env: unknown, ctx: Ctx): Promise<Accepted<JobBody>> => accept<JobBody>(env, ctx, "job", checkJob);
export const acceptCmd = (env: unknown, ctx: Ctx): Promise<Accepted<CmdBody>> => accept<CmdBody>(env, ctx, "cmd", checkCmd);

/** The main computer's gate for a result or status that came back: signed by the paired other computer, about a job we sent. */
export async function acceptResult(env: unknown, ctx: Ctx, sent: (jobId: string) => boolean): Promise<Accepted<JobStatusBody>> {
  const peer = ctx.peer;
  if (!peer || peer.role !== "secondary") return { ok: false, why: "only the paired other computer may send this" };
  const o = await openEnv<JobStatusBody>(ctx.keys, env, peer);
  if (!o.ok) return o;
  const b = o.body;
  if (b.t !== "jobst" || typeof b.job !== "string") return { ok: false, why: "not a job result" };
  if (!sent(b.job)) return { ok: false, why: "a result for a job we never sent" };
  if (!(JOB_STATES as string[]).includes(b.state)) return { ok: false, why: "unknown state" };
  const now = ctx.now ?? Date.now();
  if (typeof b.at !== "number" || b.at > now + FUTURE_SKEW) return { ok: false, why: "dated in the future" };
  return { ok: true, body: { ...b, tail: tail(b.tail, TAIL_FINAL) }, seen: ctx.seen };
}
const JOB_STATES: JobState[] = ["accepted", "refused", "queued", "running", "done", "failed", "cancelled", "timeout"];
export const jobRunning = (s: unknown): boolean => s === "accepted" || s === "queued" || s === "running";
export const STATE_WORD: Record<JobState | "sent", string> = {
  accepted: "Taken", refused: "Refused", queued: "Waiting", running: "Running", done: "Finished", failed: "Failed", cancelled: "Cancelled", timeout: "Out of time", sent: "Sent",
};

/** Builds a signed, sealed job for the other computer. Refuses (throws) when the job would be refused on the other side. */
export async function makeJob(keys: Keys, peer: Peer, args: JobArgs, opts: { id?: string; now?: number; ttlMs?: number; type?: JobType } = {}): Promise<{ env: Env; body: JobBody }> {
  const now = opts.now ?? Date.now();
  const body: JobBody = {
    v: 1, t: "job", id: opts.id ?? b64url(randomBytes(12)), from: keys.device, to: peer.device, at: now,
    exp: now + Math.min(opts.ttlMs ?? 6 * 3600_000, JOB_MAX_AGE), type: opts.type ?? "claude", args,
  };
  const why = checkJob(body, now);
  if (why) throw new Error(why);
  return { env: await signBody(keys, body, peer.encPub), body };
}
export async function makeCmd(keys: Keys, peer: Peer, action: CmdAction, opts: { now?: number; id?: string; mode?: RebootSetMode; minutes?: number } = {}): Promise<{ env: Env; body: CmdBody }> {
  const now = opts.now ?? Date.now();
  const body: CmdBody = { v: 1, t: "cmd", id: opts.id ?? b64url(randomBytes(12)), from: keys.device, to: peer.device, at: now, exp: now + CMD_MAX_AGE, action };
  if (opts.mode) body.mode = opts.mode;
  if (typeof opts.minutes === "number") body.minutes = opts.minutes;
  const why = checkCmd(body, now); if (why) throw new Error(why);
  return { env: await signBody(keys, body, peer.encPub), body };
}
export async function makeStatus(keys: Keys, peer: Peer, body: Omit<JobStatusBody, "v" | "t" | "from" | "to" | "at" | "id"> & { id?: string; at?: number }): Promise<Env> {
  const full = { ...body, v: 1, t: "jobst", id: body.id ?? b64url(randomBytes(12)), from: keys.device, to: peer.device, at: body.at ?? Date.now(), tail: tail(body.tail, TAIL_FINAL) } as JobStatusBody;
  return signBody(keys, full, peer.encPub);
}
