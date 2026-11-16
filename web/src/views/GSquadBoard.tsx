// G Squad (V1.40): the Leaderboard tab (money made and tasks done) and the Screen time tab (each person's daily total,
// never an app). V1.43: what you made last month is added right here in the Leaderboard (the developer: "Make it so it
// doesn't pop up"), any day of the month, with only a quiet dot on the tab. Everything here comes ready made from the main
// page (squad/board.ts, core/squadboard.ts buildBoard): this window holds no key, and in the "rank" rule it never
// even receives another person's amount. Opted out pieces show as "Not shared".
import { useMemo, useState, type ReactNode } from "react";
import { MONEY_PERIODS, TASKS_PERIODS, cleanAmount, fmtMoney, placeLabel, type BoardEntry, type BoardView, type MoneyPeriod, type TasksPeriod } from "../core/squadboard";
import { allZones, HOME_COMMON, tzLabel } from "../core/tz";
import { boardOp } from "../squad/mirror";
import { registerSquadTab, TAB_ORDER, type SquadTabProps } from "../squad/tabs";
import type { SquadView } from "../squad/view";
import { sfx } from "../ui/sfx";
import { SharingList } from "./GSquad";
import { fmtUsd, monthLabel, monthShort, type PastEntry, type PastMonth } from "../core/squadpast";
import "./gsquadboard.css";

/** 3h 12m, 45m, under 1m. */
export function fmtSecs(secs: number) {
  const m = Math.floor(secs / 60);
  if (m < 1) return "under 1m";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
const nameOf = (v: SquadView) => { const m = new Map(v.members.map((x) => [x.id, x.me ? "You" : x.name])); return (id: string) => m.get(id) ?? "Someone"; };
const isMe = (v: SquadView, id: string) => id === v.me;

function Chips<T extends string>({ list, value, set, label }: { list: { id: T; label: string }[]; value: T; set: (v: T) => void; label: string }) {
  return (
    <div className="gsb-chips" role="radiogroup" aria-label={label}>
      {list.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={value === p.id} className={`gsb-chip${value === p.id ? " on" : ""}`}
          onClick={() => { if (value !== p.id) { sfx.hover(); set(p.id); } }}>{p.label}</button>
      ))}
    </div>
  );
}
function Place({ rank }: { rank: number | null }) {
  return <span className={`gsb-place${rank && rank <= 3 ? ` p${rank}` : ""}`} aria-label={rank ? `${placeLabel(rank)} place` : undefined}>{rank ?? ""}</span>;
}
function Row({ v, e, right, bar, sub }: { v: SquadView; e: BoardEntry; right?: ReactNode; bar?: number | null; sub?: ReactNode }) {
  const name = nameOf(v)(e.member);
  return (
    <li className={`gsb-row ${e.state}${isMe(v, e.member) ? " me" : ""}`}>
      <Place rank={e.state === "ok" ? e.rank : null} />
      <span className="gsb-who">{name}{sub && <em>{sub}</em>}
        {typeof bar === "number" && <i className="gsb-bar" aria-hidden="true"><b style={{ transform: `scaleX(${Math.max(0.02, Math.min(1, bar))})` }} /></i>}
      </span>
      <span className="gsb-val num">{right}</span>
    </li>
  );
}

// ---------- Leaderboard ----------
function Leaderboard({ view }: SquadTabProps) {
  const b = view.board;
  const [mp, setMp] = useState<MoneyPeriod>("1");
  const [tp, setTp] = useState<TasksPeriod>("month");
  if (!b) return <p className="gs-note">Loading...</p>;
  const money = b.money[mp] ?? [];
  const tasks = b.tasks[tp] ?? [];
  const exact = b.rules.show === "exact";
  const maxMoney = Math.max(1, ...money.map((e) => e.amount ?? 0));
  const maxTasks = Math.max(1, ...tasks.map((e) => e.n ?? 0));
  const months = Number(mp);
  return (
    <div className="gsb">
      {b.due && b.mine.on && <AddMonth b={b} month={b.due.month} label={b.due.label} />}
      <section className="gsb-sec">
        <div className="gsb-top">
          <span className="gs-h">{b.rules.money === "profit" ? "Profit" : "Money made"}</span>
          <Chips list={MONEY_PERIODS} value={mp} set={setMp} label="Money over" />
        </div>
        <ol className="gsb-list">
          {money.map((e) => (
            <Row key={e.member} v={view} e={e}
              sub={e.state === "ok" && (e.months ?? months) < months ? `${e.months} of ${months} months added` : undefined}
              bar={exact && e.state === "ok" && typeof e.amount === "number" ? e.amount / maxMoney : null}
              right={e.state === "off" ? <span className="gsb-off">Not shared</span> : e.state === "none" ? <span className="gsb-off">Not added yet</span>
                : typeof e.amount === "number" ? fmtMoney(e.amount, b.rules.currency) : <span className="gsb-off">{e.rank ? placeLabel(e.rank) : ""}</span>} />
          ))}
        </ol>
        {!b.loaded && <p className="gs-note">Loading...</p>}
        <p className="gs-note">{exact ? "Everyone in the squad sees these amounts." : "The squad sees only the order. Your own amount is only shown to you."}</p>
      </section>
      <section className="gsb-sec">
        <div className="gsb-top">
          <span className="gs-h">Tasks done</span>
          <Chips list={TASKS_PERIODS} value={tp} set={setTp} label="Tasks done over" />
        </div>
        <ol className="gsb-list">
          {tasks.map((e) => (
            <Row key={e.member} v={view} e={e} bar={e.state === "ok" ? (e.n ?? 0) / maxTasks : null}
              right={e.state === "ok" ? (e.n ?? 0) : <span className="gsb-off">Not shared</span>} />
          ))}
        </ol>
        <p className="gs-note">Counts only the tasks you share with G Squad; anonymised ones count too.</p>
      </section>
      {!!b.past?.length && <PastBoards past={b.past} />}
      <YourMoney b={b} />
      <SharingList only="money" />
    </div>
  );
}

