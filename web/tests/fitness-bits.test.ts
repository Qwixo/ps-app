// Run: node --experimental-strip-types tests/fitness-bits.test.ts
// PS Fitness V1.59 (the developer): the "Abs cable crunch" exercise (found by "abs", "cable", "crunch", with its own kneeling
// picture) and a comment on a done set (saved with the set, merged by the newer copy, sealed with the workout, shown
// in the gym and in History). FICTIONAL data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../src/core/crypto.ts";
import * as F from "../src/core/fitness.ts";
import { LIBRARY, getExercise, searchExercises } from "../src/fitness/library.ts";
import { blend, solve, FLOOR } from "../src/fitness/pic-rig.ts";
import { picFor, scenePattern } from "../src/fitness/pics.ts";

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };

// ---------- the exercise ----------
await ok("Abs cable crunch is in the library once, an abs exercise on the cable, with a form tip", () => {
  const x = getExercise("abs-cable-crunch");
  assert.ok(x);
  assert.equal(x.name, "Abs cable crunch");
  assert.equal(x.equipment, "cable");
  assert.deepEqual(x.muscles, ["abs"]);
  assert.ok(x.cue && /kneel/i.test(x.cue) && /hips still/i.test(x.cue));
  assert.equal(LIBRARY.filter((e) => e.id === "abs-cable-crunch").length, 1);
  assert.equal(new Set(LIBRARY.map((e) => e.id)).size, LIBRARY.length, "ids stay unique");
});

await ok("searching abs, cable, crunch (and a typo, and the full name) finds it", () => {
  for (const q of ["abs", "Abs", "cable", "crunch", "cable crunch", "abs cable crunch", "abs cable crunchs", "kneeling rope crunch", "ab cable crunch"]) {
    assert.ok(searchExercises(q, 10).some((e) => e.id === "abs-cable-crunch"), `"${q}" finds it`);
  }
  assert.equal(searchExercises("abs cable crunch", 5)[0].id, "abs-cable-crunch", "the full name puts it first");
  assert.equal(searchExercises("abs", 5)[0].id, "abs-cable-crunch", "searching abs lists it first");
});

await ok("the existing Cable crunch is left alone", () => {
  assert.equal(getExercise("cable-crunch")?.name, "Cable crunch");
  assert.equal(picFor("cable-crunch", "")?.exercise.id, "cable-crunch");
});

await ok("it has its own kneeling figure: hips stay still while the trunk curls down, rope held, high cable", () => {
  const p = picFor("abs-cable-crunch", "");
  assert.ok(p && p.how === "exact" && scenePattern("abs-cable-crunch") === "crunch");
  const s = p.scene;
  assert.equal(s.hold, "rope");
  assert.ok(s.cable && s.cable[1] <= 12, "the cable comes from high up");
  const a = solve(s.a), b = solve(s.b);
  assert.deepEqual(a.hip, b.hip, "hips do not move");
  assert.ok(Math.abs(a.kn[1] - (FLOOR - 3)) < 4 && a.an[0] < a.kn[0], "kneeling: knee near the floor, shin behind");
  assert.ok(b.neck[1] > a.neck[1] + 15, "the trunk curls down");
  assert.ok(b.head[1] > a.head[1] + 12, "and the head follows");
  // the hands stay by the head the whole way
  const mid = solve(blend(s.a, s.b, 0.5));
  for (const j of [a, mid, b]) assert.ok(Math.hypot(j.grip[0] - j.head[0], j.grip[1] - j.head[1]) < 12, "rope by the head");
  const old = picFor("cable-crunch", "")!.scene;
  assert.notDeepEqual(old.a, s.a, "its own picture, not the old one");
});

await ok("a name typed the same way finds the picture", () => {
  assert.equal(picFor(null, "Abs cable crunch")?.exercise.id, "abs-cable-crunch");
});

