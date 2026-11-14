// Emails > Instantly inbox: the developer's last 20 Instantly conversations (threads a lead replied to),
// in full, from the instantly-inbox function. Click one to read the whole back and forth.
// Read only: replies still happen in Instantly. Until the robot is connected, the newest preview
// copies Claude loaded are shown instead.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc, IEmail, IMsg, IThread } from "../core/model";
import { clientViews, iemails, ithreads } from "../core/select";
import { buildMatcher } from "../core/mail";
import { refreshInstantly, sb } from "../core/vault";
import { Icon, fmtDateTime, toast, useVault } from "../ui/kit";
import { relTime } from "./Todo";

/** The text without the connector's "[truncated ...]" marker or stray HTML tags. */
export function cleanText(t: string) {
  return t.replace(/\s*…?\s*\[truncated[^\]]*\]\s*$/i, "").replace(/<[^>]*>?/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}
/** Split a reply from the older emails it quotes ("On ... wrote:" or "> " lines). */
function splitQuoted(t: string): [string, string] {
  const m = t.match(/\n\s*(On [^\n]{6,200}wrote:|-{2,} ?Original Message ?-{2,}|From: [^\n]+\nSent: )/i);
  const i = m?.index ?? t.search(/\n>/);
  return i > 0 ? [t.slice(0, i).trim(), t.slice(i).trim()] : [t.trim(), ""];
}

type Filter = "all" | "unread" | "clients";

export function InstantlyInbox() {
  const s = useVault();
  const threads = ithreads(s);
  const clients = useMemo(() => clientViews(s).filter((c) => c.client), [s]);
  const match = useMemo(() => buildMatcher(clients.map((c) => c.client!)), [clients]);
  const nameOf = useMemo(() => new Map(clients.map((c) => [c.client!.id, c.name])), [clients]);
  const clientOf = (email: string) => { const id = match(email); return id ? nameOf.get(id) || null : null; };

  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<string | null>(null);
  const readerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (sel && window.matchMedia("(max-width: 899px)").matches) readerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sel]);

  if (!threads.length) return <Previews clientOf={clientOf} />;

  const list = threads.filter((d) => filter === "unread" ? d.data.unread : filter === "clients" ? !!clientOf(d.data.lead) : true);
  const current = threads.find((d) => d.id === sel) || null;
  const counts = { all: threads.length, unread: threads.filter((d) => d.data.unread).length, clients: threads.filter((d) => clientOf(d.data.lead)).length };

  return (
    <div className="x-mail">
      <aside className="stack" aria-label="Instantly conversations">
        <div className="row between wrap-ok" style={{ gap: 8 }}>
          <div className="tabs" role="tablist" aria-label="Filter conversations">
            {([["all", "Latest 20"], ["unread", "Unread"], ["clients", "Clients"]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} role="tab" className="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>{l} <span className="num muted">{counts[k]}</span></button>
            ))}
          </div>
          <InstantlyRefresh />
        </div>
        {list.length === 0 ? <div className="empty">Nothing here.</div> : (
          <ul className="x-dlist">
            {list.map((d) => <ThreadRow key={d.id} d={d} client={clientOf(d.data.lead)} active={d.id === sel} onPick={() => setSel(d.id)} />)}
          </ul>
        )}
      </aside>
      <section aria-label="Conversation" ref={readerRef} style={{ scrollMarginTop: 76 }}>
        {current ? <Conversation t={current.data} client={clientOf(current.data.lead)} />
          : <div className="empty" style={{ padding: 36 }}>Pick a conversation to read the whole thread.</div>}
      </section>
    </div>
  );
}

function ThreadRow({ d, client, active, onPick }: { d: Doc<IThread>; client: string | null; active: boolean; onPick: () => void }) {
  const t = d.data;
  const last = t.messages[t.messages.length - 1];
  const lastIn = [...t.messages].reverse().find((m) => m.type === "received");
  return (
    <li>
      <button className={`x-ditem ie-item${t.unread ? " unread" : ""}`} aria-current={active ? "true" : undefined} onClick={onPick}>
        <span className="row between" style={{ gap: 8 }}>
          <span className="small trunc ie-from">{t.unread && <i className="ie-dot" aria-label="Unread" />}{t.leadName || lastIn?.fromName || t.lead}</span>
          <span className="xs muted num" style={{ flex: "none" }}>{relTime(t.lastAt)}</span>
        </span>
        <span className="h3 ie-subj">{t.subject}</span>
        <span className="xs muted ie-prev">{last ? `${last.type === "received" ? "" : "You: "}${splitQuoted(cleanText(last.text))[0].replace(/\s+/g, " ").slice(0, 140)}` : ""}</span>
        <span className="row wrap-ok" style={{ gap: 6 }}>
          {client && <span className="pill good">{client}</span>}
          <span className="pill plain num">{t.messages.length} email{t.messages.length === 1 ? "" : "s"}</span>
          <span className="xs muted trunc">via {t.account}</span>
        </span>
      </button>
    </li>
  );
}

