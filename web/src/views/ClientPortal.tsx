// What a client sees for ONE workspace: greeting, the big "right now" card with an illustration
// of the stage, the stage tracker, approvals with date stamps, preview links, their to-dos,
// timeline, weekly updates, payments and the proposal ("What we agreed").
// Real mode writes ticks/approvals through actions.ts. Preview mode (the developer viewing as the client)
// keeps everything in local state and never writes. The demo passes its own handlers.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ClientView, ProjectView } from "../core/select";
import { clientNeeds } from "../core/select";
import type { Approval, Doc, PlannedDate, Preview, Stage, Update } from "../core/model";
import { GATE_LABEL, currentStage, plannedDates, progressPct, stageState, typeLabel } from "../core/model";
import { approveStage, tickTask } from "../core/actions";
import { DueText, Icon, Ring, daysFromToday, fmtDate, fmtDateTime, greeting, money, sumMoney, toISODate, toast } from "../ui/kit";
import { StageArt } from "./illus/StageArt";
import { ABTest } from "./illus/ABTest";
import { ProposalView } from "./ProposalView";
import "./portal.css";

// Who runs the project, by first name, for this portal's copy. The developer's own workspaces carry no ownerName, so
// his clients keep reading "Owner"; every other owner's workspace meta carries theirs (actions.ts).
const OwnerName = createContext("Owner");
const useOwner = () => useContext(OwnerName);

export interface PortalHandlers {
  onTick: (taskId: string, ws: string, done: boolean) => void | Promise<void>;
  onApprove: (projectId: string, ws: string, stageKey: string, gate: string, note?: string) => void | Promise<void>;
}

// ---------- helpers ----------
type DState = "done" | "now" | "waiting" | "approved" | "upcoming";

const approvalFor = (pv: ProjectView, key: string) => pv.approvals.find((a) => a.data.stageKey === key);
function dstate(pv: ProjectView, i: number): DState {
  const s = stageState(pv.p, i);
  if (s === "waiting" && approvalFor(pv, pv.p.stages[i].key)) return "approved";
  return s;
}
const dayOf = (ts: string) => toISODate(new Date(ts));
const TBC = "To be confirmed";
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const NO_PD: PlannedDate = { start: null, due: null, estimated: false };

// A date as text, plus whether it is an estimate worked out from the agreed launch date.
interface When { text: string; est: boolean }
function windowOf(pd: PlannedDate): When {
  const { due, estimated: est } = pd;
  // An estimated start that has already passed says nothing useful: show the end only.
  const start = est && pd.start && due && daysFromToday(pd.start) < 0 ? null : pd.start;
  if (start && due && start !== due) return { text: `${fmtDate(start)} to ${fmtDate(due)}`, est };
  if (due) return { text: est ? fmtDate(due) : `By ${fmtDate(due)}`, est };
  if (start) return { text: `From ${fmtDate(start)}`, est };
  return { text: TBC, est: false };
}
function whenOf(st: Stage, s: DState, pd: PlannedDate): When {
  if (s === "done") {
    if (st.doneAt) return { text: fmtDate(st.doneAt), est: false };
    if (st.due) return { text: fmtDate(st.due), est: false };
    return { text: "Done", est: false };
  }
  if (pd.due) return { text: fmtDate(pd.due), est: pd.estimated };
  if (pd.start) return { text: `From ${fmtDate(pd.start)}`, est: pd.estimated };
  return { text: "Date to follow", est: false };
}
function WhenText({ w, cap }: { w: When; cap?: boolean }) {
  const who = useOwner();
  if (!w.est) return <>{w.text}</>;
  return <span className="cp-est" title={`Estimated from the agreed launch date. ${who} confirms exact dates as the project moves.`}>{cap ? "About" : "about"} {w.text}</span>;
}
const EstHint = () => <span className="cp-esthint" title={`Worked out from the agreed launch date. ${useOwner()} confirms exact dates as the project moves.`}>estimated</span>;

