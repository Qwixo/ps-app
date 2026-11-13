// Left out of the public source: Numerology. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { y: 0, m: 0, d: 0 };
const _v1: any = { universal: { parts: [], sum: 0, value: 0 }, year: { parts: [], sum: 0, value: 0 }, month: { parts: [], sum: 0, value: 0 }, day: { parts: [], sum: 0, value: 0 } };
const _v2: any = { year: 0, month: 0, day: 0 };
const _v3: any = [];
const _v4: any = [];
const _v5: any = [];
const _v6: any = [];
export function reduce(_p0?: any, ..._more: any[]): number { return 0; }
export function parseYmd(_p0?: any, ..._more: any[]): { [k: string]: any; y: any; m: any; d: any } { return _v0; }
export function addDays(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function mondayOf(_p0?: any, ..._more: any[]): string { return ""; }
export function addMonths(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function daysBetween(_p0?: any, _p1?: any, ..._more: any[]): number { return 0; }
export function howFar(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function cycles(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; universal: { [k: string]: any; parts: any[]; sum: any; value: any }; year: { [k: string]: any; parts: any[]; sum: any; value: any }; month: { [k: string]: any; parts: any[]; sum: any; value: any }; day: { [k: string]: any; parts: any[]; sum: any; value: any } } { return _v1; }
export function personalNumbers(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; year: any; month: any; day: any } { return _v2; }
export function yearMap(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v3; }
export function ageOn(_p0?: any, _p1?: any, ..._more: any[]): number { return 0; }
export function isBirthday(_p0?: any, _p1?: any, ..._more: any[]): boolean { return false; }
export function daysToBirthday(_p0?: any, _p1?: any, ..._more: any[]): number { return 0; }
export function cleanPeople(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v4; }
export function peopleOf(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v5; }
export function mergePeople(_p0?: any, _p1?: any, _p2?: (...a: any[]) => any, ..._more: any[]): any[] { return _v6; }
export type Part = { [k: string]: any; k: any; v: any; from?: any };
export type Step = { [k: string]: any; parts: any[]; sum: any; value: any };
export type Cycles = { [k: string]: any; universal: { [k: string]: any; parts: any[]; sum: any; value: any }; year: { [k: string]: any; parts: any[]; sum: any; value: any }; month: { [k: string]: any; parts: any[]; sum: any; value: any }; day: { [k: string]: any; parts: any[]; sum: any; value: any } };
export type Ymd = { [k: string]: any; y: any; m: any; d: any };
export function isLeap(_p0?: any, ..._more: any[]): boolean { return false; }
export function daysIn(_p0?: any, _p1?: any, ..._more: any[]): number { return 0; }
export function ymdIso(_p0?: any, ..._more: any[]): string { return ""; }
export function localIso(_p0?: { [k: string]: any; toString?: (...a: any[]) => any; toDateString?: (...a: any[]) => any; toTimeString?: (...a: any[]) => any; toLocaleString?: (...a: any[]) => any; toLocaleDateString?: (...a: any[]) => any; toLocaleTimeString?: (...a: any[]) => any; valueOf?: (...a: any[]) => any; getTime?: (...a: any[]) => any; getFullYear?: (...a: any[]) => any; getUTCFullYear?: (...a: any[]) => any; getMonth?: (...a: any[]) => any; getUTCMonth?: (...a: any[]) => any; getDate?: (...a: any[]) => any; getUTCDate?: (...a: any[]) => any; getDay?: (...a: any[]) => any; getUTCDay?: (...a: any[]) => any; getHours?: (...a: any[]) => any; getUTCHours?: (...a: any[]) => any; getMinutes?: (...a: any[]) => any; getUTCMinutes?: (...a: any[]) => any; getSeconds?: (...a: any[]) => any; getUTCSeconds?: (...a: any[]) => any; getMilliseconds?: (...a: any[]) => any; getUTCMilliseconds?: (...a: any[]) => any; getTimezoneOffset?: (...a: any[]) => any; setTime?: (...a: any[]) => any; setMilliseconds?: (...a: any[]) => any; setUTCMilliseconds?: (...a: any[]) => any; setSeconds?: (...a: any[]) => any; setUTCSeconds?: (...a: any[]) => any; setMinutes?: (...a: any[]) => any; setUTCMinutes?: (...a: any[]) => any; setHours?: (...a: any[]) => any; setUTCHours?: (...a: any[]) => any; setDate?: (...a: any[]) => any; setUTCDate?: (...a: any[]) => any; setMonth?: (...a: any[]) => any; setUTCMonth?: (...a: any[]) => any; setFullYear?: (...a: any[]) => any; setUTCFullYear?: (...a: any[]) => any; toUTCString?: (...a: any[]) => any; toISOString?: (...a: any[]) => any; toJSON?: (...a: any[]) => any; getVarDate?: (...a: any[]) => any }, ..._more: any[]): string { return ""; }
export type Numbers = { [k: string]: any; year: any; month: any; day: any };
export type NumPerson = { [k: string]: any; id: any; name: any; birthday: any; me?: any };
export type Meaning = { [k: string]: any; title: any; text: any; more: any; avoid: any };
export const YEAR: any = inert;
export const MONTH: any = inert;
export const DAY: any = inert;
export const MONTH_TAG: any = inert;
export const MEANING: any = inert;
