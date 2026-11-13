// Run: node --experimental-strip-types tests/updateface.test.ts
// The update card on the Tab list (core/updateface.ts): what it shows, Later for one hold, "Updated to" once.
import { doneNotes, faceFor, faceKey } from "../src/core/updateface.ts";
import type { MacUpdate } from "../src/core/macupdate.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const free = { later: null, blocked: false };
const avail: MacUpdate = { state: "available", version: "V1.40", keyword: "Squad", kind: "app", size: 24_000_000, notes: ["One.", "Two."] };

ok("offer when an update waits", faceFor(avail, free) === "offer");
ok("later hides it for this hold", faceFor(avail, { later: faceKey(avail), blocked: false }) === null);
ok("next hold (later cleared) shows it again", faceFor(avail, free) === "offer");
ok("later on one update never hides a newer one", faceFor({ ...avail, version: "V1.41" }, { later: faceKey(avail), blocked: false }) === "offer");
ok("web and app of the same version are different updates", faceKey(avail) !== faceKey({ ...avail, kind: "web" }));
for (const s of ["downloading", "verifying", "installing", "ready", "relaunching"] as const) {
  ok(`progress while ${s}`, faceFor({ ...avail, state: s }, free) === "progress");
  ok(`progress while ${s} even after Later`, faceFor({ ...avail, state: s }, { later: faceKey(avail), blocked: false }) === "progress");
}
ok("done once: unseen shows", faceFor({ state: "done", current: "V1.40", unseen: true }, free) === "done");
ok("done once: seen stays away", faceFor({ state: "done", current: "V1.40", unseen: false }, free) === null);
ok("stopped once: unseen shows", faceFor({ state: "error", error: "x", unseen: true }, free) === "error");
ok("stopped once: seen stays away", faceFor({ state: "error", error: "x" }, free) === null);
for (const s of ["idle", "checking", "none"] as const) ok(`nothing while ${s}`, faceFor({ state: s }, free) === null);
ok("waits for the tour or Settings", faceFor(avail, { later: null, blocked: true }) === null);
ok("waits for the tour even when done", faceFor({ state: "done", unseen: true }, { later: null, blocked: true }) === null);

const b = { version: "1.40", notes: ["A.", "B."] };
ok("done lists this version's notes", JSON.stringify(doneNotes("V1.40", b)) === JSON.stringify(["A.", "B."]));
ok("never another version's notes", doneNotes("V1.41", b).length === 0);
ok("no notes without a bundle", doneNotes("V1.40", null).length === 0);
ok("no notes without a version", doneNotes(undefined, b).length === 0);

console.log(`updateface: ${n - fails}/${n} passed`);
if (fails) process.exit(1);
