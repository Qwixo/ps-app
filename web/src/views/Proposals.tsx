import { useMemo, useState } from "react";
import "./extra.css";
import "./pipeline.css";
import { PIPELINE, priceUnitOf, startsLater } from "../core/model";
import type { Proposal } from "../core/model";
import { owedTotals, projectViews } from "../core/select";
import type { ProjectView } from "../core/select";
import { Icon, daysFromToday, fmtDate, money, relDate, todayISO, useVault } from "../ui/kit";
import { ProposalView } from "./ProposalView";
import { ProjectDocs } from "./ProjectDocs";
import { Chevron, Collapse } from "./Accordion";

type Filter = "month" | "quoted" | "next" | "history" | "all";
type PStatus = "draft" | "sent" | "accepted" | "superseded" | "declined" | "none";

const STATUS: Record<PStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "ink" },
  sent: { label: "Sent, waiting", cls: "warn" },
  accepted: { label: "Accepted", cls: "good" },
  superseded: { label: "Superseded", cls: "ink" },
  declined: { label: "Declined", cls: "bad" },
  none: { label: "No proposal", cls: "ink" },
};
const ACTIVE_PIPES = new Set(["signed", "in_build", "client_review", "live", "cro"]);

function propStatus(pv: ProjectView): PStatus {
  const st = pv.p.proposal?.status;
  if (st) return st;
  if (pv.p.pipeline === "proposal_sent") return "sent";
  if (ACTIVE_PIPES.has(pv.p.pipeline) || pv.p.pipeline === "finished") return pv.p.proposal?.signedAt ? "accepted" : "none";
  return "none";
}
const SIGNED_OR_LATER = new Set(["signed", "in_build", "client_review", "live", "cro", "finished"]);
const dead = (pv: ProjectView) => ["declined", "superseded"].includes(propStatus(pv));
/** Signed work (any stage from signed to finished). */
const isSigned = (pv: ProjectView) => !dead(pv) && (SIGNED_OR_LATER.has(pv.p.pipeline) || propStatus(pv) === "accepted");
/** Quoted and waiting on a yes: not signed, not dead. */
const isQuoted = (pv: ProjectView) => !dead(pv) && !isSigned(pv) && (pv.p.pipeline === "lead" || pv.p.pipeline === "proposal_sent");
/** Signed, but the money starts in a later month (eg CRO from go-live). */
const isNext = (pv: ProjectView) => isSigned(pv) && pv.p.pipeline !== "finished" && startsLater(pv.p, todayISO().slice(0, 7));
/** This month's active work: signed, not finished, not starting later. */
const isMonth = (pv: ProjectView) => isSigned(pv) && pv.p.pipeline !== "finished" && !isNext(pv);
const isHistory = (pv: ProjectView) => !dead(pv) && pv.p.pipeline === "finished";

type M = { amount: number; currency: string };
// The developer wants every Pipeline figure in US dollars, nothing mixed. Other currencies are converted
// at a fixed rate (update it here if it drifts); proposals themselves keep the client's currency.
const FX: Record<string, number> = { USD: 1, GBP: 1.27, EUR: 1.08 };
const toUsd = (amount: number, cur?: string | null) => amount * (FX[(cur || "USD").toUpperCase()] ?? 1);
const usd1 = (amount: number, cur?: string | null) => money(Math.round(toUsd(amount, cur) * 100) / 100, "USD");
const usd = (list: { amount: number; currency: string }[]) => usd1(list.reduce((n, x) => n + toUsd(x.amount, x.currency), 0), "USD");
const curOf = (pv: ProjectView) => pv.p.proposal?.currency || pv.p.payments?.[0]?.currency || "USD";
/** Money still to come on a project: the unpaid payments, or the price less what is already paid.
 *  Retainers count one month's fee; per video work is shown on its own, never guessed. */
