// Left out of the public source: the PS rules. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
export function PsRuleButton(_p0?: any, ..._more: any[]): any { return null; }
export function RuleBookHost(_p0?: any, ..._more: any[]): any { return null; }
export const HOLD_FAIL_MS: number = 0;
