// Left out of the public source: the follow up radar. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
export function RadarButton(_p0?: any, ..._more: any[]): any { return null; }
export function RadarPanel(_p0?: { [k: string]: any; onClose?: (...a: any[]) => any }, ..._more: any[]): any { return null; }
export function RadarCard(_p0?: any, ..._more: any[]): any { return null; }
export type RadarActions = { [k: string]: any; handled: (_p0?: any, _p1?: any, ..._more: any[]) => void; snooze: (_p0?: any, _p1?: any, ..._more: any[]) => void; task: (_p0?: any, ..._more: any[]) => void; draft: (_p0?: any, ..._more: any[]) => void };
