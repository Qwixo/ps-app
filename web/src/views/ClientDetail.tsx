import { useState } from "react";
import { CLIENT_STATUSES, PIPELINE, PROJECT_TYPES, typeLabel, type ClientRec, type Doc, type Pipeline, type ProjectType } from "../core/model";
import { projectViews } from "../core/select";
import { addProject, updateClient } from "../core/actions";
import { Field, Icon, Modal, TzClock, TzSelect, go, useVault } from "../ui/kit";
import { EditArea, PrivatePill, flags, run } from "./project/bits";
import { DestroyModal, InviteModal, LoginLinkButton, exportFlow, removeAccessFlow } from "./project/Access";
import { ProjectEditor } from "./project/Editor";
import { ProjectMap } from "./project/Map";
import { ClientReplies, MatchField } from "./Replies";
import { isRedAccount } from "../core/account";
import { vaultStore } from "../core/vault";
import "./clients.css";

type DView = "map" | "edit";
function loadView(): DView {
  try { return localStorage.getItem("cv-detail-view") === "map" ? "map" : "edit"; } catch { return "edit"; }
}

export function ClientDetailView({ clientId, projectId }: { clientId: string; projectId?: string }) {
  const s = useVault();
  const client = s.docs.get(clientId) as Doc<ClientRec> | undefined;
  const [modal, setModal] = useState<null | "invite" | "destroy" | "project" | "details">(null);
  const [more, setMore] = useState(false);
  const [view, setViewState] = useState<DView>(loadView);
  const setView = (v: DView) => { setViewState(v); try { localStorage.setItem("cv-detail-view", v); } catch { /* ignore */ } };

  if (!client || client.kind !== "client") {
    return (
      <div className="stack">
        <a className="btn quiet sm" href="#/clients" style={{ justifySelf: "start" }}><Icon name="back" size={16} /> All clients</a>
        <div className="empty">This client is not here. They may have been destroyed, or the vault is still syncing.</div>
      </div>
    );
  }
  const c = client.data;
  const ws = c.ws;
  const pvs = projectViews(s, ws).sort((a, b) => Number(!!a.p.archived) - Number(!!b.p.archived));
  const sel = pvs.find((p) => p.doc.id === projectId) ?? pvs.find((p) => !p.p.archived) ?? pvs[0];
  const base = `#/client/${clientId}`;

  return (
    <div className="stack loose">
      <header className="stack">
        <a className="btn quiet sm" href="#/clients" style={{ justifySelf: "start", marginLeft: -8 }}><Icon name="back" size={16} /> All clients</a>
        <div className="row between wrap-ok top">
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <span className="label">Client</span>
            <h1 className="h1" style={{ overflowWrap: "anywhere" }}>{c.name}</h1>
            <p className="small muted">
              {[c.contactName, c.greetingName && c.greetingName !== c.contactName?.split(" ")[0] ? `"${c.greetingName}"` : null].filter(Boolean).join(" ") || "No contact yet"}
              {c.timezone && <> · <TzClock tz={c.timezone} /></>}
              {" "}<button className="btn quiet sm cv-inline" onClick={() => setModal("details")}><Icon name="edit" size={14} /> Edit</button>
            </p>
          </div>
          <div className="row wrap-ok cv-headbtns">
            <button className="btn ghost" onClick={() => go(`#/preview/${ws}`)}><Icon name="eye" size={16} /> View as client</button>
            <LoginLinkButton client={client} />
            <button className="btn quiet icon" aria-expanded={more} aria-controls="cv-more" aria-label="Access and data" onClick={() => setMore((v) => !v)}><Icon name="dots" /></button>
          </div>
        </div>
        {more && (
          <div id="cv-more" className="panel tight cv-more">
            <span className="label">Access and data</span>
            <div className="row wrap-ok">
              <button className="btn quiet sm" onClick={() => setModal("invite")}><Icon name="link" size={16} /> Invite with their email</button>
              <button className="btn quiet sm" onClick={() => void removeAccessFlow(client)}><Icon name="lock" size={16} /> Remove their access</button>
              <button className="btn quiet sm" onClick={() => exportFlow(client)}><Icon name="down" size={16} /> Export their data</button>
              <button className="btn danger sm" onClick={() => setModal("destroy")}><Icon name="trash" size={16} /> Destroy all their data</button>
            </div>
          </div>
        )}
      </header>

      {isRedAccount(vaultStore.get()) && <ClientReplies client={client} onEditMatching={() => setModal("details")} />}

      <section className="panel stack tight cv-notes">
        <div className="row between wrap-ok">
          <h2 className="h3">Private notes</h2>
          <PrivatePill />
        </div>
        <EditArea value={c.notes} rows={3} label="Private notes about this client" placeholder="How they like to work, who decides, anything to remember"
          onSave={(v) => void run(() => updateClient(clientId, { notes: v || null }), "Notes saved")} />
      </section>

      <div className="stack">
        <div className="cv-projbar">
          <div className="tabs cv-projtabs" role="tablist" aria-label="Projects">
            {pvs.map((pv) => {
              const f = flags(pv);
              return (
                <a key={pv.doc.id} className="tab" role="tab" aria-selected={pv.doc.id === sel?.doc.id} href={`${base}/project/${pv.doc.id}`}>
                  {pv.p.title}{pv.p.archived ? " (archived)" : ""}
                  {(f.overdue || f.approvedNow) && <span className={"cv-dot" + (f.overdue ? " bad" : "")} aria-label={f.overdue ? "overdue" : "approval waiting"} />}
                </a>
              );
            })}
          </div>
          <button className="btn ghost sm" onClick={() => setModal("project")}><Icon name="plus" size={16} /> New project</button>
        </div>

        {sel ? (
          <>
            <div className="tabs cv-viewtoggle" role="tablist" aria-label="Project view">
              <button className="tab" role="tab" aria-selected={view === "map"} onClick={() => setView("map")}><MapIcon /> Project map</button>
              <button className="tab" role="tab" aria-selected={view === "edit"} onClick={() => setView("edit")}><Icon name="edit" size={14} /> Edit</button>
            </div>
            {view === "map"
              ? <ProjectMap pvs={pvs} selected={sel} onSelect={(id) => go(`${base}/project/${id}`)} />
              : <ProjectEditor key={sel.doc.id} pv={sel} clientName={c.greetingName || c.name} />}
          </>
        ) : (
          <div className="panel stack cv-hello">
            <h2 className="h2">No projects yet</h2>
            <p className="muted">Add their first project. It comes with the usual stages for its type, which you can change.</p>
            <button className="btn primary" style={{ justifySelf: "start" }} onClick={() => setModal("project")}><Icon name="plus" /> New project</button>
          </div>
        )}
      </div>

      {modal === "invite" && <InviteModal client={client} onClose={() => setModal(null)} />}
      {modal === "destroy" && <DestroyModal client={client} onClose={() => setModal(null)} />}
      {modal === "project" && <NewProjectModal ws={ws} onClose={() => setModal(null)} onCreated={(id) => go(`${base}/project/${id}`)} />}
      {modal === "details" && <DetailsModal client={client} onClose={() => setModal(null)} />}
    </div>
  );
}

const MapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" />
  </svg>
);

function NewProjectModal({ ws, onClose, onCreated }: { ws: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [type, setType] = useState<ProjectType>("shopify_redesign");
  const [title, setTitle] = useState("");
  const [pipeline, setPipe] = useState<Pipeline>("lead");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    let id = "";
    const ok = await run(async () => { id = await addProject(ws, type, title.trim() || undefined, { pipeline }); }, "Project added");
    setBusy(false);
    if (ok) { onClose(); onCreated(id); }
  };
  return (
    <Modal title="New project" onClose={onClose} footer={<>
      <button className="btn quiet" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={() => void create()}>Add project</button>
    </>}>
      <div className="stack">
        <div className="cv-types" role="radiogroup" aria-label="Project type">
          {PROJECT_TYPES.map((t) => (
            <label key={t.key} className={"cv-type" + (type === t.key ? " on" : "")}>
              <input type="radio" name="nptype" checked={type === t.key} onChange={() => setType(t.key)} />
              {t.label}
            </label>
          ))}
        </div>
        <div className="cv-2">
          <Field label="Title"><input className="input" value={title} placeholder={typeLabel(type)} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} /></Field>
          <Field label="Pipeline">
            <select className="select" value={pipeline} onChange={(e) => setPipe(e.target.value as Pipeline)}>
              {PIPELINE.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function DetailsModal({ client, onClose }: { client: Doc<ClientRec>; onClose: () => void }) {
  const c = client.data;
  const [f, setF] = useState({ name: c.name, contactName: c.contactName || "", greetingName: c.greetingName || "", timezone: c.timezone || "", status: c.status || "" });
  const save = async () => {
    if (!f.name.trim()) return;
    const ok = await run(() => updateClient(client.id, { name: f.name.trim(), contactName: f.contactName.trim() || null, greetingName: f.greetingName.trim() || null, timezone: f.timezone || null, status: (f.status || null) as ClientRec["status"] }), "Client saved");
    if (ok) onClose();
  };
  return (
    <Modal title="Client details" onClose={onClose} footer={<>
      <button className="btn quiet" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!f.name.trim()} onClick={() => void save()}>Save</button>
    </>}>
      <div className="stack">
        <Field label="Client or brand name" hint="They see this on their page"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="cv-2">
          <Field label="Contact name"><input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
          <Field label="Greeting name" hint="They see this on their page"><input className="input" value={f.greetingName} onChange={(e) => setF({ ...f, greetingName: e.target.value })} /></Field>
        </div>
        <div className="cv-2">
          <Field label="Time zone"><TzSelect value={f.timezone} onChange={(v) => setF({ ...f, timezone: v })} /></Field>
          <Field label="Shows under">
            <select className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">Automatic (from their projects)</option>
              {CLIENT_STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </Field>
        </div>
        {isRedAccount(vaultStore.get()) && <MatchField client={client} />}
      </div>
    </Modal>
  );
}
