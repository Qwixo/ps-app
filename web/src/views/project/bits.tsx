// Small shared pieces for the Clients board and the project editor.
import { useState, type ReactNode } from "react";
import { PIPELINE, type Pipeline, type Project } from "../../core/model";
import type { ProjectView } from "../../core/select";
import { clientNeeds } from "../../core/select";
import { daysFromToday, todayISO, toast } from "../../ui/kit";

export const STATUS: { key: NonNullable<Project["status"]>; label: string; cls: string }[] = [
  { key: "on_track", label: "On track", cls: "good" },
  { key: "at_risk", label: "At risk", cls: "warn" },
  { key: "action_needed", label: "Action needed", cls: "bad" },
];
export const statusOf = (s?: Project["status"]) => STATUS.find((x) => x.key === s) ?? STATUS[0];
export const pipelineLabel = (k: Pipeline) => PIPELINE.find((x) => x.key === k)?.label ?? k;
export const CURRENCIES = ["USD", "GBP", "EUR", "AUD", "CAD", "NZD", "AED"];

export function errMsg(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong. Try again.";
}

/** Runs an action, shows a short toast when it worked and the error when it did not. */
export async function run(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
  try {
    await fn();
    if (ok) toast(ok, undefined, 2200);
    return true;
  } catch (e) {
    toast(errMsg(e), undefined, 7000);
    return false;
  }
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "client";

// ---------- inputs that save themselves on blur (uncontrolled, re-keyed on outside change) ----------
type Base = { label?: string; placeholder?: string; className?: string; id?: string; disabled?: boolean };

export function EditText({ value, onSave, ...b }: Base & { value?: string | null; onSave: (v: string) => void }) {
  const v = value ?? "";
  return (
    <input key={v} id={b.id} className={b.className ?? "input"} defaultValue={v} placeholder={b.placeholder} aria-label={b.label} disabled={b.disabled}
      onBlur={(e) => { const n = e.currentTarget.value.trim(); if (n !== v) onSave(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

export function EditArea({ value, onSave, rows = 3, ...b }: Base & { value?: string | null; onSave: (v: string) => void; rows?: number }) {
  const v = value ?? "";
  return (
    <textarea key={v} id={b.id} className={b.className ?? "textarea"} defaultValue={v} placeholder={b.placeholder} aria-label={b.label} rows={rows}
      style={{ minHeight: rows * 26 + 22 }} disabled={b.disabled}
      onBlur={(e) => { const n = e.currentTarget.value.trim(); if (n !== v) onSave(n); }} />
  );
}

export function EditDate({ value, onSave, ...b }: Base & { value?: string | null; onSave: (v: string | null) => void }) {
  const v = value ?? "";
  return (
    <input key={v} id={b.id} type="date" className={b.className ?? "input"} defaultValue={v} aria-label={b.label} disabled={b.disabled}
      onChange={(e) => { const n = e.currentTarget.value; if (n !== v && (n === "" || /^\d{4}-\d{2}-\d{2}$/.test(n))) onSave(n || null); }} />
  );
}

export function EditNumber({ value, onSave, ...b }: Base & { value?: number | null; onSave: (v: number | null) => void }) {
  const v = value == null ? "" : String(value);
  return (
    <input key={v} id={b.id} type="number" inputMode="decimal" min={0} step="any" className={b.className ?? "input"} defaultValue={v}
      placeholder={b.placeholder} aria-label={b.label} disabled={b.disabled}
      onBlur={(e) => { const raw = e.currentTarget.value.trim(); if (raw === v) return; const n = raw === "" ? null : Number(raw); if (n === null || !isNaN(n)) onSave(n); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}

/** Editable list of short lines (scope bullets, live links). */
export function ListEditor({ items, onSave, placeholder, addLabel = "Add" }: { items: string[]; onSave: (next: string[]) => void; placeholder?: string; addLabel?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { const t = draft.trim(); if (!t) return; onSave([...items, t]); setDraft(""); };
  return (
    <div className="stack tight">
      {items.length > 0 && (
        <ul className="cv-lines">
          {items.map((it, i) => (
            <li key={i + ":" + it}>
              <span className="cv-bullet" aria-hidden="true" />
              <EditText value={it} label={`Line ${i + 1}`} className="input cv-bare"
                onSave={(n) => onSave(n ? items.map((x, j) => (j === i ? n : x)) : items.filter((_, j) => j !== i))} />
              <button className="btn quiet icon sm" aria-label="Move up" disabled={i === 0}
                onClick={() => { const a = [...items]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; onSave(a); }}>
                <UpIcon />
              </button>
              <button className="btn quiet icon sm" aria-label={`Remove ${it}`} onClick={() => onSave(items.filter((_, j) => j !== i))}>
                <XIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <input className="input" value={draft} placeholder={placeholder} aria-label={placeholder || addLabel}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button className="btn ghost" onClick={add} disabled={!draft.trim()}>{addLabel}</button>
      </div>
    </div>
  );
}
const UpIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
const XIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>;

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="cv-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="cv-track" aria-hidden="true"><i /></span>
      <span className="stack" style={{ gap: 0 }}>
        <span className="h3">{label}</span>
        {hint && <span className="small muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Segmented control built from real radio buttons. */
export function Segmented<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="cv-seg" role="radiogroup">
      {options.map((o) => (
        <label key={o.key} className={value === o.key ? "on" : ""}>
          <input type="radio" name={name} value={o.key} checked={value === o.key} onChange={() => onChange(o.key)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function Section({ title, aside, children, sub }: { title: string; aside?: ReactNode; children: ReactNode; sub?: string }) {
  return (
    <section className="panel stack">
      <div className="row between wrap-ok">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="h2">{title}</h2>
          {sub && <p className="small muted">{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const PrivatePill = () => <span className="pill ink cv-private"><LockMini /> Only you see this</span>;
export const ClientPill = () => <span className="pill plain">The client sees this</span>;
const LockMini = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;

// ---------- what each project needs (used by the board filters and badges) ----------
export function flags(pv: ProjectView) {
  const t = todayISO();
  const pr = pv.priv?.data;
  const done = pv.p.current >= pv.p.stages.length || pv.p.pipeline === "finished";
  const st = pv.p.stages[pv.p.current];
  const approvedNow = !!st && pv.approvals.some((a) => a.data.stageKey === st.key);
  const needs = clientNeeds(pv);
  const waitingClient = pr?.waitingOn === "client" || (!!needs.waitingGate && pr?.waitingOn !== "me");
  const waitingMe = pr?.waitingOn === "me" || (!!pr?.nextStep && pr?.waitingOn !== "client") || approvedNow;
  const nextLate = !!pr?.nextDue && pr.nextDue < t;
  const deliveryLate = !done && !!pv.p.promisedDelivery && pv.p.promisedDelivery < t && !["lead", "proposal_sent", "finished"].includes(pv.p.pipeline);
  const payLate = pv.p.payments.some((p) => p.status !== "paid" && !!p.due && p.due < t);
  return { waitingClient, waitingMe, approvedNow, nextLate, deliveryLate, payLate, overdue: nextLate || deliveryLate || payLate, done };
}

export function daysLabel(iso?: string | null) {
  if (!iso) return { big: "No date", small: "set a promised date", late: false };
  const n = daysFromToday(iso);
  if (n === 0) return { big: "Today", small: "delivery is due", late: false };
  if (n > 0) return { big: `${n} day${n === 1 ? "" : "s"}`, small: "until delivery", late: false };
  return { big: `${-n} day${n === -1 ? "" : "s"}`, small: "past the promised date", late: true };
}
