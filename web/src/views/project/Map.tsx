// Project map: one read-first picture of a project's whole journey, with "You are here".
import { useState } from "react";
import { GATE_LABEL, currentStage, progressPct, stageState, typeLabel } from "../../core/model";
import type { ProjectView } from "../../core/select";
import { Icon, Ring, addDays, daysFromToday, fmtDate, fmtDateTime, money, sumMoney, todayISO } from "../../ui/kit";
import { daysLabel, flags, pipelineLabel, statusOf } from "./bits";

type MState = "done" | "now" | "waiting" | "upcoming" | "late" | "paid" | "owed" | "info";
interface MItem {
  key: string;
  date: string | null;
  seq: number;
  kind: "proposal" | "stage" | "approval" | "payment" | "invoice" | "delivery" | "cycle" | "today";
  title: string;
  sub?: string;
  state: MState;
  here?: boolean;
  n?: number;
}

function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1 + n, Math.min(d, 28));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function buildMap(pv: ProjectView): MItem[] {
  const p = pv.p;
  const t = todayISO();
  const pr = p.proposal || { scope: [] };
  const out: MItem[] = [];
  let seq = 0;
  const push = (i: Omit<MItem, "seq">) => out.push({ ...i, seq: seq++ });

  if (pr.sentAt) push({ key: "ps", date: pr.sentAt, kind: "proposal", title: "Proposal sent", sub: pr.price ? money(pr.price, pr.currency || "USD") : undefined, state: "done" });
  if (pr.signedAt) push({ key: "pg", date: pr.signedAt, kind: "proposal", title: "Proposal signed", sub: pr.splitText || undefined, state: "done" });

  // Stages keep their order: a stage without a date borrows the date of the one before it.
  let carry: string | null = p.startDate || pr.signedAt || pr.sentAt || null;
  p.stages.forEach((s, i) => {
    const st = stageState(p, i);
    const d = s.doneAt || s.start || s.due || carry;
    carry = s.due || s.doneAt || s.start || carry;
    const when = s.doneAt ? `Done ${fmtDate(s.doneAt)}`
      : [s.start && `Starts ${fmtDate(s.start)}`, s.due && `due ${fmtDate(s.due)}`].filter(Boolean).join(", ");
    const late = st !== "done" && !!s.due && s.due < t;
    push({
      key: "s" + i, date: d, kind: "stage", title: s.name,
      sub: [st === "waiting" && s.clientAction ? `Waiting on them: ${s.clientAction}` : null, when || null, late ? "Past its due date" : null].filter(Boolean).join(" · ") || undefined,
      state: st === "done" ? "done" : st === "waiting" ? "waiting" : st === "now" ? (late ? "late" : "now") : "upcoming",
      here: i === p.current,
      n: i + 1,
    });
    for (const a of pv.approvals.filter((x) => x.data.stageKey === s.key)) {
      push({ key: "a" + a.id, date: a.data.at.slice(0, 10), kind: "approval", title: `Approved: ${GATE_LABEL[a.data.gate] || s.name}`, sub: `${a.data.by || "Client"}, ${fmtDateTime(a.data.at)}`, state: "done" });
    }
  });

  for (const pay of p.payments) {
    const late = pay.status !== "paid" && !!pay.due && pay.due < t;
    push({
      key: "p" + pay.id, date: pay.status === "paid" ? pay.paidAt || pay.due || null : pay.due || null, kind: "payment",
      title: `${pay.label}: ${money(pay.amount, pay.currency)}`,
      sub: pay.status === "paid" ? `Paid ${pay.paidAt ? fmtDate(pay.paidAt) : ""}` : pay.status === "owed" ? `Owed${pay.due ? `, due ${fmtDate(pay.due)}` : ""}` : late ? `Was due ${fmtDate(pay.due)}` : pay.due ? `Due ${fmtDate(pay.due)}` : "Not dated yet",
      state: pay.status === "paid" ? "paid" : pay.status === "owed" || late ? "owed" : "upcoming",
    });
  }
  const inv = pv.priv?.data.nextInvoiceDate;
  if (inv) push({ key: "inv", date: inv, kind: "invoice", title: "Send the next invoice", sub: "Only you see this", state: inv < t ? "late" : "upcoming" });

  if (p.promisedDelivery) {
    const moved = p.originalDelivery && p.originalDelivery !== p.promisedDelivery;
    const slip = moved ? daysFromToday(p.promisedDelivery) - daysFromToday(p.originalDelivery!) : 0;
    const done = p.current >= p.stages.length;
    push({
      key: "dl", date: p.promisedDelivery, kind: "delivery", title: "Promised delivery",
      sub: moved ? `Originally ${fmtDate(p.originalDelivery)}, moved ${p.deliveryChanges.length} time${p.deliveryChanges.length === 1 ? "" : "s"} (${slip > 0 ? "+" : ""}${slip} days)` : "As promised",
      state: done ? "done" : p.promisedDelivery < t ? "late" : "upcoming",
    });
  }

  // Retainers: the monthly cycle after launch.
  const retainer = p.type === "cro_retainer" || p.pipeline === "cro";
  if (retainer) {
    const start = p.type === "cro_retainer" ? (p.startDate || pr.signedAt || t) : (p.promisedDelivery || t);
    let k = 1;
    let shown = 0;
    while (shown < 3 && k < 120) {
      const d = addMonths(start, k);
      if (d >= t) { push({ key: "c" + k, date: d, kind: "cycle", title: `Month ${k} report`, sub: "Research, test, report, repeat", state: "upcoming" }); shown++; }
      k++;
    }
  } else if (pr.afterLaunch) {
    push({ key: "al", date: p.promisedDelivery ? addDays(p.promisedDelivery, 1) : null, kind: "cycle", title: "After launch", sub: pr.afterLaunch, state: "info" });
  }

  const dated = out.filter((x) => x.date).sort((a, b) => a.date!.localeCompare(b.date!) || a.seq - b.seq);
  const undated = out.filter((x) => !x.date);
  // The "Today" line goes where today falls among the dated items.
  const idx = dated.findIndex((x) => x.date! > t);
  const todayItem: MItem = { key: "today", date: t, seq: -1, kind: "today", title: "Today", sub: fmtDate(t), state: "info" };
  if (idx === -1) dated.push(todayItem); else dated.splice(idx, 0, todayItem);
  return [...dated, ...undated];
}

