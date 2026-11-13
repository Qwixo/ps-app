// Left out of the public source: Campaigns. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { id: "", data: { blobId: "", size: 0, title: "", updatedAt: "", dataCurrentThrough: "", lastSweepUtc: "", builtAt: "", version: "", tabs: [], storedAt: "" } };
const _v1: any = Promise.resolve(undefined);
const _v2: any = Promise.resolve(undefined);
export function campaignsPageRec(..._more: any[]): { [k: string]: any; id: any; data: { [k: string]: any; blobId: any; size: any; title: any; updatedAt: any; dataCurrentThrough: any; lastSweepUtc: any; builtAt: any; version: any; tabs: any[]; storedAt: any } } { return _v0; }
export function storeCampaignsPage(_p0?: any, ..._more: any[]): Promise<any> { return _v1; }
export function loadCampaignsPage(_p0?: any, ..._more: any[]): Promise<any> { return _v2; }
export function cleanHtml(_p0?: any, ..._more: any[]): any { return undefined; }
export function cleanCss(_p0?: any, ..._more: any[]): string { return ""; }
export type CampaignsPageRec = { [k: string]: any; blobId: any; size: any; title: any; updatedAt: any; dataCurrentThrough: any; lastSweepUtc: any; builtAt: any; version: any; tabs: any[]; storedAt: any };
export type CampaignsPage = { [k: string]: any; schema: any; title: any; html: any; css: any; updatedAt?: any; dataCurrentThrough?: any; lastSweepUtc?: any; builtAt: any; version?: any; tabs?: any[] };
