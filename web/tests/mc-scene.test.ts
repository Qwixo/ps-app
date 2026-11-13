// Run: node --experimental-strip-types tests/mc-scene.test.ts
// Minecraft mode scene (src/views/minecraft): when it may move and make noise (hidden pause, mute memory, PS Do Not
// Disturb, live meetings, reduced motion), the crew's behaviour (a different run in and different beats every open,
// arguments now and then, rare surprises, the last opens remembered), the own background overlay that keeps text at 4.5:1 on real pixels, the theme's text contrast, and that everything
// is bundled (fonts with licences, no network, no WebGL, no dashes).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  GRUNT_GAP, MC_FPS, MUTE_KEY, SWING, contrast, coverCrop, isImageFile,
  luminance, mcRunState, meetingLive, nextGruntIn, overlayFor, readMuted, rng, strikesBy, swingAngle,
  worstContrast, writeMuted, type McRunInput,
} from "../src/views/minecraft/scene-logic.ts";
import {
  BEATS, HISTORY_KEY, HOME, IDS, ODDS, SURPRISES, TRIP, arriveMs, beatFor, castFor, entranceKind, entranceMs, makeEntrance,
  memoOf, pathOf, pickBeat, planOpen, poleXFor, pushHistory, readHistory, workerAt,
  type BeatId, type EntranceKind, type OpenMemo,
} from "../src/views/minecraft/crew-plan.ts";
import { makeBeat, poseIn, worldIn, type World } from "../src/views/minecraft/crew-beats.ts";
import { dndActive, dndApply } from "../src/core/dnd.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const DIR = "src/views/minecraft";
const base: McRunInput = { active: true, docVisible: true, onScreen: true, muted: false, dnd: false, meeting: false, reducedMotion: false };
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

// ---------- mute memory ----------
ok("mute: sound is on by default, and the choice is remembered", () => {
  const s = memStore();
  assert.equal(readMuted(s), false);
  writeMuted(s, true);
  assert.equal(s.m.get(MUTE_KEY), "1");
  assert.equal(readMuted(s), true);
  writeMuted(s, false);
  assert.equal(readMuted(s), false);
});
ok("mute: a broken or missing storage never throws and reads as not muted", () => {
  const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readMuted(bad), false);
  assert.doesNotThrow(() => writeMuted(bad, true));
  assert.equal(readMuted(null), false);
  assert.doesNotThrow(() => writeMuted(undefined, true));
});
ok("mute: muted means no audio but the crew keeps working", () => {
  const r = mcRunState({ ...base, muted: true });
  assert.equal(r.animate, true); assert.equal(r.audio, false); assert.equal(r.quietWhy, "muted");
});

