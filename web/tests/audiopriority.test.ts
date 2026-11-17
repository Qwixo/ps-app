// Run: node --experimental-strip-types tests/audiopriority.test.ts
// Audio priority (src/core/audiopriority.ts, PS 1.65): the Mac's state message, moving a row, the drag maths, the
// spring, the notes, the sounds (the same numbers as ps-mac Sfx.swift), and that it is wired as a feature with its
// switch, its tour step and no leftovers of the mixer's old look or Headphones mode. FICTIONAL devices.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const A = await import("../src/core/audiopriority.ts");
const { TOUR_STEPS } = await import("../src/core/tour.ts");
const { settingById } = await import("../src/core/settingsindex.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const row = (uid: string, over: Record<string, unknown> = {}) => ({ uid, name: uid.toUpperCase(), kind: "bluetooth", connected: true, using: false, ...over });

// ---------- the Mac's message ----------
ok("a good message is read as it is", () => {
  const s = A.cleanAPState({ type: "audioprio", on: true, speakers: [row("pods", { using: true }), row("mac", { kind: "builtIn" })], mics: [row("mic", { kind: "builtIn", using: true })], held: { speakers: true }, waiting: ["mics"] });
  assert.ok(s);
  assert.equal(s!.on, true);
  assert.deepEqual(s!.speakers.map((r) => r.uid), ["pods", "mac"]);
  assert.equal(s!.speakers[0].using, true);
  assert.deepEqual(s!.held, { speakers: true, mics: false });
  assert.deepEqual(s!.waiting, ["mics"]);
});
ok("bad shapes: nothing, or the bad parts dropped", () => {
  assert.equal(A.cleanAPState(null), null);
  assert.equal(A.cleanAPState({ speakers: "x", mics: [] }), null);
  const s = A.cleanAPState({ speakers: [row("a"), row("a"), { uid: "" }, { name: "no id" }, row("b", { kind: "hologram", name: "  " }), 7], mics: [], waiting: ["mics", "mics", "elsewhere"] });
  assert.deepEqual(s!.speakers.map((r) => r.uid), ["a", "b"]);
  assert.equal(s!.speakers[1].kind, "other");
  assert.equal(s!.speakers[1].name, A.AP_WORDS.unnamed);
  assert.deepEqual(s!.waiting, ["mics"]);
  assert.equal(s!.on, false);
});
ok("only one device in use per list, and never one that is not connected", () => {
  const s = A.cleanAPState({ speakers: [row("a", { using: true }), row("b", { using: true }), row("c", { using: true, connected: false })], mics: [] });
  assert.deepEqual(s!.speakers.map((r) => r.using), [true, false, false]);
});
ok("at most 40 rows per list", () => {
  const s = A.cleanAPState({ speakers: Array.from({ length: 60 }, (_, i) => row(`d${i}`)), mics: [] });
  assert.equal(s!.speakers.length, 40);
});

// ---------- moving rows ----------
ok("move a row down, up, to the ends, and nowhere", () => {
  const l = ["a", "b", "c", "d"];
  assert.deepEqual(A.moveItem(l, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(A.moveItem(l, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(A.moveItem(l, 1, 99), ["a", "c", "d", "b"]);
  assert.deepEqual(A.moveItem(l, 2, 2), l);
  assert.deepEqual(A.moveItem(l, 9, 0), l);
  assert.deepEqual(l, ["a", "b", "c", "d"], "the original list is never changed");
});
ok("drop place: half a row is enough, clamped to the list", () => {
  assert.equal(A.dropIndex(1, 0, 38, 4), 1);
  assert.equal(A.dropIndex(1, 18, 38, 4), 1);
  assert.equal(A.dropIndex(1, 20, 38, 4), 2);
  assert.equal(A.dropIndex(1, -20, 38, 4), 0);
  assert.equal(A.dropIndex(1, 999, 38, 4), 3);
  assert.equal(A.dropIndex(1, -999, 38, 4), 0);
  assert.equal(A.dropIndex(0, 50, 0, 4), 0, "no pitch: stays");
});
ok("the other rows make room: only the ones between the start and the drop place move, one row each", () => {
  const shifts = (from: number, over: number) => [0, 1, 2, 3].map((i) => A.shiftFor(i, from, over));
  assert.deepEqual(shifts(0, 2), [0, -1, -1, 0]);
  assert.deepEqual(shifts(3, 1), [0, 1, 1, 0]);
  assert.deepEqual(shifts(2, 2), [0, 0, 0, 0]);
});
ok("a click is not a drag until the pointer moves 4 pixels", () => {
  assert.equal(A.isDrag(2, 2), false);
  assert.equal(A.isDrag(0, 4), true);
});
ok("the order sent to the Mac is the ids, top first", () => {
  const s = A.cleanAPState({ speakers: [row("x"), row("y")], mics: [] })!;
  assert.deepEqual(A.orderOf(A.moveItem(s.speakers, 1, 0)), ["y", "x"]);
});

// ---------- the spring ----------
ok("the spring settles on its target in about a third of a second, with a little overshoot, never exploding", () => {
  let s = { x: 0, v: 0 }, t = 0, max = 0;
  while (!A.springAtRest(s, 38) && t < 2) { s = A.springStep(s, 38, 1 / 60); t += 1 / 60; max = Math.max(max, s.x); }
  assert.ok(t < 0.6, `settled in ${t.toFixed(2)}s`);
  assert.ok(max > 38 && max < 38 * 1.15, `a soft overshoot, ${max.toFixed(1)}`);
  const slow = A.springStep({ x: 0, v: 0 }, 38, 5);            // a very slow frame
  assert.ok(Number.isFinite(slow.x) && Math.abs(slow.x) < 80);
  assert.equal(A.springAtRest({ x: 38.1, v: 1 }, 38), true);
});

// ---------- the notes ----------
ok("the line under a list says why PS is not switching, or nothing", () => {
  const base = A.cleanAPState({ speakers: [row("a")], mics: [row("m")] })!;
  assert.equal(A.noteFor(base, "speakers"), "");
  assert.equal(A.noteFor({ ...base, held: { speakers: true, mics: false } }, "speakers"), A.AP_WORDS.heldSpeaker);
  assert.equal(A.noteFor({ ...base, held: { speakers: false, mics: true } }, "mics"), A.AP_WORDS.heldMic);
  assert.equal(A.noteFor({ ...base, held: { speakers: true, mics: false }, waiting: ["speakers"] }, "speakers"), A.AP_WORDS.waiting, "a call says so first");
});
ok("the words: plain, no dashes", () => {
  const all = Object.values(A.AP_WORDS).map((w) => typeof w === "function" ? w("JBL Flip") : w).join(" ");
  assert.doesNotMatch(all, /[–—;!]/);
});

// ---------- the sounds: the page and the Mac play the same ----------
ok("every sound has a Mac copy with the same numbers (Sfx.swift ap-*)", () => {
  const mac = "../../mac/Sources/Sfx.swift";
  if (!existsSync(new URL(mac, import.meta.url))) { console.log("skip - no Sfx.swift next to the web app"); return; }
  const sw = read(mac);
  for (const [k, tones] of Object.entries(A.AP_TONES)) {
    const line = sw.split("\n").find((l) => l.includes(`"ap-${k}":`));
    assert.ok(line, `Sfx.swift has ap-${k}`);
    for (const t of tones) {
      assert.ok(line!.includes(`f: ${t.f}, to: ${t.to ?? "nil"}, dur: ${t.dur}, peak: ${t.peak}, wave: ${t.wave}, at: ${t.at}`), `ap-${k} matches ${JSON.stringify(t)}`);
    }
  }
  for (const tones of Object.values(A.AP_TONES)) for (const t of tones) assert.ok(t.peak <= 0.06, "soft");
  assert.match(read("../src/ui/sfx.ts"), /ap\(kind: "lift" \| "slot" \| "drop" \| "use" \| "forget"\)/);
});

// ---------- wired as a feature ----------
ok("features.json: on by default, shared, since 1.65, web and mac", () => {
  const f = JSON.parse(read("../../features.json")).features.find((x: { id: string }) => x.id === "audio-priority");
  assert.ok(f);
  assert.equal(f.default, "on"); assert.equal(f.scope, "shared"); assert.equal(f.since, "1.65"); assert.equal(f.owner, "jan");
  assert.deepEqual(f.parts, ["web", "mac"]);
});
ok("FEATURES.md says what it does and where the switch is", () => {
  const md = read("../../FEATURES.md");
  assert.match(md, /Audio priority\. The volume mixer now opens on two lists/);
  assert.match(md, /Settings, Mac, Audio priority/);
  assert.doesNotMatch(md, /Headphones auto switch \| Moves sound/);
});
ok("a visible switch in Settings, Mac, and a step in the 1.65 tour", () => {
  const e = settingById("audio-priority");
  assert.ok(e && e.group === "mac");
  assert.match(read("../src/views/SettingsGroups.tsx"), /"audio-priority": function AudioPrio[\s\S]{0,400}feature\("audio-priority"\)/);
  const step = TOUR_STEPS.find((s) => s.ids.includes("audio-priority"));
  assert.ok(step && step.on?.includes("mac") && /volume mixer/.test(step.where));
});
ok("the mixer: gated lists on top, one look, no gear, no Headphones switch, Esc closes", () => {
  const m = read("../src/views/Mixer.tsx");
  assert.match(m, /const prio = feature\("audio-priority"\)/);
  assert.match(m, /\{prio && <AudioPriorityLists \/>\}/);
  assert.doesNotMatch(m, /MixGear|HeadphonesSwitch|density|slider-|opacity|COLORS/);
  assert.match(m, /e\.key !== "Escape"[\s\S]{0,120}setOpen\(false\)/);
  assert.equal(existsSync(new URL("../src/views/Headphones.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("../src/audiomode.ts", import.meta.url)), false);
  assert.doesNotMatch(read("../src/views/mixer.css"), /mix-gear|\.compact|slider-thick|mix-sw/);
});
ok("the lists never take focus and respect reduced motion", () => {
  const v = read("../src/views/AudioPriority.tsx");
  assert.match(v, /e\.preventDefault\(\);\s+\/\/ never takes focus/);
  assert.match(v, /reducedMotion\(\)/);
  assert.doesNotMatch(v, /\.focus\(|autoFocus/);
  assert.match(read("../src/views/audiopriority.css"), /prefers-reduced-motion: reduce[\s\S]*animation: none/);
});
console.log(`audiopriority: ${n} passed`);
