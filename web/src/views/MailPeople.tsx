// Settings > Gmail replies: who may pop up (the developer, 4 Nov 2026). Client emails always do; "Always notify me" adds
// anyone else (an address or a whole domain), "Muted" silences a sender even if linked to a client, and "Who emails
// me" lists everyone who wrote in the last 30 days across all his Gmail accounts, with whether they would pop up
// and why. Only sender, account, time and subject are shown, never a body. Read only towards Gmail.
// Drawn on the website (Settings, where the vault is open) and in the Tab list's Mac settings window (overlay: no
// keys there, so every button goes to the main page as a "looks" patch, src/ps.ts).
import { useMemo, useState } from "react";
import type { ClientRec, Doc } from "../core/model";
import { accountLabel, buildMatcher } from "../core/mail";
import { cleanRuleEntry, ownAccounts, ruleList, searchRows, senderRows, type RuleList, type SenderRow, type Why } from "../core/mailrules";
import { settingsData } from "../core/select";
import { addMatchAddr, setMailRule } from "../core/actions";
import { psPost } from "../ps";
import { toast, useVault } from "../ui/kit";
import { relTime } from "./Todo";
import "./mailpeople.css";

const WHY: Record<Why, { text: string; tone: string }> = {
  client: { text: "Pops up: client", tone: "good" },
  notify: { text: "Pops up: on your list", tone: "good" },
  muted: { text: "Muted", tone: "bad" },
  own: { text: "Your own account", tone: "ink" },
  none: { text: "Not on a list", tone: "ink" },
};

export function MailPeople({ overlay }: { overlay?: boolean }) {
  const s = useVault();
  const [q, setQ] = useState("");
  const [add, setAdd] = useState("");
  const rules = settingsData(s).mailRules;
  const clients = useMemo(() => [...s.docs.values()].filter((d): d is Doc<ClientRec> => d.kind === "client"), [s]);
  const active = clients.filter((c) => !c.data.archived).sort((a, b) => a.data.name.localeCompare(b.data.name));
  const name = new Map(clients.map((c) => [c.id, c.data.name]));
  const rows = useMemo(() => senderRows(s.docs.values(), buildMatcher(clients), rules, ownAccounts(s.docs.values())), [s, clients, rules]);
  const shown = searchRows(rows, q).slice(0, 80);
  const notify = ruleList(rules, "notify"), mute = ruleList(rules, "mute");

  const rule = (entry: string, list: RuleList, done: string) => {
    if (overlay) { psPost({ type: "looks", patch: { mailRuleOp: { entry, list } } }); toast(done); return; }
    void setMailRule(entry, list).then(() => toast(done)).catch((e) => toast(String(e.message || e)));
  };
  const link = (email: string, clientId: string) => {
    const done = `${email} linked to ${name.get(clientId) || "the client"}`;
    if (overlay) { psPost({ type: "looks", patch: { mailRuleOp: { entry: email, clientId } } }); toast(done); return; }
    void addMatchAddr(clientId, email).then(() => toast(done)).catch((e) => toast(String(e.message || e)));
  };
  const typed = add.trim() ? cleanRuleEntry(add) : null;
  const addTo = (list: "notify" | "mute") => {
    if (!typed || "error" in typed) return;
    rule(typed.v, list, list === "notify" ? `${typed.v} will pop up` : `${typed.v} is muted`);
    setAdd("");
  };

  return (
    <div className="stack mp">
      <div className="stack tight">
        <h3 className="h3">Who can pop up</h3>
        <p className="small muted">Client emails always pop up on your Mac and phone. Add anyone else below, an address or a whole domain like @company.com, and their emails pop up too. Muted senders never pop up, even a client.</p>
      </div>
      <div className="mp-add">
        <input className="input" value={add} placeholder="name@company.com or @company.com" spellCheck={false} aria-label="Address or domain"
          onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addTo("notify"); }} />
        <button type="button" className="btn primary sm" disabled={!typed || "error" in typed} onClick={() => addTo("notify")}>Notify me</button>
        <button type="button" className="btn quiet sm" disabled={!typed || "error" in typed} onClick={() => addTo("mute")}>Mute</button>
      </div>
      {typed && "error" in typed && <span className="xs err">{typed.error}</span>}

      <div className="mp-lists">
        <div className="stack tight">
          <b className="small">Always notify me</b>
          {notify.length ? (
            <ul className="mp-chips">
              {notify.map((e) => (
                <li key={e}><span className="trunc">{e.includes("@") ? e : `@${e}`}</span>
                  <button type="button" className="btn quiet sm" onClick={() => rule(e, "mute", `${e} is muted`)}>Mute</button>
                  <button type="button" className="btn quiet sm" onClick={() => rule(e, "off", `${e} taken off`)}>Remove</button>
                </li>
              ))}
            </ul>
          ) : <span className="xs muted">Nobody yet. Only client emails pop up.</span>}
        </div>
        <div className="stack tight">
          <b className="small">Muted</b>
          {mute.length ? (
            <ul className="mp-chips">
              {mute.map((e) => (
                <li key={e}><span className="trunc">{e.includes("@") ? e : `@${e}`}</span>
                  <button type="button" className="btn quiet sm" onClick={() => rule(e, "notify", `${e} will pop up`)}>Notify me</button>
                  <button type="button" className="btn quiet sm" onClick={() => rule(e, "off", `${e} unmuted`)}>Unmute</button>
                </li>
              ))}
            </ul>
          ) : <span className="xs muted">Nobody muted.</span>}
        </div>
      </div>

      <div className="stack tight">
        <div className="mp-head">
          <h3 className="h3">Who emails me</h3>
          <span className="xs muted">{rows.length} {rows.length === 1 ? "sender" : "senders"} in the last 30 days</span>
        </div>
        <input className="input" type="search" value={q} placeholder="Search names, addresses, subjects" aria-label="Search senders" onChange={(e) => setQ(e.target.value)} />
        {shown.length ? (
          <ul className="mp-rows">
            {shown.map((r) => <SenderLine key={r.email} r={r} clientName={r.clientId ? name.get(r.clientId) : undefined} clients={active} rule={rule} link={link} />)}
          </ul>
        ) : <p className="small muted">{rows.length ? "Nobody matches that search." : "Nobody yet. New emails show here as they come in (only the sender, account, time and subject)."}</p>}
      </div>
    </div>
  );
}