// ---------- Do Not Disturb and meetings ----------
ok("DND: PS Do Not Disturb on silences the scene, animation goes on", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");
  const d = dndApply(undefined, { op: "on" }, now);
  assert.equal(dndActive(d, now), true);
  const r = mcRunState({ ...base, dnd: dndActive(d, now) });
  assert.equal(r.audio, false); assert.equal(r.animate, true); assert.equal(r.quietWhy, "dnd");
});
ok("DND: once it ends by its own clock, or is turned off, the noises come back", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");
  let d = dndApply(undefined, { op: "on" }, now);
  d = dndApply(d, { op: "until", until: new Date(now + 60_000).toISOString() }, now);
  assert.equal(mcRunState({ ...base, dnd: dndActive(d, now + 30_000) }).audio, false);
  assert.equal(mcRunState({ ...base, dnd: dndActive(d, now + 61_000) }).audio, true);
  const off = dndApply(dndApply(undefined, { op: "on" }, now), { op: "off" }, now + 5);
  assert.equal(mcRunState({ ...base, dnd: dndActive(off, now + 10) }).audio, true);
});
ok("DND: letting some distractions through still keeps the crew quiet", () => {
  const now = Date.now();
  let d = dndApply(undefined, { op: "on" }, now);
  d = dndApply(d, { op: "pass", kind: "sounds", pass: true }, now);
  assert.equal(mcRunState({ ...base, dnd: dndActive(d, now) }).audio, false);
});
ok("meetings: a live timed meeting silences it, all day events and past calls do not", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");
  const ev = (s: string, e: string, allDay = false) => ({ start: s, end: e, allDay });
  assert.equal(meetingLive([ev("2026-11-04T09:30:00Z", "2026-11-04T10:30:00Z")], now), true);
  assert.equal(meetingLive([ev("2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z", true)], now), false);
  assert.equal(meetingLive([ev("2026-11-04T08:00:00Z", "2026-11-04T09:00:00Z"), ev("2026-11-04T11:00:00Z", "2026-11-04T12:00:00Z")], now), false);
  assert.equal(meetingLive([ev("2026-11-04T10:00:00Z", "2026-11-04T10:00:00Z")], now), false);
  assert.equal(meetingLive(null, now), false);
  assert.equal(meetingLive([{ start: null, end: null }], now), false);
  const r = mcRunState({ ...base, meeting: true });
  assert.equal(r.audio, false); assert.equal(r.quietWhy, "meeting");
});
ok("host quiet: the panel can silence it for its own reasons", () => {
  assert.equal(mcRunState({ ...base, hostQuiet: true }).audio, false);
  assert.equal(mcRunState(base).audio, true);
  assert.equal(mcRunState(base).quietWhy, "");
});

// ---------- hidden pause ----------
ok("hidden: panel closed, page hidden or scrolled off: no frames and no audio", () => {
  for (const k of ["active", "docVisible", "onScreen"] as const) {
    const r = mcRunState({ ...base, [k]: false });
    assert.equal(r.animate, false, k); assert.equal(r.audio, false, k); assert.equal(r.quietWhy, "hidden", k);
  }
});
ok("hidden: hidden wins over every other reason, and audio is never on without frames", () => {
  for (const muted of [false, true]) for (const dnd of [false, true]) for (const meeting of [false, true]) for (const active of [false, true]) for (const reducedMotion of [false, true]) {
    const r = mcRunState({ ...base, muted, dnd, meeting, active, reducedMotion });
    if (r.audio) assert.equal(r.animate, true);
    if (!active) assert.equal(r.quietWhy, "hidden");
  }
});

// ---------- reduced motion ----------
const KINDS: EntranceKind[] = ["clean", "trip", "trip2", "overshoot", "trip+overshoot"];
ok("reduced motion: no run in, fewer frames, everyone already at work at t = 0", () => {
  const r = mcRunState({ ...base, reducedMotion: true });
  assert.equal(r.skipEntrance, true); assert.equal(r.fps, MC_FPS.reduced); assert.ok(MC_FPS.reduced < MC_FPS.normal);
  const W = 420, pole = poleXFor(W);
  for (const p of makeEntrance(rng(3), "trip2", pole, W)) {
    const w = workerAt(p, 0, pole, W, true);
    assert.equal(w.pose, "work"); assert.equal(w.x, pole + HOME[p.id].spot); assert.equal(w.face, HOME[p.id].face);
  }
  assert.equal(mcRunState(base).skipEntrance, false);
});
ok("reduced motion: only calm beats (nobody flies, jumps or falls), no surprises", () => {
  const r = rng(11);
  for (let i = 0; i < 400; i++) assert.ok(BEATS[pickBeat(r, null, true)].calm);
  for (let s = 1; s < 300; s++) assert.equal(planOpen(s, [], true).surprise, null);
  const plan = { ...planOpen(5, [], true), surprise: "poleFalls" as BeatId, surpriseAt: 1 };
  assert.notEqual(beatFor(plan, 1, "hit", rng(2), true), "poleFalls");
});

