// PS Fitness, the G Squad side (V1.40). The developer's choices (gsquad-decisions.md): boards Showed up, Personal bests,
// Percent better and Weekly volume, a Challenge screen, who you are competing with, reactions and comments on
// personal bests, Sleep from the Sleep log, other activities like a run, and a per exercise compare that shows each
// member's best, latest log and history for one exercise, with a Message button on someone's log.
// Drawn from the plain view (squad/gymview.ts, no keys); the rules are in core/gymsquad.ts, the hub side squad/gym.ts.
import { useLayoutEffect, useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { haptic } from "../gos/bridge";
import { todayISO } from "../ui/kit";
import type { FitView } from "./store";
import type { FitWorkout } from "../core/fitness";
import { useActivities } from "./activity-store";
import { fmtDayShort } from "./hist-logic";
import { gymOp, useGymLease, useGymSquad } from "../squad/gymclient";
import { picCardOpen } from "./ExPic";
import { Info } from "./Info";
import type { TermKey } from "./glossary";
/** V1.47: each board's word, behind the (i) beside its title. */
const BOARD_TERM: Record<string, TermKey> = { showed: "week-goal", pbs: "pb", better: "percent-better", volume: "volume", sleep: "sleep-settings" };
import { messageAbout, useChatOpener, MESSAGE_DRAFT } from "../squad/chathook";
import type { GymSquadView } from "../squad/gymview";
import {
  addDays, boards, buildExRows, challengeState, challengeTable, fmtScore, matchKey, mondayOf, pbLine, CH_LENGTHS, CH_METRICS, COMMENT_MAX, MATCH_WORDS, REACTIONS,
  type Board, type ChMetric, type ChallengeView, type ExSet, type GymEx, type GymPb, type Person, type PostCm, type PostRe,
} from "../core/gymsquad";
import { fmtPace, fmtTime, type ActKind } from "../core/activity";
import "./squad.css";

type Dated = { id: string; data: FitWorkout };
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const BEST_WORD: Record<GymPb["k"], string> = { kg: "Heaviest yet", e1rm: "Strongest set yet", reps: "Most reps at this weight", far: "Longest yet", pace: "Fastest pace yet", farpace: "Longest and fastest yet" };
const nbsp = (s: string) => s.replace(/ /g, " ");

/** The people of the squad with what each shares, for the boards. */
export function peopleOf(g: GymSquadView): Person[] {
  const cards = new Map(g.cards.map((c) => [c.id, c]));
  return g.members.map((m) => ({ id: m.id, name: m.me ? "You" : m.name, me: m.me, sum: cards.get(m.id)?.sum ?? null, sleep: cards.get(m.id)?.sleep ?? null }));
}
/** Challenges with who joined (the starter is always in). */
function challengesOf(g: GymSquadView): ChallengeView[] {
  const joins = new Map<string, Set<string>>();
  for (const p of g.posts) if (p.post.k === "join") { const s = joins.get(p.post.ch) ?? new Set(); s.add(p.by); joins.set(p.post.ch, s); }
  return g.posts.filter((p) => p.post.k === "ch").map((p) => {
    const c = p.post as Extract<typeof p.post, { k: "ch" }>;
    const j = new Set(joins.get(p.id) ?? []); j.add(p.by);
    return { id: p.id, by: p.by, metric: c.metric, from: c.from, to: c.to, ...(c.t ? { t: c.t } : {}), joined: [...j].filter((id) => g.members.some((m) => m.id === id)) };
  }).sort((a, b) => b.from.localeCompare(a.from));
}
const chTitle = (c: ChallengeView) => c.t || CH_METRICS.find((m) => m.k === c.metric)!.t;
function chWhen(c: ChallengeView, today: string) {
  const st = challengeState(c, today);
  const left = Math.round((Date.parse(`${c.to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5) + 1;
  return st === "soon" ? `Starts ${fmtDayShort(c.from)}` : st === "on" ? (left === 1 ? "Last day" : `${left} days left`) : `Ended ${fmtDayShort(c.to)}`;
}

// ======================================================================================================
// The Squad screen (phone: a sheet; Mac and website: a tab)
// ======================================================================================================
export function SquadScreen({ v, desk }: { v: FitView; desk?: boolean }) {
  const g = useGymSquad();
  useGymLease(g.on && g.in);
  const today = todayISO();
  const people = useMemo(() => peopleOf(g), [g]);
  const all = useMemo(() => boards(people, today), [people, today]);
  const chs = useMemo(() => challengesOf(g), [g]);
  const [board, setBoard] = useState<Board["id"]>("showed");
  const [newCh, setNewCh] = useState(false);
  const [cmp, setCmp] = useState<{ exId: string | null; name: string; act?: ActKind } | null>(null);

  if (!g.on) return <Shell desk={desk}><Empty title="G Squad is in the PS app" line="Open Fitness in PS app on your Mac or phone to see your squad's boards." /></Shell>;
  if (!g.in) return <Shell desk={desk}><Empty title="You are not in a G Squad yet" line="Make one or join one with the G Squad button in PS app on your Mac. Your boards show up here after that." /></Shell>;
  const b = all.find((x) => x.id === board)!;
  const mine = chs.filter((c) => c.joined.includes(g.me) && challengeState(c, today) !== "done");
  return (
    <Shell desk={desk}>
      {g.error && <p className="fq-err" role="status">{g.error}</p>}
      {!g.loaded && <p className="fq-muted" role="status">Loading your squad</p>}

      <section className="fq-card" aria-label="Who you are competing with">
        <h3 className="fq-h">Who you are competing with</h3>
        {mine.length ? mine.slice(0, 2).map((c) => <ChallengeMini key={c.id} c={c} people={people} today={today} />) : <Rivals people={people} today={today} />}
        <button type="button" className="fq-btn" onClick={() => { haptic("press"); setNewCh(true); }} disabled={!g.share.fitness}>Start a challenge</button>
        {!g.share.fitness && <p className="fq-muted">Switch Fitness on in What you share to start or join a challenge.</p>}
      </section>

      <section className="fq-card" aria-label="Boards">
        <div className="fq-seg" role="tablist" aria-label="Board">
          {all.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={board === x.id} className={cx(board === x.id && "on")} onClick={() => { haptic("press"); setBoard(x.id); }}>
              {x.id === "showed" ? "Showed up" : x.id === "pbs" ? "Bests" : x.id === "better" ? "Better" : x.id === "volume" ? "Volume" : "Sleep"}
            </button>
          ))}
        </div>
        <h3 className="fq-h">{b.title}<Info k={BOARD_TERM[board] ?? "week-goal"} /></h3>
        <p className="fq-line">{b.line}</p>
        <BoardList b={b} />
      </section>

      <Bests g={g} people={people} today={today} onCompare={(pb) => setCmp({ exId: pb.m.startsWith("id:") ? pb.m.slice(3) : null, name: pb.x, act: pb.a })} />

      <Challenges g={g} chs={chs} people={people} today={today} />

      <ShareSwitches g={g} />

      {newCh && <NewChallenge today={today} onClose={() => setNewCh(false)} />}
      {cmp && <SquadCompare workouts={v.workouts} ex={cmp} onClose={() => setCmp(null)} />}
    </Shell>
  );
}
function Shell({ desk, children }: { desk?: boolean; children: ReactNode }) {
  return <div className={cx("fq", desk && "fq-desk")}><div className="fq-col">{children}</div></div>;
}
function Empty({ title, line }: { title: string; line: string }) {
  return (
    <div className="fq-empty">
      <span className="fq-empty-i" aria-hidden="true"><PeopleIcon size={40} /></span>
      <h2>{title}</h2>
      <p>{line}</p>
    </div>
  );
}

function BoardList({ b }: { b: Board }) {
  if (!b.rows.length) return <p className="fq-muted">{b.id === "sleep" ? "Nobody shares sleep yet." : "Nobody shares Fitness yet."}</p>;
  return (
    <>
      <ol className="fq-board">
        {b.rows.map((r) => (
          <li key={r.id} className={cx(r.me && "me", r.rank === 1 && r.value != null && "top")}>
            <span className="fq-rank f-num">{r.rank}</span>
            <span className="fq-who"><b>{r.name}</b><small>{r.sub}</small></span>
            <span className="fq-val f-num">{nbsp(r.text)}</span>
          </li>
        ))}
      </ol>
      {b.missing > 0 && <p className="fq-muted">{b.missing === 1 ? "1 person does not share this." : `${b.missing} people do not share this.`}</p>}
    </>
  );
}

/** No challenge on: the people just ahead of you and just behind you on Showed up this week. */
function Rivals({ people, today }: { people: Person[]; today: string }) {
  const rows = boards(people, today)[0].rows;
  const i = rows.findIndex((r) => r.me);
  if (i < 0) return <p className="fq-muted">Share Fitness to see who is close to you.</p>;
  if (rows.length < 2) return <p className="fq-muted">Nobody else shares Fitness yet.</p>;
  const ahead = i > 0 ? rows[i - 1] : null, behind = i < rows.length - 1 ? rows[i + 1] : null, me = rows[i];
  const gap = (a: number | null, b: number | null) => Math.abs((a ?? 0) - (b ?? 0));
  return (
    <ul className="fq-rivals">
      {ahead && <li><b>{ahead.name}</b> {gap(ahead.value, me.value) === 0 ? "is level with you this week" : `is ${gap(ahead.value, me.value) === 1 ? "1 day" : `${gap(ahead.value, me.value)} days`} ahead of you this week`}</li>}
      {behind && <li><b>{behind.name}</b> {gap(behind.value, me.value) === 0 ? "is level with you this week" : `is ${gap(behind.value, me.value) === 1 ? "1 day" : `${gap(behind.value, me.value)} days`} behind you this week`}</li>}
      {!ahead && <li>You are top for days this week.</li>}
    </ul>
  );
}

function ChallengeMini({ c, people, today }: { c: ChallengeView; people: Person[]; today: string }) {
  const t = challengeTable(c, people).slice(0, 5);
  return (
    <div className="fq-chmini">
      <p className="fq-chmini-h"><b>{chTitle(c)}</b><span>{chWhen(c, today)}</span></p>
      <ol className="fq-board fq-board-s">
        {t.map((r) => (
          <li key={r.id} className={cx(r.me && "me")}>
            <span className="fq-rank f-num">{r.rank}</span>
            <span className="fq-who"><b>{r.me ? "You" : r.name}</b></span>
            <span className="fq-val f-num">{nbsp(fmtScore(c.metric, r.score))}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- personal bests: reactions and comments ----------
function Bests({ g, people, today, onCompare }: { g: GymSquadView; people: Person[]; today: string; onCompare: (pb: GymPb) => void }) {
  const month = addDays(today, -29);
  const items = useMemo(() => people.flatMap((p) => (p.sum?.pb ?? []).filter((b) => b.d >= month).map((pb) => ({ p, pb })))
    .sort((a, b) => b.pb.d.localeCompare(a.pb.d)).slice(0, 20), [people, month]);
  return (
    <section className="fq-card" aria-label="Personal bests">
      <h3 className="fq-h">Personal bests</h3>
      {!items.length ? <p className="fq-muted">No new bests in the squad in the last 30 days.</p> : (
        <ul className="fq-pbs">
          {items.map(({ p, pb }) => <PbItem key={`${p.id}:${pb.id}`} g={g} p={p} pb={pb} onCompare={() => onCompare(pb)} />)}
        </ul>
      )}
    </section>
  );
}
function PbItem({ g, p, pb, onCompare }: { g: GymSquadView; p: Person; pb: GymPb; onCompare: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const chat = useChatOpener();
  const re = g.posts.filter((x) => x.post.k === "re" && (x.post as PostRe).to === p.id && (x.post as PostRe).pb === pb.id);
  const cms = g.posts.filter((x) => x.post.k === "cm" && (x.post as PostCm).to === p.id && (x.post as PostCm).pb === pb.id).sort((a, b) => a.at.localeCompare(b.at));
  const mine = re.find((x) => x.by === g.me)?.post as PostRe | undefined;
  const nameOf = (id: string) => (id === g.me ? "You" : g.members.find((m) => m.id === id)?.name ?? "Someone");
  const can = g.share.fitness;
  const send = () => { const t = text.trim(); if (!t) return; haptic("press"); gymOp({ op: "comment", to: p.id, pb: pb.id, t }); setText(""); };
  return (
    <li className="fq-pb">
      <div className="fq-pb-top">
        <span className="fq-pb-i" aria-hidden="true"><StarIcon /></span>
        <span className="fq-pb-t">
          <b>{p.name}</b>
          <span>{pbLine(pb)}</span>
          <small>{BEST_WORD[pb.k]} · {fmtDayShort(pb.d)}</small>
        </span>
      </div>
      <div className="fq-pb-bar">
        {REACTIONS.map((e) => {
          const n = re.filter((x) => (x.post as PostRe).e === e).length, on = mine?.e === e;
          return (
            <button key={e} type="button" className={cx("fq-re", on && "on")} aria-pressed={on} disabled={!can}
              aria-label={`${on ? "Take back" : "React"} ${e}${n ? `, ${n}` : ""}`}
              onClick={() => { haptic("press"); gymOp({ op: "react", to: p.id, pb: pb.id, e: on ? null : e }); }}>
              <span aria-hidden="true">{e}</span>{n > 0 && <small className="f-num">{n}</small>}
            </button>
          );
        })}
        <button type="button" className={cx("fq-cm-b", open && "on")} aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChatIcon /> {cms.length ? cms.length : ""}<span className="fq-sr">{cms.length === 1 ? " comment" : " comments"}</span>
        </button>
      </div>
      {open && (
        <div className="fq-cms">
          {cms.map((c) => (
            <p key={c.id} className="fq-cm">
              <b>{nameOf(c.by)}</b> {(c.post as PostCm).t}
              {c.by === g.me && <button type="button" className="fq-x" onClick={() => gymOp({ op: "unpost", id: c.id })} aria-label="Delete your comment">Delete</button>}
            </p>
          ))}
          {can ? (
            <form className="fq-cm-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input value={text} maxLength={COMMENT_MAX} onChange={(e) => setText(e.target.value)} placeholder="Say something" aria-label={`Comment on ${p.name}'s best`} />
              <button type="submit" className="fq-btn fq-btn-s" disabled={!text.trim()}>Send</button>
            </form>
          ) : <p className="fq-muted">Switch Fitness on in What you share to react or comment.</p>}
          <div className="fq-pb-more">
            <button type="button" className="fq-link" onClick={onCompare}>Compare this exercise</button>
            {chat && !p.me && <button type="button" className="fq-link" onClick={() => messageAbout({ to: p.id, name: p.name, about: { k: "gym", l: `${pbLine(pb)}, ${fmtDayShort(pb.d)}`, w: p.id }, draft: MESSAGE_DRAFT })}>Message {p.name}</button>}
          </div>
        </div>
      )}
    </li>
  );
}

