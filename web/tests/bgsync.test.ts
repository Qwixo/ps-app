// Run: node --experimental-strip-types tests/bgsync.test.ts
// The developer's background videos from his Drive folder (4 Nov 2026, src/core/bgsync.ts): the twin match so a
// video goes into the vault once, a changed file is a new version, error codes and the copy text
// (nothing secret), one card per problem, the wait after failures, the phone's resumed download and
// the 12 hour check. FICTIONAL ids and names only.
import assert from "node:assert/strict";
const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
const B = await import("../src/core/bgsync.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const vid = (id: string, x: Record<string, unknown> = {}) => ({ id, name: "Clip " + id, bytes: 1000, pieces: [id + "-a", id + "-b"], ...x });

ok("a folder video is marked with its file version", () => {
  assert.equal(B.driveFrom({ id: "clip-2", sig: "33672504-1762222320" }), "drive:clip-2:33672504-1762222320");
  assert.equal(B.driveFrom({ id: "clip-1" }), "mac:clip-1");
});

ok("the same file version is a twin: never put in twice", () => {
  const list = [vid("clip-2", { from: "drive:clip-2:100-5" })];
  assert.equal(B.twinOf(list, { id: "clip-2", name: "Clip clip-2", size: 1000, sig: "100-5" })?.id, "clip-2");
});

ok("a changed file (new size or date) is not a twin: its new version goes in", () => {
  const list = [vid("clip-2", { from: "drive:clip-2:100-5" })];
  assert.equal(B.twinOf(list, { id: "clip-2", name: "Clip clip-2", size: 1000, sig: "120-9" }), undefined);
});

ok("a folder video never matches by name and size alone (an edit keeps both)", () => {
  const list = [vid("v-abc", { from: "mac:clip-3" })];
  assert.equal(B.twinOf(list, { id: "clip-3", name: "Clip v-abc", size: 1000, sig: "1-1" }), undefined);
});

ok("an older copy without a version still matches the old way", () => {
  const list = [vid("clip-1", { from: "mac:clip-1" }), vid("v-x", { name: "Sunset", bytes: 77 })];
  assert.equal(B.twinOf(list, { id: "clip-1", name: "x", size: 5 })?.id, "clip-1");
  assert.equal(B.twinOf(list, { id: "other", name: "Sunset", size: 77 })?.id, "v-x");
});

ok("a video the developer added with Add video is its own: never a twin of a folder video", () => {
  const o = { id: "my-clip-a1b2c3", name: "Clip", size: 1000, added: true };
  assert.equal(B.driveFrom(o), "mac:my-clip-a1b2c3");
  assert.equal(B.twinOf([vid("clip", { from: "drive:clip:1000-5", name: "Other" })], o), undefined);
  assert.equal(B.twinOf([vid("my-clip-a1b2c3", { from: "mac:my-clip-a1b2c3" })], o)?.id, "my-clip-a1b2c3", "put in before: only marked");
});

ok("a full vault is BG-QUOTA, anything else BG-UPLOAD", () => {
  assert.equal(B.uploadCode({ message: "cannot execute INSERT in a read-only transaction", code: "25006" }), "BG-QUOTA");
  assert.equal(B.uploadCode(new Error("Payload too large")), "BG-QUOTA");
  assert.equal(B.uploadCode({ message: "Failed to fetch" }), "BG-UPLOAD");
  assert.equal(B.uploadCode(null), "BG-UPLOAD");
});

ok("Supabase errors (plain objects) keep their message and code, short", () => {
  assert.equal(B.errText({ message: "JWT expired", code: "PGRST301" }), "JWT expired (PGRST301)");
  assert.equal(B.errText("x".repeat(500)).length, 120);
  assert.equal(B.errText(undefined), "unknown");
});

ok("after failures it waits 30 min, 1 h, 2 h ... at most 12 h", () => {
  assert.equal(B.backoffMs(0), 0);
  assert.equal(B.backoffMs(1), 30 * 60_000);
  assert.equal(B.backoffMs(2), 60 * 60_000);
  assert.equal(B.backoffMs(3), 120 * 60_000);
  assert.equal(B.backoffMs(20), 12 * 3600_000);
});

ok("every problem has a plain sentence, no dashes", () => {
  for (const c of ["BG-QUOTA", "BG-UPLOAD", "BG-REMOVE", "BG-VAULT-MISSING", "BG-DOWNLOAD", "BG-OTHER"]) {
    const p = B.problem(c, "Clip two", "d");
    assert.ok(p.text.length > 10 && p.text.length < 200, c);
    assert.ok(!/[\u2013\u2014]/.test(p.text), c + " has a dash");
    assert.equal(p.code, c);
  }
});

ok("one card per problem: a Dismiss holds until the problem changes", () => {
  const p = B.problem("BG-DOWNLOAD", "Clip two", "stopped");
  assert.equal(B.showable(p, null), true);
  assert.equal(B.showable(p, B.problemKey(p)), false);
  assert.equal(B.showable({ ...p, detail: "stopped again at 13:00" }, B.problemKey(p)), false, "only the detail changed: still dismissed");
  assert.equal(B.showable(B.problem("BG-DOWNLOAD", "Clip three", "x"), B.problemKey(p)), true, "another video: shows again");
  assert.equal(B.showable(B.problem("BG-QUOTA", "Clip two", "x"), B.problemKey(p)), true, "another problem: shows again");
  assert.equal(B.showable(null, null), false);
});

ok("the copied error code: code, device, time, details; nothing secret", () => {
  const p = B.problem("BG-DOWNLOAD", "Clip two", "downloading \"Clip two\" stopped 2 times in a row: Failed to fetch");
  const t = B.report(p, { device: "Phone", version: "V1.31", at: new Date("2026-11-04T02:30:00.123Z"), videos: 2, here: 1, lastOk: "2026-11-03T20:00:00Z" });
  assert.match(t, /^PS error code BG-DOWNLOAD\n/);
  assert.match(t, /Device: Phone, PS V1\.31/);
  assert.match(t, /When: 2026-11-04T02:30:00Z/);
  assert.match(t, /Videos in the vault: 2, on this device: 1/);
  assert.ok(!/key|token|password|@|\/Users\/|YOUR_SYNC_FOLDER/i.test(t), "nothing secret or private: " + t);
});

ok("a stopped phone download fetches only the pieces it lacks", () => {
  assert.deepEqual(B.piecesToFetch(5, [0, 1, 3]), [2, 4]);
  assert.deepEqual(B.piecesToFetch(3, undefined), [0, 1, 2]);
  assert.deepEqual(B.piecesToFetch(3, [0, 1, 2]), []);
  assert.deepEqual(B.piecesToFetch(2, [7, -1, 1.5, 1]), [0], "nonsense indices are ignored");
});

ok("the 12 hour check finds a video with a lost piece", () => {
  const list = [vid("a"), vid("b")];
  assert.deepEqual(B.brokenVideos(list, new Set(["a-a", "a-b", "b-a"])).map((v) => v.id), ["b"]);
  assert.deepEqual(B.brokenVideos(list, new Set(["a-a", "a-b", "b-a", "b-b"])), []);
});

ok("egress per device for a 16 MB copy is about 21 MB", () => {
  const mb = B.egressPerDevice(16_000_000) / 1e6;
  assert.ok(mb > 21 && mb < 22, String(mb));
});

console.log(`\n${n} checks passed`);

// ---------- V1.33: the phone's own videos ----------
{
  const P = await import("../src/core/bgsync.ts");
  const ok2 = (name: string, fn: () => unknown) => { fn(); console.log("ok -", name); };
  ok2("Add a video takes up to 60 MB, the Mac's vault limit", () => {
    assert.equal(P.ADD_MAX, 60_000_000);
  });
  ok2("Add a video notes are plain and name the video without its file ending", () => {
    assert.equal(P.addNote("big", "Beach walk.mp4", 120), "Beach walk is 120 MB. Videos up to 60 MB can go in your vault: trim it and add it again.");
    assert.equal(P.addNote("bad", "clip.MOV"), "clip does not play on this phone. Pick an mp4 or webm video.");
    assert.equal(P.addNote("done", "Sunset"), "Sunset is your background now, and it is on its way to your Macs.");
    assert.match(P.addNote("failed", ".mp4"), /^That video could not be added/);
    for (const k of ["big", "bad", "done", "failed"] as const) assert.ok(!DASHES.test(P.addNote(k, "x", 1)));
  });
  ok2("the phone offers a video only once the shell lists it as kept", () => {
    assert.deepEqual(P.notKept(["v-a", "v-b"], new Set(["v-a"])), ["v-b"]);
    assert.deepEqual(P.notKept(new Set(["v-a"]), new Set(["v-a", "v-c"])), []);
  });
  const { readFileSync } = await import("node:fs");
  const bv = readFileSync(new URL("../src/core/bgvault.ts", import.meta.url), "utf8");
  ok2("fetchMissing waits for the phone shell, the Mac marks at once", () => {
    assert.match(bv, /if \(onPhone\(\)\) waiting\.add\(v\.id\); else local\.add\(v\.id\);/);
    assert.match(bv, /if \(waiting\.size\) confirmAt = postList\(\);/);
  });
  ok2("a phone add is checked to play, capped, picked as the background, and waits for the shell", () => {
    assert.match(bv, /if \(f\.size > ADD_MAX\)/);
    assert.match(bv, /if \(!\(await playsHere\(f\)\)\)/);
    // V1.47: the phone's own background when it has one (core/bgcrop.ts bgKey), else the shared one as before.
    assert.match(bv, /if \(pick\) patch\[bgKey\(settingsData\(vaultStore\.get\(\)\) as Settings, true, \(b\) => bgDesign\(b\) === b\)\] = `video:\$\{id\}`;/);
    assert.match(bv, /if \(onPhone\(\)\) \{ waiting\.add\(v\.id\); confirmAt = postList\(\); \} else local\.add\(v\.id\);/);
  });
}
