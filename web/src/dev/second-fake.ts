// Left out of the public source: Second Computer. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { docs: [], local: { native: false, me: { device: "", name: "", model: "", pub: "", role: undefined, chip: "", chosen: undefined, app: "", okid: "" }, trusted: [], verified: [], progress: [], projects: [], pairing: "", waitingSince: 0, note: "", previewGets: [], seeks: [], off: { why: "", name: "", model: "", chip: "", app: "", here: "", retried: undefined, allowing: undefined }, outbox: [], ojobs: [], caps: [] } };
export function fakeSecond(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; docs: any[]; local: { [k: string]: any; native: any; me: { [k: string]: any; device: any; name: any; model?: any; pub: any; role: any; chip?: any; chosen?: any; app?: any; okid?: any }; trusted: any[]; verified: any[]; progress: any[]; projects: any[]; pairing: any; waitingSince: any; note: any; previewGets?: any[]; seeks?: any[]; off?: { [k: string]: any; why: any; name: any; model?: any; chip?: any; app?: any; here?: any; retried?: any; allowing?: any }; outbox?: any[]; ojobs?: any[]; caps?: any[] } } { return _v0; }
