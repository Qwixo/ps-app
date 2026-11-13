// Left out of the public source: Second Computer. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { id: "", title: "", sub: "", body: "", sticky: false, actions: [] };
export function rebootWarnCard(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; id: any; title: any; sub: any; body: any; sticky: any; actions: any[] } { return _v0; }
export const WARN_BEFORE: number = 0;
export type WarnCard = { [k: string]: any; id: any; title: any; sub: any; body: any; sticky: any; actions: any[] };