// ---------- the run in ----------
ok("entrance: 2 to 4 s for every kind of run in, on every panel width", () => {
  for (const W of [160, 200, 260, 320, 400, 520, 700, 900, 1200, 1600]) for (const kind of KINDS) for (let sd = 1; sd < 8; sd++) {
    const pole = poleXFor(W), plan = makeEntrance(rng(sd * 31 + W), kind, pole, W);
    const ms = entranceMs(plan, pole, W);
    assert.ok(ms >= 2000 && ms <= 4000, `width ${W} ${kind}: ${Math.round(ms)} ms`);
    assert.equal(entranceKind(plan), kind);
  }
});
ok("entrance: everyone starts off screen, staggered, and ends at his own spot", () => {
  const W = 420, pole = poleXFor(W);
  for (let sd = 1; sd < 40; sd++) {
    const plan = makeEntrance(rng(sd), KINDS[sd % KINDS.length], pole, W);
    assert.equal(new Set(plan.map((p) => Math.round(p.delay / 60))).size, 3, "staggered starts");
    for (const p of plan) {
      const w0 = workerAt(p, 0, pole, W);
      assert.ok(w0.x < 0 || w0.x > W, `${p.id} starts off screen`);
      const end = workerAt(p, arriveMs(p, pole, W) + 1, pole, W);
      assert.equal(end.pose, "work"); assert.equal(end.x, pole + HOME[p.id].spot);
    }
  }
});
ok("entrance: it is random who comes first, from which side, and who trips", () => {
  const W = 520, pole = poleXFor(W);
  const firsts = new Set<string>(), sides = new Set<string>(), trippers = new Set<string>();
  for (let sd = 1; sd < 200; sd++) {
    const plan = makeEntrance(rng(sd), "trip", pole, W);
    firsts.add(plan.find((p) => p.delay === 0)!.id);
    for (const p of plan) sides.add(p.id + p.from);
    trippers.add(plan.find((p) => p.trips.length)!.id);
  }
  assert.equal(firsts.size, 3); assert.equal(trippers.size, 3); assert.equal(sides.size, 6);
});
ok("entrance: a double trip falls twice, an overshoot runs past the pole, stops and comes back", () => {
  const W = 520, pole = poleXFor(W);
  const two = makeEntrance(rng(4), "trip2", pole, W).find((p) => p.trips.length === 2)!;
  const seen: string[] = [];
  for (let t = 0; t <= arriveMs(two, pole, W) + 50; t += 5) { const w = workerAt(two, t, pole, W); if (seen[seen.length - 1] !== w.pose) seen.push(w.pose); }
  assert.deepEqual(seen.filter((p) => p === "down").length, 2, seen.join(","));
  for (let sd = 1; sd < 30; sd++) {
    const o = makeEntrance(rng(sd), "overshoot", pole, W).find((p) => p.overshoot)!;
    assert.ok(o, "someone overshoots");
    const segs = pathOf(o, pole, W);
    assert.ok(segs.some((g) => g.k === "turn"));
    const far = segs.find((g) => g.k === "turn")!.x0;
    assert.ok(o.from === "left" ? far > pole : far < pole, "past the pole");
    let px = workerAt(o, 0, pole, W).x, dirs = new Set<number>();
    for (let t = 0; t < arriveMs(o, pole, W); t += 10) { const w = workerAt(o, t, pole, W); if (Math.abs(w.x - px) > 0.01) dirs.add(Math.sign(w.x - px)); assert.ok(Math.abs(w.x - px) < 12); px = w.x; }
    assert.equal(dirs.size, 2, "runs one way, then back");
  }
});
ok("entrance: nobody teleports during any run in", () => {
  const W = 700, pole = poleXFor(W);
  for (const kind of KINDS) for (const p of makeEntrance(rng(9), kind, pole, W)) {
    let px = workerAt(p, 0, pole, W).x;
    for (let t = 0; t < arriveMs(p, pole, W) + 50; t += 16) { const w = workerAt(p, t, pole, W); assert.ok(Math.abs(w.x - px) < 8, `${kind} ${p.id} at ${t}`); px = w.x; }
  }
  assert.ok(TRIP.fall + TRIP.down + TRIP.up < 1500);
});