const KIND_ICON: Record<MItem["kind"], string> = {
  proposal: "proposals", stage: "check", approval: "shield", payment: "money", invoice: "money", delivery: "bolt", cycle: "reset", today: "today",
};

export function ProjectMap({ pvs, selected, onSelect }: { pvs: ProjectView[]; selected: ProjectView; onSelect: (id: string) => void }) {
  const [all, setAll] = useState(false);
  return (
    <div className="stack loose">
      {pvs.length > 1 && (
        <div className="row wrap-ok">
          <div className="tabs" role="tablist" aria-label="Map scope">
            <button className="tab" role="tab" aria-selected={!all} onClick={() => setAll(false)}>This project</button>
            <button className="tab" role="tab" aria-selected={all} onClick={() => setAll(true)}>All projects ({pvs.length})</button>
          </div>
        </div>
      )}
      {all ? (
        <div className="stack">
          {pvs.map((pv) => <MiniMap key={pv.doc.id} pv={pv} active={pv.doc.id === selected.doc.id} onOpen={() => { onSelect(pv.doc.id); setAll(false); }} />)}
        </div>
      ) : <FullMap pv={selected} />}
    </div>
  );
}

function Summary({ pv }: { pv: ProjectView }) {
  const p = pv.p;
  const st = currentStage(p);
  const waiting = st ? stageState(p, p.current) === "waiting" : false;
  const done = p.current >= p.stages.length;
  const dl = daysLabel(p.promisedDelivery);
  const paid = p.payments.filter((x) => x.status === "paid");
  const open = p.payments.filter((x) => x.status !== "paid");
  const pr = pv.priv?.data;
  const f = flags(pv);
  const who = pr?.waitingOn === "client" || (waiting && pr?.waitingOn !== "me")
    ? { label: "Waiting on them", what: pr?.waitingWhat || st?.clientAction || "a reply", since: pr?.waitingSince || null, cls: "client" }
    : pr?.waitingOn === "me" || pr?.nextStep || f.approvedNow
      ? { label: "Waiting on you", what: f.approvedNow ? `They approved ${st?.name}, move it on` : pr?.nextStep || "Your next step", since: pr?.nextDue ? `due ${fmtDate(pr.nextDue)}` : null, cls: f.nextLate ? "late" : "me" }
      : { label: "Waiting on", what: "Nobody right now", since: null, cls: "" };
  const sinceTxt = who.since && /^\d{4}-/.test(who.since) ? `since ${fmtDate(who.since)} (${-daysFromToday(who.since)} days)` : who.since;
  return (
    <div className="cv-map-sum">
      <div className="cv-sum-ring"><Ring pct={progressPct(p)} size={72} stroke={8} amber={waiting} />
        <span className="stack" style={{ gap: 0, minWidth: 0 }}><span className="label">Progress</span><b className="small trunc">{st ? st.name : "All done"}</b></span>
      </div>
      <div className={"cv-sum" + (dl.late && !done ? " late" : "")}><span className="label">Delivery</span><b className="num">{done ? "Delivered" : dl.big}</b><span className="xs muted">{done ? "" : p.promisedDelivery ? `${dl.small}, ${fmtDate(p.promisedDelivery)}` : dl.small}</span></div>
      <div className="cv-sum"><span className="label">Money</span><b className="num cv-good">{sumMoney(paid)}</b><span className="xs muted num">paid, {sumMoney(open)} to come</span></div>
      <div className={"cv-sum who " + who.cls}><span className="label">{who.label}</span><b className="small">{who.what}</b>{sinceTxt && <span className="xs muted">{sinceTxt}</span>}</div>
    </div>
  );
}