// ---------- PS 1.64 Past boards: the monthly boards from before PS, read only (core/squadpast.ts) ----------
// Nothing shows while there are none (PS 1.64 ships with none; the squad's owner adds them). Newest month first;
// the month chips slide, the card fades in on each switch.
function PastBoards({ past }: { past: PastMonth[] }) {
  const [pick, setPick] = useState(past[0].month);
  const m = past.find((x) => x.month === pick) ?? past[0];
  return (
    <section className="gsb-sec gsb-past" aria-label="Past boards">
      <div className="gsb-top"><span className="gs-h">Past boards</span></div>
      <div className="gsb-months" role="tablist" aria-label="Month">
        {past.map((x) => (
          <button key={x.month} type="button" role="tab" aria-selected={x.month === m.month} className={`gsb-chip${x.month === m.month ? " on" : ""}`} title={monthLabel(x.month)}
            onClick={() => { if (x.month !== m.month) { sfx.hover(); setPick(x.month); } }}>{monthShort(x.month)}</button>
        ))}
      </div>
      <div key={m.month} className="gsb-pcard" role="tabpanel" aria-label={monthLabel(m.month)}>
        <p className="gsb-ptitle">{monthLabel(m.month)}{m.title && <em>{m.title}</em>}</p>
        {m.ranked.length > 0 && <ol className="gsb-list">{m.ranked.map((e, i) => <PastRow key={i} e={e} i={i} />)}</ol>}
        {!!m.notes?.length && <ul className="gsb-list">{m.notes.map((e, i) => <PastRow key={i} e={e} i={i + m.ranked.length} />)}</ul>}
        {(m.gulag.length > 0 || !!m.line) && (
          <div className="gsb-gulag">
            {m.lineNote && <span className="gsb-lnote">{m.lineNote}</span>}
            <p className="gsb-gtitle">{m.gulagTitle || "Gulag"}</p>
            {m.gulag.length > 0 && <ol className="gsb-list">{m.gulag.map((e, i) => <PastRow key={i} e={e} i={i + m.ranked.length + (m.notes?.length ?? 0)} />)}</ol>}
            {m.line && <p className="gsb-pline">{m.line}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
function PastRow({ e, i }: { e: PastEntry; i: number }) {
  return (
    <li className="gsb-row" style={{ animationDelay: `${Math.min(i, 14) * 24}ms` }}>
      <Place rank={e.place} />
      <span className="gsb-who">{e.names.join(" & ")}{e.note && <em>{e.note}</em>}</span>
      <span className="gsb-val num">{e.amount ? <span className="gsb-off">{e.amount}</span> : e.usd !== null ? fmtUsd(e.usd) : ""}</span>
    </li>
  );
}

/** What you added per month (only you see the amounts here): add a late one or fix a past month. And your time zone. */

function YourMoney({ b }: { b: BoardView }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => { const all = allZones(); return [...HOME_COMMON, ...all.filter((z) => !HOME_COMMON.includes(z))]; }, []);
  const save = (month: string) => {
    const a = cleanAmount(text, b.rules);
    if (a === null) return;
    sfx.click(); boardOp({ op: "money", month, amount: a }); setEdit(null);
  };
  return (
    <section className="gsb-sec gsb-mine">
      <button type="button" className="gsb-fold" aria-expanded={open} onClick={() => { sfx.hover(); setOpen(!open); }}>
        <span className="gs-h">Your amounts</span><i aria-hidden="true" className={open ? "on" : ""}>›</i>
      </button>
      {open && <>
        <ul className="gsb-list">
          {b.mine.months.map((m) => (
            <li key={m.month} className="gsb-row mine">
              <span className="gsb-who">{m.label}</span>
              {edit === m.month
                ? <form className="gsb-edit" onSubmit={(e) => { e.preventDefault(); save(m.month); }}>
                  <input autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Amount for ${m.label}`} placeholder="0" />
                  <button type="submit" className="gs-mini go" disabled={cleanAmount(text, b.rules) === null}>Save</button>
                  <button type="button" className="gs-mini" onClick={() => setEdit(null)}>Cancel</button>
                </form>
                : <>
                  <span className="gsb-val num">{m.amount !== null ? fmtMoney(m.amount, b.rules.currency) : <span className="gsb-off">{m.skipped ? "Skipped" : "Not added yet"}</span>}</span>
                  <button type="button" className="gs-mini" onClick={() => { setText(m.amount !== null ? String(m.amount) : ""); setEdit(m.month); }}>{m.amount !== null ? "Change" : "Add"}</button>
                </>}
            </li>
          ))}
        </ul>
        <label className="gsb-tz">
          <span>Your months start and end in</span>
          <select value={b.mine.tz} onChange={(e) => { sfx.click(); boardOp({ op: "tz", tz: e.target.value }); }}>
            {zones.map((z) => <option key={z} value={z}>{tzLabel(z)}</option>)}
          </select>
        </label>
      </>}
    </section>
  );
}

// ---------- Screen time ----------
const DOW = ["S", "M", "T", "W", "T", "F", "S"];
function ScreenTab({ view }: SquadTabProps) {
  const b = view.board;
  if (!b) return <p className="gs-note">Loading...</p>;
  const name = nameOf(view);
  const max = Math.max(3600, ...b.screen.flatMap((e) => e.week.map((x) => x ?? 0)));
  const dows = b.days.map((d) => { const [y, m, dd] = d.split("-").map(Number); return DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]; });
  return (
    <div className="gsb">
      <p className="gs-lead gsb-lead">Today's total for each person, Mac and phone together. Never which apps.</p>
      <ul className="gsb-list gsb-screen">
        {b.screen.map((e) => (
          <li key={e.member} className={`gsb-st ${e.state}${isMe(view, e.member) ? " me" : ""}`}>
            <div className="gsb-st-top">
              <span className="gsb-who">{name(e.member)}
                {e.state === "ok" && <em>{e.today === null ? "Nothing counted yet today" : [e.mac ? `Mac ${fmtSecs(e.mac)}` : "", e.phone ? `Phone ${fmtSecs(e.phone)}` : ""].filter(Boolean).join(", ")}</em>}
              </span>
              <span className="gsb-big num">{e.state === "off" ? <span className="gsb-off">Not shared</span> : e.today === null ? "0m" : fmtSecs(e.today)}</span>
            </div>
            {e.state === "ok" && (
              <div className="gsb-week" aria-label={`Last 7 days${e.avg !== null ? `, average ${fmtSecs(e.avg)} a day` : ""}`}>
                {e.week.map((x, i) => (
                  <span key={i} className={`gsb-day${i === 6 ? " today" : ""}`} title={x !== null ? fmtSecs(x) : "Nothing"}>
                    <i><b style={{ transform: `scaleY(${x ? Math.max(0.04, x / max) : 0})` }} /></i>
                    <small>{dows[i]}</small>
                  </span>
                ))}
                <span className="gsb-avg">{e.avg !== null ? <>7 day average<b className="num">{fmtSecs(e.avg)}</b></> : "No days before today yet"}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!b.loaded && <p className="gs-note">Loading...</p>}
      <p className="gs-note">Updated every 15 minutes while PS app runs. 1Password and Signal are never counted.</p>
      <SharingList only="screen" />
    </div>
  );
}

// ---------- what you made last month: added here, never a pop-up (V1.43) ----------
/** "Add what you made in October": from the 1st, for the whole month, so you can add it any day. */
function AddMonth({ b, month, label }: { b: BoardView; month: string; label: string }) {
  const [text, setText] = useState("");
  const amount = cleanAmount(text, b.rules);
  const sym = fmtMoney(0, b.rules.currency).replace(/[\d.,\s]/g, "") || b.rules.currency;
  return (
    <form className="gsb-sec gsb-add" aria-label={`Add what you made in ${label}`}
      onSubmit={(e) => { e.preventDefault(); if (amount === null) return; sfx.drop(); boardOp({ op: "money", month, amount }); setText(""); }}>
      <span className="gs-h">Add what you made in {label}</span>
      <p className="gs-note">{b.rules.money === "profit" ? "Your profit: what was left after costs." : "Your revenue: everything that came in, before costs."} Add it any day this month. {b.rules.show === "exact" ? "Your squad sees this amount." : "Your squad only sees where you rank, never the amount."}</p>
      <div className="gsb-add-row">
        <label className="gsb-add-in"><span aria-hidden="true">{sym}</span>
          <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="0" aria-label={`Amount for ${label}`} autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" className="gs-mini go" disabled={amount === null}>Save</button>
        <button type="button" className="gs-mini" onClick={() => { sfx.click(); boardOp({ op: "skip", month }); }} title="Hides this until next month. You can still add it under Your amounts.">Skip this month</button>
      </div>
    </form>
  );
}

// The quiet hint: a small dot on the tab while last month is not added (never with Money switched off).
registerSquadTab({ id: "leaderboard", title: "Leaderboard", order: TAB_ORDER.leaderboard, Panel: Leaderboard, dot: (v) => !!(v.board?.due && v.board.mine.on) });
registerSquadTab({ id: "screen", title: "Screen time", order: TAB_ORDER.screen, Panel: ScreenTab });
