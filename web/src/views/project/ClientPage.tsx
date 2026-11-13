// Client page tab: the big "right now" card, tasks the client owes, weekly updates, live links.
import { useState } from "react";
import { currentStage, stageState, type CTask, type Update } from "../../core/model";
import type { ProjectView, TaskView } from "../../core/select";
import { addClientTask, addUpdate, updatePrivate, updateProject } from "../../core/actions";
import { put, remove } from "../../core/vault";
import { Field, Icon, fmtDate, fmtDateTime, relDate, todayISO } from "../../ui/kit";
import { ClientPill, EditDate, EditText, ListEditor, STATUS, Section, run, statusOf } from "./bits";

export function ClientPageTab({ pv, clientName }: { pv: ProjectView; clientName: string }) {
  return (
    <div className="stack loose">
      <NowCard pv={pv} clientName={clientName} />
      <Tasks pv={pv} />
      <Updates pv={pv} />
      <Section title="Live links" sub="Shown on their page once the work is live." aside={<ClientPill />}>
        <ListEditor items={pv.p.liveUrls || []} placeholder="https://brand.com" addLabel="Add link"
          onSave={(liveUrls) => void run(() => updateProject(pv.doc.id, { liveUrls }), "Links saved")} />
      </Section>
    </div>
  );
}

