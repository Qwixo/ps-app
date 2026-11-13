// Stages tab: the tracker, per stage editor, preview links, client approvals.
import { useEffect, useState } from "react";
import { GATE_LABEL, stageState, type Gate, type Stage } from "../../core/model";
import type { ProjectView } from "../../core/select";
import { addPreview, advanceStage, removePreview, setStage, shiftStageDates, updatePrivate, updateProject } from "../../core/actions";
import { Field, Icon, addDays, fmtDate, fmtDateTime, todayISO, toast } from "../../ui/kit";
import { ClientPill, EditArea, EditDate, EditText, Section, run } from "./bits";

export function StagesTab({ pv }: { pv: ProjectView }) {
  const p = pv.p;
  const n = p.stages.length;
  const [sel, setSel] = useState(Math.min(p.current, Math.max(0, n - 1)));
  useEffect(() => { setSel(Math.min(pv.p.current, Math.max(0, n - 1))); }, [pv.doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = p.stages[p.current];
  const approval = cur ? pv.approvals.find((a) => a.data.stageKey === cur.key) : undefined;
  const st = p.stages[Math.min(sel, n - 1)];
  const railPct = n <= 1 ? 0 : Math.min(100, (Math.min(p.current, n - 1) / (n - 1)) * 100);

  const makeCurrent = (i: number) => {
    const prev = p.current;
    void run(() => setStage(pv.doc.id, i)).then((ok) => ok && toast(i >= n ? "All stages marked done" : `Current stage: ${p.stages[i].name}`, { label: "Undo", run: () => void setStage(pv.doc.id, prev) }));
  };

  return (
    <div className="stack loose">
      {approval && cur && (
        <div className="cv-approval-banner">
          <div className="stack" style={{ gap: 2 }}>
            <b>{approval.data.by || "The client"} approved: {GATE_LABEL[approval.data.gate] || cur.name}</b>
            <span className="small">{fmtDateTime(approval.data.at)}{approval.data.note ? `. "${approval.data.note}"` : ""}</span>
          </div>
          <button className="btn primary" onClick={() => void run(() => advanceStage(pv.doc.id), "Moved to the next stage")}>
            Move to next stage <Icon name="arrow" size={16} />
          </button>
        </div>
      )}

      <section className="stack tight">
        <div className="row between wrap-ok">
          <h2 className="h2">Stages</h2>
          <span className="small muted">Tap a stage to edit it</span>
        </div>
        <div className="tracker">
          <div className="steps" style={{ minWidth: Math.max(560, n * 92) }}>
            <div className="rail" style={{ left: `${50 / n}%`, right: `${50 / n}%` }}><i style={{ width: railPct + "%" }} /></div>
            {p.stages.map((s, i) => {
              const state = stageState(p, i);
              return (
                <button key={s.key + i} className={`step ${state}`} aria-pressed={sel === i} onClick={() => setSel(i)}
                  aria-label={`${s.name}, ${state === "done" ? "done" : state === "upcoming" ? "upcoming" : state === "waiting" ? "current, waiting on client" : "current"}`}>
                  <span className="dot">{state === "done" ? <Icon name="check" size={16} /> : i + 1}</span>
                  <span className="name">{s.name}</span>
                  <span className="when num">{s.doneAt ? fmtDate(s.doneAt) : s.due ? fmtDate(s.due) : ""}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="row wrap-ok">
          {p.current < n ? (
            <button className="btn ghost sm" onClick={() => makeCurrent(p.current + 1)}>
              {p.current + 1 < n ? `Done, start ${p.stages[p.current + 1].name}` : "Mark the last stage done"} <Icon name="arrow" size={16} />
            </button>
          ) : (
            <span className="pill good">All stages done</span>
          )}
          {p.current > 0 && <button className="btn quiet sm" onClick={() => makeCurrent(p.current - 1)}><Icon name="back" size={16} /> Back one stage</button>}
        </div>
      </section>

      {st && <StageEditor key={pv.doc.id + st.key + sel} pv={pv} st={st} i={sel} onMakeCurrent={() => makeCurrent(sel)} />}

      {pv.approvals.length > 0 && (
        <Section title="Client approvals" sub="Date stamped by the client from their page.">
          <ul className="list">
            {pv.approvals.map((a) => {
              const s = p.stages.find((x) => x.key === a.data.stageKey);
              return (
                <li key={a.id}>
                  <span className="cv-okdot" aria-hidden="true"><Icon name="check" size={14} /></span>
                  <span className="stack" style={{ gap: 0, minWidth: 0, flex: 1 }}>
                    <b className="small">{GATE_LABEL[a.data.gate] || "Approved"}{s ? `: ${s.name}` : ""}</b>
                    <span className="xs muted">{a.data.by} · {fmtDateTime(a.data.at)}</span>
                    {a.data.note && <span className="small">"{a.data.note}"</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

function StageEditor({ pv, st, i, onMakeCurrent }: { pv: ProjectView; st: Stage; i: number; onMakeCurrent: () => void }) {
  const p = pv.p;
  const state = stageState(p, i);
  const [shiftN, setShiftN] = useState("3");
  const save = (patch: Partial<Stage>, msg = "Stage saved") =>
    void run(() => updateProject(pv.doc.id, (x) => { x.stages = x.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)); return x; }), msg);
  const approval = pv.approvals.find((a) => a.data.stageKey === st.key);

  return (
    <Section title={`${i + 1}. ${st.name}`} sub={state === "done" ? `Done ${st.doneAt ? fmtDate(st.doneAt) : ""}` : state === "upcoming" ? "Upcoming" : state === "waiting" ? "Current stage, waiting on the client" : "Current stage"}
      aside={state === "now" || state === "waiting" ? <span className={`pill ${state === "waiting" ? "amber" : "plain"}`}>{state === "waiting" ? "Waiting on client" : "In progress"}</span>
        : <button className="btn ghost sm" onClick={onMakeCurrent}>Make this the current stage</button>}>
      <div className="cv-stage-grid">
        <Field label="Stage name"><EditText value={st.name} onSave={(v) => v && save({ name: v })} /></Field>
        <Field label="Starts"><EditDate value={st.start} onSave={(v) => save({ start: v })} /></Field>
        <Field label="Due"><EditDate value={st.due} onSave={(v) => save({ due: v })} /></Field>
      </div>
      <Field label="What the client reads for this stage">
        <EditArea value={st.info} rows={2} onSave={(v) => save({ info: v || null })} />
      </Field>
      <div className={"cv-stage-grid two" + (st.clientAction ? " cv-amberbox" : "")}>
        <Field label="Waiting on the client for" hint="Filled in makes this stage amber on their page">
          <EditText value={st.clientAction} placeholder="eg Pick a design direction" onSave={(v) => save({ clientAction: v || null })} />
        </Field>
        <Field label="Approval gate" hint="Lets them approve with a date stamp">
          <select className="select" value={st.gate || ""} onChange={(e) => save({ gate: (e.target.value || null) as Gate })}>
            <option value="">No approval needed</option>
            {Object.entries(GATE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      {approval && <p className="small cv-good">Approved by {approval.data.by} on {fmtDateTime(approval.data.at)}</p>}

      <div className="cv-shift row wrap-ok">
        <span className="small">Shift this and later stages by</span>
        <input className="input cv-num" type="number" inputMode="numeric" value={shiftN} onChange={(e) => setShiftN(e.target.value)} aria-label="Days to shift" />
        <span className="small">days</span>
        <button className="btn ghost sm" disabled={!Number(shiftN)} onClick={() => {
          const d = Math.round(Number(shiftN));
          void run(async () => { await shiftStageDates(pv.doc.id, i, d); await updatePrivate(pv.doc.id, {}, `Stage dates from ${st.name} shifted ${d > 0 ? "+" : ""}${d} days`); }, `Shifted ${d} day${Math.abs(d) === 1 ? "" : "s"}`);
        }}>Shift</button>
      </div>

      <div className="divider" />
      <Previews pv={pv} st={st} />
    </Section>
  );
}

function Previews({ pv, st }: { pv: ProjectView; st: Stage }) {
  const shopify = pv.p.type === "shopify_redesign";
  const [f, setF] = useState({ label: "", url: "", note: "", expires: shopify ? addDays(todayISO(), 2) : "" });
  const t = todayISO();
  const add = () => {
    let url = f.url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    void run(() => addPreview(pv.doc.id, st.key, { label: f.label.trim() || `Preview ${st.previews.length + 1}`, url, note: f.note.trim() || undefined, expiresAt: f.expires || null }), "Preview link added")
      .then((ok) => ok && setF({ label: "", url: "", note: "", expires: shopify ? addDays(todayISO(), 2) : "" }));
  };
  return (
    <div className="stack">
      <div className="row between wrap-ok">
        <h3 className="h3">Preview links</h3>
        <ClientPill />
      </div>
      {st.previews.length > 0 ? (
        <ul className="cv-previews">
          {st.previews.map((x) => {
            const expired = !!x.expiresAt && x.expiresAt < t;
            const soon = !!x.expiresAt && !expired && x.expiresAt <= addDays(t, 1);
            return (
              <li key={x.id} className={expired ? "expired" : ""}>
                <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                  <a className="cv-link trunc" href={x.url} target="_blank" rel="noreferrer noopener">{x.label}</a>
                  <span className="xs muted trunc">{x.url}</span>
                  {x.note && <span className="small">{x.note}</span>}
                  <span className="xs">
                    {expired ? <span className="pill bad nodot">Expired {fmtDate(x.expiresAt)}, make a new preview</span>
                      : x.expiresAt ? <span className={"pill nodot " + (soon ? "warn" : "ink")}>Expires {fmtDate(x.expiresAt)}</span>
                        : <span className="muted">No expiry</span>}
                  </span>
                </div>
                <button className="btn quiet icon sm" aria-label={`Remove ${x.label}`} onClick={() => {
                  if (window.confirm(`Remove the preview link "${x.label}"?`)) void run(() => removePreview(pv.doc.id, st.key, x.id), "Preview removed");
                }}><Icon name="trash" size={16} /></button>
              </li>
            );
          })}
        </ul>
      ) : <p className="small muted">No preview links on this stage yet.</p>}
      <div className="cv-addpv">
        <Field label="Label"><input className="input" value={f.label} placeholder="eg Direction A: Editorial" onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        <Field label="Link"><input className="input" type="url" inputMode="url" value={f.url} placeholder="https://..." onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label="Expires" hint={shopify ? "Shopify previews die after about 2 days" : undefined}>
          <input className="input" type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} />
        </Field>
        <Field label="Note (optional)"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <button className="btn ghost" onClick={add} disabled={!f.url.trim()}><Icon name="plus" size={16} /> Add preview</button>
      </div>
    </div>
  );
}
