// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { replies: [], sent: [] };
export function irepFeed(_p0?: any, ..._more: any[]): { [k: string]: any; replies?: any[]; sent?: any[] } { return _v0; }
export function mailCardMessage(_p0?: any, ..._more: any[]): boolean { return false; }
export function refreshMailCards(..._more: any[]): void { return undefined; }
export function startMailCards(_p0?: (...a: any[]) => any, _p1?: (...a: any[]) => any, ..._more: any[]): void { return undefined; }
