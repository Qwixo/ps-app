// Overview tab: your next step (private), what was promised (proposal + delivery), visibility.
import { useEffect, useRef, useState } from "react";
import type { Project, ProjectPrivate, Proposal } from "../../core/model";
import type { ProjectView } from "../../core/select";
import { pushDelivery, setProjectVisible, shiftStageDates, updatePrivate, updateProject } from "../../core/actions";
import { Field, Icon, addDays, daysFromToday, fmtDate, fmtDateTime, go, money, todayISO } from "../../ui/kit";
import { CURRENCIES, EditArea, EditDate, EditNumber, EditText, ListEditor, PrivatePill, ClientPill, Section, Segmented, Switch, daysLabel, run } from "./bits";
import { ProjectDocs } from "../ProjectDocs";

export function OverviewTab({ pv }: { pv: ProjectView }) {
  return (
    <div className="stack loose">
      <NextStep pv={pv} />
      <Delivery pv={pv} />
      <ProposalBlock pv={pv} />
      <Visibility pv={pv} />
    </div>
  );
}

// ---------- your next step ----------
type Waiting = "me" | "client" | "nobody";
function NextStep({ pv }: { pv: ProjectView }) {
  const pr = pv.priv?.data;
  const init = () => ({
    nextStep: pr?.nextStep || "", nextDue: pr?.nextDue || "",
    waitingOn: (pr?.waitingOn || "nobody") as Waiting, waitingWhat: pr?.waitingWhat || "", waitingSince: pr?.waitingSince || "",
  });
  const baseStr = JSON.stringify(init());
  const [f, setF] = useState(init);
  const prevBase = useRef(baseStr);
  // Pick up changes saved here or on another device, unless the form has unsaved edits.
  useEffect(() => {
    if (prevBase.current === baseStr) return;
    setF((cur) => (JSON.stringify(cur) === prevBase.current ? JSON.parse(baseStr) : cur));
    prevBase.current = baseStr;
  }, [baseStr]);
  const dirty = JSON.stringify(f) !== baseStr;

  const late = !!f.nextDue && f.nextDue < todayISO();
  const save = () => {
    const patch: Partial<ProjectPrivate> = {
      nextStep: f.nextStep.trim() || null, nextDue: f.nextDue || null,
      waitingOn: f.waitingOn === "nobody" ? null : f.waitingOn,
      waitingWhat: f.waitingOn === "client" ? f.waitingWhat.trim() || null : null,
      waitingSince: f.waitingOn === "client" ? f.waitingSince || todayISO() : null,
    };
    const text = f.waitingOn === "client"
      ? `Waiting on client: ${patch.waitingWhat || "a reply"}`
      : patch.nextStep ? `Next step: ${patch.nextStep}${patch.nextDue ? ` (by ${fmtDate(patch.nextDue)})` : ""}` : "Next step cleared";
    void run(() => updatePrivate(pv.doc.id, patch, text), "Next step saved");
  };
  const syncFromDoc = () => setF(init());

  return (
    <Section title="Your next step" aside={<PrivatePill />}>
      <div className="cv-next-grid">
        <Field label="What you do next">
          <textarea className="textarea" rows={2} style={{ minHeight: 64 }} value={f.nextStep} placeholder="eg Send 3 homepage directions" onChange={(e) => setF({ ...f, nextStep: e.target.value })} />
        </Field>
        <Field label="By when">
          <input className={"input" + (late ? " cv-late-input" : "")} type="date" value={f.nextDue} onChange={(e) => setF({ ...f, nextDue: e.target.value })} />
        </Field>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Who is it waiting on?</span>
        <Segmented name={"wait" + pv.doc.id} value={f.waitingOn}
          options={[{ key: "me", label: "Me" }, { key: "client", label: "The client" }, { key: "nobody", label: "Nobody" }]}
          onChange={(v) => setF({ ...f, waitingOn: v, waitingSince: v === "client" && !f.waitingSince ? todayISO() : f.waitingSince })} />
      </div>
      {f.waitingOn === "client" && (
        <div className="cv-next-grid cv-amberbox">
          <Field label="Waiting on them for">
            <textarea className="textarea" rows={2} style={{ minHeight: 64 }} value={f.waitingWhat} placeholder="eg Logo files and brand fonts" onChange={(e) => setF({ ...f, waitingWhat: e.target.value })} />
          </Field>
          <Field label="Since">
            <input className="input" type="date" value={f.waitingSince} onChange={(e) => setF({ ...f, waitingSince: e.target.value })} />
          </Field>
          {f.waitingSince && <p className="small cv-amber" style={{ gridColumn: "1 / -1" }}>{waitedFor(f.waitingSince)}</p>}
        </div>
      )}
      <div className="row wrap-ok">
        <button className="btn primary" onClick={save} disabled={!dirty}><Icon name="check" size={16} /> Save next step</button>
        {dirty && <button className="btn quiet" onClick={syncFromDoc}>Discard</button>}
        {late && <span className="err">This date has passed</span>}
      </div>
    </Section>
  );
}
function waitedFor(since: string) {
  const n = -daysFromToday(since);
  if (n <= 0) return "Since today";
  return `Waiting ${n} day${n === 1 ? "" : "s"} so far`;
}

