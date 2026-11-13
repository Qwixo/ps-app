import { useMemo, useState, type DragEvent, type MouseEvent } from "react";
import { CLIENT_STATUSES, PIPELINE, PROJECT_TYPES, SERVICES, currentStage, progressPct, serviceOf, stageState, typeLabel, type ClientRec, type ClientStatus, type Pipeline, type ProjectType, type Service } from "../core/model";
import { clientStatus, clientViews, projectViews, type ProjectView } from "../core/select";
import { ClientsDashboard } from "./ClientsDashboard";
import { addClient, addProject, setPipeline } from "../core/actions";
import { doc } from "../core/vault";
import { Field, Icon, Modal, TzClock, TzSelect, fmtDate, go, money, relDate, sumMoney, todayISO, toast, useVault } from "../ui/kit";
import { errMsg, flags, pipelineLabel, run, statusOf } from "./project/bits";
import { LoginLinkButton } from "./project/Access";
import "./clients.css";

type Filter = "all" | "me" | "client" | "overdue";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "me", label: "Waiting on me" },
  { key: "client", label: "Waiting on client" },
  { key: "overdue", label: "Overdue" },
];

function pref<T extends string>(k: string, d: T): T {
  try { return (localStorage.getItem("cv:" + k) as T) || d; } catch { return d; }
}
function savePref(k: string, v: string) { try { localStorage.setItem("cv:" + k, v); } catch { /* private mode */ } }

const hrefOf = (pv: ProjectView) => pv.client ? `#/client/${pv.client.id}/project/${pv.doc.id}` : "#/clients";

