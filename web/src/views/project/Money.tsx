// Money tab: payments, mark paid, next invoice date, totals.
import { useEffect, useRef, useState } from "react";
import { uid, type Payment } from "../../core/model";
import type { ProjectView } from "../../core/select";
import { markPaid, setPayments, updatePrivate } from "../../core/actions";
import { Field, Icon, fmtDate, money, relDate, sumMoney, todayISO } from "../../ui/kit";
import { CURRENCIES, EditDate, PrivatePill, Section, run } from "./bits";

export function MoneyTab({ pv }: { pv: ProjectView }) {
  const p = pv.p;
  const cur = p.proposal.currency || p.payments[0]?.currency || "USD";
  const saved = JSON.stringify(p.payments);
  const [rows, setRows] = useState<Payment[]>(() => structuredClone(p.payments));
  const prev = useRef(saved);
  useEffect(() => {
    if (prev.current === saved) return;
    setRows((r) => (JSON.stringify(r) === prev.current ? JSON.parse(saved) : r));
    prev.current = saved;
  }, [saved]);
  const dirty = JSON.stringify(rows) !== saved;
  const t = todayISO();

  const paid = p.payments.filter((x) => x.status === "paid");
  const open = p.payments.filter((x) => x.status !== "paid");
  const owedLate = open.filter((x) => x.status === "owed" || (!!x.due && x.due < t));
  const paidSum = paid.reduce((a, x) => a + (x.currency === cur ? x.amount : 0), 0);
  const scheduled = p.payments.reduce((a, x) => a + (x.currency === cur ? x.amount : 0), 0);
  const price = p.proposal.price || 0;
  const unscheduled = price > scheduled ? price - scheduled : 0;
  const pct = price ? Math.min(100, Math.round((paidSum / price) * 100)) : scheduled ? Math.round((paidSum / scheduled) * 100) : 0;
  const nextInv = pv.priv?.data.nextInvoiceDate;

  const edit = (id: string, patch: Partial<Payment>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addRow = () => setRows((r) => [...r, { id: uid(), label: r.length ? `Payment ${r.length + 1}` : "Deposit", amount: r.length ? 0 : Math.round(price / 2) || 0, currency: cur, due: null, status: "upcoming", paidAt: null }]);
  const save = () => void run(async () => {
    await setPayments(pv.doc.id, rows.map((x) => ({ ...x, label: x.label.trim() || "Payment", amount: Number(x.amount) || 0, paidAt: x.status === "paid" ? x.paidAt || t : null })));
    await updatePrivate(pv.doc.id, {}, "Payments updated");
  }, "Payments saved");

  return (
    <div className="stack loose">
      <div className="stats cv-money-stats">
        <div className="stat"><span className="label">Price</span><b className="num">{price ? money(price, cur) : "Not set"}</b></div>
        <div className="stat"><span className="label">Paid</span><b className="num cv-good">{sumMoney(paid)}</b></div>
        <div className={"stat" + (owedLate.length ? " alert" : "")}><span className="label">Still to come</span><b className="num">{sumMoney(open)}</b>
          {owedLate.length > 0 && <span className="xs err">{owedLate.length} owed now</span>}</div>
        <div className="stat"><span className="label">Next invoice</span><b className="num cv-statdate">{nextInv ? fmtDate(nextInv) : "Not set"}</b>
          {nextInv && <span className={"xs " + (nextInv < t ? "err" : "muted")}>{relDate(nextInv)}</span>}</div>
      </div>
      {(price > 0 || scheduled > 0) && (
        <div className="stack tight">
          <div className="row between small"><span>{pct}% paid</span>{unscheduled > 0 && <span className="cv-amber">{money(unscheduled, cur)} of the price is not in a payment yet</span>}</div>
          <div className="progress"><i style={{ width: pct + "%" }} /></div>
        </div>
      )}

      <Section title="Payments" aside={<span className="small muted">The client sees these on their page</span>}>
        {rows.length === 0 && <p className="small muted">No payments yet. Add the deposit and the balance from the proposal.</p>}
        <div className="cv-pays">
          {rows.length > 0 && (
            <div className="cv-pay cv-payhead" aria-hidden="true">
              <span>Label</span><span>Amount</span><span>Currency</span><span>Due</span><span>Status</span><span>Paid on</span><span />
            </div>
          )}
          {rows.map((x) => {
            const savedRow = p.payments.find((y) => y.id === x.id);
            const late = x.status !== "paid" && !!x.due && x.due < t;
            return (
              <div key={x.id} className={"cv-pay" + (x.status === "paid" ? " paid" : late || x.status === "owed" ? " owed" : "")}>
                <label className="cv-pf"><span className="cv-mlabel">Label</span>
                  <input className="input" aria-label="Label" value={x.label} onChange={(e) => edit(x.id, { label: e.target.value })} />
                </label>
                <label className="cv-pf"><span className="cv-mlabel">Amount</span>
                  <input className="input num" aria-label="Amount" type="number" inputMode="decimal" min={0} step="any" value={String(x.amount)} onChange={(e) => edit(x.id, { amount: e.target.value === "" ? 0 : Number(e.target.value) })} />
                </label>
                <label className="cv-pf"><span className="cv-mlabel">Currency</span>
                  <select className="select" aria-label="Currency" value={x.currency} onChange={(e) => edit(x.id, { currency: e.target.value })}>
                    {[...new Set([x.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="cv-pf"><span className="cv-mlabel">Due</span>
                  <input className="input" aria-label="Due date" type="date" value={x.due || ""} onChange={(e) => edit(x.id, { due: e.target.value || null })} />
                </label>
                <label className="cv-pf"><span className="cv-mlabel">Status</span>
                  <select className="select" aria-label="Status" value={x.status} onChange={(e) => { const s = e.target.value as Payment["status"]; edit(x.id, { status: s, paidAt: s === "paid" ? x.paidAt || t : null }); }}>
                    <option value="upcoming">Upcoming</option><option value="owed">Owed (invoiced)</option><option value="paid">Paid</option>
                  </select>
                </label>
                <label className="cv-pf"><span className="cv-mlabel">Paid on</span>
                  <input className="input" aria-label="Paid on" type="date" value={x.paidAt || ""} disabled={x.status !== "paid"} onChange={(e) => edit(x.id, { paidAt: e.target.value || null })} />
                </label>
                <div className="row cv-payact">
                  {savedRow && savedRow.status !== "paid" && !dirty && (
                    <button className="btn ghost sm" onClick={() => void run(() => markPaid(pv.doc.id, x.id), `${x.label} marked paid`)}><Icon name="check" size={16} /> Mark paid</button>
                  )}
                  <button className="btn quiet icon sm" aria-label={`Delete ${x.label}`} onClick={() => setRows((r) => r.filter((y) => y.id !== x.id))}><Icon name="trash" size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="row wrap-ok">
          <button className="btn ghost" onClick={addRow}><Icon name="plus" size={16} /> Add payment</button>
          <span className="spacer" />
          {dirty && <button className="btn quiet" onClick={() => setRows(JSON.parse(saved))}>Discard</button>}
          <button className="btn primary" disabled={!dirty} onClick={save}><Icon name="check" size={16} /> Save payments</button>
        </div>
      </Section>

      <Section title="When to invoice next" aside={<PrivatePill />}>
        <div className="cv-next-grid">
          <Field label="Next invoice date" hint="Shows on your Today page a week before">
            <EditDate value={nextInv} onSave={(v) => void run(() => updatePrivate(pv.doc.id, { nextInvoiceDate: v }, v ? `Next invoice set for ${fmtDate(v)}` : "Next invoice date cleared"), "Invoice date saved")} />
          </Field>
          {open.length > 0 && (
            <div className="stack tight">
              <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Next payment in the plan</span>
              {(() => { const n = [...open].sort((a, b) => (a.due || "9").localeCompare(b.due || "9"))[0]; return (
                <span className="small">{n.label}: <b className="num">{money(n.amount, n.currency)}</b>{n.due ? ` on ${fmtDate(n.due)}` : ""}
                  {n.due && n.due !== nextInv && <button className="btn quiet sm" onClick={() => void run(() => updatePrivate(pv.doc.id, { nextInvoiceDate: n.due }, `Next invoice set for ${fmtDate(n.due)}`), "Invoice date saved")}>Use this date</button>}
                </span>
              ); })()}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
