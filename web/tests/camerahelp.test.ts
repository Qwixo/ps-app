// Run: node --experimental-strip-types tests/camerahelp.test.ts
// PS 1.60 phone fixes: Gym scan's camera and the "camera is off" message (core/camerahelp.ts, WebHost.kt, MainActivity.kt).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAMERA_BUTTON, camWhy, cameraOffText } from "../src/core/camerahelp.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

ok("browser errors map to the reason", () => {
  assert.equal(camWhy("NotAllowedError"), "denied"); assert.equal(camWhy("SecurityError"), "denied");
  assert.equal(camWhy("NotFoundError"), "nocamera"); assert.equal(camWhy("NotReadableError"), "busy");
  assert.equal(camWhy(undefined), "other"); assert.equal(camWhy(5), "other");
});
ok("the message gives the real path, names the app and keeps the type it option", () => {
  const m = cameraOffText("PS app", "Or type what the label says.");
  assert.match(m, /^The camera is off for PS app\./); assert.match(m, /Permissions, then Camera/); assert.match(m, /Settings, Apps, PS app, Permissions, Camera/);
  assert.ok(m.endsWith("Or type what the label says."));
  assert.ok(!/[\u2013\u2014]/.test(m));
});
ok("the button opens the app's own settings through the shell", () => {
  assert.equal(CAMERA_BUTTON, "Open camera settings");
  assert.match(read("src/gos/bridge.ts"), /openAppSettings: \(\) => gosPost\(\{ type: "perm", which: "app" \}\)/);
  assert.match(read("src/fitness/Scan.tsx"), /state === "denied" && GOS && <button[\s\S]*?gos\.openAppSettings\(\)/);
});
ok("the phone shell lets the page's own origin use the camera and opens the app's settings page", () => {
  const web = read("../phone/app/src/main/java/com/cincee/ps/gos/WebHost.kt");
  assert.match(web, /"Permissions-Policy" to CameraPolicy\.header\(\)/); assert.ok(!web.includes("camera=()"));
  assert.match(read("../phone/app/src/main/java/com/cincee/ps/gos/CameraPolicy.kt"), /camera=\(self\), microphone=\(\), geolocation=\(\)/);
  assert.match(read("../phone/app/src/main/java/com/cincee/ps/gos/MainActivity.kt"), /"app" -> Intent\(Settings\.ACTION_APPLICATION_DETAILS_SETTINGS, pkg\)/);
});
console.log(`${n} passed`);