function toCome(pv: ProjectView): M[] {
  const p = pv.p;
  const price = p.proposal?.price;
  const unit = priceUnitOf(p);
  if (unit === "video") return [];
  if (unit === "month") return price ? [{ amount: price, currency: curOf(pv) }] : [];
  const pays = p.payments || [];
  if (pays.length && pays.every((x) => typeof x.amount === "number")) {
    return pays.filter((x) => x.status !== "paid").map((x) => ({ amount: x.amount, currency: x.currency }));
  }
  if (price == null) return [];
  const paid = pays.filter((x) => x.status === "paid" && typeof x.amount === "number").reduce((n, x) => n + x.amount, 0);
  return price - paid > 0 ? [{ amount: price - paid, currency: curOf(pv) }] : [];
}
function priceLabel(pv: ProjectView) {
  const pr = pv.p.proposal;
  if (pr?.price == null) return "No price";
  const unit = priceUnitOf(pv.p);
  return usd1(pr.price, pr.currency) + (unit === "month" ? " / month" : unit === "video" ? " / video" : "");
}
const finished = (pv: ProjectView) => pv.p.pipeline === "finished" || pv.p.current >= pv.p.stages.length;
const hrefOf = (pv: ProjectView) => (pv.client ? `#/client/${pv.client.id}/project/${pv.doc.id}` : "#/clients");

