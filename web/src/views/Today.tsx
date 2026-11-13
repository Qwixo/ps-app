// The home screen: everything that needs the developer today, in one calm view.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RadarToday } from "./RadarLive";
import type { Doc, Todo } from "../core/model";
import { PIPELINE, currentStage, progressPct, stageState, startsLater } from "../core/model";
import { agenda, clientViews, drafts, meetings, openReplies, owedTotals, projectViews, settingsData, todos, type AgendaItem, type ProjectView } from "../core/select";
import { toggleTodo } from "../core/actions";
import { Icon, daysFromToday, fmtDate, greeting, money, relDate, sumMoney, toast, useVault } from "../ui/kit";
import { ResetButton, relTime } from "./Todo";
import { RepliesCard } from "./Replies";
import { isRedAccount } from "../core/account";
import { MorningBrief, YourNumbers } from "./MorningBrief";
import { Chevron, Collapse } from "./Accordion";
import { MiniList, MiniToggle, miniAllDone, useMiniOpen, useSubOpenList } from "./MiniTasks";
import "./todo.css";
import "./today.css";

const isActive = (pv: ProjectView) => !pv.p.archived && pv.p.pipeline !== "lead" && pv.p.pipeline !== "finished" && !startsLater(pv.p);
const projectHref = (pv: ProjectView) => pv.client ? `#/client/${pv.client.id}/project/${pv.doc.id}` : "#/clients";

/** relDate, lower-cased when it reads as a phrase: "Delivery in 3 days", "Delivery Wed 21 Oct". */
function softRel(iso: string) {
  const r = relDate(iso);
  return /^(Today|Tomorrow|Yesterday|In )/.test(r) ? r.charAt(0).toLowerCase() + r.slice(1) : r;
}

function tick(id: string, title: string) {
  void toggleTodo(id).then(() => toast(`Ticked off: ${title}`, { label: "Undo", run: () => { void toggleTodo(id); } }));
}

