// Run: node --experimental-strip-types tests/audiomode.test.ts
// Headphones mode (src/core/audiomode.ts, V1.40): the synced preferences (settings.tmAudio), the list edits in the
// mixer pop-up, and the checks on what the Mac sends. FICTIONAL devices.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const A = await import("../src/core/audiomode.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const pods = { uid: "A0-B1:output", name: "Sam's AirPods Max", alive: true, hp: true, builtin: false };
const spk = { uid: "BuiltInSpeakerDevice", name: "MacBook Air Speakers", alive: true, hp: false, builtin: true };
const sony = { uid: "C0-D1:output", name: "WH-1000XM5", alive: false, hp: true, builtin: false };

ok("defaults: auto switch off, every list empty", () => {
  assert.deepEqual(A.audioPrefs(undefined), { auto: false, spkOut: [], spkMic: [], hpOut: [], hpMic: [] });
  assert.equal(A.audioPrefs({}).auto, false);
});
ok("cleanAudio keeps known lists only, drops bad and repeated devices, 8 at most", () => {
  const p = A.cleanAudio({ auto: true, hpOut: [{ uid: "a", name: "A" }, { uid: "a", name: "again" }, { uid: "", name: "x" }, { name: "no id" }, 5, { uid: "z".repeat(201) }],
    spkMic: Array.from({ length: 20 }, (_, i) => ({ uid: `m${i}`, name: "M" })), other: [1], spkOut: "nope" });
  assert.equal(p.auto, true);
  assert.deepEqual(p.hpOut, [{ uid: "a", name: "A" }]);
  assert.equal(p.spkMic.length, 8);
  assert.deepEqual(p.spkOut, []);
  assert.equal("other" in p, false);
  assert.equal(A.cleanAudio({ auto: "yes" }).auto, false);
  assert.equal(A.cleanAudio({ hpOut: [{ uid: "a", name: "n".repeat(300) }] }).hpOut[0].name.length, 100);
});
ok("add, move up and remove keep the order the person chose", () => {
  let p = A.audioPrefs(undefined);
  p = A.addTo(p, "hpOut", pods);
  p = A.addTo(p, "hpOut", sony);
  p = A.addTo(p, "hpOut", pods);                       // a repeat is ignored
  assert.deepEqual(p.hpOut.map((r) => r.uid), [pods.uid, sony.uid]);
  p = A.moveUp(p, "hpOut", sony.uid);
  assert.deepEqual(p.hpOut.map((r) => r.uid), [sony.uid, pods.uid]);
  assert.equal(A.moveUp(p, "hpOut", sony.uid), p, "the first one stays first");
  p = A.removeFrom(p, "hpOut", sony.uid);
  assert.deepEqual(p.hpOut.map((r) => r.uid), [pods.uid]);
  let q = A.audioPrefs(undefined);
  for (let i = 0; i < 12; i++) q = A.addTo(q, "spkMic", { uid: `m${i}`, name: "M" });
  assert.equal(q.spkMic.length, A.AUDIO_MAX);
});
ok("pickNow: the first connected device in the order, matched by id, else by name", () => {
  const refs = [{ uid: sony.uid, name: sony.name }, { uid: "other-mac", name: pods.name }];
  assert.equal(A.pickNow(refs, [spk, sony, pods])?.uid, pods.uid, "an asleep first choice is skipped, the second is found by name");
  assert.equal(A.pickNow([], [spk]), null);
});
ok("each mode has its own lists", () => {
  assert.deepEqual(A.listsFor("speakers"), { out: "spkOut", mic: "spkMic" });
  assert.deepEqual(A.listsFor("headphones"), { out: "hpOut", mic: "hpMic" });
});
ok("the Mac's state is checked before the page uses it", () => {
  assert.equal(A.cleanAudioState(null), null);
  assert.equal(A.cleanAudioState({ mode: "loud" }), null);
  const s = A.cleanAudioState({ mode: "headphones", auto: true, note: 3, outs: [pods, { uid: 1 }, "x"], ins: "no", out: pods.uid, mic: null });
  assert.ok(s);
  assert.equal(s!.mode, "headphones");
  assert.equal(s!.note, "");
  assert.deepEqual(s!.outs.map((d) => d.uid), [pods.uid]);
  assert.deepEqual(s!.ins, []);
  assert.equal(s!.mic, "");
});
ok("the Tab list saves it through the looks path and it reaches the Mac (ps.ts, audiomode.ts)", () => {
  const ps = readFileSync(new URL("../src/ps.ts", import.meta.url), "utf8");
  assert.match(ps, /o\.tmAudio = cleanAudio\(p\.tmAudio\)/);
  assert.match(ps, /startAudioMode\(psPost\)/);
  const am = readFileSync(new URL("../src/audiomode.ts", import.meta.url), "utf8");
  assert.match(am, /type: "hpmode", op: "prefs"/);
});
console.log(`audiomode: ${n} passed`);