function SenderLine({ r, clientName, clients, rule, link }: {
  r: SenderRow; clientName?: string; clients: Doc<ClientRec>[];
  rule: (entry: string, list: RuleList, done: string) => void; link: (email: string, clientId: string) => void;
}) {
  const w = WHY[r.verdict.why];
  const own = r.verdict.why === "own";
  return (
    <li className="mp-row">
      <span className="mp-av" aria-hidden="true">{(r.name || r.email).charAt(0).toUpperCase()}</span>
      <div className="mp-who">
        <b className="trunc">{r.name ? `${r.name} <${r.email}>` : r.email}</b>
        <span className="xs muted trunc">{r.subject || "(no subject)"}</span>
        <span className="xs muted trunc">{relTime(r.last)} · to {accountLabel(r.account)}{r.accounts > 1 ? ` +${r.accounts - 1}` : ""} · {r.count} in 30 days</span>
      </div>
      <span className={`pill ${w.tone} mp-why`}>{r.verdict.why === "client" && clientName ? `Pops up: ${clientName}` : w.text}</span>
      {!own && (
        <div className="mp-acts">
          {r.verdict.why !== "notify" && r.verdict.why !== "client" && <button type="button" className="btn ghost sm" onClick={() => rule(r.email, "notify", `${r.email} will pop up`)}>Notify me</button>}
          {!r.clientId && (
            <select className="select" value="" aria-label={`Link ${r.email} to a client`} onChange={(e) => e.target.value && link(r.email, e.target.value)}>
              <option value="">Link to client...</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.data.name}</option>)}
            </select>
          )}
          {r.verdict.why === "muted"
            ? <button type="button" className="btn quiet sm" onClick={() => rule(r.email, "off", `${r.email} unmuted`)}>Unmute</button>
            : <button type="button" className="btn quiet sm" onClick={() => rule(r.email, "mute", `${r.email} is muted`)}>Mute</button>}
        </div>
      )}
    </li>
  );
}
