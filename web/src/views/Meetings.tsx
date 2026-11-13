import { useMemo, useState, type FormEvent } from "react";
import "./extra.css";
import type { Doc, Meeting } from "../core/model";
import { clientViews, meetings } from "../core/select";
import { actionItemToTodo, addMeeting } from "../core/actions";
import { put } from "../core/vault";
import { CalendarCard } from "./CalendarCard";
import { Field, Icon, Modal, copyText, fmtDate, fmtDateTime, toast, todayISO, useVault } from "../ui/kit";

const WEBHOOK = "https://mxusokxekkecebwqgeru.supabase.co/functions/v1/fireflies-inbox";
type Filter = "todo" | "all" | "unlinked";

function when(d: string) {
  return d.length > 10 ? fmtDateTime(d) : fmtDate(d);
}
const leftOf = (m: Meeting) => m.actionItems.filter((a) => !(m.addedToTodo || []).includes(a));

export function MeetingsView() {
  const s = useVault();
  const list = meetings(s);
  const clients = useMemo(() => clientViews(s).filter((c) => c.client).map((c) => ({ id: c.client!.id, name: c.name })), [s]);
  const [filter, setFilter] = useState<Filter>("all");
  const [paste, setPaste] = useState(false);
  const [setup, setSetup] = useState(false);

  const shown = list.filter((m) => filter === "todo" ? leftOf(m.data).length > 0 : filter === "unlinked" ? !m.data.clientId : true);
  const counts = { todo: list.filter((m) => leftOf(m.data).length > 0).length, all: list.length, unlinked: list.filter((m) => !m.data.clientId).length };
  const hasFireflies = list.some((m) => m.data.source === "fireflies");

  return (
    <div className="stack loose">
      <div className="row top between wrap-ok">
        <div className="x-head">
          <span className="label">Meetings</span>
          <h1 className="h1">Meetings</h1>
          <p>Your calendar, and the summary and action items from every recorded call. Turn any action item into a to-do in one tap.</p>
        </div>
        <div className="row wrap-ok">
          <button className="btn ghost" onClick={() => setSetup((v) => !v)} aria-expanded={setup}><Icon name="bolt" /> Fireflies setup</button>
          <button className="btn primary" onClick={() => setPaste(true)}><Icon name="plus" /> Paste a call summary</button>
        </div>
      </div>

      <CalendarCard />

      <h2 className="h2" style={{ marginBottom: -6 }}>Call summaries</h2>

      {(setup || !hasFireflies) && <SetupCard onClose={hasFireflies ? () => setSetup(false) : undefined} />}

      <div className="tabs" role="tablist" aria-label="Filter meetings" style={{ justifySelf: "start" }}>
        {([["all", "All"], ["todo", "Has open items"], ["unlinked", "Not linked"]] as [Filter, string][]).map(([k, l]) => (
          <button key={k} role="tab" className="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>{l} <span className="num muted">{counts[k]}</span></button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty">{list.length === 0 ? "No meetings yet. Connect Fireflies or paste a call summary." : "Nothing here with this filter."}</div>
      ) : (
        <div className="stack">{shown.map((m) => <MeetingCard key={m.id} m={m} clients={clients} />)}</div>
      )}

      {paste && <PasteModal clients={clients} onClose={() => setPaste(false)} />}
    </div>
  );
}

function MeetingCard({ m, clients }: { m: Doc<Meeting>; clients: { id: string; name: string }[] }) {
  const d = m.data;
  const left = leftOf(d);
  const [open, setOpen] = useState(false);

  async function link(clientId: string) {
    try {
      await put<Meeting>("meeting", { ...d, clientId: clientId || null }, { id: m.id, ws: null });
      toast(clientId ? "Linked to the client" : "Unlinked");
    } catch (e) { toast(String((e as Error).message || e)); }
  }

  return (
    <article className="panel stack" aria-labelledby={`m-${m.id}`}>
      <div className="row top between wrap-ok">
        <div className="stack tight" style={{ gap: 4, minWidth: 0, flex: 1 }}>
          <div className="row wrap-ok" style={{ gap: 6 }}>
            <span className={`pill ${d.source === "fireflies" ? "plain" : "ink"}`}>{d.source === "fireflies" ? "Fireflies" : "Added by hand"}</span>
            {left.length > 0 ? <span className="pill warn">{left.length} open item{left.length > 1 ? "s" : ""}</span>
              : d.actionItems.length > 0 ? <span className="pill good">All items added</span> : null}
          </div>
          <h2 className="h2" id={`m-${m.id}`} style={{ overflowWrap: "anywhere" }}>{d.title}</h2>
          <span className="small muted num">{when(d.date)}{d.participants?.length ? ` · ${d.participants.length} people` : ""}</span>
        </div>
        <div className="row wrap-ok">
          <label className="field" style={{ minWidth: 190 }}>
            <span className="xs">Client</span>
            <select className="select" value={d.clientId || ""} onChange={(e) => void link(e.target.value)} aria-label={`Client for ${d.title}`}>
              <option value="">Not linked</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {d.url && (
            <a className="btn ghost sm" href={d.url} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "end" }}>
              <Icon name="link" size={15} /> Open in Fireflies
            </a>
          )}
        </div>
      </div>

      {d.overview && <p className="pre" style={{ color: "var(--ink-2)" }}>{d.overview}</p>}

      {d.bullets && (
        <div>
          <button className="btn quiet sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Hide notes" : "Show detailed notes"}</button>
          {open && <p className="pre small" style={{ color: "var(--ink-2)", marginTop: 8 }}>{d.bullets}</p>}
        </div>
      )}

      {d.actionItems.length > 0 && (
        <div className="stack tight">
          <span className="label">Action items</span>
          <ul className="x-items">
            {d.actionItems.map((a, i) => <ActionItem key={i + a} meetingId={m.id} text={a} added={(d.addedToTodo || []).includes(a)} />)}
          </ul>
        </div>
      )}
    </article>
  );
}

