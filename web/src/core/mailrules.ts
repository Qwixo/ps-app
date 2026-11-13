// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { pop: false, why: "none" };
const _v1: any = { e: undefined };
const _v2: any = { e: undefined };
const _v3: any = new Set();
const _v4: any = { email: "", name: "", accounts: [], last: "", subject: "", ids: [] };
const _v5: any = { email: "", name: "", accounts: [], last: "", subject: "", ids: [] };
const _v6: any = [];
const _v7: any = [];
const _v8: any = [];
const _v9: any = { entry: "", list: "off", clientId: "" };
const _v10: any = [];
export function cleanRuleEntry(_p0?: any, ..._more: any[]): any { return undefined; }
export function ruleFor(_p0?: any, _p1?: any, ..._more: any[]): "notify" | "mute" { return "notify"; }
export function mailVerdict(_p0?: any, _p1?: any, _p2?: any, _p3?: { [k: string]: any; add?: (...a: any[]) => any; clear?: (...a: any[]) => any; delete?: (...a: any[]) => any; forEach?: (...a: any[]) => any; has?: (...a: any[]) => any; entries?: (...a: any[]) => any; keys?: (...a: any[]) => any; values?: (...a: any[]) => any }, ..._more: any[]): { [k: string]: any; pop: any; why: "none" | "client" | "notify" | "muted" | "own" } { return _v0; }
export function setRule(_p0?: any, _p1?: any, _p2?: any, _p3?: any, ..._more: any[]): { [k: string]: any; e?: any } { return _v1; }
export function mergeMailRules(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; e?: any } { return _v2; }
export function ownAccounts(_p0?: any, _p1?: any, ..._more: any[]): Set<any> { return _v3; }
export function logInbound(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): { [k: string]: any; email: any; name?: any; accounts: any[]; last: any; subject?: any; ids: any[] } { return _v4; }
export function mergeSender(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; email: any; name?: any; accounts: any[]; last: any; subject?: any; ids: any[] } { return _v5; }
export function senderRows(_p0?: any, _p1?: (...a: any[]) => any, _p2?: any, _p3?: { [k: string]: any; add?: (...a: any[]) => any; clear?: (...a: any[]) => any; delete?: (...a: any[]) => any; forEach?: (...a: any[]) => any; has?: (...a: any[]) => any; entries?: (...a: any[]) => any; keys?: (...a: any[]) => any; values?: (...a: any[]) => any }, _p4?: any, ..._more: any[]): any[] { return _v6; }
export function searchRows(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v7; }
export function staleSenders(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v8; }
export function cleanMailRuleOp(_p0?: any, ..._more: any[]): { [k: string]: any; entry: any; list: "off" | "notify" | "mute"; clientId?: any } { return _v9; }
export type RuleList = any;
export type MailRules = { [k: string]: any; e?: any };
export type Why = any;
export type Verdict = { [k: string]: any; pop: any; why: "none" | "client" | "notify" | "muted" | "own" };
export const SENDER_DAYS: number = 0;
export function ruleList(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v10; }
export type MailSender = { [k: string]: any; email: any; name?: any; accounts: any[]; last: any; subject?: any; ids: any[] };
export type SenderRow = { [k: string]: any; email: any; name: any; account: any; accounts: any; last: any; subject: any; count: any; verdict: { [k: string]: any; pop: any; why: any }; clientId: any };
