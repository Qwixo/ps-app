// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = [];
const _v1: any = { since: "", seen: undefined, remind: undefined };
const _v2: any = { since: "", seen: undefined, remind: undefined };
export function isAutoReply(_p0?: any, ..._more: any[]): boolean { return false; }
export function isLeadReply(_p0?: any, _p1?: { [k: string]: any; add?: (...a: any[]) => any; clear?: (...a: any[]) => any; delete?: (...a: any[]) => any; forEach?: (...a: any[]) => any; has?: (...a: any[]) => any; entries?: (...a: any[]) => any; keys?: (...a: any[]) => any; values?: (...a: any[]) => any }, ..._more: any[]): boolean { return false; }
export function leadCards(_p0?: any, _p1?: any, _p2?: any, _p3?: any, ..._more: any[]): any[] { return _v0; }
export function leadAnswer(_p0?: any, _p1?: any, _p2?: any, _p3?: any, _p4?: any, ..._more: any[]): { [k: string]: any; since: any; seen?: any; remind?: any } { return _v1; }
export function mergeLeadState(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; since: any; seen?: any; remind?: any } { return _v2; }
export function nextLeadRemind(_p0?: any, _p1?: any, ..._more: any[]): number { return 0; }
export type IRep = { [k: string]: any; id?: any; threadId?: any; lead?: any; from?: any; fromName?: any; account?: any; at?: any; subject?: any; opening?: any; campaignId?: any; url?: any; type?: any };
export type LeadCard = { [k: string]: any; id: any; key: any; email: any; rev: any; title: any; sub: any; body: any; url: any; at: any; fresh: any; name?: any; company?: any; subject?: any };
export const LEAD_REMIND: { [k: string]: any; start: any; step: any; min: any; max: any } = { start: 0, step: 0, min: 0, max: 0 };
