// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = [];
const _v1: any = [];
const _v2: any = [];
const _v3: any = [];
export function cleanReplyCardId(_p0?: any, ..._more: any[]): string { return ""; }
export function replyButtonShows(_p0?: any, ..._more: any[]): boolean { return false; }
export function leadRows(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v0; }
export function cleanLeadRows(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v1; }
export function mailRows(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): any[] { return _v2; }
export function setLeadMirror(_p0?: any, ..._more: any[]): void { return undefined; }
export type MailRow = { [k: string]: any; cardId: any; via: "instantly" | "gmail"; replyId?: any; who: any; company: any; subject: any; preview: any; at: any; url: any; count: any };
export type LeadRow = { [k: string]: any; preview: any; subject: any; at: any; company: any; cardId: any; who: any; url: any };
export function gmailCardId(_p0?: any, ..._more: any[]): string { return ""; }
export const leadMirror: { [k: string]: any; get: (..._more: any[]) => any[]; subscribe: (_p0?: (...a: any[]) => any, ..._more: any[]) => (..._more: any[]) => void } = { get: (..._a: any[]) => _v3, subscribe: (..._a: any[]) => (..._a: any[]) => undefined };
