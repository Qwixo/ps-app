// The app's name (core/appname.ts, V1.36): tidying and checking a typed name the way PS does (ps-mac
// Sources/AppName.swift has the same rules and words), what the pages accept from the Mac shell, the default "PS app"
// everywhere else, and the macOS list hint. Run: node --experimental-strip-types tests/appname.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { APP_NAME_MAX, DEFAULT_APP_NAME, PUBLIC_APP_NAME, appName, appNameProblem, cleanAppName, macListHint, tidyAppName } from "../src/core/appname.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("the default, private and public, is exactly 'PS app' (V1.49)", () => {
  assert.equal(PUBLIC_APP_NAME, "PS app");
  assert.equal(DEFAULT_APP_NAME, "PS app");
  assert.ok(!/[\u2013\u2014]/.test(PUBLIC_APP_NAME));
  assert.equal(appNameProblem(PUBLIC_APP_NAME), null);
});

ok("tidy: ends trimmed, runs of spaces made one, a typed .app dropped", () => {
  assert.equal(tidyAppName("  My   List  "), "My List");
  assert.equal(tidyAppName("My List.app"), "My List");
  assert.equal(tidyAppName("My List.APP "), "My List");
  assert.equal(tidyAppName(".app"), "");
  assert.equal(tidyAppName("Cafe\u0301"), "Caf\u00e9");   // one standard form for accents
});

ok("problems are said in plain words", () => {
  assert.equal(appNameProblem(""), "Type a name first.");
  assert.match(appNameProblem("a/b")!, /cannot have \/ or :/);
  assert.match(appNameProblem("a:b")!, /cannot have \/ or :/);
  assert.match(appNameProblem(".hidden")!, /cannot start with a dot/);
  assert.match(appNameProblem("tab\there")!, /tabs, line breaks or hidden characters/);
  assert.match(appNameProblem("line\nbreak")!, /tabs, line breaks or hidden characters/);
  assert.match(appNameProblem("zero\u200bwidth")!, /hidden characters/);
  assert.match(appNameProblem("x".repeat(APP_NAME_MAX + 1))!, /too long/);
  assert.equal(appNameProblem("x".repeat(APP_NAME_MAX)), null);
  for (const good of ["PS", "My List - test", "Liste de t\u00e2ches", "Задачи", "To-do (work)", "A & B"]) assert.equal(appNameProblem(good), null, good);
});

ok("the pages take the shell's name only when PS could have made it", () => {
  assert.equal(cleanAppName("My Tasks"), "My Tasks");   // a name a person picked is kept
  assert.equal(cleanAppName("PS app"), "PS app");
  assert.equal(cleanAppName("PS"), "PS app");   // older versions: the folder PS.app was never a choice
  assert.equal(cleanAppName("To Do List - by Cincee"), "PS app");   // the V1.36 public default
  assert.equal(cleanAppName("ps"), "PS app");
  assert.equal(cleanAppName(undefined), "PS app");
  assert.equal(cleanAppName(42), "PS app");
  assert.equal(cleanAppName(""), "PS app");
  assert.equal(cleanAppName("a/b"), "PS app");
  assert.equal(cleanAppName("  padded "), "PS app");
  assert.equal(cleanAppName("x".repeat(61)), "PS app");
});

ok("outside the Mac app (no window, no shell) the name is PS app and there is no hint", () => {
  assert.equal(appName(), "PS app");
  assert.equal(macListHint(), "");
  assert.equal(macListHint("My List"), " (macOS may list it as PS app)");
});

// ps-mac next to this checkout (PS_MAC_DIR for a worktree): the Mac says the same words. Skipped when it is not there.
const macDir = process.env.PS_MAC_DIR || new URL("../../mac", import.meta.url).pathname;
if (existsSync(`${macDir}/Sources/AppName.swift`)) {
  ok("the same words as AppName.swift (the Mac checks again with them)", () => {
    const swift = readFileSync(`${macDir}/Sources/AppName.swift`, "utf8");
    for (const w of ["Type a name first.", "A name cannot have / or : in it.", "A name cannot start with a dot.", "A name cannot have tabs, line breaks or hidden characters in it.",
      "To Do List - by Cincee", "static let maxLength = 60"]) assert.ok(swift.includes(w), w);
  });
} else console.log("skip - AppName.swift not found next to this checkout (set PS_MAC_DIR)");

console.log(`appname: ${n} ok`);
