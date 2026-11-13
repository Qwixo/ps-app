// Left out of the public source: Campaigns. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = Promise.resolve(undefined);
const _v1: any = { busy: false, at: "", data: { v: 0, today: "", camps: [], days: [] }, error: "", connected: false, checked: 0 };
const _v2: any = { data: undefined, h: "", at: "", busy: undefined, error: "", connected: undefined, checked: 0 };
const _v3: any = { v: 0, today: "", camps: [], days: [] };
const _v4: any = { rows: [], today: { sent: 0, replied: 0, newLeads: 0 }, week: { replied: 0, prev: 0, sent: 0 }, rate: 0, left: 0, daysLeft: 0, days: [] };
export function setLiveAsker(_p0?: (...a: any[]) => any, ..._more: any[]): void { return undefined; }
export function refreshCampaignsLive(_p0?: any, ..._more: any[]): Promise<any> { return _v0; }
export function liveForMirror(..._more: any[]): { [k: string]: any; busy: any; at: any; data: { [k: string]: any; v: any; today: any; camps: any[]; days: any[] }; error: any; connected: any; checked: any } { return _v1; }
export function setLiveMirror(_p0?: any, ..._more: any[]): void { return undefined; }
export function __devLive(_p0?: (...a: any[]) => any, ..._more: any[]): void { return undefined; }
export function __resetLive(..._more: any[]): void { return undefined; }
export type LiveState = { [k: string]: any; data: { [k: string]: any; v: any; today: any; camps: any[]; days: any[] }; h: any; at: any; busy: any; error: any; connected: any; checked: any };
export const liveStore: { [k: string]: any; get: (..._more: any[]) => { [k: string]: any; data: any; h: any; at: any; busy: any; error: any; connected: any; checked: any }; subscribe: (_p0?: (...a: any[]) => any, ..._more: any[]) => (..._more: any[]) => void } = { get: (..._a: any[]) => _v2, subscribe: (..._a: any[]) => (..._a: any[]) => undefined };
export const LIVE_EVERY_MS: number = 0;
export const LIVE_FRESH_MS: number = 0;
export function cleanLivePayload(_p0?: any, ..._more: any[]): { [k: string]: any; v: any; today: any; camps: any[]; days: any[] } { return _v3; }
export function liveView(_p0?: any, ..._more: any[]): { [k: string]: any; rows: any[]; today: { [k: string]: any; sent: any; replied: any; newLeads: any }; week: { [k: string]: any; replied: any; prev: any; sent: any }; rate: any; left: any; daysLeft: any; days: any[] } { return _v4; }
export function liveAgo(_p0?: any, ..._more: any[]): string { return ""; }
export function errorWords(_p0?: any, ..._more: any[]): "The Instantly key cannot read campaign stats yet. It needs a read scope that covers campaigns." | "Offline. The numbers below are from the last check." | "Only you can see these numbers. Sign in again." | "The live feed is not switched on yet (the campaigns-live function is not deployed)." | "Instantly did not answer. The numbers below are from the last check." { return "The Instantly key cannot read campaign stats yet. It needs a read scope that covers campaigns."; }
export type LivePart = { [k: string]: any; s: any; r: any; nl: any; b: any };
export type LiveCamp = { [k: string]: any; id: any; name: any; st: any; leads: any; con: any; nl: any; s: any; r: any; auto: any; b: any; u: any; done: any; opp: any; val: any; d1: { [k: string]: any; s: any; r: any; nl: any; b: any }; d7: { [k: string]: any; s: any; r: any; nl: any; b: any } };
export type LiveDay = { [k: string]: any; d: any; s: any; r: any; nl: any; o: any };
export type LivePayload = { [k: string]: any; v: any; today: any; camps: any[]; days: any[] };
export const STATUS: any = inert;
export function statusLabel(_p0?: any, ..._more: any[]): string { return ""; }
export const MIN_SAMPLE: number = 0;
export type Flag = { [k: string]: any; kind: "quiet" | "dry" | "empty" | "bounce" | "low"; text: any };
export type LiveRow = { [k: string]: any; label: any; active: any; rate: any; bounceRate: any; left: any; perDay: any; daysLeft: any; flags: any[]; id: any; name: any; st: any; leads: any; con: any; nl: any; s: any; r: any; auto: any; b: any; u: any; done: any; opp: any; val: any; d1: { [k: string]: any; s: any; r: any; nl: any; b: any }; d7: { [k: string]: any; s: any; r: any; nl: any; b: any } };
export type LiveView = { [k: string]: any; rows: any[]; today: { [k: string]: any; sent: any; replied: any; newLeads: any }; week: { [k: string]: any; replied: any; prev: any; sent: any }; rate: any; left: any; daysLeft: any; days: any[] };