// ---------- every open differs ----------
const simulate = (opens: number, seed0: number) => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const out = [];
  for (let i = 0; i < opens; i++) { const p = planOpen(seed0 + i * 7919, readHistory(store)); pushHistory(store, memoOf(p)); out.push(p); }
  return out;
};
ok("opens: the run in and the first beat always differ from the last open", () => {
  const plans = simulate(400, 1);
  for (let i = 1; i < plans.length; i++) {
    assert.notEqual(plans[i].kind, plans[i - 1].kind, `open ${i} run in`);
    assert.notEqual(plans[i].first, plans[i - 1].first, `open ${i} first beat`);
    if (i > 1) assert.notEqual(plans[i].kind, plans[i - 2].kind, `open ${i} run in vs two back`);
  }
  assert.equal(new Set(plans.map((p) => p.kind)).size, KINDS.length, "every kind of run in shows up");
  assert.ok(plans.some((p) => p.kind === "clean") && plans.some((p) => p.kind === "trip2"), "sometimes nobody trips, sometimes one trips twice");
});
ok("opens: an argument now and then, never two opens running; it ends both ways", () => {
  const plans = simulate(1000, 99);
  const share = plans.filter((p) => p.argueAt >= 0).length / plans.length;
  assert.ok(share > 0.15 && share < 0.35, String(share));
  for (let i = 1; i < plans.length; i++) assert.ok(!(plans[i].argueAt >= 0 && plans[i - 1].argueAt >= 0));
  assert.ok(plans.some((p) => p.argueEnd === "makeup") && plans.some((p) => p.argueEnd === "stomp"));
});
ok("opens: a rare surprise, about 1 in 10, never in three opens running", () => {
  const plans = simulate(3000, 5);
  const share = plans.filter((p) => p.surprise).length / plans.length;
  assert.ok(share > 0.07 && share < 0.13, String(share));
  for (let i = 1; i < plans.length; i++) if (plans[i].surprise) for (let k = 1; k <= 3 && i - k >= 0; k++) assert.equal(plans[i - k].surprise, null);
  for (const s of SURPRISES) assert.ok(plans.some((p) => p.surprise === s), s);
});
ok("opens: the memory keeps the last few, survives junk, and never throws", () => {
  const m = new Map<string, string>(); const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  for (let i = 0; i < 10; i++) pushHistory(st, { kind: "trip", first: "hit", argue: false, surprise: null });
  assert.equal(readHistory(st).length, 6);
  m.set(HISTORY_KEY, "not json"); assert.deepEqual(readHistory(st), []);
  m.set(HISTORY_KEY, JSON.stringify([{ kind: "trip", first: "<script>" }, { kind: "clean", first: "nap", surprise: "boom" }]));
  assert.deepEqual(readHistory(st), [{ kind: "clean", first: "nap", argue: false, surprise: null }] as OpenMemo[]);
  const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
  assert.deepEqual(readHistory(bad), []); assert.doesNotThrow(() => pushHistory(bad, memoOf(planOpen(1, []))));
});