// ---------- the comment ----------
const T0 = "2026-11-14T08:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const fresh = (): F.FitWorkout => ({
  programId: null, dayId: null, dayName: "Free workout", week: 1, date: "2026-11-14", startedAt: T0, endedAt: null, at: T0, device: "phone",
  exercises: [{ id: "e1", exId: "abs-cable-crunch", name: "Abs cable crunch", at: T0, order: 0, sets: [
    { id: "s1", kg: 25, reps: 11, rir: null, done: false, at: T0 },
    { id: "s2", kg: 20, reps: 11, rir: null, done: false, at: T0 },
  ] }],
});
const set = (w: F.FitWorkout, id: string) => w.exercises[0].sets.find((s) => s.id === id)!;

await ok("cleanComment: one line, trimmed, cut at the limit, empty stays empty", () => {
  assert.equal(F.cleanComment("  left knee   felt off \n"), "left knee felt off");
  assert.equal(F.cleanComment("seat at 4"), "seat at 4");
  assert.equal(F.cleanComment(null), "");
  assert.equal(F.cleanComment(undefined), "");
  assert.equal(F.cleanComment("   "), "");
  assert.equal(F.cleanComment("x".repeat(500)).length, F.COMMENT_MAX);
  assert.equal(F.COMMENT_MAX, 200);
});

await ok("a comment is saved on the set, the set moves forward in time, other sets are untouched", () => {
  let w = F.patchSet(fresh(), "e1", "s1", { done: true, rir: 2 }, at(5));
  w = F.setComment(w, "e1", "s1", "  Left knee felt off ", at(6));
  assert.equal(set(w, "s1").comment, "Left knee felt off");
  assert.equal(set(w, "s1").at, at(6));
  assert.equal(set(w, "s1").done, true);
  assert.equal(set(w, "s1").rir, 2);
  assert.equal(set(w, "s1").kg, 25);
  assert.equal("comment" in set(w, "s2"), false);
  assert.equal(set(w, "s2").at, T0);
});

await ok("changing and clearing: empty text takes the field out, nothing else changes", () => {
  let w = F.patchSet(fresh(), "e1", "s1", { done: true }, at(5));
  w = F.setComment(w, "e1", "s1", "seat at 4", at(6));
  w = F.setComment(w, "e1", "s1", "seat at 5", at(7));
  assert.equal(set(w, "s1").comment, "seat at 5");
  w = F.setComment(w, "e1", "s1", "   ", at(8));
  assert.equal("comment" in set(w, "s1"), false);
  assert.equal(set(w, "s1").at, at(8));
  assert.equal(set(w, "s1").done, true);
});

await ok("the comment survives un-ticking, a rep change and a drop in the plan's numbers", () => {
  let w = F.patchSet(fresh(), "e1", "s1", { done: true }, at(5));
  w = F.setComment(w, "e1", "s1", "grip slipped", at(6));
  w = F.patchSet(w, "e1", "s1", { reps: 9 }, at(7));
  w = F.patchSet(w, "e1", "s1", { done: false }, at(8));
  assert.equal(set(w, "s1").comment, "grip slipped");
  assert.equal(set(w, "s1").reps, 9);
});

await ok("a comment never feeds next time's numbers, bests or the set line", () => {
  let w = F.patchSet(fresh(), "e1", "s1", { done: true, rir: 1 }, at(5));
  w = F.setComment(w, "e1", "s1", "felt off", at(6));
  assert.equal(F.setLine(set(w, "s1")), "25 kg x 11 · RIR 1");
  const next = F.prefillSets({ exId: "abs-cable-crunch", name: "Abs cable crunch", sets: [] }, [{ id: "w1", data: w }], at(60), null, 2);
  assert.ok(next.every((s) => !("comment" in s)));
});