/** Purple tick: Claude finished this to-do in a chat. The developer's own tick still completes it. */
function ClaudeTick({ t }: { t?: Doc<Todo> }) {
  if (!t?.data.claudeDoneAt || t.data.done) return null;
  const tip = `Claude finished this${t.data.claudeNote ? `: ${t.data.claudeNote}` : ""}`;
  return (
    <button type="button" className="tv-claude" title={tip} aria-label={tip} onClick={(e) => { e.preventDefault(); e.stopPropagation(); toast(tip); }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
      Claude
    </button>
  );
}

function ItemPill({ i }: { i: AgendaItem }) {
  if (i.kind === "approval") return <span className="pill good">Approved</span>;
  if (i.late) return <span className="pill bad">Overdue</span>;
  if (i.today) return <span className="pill amber">Today</span>;
  if (i.due) return <span className="pill ink num">{relDate(i.due)}</span>;
  return <span className="pill plain">Anytime</span>;
}

// Mini tasks on Today: Undo comes as a toast here (the Tab list has its own Undo button).
const miniUndo = (id: string, title: string, run: () => void) =>
  toast(`${id.startsWith("mini-rm:") ? "Deleted" : "Ticked off"}: ${title}`, { label: "Undo", run });
function useTodayMini(t?: Doc<Todo>) {
  const saved = useSubOpenList();
  const fake = { id: "", ws: null, kind: "todo", author: null, updatedAt: null, data: { title: "", type: "once", done: false, order: 0 } } as unknown as Doc<Todo>;
  const mini = useMiniOpen(t ?? fake, saved);
  return t ? { ...mini, all: miniAllDone(t) } : null;
}

function AgendaRow({ i, t }: { i: AgendaItem; t?: Doc<Todo> }) {
  const isTodo = i.kind === "todo" && !!i.docId;
  const lateBy = i.late && i.due && i.kind !== "approval" ? relDate(i.due) : "";
  const mini = useTodayMini(isTodo ? t : undefined);
  return (
    <li className={`tv-item${i.late && i.kind !== "approval" ? " late" : ""}${mini ? " has-mini" : ""}${mini?.open ? " mini-open" : ""}${mini?.all ? " mini-all" : ""}`}>
      <span className="tv-pillcol">
        {isTodo && (
          <input type="checkbox" className="check" checked={false} onChange={() => tick(i.docId!, i.title)} aria-label={`Tick off: ${i.title}`} />
        )}
        <ItemPill i={i} />
      </span>
      <span className="tv-text">
        <span className="tv-who trunc">{i.who || (isTodo ? "Your list" : "")}</span>
        {i.href && !isTodo ? <a className="tv-what" href={i.href}>{i.title}</a> : <span className="tv-what">{i.title}</span>}
      </span>
      <ClaudeTick t={t} />
      {mini && t && <MiniToggle d={t} open={mini.open} onToggle={mini.toggle} />}
      {lateBy && <span className="xs err num" style={{ flex: "none" }}>{lateBy}</span>}
      {i.href && <a className="tv-go btn quiet icon" href={i.href} aria-label={`Open: ${i.title}`}><Icon name="arrow" size={16} /></a>}
      {mini && t && <MiniList d={t} open={mini.open} onUndo={miniUndo} />}
    </li>
  );
}

function DailyRow({ d }: { d: Doc<Todo> }) {
  const mini = useTodayMini(d)!;
  return (
    <div className={`tv-mini${mini.open ? " mini-open" : ""}${mini.all ? " mini-all" : ""}`}>
      <div className="tv-mini-line">
        <label className={d.data.done ? "done" : undefined}>
          <input type="checkbox" className="check" checked={d.data.done} onChange={() => void toggleTodo(d.id)} />
          <span>{d.data.title}</span>
          <ClaudeTick t={d} />
        </label>
        <MiniToggle d={d} open={mini.open} onToggle={mini.toggle} />
      </div>
      <div className="tv-mini-panel"><MiniList d={d} open={mini.open} onUndo={miniUndo} /></div>
    </div>
  );
}

function DailyCard({ daily }: { daily: Doc<Todo>[] }) {
  const doneN = daily.filter((d) => d.data.done).length;
  const pct = daily.length ? Math.round((doneN / daily.length) * 100) : 0;
  return (
    <section className="panel stack" aria-labelledby="tv-daily-h">
      <div className="tv-card-h">
        <div className="stack tight" style={{ gap: 2 }}>
          <h2 className="h2" id="tv-daily-h">Your daily list</h2>
          {daily.length > 0 && <span className="small muted num">{doneN} of {daily.length} done</span>}
        </div>
        <ResetButton small label="Reset" />
      </div>
      {daily.length > 0 ? (
        <>
          <div className="progress" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
          <div className="tv-daily">
            {daily.map((d) => <DailyRow key={d.id} d={d} />)}
          </div>
        </>
      ) : <p className="empty">Add the things you do every day, like Gym, and tick them off here.</p>}
      <a className="btn ghost sm" href="#/todo" style={{ justifySelf: "start" }}>Open your full list <Icon name="arrow" size={15} /></a>
    </section>
  );
}

interface ClientGroup { ws: string; name: string; projects: ProjectView[] }

function projState(pv: ProjectView) {
  const st = currentStage(pv.p);
  const waiting = pv.priv?.data.waitingOn === "client" || (st ? stageState(pv.p, pv.p.current) === "waiting" : false);
  const pd = pv.p.promisedDelivery;
  const notDone = pv.p.current < pv.p.stages.length;
  const pdLate = !!pd && daysFromToday(pd) < 0 && notDone;
  const nd = pv.priv?.data.nextDue;
  const nextLate = !!nd && !!pv.priv?.data.nextStep && pv.priv?.data.waitingOn !== "client" && daysFromToday(nd) < 0;
  return { st, waiting, pct: progressPct(pv.p), pd: notDone ? pd : null, pdLate, overdue: pdLate || nextLate };
}

function ProjectsCard({ list }: { list: ProjectView[] }) {
  const groups: ClientGroup[] = [];
  for (const pv of list) {
    let g = groups.find((x) => x.ws === pv.ws);
    if (!g) { g = { ws: pv.ws, name: pv.client?.data.name || "Client", projects: [] }; groups.push(g); }
    g.projects.push(pv);
  }
  // Tapped rows remember their state; untouched rows follow the default (only the first open).
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const isOpen = (ws: string, i: number) => touched[ws] ?? i === 0;

  return (
    <section className="panel stack" aria-labelledby="tv-proj-h">
      <div className="tv-card-h">
        <div className="stack tight" style={{ gap: 2 }}>
          <h2 className="h2" id="tv-proj-h">Projects in motion</h2>
          {list.length > 0 && <span className="small muted num">{list.length} project{list.length > 1 ? "s" : ""}, {groups.length} client{groups.length > 1 ? "s" : ""}</span>}
        </div>
        <a className="btn quiet sm" href="#/clients">All clients</a>
      </div>
      {groups.length ? (
        <ul className="acc-groups">
          {groups.map((g, gi) => {
            const open = isOpen(g.ws, gi);
            const states = g.projects.map(projState);
            const overdue = states.some((x) => x.overdue);
            const waiting = states.some((x) => x.waiting);
            const avg = Math.round(states.reduce((n, x) => n + x.pct, 0) / states.length);
            const nextPd = states.map((x) => x.pd).filter((x): x is string => !!x).sort()[0];
            const chip = overdue ? <span className="pill bad">Overdue</span> : waiting ? <span className="pill amber">Waiting on them</span> : null;
            const chipM = overdue ? <span className="pill bad acc-chip-m">Overdue</span> : waiting ? <span className="pill amber acc-chip-m">Waiting on them</span> : null;
            const bodyId = `tv-grp-${g.ws}`;
            return (
              <li key={g.ws} className={`acc-group${open ? " open" : ""}${overdue ? " bad" : waiting ? " amber" : ""}`}>
                <button type="button" className="acc-row" aria-expanded={open} aria-controls={bodyId}
                  onClick={() => setTouched((t) => ({ ...t, [g.ws]: !open }))}>
                  <span className="acc-mono" aria-hidden="true">{g.name.charAt(0).toUpperCase()}</span>
                  <span className="acc-main">
                    <span className="acc-name">{g.name}</span>
                    <span className="acc-sub num">
                      {g.projects.length} active project{g.projects.length > 1 ? "s" : ""}{nextPd ? `, next delivery ${softRel(nextPd)}` : ""}
                    </span>
                    {chipM}
                    <span className={`acc-mini${waiting ? " amber" : ""}`} aria-hidden="true"><i style={{ width: `${avg}%` }} /></span>
                  </span>
                  <span className="acc-side">
                    {chip}
                    <span className="num xs muted acc-pct">{avg}%</span>
                    <Chevron open={open} />
                  </span>
                </button>
                <Collapse open={open} id={bodyId}>
                  <ul className="tv-pjs">
                    {g.projects.map((pv, i) => {
                      const x = states[i];
                      const pipe = PIPELINE.find((y) => y.key === pv.p.pipeline)?.label;
                      const nextLine = x.waiting && pv.priv?.data.waitingWhat ? `Waiting for: ${pv.priv.data.waitingWhat}`
                        : pv.priv?.data.nextStep ? `Next: ${pv.priv.data.nextStep}` : "";
                      return (
                        <li key={pv.doc.id}>
                          <a className={`tv-pj${x.waiting ? " amber" : ""}`} href={projectHref(pv)}>
                            <span className="tv-pj-top">
                              <b className="tv-pj-name">{pv.p.title}</b>
                              {x.waiting ? <span className="pill amber">Waiting</span> : pipe ? <span className="pill plain">{pipe}</span> : null}
                            </span>
                            <span className="row between small">
                              <span className="trunc">{x.st ? x.st.name : "All stages done"}</span>
                              <span className="num muted">{x.pct}%</span>
                            </span>
                            <span className={`progress${x.waiting ? " amber" : ""}`} aria-hidden="true"><i style={{ width: `${x.pct}%` }} /></span>
                            {(x.pd || nextLine) && (
                              <span className="tv-pj-foot">
                                {x.pd && <span className={x.pdLate ? "late" : undefined}>Delivery {softRel(x.pd)}</span>}
                                {nextLine && <span className="tv-pj-next">{nextLine}</span>}
                              </span>
                            )}
                            <span className="tv-pj-go" aria-hidden="true"><Icon name="arrow" size={15} /></span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </Collapse>
              </li>
            );
          })}
        </ul>
      ) : <p className="empty">No active projects. Signed work shows here with its progress.</p>}
    </section>
  );
}

function Teaser({ href, icon, title, sub }: { href: string; icon: string; title: string; sub: string }) {
  return (
    <a className="tv-teaser" href={href}>
      <span className="ico"><Icon name={icon} /></span>
      <span className="txt"><b>{title}</b><span>{sub}</span></span>
      <Icon name="arrow" size={16} />
    </a>
  );
}

function Welcome({ name }: { name: string }) {
  return (
    <section className="panel tv-welcome">
      <div className="stack tight">
        <h2 className="h2">Welcome to your vault{name ? `, ${name}` : ""}</h2>
        <p className="muted">Everything about your clients, projects and your own to-dos, in one place that stays up to date. Start here:</p>
      </div>
      <ol className="tv-steps">
        <li><a href="#/clients"><span className="txt"><b>Add your first client</b><span>A name is enough. Projects and stages come next.</span></span><Icon name="arrow" size={16} /></a></li>
        <li><a href="#/settings"><span className="txt"><b>Import your clients</b><span>Bring everything over in one go from a file.</span></span><Icon name="arrow" size={16} /></a></li>
        <li><a href="#/todo"><span className="txt"><b>Add your daily list</b><span>Gym, lessons, anything you never want to forget.</span></span><Icon name="arrow" size={16} /></a></li>
      </ol>
    </section>
  );
}

// ---------- the headline: "6 things" and "2 overdue" open a quick list under it ----------
type Need = { key: string; title: string; who?: string; tag: string; tone: "bad" | "amber" | "good" | "plain" | "claude"; href?: string };

function needOf(i: AgendaItem): Need {
  const tag = i.kind === "approval" ? "Approved" : i.late ? "Overdue" : i.today ? "Today" : i.kind === "draft" ? "Draft" : i.kind === "meeting" ? "Call" : i.due ? relDate(i.due) : "Anytime";
  const tone = i.kind === "approval" ? "good" : i.late ? "bad" : i.today ? "amber" : "plain";
  return { key: i.key, title: i.title, who: i.who || (i.kind === "todo" ? "Your list" : undefined), tag, tone, href: i.href ?? (i.kind === "todo" ? "#/todo" : undefined) };
}

function HeadPop({ which, items, onClose }: { which: "all" | "late" | null; items: Need[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<{ which: "all" | "late"; items: Need[] } | null>(null);
  // Keep the last list on screen while it slides shut.
  useEffect(() => { if (which) setShown({ which, items }); }, [which, items]);
  useEffect(() => {
    if (!which) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const click = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest(".tv-hl")) onClose();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", click); };
  }, [which, onClose]);
  const cur = shown;
  const late = cur?.which === "late";
  return (
    <div className={`tv-pop${which ? " open" : ""}${late ? " bad" : ""}`} aria-hidden={!which}>
      <div className="tv-pop-in">
        <div className="tv-pop-card" ref={ref} id="tv-pop" role="region" aria-label={late ? "Overdue" : "Today's list"}>
          <div className="tv-pop-h">
            <b>{late ? `${cur!.items.length} overdue` : `${cur?.items.length ?? 0} thing${cur?.items.length === 1 ? "" : "s"} for today`}</b>
            <button type="button" className="btn quiet icon sm" onClick={onClose} aria-label="Close" tabIndex={which ? 0 : -1}><Icon name="x" size={15} /></button>
          </div>
          <ul className="tv-pop-list">
            {(cur?.items || []).map((n) => {
              const body = (
                <>
                  <span className={`pill ${n.tone}`}>{n.tag}</span>
                  <span className="tv-pop-t">
                    {n.who && <span className="tv-pop-who trunc">{n.who}</span>}
                    <span className="tv-pop-what">{n.title}</span>
                  </span>
                  {n.href && <Icon name="arrow" size={14} />}
                </>
              );
              return <li key={n.key}>{n.href ? <a href={n.href} onClick={onClose} tabIndex={which ? 0 : -1}>{body}</a> : <div>{body}</div>}</li>;
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function TodayView() {
  const s = useVault();
  const st = settingsData(s);
  const list = todos(s);
  const todoById = new Map(list.map((d) => [d.id, d]));
  const todoOf = (i: AgendaItem) => (i.kind === "todo" && i.docId ? todoById.get(i.docId) : undefined);
  const dailyIds = new Set(list.filter((d) => d.data.type === "daily").map((d) => d.id));
  const daily = list.filter((d) => d.data.type === "daily");
  const isDailyItem = (i: AgendaItem) => i.kind === "todo" && !!i.docId && dailyIds.has(i.docId);

  const now0 = agenda(s, 0);
  const week = agenda(s, 7);

  // The "today and overdue" list (daily tasks live in their own card; drafts and calls get teasers).
  const todayList = now0.filter((i) => !isDailyItem(i) && i.kind !== "draft" && i.kind !== "meeting" &&
    (i.late || i.today || i.kind === "approval" || (i.kind === "todo" && !i.due)));
  const shown = new Set(todayList.map((i) => i.key));
  const comingUp = week.filter((i) => !shown.has(i.key) && !isDailyItem(i) && i.due && !i.late && !i.today && i.kind !== "approval")
    .sort((a, b) => a.due!.localeCompare(b.due!));

  const dueNow = now0.filter((i) => i.late || i.today);
  const lateN = dueNow.filter((i) => i.late).length;
  const dailyLeft = daily.filter((d) => !d.data.done).length;
  const nameOf = new Map(clientViews(s).map((c) => [c.client?.id, c.name]));
  const needList: Need[] = [
    ...todayList.map(needOf),
    ...daily.filter((d) => !d.data.done).map((d): Need => ({ key: "daily-" + d.id, title: d.data.title, who: "Every day", tag: "Daily", tone: "claude", href: "#/todo" })),
    ...now0.filter((i) => i.kind === "draft" || i.kind === "meeting").map(needOf),
    ...openReplies(s).map((r): Need => ({ key: "reply-" + r.id, title: `Reply: ${r.data.subject || "(no subject)"}`, who: nameOf.get(r.data.clientId) || r.data.fromName || r.data.from, tag: "Reply", tone: "amber" })),
  ];
  const lateList = dueNow.filter((i) => i.late).map(needOf);
  const needN = needList.length;
  const [pop, setPop] = useState<"all" | "late" | null>(null);
  const closePop = useRef(() => setPop(null)).current;
  const togglePop = (w: "all" | "late") => setPop((p) => (p === w ? null : w));

  const pvs = projectViews(s);
  const active = pvs.filter(isActive).sort((a, b) => (a.p.promisedDelivery || "9999").localeCompare(b.p.promisedDelivery || "9999"));
  const waitingPv = active.filter((pv) => pv.priv?.data.waitingOn === "client");
  const oldestSince = waitingPv.map((pv) => pv.priv?.data.waitingSince?.slice(0, 10)).filter((x): x is string => !!x).sort()[0];
  const oldestWho = oldestSince ? waitingPv.find((pv) => pv.priv?.data.waitingSince?.slice(0, 10) === oldestSince)?.client?.data.name : undefined;
  const { owed, upcoming } = owedTotals(s);
  const nextPay = upcoming[0];

  const draftN = drafts(s).filter((d) => d.data.status === "draft").length;
  const meetingItems = meetings(s).reduce((n, m) => {
    if (m.data.source !== "fireflies" || daysFromToday(m.data.date.slice(0, 10)) < -14) return n;
    return n + m.data.actionItems.filter((a) => !(m.data.addedToTodo || []).includes(a)).length;
  }, 0);

  const brandNew = clientViews(s).length === 0 && pvs.length === 0;
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const scrollToList = () => document.getElementById("tv-today")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const waitDays = oldestSince ? -daysFromToday(oldestSince) : 0;

  return (
    <div className="stack loose">
      {/* The Morning brief (the developer's daily report) and the personal numbers (Numerology) are the developer's own, like the PS Tab
          list's (core/account.ts RED_ONLY "brief", "numerology"). Anyone else gets the greeting alone. */}
      <TodayHero red={isRedAccount(s)}
        hero={
          <header className="tv-hero">
            <span className="tv-date">{dateLine}</span>
            <h1 className="h1">{greeting()}{st.ownerName ? ` ${st.ownerName}` : ""}</h1>
            <p className="tv-sub">
              {needN === 0 ? "Nothing needs you right now. Enjoy it." : <>
                <button type="button" className={`tv-hl${pop === "all" ? " on" : ""}`} aria-expanded={pop === "all"} aria-controls="tv-pop" onClick={() => togglePop("all")}>
                  <b className="num">{needN}</b> thing{needN > 1 ? "s" : ""}
                </button> need{needN > 1 ? "" : "s"} you today{lateN > 0 && <>, <button type="button" className={`tv-hl bad${pop === "late" ? " on" : ""}`} aria-expanded={pop === "late"} aria-controls="tv-pop" onClick={() => togglePop("late")}>{lateN} overdue</button></>}.</>}
            </p>
            <HeadPop which={pop} items={pop === "late" ? lateList : needList} onClose={closePop} />
          </header>
        }
        between={<><YourNumbers /><RadarToday /><RepliesCard /></>}
      />

      {brandNew ? (
        <>
          <Welcome name={st.ownerName} />
          <DailyCard daily={daily} />
        </>
      ) : (
        <>
          <div className="stats tv-stats">
            <a className="stat" href="#/clients">
              <span className="label"><Icon name="clients" size={14} /> Active projects</span>
              <b className="num">{active.length}</b>
              <small>{active.length ? `${new Set(active.map((p) => p.ws)).size} client${new Set(active.map((p) => p.ws)).size > 1 ? "s" : ""}` : "None in motion"}</small>
            </a>
            <button type="button" className={`stat${lateN ? " alert" : ""}`} onClick={scrollToList}>
              <span className="label"><Icon name="todo" size={14} /> Your next steps due</span>
              <b className="num">{dueNow.length}</b>
              <small>{lateN ? `${lateN} overdue` : dueNow.length ? "All due today" : "All on time"}</small>
            </button>
            <a className={`stat${waitingPv.length ? " amber" : ""}`} href="#/clients">
              <span className="label"><Icon name="cal" size={14} /> Waiting on clients</span>
              <b className="num">{waitingPv.length}</b>
              <small>{oldestSince ? `Oldest: ${waitDays <= 0 ? "since today" : `${waitDays} day${waitDays > 1 ? "s" : ""}`}${oldestWho ? `, ${oldestWho}` : ""}` : waitingPv.length ? "No start date set" : "Nobody keeping you waiting"}</small>
            </a>
            <a className="stat money" href="#/clients">
              <span className="label"><Icon name="money" size={14} /> Owed to you</span>
              <b className="num">{sumMoney(owed)}</b>
              <small>{nextPay ? `Next: ${money(nextPay.amount, nextPay.currency)}${nextPay.who ? ` from ${nextPay.who}` : ""}${nextPay.due ? `, ${fmtDate(nextPay.due)}` : ""}` : "No upcoming payments"}</small>
            </a>
          </div>

          <div className="grid2">
            <div className="stack loose">
              <section className="panel stack" id="tv-today" aria-labelledby="tv-today-h" style={{ scrollMarginTop: 80 }}>
                <div className="tv-card-h">
                  <h2 className="h2" id="tv-today-h">Today and overdue</h2>
                  {todayList.length > 0 && <span className="small muted num">{todayList.length}</span>}
                </div>
                {todayList.length ? (
                  <ul className="tv-items">{todayList.map((i) => <AgendaRow key={i.key} i={i} t={todoOf(i)} />)}</ul>
                ) : (
                  <div className="td-party" style={{ boxShadow: "none" }}>
                    <div className="seal"><Icon name="check" size={24} /></div>
                    <div className="stack tight" style={{ gap: 2 }}>
                      <span className="big">You are all caught up</span>
                      <span className="small muted">Nothing due today or overdue.</span>
                    </div>
                  </div>
                )}
              </section>

              {(draftN > 0 || meetingItems > 0) && (
                <div className="stack tight">
                  {draftN > 0 && <Teaser href="#/emails" icon="emails" title={`${draftN} email${draftN > 1 ? "s" : ""} waiting on you to approve`} sub="Nothing goes out until you approve the exact words." />}
                  {meetingItems > 0 && <Teaser href="#/meetings" icon="meetings" title={`${meetingItems} new action item${meetingItems > 1 ? "s" : ""} from calls`} sub="From Fireflies. Add the ones that matter to your list." />}
                </div>
              )}

              <section className="panel stack" aria-labelledby="tv-week-h">
                <div className="tv-card-h">
                  <h2 className="h2" id="tv-week-h">Coming up this week</h2>
                  {comingUp.length > 0 && <span className="small muted num">{comingUp.length}</span>}
                </div>
                {comingUp.length ? (
                  <ul className="tv-items">{comingUp.map((i) => <AgendaRow key={i.key} i={i} t={todoOf(i)} />)}</ul>
                ) : <p className="muted small">A clear week ahead so far.</p>}
              </section>
            </div>

            <div className="stack loose">
              <DailyCard daily={daily} />
              <ProjectsCard list={active} />
              {st.lastResetAt && <p className="xs muted" style={{ textAlign: "center" }}>List last reset {relTime(st.lastResetAt)}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The developer's Today opens with the Morning brief and his numbers; everyone else's with the greeting only. */
function TodayHero({ red, hero, between }: { red: boolean; hero: ReactNode; between: ReactNode }) {
  return red ? <MorningBrief hero={hero} between={between} /> : <>{hero}</>;
}
