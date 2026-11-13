// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { sig: "", sigs: undefined, responses: [], red: false, send: { random: false, min: 0, max: 0 }, clients: [], accounts: [] };
const _v1: any = { cardId: "", via: "instantly", account: "", to: "", toName: "", first: "", name: "", company: "", subject: "", threadId: "", clientIds: [], emailId: "", quote: { at: "", who: "", text: "" } };
const _v2: any = Promise.resolve(undefined);
export function replyPrefs(..._more: any[]): { [k: string]: any; sig: any; sigs: any; responses: any[]; red: any; send: { [k: string]: any; random: any; min: any; max: any }; clients: any[]; accounts: any[] } { return _v0; }
export function ctxForCard(_p0?: any, ..._more: any[]): { [k: string]: any; cardId: any; via: "instantly" | "gmail"; account: any; to: any; toName: any; first: any; name: any; company: any; subject: any; threadId: any; clientIds: any[]; emailId: any; quote: { [k: string]: any; at: any; who: any; text: any } } { return _v1; }
export function openReplyFor(_p0?: any, ..._more: any[]): void { return undefined; }
export function openReplySetup(..._more: any[]): void { return undefined; }
export function runMailReplyOp(_p0?: any, ..._more: any[]): Promise<any> { return _v2; }
export function replyMessage(_p0?: any, ..._more: any[]): boolean { return false; }
export function startReplyEngine(_p0?: (...a: any[]) => any, ..._more: any[]): void { return undefined; }
export function cleanReplyPatch(_p0?: any, ..._more: any[]): any { return undefined; }
