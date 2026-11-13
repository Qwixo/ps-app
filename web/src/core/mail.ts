// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { name: "", email: "" };
const _v1: any = { type: "addr", v: "" };
const _v2: any = { ok: [], bad: [] };
const _v3: any = { clientId: "", account: "", threadId: "", msgIds: [], from: "", fromName: "", subject: "", snippet: "", opening: "", date: "", count: 0, handled: false, handledAt: "", handledHow: "you", seenAt: "", remindAt: "", remindFor: "" };
const _v4: any = { clientId: "", account: "", threadId: "", msgIds: [], from: "", fromName: "", subject: "", snippet: "", opening: "", date: "", count: 0, handled: false, handledAt: "", handledHow: "you", seenAt: "", remindAt: "", remindFor: "" };
export function parseAddress(_p0?: any, ..._more: any[]): { [k: string]: any; name: any; email: any } { return _v0; }
export function parseMatchEntry(_p0?: any, ..._more: any[]): { [k: string]: any; type: "addr" | "domain"; v: any } { return _v1; }
export function cleanMatchList(_p0?: any, ..._more: any[]): { [k: string]: any; ok: any[]; bad: any[] } { return _v2; }
export function buildMatcher(_p0?: any, ..._more: any[]): (_p0?: any, ..._more: any[]) => string { return (..._a: any[]) => ""; }
export function clientForInbound(_p0?: (...a: any[]) => any, _p1?: any, _p2?: any, _p3?: { [k: string]: any; add?: (...a: any[]) => any; clear?: (...a: any[]) => any; delete?: (...a: any[]) => any; forEach?: (...a: any[]) => any; has?: (...a: any[]) => any; entries?: (...a: any[]) => any; keys?: (...a: any[]) => any; values?: (...a: any[]) => any }, ..._more: any[]): string { return ""; }
export function applyInbound(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): { [k: string]: any; clientId: any; account: any; threadId: any; msgIds: any[]; from: any; fromName?: any; subject: any; snippet: any; opening?: any; date: any; count: any; handled: any; handledAt?: any; handledHow?: "you" | "replied"; seenAt?: any; remindAt?: any; remindFor?: any } { return _v3; }
export function applySent(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; clientId: any; account: any; threadId: any; msgIds: any[]; from: any; fromName?: any; subject: any; snippet: any; opening?: any; date: any; count: any; handled: any; handledAt?: any; handledHow?: "you" | "replied"; seenAt?: any; remindAt?: any; remindFor?: any } { return _v4; }
export function gmailThreadLink(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function firstName(_p0?: any, ..._more: any[]): string { return ""; }
export function replierName(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function firstSentences(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export type GmailInbound = { [k: string]: any; kind: "gmail"; account: any; id: any; threadId: any; date: any; from: any; to?: any; cc?: any; subject: any; snippet: any; opening?: any; msgId?: any };
export type GmailSent = { [k: string]: any; kind: "gmail-sent"; account: any; id: any; threadId: any; date: any };
export const FREE_DOMAINS: Set<any> = new Set();
export function domainOf(_p0?: any, ..._more: any[]): string { return ""; }
export function accountLabel(_p0?: any, ..._more: any[]): string { return ""; }
