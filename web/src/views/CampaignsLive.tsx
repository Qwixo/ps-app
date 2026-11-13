// Left out of the public source: Campaigns. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
export function useCampaignsLive(..._more: any[]): any { return inert; }
export function useLiveAuto(_p0?: any, ..._more: any[]): void { return undefined; }
export function LiveRefresh(_p0?: { [k: string]: any; onClick?: (...a: any[]) => any }, ..._more: any[]): any { return null; }
export function LiveStamp(_p0?: any, ..._more: any[]): any { return null; }
export function CampaignsLive(_p0?: any, ..._more: any[]): any { return null; }
