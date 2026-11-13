// FICTIONAL G Squad Fitness data for the dev server only (never in a release build): three made up squad members with
// workouts, a run, sleep, a challenge, reactions and a comment, so the Squad screen and the compare sheet have
// something to draw without the hub. Load with /client/dev?squad#/fitness (src/App.tsx).
import { vaultStore } from "../core/vault";
import { todayISO } from "../ui/kit";
import type { FitWorkout } from "../core/fitness";
import { addDays, buildExRows, buildSleep, buildSum, type GymEx } from "../core/gymsquad";
import { makeLog } from "../core/sleep";
import { fitnessNow } from "../fitness/store";
import { activitiesNow } from "../fitness/activity-store";
import { sleepNow } from "../fitness/sleep-store";
import { __devGym } from "../squad/gym";
import { setChatOpener } from "../squad/chathook";
import type { GymOp, GymPostV, GymSquadView } from "../squad/gymview";

const ME = "00000000-0000-4000-8000-000000000001";
const PEOPLE = [
  { id: "00000000-0000-4000-8000-0000000000a1", name: "Sam" },
  { id: "00000000-0000-4000-8000-0000000000a2", name: "Kit" },
  { id: "00000000-0000-4000-8000-0000000000a3", name: "Ana" },
];
let sid = 0;
function wk(today: string, k: number, exs: [string, string | null, [number, number][]][]): { id: string; data: FitWorkout } {
  const d = addDays(today, k), at = `${d}T16:00:00.000Z`;
  return { id: `gw${++sid}`, data: { programId: null, dayId: null, dayName: "Free workout", week: 1, date: d, startedAt: at, endedAt: at, at,
    exercises: exs.map(([name, exId, sets], i) => ({ id: `ge${i}`, exId, name, at, sets: sets.map(([kg, reps]) => ({ id: `gs${++sid}`, kg, reps, rir: 2, done: true, at })) })) } };
}