function NowCard({ pv, clientName }: { pv: ProjectView; clientName: string }) {
  const p = pv.p;
  const [line, setLine] = useState(p.nowLine || "");
  const [win, setWin] = useState(p.nowWindow || "");
  const dirty = line !== (p.nowLine || "") || win !== (p.nowWindow || "");
  const st = currentStage(p);
  const amber = st ? stageState(p, p.current) === "waiting" : false;
  const fallback = st?.clientAction && amber ? `We need you: ${st.clientAction}.` : st?.info || "Everything is on track.";
  const save = () => void run(async () => {
    await updateProject(pv.doc.id, { nowLine: line.trim() || null, nowWindow: win.trim() || null });
    await updatePrivate(pv.doc.id, {}, "Updated the right now card");
  }, "Right now card saved");

  return (
    <Section title="Right now card" sub="The big card at the top of their page. Write it like you would say it." aside={<ClientPill />}>
      <div className="cv-now-grid">
        <div className="stack">
          <Field label="What is happening, in one human sentence">
            <textarea className="textarea" rows={3} value={line} placeholder={fallback} onChange={(e) => setLine(e.target.value)} />
          </Field>
          <Field label="Expected window" hint="eg Wed 21 to Fri 23 Oct">
            <input className="input" value={win} onChange={(e) => setWin(e.target.value)} placeholder="When they can expect the next thing" />
          </Field>
          <div className="row wrap-ok">
            <button className="btn primary" disabled={!dirty} onClick={save}><Icon name="check" size={16} /> Save card</button>
            {dirty && <button className="btn quiet" onClick={() => { setLine(p.nowLine || ""); setWin(p.nowWindow || ""); }}>Discard</button>}
          </div>
        </div>
        <div className="stack tight" aria-label="Live preview">
          <span className="label">How it reads for {clientName}</span>
          <div className={"now-card" + (amber ? " amber" : "")}>
            <div className="row">
              <span className={"dot-live" + (amber ? " amber" : "")} />
              <span className="label" style={{ color: amber ? "var(--warn)" : "var(--pink-d)" }}>{amber ? "Waiting on you" : "Right now"}</span>
            </div>
            <div className="big">{st ? st.name : "All done"}</div>
            <p className="human">{line.trim() || fallback}</p>
            <div className="eta">
              {win.trim() && <div><span className="label">Expected</span><b>{win.trim()}</b></div>}
              {p.promisedDelivery && <div><span className="label">Delivery</span><b className="num">{fmtDate(p.promisedDelivery)}</b></div>}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

function Tasks({ pv }: { pv: ProjectView }) {
  const [f, setF] = useState({ title: "", detail: "", due: "" });
  const add = () => {
    if (!f.title.trim()) return;
    void run(() => addClientTask(pv.doc.id, pv.ws, { title: f.title.trim(), detail: f.detail.trim() || undefined, due: f.due || null }), "Task added for the client")
      .then((ok) => ok && setF({ title: "", detail: "", due: "" }));
  };
  const open = pv.tasks.filter((t) => !t.done).length;
  return (
    <Section title={`Waiting on them${pv.tasks.length ? ` (${open} open)` : ""}`} sub="Things the client needs to do. They tick them off on their page." aside={<ClientPill />}>
      {pv.tasks.length > 0 ? (
        <ul className="list">
          {pv.tasks.map((t) => <TaskRow key={t.doc.id} t={t} ws={pv.ws} />)}
        </ul>
      ) : <p className="small muted">Nothing waiting on them.</p>}
      <div className="cv-addtask">
        <Field label="New task"><input className="input" value={f.title} placeholder="eg Send your logo files" onChange={(e) => setF({ ...f, title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></Field>
        <Field label="Detail (optional)"><input className="input" value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
        <Field label="Due"><input className="input" type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <button className="btn ghost" onClick={add} disabled={!f.title.trim()}><Icon name="plus" size={16} /> Add task</button>
      </div>
    </Section>
  );
}

function TaskRow({ t, ws }: { t: TaskView; ws: string }) {
  const [editing, setEditing] = useState(false);
  const d = t.doc.data;
  const save = (patch: Partial<CTask>) => void run(() => put<CTask>("ctask", { ...d, ...patch }, { id: t.doc.id, ws }), "Task saved");
  return (
    <li className={"cv-task" + (t.done ? " done" : "")}>
      <span className={"cv-tick" + (t.done ? " on" : "")} aria-label={t.done ? "Done by the client" : "Not done yet"} role="img">{t.done && <Icon name="check" size={14} />}</span>
      {editing ? (
        <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
          <EditText value={d.title} label="Task title" onSave={(v) => v && save({ title: v })} />
          <EditText value={d.detail} label="Detail" placeholder="Detail (optional)" onSave={(v) => save({ detail: v || null })} />
          <EditDate value={d.due} label="Due" onSave={(v) => save({ due: v })} />
        </div>
      ) : (
        <div className="stack" style={{ gap: 1, flex: 1, minWidth: 0 }}>
          <span className={"small" + (t.done ? " strike" : "")} style={{ fontWeight: 600 }}>{d.title}</span>
          {d.detail && <span className="xs muted">{d.detail}</span>}
          <span className="xs">
            {t.done ? <span className="cv-good">Ticked by the client {fmtDateTime(t.doneAt)}</span>
              : d.due ? <span className={d.due < todayISO() ? "err" : "muted"}>Due {relDate(d.due)}</span> : <span className="muted">No due date</span>}
          </span>
        </div>
      )}
      <button className="btn quiet icon sm" aria-label={editing ? "Done editing" : `Edit ${d.title}`} onClick={() => setEditing((v) => !v)}><Icon name={editing ? "check" : "edit"} size={16} /></button>
      <button className="btn quiet icon sm" aria-label={`Delete ${d.title}`} onClick={() => {
        if (window.confirm(`Delete the task "${d.title}"? It disappears from their page.`)) void run(() => remove(t.doc.id), "Task deleted");
      }}><Icon name="trash" size={16} /></button>
    </li>
  );
}

function Updates({ pv }: { pv: ProjectView }) {
  const blank = () => ({ date: todayISO(), title: "", bullets: "", body: "", status: (pv.p.status || "on_track") as NonNullable<Update["status"]> });
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  const bullets = f.bullets.split("\n").map((x) => x.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  const post = () => {
    if (!f.title.trim()) return;
    void run(async () => {
      await addUpdate(pv.doc.id, pv.ws, { date: f.date || todayISO(), title: f.title.trim(), bullets, body: f.body.trim() || null, status: f.status });
      await updatePrivate(pv.doc.id, {}, `Weekly update posted: ${f.title.trim()}`);
    }, "Update added to their page").then((ok) => { if (ok) { setF(blank()); setOpen(false); } });
  };
  return (
    <Section title="Weekly updates" sub="Shows on their page straight away when you add it." aside={
      open ? <ClientPill /> : <button className="btn ghost sm" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> Write an update</button>
    }>
      {open && (
        <div className="stack cv-compose">
          <div className="cv-next-grid">
            <Field label="Title"><input className="input" value={f.title} placeholder="eg Week 2: directions are ready" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          </div>
          <Field label="What happened (one per line)"><textarea className="textarea" rows={4} value={f.bullets} onChange={(e) => setF({ ...f, bullets: e.target.value })} placeholder={"Finished the research\nBuilt 6 homepage directions"} /></Field>
          <Field label="Anything else (optional)"><textarea className="textarea" rows={2} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Field label="Status">
            <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as NonNullable<Update["status"]> })}>
              {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <div className="row wrap-ok">
            <button className="btn primary" disabled={!f.title.trim()} onClick={post}>Add to their page</button>
            <button className="btn quiet" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {pv.updates.length > 0 ? (
        <ol className="cv-updates">
          {pv.updates.map((u) => {
            const st = statusOf(u.data.status);
            return (
              <li key={u.id}>
                <div className="row between wrap-ok">
                  <span className="stack" style={{ gap: 0 }}>
                    <b>{u.data.title}</b>
                    <span className="xs muted num">{fmtDate(u.data.date)}</span>
                  </span>
                  <span className="row">
                    <span className={`pill ${st.cls}`}>{st.label}</span>
                    <button className="btn quiet icon sm" aria-label={`Delete update ${u.data.title}`} onClick={() => {
                      if (window.confirm(`Delete the update "${u.data.title}"? It disappears from their page.`)) void run(() => remove(u.id), "Update deleted");
                    }}><Icon name="trash" size={16} /></button>
                  </span>
                </div>
                {u.data.bullets.length > 0 && <ul className="cv-ul small">{u.data.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
                {u.data.body && <p className="small pre muted">{u.data.body}</p>}
              </li>
            );
          })}
        </ol>
      ) : !open && <p className="small muted">No updates yet.</p>}
    </Section>
  );
}
