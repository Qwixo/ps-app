// The Clients dashboard: one card per client in the developer's own order, the projects he is
// actively working on first inside each card.
import type { ClientStatus } from "../core/model";
import { CLIENT_STATUSES, currentStage, progressPct, serviceOf, stageState, typeLabel, type Service } from "../core/model";
import type { ClientView, ProjectView } from "../core/select";
import { clientStatus } from "../core/select";
import { updateClient } from "../core/actions";
import { Icon, TzClock, fmtDate, money, relDate, sumMoney, todayISO } from "../ui/kit";
import { flags, run } from "./project/bits";

const SERVICE_ICON: Record<Service, string> = { shopify: "S", cro: "C", amazon: "A", other: "O" };

export async function saveClientOrder(ids: string[]) {
  for (let i = 0; i < ids.length; i++) await updateClient(ids[i], { order: (i + 1) * 10 });
}

export function ClientsDashboard({ clients, service, onlyProjects }: {
  clients: ClientView[];
  service: Service | "all";
  onlyProjects: (pv: ProjectView) => boolean;
}) {
  const ids = clients.map((c) => c.client!.id);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    void run(() => saveClientOrder(next));
  };

  if (!clients.length) return <div className="empty">Nobody here yet.</div>;

  return (
    <div className="cvd-grid">
      {clients.map((c, i) => {
        const projects = c.projects.filter((pv) => (service === "all" || serviceOf(pv.p.type) === service) && onlyProjects(pv));
        const active = c.projects.filter((pv) => !pv.p.archived && !["finished", "lead"].includes(pv.p.pipeline));
        const owed = c.projects.flatMap((pv) => pv.p.payments.filter((p) => p.status === "owed").map((p) => ({ amount: p.amount, currency: p.currency })));
        return (
          <article key={c.ws} className="panel cvd-card">
            <header className="cvd-head">
              <span className="cvd-rank num" aria-hidden="true">{i + 1}</span>
              <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                <a className="cvd-name" href={`#/client/${c.client!.id}`}>{c.name}</a>
                <span className="small muted cvd-sub">
                  {c.client!.data.contactName || "No contact yet"}
                  {c.client!.data.timezone && <> · <TzClock tz={c.client!.data.timezone} /></>}
                </span>
              </div>
              <div className="row cvd-actions">
                <a className="btn ghost sm" href={`#/preview/${c.ws}`} title="See exactly what they see"><Icon name="eye" size={15} /> Their page</a>
                <StatusSelect c={c} />
                <button className="btn quiet icon sm" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={16} /></button>
                <button className="btn quiet icon sm" aria-label={`Move ${c.name} down`} disabled={i === clients.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={16} /></button>
              </div>
            </header>
            <div className="row wrap-ok cvd-meta small">
              <span className="pill plain">{active.length} active project{active.length === 1 ? "" : "s"}</span>
              {owed.length > 0 && <span className="pill bad">Owed {sumMoney(owed)}</span>}
            </div>
            {projects.length === 0 ? (
              <p className="small muted">{c.projects.length ? "No projects match this filter." : "No projects yet."}</p>
            ) : (
              <ul className="cvd-projects" role="list">
                {projects.map((pv) => <ProjectRow key={pv.doc.id} pv={pv} clientId={c.client!.id} />)}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}

function StatusSelect({ c }: { c: ClientView }) {
  const cur = clientStatus(c);
  return (
    <select className="select cv-mini" aria-label={`Status of ${c.name}`} value={cur}
      onChange={(e) => { const v = e.target.value as ClientStatus; void run(() => updateClient(c.client!.id, { status: v }), `${c.name} moved to ${CLIENT_STATUSES.find((x) => x.key === v)?.label}`); }}>
      {CLIENT_STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label.replace(/s$/, "")}</option>)}
    </select>
  );
}

function ProjectRow({ pv, clientId }: { pv: ProjectView; clientId: string }) {
  const p = pv.p;
  const st = currentStage(p);
  const pct = progressPct(p);
  const waitingStage = st ? stageState(p, p.current) === "waiting" : false;
  const f = flags(pv);
  const pr = pv.priv?.data;
  const svc = serviceOf(p.type);
  const late = !!pr?.nextDue && pr.nextDue < todayISO();
  const quiet = p.archived || p.pipeline === "finished" || p.pipeline === "lead";
  return (
    <li className={"cvd-row" + (quiet ? " quiet" : "")}>
      <a className="cvd-rowlink" href={`#/client/${clientId}/project/${pv.doc.id}`}>
        <span className={`cvd-svc ${svc}`} title={typeLabel(p.type)} aria-hidden="true">{SERVICE_ICON[svc]}</span>
        <span className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
          <span className="row between" style={{ gap: 8 }}>
            <span className="cvd-title trunc">{p.title}</span>
            <span className="small num muted" style={{ flex: "none" }}>
              {p.proposal.price ? money(p.proposal.price, p.proposal.currency || "USD") : ""}
            </span>
          </span>
          <span className="row" style={{ gap: 10 }}>
            <span className={"small trunc " + (waitingStage ? "cv-amber" : "")} style={{ minWidth: 0 }}>
              {p.pipeline === "lead" ? "Lead" : p.pipeline === "proposal_sent" ? "Proposal sent" : st?.name || "All done"}
            </span>
            <span className={"progress cvd-bar" + (waitingStage ? " amber" : "")}><i style={{ width: pct + "%" }} /></span>
            {p.promisedDelivery && p.current < p.stages.length && (
              <span className={"xs num " + (f.deliveryLate ? "err" : "muted")} style={{ flex: "none" }}>Due {fmtDate(p.promisedDelivery)}</span>
            )}
          </span>
          {pr?.waitingOn === "client" ? (
            <span className="small cv-amber trunc">Waiting on them: {pr.waitingWhat || "a reply"}</span>
          ) : pr?.nextStep ? (
            <span className={"small trunc " + (late ? "err" : "muted")}>Next: {pr.nextStep}{pr.nextDue ? ` · ${relDate(pr.nextDue)}` : ""}</span>
          ) : null}
        </span>
      </a>
    </li>
  );
}
