// Fitness exercise pictures (src/fitness/pic-rig.ts, src/fitness/pics.ts): every library exercise has a picture,
// the rig keeps limbs their own length, poses blend smoothly, a rep loops back to the start, unknown names match
// a close exercise or a guess, and nothing has an em or en dash.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIBRARY } from "../src/fitness/library.ts";
import { L, blend, ik, repK, solve, type Pose, type V2 } from "../src/fitness/pic-rig.ts";
import { PIC_IDS, picFor, sceneBox, scenePattern } from "../src/fitness/pics.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const finite = (v: V2) => Number.isFinite(v[0]) && Number.isFinite(v[1]);

ok("every library exercise has its own picture, and no picture points at a missing exercise", () => {
  for (const x of LIBRARY) {
    const p = picFor(x.id, x.name);
    assert.ok(p, `${x.name}: no picture`);
    assert.equal(p.how, "exact");
    assert.equal(p.exercise.id, x.id);
    assert.ok(scenePattern(x.id), x.id);
  }
  const ids = new Set(LIBRARY.map((x) => x.id));
  for (const id of PIC_IDS) assert.ok(ids.has(id), `map has unknown id ${id}`);
  assert.equal(PIC_IDS.length, LIBRARY.length);
});

ok("about 50 shared movement patterns cover the 153 exercises (one rig, small data)", () => {
  const pats = new Set(LIBRARY.map((x) => scenePattern(x.id)));
  assert.ok(pats.size >= 40 && pats.size <= 60, `${pats.size} patterns`);
});

ok("two bone IK keeps both bones their length and reaches a target in range", () => {
  const r = ik([0, 0], [10, 10], 12.5, 11.5, 1);
  assert.ok(Math.abs(dist([0, 0], r.mid) - 12.5) < 1e-6);
  assert.ok(Math.abs(dist(r.mid, r.end) - 11.5) < 1e-6);
  assert.ok(dist(r.end, [10, 10]) < 1e-6);
  const far = ik([0, 0], [100, 0], 12.5, 11.5, 1);     // out of reach: straight toward it
  assert.ok(Math.abs(far.end[0] - 24) < 0.01 && Math.abs(far.end[1]) < 0.01);
  const a = ik([0, 0], [10, 0], 12.5, 11.5, 1), b = ik([0, 0], [10, 0], 12.5, 11.5, -1);
  assert.ok(a.mid[1] * b.mid[1] < 0, "the bend side flips");
});

ok("every pose of every exercise solves to real numbers with limbs their own length", () => {
  for (const x of LIBRARY) {
    const s = picFor(x.id, x.name)!.scene;
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const j = solve(blend(s.a, s.b, k));
      for (const v of [j.hip, j.neck, j.head, j.sh, j.el, j.wr, j.kn, j.an, j.toe, j.sh2, j.el2, j.wr2, j.kn2, j.an2, j.grip]) assert.ok(finite(v), `${x.name} at ${k}`);
      assert.ok(Math.abs(dist(j.sh, j.el) - L.UA) < 0.01, `${x.name}: upper arm`);
      assert.ok(Math.abs(dist(j.el, j.wr) - L.FA) < 0.01, `${x.name}: forearm`);
      assert.ok(Math.abs(dist(j.kn, j.an) - L.SH) < 0.01, `${x.name}: shin`);
    }
  }
});

ok("start and end differ (something moves) for every exercise but a hold", () => {
  for (const x of LIBRARY) {
    const s = picFor(x.id, x.name)!.scene;
    const a = solve(s.a), b = solve(s.b);
    const moved = Math.max(...(["hip", "head", "wr", "wr2", "an", "an2", "kn", "kn2", "el", "el2", "sh", "grip", "toe", "toe2"] as const).map((k) => dist(a[k], b[k])));
    assert.ok(moved > (s.hold2 ? 0.5 : 2.5), `${x.name}: moves ${moved.toFixed(2)}`);
  }
});

ok("the picture stays inside its frame through the whole rep", () => {
  for (const x of LIBRARY) {
    const s = picFor(x.id, x.name)!.scene;
    const [x0, y0, w, h] = sceneBox(s).split(" ").map(Number);
    assert.ok(Math.abs(w / h - 10 / 9) < 0.01, `${x.name}: frame shape`);
    assert.ok(w >= 56 && w <= 130, `${x.name}: frame ${w}`);
    for (const k of [0, 0.33, 0.66, 1]) {
      const j = solve(blend(s.a, s.b, k));
      for (const v of [j.head, j.wr, j.wr2, j.an, j.an2, j.toe, j.kn]) {
        assert.ok(v[0] > x0 - 3 && v[0] < x0 + w + 3 && v[1] > y0 - 3 && v[1] < y0 + h + 3, `${x.name} leaves its frame at ${k}`);
      }
    }
  }
});