function stampText(a: Doc<Approval>) {
  return `${GATE_LABEL[a.data.gate] || "Approved"}, ${fmtDate(dayOf(a.data.at))}`;
}
const STATE_PILL: Record<DState, { cls: string; text: string }> = {
  done: { cls: "good", text: "Done" },
  approved: { cls: "good", text: "Approved" },
  now: { cls: "plain", text: "In progress" },
  waiting: { cls: "amber", text: "Waiting on you" },
  upcoming: { cls: "ink", text: "Coming up" },
};
function StatePill({ s }: { s: DState }) {
  const x = STATE_PILL[s];
  return <span className={`pill ${x.cls}`}>{x.text}</span>;
}
const STATUS: Record<string, { cls: string; text: string }> = {
  on_track: { cls: "good", text: "On track" },
  at_risk: { cls: "bad", text: "At risk" },
  action_needed: { cls: "amber", text: "Action needed" },
};

function Stamp({ a, showBy = true }: { a: Doc<Approval>; showBy?: boolean }) {
  return (
    <span className="cp-stamp-wrap">
      <span className="cp-stamp num"><Icon name="check" size={14} /> {stampText(a)}</span>
      {showBy && a.data.by && <span className="xs muted">by {a.data.by}</span>}
      {a.data.note && <q className="cp-note small">{a.data.note}</q>}
    </span>
  );
}

// ---------- the portal ----------
type PortalProps = { view: ClientView; preview?: boolean; handlers?: PortalHandlers; viewerName?: string };
export function ClientPortal(props: PortalProps) {
  return <OwnerName.Provider value={props.view.meta?.data.ownerName || "Owner"}><PortalBody {...props} /></OwnerName.Provider>;
}

function PortalBody(props: PortalProps) {
  const { view, preview, handlers, viewerName } = props;
  const [tab, setTab] = useState(0);
  const [localTicks, setLocalTicks] = useState<Record<string, { done: boolean; at: string }>>({});
  const [localApprovals, setLocalApprovals] = useState<Doc<Approval>[]>([]);

  const greetName = view.meta?.data.greetingName || viewerName || "";
  const by = viewerName || view.meta?.data.greetingName || view.name;

  // In preview mode, layer the local (unsaved) ticks and approvals over the real data.
  const projects: ProjectView[] = useMemo(() => {
    if (!preview) return view.projects;
    return view.projects.map((pv) => ({
      ...pv,
      tasks: pv.tasks.map((t) => {
        const l = localTicks[t.doc.id];
        return l ? { ...t, done: l.done, doneAt: l.done ? l.at : null } : t;
      }),
      approvals: [...localApprovals.filter((a) => a.data.projectId === pv.doc.id), ...pv.approvals],
    }));
  }, [preview, view.projects, localTicks, localApprovals]);

  const act: PortalHandlers = useMemo(() => {
    if (handlers) return handlers;
    if (preview) {
      return {
        onTick: (taskId, _ws, done) => {
          setLocalTicks((m) => ({ ...m, [taskId]: { done, at: new Date().toISOString() } }));
          toast("Preview only. Nothing was saved.");
        },
        onApprove: (projectId, ws, stageKey, gate, note) => {
          const at = new Date().toISOString();
          setLocalApprovals((l) => [{ id: `preview-${at}`, ws, kind: "approval", data: { projectId, stageKey, gate, at, by, note: note || null }, author: null, updatedAt: at }, ...l]);
          toast("Preview only. Nothing was saved.");
        },
      };
    }
    return {
      onTick: (taskId, ws, done) => tickTask(taskId, ws, done, viewerName),
      onApprove: (projectId, ws, stageKey, gate, note) => approveStage(projectId, ws, stageKey, gate, by, note),
    };
  }, [handlers, preview, viewerName, by]);

  const needs = projects.map((pv) => clientNeeds(pv).count);
  const total = needs.reduce((a, b) => a + b, 0);
  const lastUpdate = projects.flatMap((pv) => [pv.doc.updatedAt, ...pv.updates.map((u) => u.updatedAt)])
    .filter(Boolean).sort().pop() as string | undefined;

  const hello = `${greeting()}${greetName ? ` ${greetName}` : ""}`;

  if (!projects.length) {
    return (
      <div className="cp stack loose selectable">
        <section className="cp-hero">
          <div className="cp-eyebrow">{view.name}</div>
          <h1 className="cp-hello">{hello}</h1>
          <p className="cp-sub">Your project page is being set up. As soon as work starts, you will see every stage, date and preview link here.</p>
        </section>
        <div className="empty">Nothing to show yet. Check back soon.</div>
        <Footer />
      </div>
    );
  }

  const idx = Math.min(tab, projects.length - 1);
  const pv = projects[idx];

  return (
    <div className="cp stack loose selectable">
      <section className="cp-hero">
        <div className="cp-eyebrow">{view.name}</div>
        <h1 className="cp-hello">
          {hello},{" "}
          {total
            ? <span className="cp-attn">{total} {plural(total, "thing needs", "things need")} you</span>
            : <span className="cp-calm">nothing needs you right now</span>}
        </h1>
        <p className="cp-sub">
          Here is where {projects.length > 1 ? `your ${projects.length} projects are` : "your project is"} today.
          {lastUpdate && <> Updated <span className="num">{fmtDateTime(lastUpdate)}</span>.</>}
        </p>
      </section>

      {projects.length > 1 && (
        <div className="cp-tabs" role="tablist" aria-label="Your projects">
          {projects.map((x, j) => (
            <button key={x.doc.id} className="cp-tab" role="tab" aria-selected={j === idx} onClick={() => setTab(j)}>
              <span className="cp-tab-k">{x.p.title.trim().toLowerCase() === typeLabel(x.p.type).toLowerCase() ? "Project" : typeLabel(x.p.type)}</span>
              <span className="cp-tab-t">{x.p.title}</span>
              {needs[j] > 0 && <span className="cp-tabcount num" aria-label={`${needs[j]} need you`}>{needs[j]}</span>}
            </button>
          ))}
        </div>
      )}

      <ProjectBody key={pv.doc.id} pv={pv} act={act} />
      <Footer />
    </div>
  );
}