function FullMap({ pv }: { pv: ProjectView }) {
  const items = buildMap(pv);
  const status = statusOf(pv.p.status);
  return (
    <section className="panel stack cv-mappanel">
      <div className="row between wrap-ok">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="h2">{pv.p.title}</h2>
          <span className="small muted">{typeLabel(pv.p.type)} · {pipelineLabel(pv.p.pipeline)}</span>
        </div>
        <span className={`pill ${status.cls}`}>{status.label}</span>
      </div>
      <Summary pv={pv} />
      <ol className="cv-road" aria-label="Project journey">
        {items.map((it) => (
          <li key={it.key} className={`cv-ri ${it.kind} ${it.state}${it.here ? " here" : ""}`}>
            <span className="cv-rdot" aria-hidden="true">
              {it.state === "done" || it.state === "paid" ? <Icon name="check" size={14} /> : it.kind === "today" ? null : it.n ? <b className="xs num">{it.n}</b> : <Icon name={KIND_ICON[it.kind]} size={13} />}
            </span>
            <div className="cv-rbody">
              {it.here && <span className="cv-here">You are here</span>}
              <span className="cv-rdate xs num">{it.kind === "today" ? "Today" : it.date ? fmtDate(it.date) : "No date"}</span>
              <b className="cv-rtitle">{it.kind === "today" ? fmtDate(it.date) : it.title}</b>
              {it.sub && it.kind !== "today" && <span className="xs cv-rsub">{it.sub}</span>}
            </div>
          </li>
        ))}
      </ol>
      <div className="row wrap-ok xs muted cv-legend">
        <span><i className="lg done" /> Done</span><span><i className="lg now" /> In progress</span><span><i className="lg waiting" /> Waiting on client</span>
        <span><i className="lg owed" /> Owed or late</span><span><i className="lg upcoming" /> Coming up</span>
      </div>
    </section>
  );
}

function MiniMap({ pv, active, onOpen }: { pv: ProjectView; active: boolean; onOpen: () => void }) {
  const p = pv.p;
  const st = currentStage(p);
  const dl = daysLabel(p.promisedDelivery);
  const done = p.current >= p.stages.length;
  const pr = pv.priv?.data;
  return (
    <button className={"panel tight cv-mini-map" + (active ? " on" : "") + (p.archived ? " cv-archived" : "")} onClick={onOpen}>
      <div className="row between wrap-ok" style={{ width: "100%" }}>
        <span className="stack" style={{ gap: 0, minWidth: 0, textAlign: "left" }}>
          <b className="trunc">{p.title}</b>
          <span className="xs muted">{typeLabel(p.type)} · {pipelineLabel(p.pipeline)}{p.archived ? " · archived" : ""}</span>
        </span>
        <span className="row small num">
          <span className="muted">{progressPct(p)}%</span>
          <span className={dl.late && !done ? "err" : "muted"}>{done ? "Delivered" : p.promisedDelivery ? `${dl.big} ${dl.late ? "late" : "left"}` : "No date"}</span>
        </span>
      </div>
      <div className="cv-ministeps" aria-label={`${p.title}: ${st ? st.name : "all done"}`}>
        {p.stages.map((s, i) => {
          const state = stageState(p, i);
          return <span key={s.key + i} className={"ms " + state} title={s.name}><i /></span>;
        })}
      </div>
      <span className={"xs " + (st && stageState(p, p.current) === "waiting" ? "cv-amber" : "")} style={{ textAlign: "left", fontWeight: 650 }}>
        {st ? `Stage ${p.current + 1} of ${p.stages.length}: ${st.name}` : "All stages done"}
      </span>
      {(pr?.waitingOn === "client" || pr?.nextStep) && (
        <span className={"xs " + (pr?.waitingOn === "client" ? "cv-amber" : "muted")} style={{ textAlign: "left" }}>
          {pr?.waitingOn === "client" ? `Waiting on them: ${pr.waitingWhat || "a reply"}${pr.waitingSince ? ` since ${fmtDate(pr.waitingSince)}` : ""}` : `Next: ${pr?.nextStep}`}
        </span>
      )}
    </button>
  );
}
