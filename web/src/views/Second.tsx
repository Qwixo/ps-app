// Left out of the public source: Second Computer. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = Promise.resolve(undefined);
export function pickFiles(_p0?: any, _p1?: any, _p2?: (...a: any[]) => any, ..._more: any[]): void { return undefined; }
export function fileState(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): string { return ""; }
export function SecondButton(_p0?: any, ..._more: any[]): any { return undefined; }
export function SecondPanel(_p0?: any, ..._more: any[]): any { return undefined; }
export function SecondSettings(..._more: any[]): any { return undefined; }
export type SecondOp = any;
export const secondActions: { [k: string]: any; run: (_p0?: any, ..._more: any[]) => void; drop: (_p0?: { [k: string]: any; arrayBuffer?: (...a: any[]) => any; bytes?: (...a: any[]) => any; slice?: (...a: any[]) => any; stream?: (...a: any[]) => any; text?: (...a: any[]) => any }, ..._more: any[]) => Promise<any>; native: (_p0?: any, ..._more: any[]) => void } = { run: (..._a: any[]) => undefined, drop: (..._a: any[]) => _v0, native: (..._a: any[]) => undefined };
export const DOWNLOAD_LINK: "https://cincee.com/client/ps/PS.dmg" = "https://cincee.com/client/ps/PS.dmg";
