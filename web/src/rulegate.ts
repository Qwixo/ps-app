// Left out of the public source: the PS rules. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = [];
export function openRuleBook(_p0?: any, _p1?: any, ..._more: any[]): void { return undefined; }
export function closeRuleBook(..._more: any[]): void { return undefined; }
export function ruleBookOpen(..._more: any[]): boolean { return false; }
export function useRuleBook(..._more: any[]): any { return inert; }
export function myRules(..._more: any[]): any[] { return _v0; }
export function endDayGate(_p0?: any, _p1?: (...a: any[]) => any, ..._more: any[]): void { return undefined; }
export type RuleOwner = any;
export type RuleBookState = any;
