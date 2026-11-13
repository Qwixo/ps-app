// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
export function ReplyRow(_p0?: any, ..._more: any[]): any { return undefined; }
export function RepliesCard(..._more: any[]): any { return undefined; }
export function ClientReplies(_p0?: { [k: string]: any; onEditMatching?: (...a: any[]) => any }, ..._more: any[]): any { return undefined; }
export function MatchField(_p0?: any, ..._more: any[]): any { return undefined; }
export function GmailSettings(..._more: any[]): any { return undefined; }