function Footer() {
  return <p className="cp-foot"><Icon name="lock" size={14} /> Private and encrypted. Only you and Cincee can see this page.</p>;
}

// Wrap a handler so a failed save never fails silently.
async function run(f: () => void | Promise<void>) {
  try { await f(); } catch { toast("Could not save that. Check your connection and try again."); }
}

// ---------- one project ----------
function ProjectBody({ pv, act }: { pv: ProjectView; act: PortalHandlers }) {
  const p = pv.p;
  const n = p.stages.length;
  const allDone = n > 0 && p.current >= n;
  const curIdx = Math.min(p.current, Math.max(n - 1, 0));
  const [sel, setSel] = useState(curIdx);
  const nowRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLElement>(null);
  const curState = !allDone && n ? dstate(pv, p.current) : null;
  const status = p.status ? STATUS[p.status] : null;
  const planned = useMemo(() => plannedDates(p), [p]);
  const launch: When | null = p.promisedDelivery
    ? { text: fmtDate(p.promisedDelivery), est: false }
    : planned[n - 1]?.due ? { text: fmtDate(planned[n - 1].due), est: planned[n - 1].estimated } : null;

  const toNow = () => nowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  const pick = (i: number) => { setSel(i); trackRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); };

  return (
    <div className="stack loose">
      <div className="cp-head">
        <div className="stack tight" style={{ minWidth: 0 }}>
          <div className="cp-eyebrow">{typeLabel(p.type)}</div>
          <h2 className="cp-title">{p.title}</h2>
          <div className="row wrap-ok">
            {allDone
              ? <span className="pill good">Live</span>
              : status && <span className={`pill ${status.cls}`}>{status.text}{launch && p.status === "on_track" && !launch.est && p.type !== "cro_retainer" ? ` for launch ${launch.text}` : ""}</span>}
          </div>
        </div>
        <Ring pct={progressPct(p)} size={74} stroke={7} amber={curState === "waiting"} />
      </div>

      {n === 0
        ? <div className="empty">The plan for this project is being written. Stages and dates appear here soon.</div>
        : <>
            <NowCard pv={pv} act={act} innerRef={nowRef} planned={planned} launch={launch} />
            <Tracker pv={pv} sel={sel} setSel={setSel} innerRef={trackRef} toNow={toNow} planned={planned} />
          </>}

      <div className="grid2">
        <div className="stack loose">
          <WaitingOnYou pv={pv} act={act} toNow={toNow} />
          {!allDone && n > 0 && <PreviewsPanel pv={pv} planned={planned} />}
          <div className="cp-on-narrow"><Updates list={pv.updates} /></div>
        </div>
        <div className="stack loose">
          {n > 0 && <Timeline pv={pv} pick={pick} planned={planned} />}
          <Payments pv={pv} />
          <div className="cp-on-wide"><Updates list={pv.updates} /></div>
        </div>
      </div>

      <ProposalView pv={pv} />
    </div>
  );
}

