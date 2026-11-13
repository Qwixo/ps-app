// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { clientId: "", account: "", threadId: "", msgIds: [], from: "", fromName: "", subject: "", snippet: "", opening: "", date: "", count: 0, handled: false, handledAt: "", handledHow: "you", seenAt: "", remindAt: "", remindFor: "" };
const _v1: any = [];
const _v2: any = { remindAt: "", remindFor: "" };
export function nextRemind(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): number { return 0; }
export function mergeReply(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; clientId: any; account: any; threadId: any; msgIds: any[]; from: any; fromName?: any; subject: any; snippet: any; opening?: any; date: any; count: any; handled: any; handledAt?: any; handledHow?: "you" | "replied"; seenAt?: any; remindAt?: any; remindFor?: any } { return _v0; }
export function mailCards(_p0?: any, _p1?: any, _p2?: any, _p3?: any, ..._more: any[]): any[] { return _v1; }
export type MailCard = { [k: string]: any; id: any; replyId: any; title: any; sub: any; body: any; url: any; at: any; rev: any; client: any; from?: any; fromName?: any };
export function isUnseen(_p0?: any, _p1?: any, ..._more: any[]): boolean { return false; }
export const REMIND: { [k: string]: any; start: any; step: any; min: any; max: any } = { start: 0, step: 0, min: 0, max: 0 };
export function stepRemind(_p0?: any, _p1?: any, ..._more: any[]): number { return 0; }
export function remindText(_p0?: any, ..._more: any[]): string { return ""; }
export function remindPatch(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): { [k: string]: any; remindAt: any; remindFor: any } { return _v2; }
export function isReminding(_p0?: any, _p1?: any, ..._more: any[]): boolean { return false; }