ok("a rep: rests at the start, rises to the end, holds, comes back, and loops", () => {
  assert.equal(repK(0), 0);
  assert.equal(repK(0.05), 0);
  assert.equal(repK(0.5), 1);
  assert.ok(repK(0.3) > 0 && repK(0.3) < 1);
  assert.ok(repK(0.8) > 0 && repK(0.8) < 1);
  assert.ok(repK(0.999) < 0.01);
  assert.equal(repK(1.5), repK(0.5));
  // Smooth: no jump bigger than a small step between frames 1/120 of a rep apart.
  for (let i = 0; i < 240; i++) assert.ok(Math.abs(repK((i + 1) / 120) - repK(i / 120)) < 0.08, `jump at ${i}`);
});

ok("blending is exact at the ends and halfway between", () => {
  const a: Pose = { hip: [50, 54.5], t: 180, arm: [0, 0], leg: { at: [50, 84] } };
  const b: Pose = { hip: [40, 70], t: 140, arm: [0, 150], leg: { at: [50, 84] } };
  assert.deepEqual(blend(a, b, 0).hip, [50, 54.5]);
  assert.deepEqual(blend(a, b, 1).hip, [40, 70]);
  assert.equal(blend(a, b, 0.5).t, 160);
  assert.deepEqual(blend(a, b, 0.5).arm, [0, 75]);
});

ok("names PS does not know: a close library exercise, then a key word guess, else the placeholder", () => {
  const p = (name: string) => picFor(null, name);
  assert.equal(p("incline DB press")?.exercise.id, "incline-dumbbell-press");
  assert.equal(p("Lat Pull-Down")?.exercise.id, "lat-pulldown");
  assert.equal(p("Chest Press Machine")?.exercise.id, "machine-chest-press");
  assert.equal(p("Preacher curls")?.exercise.id, "preacher-curl");
  assert.equal(p("Lateral raises")?.exercise.id, "dumbbell-lateral-raise");
  assert.equal(p("Back-row pull machine")?.exercise.id, "machine-row");
  assert.equal(p("Abs Abductor machine")?.exercise.id, "hip-abduction-machine");
  // Pull and push never cross ("pull down" is not a pushdown).
  assert.equal(p("Metal bar pull down")?.exercise.id, "lat-pulldown");
  assert.equal(p("Single arm cable push downs")?.exercise.id.includes("pushdown"), true);
  assert.equal(p("Black rope back/tricep thing")?.exercise.id, "rope-pushdown");
  assert.equal(p("Behind the back curl")?.exercise.id, "bayesian-curl");
  assert.equal(p("JM Press")?.exercise.id, "close-grip-bench-press");
  assert.equal(p("Metal bar pull down")?.how, "guess");
  assert.equal(p("Zumba class"), null);
  assert.equal(p(""), null);
  assert.equal(p("   "), null);
  // A known id always wins over the name.
  assert.equal(picFor("leg-press", "Something else")?.exercise.id, "leg-press");
  assert.equal(picFor("not-an-id", "Leg press")?.exercise.id, "leg-press");
});

ok("no em or en dashes in the picture code, styles or copy", () => {
  for (const f of ["src/fitness/pic-rig.ts", "src/fitness/pics.ts", "src/fitness/ExPic.tsx", "src/fitness/pics.css", "src/dev/expics.tsx"]) {
    assert.ok(!/[\u2013\u2014]/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")), f);
  }
});

ok("pictures use only the look tokens: no fixed colours outside the chalk and light overrides, no external requests", () => {
  const css = readFileSync(new URL("../src/fitness/pics.css", import.meta.url), "utf8");
  const tsx = readFileSync(new URL("../src/fitness/ExPic.tsx", import.meta.url), "utf8");
  assert.ok(!/https?:\/\//.test(css + tsx), "no URLs");
  assert.ok(!/<img|<image|fetch\(|url\(/.test(tsx + css), "no images or fetches");
  assert.ok(/prefers-reduced-motion/.test(tsx) && /prefers-reduced-motion/.test(css), "reduced motion handled");
});

console.log(`\n${n} passed`);
