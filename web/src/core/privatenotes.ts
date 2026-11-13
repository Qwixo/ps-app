// Left out of the public source: private release notes. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { version: "", notes: [] };
const _v1: any = [];
const _v2: any = [];
export function cleanPrivateNotes(_p0?: any, ..._more: any[]): { [k: string]: any; version: any; notes: any[] } { return _v0; }
export function versionOf(_p0?: any, ..._more: any[]): string { return ""; }
export function privateNotesFor(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): any[] { return _v1; }
export function privateNotesPlan(_p0?: any, _p1?: any, ..._more: any[]): any { return undefined; }
export function recentPrivate<_F0 = any>(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v2; }
export type PrivateNotes = { [k: string]: any; version: any; notes: any[] };
export const PRIVATE_LABEL: "For you" = "For you";
export const MAX_PRIVATE: number = 0;
export function badNote(_p0?: any, ..._more: any[]): boolean { return false; }
