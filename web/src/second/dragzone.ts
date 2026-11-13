// Left out of the public source: Second Computer. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = {  };
export function useDropOver(..._more: any[]): string { return ""; }
export function dropPlace(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any;  } { return _v0; }
export function onDroppedText(_p0?: (...a: any[]) => any, ..._more: any[]): (..._more: any[]) => void { return (..._a: any[]) => undefined; }
export function installDropZones(..._more: any[]): void { return undefined; }
export function canNative(_p0?: any, ..._more: any[]): boolean { return false; }
