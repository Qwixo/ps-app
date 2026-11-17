// Run: node --experimental-strip-types tests/assistwalk.test.ts
// The guided walk (core/assistwalk.ts): the steps for EVERY setting in core/settingsindex.ts, the second per step, Do it applies once at the
// control, Show me how waits for the person's click, Esc ends anywhere, reduced motion jumps. Fake data only.
import { STEP_MS, buildWalk, nextTimeLine, startWalk, walkSay, walkStep, type Effect, type Mode, type WalkState } from "../src/core/assistwalk.ts";
import { GROUPS, SETTINGS, groupById, landingOf, visibleTo, type Ctx } from "../src/core/settingsindex.ts";
import { pathOf } from "../src/core/assist.ts";
// PS 1.65: rows marked second (Your Macs) show once Second Computer is switched on (core/mailflag.ts, set by the vault).
import { setSecondAllowed } from "../src/core/mailflag.ts";
setSecondAllowed(true);

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const base = { pf: true, ck: true, te: true, sr: true, mail: true, mailCan: true };
const CTXS: Ctx[] = [];
for (const red of [false, true]) for (const where of ["mac", "web", "phone"] as const) for (const shell of where === "phone" ? (["gos", "mweb"] as const) : [undefined]) CTXS.push({ ...base, red, where, shell });
const reachable = SETTINGS.filter((e) => CTXS.some((c) => visibleTo(e, c)));

ok("every setting in the list can be reached by someone", reachable.length === SETTINGS.length);
ok("a second a step", STEP_MS === 1000);

for (const e of SETTINGS) {
  const ctx = CTXS.find((c) => visibleTo(e, c))!;
  for (const narrow of [false, true]) {
    const w = buildWalk(e.id, ctx, narrow);
    const land = landingOf(e), g = groupById(land.group);
    ok(`${e.id} (${narrow ? "narrow" : "wide"}): there is a walk`, !!w);
    if (!w) continue;
    const kinds = w.steps.map((s) => s.kind);
    ok(`${e.id}: starts on the tab, ends on the exact control`, kinds[0] === "tab" && kinds[kinds.length - 1] === "control" && w.steps.at(-1)!.settingId === land.id);
    ok(`${e.id}: the tab step points at its group`, w.steps[0].group === g.id && w.steps[0].selector.includes(`data-group="${g.id}"`));
    ok(`${e.id}: the control step points at its row`, w.steps.at(-1)!.selector === `[data-set="${land.id}"]`);
    ok(`${e.id}: the section step only on a wide window`, kinds.includes("section") === !narrow);
    ok(`${e.id}: a More setting walks through More`, kinds.includes("more") === !!land.more);
    ok(`${e.id}: the path starts at Settings and ends with its name`, w.path === pathOf(e.id) && w.path.startsWith(`Settings, ${g.label}`) && w.path.endsWith(e.name));
    ok(`${e.id}: every spoken line is plain`, w.steps.every((s) => !!s.say && !/[–—]/.test(s.say)) && !/[–—]/.test(nextTimeLine(w.path)));
    ok(`${e.id}: a setting drawn inside another lands on its parent`, !e.parent || w.steps.at(-1)!.settingId === landingOf(e).id);
    // the walk plays through
    for (const mode of ["do", "show"] as Mode[]) {
      const effects: Effect[] = [];
      let { state, effects: ef } = startWalk(w, mode, false);
      effects.push(...ef);
      let ticks = 0;
      while (state.phase === "running" || state.phase === "applied") { const r = walkStep(state, "tick"); state = r.state; effects.push(...r.effects); if (++ticks > 20) break; }
      if (mode === "do") ok(`${e.id} do: applies exactly once and ends by itself`, effects.filter((x) => x === "apply").length === 1 && state.phase === "done" && effects.includes("end") && ticks === w.steps.length);
      else ok(`${e.id} show: changes nothing and waits on the control`, !effects.includes("apply") && state.phase === "waiting" && effects.includes("wait") && ticks === w.steps.length - 1);
    }
    // reduced motion
    const rd = startWalk(w, "do", true);
    ok(`${e.id}: reduced motion lands on the control at once`, rd.state.i === w.steps.length - 1 && rd.effects.join() === "apply");
  }
}
// rules on one walk
const w = buildWalk("posture-every", CTXS[0], false)!;
const play = (mode: Mode) => startWalk(w, mode, false).state;
ok("walk say follows the step", walkSay(play("do")) === w.steps[0].say);
ok("show me how: a tick never moves past the waiting control", (() => { let s = play("show"); for (let i = 0; i < 10; i++) s = walkStep(s, "tick").state; return s.phase === "waiting" && s.i === w.steps.length - 1; })());
ok("show me how: a click finishes it, and only then", (() => { let s = play("show"); const early = walkStep(s, "click"); for (let i = 0; i < 5; i++) s = walkStep(s, "tick").state; const r = walkStep(s, "click"); return early.state.phase === "running" && r.state.phase === "done" && r.effects.includes("clicked"); })());
ok("Esc ends a walk at every step, in both modes, and applies nothing", [0, 1, 2, 3].every((k) => (["do", "show"] as Mode[]).every((m) => { let s: WalkState = play(m); const fx: Effect[] = []; for (let i = 0; i < k; i++) { const r = walkStep(s, "tick"); s = r.state; fx.push(...r.effects); } const r = walkStep(s, "esc"); return r.state.phase === "done" && r.effects.join() === "end" && !fx.includes("apply") || (k >= w.steps.length - 1 && m === "do"); })));
ok("Esc before the control never applies", (() => { const s = play("do"); const r = walkStep(s, "esc"); return !r.effects.includes("apply") && r.state.phase === "done"; })());
ok("a done walk stays done", (() => { const d = walkStep(play("do"), "esc").state; return ["tick", "click", "esc"].every((e) => walkStep(d, e as never).state === d); })());
ok("click while running does nothing", (() => { const s = play("do"); return walkStep(s, "click").state === s; })());
ok("an unknown setting has no walk", buildWalk("nope", CTXS[0]) === null);
ok("group count matches the walk tabs", GROUPS.length > 20);
console.log(fails ? `${fails} of ${n} FAILED` : `ok: ${n} checks`);
process.exit(fails ? 1 : 0);
