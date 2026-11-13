// Run: node --experimental-strip-types tests/setuphook.test.ts
// The setup menu's door (G Squad, V1.40, core/setuphook.ts): PS fires "ps:open-setup" after its "See what's new and
// set it up" click; a listener opens the menu and the What's new fallback stays away; the generation PS is told is
// always a plain small number.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/setuphook.ts";
import { SETUP_GEN, setupAsked } from "../src/core/welcome.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

ok("the event is ps:open-setup", () => assert.equal(S.SETUP_EVENT, "ps:open-setup"));

ok("nobody listening: not handled, so the fallback opens", () => {
  assert.equal(S.fireSetup(new EventTarget(), "update"), false);
});

ok("a listener opens it and gets where it came from", () => {
  const t = new EventTarget();
  const got: string[] = [];
  const off = S.listenSetup(t, (d) => got.push(d.from));
  assert.equal(S.fireSetup(t, "update"), true);
  assert.deepEqual(got, ["update"]);
  off();
  assert.equal(S.fireSetup(t, "menu"), false, "after the undo nothing answers");
  assert.deepEqual(got, ["update"]);
});

ok("a listener of its own that calls preventDefault counts too", () => {
  const t = new EventTarget();
  t.addEventListener(S.SETUP_EVENT, (e) => e.preventDefault());
  assert.equal(S.fireSetup(t, "menu"), true);
});

ok("generations: 1 to 999 whole numbers only", () => {
  assert.equal(S.cleanGen(1), 1);
  assert.equal(S.cleanGen(999), 999);
  for (const bad of [0, -1, 1.5, 1000, "1", null, undefined, NaN]) assert.equal(S.cleanGen(bad), 0, String(bad));
});

ok("where it came from: known words only", () => {
  assert.equal(S.cleanFrom("update"), "update");
  assert.equal(S.cleanFrom("<b>"), "menu");
  assert.equal(S.cleanFrom(undefined), "menu");
});

ok("the Tab list window loads the door and tells PS only from there", () => {
  const mac = read("src/macupdate.ts"), hook = read("src/setuphook.ts");
  assert.match(mac, /import "\.\/setuphook";/);
  assert.match(hook, /__psOpenSetup/);
  assert.match(hook, /if \(OVERLAY && gen\) psPost\(\{ type: "setup:can", gen \}\)/);
});

// V1.40 bug (the developer 7 Nov 2026): nothing on the page answered the door, so PS never offered the setup menu after an
// update and its button opened What's new. The setup menu must register itself in the Tab list window.
ok("the setup menu registers the door in the Tab list window, so PS offers it after an update", () => {
  assert.equal(S.cleanGen(SETUP_GEN), SETUP_GEN, "a generation PS accepts");
  const welcome = read("src/views/Welcome.tsx"), app = read("src/views/PsApp.tsx");
  assert.match(welcome, /registerSetup\(onSetupAsked, \{ gen: SETUP_GEN \}\)/);
  const overlay = app.slice(app.indexOf("export function PsOverlay"), app.indexOf("function OverlayLocked"));
  assert.match(overlay, /const unDoor = startSetupDoor\(\);/, "PsOverlay starts the door");
  assert.match(overlay, /unDoor\(\);/, "and stops it on the way out");
  assert.doesNotMatch(overlay.slice(overlay.indexOf("if (s.status !== \"unlocked\")")), /startSetupDoor/, "not only when unlocked");
});

ok("the update card's click opens the menu as the update offer; one already open stays as it is", () => {
  assert.deepEqual(setupAsked(false, "update"), { update: true });
  assert.deepEqual(setupAsked(false, "menu"), { update: false });
  assert.deepEqual(setupAsked(false, "test"), { update: false });
  assert.equal(setupAsked(true, "update"), null);
  // The whole path: the menu's listener answers, so the What's new fallback stays away.
  const t = new EventTarget();
  const opened: boolean[] = [];
  S.listenSetup(t, (d) => { const a = setupAsked(false, d.from); if (a) opened.push(a.update); });
  assert.equal(S.fireSetup(t, "update"), true);
  assert.deepEqual(opened, [true]);
});

ok("no long dashes in the door's files", () => {
  for (const f of ["src/core/setuphook.ts", "src/setuphook.ts", "src/views/Welcome.tsx", "src/views/PsApp.tsx"]) assert.doesNotMatch(read(f), /[–—]/, f);
});

console.log(`setuphook: ${n} passed`);