export function ProposalsView() {
  const s = useVault();
  const [filter, setFilter] = useState<Filter>("month");
  const all = useMemo(() => projectViews(s).filter((pv) => !pv.p.archived && !pv.client?.data.archived), [s]);
  const monthName = new Date().toLocaleDateString(undefined, { month: "long" });
  const TESTS: Record<Filter, (pv: ProjectView) => boolean> = { month: isMonth, quoted: isQuoted, next: isNext, history: isHistory, all: () => true };
  const counts = Object.fromEntries((Object.keys(TESTS) as Filter[]).map((k) => [k, all.filter(TESTS[k]).length])) as Record<Filter, number>;
  const list = all
    .filter(TESTS[filter])
    .sort((a, b) => {
      const da = a.p.promisedDelivery || a.p.proposal?.sentAt || "9999";
      const db = b.p.promisedDelivery || b.p.proposal?.sentAt || "9999";
      return da.localeCompare(db) || (a.client?.data.name || "").localeCompare(b.client?.data.name || "");
    });
  const EMPTY: Record<Filter, string> = {
    month: `Nothing signed is still paying you in ${monthName}.`,
    quoted: "No proposals waiting on an answer right now.",
    next: "Nothing signed is waiting to start in a later month.",
    history: "No finished projects yet.",
    all: "No projects yet. Add a client to start.",
  };

  return (
    <div className="stack loose">
      <div className="x-head">
        <span className="label">Pipeline</span>
        <h1 className="h1">Pipeline</h1>
        <p>What is still to come in this month, what landed, and what is quoted but not signed yet.</p>
      </div>

      <PipelineSummary />

      <section className="stack" aria-labelledby="props-h">
        <div className="x-section-title">
          <h2 className="h2" id="props-h">By client</h2>
          <div className="tabs" role="tablist" aria-label="Filter proposals">
            {([["month", monthName], ["quoted", "Quoted"], ["next", "Up next"], ["history", "History"], ["all", "All"]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} role="tab" className="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>
                {l} <span className="num muted">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>
        {filter === "history" && <MoneyByMonth />}
        {list.length === 0 ? (
          <div className="empty">{EMPTY[filter]}</div>
        ) : (
          <ClientGroups list={list} mode={filter} />
        )}
      </section>
    </div>
  );
}

interface Group { ws: string; name: string; projects: ProjectView[] }

function ClientGroups({ list, mode }: { list: ProjectView[]; mode: Filter }) {
  const groups: Group[] = [];
  for (const pv of list) {
    let g = groups.find((x) => x.ws === pv.ws);
    if (!g) { g = { ws: pv.ws, name: pv.client?.data.name || "Client", projects: [] }; groups.push(g); }
    g.projects.push(pv);
  }
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [openProj, setOpenProj] = useState<Record<string, boolean>>({});
  const isOpen = (ws: string, i: number) => touched[ws] ?? i === 0;

  return (
    <ul className="acc-groups pl-groups">
      {groups.map((g, gi) => {
        const open = isOpen(g.ws, gi);
        // This month: what is still to come in. Elsewhere: the quoted prices (one off fees and monthly fees).
        const priced = mode === "month" ? g.projects.flatMap(toCome)
          : g.projects.filter((pv) => pv.p.proposal?.price != null && pv.p.proposal.price > 0 && priceUnitOf(pv.p) !== "video")
            .map((pv) => ({ amount: pv.p.proposal!.price!, currency: pv.p.proposal!.currency || "USD" }));
        const perVideo = g.projects.filter((pv) => priceUnitOf(pv.p) === "video" && pv.p.proposal?.price);
        const waitingN = g.projects.filter((pv) => propStatus(pv) === "sent").length;
        const bodyId = `pl-grp-${g.ws}`;
        return (
          <li key={g.ws} className={`acc-group${open ? " open" : ""}`}>
            <button type="button" className="acc-row" aria-expanded={open} aria-controls={bodyId} onClick={() => setTouched((t) => ({ ...t, [g.ws]: !open }))}>
              <span className="acc-mono" aria-hidden="true">{g.name.charAt(0).toUpperCase()}</span>
              <span className="acc-main">
                <span className="acc-name">{g.name}</span>
                <span className="acc-sub num">{g.projects.length} proposal{g.projects.length > 1 ? "s" : ""}{waitingN ? `, ${waitingN} waiting on an answer` : ""}</span>
              </span>
              <span className="acc-side">
                <span className="pl-total-w">
                  <b className="pl-total num">{priced.length ? usd(priced) : perVideo.length ? priceLabel(perVideo[0]) : mode === "month" ? "Nothing due" : "No price"}</b>
                  {mode === "month" && priced.length > 0 && <span className="pl-total-s">to come{perVideo.length ? ` + ${priceLabel(perVideo[0])}` : ""}</span>}
                </span>
                <Chevron open={open} />
              </span>
            </button>
            <Collapse open={open} id={bodyId}>
              <ul className="pl-projs">
                {g.projects.map((pv) => (
                  <ProjectRow key={pv.doc.id} pv={pv} mode={mode} open={!!openProj[pv.doc.id]} onToggle={() => setOpenProj((o) => ({ ...o, [pv.doc.id]: !o[pv.doc.id] }))} />
                ))}
              </ul>
            </Collapse>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectRow({ pv, mode, open, onToggle }: { pv: ProjectView; mode: Filter; open: boolean; onToggle: () => void }) {
  const p = pv.p;
  const pr = p.proposal || { scope: [] };
  const st = propStatus(pv);
  const done = finished(pv);
  const late = !!p.promisedDelivery && !done && p.promisedDelivery < todayISO();
  const pct = done ? 100 : p.stages.length ? Math.round((p.current / p.stages.length) * 100) : 0;
  const pipe = PIPELINE.find((x) => x.key === p.pipeline)?.label;
  const bodyId = `pl-proj-${pv.doc.id}`;
  const when = pr.signedAt ? `Signed ${fmtDate(pr.signedAt)}` : pr.sentAt ? `Sent ${fmtDate(pr.sentAt)}` : "Not sent yet";
  const delivery = p.promisedDelivery ? `${done ? "Delivered" : "Delivery"} ${done ? fmtDate(p.promisedDelivery) : relDate(p.promisedDelivery)}` : "";
  return (
    <li className={`pl-proj${open ? " open" : ""}`}>
      <button type="button" className="pl-proj-h" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="pl-proj-main">
          <b className="pl-proj-t">{p.title}</b>
          <span className="pl-pills">
            <span className={`pill ${STATUS[st].cls}`}>{STATUS[st].label}</span>
            {pipe && <span className="pill plain">{pipe}</span>}
          </span>
          <span className="pl-proj-meta num">
            <span>{when}</span>
            {delivery && <span className={late ? "late" : undefined}>{delivery}</span>}
          </span>
          <span className={`acc-mini${late ? " amber" : ""}`} aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
        </span>
        <span className="pl-proj-side">
          {mode === "month" && pr.price != null && priceUnitOf(p) !== "video" ? (
            <span className="pl-price-w">
              <b className="pl-price num">{(() => { const c = toCome(pv); return c.length ? usd(c) : "Paid"; })()}</b>
              <span className="pl-price-of num">{toCome(pv).length ? `to come, of ${priceLabel(pv)}` : `of ${priceLabel(pv)}`}</span>
            </span>
          ) : (
            <b className="pl-price num">{priceLabel(pv)}</b>
          )}
          {isNext(pv) && p.startsMonth && <span className="pill plain">Starts {new Date(p.startsMonth + "-01T12:00:00").toLocaleDateString(undefined, { month: "long" })}</span>}
          <span className="pl-open">{open ? "Hide" : "Proposal"} <Chevron open={open} size={15} /></span>
        </span>
      </button>
      <Collapse open={open} id={bodyId} lazy>
        <div className="pl-embed">
          <ProposalBody pv={pv} />
          <ProposalDocs pr={pr as Proposal} />
          <ProjectDocs projectId={pv.doc.id} owner />
          <div className="row wrap-ok">
            <a className="btn ghost sm" href={hrefOf(pv)}><Icon name="edit" size={15} /> Edit project</a>
          </div>
        </div>
      </Collapse>
    </li>
  );
}

function ProposalBody({ pv }: { pv: ProjectView }) {
  const pr = pv.p.proposal;
  const has = !!pr && ((pr.scope || []).length > 0 || pr.price != null || !!pr.timelineText || !!pr.afterLaunch || (pr.links || []).length > 0);
  if (!has && pv.p.type !== "shopify_redesign" && pv.p.type !== "cro_retainer") {
    return <p className="small muted">No proposal written yet. Add the scope and price on the project.</p>;
  }
  return <ProposalView pv={pv} />;
}

function docsOf(pr: Proposal) {
  const links = [...(pr.links || [])];
  if (!links.length && pr.url && /^https?:\/\//i.test(pr.url)) links.push({ label: "Proposal", url: pr.url, kind: "live" });
  const live = links.filter((l) => l.kind === "live");
  const pdf = links.filter((l) => l.kind === "pdf");
  const other = links.filter((l) => l.kind === "other" || !l.kind);
  const old = links.filter((l) => l.kind === "superseded");
  return { main: live[0] || other[0] || null, rest: [...live.slice(1), ...pdf, ...other.filter((l) => l !== (live[0] ? null : other[0]))], old };
}

function ProposalDocs({ pr }: { pr: Proposal }) {
  const d = docsOf(pr);
  if (!d.main && !d.rest.length && !d.old.length) return <span className="small muted">No proposal document linked yet.</span>;
  const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
  return (
    <div className="stack tight">
      <div className="row wrap-ok">
        {d.main && <a className="btn primary sm" href={d.main.url} {...ext}><Icon name="proposals" size={15} /> Open proposal</a>}
        {d.rest.map((l, i) => (
          <a key={i} className="btn ghost sm" href={l.url} {...ext}><Icon name={l.kind === "pdf" ? "down" : "link"} size={15} /> {l.label || (l.kind === "pdf" ? "PDF" : "Document")}</a>
        ))}
      </div>
      {d.old.length > 0 && (
        <details className="x-older">
          <summary className="small muted">Older versions ({d.old.length})</summary>
          <ul>
            {d.old.map((l, i) => (
              <li key={i}><a href={l.url} {...ext}>{l.label || "Earlier version"}</a>{l.date ? <span className="xs"> · {fmtDate(l.date)}</span> : null}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PipelineSummary() {
  const s = useVault();
  const all = projectViews(s);
  const live = all.filter((pv) => !pv.p.archived && !pv.client?.data.archived);
  const month = todayISO().slice(0, 7);
  const monthName = new Date().toLocaleDateString(undefined, { month: "long" });

  // The headline: money still to come in on this month's signed work.
  const active = live.filter(isMonth);
  const coming = active.flatMap(toCome);
  const paying = active.filter((pv) => toCome(pv).length).length;
  const perVideo = active.filter((pv) => priceUnitOf(pv.p) === "video" && pv.p.proposal?.price);

  const quoted = live.filter(isQuoted).filter((pv) => pv.p.proposal?.price != null && pv.p.proposal.price > 0 && priceUnitOf(pv.p) !== "video");
  const quotedMoney = quoted.map((pv) => ({ amount: pv.p.proposal!.price!, currency: pv.p.proposal!.currency || "USD" }));

  const made: M[] = [];
  for (const pv of all) for (const pay of pv.p.payments || []) {
    if (pay.status === "paid" && typeof pay.amount === "number" && pay.paidAt?.slice(0, 7) === month) made.push({ amount: pay.amount, currency: pay.currency });
  }

  const owedDue: (string | null)[] = [];
  const { owed } = owedTotals(s);
  for (const pv of all) for (const pay of pv.p.payments || []) if (pay.status === "owed") owedDue.push(pay.due ?? null);
  const oldest = owedDue.filter((x): x is string => !!x).sort()[0];
  const lateDays = oldest ? -daysFromToday(oldest) : 0;

  const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
  return (
    <section className="pl-tiles" aria-label="Pipeline summary">
      <div className="pl-tile hero">
        <span className="pl-k">{monthName} pipeline</span>
        <b className="num">{usd(coming)}</b>
        <span className="pl-s">
          {paying ? `Still to come from ${n(paying, "signed project")}` : `Nothing signed still to come in ${monthName}`}
          {perVideo.length > 0 && `, plus ${perVideo.map((pv) => priceLabel(pv)).join(", ")}`}
        </span>
      </div>
      <div className="pl-tile good">
        <span className="pl-k">Made in {monthName}</span>
        <b className="num">{usd(made)}</b>
        <span className="pl-s">{made.length ? `${n(made.length, "payment")} in ${monthName}` : `Nothing paid yet in ${monthName}`}</span>
      </div>
      <div className={`pl-tile${owed.length ? " bad" : ""}`}>
        <span className="pl-k">Owed now</span>
        <b className="num">{usd(owed)}</b>
        <span className="pl-s">{owed.length ? `${n(owed.length, "payment")}${lateDays > 0 ? `, oldest ${n(lateDays, "day")} late` : ""}` : "Nobody owes you anything"}</span>
      </div>
      <div className="pl-tile">
        <span className="pl-k">Quoted, not signed</span>
        <b className="num">{usd(quotedMoney)}</b>
        <span className="pl-s">{quoted.length ? `${n(quoted.length, "proposal")}, not counted above` : "Nothing quoted and waiting"}</span>
      </div>
    </section>
  );
}

/** History: what landed, month by month, newest first. */
function MoneyByMonth() {
  const s = useVault();
  const byMonth = new Map<string, { who: string; label: string; amount: number; currency: string; date: string }[]>();
  for (const pv of projectViews(s)) for (const pay of pv.p.payments || []) {
    if (pay.status !== "paid" || typeof pay.amount !== "number" || !pay.paidAt) continue;
    const k = pay.paidAt.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push({ who: pv.client?.data.name || "Client", label: `${pv.p.title}, ${pay.label}`, amount: pay.amount, currency: pay.currency, date: pay.paidAt });
  }
  const months = [...byMonth.keys()].sort().reverse();
  if (!months.length) return <div className="empty">No paid payments with a date yet.</div>;
  return (
    <ul className="pl-months">
      {months.map((k) => {
        const rows = byMonth.get(k)!.sort((a, b) => b.date.localeCompare(a.date));
        return (
          <li key={k} className="panel pl-month">
            <div className="row between">
              <b>{new Date(k + "-01T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
              <b className="num pl-month-sum">{usd(rows)}</b>
            </div>
            <ul className="pl-month-rows">
              {rows.map((r, i) => (
                <li key={i}>
                  <span className="pl-month-who">{r.who}</span>
                  <span className="pl-month-what small muted">{r.label} · {fmtDate(r.date)}</span>
                  <b className="num">{usd1(r.amount, r.currency)}</b>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
