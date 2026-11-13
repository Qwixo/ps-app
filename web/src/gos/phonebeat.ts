// This phone tells the account it exists (V1.56 phone layout editor, core/phonedevices.ts): one tiny encrypted record
// with its kind, a name ("Pixel 8"), its screen size and when it was last open, so the Mac's Edit mode knows which
// phones you have and draws each at its real shape. Written only when something changed or once a day.
import { useEffect } from "react";
import { beatPhoneDev } from "../core/actions";
import { androidName } from "../core/phonedevices";
import type { PhoneKind } from "../core/phonelayout";

const KEY = "ps.phone.dev";
/** This phone's own id: random, kept in this phone's storage (never anything that identifies the hardware). */
function devId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && /^[a-z0-9]{16}$/.test(v)) return v;
  } catch { /* storage off */ }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const id = Array.from(b, (x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
  try { localStorage.setItem(KEY, id); } catch { /* storage off: a new id each time, the Mac then lists it once more */ }
  return id;
}
/** The name shown in the Mac's picker. device: the GOS shell's "maker|model". */
export function phoneDevName(kind: PhoneKind, device: string, ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  if (kind === "gos") { const [mk = "", md = ""] = device.split("|"); return androidName(mk, md); }
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android phone";
  return "iPhone";
}
export function usePhoneBeat(kind: PhoneKind, owner: boolean, visible: boolean, device: string) {
  useEffect(() => {
    if (!owner || !visible) return;
    const t = window.setTimeout(() => {
      const w = Math.round(window.screen?.width || window.innerWidth), h = Math.round(window.screen?.height || window.innerHeight);
      void beatPhoneDev({ dev: devId(), phone: kind, name: phoneDevName(kind, device), w: Math.min(w, h), h: Math.max(w, h) }).catch(() => {});
    }, 4000);   // after the first sync, so an older record of this phone is known and not written twice
    return () => window.clearTimeout(t);
  }, [kind, owner, visible, device]);
}
