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
const _v3: any = Promise.resolve(undefined);
export function putDrop(_p0?: { [k: string]: any; arrayBuffer?: (...a: any[]) => any; bytes?: (...a: any[]) => any; slice?: (...a: any[]) => any; stream?: (...a: any[]) => any; text?: (...a: any[]) => any }, ..._more: any[]): Promise<any> { return _v0; }
export function takeDrop(_p0?: any, ..._more: any[]): Promise<any> { return _v1; }
export function putPreview(_p0?: any, _p1?: any, ..._more: any[]): Promise<any> { return _v2; }
export function getPreview(_p0?: any, ..._more: any[]): Promise<any> { return _v3; }
export type Preview = { [k: string]: any; name: any; mime: any; bytes: { [k: string]: any; BYTES_PER_ELEMENT: any; buffer: any; byteLength: any; byteOffset: any; copyWithin: (_p0?: any, _p1?: any, _p2?: any, ..._more: any[]) => any; every: (_p0?: any, _p1?: any, ..._more: any[]) => any; fill: (_p0?: any, _p1?: any, _p2?: any, ..._more: any[]) => any; filter: (_p0?: any, _p1?: any, ..._more: any[]) => any; find: (_p0?: any, _p1?: any, ..._more: any[]) => any; findIndex: (_p0?: any, _p1?: any, ..._more: any[]) => any; forEach: (_p0?: any, _p1?: any, ..._more: any[]) => any; indexOf: (_p0?: any, _p1?: any, ..._more: any[]) => any; join: (_p0?: any, ..._more: any[]) => any; lastIndexOf: (_p0?: any, _p1?: any, ..._more: any[]) => any; length: any; map: (_p0?: any, _p1?: any, ..._more: any[]) => any; reduce: (_p0?: any, ..._more: any[]) => any; reduceRight: (_p0?: any, ..._more: any[]) => any; reverse: (..._more: any[]) => any; set: (_p0?: any, _p1?: any, ..._more: any[]) => any; slice: (_p0?: any, _p1?: any, ..._more: any[]) => any; some: (_p0?: any, _p1?: any, ..._more: any[]) => any; sort: (_p0?: any, ..._more: any[]) => any; subarray: (_p0?: any, _p1?: any, ..._more: any[]) => any; toLocaleString: (..._more: any[]) => any; toString: (..._more: any[]) => any; valueOf: (..._more: any[]) => any; entries: (..._more: any[]) => any; keys: (..._more: any[]) => any; values: (..._more: any[]) => any; includes: (_p0?: any, _p1?: any, ..._more: any[]) => any; at: (_p0?: any, ..._more: any[]) => any }; at?: any };
