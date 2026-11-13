// Left out of the public source: Campaigns. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { onMouseMove: (..._a: any[]) => undefined, onMouseLeave: (..._a: any[]) => undefined, onMouseDown: (..._a: any[]) => undefined };
export function PickButton(_p0?: any, ..._more: any[]): any { return undefined; }
export function useEdgeScroll(_p0?: any, ..._more: any[]): { [k: string]: any; onMouseMove: (_p0?: any, ..._more: any[]) => void; onMouseLeave: (..._more: any[]) => void; onMouseDown: (..._more: any[]) => void } { return _v0; }
export function ago(_p0?: any, ..._more: any[]): string { return ""; }
export function CampaignStats(_p0?: any, ..._more: any[]): any { return undefined; }
export function prettyVal(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function Spark14(_p0?: any, ..._more: any[]): any { return undefined; }
export function GmailAccounts(_p0?: any, ..._more: any[]): any { return undefined; }
export function n0(_p0?: any, ..._more: any[]): string { return ""; }
export function pct(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function fmtDay(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function campName(_p0?: any, ..._more: any[]): string { return ""; }
export function Status(_p0?: any, ..._more: any[]): any { return undefined; }
export function prettyKey(_p0?: any, ..._more: any[]): string { return ""; }
