// The project editor: always-visible header (ring, pipeline, status, title, type) plus tabs.
import { useState } from "react";
import { PIPELINE, PROJECT_TYPES, currentStage, progressPct, stageState, stagesFor, typeLabel, type Pipeline, type Project, type ProjectType } from "../../core/model";
import type { ProjectView } from "../../core/select";
import { setPipeline, updatePrivate, updateProject } from "../../core/actions";
import { Ring, fmtDate, fmtDateTime, todayISO } from "../../ui/kit";
import { EditText, STATUS, daysLabel, flags, pipelineLabel, run, statusOf } from "./bits";
import { OverviewTab } from "./Overview";
import { StagesTab } from "./Stages";
import { MoneyTab } from "./Money";
import { ClientPageTab } from "./ClientPage";

type Tab = "overview" | "stages" | "money" | "client" | "history";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "stages", label: "Stages" },
  { key: "money", label: "Money" },
  { key: "client", label: "Client page" },
  { key: "history", label: "History" },
];
function savedTab(): Tab {
  try { const t = localStorage.getItem("cv:editor-tab") as Tab | null; return t && TABS.some((x) => x.key === t) ? t : "overview"; } catch { return "overview"; }
}

export function ProjectEditor({ pv, clientName }: { pv: ProjectView; clientName: string }) {
  const [tab, setTabState] = useState<Tab>(savedTab);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem("cv:editor-tab", t); } catch { /* ignore */ } };
  const p = pv.p;
  const st = currentStage(p);
  const waiting = st ? stageState(p, p.current) === "waiting" : false;
  const pct = progressPct(p);
  const status = statusOf(p.status);
  const f = flags(pv);
  const dl = daysLabel(p.promisedDelivery);
  const done = p.current >= p.stages.length;
  const pr = pv.priv?.data;

  const changeType = (t: ProjectType) => {
    if (t === p.type) return;
    const untouched = p.current === 0 && p.stages.every((s) => !s.start && !s.due && !s.previews.length);
    const replace = untouched || window.confirm(`Also replace the stages with the ${typeLabel(t)} stages? Choose Cancel to keep your current stages.`);
    void run(async () => {
      await updateProject(pv.doc.id, (x: Project) => ({ ...x, type: t, title: x.title === typeLabel(x.type) ? typeLabel(t) : x.title, ...(replace ? { stages: stagesFor(t), current: 0 } : {}) }));
      await updatePrivate(pv.doc.id, {}, `Type changed to ${typeLabel(t)}`);
    }, "Type changed");
  };

  return (
    <div className="stack loose">
      <section className={"panel cv-ed-head" + (waiting ? " amber" : "")}>
        <div className="cv-ed-top">
          <Ring pct={pct} size={78} stroke={8} amber={waiting} />
          <div className="stack tight" style={{ minWidth: 0, flex: 1 }}>
            <EditText value={p.title} label="Project title" className="input cv-title-input" onSave={(v) => v && void run(() => updateProject(pv.doc.id, { title: v }), "Title saved")} />
            <div className="row wrap-ok small">
              <span className={waiting ? "cv-amber" : ""} style={{ fontWeight: 650 }}>{st ? `Stage ${p.current + 1} of ${p.stages.length}: ${st.name}` : "All stages done"}</span>
              {waiting && st?.clientAction && <span className="pill amber">Waiting on them: {st.clientAction}</span>}
              {p.clientVisible === false && <span className="pill ink nodot">Hidden from client</span>}
              {p.archived && <span className="pill ink nodot">Archived</span>}
            </div>
          </div>
          <div className={"cv-days" + (dl.late && !done ? " late" : "")}>
            <b className="num">{done ? "Done" : dl.big}</b>
            <span className="xs muted">{done ? "delivered" : p.promisedDelivery ? `${dl.small}, ${fmtDate(p.promisedDelivery)}` : dl.small}</span>
          </div>
        </div>
        <div className="cv-ed-selects">
          <label className="field"><span>Pipeline</span>
            <select className="select" value={p.pipeline} onChange={(e) => { const to = e.target.value as Pipeline; void run(() => setPipeline(pv.doc.id, to), `Moved to ${pipelineLabel(to)}`); }}>
              {PIPELINE.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Status</span>
            <select className={"select cv-status " + status.cls} value={p.status || "on_track"} onChange={(e) => {
              const s = e.target.value as NonNullable<Project["status"]>;
              void run(async () => { await updateProject(pv.doc.id, { status: s }); await updatePrivate(pv.doc.id, {}, `Status: ${statusOf(s).label}`); }, `Status: ${statusOf(s).label}`);
            }}>
              {STATUS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Type</span>
            <select className="select" value={p.type} onChange={(e) => changeType(e.target.value as ProjectType)}>
              {PROJECT_TYPES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </label>
        </div>
        {(pr?.nextStep || pr?.waitingOn === "client" || f.approvedNow) && (
          <div className={"cv-ed-next small" + (pr?.waitingOn === "client" ? " client" : f.nextLate ? " late" : "")}>
            {f.approvedNow ? <><b>The client approved {st?.name}.</b> Open Stages to move it on.</>
              : pr?.waitingOn === "client" ? <>Waiting on them: <b>{pr.waitingWhat || "a reply"}</b>{pr.waitingSince ? ` since ${fmtDate(pr.waitingSince)}` : ""}</>
                : <>Next: <b>{pr?.nextStep}</b>{pr?.nextDue ? ` by ${fmtDate(pr.nextDue)}` : ""}</>}
          </div>
        )}
      </section>

      <div className="tabs cv-edtabs" role="tablist" aria-label="Project sections">
        {TABS.map((t) => (
          <button key={t.key} className="tab" role="tab" id={"tab-" + t.key} aria-selected={tab === t.key} aria-controls="cv-tabpanel" onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "stages" && f.approvedNow && <span className="cv-dot" aria-label="approval waiting" />}
            {t.key === "money" && f.payLate && <span className="cv-dot bad" aria-label="payment overdue" />}
          </button>
        ))}
      </div>

      <div id="cv-tabpanel" role="tabpanel" aria-labelledby={"tab-" + tab} key={pv.doc.id + tab}>
        {tab === "overview" && <OverviewTab pv={pv} />}
        {tab === "stages" && <StagesTab pv={pv} />}
        {tab === "money" && <MoneyTab pv={pv} />}
        {tab === "client" && <ClientPageTab pv={pv} clientName={clientName} />}
        {tab === "history" && <HistoryTab pv={pv} />}
      </div>
    </div>
  );
}

function HistoryTab({ pv }: { pv: ProjectView }) {
  const [note, setNote] = useState("");
  const hist = pv.priv?.data.history || [];
  const add = () => { const t = note.trim(); if (!t) return; void run(() => updatePrivate(pv.doc.id, {}, t), "Added to history").then((ok) => ok && setNote("")); };
  return (
    <section className="panel stack">
      <div className="row between wrap-ok">
        <h2 className="h2">History</h2>
        <span className="pill ink">Only you see this</span>
      </div>
      <div className="row">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note, eg Call with them, agreed new homepage copy"
          aria-label="Add a history note" onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button className="btn ghost" onClick={add} disabled={!note.trim()}>Add</button>
      </div>
      {hist.length ? (
        <ol className="cv-timeline">
          {hist.map((h, i) => (
            <li key={i}>
              <span>{h.text}</span>
              <span className="xs muted num">{h.date === todayISO() ? "Today" : fmtDate(h.date)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="small muted">Nothing yet. Changes you make are logged here.</p>}
      {pv.doc.updatedAt && <p className="xs muted">Last synced change {fmtDateTime(pv.doc.updatedAt)}</p>}
    </section>
  );
}