export function loadGymFake() {
  const today = todayISO();
  const mine = () => { const f = fitnessNow(), s = sleepNow(); return { w: f.workouts.map((d) => ({ id: d.id, data: d.data })), a: activitiesNow(), f, s }; };
  const others = [
    { ws: [wk(today, -60, [["Barbell bench press", "barbell-bench-press", [[55, 8]]]]), wk(today, -20, [["Incline BB bench", null, [[70, 5]]]]), wk(today, -8, [["Barbell bench press", "barbell-bench-press", [[70, 6], [72.5, 4]]], ["Incline BB bench", null, [[75, 5]]]]),
      wk(today, -3, [["Incline BB bench", null, [[45, 8], [45, 8]]], ["Lat pulldown", "lat-pulldown", [[60, 10]]]]), wk(today, -1, [["Back squat", "back-squat", [[100, 5], [105, 3]]]])],
      acts: [], sleep: 6 },
    { ws: [wk(today, -40, [["Back squat", "back-squat", [[80, 5]]]]), wk(today, -2, [["Back squat", "back-squat", [[90, 5]]], ["Barbell bench press", "barbell-bench-press", [[50, 10]]]])],
      acts: [{ id: "gr1", data: { kind: "run" as const, date: addDays(today, -30), km: 5, secs: 1740, at: "x" } }, { id: "gr2", data: { kind: "run" as const, date: addDays(today, -1), km: 8.4, secs: 2700, at: "x" } }], sleep: 2 },
    { ws: [wk(today, -5, [["Incline barbell bench press", "incline-barbell-bench-press", [[40, 10]]]])], acts: [], sleep: 0 },
  ];
  const sums = others.map((o) => buildSum(o.ws, o.acts, today, 4));
  const rows = others.map((o) => buildExRows(o.ws, o.acts, today));
  const sleeps = others.map((o) => buildSleep(Array.from({ length: o.sleep }, (_, i) => makeLog({ start: Date.parse(`${addDays(today, -i)}T00:00:00Z`) - (7.5 + i / 4) * 3600e3, end: Date.parse(`${addDays(today, -i)}T00:00:00Z`), tz: "UTC" })!), {}, today));
  const ch = "00000000-0000-4000-8000-0000000000c1";
  let posts: GymPostV[] = [
    { id: ch, by: PEOPLE[0].id, at: new Date().toISOString(), post: { k: "ch", metric: "days", from: addDays(today, -3), to: addDays(today, 3), t: "Gym every other day" } },
    { id: "00000000-0000-4000-8000-0000000000c2", by: ME, at: new Date().toISOString(), post: { k: "join", ch } },
    { id: "00000000-0000-4000-8000-0000000000c3", by: PEOPLE[1].id, at: new Date().toISOString(), post: { k: "join", ch } },
  ];
  const pb = sums[0].pb[0];
  if (pb) posts.push(
    { id: "00000000-0000-4000-8000-0000000000d1", by: PEOPLE[1].id, at: new Date().toISOString(), post: { k: "re", to: PEOPLE[0].id, pb: pb.id, e: "🔥" } },
    { id: "00000000-0000-4000-8000-0000000000d2", by: PEOPLE[2].id, at: new Date().toISOString(), post: { k: "re", to: PEOPLE[0].id, pb: pb.id, e: "🔥" } },
    { id: "00000000-0000-4000-8000-0000000000d3", by: PEOPLE[1].id, at: new Date().toISOString(), post: { k: "cm", to: PEOPLE[0].id, pb: pb.id, t: "What are you eating, that jump is huge" } },
  );
  let share = { fitness: true, sleep: true };
  let exKey: string | null = null;
  const build = (): GymSquadView => {
    const m = mine();
    const meSum = share.fitness ? buildSum(m.w, m.a, today, m.f.prefs.weekGoal) : null;
    const meSleep = share.sleep ? buildSleep(m.s.days.values(), m.f.prefs, m.s.today) : null;
    const exRows: { member: string; ex: GymEx }[] = exKey ? rows.flatMap((r, i) => r.filter((e) => e.m === exKey).map((ex) => ({ member: PEOPLE[i].id, ex }))) : [];
    if (exKey && share.fitness) for (const ex of buildExRows(m.w, m.a, today).filter((e) => e.m === exKey)) exRows.push({ member: ME, ex });
    return {
      on: true, in: true, me: ME, share, loaded: true, error: null,
      members: [{ id: ME, name: "You", me: true, working: true }, ...PEOPLE.map((p, i) => ({ id: p.id, name: p.name, me: false, working: i === 0 }))],
      cards: [{ id: ME, sum: meSum, sleep: meSleep }, ...PEOPLE.map((p, i) => ({ id: p.id, sum: sums[i], sleep: sleeps[i] }))],
      posts, ex: exKey ? { key: exKey, loading: false, rows: exRows } : null,
    };
  };
  const onOp = (o: GymOp) => {
    if (o.op === "open") exKey = o.on ? o.ex ?? null : null;
    else if (o.op === "share") share = { ...share, [o.piece]: o.on };
    else if (o.op === "react") { posts = posts.filter((p) => !(p.by === ME && p.post.k === "re" && p.post.to === o.to && p.post.pb === o.pb)); if (o.e) posts.push({ id: crypto.randomUUID(), by: ME, at: new Date().toISOString(), post: { k: "re", to: o.to, pb: o.pb, e: o.e } }); }
    else if (o.op === "comment") posts.push({ id: crypto.randomUUID(), by: ME, at: new Date().toISOString(), post: { k: "cm", to: o.to, pb: o.pb, t: o.t } });
    else if (o.op === "unpost") posts = posts.filter((p) => p.id !== o.id);
    else if (o.op === "join") { posts = posts.filter((p) => !(p.by === ME && p.post.k === "join" && p.post.ch === o.ch)); if (o.on) posts.push({ id: crypto.randomUUID(), by: ME, at: new Date().toISOString(), post: { k: "join", ch: o.ch } }); }
    else if (o.op === "challenge") posts.push({ id: crypto.randomUUID(), by: ME, at: new Date().toISOString(), post: { k: "ch", metric: o.metric, from: o.from, to: addDays(o.from, o.days - 1), ...(o.t ? { t: o.t } : {}) } });
    __devGym(build(), onOp);
  };
  // ?chat: pretend the squad chat registered its opener, so the Message buttons draw (the dev page logs the request).
  if (location.search.includes("chat")) setChatOpener((r) => { (window as { __lastChat?: unknown }).__lastChat = r; });
  vaultStore.subscribe(() => __devGym(build(), onOp));
  __devGym(build(), onOp);
}