function ActionItem({ meetingId, text, added }: { meetingId: string; text: string; added: boolean }) {
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try { await actionItemToTodo(meetingId, text, due || null); toast("Added to your to-do list"); }
    catch (e) { toast(String((e as Error).message || e)); }
    finally { setBusy(false); }
  }
  return (
    <li className={added ? "added" : undefined}>
      <span style={{ overflowWrap: "anywhere", fontWeight: 550 }}>{text}</span>
      {added ? (
        <span className="small row" style={{ gap: 6, color: "var(--good)", fontWeight: 650 }}><Icon name="check" size={15} /> On your to-do list</span>
      ) : (
        <div className="x-item-row">
          <input className="input" type="date" value={due} min={todayISO()} onChange={(e) => setDue(e.target.value)} aria-label={`Due date for: ${text}`} />
          <button className="btn ghost sm" onClick={() => void add()} disabled={busy}><Icon name="plus" size={15} /> Add to to-do</button>
        </div>
      )}
    </li>
  );
}

function SetupCard({ onClose }: { onClose?: () => void }) {
  return (
    <section className="panel stack" aria-labelledby="ff-setup">
      <div className="row between">
        <div className="row"><span className="pill plain">One time</span><h2 className="h2" id="ff-setup">Connect Fireflies automatically</h2></div>
        {onClose && <button className="btn quiet icon" onClick={onClose} aria-label="Hide setup"><Icon name="x" /></button>}
      </div>
      <p className="muted">After every call, Fireflies sends the summary here on its own. You never copy and paste.</p>
      <ol className="x-steps">
        <li>In Fireflies, open <b>Settings</b>, then <b>Developer settings</b>.</li>
        <li>
          Set the webhook URL to{" "}
          <span className="x-code">{WEBHOOK}</span>{" "}
          <button className="btn quiet sm" onClick={() => void copyText(WEBHOOK)}>Copy</button>
        </li>
        <li>Set a <b>webhook secret</b> there too (a long random phrase). Keep it handy for the next step.</li>
        <li>In Supabase, open <b>Edge Functions</b>, then <b>Secrets</b>, and add <span className="x-code">FIREFLIES_API_KEY</span> (your Fireflies API key) and <span className="x-code">FIREFLIES_WEBHOOK_SECRET</span> (the same secret as step 3).</li>
      </ol>
      <div className="banner pinkish"><Icon name="shield" /> Summaries arrive sealed so only you can read them. They open in your browser, appear here, and their action items show on Today.</div>
    </section>
  );
}

function PasteModal({ clients, onClose }: { clients: { id: string; name: string }[]; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayISO());
  const [clientId, setClientId] = useState("");
  const [overview, setOverview] = useState("");
  const [items, setItems] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await addMeeting({
        title: title.trim(), date, clientId: clientId || null, url: null,
        overview: overview.trim() || null,
        actionItems: items.split(/\n+/).map((x) => x.replace(/^[\s*•-]+/, "").trim()).filter(Boolean),
        source: "manual",
      });
      toast("Call summary saved");
      onClose();
    } catch (err) { toast(String((err as Error).message || err)); setBusy(false); }
  }

  return (
    <Modal title="Paste a call summary" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kickoff call" required autoFocus /></Field>
        <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Client">
            <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Not linked</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Overview"><textarea className="textarea" value={overview} onChange={(e) => setOverview(e.target.value)} placeholder="What the call was about and what was decided" /></Field>
        <Field label="Action items" hint="One per line. Each one can become a to-do.">
          <textarea className="textarea" value={items} onChange={(e) => setItems(e.target.value)} placeholder={"Send the kickoff recap\nAsk for Shopify staff access"} />
        </Field>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !title.trim()}>Save summary</button>
        </div>
      </form>
    </Modal>
  );
}