function Conversation({ t, client }: { t: IThread; client: string | null }) {
  return (
    <article className="panel stack ie-reader">
      <div className="stack tight" style={{ gap: 6 }}>
        <div className="row wrap-ok" style={{ gap: 6 }}>
          {client && <span className="pill good">{client}</span>}
          {t.unread && <span className="pill amber">Unread in Instantly</span>}
        </div>
        <h2 className="h2" style={{ overflowWrap: "anywhere" }}>{t.subject}</h2>
        <span className="xs muted">{t.leadName ? `${t.leadName}, ` : ""}{t.lead} · your inbox {t.account}</span>
      </div>
      <ol className="ie-thread">{t.messages.map((m) => <Message key={m.iid} m={m} />)}</ol>
      <div className="row wrap-ok">
        <a className="btn ghost sm" href="https://app.instantly.ai/app/unibox" target="_blank" rel="noopener noreferrer"><Icon name="link" size={15} /> Reply in Instantly</a>
      </div>
    </article>
  );
}

function Message({ m }: { m: IMsg }) {
  const mine = m.type !== "received";
  const [body, quoted] = splitQuoted(cleanText(m.text));
  const [open, setOpen] = useState(false);
  return (
    <li className={`ie-msg${mine ? " mine" : ""}`}>
      <div className="ie-msg-h">
        <b>{mine ? "You" : m.fromName || m.from}</b>
        <span className="xs muted num">{m.at ? fmtDateTime(m.at) : ""}</span>
      </div>
      <p className="pre ie-msg-b">{body || "(no text)"}</p>
      {quoted && (
        <>
          <button type="button" className="btn quiet sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Hide quoted text" : "Show quoted text"}</button>
          {open && <p className="pre xs muted ie-msg-q">{quoted}</p>}
        </>
      )}
    </li>
  );
}

/** "Updated 3 min ago" plus a button that reads Instantly again now. */
function InstantlyRefresh() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    void sb.rpc("instantly_status").then(({ data }) => { if (live) setLast((data as { last_ok: string | null }[] | null)?.[0]?.last_ok ?? null); });
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  async function go() {
    setBusy(true);
    const r = await refreshInstantly();
    setBusy(false);
    if (r.lastOk) setLast(r.lastOk);
    if (!r.connected) toast("Instantly is not connected yet: add INSTANTLY_API_KEY in Supabase.", undefined, 7000);
    else if (r.error) toast(`Could not reach Instantly: ${r.error}`, undefined, 7000);
    else toast("Instantly up to date");
  }
  return (
    <span className="cal-refresh">
      <span className="xs muted">{last ? `Updated ${relTime(last)}` : "Not updated yet"}</span>
      <button type="button" className="btn quiet icon sm" onClick={() => void go()} disabled={busy} aria-label="Refresh Instantly" title="Refresh Instantly">
        <span style={{ display: "inline-flex", animation: busy ? "cv-spin 1s linear infinite" : undefined }}><Icon name="sync" size={16} /></span>
      </button>
    </span>
  );
}

/** Before the robot is connected: the newest 20 preview copies, with an honest note. */
function Previews({ clientOf }: { clientOf: (email: string) => string | null }) {
  const s = useVault();
  const list = iemails(s).filter((d) => d.data.type === "received").slice(0, 20);
  const [sel, setSel] = useState<string | null>(null);
  const cur = list.find((d) => d.id === sel)?.data || null;
  return (
    <div className="stack">
      <div className="row between wrap-ok" style={{ gap: 8 }}>
        <p className="small muted" style={{ margin: 0 }}>Showing the start of your latest replies. Full conversations appear here once Instantly is connected.</p>
        <InstantlyRefresh />
      </div>
      {list.length === 0 ? <div className="empty">No Instantly emails yet.</div> : (
        <div className="x-mail">
          <ul className="x-dlist">
            {list.map((d) => <PreviewRow key={d.id} e={d.data} client={clientOf(d.data.from)} active={d.id === sel} onPick={() => setSel(d.id)} />)}
          </ul>
          <section aria-label="Email">
            {cur ? (
              <article className="panel stack ie-reader">
                <h2 className="h2" style={{ overflowWrap: "anywhere" }}>{cur.subject}</h2>
                <span className="xs muted">{cur.fromName || cur.from} · {fmtDateTime(cur.at)}</span>
                <p className="pre ie-body">{cleanText(cur.text) || "(no text)"}</p>
              </article>
            ) : <div className="empty" style={{ padding: 36 }}>Pick an email.</div>}
          </section>
        </div>
      )}
    </div>
  );
}

function PreviewRow({ e, client, active, onPick }: { e: IEmail; client: string | null; active: boolean; onPick: () => void }) {
  return (
    <li>
      <button className={`x-ditem ie-item${e.unread ? " unread" : ""}`} aria-current={active ? "true" : undefined} onClick={onPick}>
        <span className="row between" style={{ gap: 8 }}>
          <span className="small trunc ie-from">{e.unread && <i className="ie-dot" aria-label="Unread" />}{e.fromName || e.from}</span>
          <span className="xs muted num" style={{ flex: "none" }}>{relTime(e.at)}</span>
        </span>
        <span className="h3 ie-subj">{e.subject}</span>
        <span className="xs muted ie-prev">{cleanText(e.text).replace(/\s+/g, " ").slice(0, 140)}</span>
        {client && <span className="pill good" style={{ justifySelf: "start" }}>{client}</span>}
      </button>
    </li>
  );
}
