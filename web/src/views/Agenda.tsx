// To-do > Agenda: what the developer is focused on right now. Several agendas can run at once; each has an
// editable title and note. Finishing one moves it to "Past agendas", where it can be reopened.
import { useEffect, useRef, useState } from "react";
import type { Agenda, Doc } from "../core/model";
import { agendas } from "../core/select";
import { addAgenda, deleteAgenda, endAgenda, reopenAgenda, updateAgenda } from "../core/actions";
import { Icon, fmtDate, toast, useVault } from "../ui/kit";
import { Chevron, Collapse } from "./Accordion";
import "./agenda.css";

export function AgendaCard() {
  const s = useVault();
  const { current, past } = agendas(s);
  const [showPast, setShowPast] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  async function add() {
    try { setFresh(await addAgenda("")); } catch (e) { toast(String((e as Error).message || e)); }
  }

  return (
    <section className="panel stack ag-card" aria-labelledby="ag-h">
      <div className="row between wrap-ok">
        <h2 className="h2" id="ag-h">{current.length > 1 ? "Current agendas" : "Current agenda"}</h2>
        <button type="button" className="btn ghost sm" onClick={() => void add()}><Icon name="plus" size={15} /> Add agenda</button>
      </div>

      {current.length === 0 ? (
        <button type="button" className="ag-empty" onClick={() => void add()}>
          <b>Name what you are working towards</b>
          <span className="small muted">For example "Close 3 new Shopify clients" or "October: get the pipeline moving".</span>
        </button>
      ) : (
        <ul className="ag-list">
          {current.map((d) => <AgendaRow key={d.id} d={d} autoFocus={d.id === fresh} />)}
        </ul>
      )}

      {past.length > 0 && (
        <>
          <button type="button" className="mb-more" aria-expanded={showPast} aria-controls="ag-past" onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Hide past agendas" : `Past agendas (${past.length})`} <Chevron open={showPast} size={15} />
          </button>
          <Collapse open={showPast} id="ag-past" lazy>
            <ul className="ag-past">
              {past.map((d) => (
                <li key={d.id}>
                  <div className="stack tight" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                    <b className="ag-past-t">{d.data.title}</b>
                    <span className="xs muted num">{fmtDate(d.data.startedAt)} to {fmtDate(d.data.endedAt!)}</span>
                    {d.data.note && <span className="small muted ag-past-n">{d.data.note}</span>}
                  </div>
                  <div className="row" style={{ gap: 4, flex: "none" }}>
                    <button type="button" className="btn quiet sm" onClick={() => void reopenAgenda(d.id)}>Reopen</button>
                    <button type="button" className="btn quiet icon sm" aria-label={`Delete ${d.data.title}`}
                      onClick={() => { if (window.confirm(`Delete the agenda "${d.data.title}"?`)) void deleteAgenda(d.id); }}><Icon name="trash" size={15} /></button>
                  </div>
                </li>
              ))}
            </ul>
          </Collapse>
        </>
      )}
    </section>
  );
}

function AgendaRow({ d, autoFocus }: { d: Doc<Agenda>; autoFocus: boolean }) {
  const [title, setTitle] = useState(d.data.title);
  const [note, setNote] = useState(d.data.note || "");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // Pick up edits from another device unless this field is being typed in.
  useEffect(() => { if (document.activeElement !== titleRef.current) setTitle(d.data.title); }, [d.data.title]);
  useEffect(() => { setNote((n) => (document.activeElement?.id === `ag-n-${d.id}` ? n : d.data.note || "")); }, [d.data.note, d.id]);
  useEffect(() => { if (autoFocus) { titleRef.current?.focus(); titleRef.current?.select(); } }, [autoFocus]);

  const saveTitle = () => { const t = title.trim() || "Untitled agenda"; if (t !== d.data.title) void updateAgenda(d.id, { title: t }); setTitle(t); };
  const saveNote = () => { if (note !== (d.data.note || "")) void updateAgenda(d.id, { note: note.trim() || null }); };

  return (
    <li className="ag-item">
      <div className="ag-top">
        <textarea ref={titleRef} className="ag-title" rows={1} value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))} onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
          placeholder="Name this agenda" aria-label="Agenda title" />
        <button type="button" className="btn quiet sm" onClick={() => { void endAgenda(d.id); toast(`"${d.data.title}" moved to past agendas`); }} title="Finished: move to past agendas">
          <Icon name="check" size={15} /> Done
        </button>
      </div>
      <textarea id={`ag-n-${d.id}`} className="ag-note" rows={1} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
        placeholder="Add a note: why it matters, what done looks like" aria-label={`Note for ${d.data.title}`} />
      <span className="xs muted num">Since {fmtDate(d.data.startedAt)}</span>
    </li>
  );
}
