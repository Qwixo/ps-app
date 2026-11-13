// Left out of the public source: Second Computer. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = Promise.resolve(undefined);
const _v1: any = Promise.resolve(undefined);
const _v2: any = Promise.resolve(undefined);
const _v3: any = Promise.resolve(undefined);
const _v4: any = Promise.resolve(undefined);
const _v5: any = { mode: "off", minutes: 0 };
const _v6: any = Promise.resolve(undefined);
const _v7: any = { device: "", root: "", path: "" };
const _v8: any = [];
const _v9: any = [];
export function pairCode(_p0?: any, _p1?: any, ..._more: any[]): Promise<any> { return _v0; }
export function makeKeys(..._more: any[]): Promise<any> { return _v1; }
export function signBody(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): Promise<any> { return _v2; }
export function openEnv<_F0 = any>(_p0?: any, _p1?: any, ..._more: any[]): Promise<any> { return _v3; }
export function checkJob(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function acceptJob(_p0?: any, _p1?: any, ..._more: any[]): Promise<any> { return _v4; }
export function rebootSet(_p0?: any, ..._more: any[]): { [k: string]: any; mode: "off" | "watch" | "active"; minutes: any } { return _v5; }
export function acceptCmd(_p0?: any, _p1?: any, ..._more: any[]): Promise<any> { return _v6; }
export function sharePathOk(_p0?: any, ..._more: any[]): boolean { return false; }
export function checkGet(_p0?: any, ..._more: any[]): string { return ""; }
export function shareLink(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): string { return ""; }
export function parseShareLink(_p0?: any, ..._more: any[]): { [k: string]: any; device: any; root: any; path: any } { return _v7; }
export function listDir(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v8; }
export function tail(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function sendRefusal(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function dropTargetOk(_p0?: any, ..._more: any[]): boolean { return false; }
export function fileRefusal(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function cleanName(_p0?: any, ..._more: any[]): string { return ""; }
export function freeName(_p0?: any, _p1?: (...a: any[]) => any, ..._more: any[]): string { return ""; }
export function fmtSize(_p0?: any, ..._more: any[]): string { return ""; }
export function looksSecret(_p0?: any, ..._more: any[]): string { return ""; }
export function outsourceTitle(_p0?: any, ..._more: any[]): string { return ""; }
export function secretPath(_p0?: any, ..._more: any[]): boolean { return false; }
export function isOnline(_p0?: any, _p1?: any, ..._more: any[]): boolean { return false; }
export function seenText(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): string { return ""; }
export function prune(_p0?: any, ..._more: any[]): any[] { return _v9; }
export type Role = any;
export type BodyType = any;
export type Env = { [k: string]: any; body: any; sig: any; by: any };
export type BodyBase = { [k: string]: any; v: any; t: "stat" | "msg" | "job" | "cmd" | "pair" | "get" | "jobst" | "dev" | "pairok" | "file" | "ack" | "idx"; id: any; from: any; to: any; at: any };
export type JobType = any;
export type TestPreset = any;
export const TEST_PRESETS: any[] = [];
export type BundleRef = { [k: string]: any; project: any; file: any; head: any; base?: any };
export type JobBody = { [k: string]: any; t: "job"; exp: any; type: "selftest" | "build" | "tests" | "claude" | "research" | "cancel"; args: any; bundles?: any[]; v: any; id: any; from: any; to: any; at: any };
export type JobState = any;
export type JobStatusBody = { [k: string]: any; t: "jobst"; job: any; state: "accepted" | "refused" | "queued" | "running" | "done" | "failed" | "cancelled" | "timeout"; reason?: any; startedAt?: any; endedAt?: any; exit?: any; step?: any; tail: any; summary?: any; files?: any[]; result?: any; v: any; id: any; from: any; to: any; at: any };
export type StatBody = { [k: string]: any; t: "stat"; cpu: any; mem?: any; battery: any; charging: any; power: "ac" | "battery"; busy: any; queue: any; have: any; disk?: any; app?: any; sleepSoon?: any; machine?: { [k: string]: any; awake?: any; locked?: any; fileVault?: any; passwordImmediately?: any; timer?: any; helper?: any; bootedAt?: any; lastRestart?: any }; v: any; id: any; from: any; to: any; at: any };
export type Machine = { [k: string]: any; awake?: any; locked?: any; fileVault?: "on" | "off" | "unknown"; passwordImmediately?: any; timer?: { [k: string]: any; on?: any; hours: any; deadline: any; mode?: any; asked?: any; live?: any; safeMode?: any; lastWould?: any; minutes?: any; postponed?: any; postpone?: any; set?: any; lockedAt?: any; signedIn?: any; periods?: any[] }; helper?: "approved" | "needs approval" | "not set up" | "missing"; bootedAt?: any; lastRestart?: { [k: string]: any; at: any; kind: any } };
export type LockPeriod = { [k: string]: any; lockedAt: any; endedAt: any; ran: any; end: any; postponed?: any; would?: any };
export function machineMs(_p0?: any, ..._more: any[]): number { return 0; }
export function timerOn(_p0?: any, ..._more: any[]): boolean { return false; }
export type FileBody = { [k: string]: any; t: "file"; name: any; size: any; sha256: any; mime: any; purpose: "user" | "bundle" | "result" | "share"; job?: any; get?: any; root?: any; dir?: any; chunk: any; n: any; pack?: "zip"; m?: any; v: any; id: any; from: any; to: any; at: any };
export type MsgBody = { [k: string]: any; t: "msg"; text: any; files?: any[]; v: any; id: any; from: any; to: any; at: any };
export type RebootSetMode = any;
export type CmdAction = any;
export type CmdBody = { [k: string]: any; t: "cmd"; exp: any; action: any; v: any; id: any; from: any; to: any; at: any };
export type IdxEntry = { [k: string]: any; p: any; d?: any; s: any; m: any; k?: "image" | "pdf" | "text" | "other" };
export type IdxBody = { [k: string]: any; t: "idx"; root: any; name: any; entries: any[]; v: any; id: any; from: any; to: any; at: any };
export type GetBody = { [k: string]: any; t: "get"; root: any; path: any; as: "download" | "preview"; v: any; id: any; from: any; to: any; at: any };
export type DevBody = { [k: string]: any; t: "dev"; name: any; model?: any; chip?: any; role: "primary" | "secondary" | "none"; pub: any; app?: any; ncaps?: any[]; wcaps?: any[]; v: any; id: any; from: any; to: any; at: any };
export type PairBody = { [k: string]: any; t: "pair" | "pairok"; primary: any; primaryPub: any; secondary: any; secondaryPub: any; names?: { [k: string]: any; p?: any; s?: any }; v: any; id: any; from: any; to: any; at: any };
export type AckBody = { [k: string]: any; t: "ack"; ref: any; ok: any; reason?: any; path?: any; v: any; id: any; from: any; to: any; at: any };
export const MB: number = 0;
export const FILE_MAX: number = 0;
export const WAITING_MAX: number = 0;
export const STREAM_MAX: number = 0;
export const MONTH_MAX: number = 0;
export const CHUNK: number = 0;
export const MSG_MAX: number = 0;
export const PROMPT_MAX: number = 0;
export const ONLINE_MS: number = 0;
export const JOB_MAX_AGE: number = 0;
export const FILE_MAX_AGE: number = 0;
export const FUTURE_SKEW: number = 0;
export const TAIL_RUNNING: number = 0;
export const TAIL_FINAL: number = 0;
export const JOB_MINUTES: { [k: string]: any; selftest: any; build: any; tests: any; claude: any; research: any } = { selftest: undefined, build: undefined, tests: undefined, claude: undefined, research: undefined };
export const CMD_MAX_AGE: number = 0;
export const IDX_MAX: number = 0;
export type Peer = { [k: string]: any; device: any; name?: any; pub: any; role: "primary" | "secondary" | "none" };
export type Check<_T0 = any> = any;
export const CMD_ACTIONS: any[] = [];
export function cmdAction(_p0?: any, ..._more: any[]): boolean { return false; }
export const JOB_LABEL: { [k: string]: any; selftest: any; build: any; tests: any; claude: any; research: any; cancel: any } = { selftest: undefined, build: undefined, tests: undefined, claude: undefined, research: undefined, cancel: undefined };
export const DONE_STATES: any[] = [];
export function isDone(_p0?: any, ..._more: any[]): boolean { return false; }
export function monthKey(_p0?: any, ..._more: any[]): string { return ""; }
export type DropTarget = any;
export function chunkCount(_p0?: any, ..._more: any[]): number { return 0; }
export const OJOB_MINUTES: number = 0;
export const OJOB_MAX_MINUTES: number = 0;
export const OJOB_MAX_RUNNING: number = 0;
export function suiteWords(_p0?: any, ..._more: any[]): "unknown" | "X-Wing (ML-KEM-768 + X25519, post-quantum)" | "P-256 ECDH + AES-256-GCM (not post-quantum)" { return "unknown"; }
export const KEEP_MSGS: number = 0;
export const JOB_KEEP_MS: number = 0;
export const FILE_KEEP_MS: number = 0;
