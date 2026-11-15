// "The camera is off" on the phone (PS 1.60, phone fixes). The old message told people to look in Settings, Apps, PS,
// Permissions, Camera, but on GrapheneOS the camera switch is in a different place and the page cannot open it. The page
// now says the real path and shows a button that opens PS app's own settings page (the shell's "perm" message,
// which "app" opens: gos/bridge.ts, MainActivity.openPermission).
//
// Run: node --experimental-strip-types tests/camerahelp.test.ts

/** The reason a camera did not open, from the browser's error name. */
export type CamWhy = "denied" | "nocamera" | "busy" | "other";

export function camWhy(errName: unknown): CamWhy {
  const n = typeof errName === "string" ? errName : "";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "nocamera";
  if (n === "NotReadableError" || n === "AbortError") return "busy";
  if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError") return "denied";
  return "other";
}

/** The sentence under the camera when it is off. `app` is the name of this app (Settings can rename it). */
export function cameraOffText(app: string, typeInstead: string): string {
  return `The camera is off for ${app}. Open ${app}'s settings, tap Permissions, then Camera, and choose Allow only while using the app. On GrapheneOS the same place is Settings, Apps, ${app}, Permissions, Camera. ${typeInstead}`;
}

/** The label of the button that opens this app's own settings page. */
export const CAMERA_BUTTON = "Open camera settings";
