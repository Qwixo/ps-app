// Backgrounds per device (PS 1.65): this device tells the account it exists, so Settings, Looks can list it by name
// (core/devicebg.ts). One tiny encrypted record, written when new, changed, or once a day: nothing polls. Only on the page
// that holds the vault (the website, the Mac's main page, the phone), only signed in and unlocked, only with the feature on.
import { vaultStore } from "./core/vault";
import { beatDevice } from "./core/actions";
import { uaName } from "./core/devicebg";
import { deviceBgOn, thisDevId, thisKind } from "./devicebgnow";

let hint = "";
/** The phone app gives its model name ("Pixel 8") for a better default name than "Android phone". */
export function setDeviceNameHint(name: string) { hint = name; }

let started = false, timer: number | undefined, done = "", doneAt = 0;
export function startDeviceBeat(): void {
  if (started) return;
  started = true;
  const check = () => {
    const s = vaultStore.get();
    if (s.status !== "unlocked" || s.role !== "owner" || !s.lastSync || !deviceBgOn() || document.visibilityState === "hidden") return;
    const kind = thisKind(), name = hint || uaName(kind, typeof navigator === "undefined" ? "" : navigator.userAgent);
    const key = `${kind}|${name}`;
    if ((key === done && Date.now() - doneAt < 20 * 3600e3) || timer !== undefined) return;   // beatDevice itself writes only when due
    // After the first sync, so an older record of this device is known and not written twice.
    timer = window.setTimeout(() => {
      timer = undefined;
      void beatDevice({ dev: thisDevId(), kind, name }).then(() => { done = key; doneAt = Date.now(); }).catch(() => {});
    }, 4000);
  };
  vaultStore.subscribe(check);
  document.addEventListener("visibilitychange", check);
  check();
}