// ---------- the big "right now" card ----------
function NowArt({ pv, stageKey }: { pv: ProjectView; stageKey: string }) {
  if (pv.p.type === "cro_retainer" && stageKey === "testing") return <ABTest compact onDark />;
  return <StageArt type={pv.p.type} stageKey={stageKey} />;
}

function NowCard({ pv, act, innerRef, planned, launch }: {
  pv: ProjectView; act: PortalHandlers; innerRef: RefObject<HTMLElement | null>; planned: PlannedDate[]; launch: When | null;
}) {
  const who = useOwner();
  const p = pv.p;
  const n = p.stages.length;

  if (p.current >= n) {
    const last = p.stages[n - 1];
    const liveOn = last?.doneAt || p.promisedDelivery;
    return (
      <section className="cp-now cp-dark live" ref={innerRef} aria-live="polite">
        <div className="cp-now-grid">
          <div className="cp-now-text">
            <div className="row"><span className="dot-live good" /><span className="cp-now-k">Live</span></div>
            <div className="cp-now-big">You are live</div>
            <p className="cp-now-line">Every stage is done. Thank you for building this with us.{liveOn ? ` Live since ${fmtDate(liveOn)}.` : ""}</p>
            {p.liveUrls.length > 0 && (
              <div className="row wrap-ok" style={{ marginTop: 18 }}>
                {p.liveUrls.map((u) => (
                  <a key={u} className="btn primary" href={u} target="_blank" rel="noopener noreferrer">
                    <Icon name="link" /> {u.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="cp-now-art">{last && <NowArt pv={pv} stageKey={last.key} />}</div>
        </div>
      </section>
    );
  }

  const i = p.current;
  const st = p.stages[i];
  const s = dstate(pv, i);
  const amber = s === "waiting";
  const appr = approvalFor(pv, st.key);
  const next = p.stages[i + 1];
  const moved = p.originalDelivery && p.promisedDelivery && p.originalDelivery !== p.promisedDelivery;
  const pd = planned[i] || NO_PD;
  const win: When = p.nowWindow ? { text: p.nowWindow, est: false } : windowOf(pd);
  const neededBy: When | null = st.due ? { text: fmtDate(st.due), est: false } : pd.due ? { text: fmtDate(pd.due), est: pd.estimated } : null;
  const nextPd = planned[i + 1];
  const nextWhen: When | null = next && nextPd?.due ? { text: fmtDate(nextPd.due), est: nextPd.estimated } : null;

  return (
    <section className={"cp-now cp-dark" + (amber ? " amber" : "")} ref={innerRef} aria-live="polite">
      <div className="cp-now-grid">
        <div className="cp-now-text">
          <div className="row">
            <span className={"dot-live" + (amber ? " amber" : "")} />
            <span className="cp-now-k">{amber ? "Waiting on you" : s === "approved" ? `Approved, over to ${who}` : "Happening now"}</span>
            <span className="spacer" />
            <span className="cp-now-of num">Stage {i + 1} of {n}</span>
          </div>
          <div className="cp-now-big">{st.name}</div>
          <p className="cp-now-line">{p.nowLine || st.info || "Work on this stage is under way."}</p>

          <div className="cp-seg" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
            {p.stages.map((x, k) => <i key={x.key} className={dstate(pv, k)} />)}
          </div>
        </div>
        <div className="cp-now-art"><NowArt pv={pv} stageKey={st.key} /></div>
      </div>

      {amber && st.clientAction && (
        <div className="cp-callout">
          <span className="cp-now-k" style={{ color: "var(--warn)" }}>What we need</span>
          <b>{st.clientAction}</b>
          {st.previews.length > 0 && <span className="small">Open the previews below, then approve here.</span>}
          <ApproveBox pv={pv} st={st} act={act} />
        </div>
      )}
      {s === "approved" && appr && (
        <div className="cp-callout good">
          <Stamp a={appr} />
          <span className="small">Thank you. {who} has your decision and moves the project to {next ? next.name.toLowerCase() : "the finish"} next.</span>
        </div>
      )}

      <div className="cp-eta">
        <div>
          <span className="cp-now-k">{amber ? "Needed by" : "Expected"}</span>
          <b className="num">{amber ? (neededBy ? <WhenText w={neededBy} cap /> : "As soon as you can") : <WhenText w={win} cap />}</b>
        </div>
        <div>
          <span className="cp-now-k">Next milestone</span>
          <b>{next ? next.name : "Launch"}</b>
          {nextWhen && <span className="xs cp-dim num"><WhenText w={nextWhen} /></span>}
        </div>
        {p.type !== "cro_retainer" && (
          <div>
            <span className="cp-now-k">Launch</span>
            <b className="num">{launch ? <WhenText w={launch} cap /> : TBC}</b>
            {moved && <span className="xs cp-dim num">Moved from {fmtDate(p.originalDelivery)}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

const NOTE_LABEL: Record<string, string> = {
  direction: "Which direction did you pick? Mix parts of two if you like (optional)",
  design: "Anything to change before the build? (optional)",
  launch: "Any timing preference for going live? (optional)",
  review: "A note for {who} (optional)",
};

function ApproveBox({ pv, st, act }: { pv: ProjectView; st: Stage; act: PortalHandlers }) {
  const gate = st.gate || "review";
  const who = useOwner();
  const [open, setOpen] = useState(gate === "direction");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    await run(() => act.onApprove(pv.doc.id, pv.ws, st.key, gate, note.trim() || undefined));
    setBusy(false);
  };
  return (
    <div className="cp-approve">
      {open && (
        <label className="field">
          <span>{(NOTE_LABEL[gate] || NOTE_LABEL.review).replace("{who}", who)}</span>
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
        </label>
      )}
      <div className="row wrap-ok">
        <button className="btn primary" onClick={() => void go()} disabled={busy}><Icon name="check" /> {busy ? "Saving" : "Approve"}</button>
        {!open && <button className="btn quiet sm" onClick={() => setOpen(true)}>Add a note</button>}
      </div>
      <small className="hint">Your approval is stamped with today's date, so we both have a record.</small>
    </div>
  );
}

// ---------- stage tracker ----------
function Tracker({ pv, sel, setSel, innerRef, toNow, planned }: {
  pv: ProjectView; sel: number; setSel: (i: number) => void; innerRef: RefObject<HTMLElement | null>; toNow: () => void; planned: PlannedDate[];
}) {
  const p = pv.p;
  const n = p.stages.length;
  const scroller = useRef<HTMLDivElement>(null);
  const fill = n > 1 ? (Math.min(p.current, n - 1) / (n - 1)) * 100 : p.current >= n ? 100 : 0;

  useEffect(() => {
    const el = scroller.current;
    const b = el?.querySelector<HTMLElement>('[data-cur="1"]');
    if (el && b && el.scrollWidth > el.clientWidth) el.scrollLeft = b.offsetLeft - el.clientWidth / 2 + b.offsetWidth / 2;
  }, []);

  const k = Math.min(sel, n - 1);
  const st = p.stages[k];
  const s = dstate(pv, k);
  const appr = approvalFor(pv, st.key);
  const pd = planned[k] || NO_PD;
  const win: When = s === "done"
    ? (st.doneAt ? { text: `Finished ${fmtDate(st.doneAt)}`, est: false } : st.due ? { text: `Finished ${fmtDate(st.due)}`, est: false } : { text: "Finished", est: false })
    : windowOf(pd);

  return (
    <section className="tracker cp-tracker" ref={innerRef} aria-label="Project stages">
      <div className="cp-steps-scroll" ref={scroller}>
        <div className="steps" style={{ minWidth: n * 84 }}>
          <div className="rail" style={{ left: `calc(100% / ${2 * n})`, right: `calc(100% / ${2 * n})` }}><i style={{ width: `${fill}%` }} /></div>
          {p.stages.map((x, i) => {
            const ds = dstate(pv, i);
            const cls = ds === "approved" ? "done approved" : ds;
            const w = whenOf(x, ds, planned[i] || NO_PD);
            return (
              <button key={x.key} className={`step ${cls}`} aria-pressed={sel === i} onClick={() => setSel(i)}
                data-cur={i === Math.min(p.current, n - 1) ? "1" : undefined} aria-label={`${x.name}, ${STATE_PILL[ds].text}, ${w.est ? "about " : ""}${w.text}`}>
                <span className="dot">{ds === "done" || ds === "approved" ? <Icon name="check" size={17} /> : i + 1}</span>
                <span className="name">{x.name}</span>
                <span className="when num"><WhenText w={w} /></span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={"stepinfo cp-stepinfo" + (s === "waiting" ? " amber" : "")} aria-live="polite">
        <div className="cp-stepinfo-art" aria-hidden="true"><StageArt type={p.type} stageKey={st.key} /></div>
        <div className="cp-stepinfo-text">
          <div className="row between wrap-ok">
            <b className="cp-stepinfo-h">{st.name}</b>
            <StatePill s={s} />
          </div>
          <div className="small muted num row wrap-ok" style={{ gap: 8 }}>
            <span><Icon name="cal" size={14} /> <WhenText w={win} cap /></span>
            {win.est && <EstHint />}
          </div>
          {st.info && <p>{st.info}</p>}
          {st.clientAction && s !== "done" && s !== "approved" && (
            <p className="small"><b>{s === "waiting" ? "Needs you now:" : "You will be asked to:"}</b> {st.clientAction}</p>
          )}
          {appr && <Stamp a={appr} />}
          {s === "waiting" && (
            <div><button className="btn primary sm" onClick={toNow}><Icon name="check" size={16} /> Go to approve</button></div>
          )}
        </div>
        {st.previews.length > 0 && <div className="cp-stepinfo-pv"><PreviewCards list={st.previews} /></div>}
      </div>
    </section>
  );
}

// ---------- preview links ----------
function freshText(v: Preview, who: string) {
  if (v.expiresAt) {
    const d = daysFromToday(v.expiresAt);
    if (d < 0) return `Being refreshed by ${who}`;
    return d === 0 ? "Link good until today" : `Link good until ${fmtDate(v.expiresAt)}`;
  }
  return v.addedAt ? `Added ${fmtDate(v.addedAt)}` : "";
}
function PreviewCards({ list }: { list: Preview[] }) {
  const who = useOwner();
  return (
    <div className="previews cp-previews">
      {list.map((v, i) => (
        <a key={v.id} className="pv" href={v.url} target="_blank" rel="noopener noreferrer">
          <div className="cp-shot" aria-hidden="true">
            <span className="cp-shot-bar"><i /><i /><i /></span>
            <span className={`cp-shot-body v${i % 3}`}><b /><span /><span /><em /></span>
          </div>
          <div className="cap">
            <span className="row between"><span className="trunc">{v.label}</span><Icon name="arrow" size={15} /></span>
            {v.note && <small>{v.note}</small>}
            <small className="cp-fresh num">{freshText(v, who)}</small>
            <span className="cp-sr">(opens in a new tab)</span>
          </div>
        </a>
      ))}
    </div>
  );
}
function PreviewsPanel({ pv, planned }: { pv: ProjectView; planned: PlannedDate[] }) {
  const who = useOwner();
  const p = pv.p;
  let from: Stage | null = currentStage(p);
  if (from && !from.previews.length) {
    from = null;
    for (let i = Math.min(p.current, p.stages.length - 1); i >= 0; i--) if (p.stages[i].previews.length) { from = p.stages[i]; break; }
  }
  const nextIdx = from ? -1 : p.stages.findIndex((x, i) => i >= p.current && /direction|design|refine|review|edit/i.test(x.key + x.name));
  const nextPd = nextIdx >= 0 ? planned[nextIdx] : null;
  return (
    <section className="panel stack cp-panel">
      <div className="row between wrap-ok">
        <h2 className="cp-h2">Previews</h2>
        {from && <span className="pill plain">{from.name}</span>}
      </div>
      {from
        ? <PreviewCards list={from.previews} />
        : <div className="empty">Preview links appear here as soon as there is something to look at{nextPd?.start || nextPd?.due ? <>, expected <WhenText w={{ text: fmtDate(nextPd.start || nextPd.due), est: nextPd.estimated }} /></> : ""}.</div>}
      <p className="xs muted">Links on this page are always fresh. Shopify preview links expire after about 2 days, so {who} refreshes them here for you.</p>
    </section>
  );
}

// ---------- waiting on you ----------
// "1. Open Settings\n2. Users\n3. Add staff" (or plain lines) becomes a numbered list.
function TaskDetail({ text }: { text: string }) {
  const lines = text.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean);
  if (lines.length < 2) return <p className="cp-task-detail">{text.trim()}</p>;
  return (
    <ol className="cp-task-steps">
      {lines.map((l, k) => <li key={k}><span className="cp-task-n num" aria-hidden="true">{k + 1}</span><span>{l.replace(/^(\d+\s*[.):]|[-*•])\s*/, "")}</span></li>)}
    </ol>
  );
}

function WaitingOnYou({ pv, act, toNow }: { pv: ProjectView; act: PortalHandlers; toNow: () => void }) {
  const { openTasks, waitingGate } = clientNeeds(pv);
  const count = openTasks.length + (waitingGate ? 1 : 0);
  const tasks = [...pv.tasks].sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <section className="panel stack cp-panel">
      <div className="row between wrap-ok">
        <h2 className="cp-h2">Waiting on you</h2>
        {count ? <span className="pill amber">{count} open</span> : <span className="pill good">All done</span>}
      </div>
      {!tasks.length && !waitingGate && <div className="empty">Nothing needed from you right now.</div>}
      <ul className="cp-tasks">
        {waitingGate && (
          <li className="cp-task gate">
            <span className="cp-gate-ic" aria-hidden="true"><Icon name="eye" size={16} /></span>
            <div className="cp-task-body">
              <span className="cp-task-title">{waitingGate.clientAction}</span>
              <span className="small muted">{waitingGate.due ? <>Needed by <span className="num">{fmtDate(waitingGate.due)}</span>, <DueText iso={waitingGate.due} /></> : "When you are ready"}</span>
            </div>
            <button className="btn primary sm" onClick={toNow}>Approve</button>
          </li>
        )}
        {tasks.map((t) => {
          const id = `cp-t-${t.doc.id}`;
          return (
            <li key={t.doc.id} className={"cp-task" + (t.done ? " done" : "")}>
              <input id={id} type="checkbox" className="cp-check" checked={t.done}
                onChange={(e) => { const v = e.target.checked; void run(() => act.onTick(t.doc.id, pv.ws, v)); }} />
              <div className="cp-task-body">
                <label htmlFor={id} className="cp-task-title">{t.doc.data.title}</label>
                {t.doc.data.detail && !t.done && <TaskDetail text={t.doc.data.detail} />}
                {t.done
                  ? <span className="small muted num">{t.doneAt ? `Done ${fmtDate(t.doneAt)}. Thank you.` : "Done. Thank you."}</span>
                  : t.doc.data.due && <span className="cp-due small"><Icon name="cal" size={13} /> Needed by <span className="num">{fmtDate(t.doc.data.due)},</span> <DueText iso={t.doc.data.due} /></span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- timeline ----------
function Timeline({ pv, pick, planned }: { pv: ProjectView; pick: (i: number) => void; planned: PlannedDate[] }) {
  const p = pv.p;
  const anyEst = p.stages.some((st, i) => dstate(pv, i) !== "done" && planned[i]?.estimated && planned[i]?.due);
  return (
    <section className="panel stack cp-panel">
      <div className="row between wrap-ok">
        <h2 className="cp-h2">Timeline</h2>
        {anyEst && <span className="xs muted">"about" dates are estimates</span>}
      </div>
      <ol className="cp-timeline">
        {p.stages.map((st, i) => {
          const s = dstate(pv, i);
          const a = st.gate ? approvalFor(pv, st.key) : undefined;
          const w = whenOf(st, s, planned[i] || NO_PD);
          return (
            <li key={st.key} className={`cp-tl ${s}`}>
              <button className="cp-tl-btn" onClick={() => pick(i)} aria-label={`${st.name}, ${STATE_PILL[s].text}, ${w.est ? "about " : ""}${w.text}. Show details`}>
                <span className="cp-tl-dot" aria-hidden="true">{s === "done" || s === "approved" ? <Icon name="check" size={11} /> : null}</span>
                <span className="cp-tl-main">
                  <span className="cp-tl-name">{st.name}</span>
                  <span className="cp-tl-date num"><WhenText w={w} /></span>
                  {a && <span className="cp-stamp sm num"><Icon name="check" size={12} /> {stampText(a)}</span>}
                </span>
                <StatePill s={s} />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------- weekly updates ----------
function DateBadge({ iso }: { iso: string }) {
  const [wd, day, mon] = fmtDate(iso).split(" ");
  return <span className="cp-upd-date num" aria-hidden="true"><small>{wd}</small><b>{day}</b><small>{mon}</small></span>;
}
function Updates({ list }: { list: Doc<Update>[] }) {
  return (
    <section className="panel stack cp-panel">
      <h2 className="cp-h2">Weekly updates</h2>
      {!list.length && <div className="empty">Your first weekly update lands here at the end of the week.</div>}
      <div className="cp-feed">
        {list.map((u, k) => {
          const st = u.data.status ? STATUS[u.data.status] : null;
          return (
            <article key={u.id} className={"cp-upd" + (k === 0 ? " latest" : "")}>
              <DateBadge iso={u.data.date} />
              <div className="cp-upd-body">
                <div className="row between wrap-ok">
                  <span className="label num">{k === 0 ? "Latest, " : ""}{fmtDate(u.data.date)}</span>
                  {st && <span className={`pill ${st.cls}`}>{st.text}</span>}
                </div>
                <h3 className="cp-upd-h">{u.data.title}</h3>
                {u.data.bullets.length > 0 && <ul>{u.data.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
                {u.data.body && <p className="pre">{u.data.body}</p>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ---------- payments ----------
function Payments({ pv }: { pv: ProjectView }) {
  const { payments } = pv.p;
  if (!payments.length) return null;
  const paid = payments.filter((x) => x.status === "paid");
  const due = payments.filter((x) => x.status !== "paid");
  const currencies = new Set(payments.map((x) => x.currency));
  const totalAll = payments.reduce((a, x) => a + x.amount, 0);
  const paidAll = paid.reduce((a, x) => a + x.amount, 0);
  const pct = currencies.size === 1 && totalAll > 0 ? Math.round((paidAll / totalAll) * 100) : null;
  return (
    <section className="panel stack cp-panel">
      <div className="row between wrap-ok">
        <h2 className="cp-h2">Payments</h2>
        {pct !== null && <span className="xs muted num">{pct}% paid</span>}
      </div>
      <div className="cp-money">
        <div><span className="label">Paid</span><b className="num">{paid.length ? sumMoney(paid) : money(0, payments[0].currency)}</b></div>
        <div className={due.length ? "owed" : ""}><span className="label">Still to pay</span><b className="num">{due.length ? sumMoney(due) : money(0, payments[0].currency)}</b></div>
      </div>
      {pct !== null && <div className="progress" role="img" aria-label={`${pct}% paid`}><i style={{ width: `${pct}%` }} /></div>}
      <ul className="cp-pay">
        {payments.map((x) => (
          <li key={x.id}>
            <span className={`cp-pay-ic ${x.status}`} aria-hidden="true">{x.status === "paid" ? <Icon name="check" size={13} /> : <Icon name="money" size={13} />}</span>
            <span className="cp-pay-l">
              <span>{x.label}</span>
              <span className="xs muted num">
                {x.status === "paid" ? (x.paidAt ? `Paid ${fmtDate(x.paidAt)}` : "Paid") : x.status === "owed" ? (x.due ? `Due now, ${fmtDate(x.due)}` : "Due now") : x.due ? `Due ${fmtDate(x.due)}` : "Date to follow"}
              </span>
            </span>
            <b className="num">{money(x.amount, x.currency)}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