// ---------- challenges ----------
function Challenges({ g, chs, people, today }: { g: GymSquadView; chs: ChallengeView[]; people: Person[]; today: string }) {
  const shown = chs.filter((c) => c.to >= addDays(today, -14)).slice(0, 8);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="fq-card" aria-label="Challenges">
      <h3 className="fq-h">Challenges</h3>
      {!shown.length ? <p className="fq-muted">No challenges yet. Start one to compete with the squad over a week or a month.</p> : (
        <ul className="fq-chs">
          {shown.map((c) => {
            const inIt = c.joined.includes(g.me), st = challengeState(c, today), mineC = c.by === g.me;
            return (
              <li key={c.id} className={cx("fq-ch", st)}>
                <button type="button" className="fq-ch-h" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <b>{chTitle(c)}</b>
                  <span>{fmtDayShort(c.from)} to {fmtDayShort(c.to)} · {chWhen(c, today)} · {c.joined.length === 1 ? "1 in" : `${c.joined.length} in`}</span>
                </button>
                {open === c.id && <ChallengeMini c={c} people={people} today={today} />}
                {st !== "done" && (
                  <div className="fq-ch-b">
                    {!mineC && <button type="button" className={cx("fq-btn fq-btn-s", inIt && "ghost")} disabled={!g.share.fitness} onClick={() => { haptic("press"); gymOp({ op: "join", ch: c.id, on: !inIt }); }}>{inIt ? "Leave" : "Join"}</button>}
                    {mineC && <button type="button" className="fq-btn fq-btn-s ghost" onClick={() => { haptic("press"); gymOp({ op: "unpost", id: c.id }); }}>Cancel challenge</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
function NewChallenge({ today, onClose }: { today: string; onClose: () => void }) {
  const [metric, setMetric] = useState<ChMetric>("days");
  const [days, setDays] = useState<number>(7);
  const nextMon = addDays(mondayOf(today), 7);
  const [from, setFrom] = useState(today);
  const [name, setName] = useState("");
  return (
    <Modal label="Start a challenge" onClose={onClose}>
      {(close) => (
        <div className="fq-form">
          <h3 className="fq-h">Start a challenge</h3>
          <p className="fq-line">Everyone in the squad sees it and can join. Scores come from what each person shares.</p>
          <p className="fq-lab">What counts</p>
          <div className="fq-chips">
            {CH_METRICS.map((m) => <button key={m.k} type="button" className={cx(metric === m.k && "on")} aria-pressed={metric === m.k} onClick={() => setMetric(m.k)}><b>{m.t}</b><small>{m.line}</small></button>)}
          </div>
          <p className="fq-lab">How long</p>
          <div className="fq-chips row">
            {CH_LENGTHS.map((n) => <button key={n} type="button" className={cx(days === n && "on")} aria-pressed={days === n} onClick={() => setDays(n)}>{n === 7 ? "1 week" : n === 14 ? "2 weeks" : "4 weeks"}</button>)}
          </div>
          <p className="fq-lab">Starts</p>
          <div className="fq-chips row">
            <button type="button" className={cx(from === today && "on")} aria-pressed={from === today} onClick={() => setFrom(today)}>Today</button>
            <button type="button" className={cx(from === nextMon && "on")} aria-pressed={from === nextMon} onClick={() => setFrom(nextMon)}>Monday {fmtDayShort(nextMon)}</button>
          </div>
          <label className="fq-lab">Name <small>(optional)</small>
            <input className="fq-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={CH_METRICS.find((m) => m.k === metric)!.t} />
          </label>
          <button type="button" className="fq-btn fq-btn-go" onClick={() => { haptic("press"); gymOp({ op: "challenge", metric, days, from, ...(name.trim() ? { t: name.trim() } : {}) }); close(); }}>Start it</button>
        </div>
      )}
    </Modal>
  );
}

// ---------- what you share ----------
/** Fitness settings shows the same switches (V1.43: settings never only at the bottom of a page). */
export function SquadShareSettings() {
  const g = useGymSquad();
  if (!g.on || !g.in) return <p className="fq-muted">Join a G Squad first: the switches for what you share show here after that.</p>;
  return <div className="fq fq-in-settings"><ShareSwitches g={g} /></div>;
}
function ShareSwitches({ g }: { g: GymSquadView }) {
  const row = (piece: "fitness" | "sleep", title: string, line: string) => {
    const on = g.share[piece];
    return (
      <button type="button" className="fq-sw" role="switch" aria-checked={on} onClick={() => { haptic("press"); gymOp({ op: "share", piece, on: !on }); }}>
        <span className="fq-sw-t"><b>{title}</b><small>{line}</small></span>
        <span className={cx("fq-sw-k", on && "on")} aria-hidden="true"><i /></span>
      </button>
    );
  };
  return (
    <section className="fq-card" aria-label="What you share">
      <h3 className="fq-h">What you share</h3>
      {row("fitness", "Fitness", "Days trained, each day's volume and distance, personal bests, percent better, and per exercise your best and last 10 sessions' sets. Never notes or RIR.")}
      {row("sleep", "Sleep", "Last night's hours, this week's average, nights on target and your streak. Never times or how rested you felt.")}
      <p className="fq-muted">Switched off, nothing of it is encrypted for the squad or sent, and what the squad had is deleted.</p>
    </section>
  );
}

// ======================================================================================================
// Per exercise compare
// ======================================================================================================
/** The small "Squad" button on an exercise (gym screen, history), opening the compare sheet. Only in a squad. */
export function SquadChip({ workouts, ex, className }: { workouts: Dated[]; ex: { exId: string | null; name: string }; className?: string }) {
  const g = useGymSquad();
  const [open, setOpen] = useState(false);
  if (!g.on || !g.in) return null;
  return (
    <>
      <button type="button" className={className ?? "fq-chip"} onClick={() => { haptic("press"); setOpen(true); }} aria-label={`Compare ${ex.name} with your squad`} title="Compare with your squad">
        <PeopleIcon size={18} /><span>Squad</span>
      </button>
      {open && <SquadCompare workouts={workouts} ex={ex} onClose={() => setOpen(false)} />}
    </>
  );
}

const setsLine = (sets: ExSet[], each?: boolean) => sets.map(([kg, r, d]) => (kg != null && r != null ? `${Math.round(kg * 100) / 100}${each ? " each" : ""} x ${r}` : kg != null ? `${kg} kg` : `${r} reps`) + (d ? " DROP" : "")).join(", ");
const actLine = (kind: ActKind, l: [number, number][]) => l.map(([km, s]) => `${Math.round(km * 100) / 100} km in ${fmtTime(s)} (${fmtPace(kind, km, s)})`).join(", ");
function bestText(ex: GymEx) {
  if (ex.t === "lift") return ex.b ? `${Math.round(ex.b.kg * 100) / 100} kg${ex.e ? " each" : ""} x ${ex.b.r} · ${fmtDayShort(ex.b.d)}` : "No weight logged";
  return [ex.b ? `Longest ${Math.round(ex.b.km * 100) / 100} km` : "", ex.p ? `fastest ${fmtPace(ex.a, 1, ex.p.s)}` : ""].filter(Boolean).join(" · ") || "Nothing yet";
}
const lastText = (ex: GymEx) => { const s = ex.s[0]; if (!s) return ""; return ex.t === "lift" ? setsLine(s[1] as ExSet[], !!ex.e) : actLine(ex.a, s[1] as [number, number][]); };

export function SquadCompare({ workouts, ex, onClose }: { workouts: Dated[]; ex: { exId: string | null; name: string; act?: ActKind }; onClose: () => void }) {
  const g = useGymSquad();
  const key = ex.act ? `act:${ex.act}` : matchKey(ex);
  useGymLease(g.on && g.in, key);
  const acts = useActivities();
  const today = todayISO();
  const mine = useMemo(() => buildExRows(workouts, acts, today).find((r) => r.m === key) ?? null, [workouts, acts, today, key]);
  const rows = useMemo(() => {
    const others = g.ex?.key === key ? g.ex.rows.filter((r) => r.member !== g.me) : [];
    const list = [...(mine ? [{ member: g.me, ex: mine }] : []), ...others];
    const score = (e: GymEx) => (e.t === "lift" ? e.x : e.p ? -e.p.s : 0);
    return list.sort((a, b) => score(b.ex) - score(a.ex));
  }, [g.ex, g.me, key, mine]);
  const loading = g.ex?.key !== key || g.ex.loading;
  const nameOf = (id: string) => (id === g.me ? "You" : g.members.find((m) => m.id === id)?.name ?? "Someone");
  const otherNames = rows.filter((r) => r.member !== g.me && r.ex.n.toLowerCase() !== ex.name.toLowerCase());
  return (
    <Modal label={`${ex.name} in your squad`} onClose={onClose} tall>
      {() => (
        <div className="fq-cmp">
          <p className="fq-kick">Squad compare</p>
          <h3 className="fq-cmp-h">{ex.name}</h3>
          {!g.on || !g.in ? <p className="fq-muted">Compare works when you are in a G Squad, in PS app on your Mac or phone.</p> : (
            <>
              {loading && rows.length <= 1 && <p className="fq-muted" role="status">Loading the squad's logs</p>}
              {!loading && rows.length <= (mine ? 1 : 0) && <p className="fq-muted">Nobody else in the squad has logged this yet.</p>}
              <ol className="fq-cmp-list">
                {rows.map((r, i) => <CompareRow key={`${r.member}:${i}`} rank={i + 1} name={nameOf(r.member)} me={r.member === g.me} member={r.member} ex={r.ex} />)}
              </ol>
              {otherNames.length > 0 && <p className="fq-muted">{otherNames.map((r) => `${nameOf(r.member)} calls it ${r.ex.n}`).join(". ")}.</p>}
              <p className="fq-help">{MATCH_WORDS}</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
function CompareRow({ rank, name, me, member, ex }: { rank: number; name: string; me: boolean; member: string; ex: GymEx }) {
  const [open, setOpen] = useState(false);
  const chat = useChatOpener();
  const last = ex.s[0];
  return (
    <li className={cx("fq-cmp-r", me && "me")}>
      <div className="fq-cmp-top">
        <span className="fq-rank f-num">{rank}</span>
        <span className="fq-who"><b>{name}</b><small>{ex.c === 1 ? "1 session" : `${ex.c} sessions`}</small></span>
      </div>
      <dl className="fq-cmp-d">
        <div><dt>Best</dt><dd className="f-num">{bestText(ex)}</dd></div>
        {last && <div><dt>Latest</dt><dd><span className="f-num">{lastText(ex)}</span> <small>{fmtDayShort(last[0])}</small></dd></div>}
      </dl>
      <div className="fq-cmp-b">
        {ex.s.length > 1 && <button type="button" className="fq-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide history" : "History"}</button>}
        {chat && !me && last && (
          <button type="button" className="fq-link" onClick={() => messageAbout({ to: member, name, about: { k: "gym", l: `${ex.n} ${lastText(ex)}, ${fmtDayShort(last[0])}`.slice(0, 160), w: member }, draft: MESSAGE_DRAFT })}>
            <ChatIcon /> Message
          </button>
        )}
      </div>
      {open && (
        <ol className="fq-hist">
          {ex.s.map(([d, sets], i) => (
            <li key={`${d}:${i}`}><small>{fmtDayShort(d)}</small><span className="f-num">{ex.t === "lift" ? setsLine(sets as ExSet[], !!ex.e) : actLine(ex.a, sets as [number, number][])}</span></li>
          ))}
        </ol>
      )}
    </li>
  );
}

// ---------- the sheet ----------
// Open sheets in a stack, with ONE back and Escape listener added when this file loads (so before any screen's own):
// the phone's back gesture and Esc close the newest sheet first, never the Fitness sheet under it.
const openSheets: (() => void)[] = [];
if (typeof window !== "undefined") {
  const top = (e: Event) => { const f = openSheets[openSheets.length - 1]; if (!f || picCardOpen()) return; e.preventDefault(); e.stopImmediatePropagation(); f(); };
  window.addEventListener("gos-back", top, true);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") top(e); }, true);
}
export function Modal({ label, onClose, tall, children }: { label: string; onClose: () => void; tall?: boolean; children: (close: () => void) => ReactNode }) {
  const [out, setOut] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const gone = useRef(false);
  const close = () => { if (gone.current) return; gone.current = true; setOut(true); window.setTimeout(() => closeRef.current(), 240); };
  const closeFn = useRef(close);
  closeFn.current = close;
  useEffect(() => {
    const f = () => closeFn.current();
    openSheets.push(f);
    return () => { const i = openSheets.lastIndexOf(f); if (i >= 0) openSheets.splice(i, 1); };
  }, []);
  // Drawn at the Fitness root (its look's tokens), never inside a sliding sheet, which would carry it off screen.
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost((anchor.current?.closest(".fit") as HTMLElement | null) ?? document.body); }, []);
  const sheet = (
    <div className={cx("fq fq-ov", out && "out", tall && "tall")} role="dialog" aria-modal="true" aria-label={label}>
      <div className="fq-ov-bg" onClick={close} />
      <div className="fq-sheet">
        <button type="button" className="fq-close" onClick={close} aria-label="Close"><XIcon /></button>
        {children(close)}
      </div>
    </div>
  );
  return <><span ref={anchor} hidden />{host && createPortal(sheet, host)}</>;
}

// ---------- icons ----------
function Svg({ size = 20, children, w = 2.2 }: { size?: number; children: ReactNode; w?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
export const PeopleIcon = ({ size = 20 }: { size?: number }) => <Svg size={size}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.2c2.4-.2 4 1.3 4.6 4.3" /></Svg>;
const StarIcon = () => <Svg size={20}><path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" /></Svg>;
const ChatIcon = () => <Svg size={17}><path d="M20 12.5a7.5 7.5 0 0 1-11 6.6L4 20l1-4.3A7.5 7.5 0 1 1 20 12.5z" /></Svg>;
const XIcon = () => <Svg size={20} w={2.6}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