await ok("two devices: the newer copy of a set keeps its comment, an older comment never beats a newer edit", () => {
  const base = F.patchSet(fresh(), "e1", "s1", { done: true }, at(5));
  const phone = F.setComment(base, "e1", "s1", "seat at 4", at(10));
  const mac = F.patchSet(base, "e1", "s1", { kg: 27.5 }, at(8));
  const m1 = F.mergeWorkout(phone, mac), m2 = F.mergeWorkout(mac, phone);
  for (const m of [m1, m2]) { assert.equal(set(m, "s1").comment, "seat at 4"); }
  // the Mac clears it later: the clear wins over the older comment
  const cleared = F.setComment(phone, "e1", "s1", "", at(12));
  for (const m of [F.mergeWorkout(phone, cleared), F.mergeWorkout(cleared, phone)]) assert.equal("comment" in set(m, "s1"), false);
  // a comment on one set and a tick on the other both survive
  const a = F.setComment(base, "e1", "s1", "left knee", at(9));
  const b = F.patchSet(base, "e1", "s2", { done: true, rir: 3 }, at(9));
  const m = F.mergeWorkout(a, b);
  assert.equal(set(m, "s1").comment, "left knee");
  assert.equal(set(m, "s2").done, true);
});

await ok("sealed: the comment is inside the encrypted workout, never in plain text, and loads back", async () => {
  let w = F.patchSet(fresh(), "e1", "s1", { done: true, rir: 2 }, at(5));
  w = F.setComment(w, "e1", "s1", "left knee felt off, seat at 4", at(6));
  const key = await C.newAesKey();
  const id = crypto.randomUUID();
  const blob = await C.encryptJson(key, { kind: "fwork", data: w }, C.aad.record(id, null));
  assert.ok(!blob.includes("knee") && !Buffer.from(blob, "base64url").toString("latin1").includes("knee"), "no plain text in what is stored");
  const back = await C.decryptJson<{ kind: string; data: F.FitWorkout }>(key, blob, C.aad.record(id, null));
  assert.equal(back.kind, "fwork");
  assert.equal(set(back.data, "s1").comment, "left knee felt off, seat at 4");
  assert.deepEqual(back.data, w);
  await assert.rejects(C.decryptJson(key, blob, C.aad.record(crypto.randomUUID(), null)), "moved to another record must fail");
});

await ok("a comment never goes to the G Squad: the squad copies only kg, reps and the drop tag of each set", () => {
  const t = readFileSync(new URL("../src/core/gymsquad.ts", import.meta.url), "utf8");
  assert.ok(/\[s\.kg \?\? null, s\.reps \?\? null, s\.drop \? 1 : 0\]/.test(t));
  assert.ok(!/s\.comment/.test(t));
});

await ok("the screens: a comment button on done sets, the line under the set, History view and edit, Esc and Back, no dashes", () => {
  const rd = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const gym = rd("src/fitness/Gym.tsx"), cm = rd("src/fitness/SetComment.tsx"), hist = rd("src/fitness/History.tsx"), store = rd("src/fitness/store.ts");
  assert.ok(/s\.done && <CommentBtn/.test(gym), "the button only shows on a done set");
  assert.ok(/s\.comment \? <CommentLine/.test(gym), "the comment shows under the set");
  assert.ok(/CommentBox/.test(gym));
  assert.ok(/e\.key === "Escape"/.test(cm) && /gos-back/.test(cm), "Esc and Back close the box");
  assert.ok(/stopImmediatePropagation/.test(cm));
  assert.ok(/s\.comment &&/.test(hist) && /cleanComment/.test(hist), "History shows and edits it");
  assert.ok(/setComment/.test(store), "saved through the workout store");
  for (const t of [gym, cm, hist, rd("src/fitness/gym.css"), rd("src/fitness/history.css"), rd("src/core/fitness.ts"), rd("src/fitness/library.ts"), rd("src/fitness/pics.ts")]) {
    assert.ok(!/[–—]/.test(t), "no em or en dashes");
  }
});

console.log(`\n${n} passed`);
