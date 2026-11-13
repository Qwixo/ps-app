// Left out of the public source: Second Computer. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = Promise.resolve(undefined);
const _v1: any = Promise.resolve(undefined);
const _v2: any = Promise.resolve(undefined);
export function phoneKey(..._more: any[]): Promise<any> { return _v0; }
export function signCmd(_p0?: any, _p1?: any, _p2?: any, _p3?: any, ..._more: any[]): Promise<any> { return _v1; }
export type CmdAction = any;
export type PhoneKey = { [k: string]: any; device: any; pub: any };
export type Env = { [k: string]: any; body: any; sig: any; by: any };
export function phoneCode(_p0?: any, _p1?: any, ..._more: any[]): Promise<any> { return _v2; }