// ---------- delivery date + push back ----------
function Delivery({ pv }: { pv: ProjectView }) {
  const p = pv.p;
  const done = p.current >= p.stages.length;
  const dl = daysLabel(p.promisedDelivery);
  const [amount, setAmount] = useState<number | "pick" | null>(null);
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [shift, setShift] = useState(true);
  const base = p.promisedDelivery || todayISO();
  const target = amount === "pick" ? pick : amount ? addDays(base, amount) : "";
  const diff = target && p.promisedDelivery ? daysFromToday(target) - daysFromToday(p.promisedDelivery) : 0;
  const slip = p.originalDelivery && p.promisedDelivery ? daysFromToday(p.promisedDelivery) - daysFromToday(p.originalDelivery) : 0;

  const push = async () => {
    if (!target) return;
    const ok = await run(async () => {
      await pushDelivery(pv.doc.id, target, reason.trim() || undefined);
      if (shift && diff) await shiftStageDates(pv.doc.id, p.current, diff);
    }, `Delivery moved to ${fmtDate(target)}`);
    if (ok) { setAmount(null); setPick(""); setReason(""); }
  };

  return (
    <Section title="Promised delivery" aside={<ClientPill />}>
      <div className="cv-delivery">
        <div className={"cv-bignum" + (dl.late && !done ? " late" : "")}>
          <b className="num">{done ? "Delivered" : dl.big}</b>
          <span className="small muted">{done ? "all stages are done" : dl.small}</span>
        </div>
        <dl className="kv cv-kv">
          <dt>Promised</dt>
          <dd>
            {p.promisedDelivery ? <b>{fmtDate(p.promisedDelivery)}</b> : (
              <span className="row wrap-ok">
                <EditDate value={null} label="Set promised delivery date" className="input cv-mini-date"
                  onSave={(v) => v && void run(() => updateProject(pv.doc.id, { promisedDelivery: v, originalDelivery: p.originalDelivery || v }), "Delivery date set")} />
              </span>
            )}
          </dd>
          {p.originalDelivery && p.originalDelivery !== p.promisedDelivery && (<>
            <dt>Originally</dt>
            <dd><span className="strike">{fmtDate(p.originalDelivery)}</span> <span className={"pill nodot " + (slip > 0 ? "warn" : "good")}>{slip > 0 ? `${slip} day${slip === 1 ? "" : "s"} later` : `${-slip} day${slip === -1 ? "" : "s"} earlier`}</span></dd>
          </>)}
          <dt>Started</dt>
          <dd><EditDate value={p.startDate} label="Start date" className="input cv-mini-date" onSave={(v) => void run(() => updateProject(pv.doc.id, { startDate: v }), "Start date saved")} /></dd>
        </dl>
      </div>

      {p.promisedDelivery && (
        <div className="cv-push stack tight">
          <span className="label">Push it back</span>
          <div className="row wrap-ok" role="group" aria-label="Push back by">
            {[{ n: 3, l: "+3 days" }, { n: 7, l: "+1 week" }, { n: 14, l: "+2 weeks" }].map((o) => (
              <button key={o.n} className="chip" aria-pressed={amount === o.n} onClick={() => setAmount(amount === o.n ? null : o.n)}>{o.l}</button>
            ))}
            <button className="chip" aria-pressed={amount === "pick"} onClick={() => setAmount(amount === "pick" ? null : "pick")}>Pick a date</button>
          </div>
          {amount !== null && (
            <div className="stack tight cv-pushform">
              {amount === "pick" && (
                <Field label="New delivery date"><input className="input" type="date" value={pick} onChange={(e) => setPick(e.target.value)} /></Field>
              )}
              <Field label="Reason (kept in the history)">
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="eg Waiting on product photos" />
              </Field>
              {p.current < p.stages.length && diff !== 0 && (
                <label className="row small"><input type="checkbox" className="check" checked={shift} onChange={(e) => setShift(e.target.checked)} />
                  Also move the dates of the current and later stages by {diff} day{Math.abs(diff) === 1 ? "" : "s"}</label>
              )}
              <div className="row wrap-ok">
                <button className="btn primary" disabled={!target} onClick={() => void push()}>
                  {target ? `Move delivery to ${fmtDate(target)}` : "Pick a date"}
                </button>
                <button className="btn quiet" onClick={() => setAmount(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {p.deliveryChanges?.length > 0 && (
        <div className="stack tight">
          <span className="label">How it moved ({p.deliveryChanges.length} change{p.deliveryChanges.length === 1 ? "" : "s"})</span>
          <ol className="cv-timeline">
            {p.deliveryChanges.map((c, i) => {
              const d = c.from && c.to ? daysFromToday(c.to) - daysFromToday(c.from) : 0;
              return (
                <li key={i}>
                  <span className="num"><span className="muted">{c.from ? fmtDate(c.from) : "No date"}</span> to <b>{c.to ? fmtDate(c.to) : "No date"}</b>
                    {d !== 0 && <span className={"small " + (d > 0 ? "cv-amber" : "")}> ({d > 0 ? "+" : ""}{d}d)</span>}</span>
                  <span className="xs muted">{fmtDateTime(c.at)}{c.reason ? `: ${c.reason}` : ""}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Section>
  );
}

// ---------- proposal ----------
const PROPOSAL_STATUS: { key: NonNullable<Proposal["status"]>; label: string }[] = [
  { key: "draft", label: "Draft" }, { key: "sent", label: "Sent" }, { key: "accepted", label: "Accepted" },
  { key: "superseded", label: "Superseded" }, { key: "declined", label: "Declined" },
];
function ProposalBlock({ pv }: { pv: ProjectView }) {
  const pr = pv.p.proposal || { scope: [] };
  const openUrl = pr.url || (pr.links || []).find((l) => l.kind === "live")?.url || (pr.links || [])[0]?.url;
  const save = (patch: Partial<Proposal>, msg = "Saved") =>
    void run(() => updateProject(pv.doc.id, (p: Project) => ({ ...p, proposal: { ...p.proposal, scope: p.proposal?.scope || [], ...patch } })), msg);
  return (
    <Section title="Promised to the client" sub="The proposal they signed: price, scope and the timeline you gave them." aside={
      openUrl ? <a className="btn ghost sm" href={openUrl} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16} /> Open proposal</a> : undefined
    }>
      <div className="stack tight">
        <span className="label">The real documents (encrypted, the client sees them too)</span>
        <ProjectDocs projectId={pv.doc.id} owner />
      </div>
      <div className="cv-prop-grid">
        <Field label="Proposal link"><EditText value={pr.url} placeholder="https://docs.google.com/..." onSave={(v) => save({ url: v || null })} /></Field>
        <Field label="Status">
          <select className="select" value={pr.status || ""} onChange={(e) => save({ status: (e.target.value || null) as Proposal["status"] }, "Status saved")}>
            <option value="">Not set</option>
            {PROPOSAL_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Sent"><EditDate value={pr.sentAt} onSave={(v) => save({ sentAt: v })} /></Field>
        <Field label="Signed"><EditDate value={pr.signedAt} onSave={(v) => save({ signedAt: v })} /></Field>
        <Field label="Price"><EditNumber value={pr.price} placeholder="0" onSave={(v) => save({ price: v })} /></Field>
        <Field label="Currency">
          <select className="select" value={pr.currency || "USD"} onChange={(e) => save({ currency: e.target.value })}>
            {[...new Set([...(pr.currency ? [pr.currency] : []), ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      {pr.price ? <p className="cv-price-big num">{money(pr.price, pr.currency || "USD")}</p> : null}
      <ProposalLinks links={pr.links || []} onSave={(links) => save({ links }, "Documents saved")} />
      <Field label="Timeline you promised"><EditArea value={pr.timelineText} rows={2} placeholder="eg Directions within 5 working days, live within 4 weeks of sign off" onSave={(v) => save({ timelineText: v || null })} /></Field>
      <div className="cv-prop-grid two">
        <Field label="Payment split" hint="eg 50% before, 50% after launch"><EditArea value={pr.splitText} rows={2} onSave={(v) => save({ splitText: v || null })} /></Field>
        <Field label="After launch" hint="Aftercare you promised"><EditArea value={pr.afterLaunch} rows={2} onSave={(v) => save({ afterLaunch: v || null })} /></Field>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Scope</span>
        <ListEditor items={pr.scope || []} placeholder="Add a scope line, then Enter" addLabel="Add" onSave={(scope) => save({ scope }, "Scope saved")} />
      </div>
    </Section>
  );
}

type PLink = NonNullable<Proposal["links"]>[number];
const KIND_ORDER: Record<string, number> = { live: 0, pdf: 1, other: 2, superseded: 3 };
const KIND_LABEL: Record<string, string> = { live: "Live", pdf: "PDF", other: "Other", superseded: "Superseded" };
function ProposalLinks({ links, onSave }: { links: PLink[]; onSave: (l: PLink[]) => void }) {
  const [f, setF] = useState<{ label: string; url: string; kind: NonNullable<PLink["kind"]>; date: string }>({ label: "", url: "", kind: "live", date: todayISO() });
  const [open, setOpen] = useState(false);
  const sorted = links.map((l, i) => ({ l, i })).sort((a, b) => (KIND_ORDER[a.l.kind || "other"] - KIND_ORDER[b.l.kind || "other"]) || (b.l.date || "").localeCompare(a.l.date || ""));
  const add = () => {
    let url = f.url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    onSave([...links, { label: f.label.trim() || (f.kind === "pdf" ? "Proposal PDF" : "Proposal"), url, kind: f.kind, date: f.date || null }]);
    setF({ label: "", url: "", kind: "live", date: todayISO() });
    setOpen(false);
  };
  return (
    <div className="stack tight">
      <div className="row between wrap-ok">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Documents</span>
        {!open && <button className="btn quiet sm" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> Add document</button>}
      </div>
      {sorted.length > 0 ? (
        <ul className="cv-docs">
          {sorted.map(({ l, i }) => (
            <li key={i + l.url} className={l.kind === "superseded" ? "old" : ""}>
              <Icon name={l.kind === "pdf" ? "proposals" : "link"} size={16} />
              <a className="cv-link trunc" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
              <span className={"pill nodot " + (l.kind === "live" ? "good" : l.kind === "superseded" ? "ink" : "plain")}>{KIND_LABEL[l.kind || "other"]}</span>
              {l.date && <span className="xs muted num cv-hide-sm">{fmtDate(l.date)}</span>}
              <span className="spacer" />
              <select className="select cv-mini" aria-label={`Kind of ${l.label}`} value={l.kind || "other"}
                onChange={(e) => onSave(links.map((x, j) => (j === i ? { ...x, kind: e.target.value as PLink["kind"] } : x)))}>
                {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="btn quiet icon sm" aria-label={`Remove ${l.label}`} onClick={() => { if (window.confirm(`Remove "${l.label}" from this proposal?`)) onSave(links.filter((_, j) => j !== i)); }}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
      ) : !open && <p className="small muted">No documents yet. Add the live Google Doc and the PDF.</p>}
      {open && (
        <div className="cv-addpv">
          <Field label="Label"><input className="input" value={f.label} placeholder="eg Proposal v2" onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Link"><input className="input" type="url" inputMode="url" value={f.url} placeholder="https://..." onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
          <Field label="Kind">
            <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as NonNullable<PLink["kind"]> })}>
              {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="row">
            <button className="btn ghost" onClick={add} disabled={!f.url.trim()}>Add</button>
            <button className="btn quiet" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- archive + client visibility ----------
function Visibility({ pv }: { pv: ProjectView }) {
  return (
    <Section title="Visibility">
      <Switch checked={pv.p.clientVisible === false} label="Hidden from the client"
        hint="Use for leads and proposals. They will not see this project on their page."
        onChange={(v) => void run(async () => {
          const id = await setProjectVisible(pv.doc.id, !v);
          if (id !== pv.doc.id && pv.client) go(`#/client/${pv.client.id}/project/${id}`);
        }, v ? "Hidden and re-encrypted with your private key" : "Now on their page, encrypted with their key")} />
      <Switch checked={!!pv.p.archived} label="Archived"
        hint="Takes it off the board and the client page. Nothing is deleted."
        onChange={(v) => void run(async () => { await updateProject(pv.doc.id, { archived: v }); await updatePrivate(pv.doc.id, {}, v ? "Archived" : "Restored from archive"); }, v ? "Archived" : "Restored")} />
    </Section>
  );
}