// ---------- the beats ----------
const W0: World = { poleX: 300, W: 460, gy: 140, toolbox: 243 };
const ALL = Object.keys(BEATS) as BeatId[];
ok("beats: never the same beat twice in a row, and the plan's argument and surprise land where planned", () => {
  const r = rng(77);
  let prev: BeatId | null = null;
  for (let i = 0; i < 2000; i++) { const b = pickBeat(r, prev, false); assert.notEqual(b, prev); assert.ok(BEATS[b].w > 0); prev = b; }
  const plan = { ...planOpen(3, []), argueAt: 1, surprise: "hugePick" as BeatId, surpriseAt: 2 };
  const seq: BeatId[] = []; let p: BeatId | null = null;
  for (let i = 0; i < 12; i++) { p = beatFor(plan, i, p, r, false); seq.push(p); }
  assert.equal(seq[0], plan.first); assert.equal(seq[1], "argue"); assert.equal(seq[2], "hugePick");
  for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1]);
  assert.equal(seq.filter((b) => b === "argue").length, 1); assert.equal(seq.filter((b) => b === "hugePick").length, 1);
});
ok("beats: the pool picks with weights (hitting most, the funny ones less)", () => {
  const r = rng(8), count: Record<string, number> = {};
  for (let i = 0; i < 6000; i++) { const b = pickBeat(r, null, false); count[b] = (count[b] || 0) + 1; }
  assert.ok(count.hit > count.scratch && count.scratch > count.blowback);
  for (const b of ["hit", "scratch", "torch", "pass", "nap", "blowback", "cheer"]) assert.ok(count[b] > 0, b);
  for (const b of ["argue", "hugePick", "poleFalls"]) assert.ok(!count[b], b);
});
ok("beats: every beat starts and ends with everyone at his spot, facing the right way, upright", () => {
  for (const id of ALL) for (let sd = 1; sd < 12; sd++) for (const reduced of [false, true]) {
    if (reduced && !BEATS[id].calm) continue;
    const plan = { ...planOpen(sd, []), argueEnd: sd % 2 ? "stomp" as const : "makeup" as const };
    const b = makeBeat(id, rng(sd), W0, plan, reduced);
    for (const w of IDS) for (const lt of [0, b.dur]) {
      const p = poseIn(b, w, lt, W0);
      assert.ok(Math.abs(p.x - (W0.poleX + HOME[w].spot)) < 0.5, `${id} ${w} at ${lt}: x ${p.x}`);
      assert.equal(p.tilt, 0, `${id} ${w} tilt`); assert.ok(p.lift < 0.5, `${id} ${w} lift`);
      if (lt === b.dur) assert.equal(p.face, HOME[w].face, `${id} ${w} face`);
    }
    const wn = worldIn(b, b.dur, W0);
    assert.ok(Math.abs(wn.poleAngle) < 0.5 && !wn.flying && !wn.hat, `${id} world back to normal`);
  }
});
ok("beats: poses are always numbers (no NaN), nobody walks faster than a run, every cue is inside its beat", () => {
  for (const id of ALL) for (let sd = 1; sd < 6; sd++) {
    const b = makeBeat(id, rng(sd * 13), W0, { ...planOpen(sd, []), argueEnd: sd % 2 ? "stomp" : "makeup" }, false);
    for (const c of b.cues) assert.ok(c.at >= 0 && c.at <= b.dur, `${id} cue at ${c.at} of ${b.dur}`);
    for (const w of IDS) {
      let px = poseIn(b, w, 0, W0).x;
      for (let lt = 0; lt <= b.dur; lt += 1000 / 24) {
        const p = poseIn(b, w, lt, W0);
        for (const v of [p.x, p.lift, p.armF, p.armB, p.legF, p.legB, p.tilt]) assert.ok(Number.isFinite(v), `${id} ${w} ${lt}`);
        assert.ok(Math.abs(p.x - px) < 9, `${id} ${w} jumps ${Math.abs(p.x - px).toFixed(1)} px at ${Math.round(lt)}`);
        px = p.x;
      }
    }
  }
});
ok("argument: two face each other and trade symbol bubbles, the third fixes it, then they make up or one stomps off", () => {
  for (const end of ["makeup", "stomp"] as const) {
    const b = makeBeat("argue", rng(21), W0, { ...planOpen(2, []), argueEnd: end }, false);
    const [x, y, third] = b.cast;
    const mid = (b.n.tShout + b.n.tShoutEnd) / 2;
    const px = poseIn(b, x, mid, W0), py = poseIn(b, y, mid, W0);
    assert.equal(px.face, 1); assert.equal(py.face, -1); assert.ok(px.x < py.x && py.x - px.x < 30, "face to face, close");
    const shouts = b.cues.filter((c) => c.say && /[#@~!?]/.test(c.say) && (c.who === x || c.who === y));
    assert.ok(shouts.length >= 6); assert.ok(shouts.some((c) => c.who === x) && shouts.some((c) => c.who === y));
    assert.ok(shouts.some((c) => /[#@~]/.test(c.say!)), "symbols, not words");
    assert.ok(shouts.filter((c) => c.voice).length <= shouts.length / 2 + 1, "not every shout is a sound");
    assert.ok(b.cues.some((c) => c.fx === "tap" && c.who === third), "the third quietly fixes it");
    assert.ok(b.cues.some((c) => c.fx === "bulbOn"), "and the light comes on");
    if (end === "makeup") assert.ok(b.cues.some((c) => c.say === "<"), "hearts");
    else {
      const leaver = b.n.off ? y : x, gone = poseIn(b, leaver, (b.n.tGone + b.n.tReturn) / 2, W0);
      assert.ok(gone.x < 0 || gone.x > W0.W, "stomped off screen");
    }
  }
});
ok("beats: grunts match the moment (annoyed in arguments, happy in cheers, a snore in a nap)", () => {
  const v = (id: BeatId) => makeBeat(id, rng(4), W0, planOpen(4, []), false).cues.map((c) => c.voice).filter(Boolean);
  assert.ok(v("argue").includes("grr")); assert.ok(v("cheer").includes("yay")); assert.ok(v("nap").includes("zzz"));
  assert.ok(v("blowback").includes("oof")); assert.ok(v("scratch").every((k) => k === "hmm" || k === "huh"));
});
ok("surprises: the huge pickaxe grows, smashes once, goes away; the pole falls over and they lift it back", () => {
  const h = makeBeat("hugePick", rng(1), W0, null, false);
  assert.ok(h.cast[0] !== "pip");
  assert.equal(worldIn(h, 0, W0).huge?.scale, 0);
  assert.equal(worldIn(h, h.n.tSmash + 500, W0).huge?.scale, 1);
  assert.ok(h.cues.filter((c) => c.fx === "bighit").length === 1);
  const p = makeBeat("poleFalls", rng(1), W0, null, false);
  assert.ok(worldIn(p, p.n.tThud + 400, W0).poleAngle > 75);
  assert.ok(p.cues.some((c) => c.fx === "thud"));
  // Pip gets out from under it before it lands.
  assert.ok(poseIn(p, "pip", p.n.tThud, W0).x < W0.poleX);
});
ok("cast: the pickaxe moments go to someone with a pickaxe", () => {
  const r = rng(5);
  for (let i = 0; i < 300; i++) { assert.notEqual(castFor(r, "hugePick")[0], "pip"); assert.equal(new Set(castFor(r, "argue")).size, 3); }
});
void ODDS;

// ---------- the work loop ----------
ok("work: the pickaxe swing goes up over the shoulder and down onto the box, smoothly", () => {
  let prev = swingAngle(0), maxA = 0;
  for (let p = 0; p < 1; p += 0.005) { const a = swingAngle(p); assert.ok(Math.abs(a - prev) < 25, `jump at ${p}`); prev = a; maxA = Math.max(maxA, a); }
  assert.ok(maxA > 180, "wind up past straight up");
  assert.ok(Math.abs(swingAngle(0.999) - swingAngle(0)) < 2, "loops cleanly");
  assert.ok(swingAngle(SWING.hit) < 110 && swingAngle(SWING.hit) > 80, "the strike lands forward");
  assert.equal(strikesBy(-5), 0);
  assert.equal(strikesBy(SWING.period * SWING.hit - 1), 0);
  assert.equal(strikesBy(SWING.period * SWING.hit + 1), 1);
  assert.equal(strikesBy(SWING.period * (3 + SWING.hit) + 1), 4);
});
ok("work: grunts come every 3 to 7 s", () => {
  const r = rng(7);
  for (let i = 0; i < 500; i++) { const g = nextGruntIn(r); assert.ok(g >= GRUNT_GAP[0] && g <= GRUNT_GAP[1]); }
  assert.deepEqual(GRUNT_GAP, [3000, 7000]);
});
ok("random: seeded, so every open looks the same, and inside 0..1", () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 100; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

// ---------- own background ----------
ok("contrast: WCAG luminance and ratio", () => {
  assert.equal(luminance(255, 255, 255), 1); assert.equal(luminance(0, 0, 0), 0);
  assert.equal(Math.round(contrast(1, 0) * 10) / 10, 21);
  assert.ok(Math.abs(contrast(luminance(118, 118, 118), 1) - 4.54) < 0.02);
});
ok("own background: a very bright picture gets enough overlay for 4.5:1 on its brightest pixel", () => {
  const px: number[] = [];
  for (let i = 0; i < 400; i++) px.push(i % 7 ? 250 : 255, 252, 240 + (i % 15), 255);
  const r = overlayFor(px, [255, 255, 255], [8, 10, 18]);
  assert.ok(r.contrast >= 4.5, String(r.contrast));
  assert.ok(worstContrast(px, [255, 255, 255], [8, 10, 18], r.alpha) >= 4.5);
  assert.ok(worstContrast(px, [255, 255, 255], [8, 10, 18], r.alpha - 0.05) < 4.5, "and not much darker than it needs");
});
ok("own background: one bright spot in a dark photo still sets the overlay (worst pixel, not the average)", () => {
  const px: number[] = [];
  for (let i = 0; i < 1000; i++) px.push(20, 22, 30, 255);
  px.push(255, 255, 255, 255);
  const r = overlayFor(px, [255, 255, 255], [8, 10, 18]);
  assert.ok(r.contrast >= 4.5 && r.alpha > 0.5);
});
ok("own background: a dark picture keeps the lightest overlay (the mood stays)", () => {
  const px: number[] = [];
  for (let i = 0; i < 100; i++) px.push(30, 40, 60, 255);
  const r = overlayFor(px, [255, 255, 255], [8, 10, 18], 4.5, 0.35);
  assert.equal(r.alpha, 0.35); assert.ok(r.contrast >= 4.5);
});
ok("own background: transparent pixels are skipped, an empty picture is trivially fine", () => {
  assert.equal(worstContrast([255, 255, 255, 0], [255, 255, 255], [0, 0, 0], 0), 21);
});
ok("own background: cover crop matches object-fit cover", () => {
  assert.deepEqual(coverCrop(2000, 1000, 500, 500), { sx: 500, sy: 0, sw: 1000, sh: 1000 });
  assert.deepEqual(coverCrop(1000, 2000, 400, 200), { sx: 0, sy: 750, sw: 1000, sh: 500 });
});
ok("own background: only pictures are taken", () => {
  for (const f of [{ type: "image/png" }, { type: "image/jpeg" }, { type: "image/webp" }, { type: "image/heic" }, { type: "", name: "x.JPG" }]) assert.ok(isImageFile(f), JSON.stringify(f));
  for (const f of [{ type: "video/mp4" }, { type: "image/svg+xml" }, { type: "text/html" }, { type: "", name: "x.exe" }, null]) assert.ok(!isImageFile(f), JSON.stringify(f));
});

// ---------- theme ----------
const css = readFileSync(`${DIR}/mc-theme.css`, "utf8");
const hexL = (h: string) => luminance(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
const tok = (block: string, name: string) => { const m = new RegExp(`--${name}: (#[0-9a-fA-F]{6})`).exec(block); assert.ok(m, name); return m![1]; };
const blockOf = (sel: string) => { const i = css.indexOf(sel); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf("}", i)); };
ok("theme: light and dark text reach 7:1 (soft text 4.5:1) on panels, buttons readable", () => {
  for (const sel of [".mcm-theme, .mcs-root {", '.mcm-theme[data-mcm-theme="dark"], .mcs-root[data-mcm-theme="dark"] {']) {
    const b = blockOf(sel);
    assert.ok(contrast(hexL(tok(b, "mcm-ink")), hexL(tok(b, "mcm-panel"))) >= 7, `${sel} ink`);
    assert.ok(contrast(hexL(tok(b, "mcm-ink-soft")), hexL(tok(b, "mcm-panel"))) >= 4.5, `${sel} soft`);
    assert.ok(contrast(hexL(tok(b, "mcm-btn-ink")), hexL(tok(b, "mcm-btn"))) >= 4.5, `${sel} button`);
    assert.ok(contrast(hexL(tok(b, "mcm-btn-on-ink")), hexL(tok(b, "mcm-btn-on"))) >= 4.5, `${sel} on button`);
  }
  for (const f of ["stone", "plank", "dirt", "obsidian"]) {
    const b = blockOf(`.mcm-panel--${f} {`);
    assert.ok(contrast(hexL(tok(b, "mcm-ink")), hexL(tok(b, "mcm-panel"))) >= 7, f);
    assert.ok(contrast(hexL(tok(b, "mcm-ink-soft")), hexL(tok(b, "mcm-panel"))) >= 4.5, `${f} soft`);
  }
});
ok("theme: the auto dark block matches the explicit dark tokens", () => {
  const d = blockOf('.mcm-theme[data-mcm-theme="dark"], .mcs-root[data-mcm-theme="dark"] {'), a = blockOf('.mcm-theme:not([data-mcm-theme="light"]) {');
  for (const t of ["mcm-panel", "mcm-ink", "mcm-ink-soft", "mcm-btn", "mcm-btn-ink"]) assert.equal(tok(a, t), tok(d, t), t);
});
ok("theme: buttons press in (they move down and the bevel flips)", () => {
  const b = blockOf(".mcm-theme .mcm-btn:active");
  assert.match(b, /translateY\(var\(--b\)\)/); assert.match(b, /var\(--mcm-btn-lo\)/);
});
ok("theme: every class is mcm-* or mcs-* so nothing leaks into the rest of PS", () => {
  const sel = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")[0]).join(" ");
  for (const m of sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) assert.ok(/^(mcm|mcs)-/.test(m[1]) || ["is-on", "is-pressed"].includes(m[1]), m[1]);
});

// ---------- bundled, offline, original ----------
const files = readdirSync(DIR, { recursive: true }).map(String);
const code = files.filter((f) => /\.(ts|tsx|css)$/.test(f)).map((f) => [f, readFileSync(`${DIR}/${f}`, "utf8")] as const);
ok("offline: the pixel fonts are in the repo, each with its OFL licence", () => {
  for (const [font, lic] of [["fonts/PixelifySans-Variable.ttf", "fonts/OFL-PixelifySans.txt"], ["fonts/Silkscreen-Regular.ttf", "fonts/OFL-Silkscreen.txt"]]) {
    assert.ok(existsSync(`${DIR}/${font}`), font);
    assert.match(readFileSync(`${DIR}/${lic}`, "utf8"), /SIL Open Font License/);
    assert.ok(css.includes(`url("./${font}")`), `${font} in the css`);
  }
});
ok("offline: nothing is fetched from the internet, no WebGL, no three.js", () => {
  for (const [f, src] of code) {
    assert.doesNotMatch(src, /https?:\/\//, f);
    assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|getContext\(["'](experimental-)?webgl|WebGL\w*Context|from ["']three/i, f);
  }
});
ok("original: no game names or files in the scene's code or assets", () => {
  for (const f of files) assert.doesNotMatch(f, /mojang|villager/i, f);
  for (const [f, src] of code) assert.doesNotMatch(src, /\.(ogg|mp3|wav)["']/i, `${f}: no sound files`);
});
ok("house style: no em or en dashes anywhere in the minecraft files or this test", () => {
  const all = [...code, ["README", readFileSync(`${DIR}/fonts/README.txt`, "utf8")] as const, ["test", readFileSync("tests/mc-scene.test.ts", "utf8")] as const];
  for (const [f, src] of all) assert.ok(!/[\u2013\u2014]/.test(src), f);
});

console.log(`\n${n} passed`);