export function ClientsView() {
  const s = useVault();
  const [mode, setMode] = useState<"dashboard" | "board" | "list">(() => pref("clients-view", "dashboard"));
  const [tab, setTab] = useState<ClientStatus>(() => pref("clients-tab", "client"));
  const [service, setService] = useState<Service | "all">(() => pref("clients-service", "all"));
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragOver, setDragOver] = useState<Pipeline | null>(null);

  const everyone = clientViews(s);
  const statusOfWs = new Map(everyone.map((c) => [c.ws, clientStatus(c)]));
  const tabCounts = Object.fromEntries(CLIENT_STATUSES.map((t) => [t.key, everyone.filter((c) => statusOfWs.get(c.ws) === t.key).length])) as Record<ClientStatus, number>;
  const clients = everyone.filter((c) => statusOfWs.get(c.ws) === tab);
  const all = useMemo(() => projectViews(s).filter((pv) => pv.client && !pv.client.data.archived), [s])
    .filter((pv) => statusOfWs.get(pv.ws) === tab && (service === "all" || serviceOf(pv.p.type) === service));

  const match = (pv: ProjectView) => {
    if (!showArchived && pv.p.archived) return false;
    const f = flags(pv);
    if (filter === "me" && !f.waitingMe) return false;
    if (filter === "client" && !f.waitingClient) return false;
    if (filter === "overdue" && !f.overdue) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const c = pv.client?.data;
    return [c?.name, c?.contactName, c?.email, pv.p.title, typeLabel(pv.p.type), pv.priv?.data.nextStep]
      .some((x) => (x || "").toLowerCase().includes(needle));
  };
  const visible = all.filter(match);
  const counts = {
    all: all.filter((p) => !p.p.archived).length,
    me: all.filter((p) => !p.p.archived && flags(p).waitingMe).length,
    client: all.filter((p) => !p.p.archived && flags(p).waitingClient).length,
    overdue: all.filter((p) => !p.p.archived && flags(p).overdue).length,
  };
  const archivedCount = all.filter((p) => p.p.archived).length;
  const empty = clients.filter((c) => c.projects.length === 0 &&
    (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())));

  const setM = (m: "dashboard" | "board" | "list") => { setMode(m); savePref("clients-view", m); };
  const setT = (t: ClientStatus) => { setTab(t); savePref("clients-tab", t); };
  const setS = (v: Service | "all") => { setService(v); savePref("clients-service", v); };
  const needle = q.trim().toLowerCase();
  const dashClients = clients.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.projects.some(match));

  const onDrop = (e: DragEvent, col: Pipeline) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/x-project") || e.dataTransfer.getData("text/plain");
    const pv = all.find((x) => x.doc.id === id);
    if (!pv || pv.p.pipeline === col) return;
    const from = pv.p.pipeline;
    void run(() => setPipeline(id, col)).then((ok) => ok && toast(`${pv.client?.data.name}: moved to ${pipelineLabel(col)}`, { label: "Undo", run: () => void setPipeline(id, from) }));
  };

  return (
    <div className="stack loose">
      <div className="row between wrap-ok cv-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">Clients</span>
          <h1 className="cv-big">
            <b className="num">{tabCounts.client}</b>{" "}
            <span>active client{tabCounts.client === 1 ? "" : "s"}</span>
          </h1>
          <div className="cv-counts" role="group" aria-label="Everyone else">
            {([["pending", "pending", "pending"], ["prospect", "prospect", "prospects"], ["lead", "lead", "leads"]] as [ClientStatus, string, string][]).map(([k, one, many]) => (
              <button key={k} type="button" className="cv-countbtn" aria-pressed={tab === k} onClick={() => setT(k)}>
                <b className="num">{tabCounts[k]}</b> {tabCounts[k] === 1 ? one : many}
              </button>
            ))}
          </div>
          <p className="muted small">{CLIENT_STATUSES.find((t) => t.key === tab)?.hint}</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> Add client</button>
      </div>

      <div className="cvd-tabs" role="tablist" aria-label="Who">
        {CLIENT_STATUSES.filter((t) => t.key !== "past" || tabCounts.past > 0).map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className="cvd-tab" onClick={() => setT(t.key)}>
            {t.label}<span className="cv-count num">{tabCounts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="row wrap-ok cv-chips" role="group" aria-label="Service">
        <button className="chip" aria-pressed={service === "all"} onClick={() => setS("all")}>All services</button>
        {SERVICES.map((x) => (
          <button key={x.key} className="chip" aria-pressed={service === x.key} onClick={() => setS(x.key)}>{x.label}</button>
        ))}
      </div>

      <div className="cv-toolbar">
        <div className="cv-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input className="input" type="search" placeholder="Search clients and projects" aria-label="Search clients and projects" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="row wrap-ok cv-chips" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.key} className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}<span className={"cv-count num" + (f.key === "overdue" && counts.overdue ? " bad" : "")}>{counts[f.key]}</span>
            </button>
          ))}
          {archivedCount > 0 && (
            <button className="chip" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>Archived <span className="cv-count num">{archivedCount}</span></button>
          )}
        </div>
        <div className="tabs cv-mode" role="tablist" aria-label="View">
          <button className="tab" role="tab" aria-selected={mode === "dashboard"} onClick={() => setM("dashboard")}>Dashboard</button>
          <button className="tab" role="tab" aria-selected={mode === "board"} onClick={() => setM("board")}>Board</button>
          <button className="tab" role="tab" aria-selected={mode === "list"} onClick={() => setM("list")}>List</button>
        </div>
      </div>

      {everyone.length === 0 ? (
        <div className="panel cv-hello stack">
          <h2 className="h2">Add your first client</h2>
          <p className="muted">Each client gets their own encrypted space. You can add their projects, the timeline you promised, payments and a private page they can see.</p>
          <button className="btn primary" style={{ justifySelf: "start" }} onClick={() => setAdding(true)}><Icon name="plus" /> Add client</button>
        </div>
      ) : mode === "dashboard" ? (
        <ClientsDashboard clients={dashClients} service={service} onlyProjects={match} />
      ) : mode === "board" ? (
        <div className="board-wrap cv-board-wrap">
          <div className="board">
            {PIPELINE.map((col) => {
              const items = visible.filter((pv) => pv.p.pipeline === col.key);
              const total = items.filter((x) => x.p.proposal.price).map((x) => ({ amount: x.p.proposal.price || 0, currency: x.p.proposal.currency || "USD" }));
              return (
                <section key={col.key} className={"colm" + (dragOver === col.key ? " drop" : "")} aria-label={col.label}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOver !== col.key) setDragOver(col.key); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                  onDrop={(e) => onDrop(e, col.key)}>
                  <h3><span>{col.label}</span><span className="muted num">{items.length}</span></h3>
                  {total.length > 0 && <div className="xs muted num cv-coltotal">{sumMoney(total)}</div>}
                  {items.map((pv) => <ProjectCard key={pv.doc.id} pv={pv} />)}
                  {items.length === 0 && <div className="cv-colempty">Drop a project here</div>}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <ListView clients={clients.map((c) => ({ ...c, projects: c.projects.filter(match) }))} hasQuery={!!q.trim() || filter !== "all"} />
      )}

      {mode === "board" && visible.length === 0 && clients.length > 0 && (
        <div className="empty">Nothing matches. Try another filter or clear the search.</div>
      )}

      {mode === "board" && empty.length > 0 && (
        <div className="stack tight">
          <span className="label">Clients without a project yet</span>
          <div className="row wrap-ok">
            {empty.map((c) => c.client && <a key={c.ws} className="chip" href={`#/client/${c.client.id}`}>{c.name}</a>)}
          </div>
        </div>
      )}

      {adding && <AddClientModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function NextLine({ pv }: { pv: ProjectView }) {
  const pr = pv.priv?.data;
  const t = todayISO();
  if (pr?.waitingOn === "client") {
    return (
      <div className="next client">
        Waiting on them: {pr.waitingWhat || "a reply"}{pr.waitingSince ? ` since ${fmtDate(pr.waitingSince)}` : ""}
      </div>
    );
  }
  if (!pr?.nextStep) return <div className="next muted">No next step set</div>;
  const late = !!pr.nextDue && pr.nextDue < t;
  return (
    <div className={"next" + (late ? " late" : "")}>
      Next: {pr.nextStep}{pr.nextDue ? <span className="num"> · {relDate(pr.nextDue)}</span> : null}
    </div>
  );
}

function ProjectCard({ pv }: { pv: ProjectView }) {
  const p = pv.p;
  const st = currentStage(p);
  const pct = progressPct(p);
  const waiting = st ? stageState(p, p.current) === "waiting" : false;
  const f = flags(pv);
  const status = statusOf(p.status);
  const open = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("select, a, button, label")) return;
    go(hrefOf(pv));
  };
  return (
    <article className={"card click cv-card" + (p.archived ? " cv-archived" : "")} draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/x-project", pv.doc.id); e.dataTransfer.setData("text/plain", pv.doc.id); e.dataTransfer.effectAllowed = "move"; e.currentTarget.classList.add("cv-dragging"); }}
      onDragEnd={(e) => e.currentTarget.classList.remove("cv-dragging")}
      onClick={open}>
      <div className="row between top">
        <div className="stack" style={{ gap: 1, minWidth: 0 }}>
          <a className="cv-cardname trunc" href={hrefOf(pv)}>{pv.client?.data.name}</a>
          <TzClock tz={pv.client?.data.timezone} compact />
          <span className="small muted trunc">{p.title !== typeLabel(p.type) ? `${p.title} · ${typeLabel(p.type)}` : p.title}</span>
        </div>
        {p.status && p.status !== "on_track" && <span className={`pill ${status.cls} nodot cv-tiny`}>{status.label}</span>}
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <div className="row between small">
          <span className={"trunc" + (waiting ? " cv-amber" : "")}>{st ? st.name : "All stages done"}</span>
          <span className="muted num">{pct}%</span>
        </div>
        <div className={"progress" + (waiting ? " amber" : "")}><i style={{ width: pct + "%" }} /></div>
      </div>
      <div className="row between small">
        <span className="num cv-price">{p.proposal.price ? money(p.proposal.price, p.proposal.currency || "USD") : <span className="muted">No price</span>}</span>
        {p.promisedDelivery && (
          <span className={"num " + (f.deliveryLate ? "err" : "muted")} title="Promised delivery">
            Due {fmtDate(p.promisedDelivery)}
          </span>
        )}
      </div>
      {f.approvedNow && <div className="cv-approved small">Client approved {st?.name}. Move it on</div>}
      <NextLine pv={pv} />
      <div className="cv-move">
        <label className="sr-only" htmlFor={"mv" + pv.doc.id}>Move {pv.client?.data.name} to</label>
        <select id={"mv" + pv.doc.id} className="select cv-mini" value={p.pipeline}
          onChange={(e) => { const to = e.target.value as Pipeline; void run(() => setPipeline(pv.doc.id, to), `Moved to ${pipelineLabel(to)}`); }}>
          {PIPELINE.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </div>
    </article>
  );
}

function ListView({ clients, hasQuery }: { clients: ReturnType<typeof clientViews>; hasQuery: boolean }) {
  const shown = clients.filter((c) => c.projects.length > 0 || !hasQuery);
  if (!shown.length) return <div className="empty">Nothing matches. Try another filter or clear the search.</div>;
  return (
    <div className="stack">
      {shown.map((c) => (
        <section key={c.ws} className="panel tight cv-group">
          <div className="row between wrap-ok cv-grouphead">
            <div className="stack" style={{ gap: 0, minWidth: 0 }}>
              <a className="h3 cv-link" href={c.client ? `#/client/${c.client.id}` : "#/clients"}>{c.name}</a>
              <span className="small muted trunc">{c.client?.data.contactName || "No contact yet"} <TzClock tz={c.client?.data.timezone} /></span>
            </div>
            <span className="row" style={{ gap: 6 }}>
              <span className="small muted">{c.projects.length} project{c.projects.length === 1 ? "" : "s"}</span>
              {c.client && <LoginLinkButton client={c.client} compact />}
            </span>
          </div>
          {c.projects.length === 0 ? <p className="small muted cv-noproj">No projects yet. Open the client to add one.</p> : (
            <div className="cv-table" role="table" aria-label={`${c.name} projects`}>
              <div className="cv-tr cv-th" role="row">
                <span role="columnheader">Project</span><span role="columnheader">Stage</span><span role="columnheader">Next</span>
                <span role="columnheader">Delivery</span><span role="columnheader">Price</span><span role="columnheader">Pipeline</span>
              </div>
              {c.projects.map((pv) => {
                const st = currentStage(pv.p);
                const pct = progressPct(pv.p);
                const f = flags(pv);
                const pr = pv.priv?.data;
                return (
                  <div key={pv.doc.id} className="cv-tr" role="row">
                    <span role="cell" className="stack" style={{ gap: 0, minWidth: 0 }}>
                      <a className="cv-link trunc" href={hrefOf(pv)}>{pv.p.title}</a>
                      <span className="xs muted">{typeLabel(pv.p.type)}{pv.p.archived ? " · archived" : ""}</span>
                    </span>
                    <span role="cell" className="stack" style={{ gap: 4, minWidth: 0 }}>
                      <span className="small trunc">{st?.name || "All done"} <span className="muted num">{pct}%</span></span>
                      <span className={"progress" + (st && stageState(pv.p, pv.p.current) === "waiting" ? " amber" : "")}><i style={{ width: pct + "%" }} /></span>
                    </span>
                    <span role="cell" className={"small " + (pr?.waitingOn === "client" ? "cv-amber" : f.nextLate ? "err" : "")}>
                      {pr?.waitingOn === "client" ? `Waiting on them: ${pr.waitingWhat || "a reply"}` : pr?.nextStep || <span className="muted">Not set</span>}
                      {pr?.nextDue && pr?.waitingOn !== "client" && <span className="num muted"> · {relDate(pr.nextDue)}</span>}
                    </span>
                    <span role="cell" className={"small num " + (f.deliveryLate ? "err" : "")}>
                      <span className="cv-mlabel">Delivery </span>{pv.p.promisedDelivery ? fmtDate(pv.p.promisedDelivery) : <span className="muted">Not set</span>}
                    </span>
                    <span role="cell" className="small num"><span className="cv-mlabel">Price </span>{pv.p.proposal.price ? money(pv.p.proposal.price, pv.p.proposal.currency || "USD") : <span className="muted">None</span>}</span>
                    <span role="cell">
                      <select className="select cv-mini" aria-label={`Pipeline for ${pv.p.title}`} value={pv.p.pipeline}
                        onChange={(e) => { const to = e.target.value as Pipeline; void run(() => setPipeline(pv.doc.id, to), `Moved to ${pipelineLabel(to)}`); }}>
                        {PIPELINE.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function AddClientModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", contactName: "", greetingName: "", email: "", notes: "", timezone: "" });
  const [withProject, setWithProject] = useState(true);
  const [type, setType] = useState<ProjectType>("shopify_redesign");
  const [title, setTitle] = useState("");
  const [pipeline, setPipe] = useState<Pipeline>("lead");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    if (!f.name.trim()) { setErr("Add the client or brand name."); return; }
    if (!navigator.onLine) { const m = "You are offline. Adding a client creates their encrypted space, so it needs the internet."; setErr(m); toast(m, undefined, 7000); return; }
    setBusy(true); setErr("");
    try {
      const id = await addClient({
        name: f.name.trim(), contactName: f.contactName.trim() || undefined, greetingName: f.greetingName.trim() || undefined,
        notes: f.notes.trim() || undefined, timezone: f.timezone || undefined,
      });
      const ws = doc<ClientRec>(id)?.data.ws;
      let pid: string | undefined;
      if (withProject && ws) pid = await addProject(ws, type, title.trim() || undefined, { pipeline });
      toast(`${f.name.trim()} added`);
      onClose();
      go(pid ? `#/client/${id}/project/${pid}` : `#/client/${id}`);
    } catch (e) {
      const m = errMsg(e);
      setErr(m); toast(m, undefined, 7000);
    } finally { setBusy(false); }
  };

  return (
    <Modal title="Add client" onClose={onClose}
      footer={<>
        <button className="btn quiet" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Creating their space..." : "Add client"}</button>
      </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Client or brand name"><input className="input" value={f.name} onChange={set("name")} autoFocus required placeholder="Brand name" /></Field>
        <div className="cv-2">
          <Field label="Contact name"><input className="input" value={f.contactName} onChange={set("contactName")} placeholder="Full name" /></Field>
          <Field label="Greeting name" hint="How you open emails, eg their first name"><input className="input" value={f.greetingName} onChange={set("greetingName")} placeholder={f.contactName.split(" ")[0] || "First name"} /></Field>
        </div>
        <Field label="Time zone" hint="Shows their local time on the board"><TzSelect value={f.timezone} onChange={(v) => setF({ ...f, timezone: v })} /></Field>
        <Field label="Private notes" hint="Only you see these"><textarea className="textarea" value={f.notes} onChange={set("notes")} rows={3} /></Field>
        <div className="divider" />
        <label className="row"><input type="checkbox" className="check" checked={withProject} onChange={(e) => setWithProject(e.target.checked)} /> <span className="h3">Add a first project</span></label>
        {withProject && (
          <div className="stack tight">
            <div className="cv-types" role="radiogroup" aria-label="Project type">
              {PROJECT_TYPES.map((t) => (
                <label key={t.key} className={"cv-type" + (type === t.key ? " on" : "")}>
                  <input type="radio" name="ptype" checked={type === t.key} onChange={() => setType(t.key)} />
                  {t.label}
                </label>
              ))}
            </div>
            <div className="cv-2">
              <Field label="Project title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={typeLabel(type)} /></Field>
              <Field label="Pipeline">
                <select className="select" value={pipeline} onChange={(e) => setPipe(e.target.value as Pipeline)}>
                  {PIPELINE.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </Field>
            </div>
          </div>
        )}
        {!navigator.onLine && <div className="banner">You are offline. Adding a client needs the internet.</div>}
        {err && <p className="err" role="alert">{err}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
