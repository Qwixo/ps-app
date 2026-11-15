// Rule Zero: nothing is ever sent from here. The developer approves the exact words, then copies
// them or opens his own mail app. Any edit after approval clears the approval.
import { useEffect, useMemo, useRef, useState } from "react";
import "./extra.css";
import type { ClientRec, Doc, Draft } from "../core/model";
import { clientViews, drafts, settingsData } from "../core/select";
import { isRedAccount } from "../core/account";
import { mailOnSnap } from "../core/mailsnap";
import { approveDraft, markDraftSent, saveDraft } from "../core/actions";
import { doc, remove } from "../core/vault";
import { TEMPLATES, buildEmail, hasLongDash, templateLabel, type TemplateKey } from "../core/templates";
import { InstantlyInbox } from "./InstantlyInbox";
import { Field, Icon, Modal, confirmAsk, copyText, fmtDateTime, toast, useVault } from "../ui/kit";

type Filter = "all" | "draft" | "approved" | "sent";
const PILL: Record<Draft["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "warn" },
  approved: { label: "Approved", cls: "good" },
  sent: { label: "Sent", cls: "ink" },
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// approvedText = "To: x\nSubject: y\n\nbody" (older drafts: "subject\n\nbody").
function splitApproved(d: Draft) {
  const t = d.approvedText ?? `Subject: ${d.subject}\n\n${d.body}`;
  const i = t.indexOf("\n\n");
  const head = i < 0 ? t : t.slice(0, i);
  const body = i < 0 ? "" : t.slice(i + 2);
  const subj = head.split("\n").find((l) => l.startsWith("Subject: "));
  return { subject: subj ? subj.slice(9) : head, body };
}
function mailto(to: string | null | undefined, subject: string, body: string) {
  const addr = to && EMAIL_RE.test(to.trim()) ? to.trim() : "";
  return `mailto:${addr}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

type Pane = "inbox" | "drafts";
const PANE_KEY = "cv-emails-pane";

export function EmailsView() {
  // The Instantly inbox comes with Client emails (core/mailswitch.ts); everyone else only has drafts.
  const red = mailOnSnap(useVault());
  const [saved, setPane] = useState<Pane>(() => { try { return (localStorage.getItem(PANE_KEY) as Pane) || "inbox"; } catch { return "inbox"; } });
  const pane: Pane = red ? saved : "drafts";
  const pick = (p: Pane) => { setPane(p); try { localStorage.setItem(PANE_KEY, p); } catch { /* private window */ } };
  return (
    <div className="stack loose">
      <div className="x-head">
        <span className="label">Emails</span>
        <h1 className="h1">Emails</h1>
      </div>
      <div className="tabs" role="tablist" aria-label="Emails" style={{ justifySelf: "start" }}>
        {red && <button role="tab" className="tab" aria-selected={pane === "inbox"} onClick={() => pick("inbox")}>Instantly inbox</button>}
        <button role="tab" className="tab" aria-selected={pane === "drafts"} onClick={() => pick("drafts")}>Drafts for approval</button>
      </div>
      {pane === "inbox" ? <InstantlyInbox /> : <DraftsView />}
    </div>
  );
}

function DraftsView() {
  const s = useVault();
  const all = useMemo(() => [...drafts(s)].sort((a, b) => (b.updatedAt || "~").localeCompare(a.updatedAt || "~")), [s]);
  const clients = useMemo(() => clientViews(s).filter((c) => c.client), [s]);
  const nameOf = (id: string) => clients.find((c) => c.client!.id === id)?.name || "Unknown client";
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const shown = all.filter((d) => filter === "all" || d.data.status === filter);
  const current = all.find((d) => d.id === sel) || null;
  const counts = { all: all.length, draft: all.filter((d) => d.data.status === "draft").length, approved: all.filter((d) => d.data.status === "approved").length, sent: all.filter((d) => d.data.status === "sent").length };

  useEffect(() => { if (sel && !all.some((d) => d.id === sel)) setSel(null); }, [all, sel]);
  // On phones the editor sits under the list: bring it into view when a draft is picked.
  const editorRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (sel && window.matchMedia("(max-width: 899px)").matches) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sel]);

  return (
    <div className="stack loose">
      <div className="row top between wrap-ok">
        <h2 className="h2">Drafts for your approval</h2>
        <button className="btn primary" onClick={() => setCreating(true)} disabled={!clients.length}><Icon name="plus" /> New draft</button>
      </div>

      <div className="x-rule" role="note">
        <span className="x-ico"><Icon name="shield" size={20} /></span>
        <div className="stack tight" style={{ gap: 4 }}>
          <b>Nothing is ever sent from here. You approve the exact words, then send it yourself.</b>
          <span className="small" style={{ color: "var(--ink-2)" }}>Change a single letter after approving and the approval is cleared, so what you send is always what you approved.</span>
        </div>
      </div>

      <div className="x-mail">
        <aside className="stack" aria-label="Drafts">
          <div className="tabs" role="tablist" aria-label="Filter drafts">
            {([["all", "All"], ["draft", "Draft"], ["approved", "Approved"], ["sent", "Sent"]] as [Filter, string][]).map(([k, l]) => (
              <button key={k} role="tab" className="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>{l} <span className="num muted">{counts[k]}</span></button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="empty">{all.length ? "Nothing with this status." : clients.length ? "No drafts yet. Start one from a template." : "Add a client first, then draft emails for them here."}</div>
          ) : (
            <ul className="x-dlist">
              {shown.map((d) => (
                <li key={d.id}>
                  <button className="x-ditem" aria-current={d.id === sel ? "true" : undefined} onClick={() => setSel(d.id)}>
                    <span className="row between" style={{ gap: 8 }}>
                      <span className="small muted trunc">{nameOf(d.data.clientId)}</span>
                      <span className={`pill ${PILL[d.data.status].cls}`}>{PILL[d.data.status].label}</span>
                    </span>
                    <span className="h3">{d.data.subject || "(no subject)"}</span>
                    <span className="xs muted">{templateLabel(d.data.template)}{d.updatedAt ? ` · ${fmtDateTime(d.updatedAt)}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section aria-label="Draft editor" ref={editorRef} style={{ scrollMarginTop: 76 }}>
          {current ? <Editor key={current.id} d={current} clientName={nameOf(current.data.clientId)} />
            : <div className="empty" style={{ padding: 36 }}>Pick a draft to read, edit and approve.</div>}
        </section>
      </div>

      {creating && <NewDraft onClose={() => setCreating(false)} onCreated={(id) => { setSel(id); setFilter("all"); }} />}
    </div>
  );
}

function Editor({ d, clientName }: { d: Doc<Draft>; clientName: string }) {
  const data = d.data;
  const [to, setTo] = useState(data.to || "");
  const [subject, setSubject] = useState(data.subject);
  const [body, setBody] = useState(data.body);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const unapproving = useRef(false);
  const lastNext = useRef<{ to: string; subject: string; body: string } | null>(null);
  const dirty = to !== (data.to || "") || subject !== data.subject || body !== data.body;

  // Pick up changes from another device when not mid edit.
  useEffect(() => {
    if (timer.current) return;
    setTo(data.to || ""); setSubject(data.subject); setBody(data.body);
  }, [data.to, data.subject, data.body]);

  async function persist(next: { to: string; subject: string; body: string }) {
    const latest = doc<Draft>(d.id)?.data ?? data;
    // Rule Zero: the approval covers the exact words AND the recipient.
    const wordsChanged = next.subject !== latest.subject || next.body !== latest.body || (next.to.trim() || null) !== (latest.to || null);
    const unapprove = latest.status !== "draft" && wordsChanged;
    await saveDraft({
      ...latest, to: next.to.trim() || null, subject: next.subject, body: next.body,
      ...(unapprove ? { status: "draft" as const, approvedAt: null, approvedText: null, sentAt: null } : {}),
    }, d.id);
    if (unapprove) toast("You changed the words or the recipient, so this needs approving again");
  }

  function edit(patch: Partial<{ to: string; subject: string; body: string }>) {
    const next = { to, subject, body, ...patch };
    if (patch.to !== undefined) setTo(patch.to);
    if (patch.subject !== undefined) setSubject(patch.subject);
    if (patch.body !== undefined) setBody(patch.body);
    // An approved draft drops back to Draft on the very first change.
    lastNext.current = next;
    const changedWords = next.subject !== data.subject || next.body !== data.body || (next.to.trim() || null) !== (data.to || null);
    if (data.status !== "draft" && changedWords && !unapproving.current) {
      unapproving.current = true;
      void persist(next).finally(() => { unapproving.current = false; });
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void persist(next); }, 600);
  }
  // Closing the editor saves the last edit instead of dropping it.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; if (lastNext.current) void persist(lastNext.current); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve() {
    if (!subject.trim() || !body.trim()) { toast("Add a subject and a message first"); return; }
    if (hasLongDash(subject + body) && !confirmAsk("This text has a long dash in it. Approve anyway?")) return;
    setBusy(true);
    try {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      await saveDraft({ ...data, to: to.trim() || null, subject, body }, d.id);
      await approveDraft(d.id);
      toast("Approved. These exact words are frozen.");
    } catch (e) { toast(String((e as Error).message || e)); }
    finally { setBusy(false); }
  }

  async function sent() {
    if (!confirmAsk("Mark this email as sent? Only do this once you have sent it yourself.")) return;
    await markDraftSent(d.id);
    toast("Marked as sent");
  }
  async function del() {
    if (!confirmAsk("Delete this draft?")) return;
    await remove(d.id);
    toast("Draft deleted");
  }

  const approvedWords = splitApproved(data);
  const locked = data.status !== "draft";

  return (
    <div className="panel stack">
      <div className="row between wrap-ok">
        <div className="stack tight" style={{ gap: 2 }}>
          <span className="small muted">{clientName} · {templateLabel(data.template)}</span>
          <span className="row" style={{ gap: 8 }}>
            <span className={`pill ${PILL[data.status].cls}`}>{PILL[data.status].label}</span>
            {data.approvedAt && data.status !== "draft" && <span className="xs muted">Approved {fmtDateTime(data.approvedAt)}</span>}
            {data.sentAt && data.status === "sent" && <span className="xs muted">Sent {fmtDateTime(data.sentAt)}</span>}
          </span>
        </div>
        <button className="btn quiet sm" onClick={() => void del()}><Icon name="trash" size={15} /> Delete</button>
      </div>

      <Field label="To" hint={to && !EMAIL_RE.test(to.trim()) ? "This does not look like an email address." : undefined}>
        <input className="input" type="email" value={to} onChange={(e) => edit({ to: e.target.value })} placeholder="client@example.com" autoComplete="off" />
      </Field>
      <Field label="Subject"><input className="input" value={subject} onChange={(e) => edit({ subject: e.target.value })} /></Field>
      <Field label="Message" hint={locked ? "Editing these words clears the approval." : dirty ? "Saving..." : "Saved as you type. Encrypted."}>
        <textarea className="textarea x-body" value={body} onChange={(e) => edit({ body: e.target.value })} spellCheck />
      </Field>
      {hasLongDash(subject + body) && <div className="banner"><Icon name="edit" /> There is a long dash in this text. Swap it for a comma, colon or hyphen.</div>}

      {data.status === "draft" ? (
        <button className="btn primary x-approve block" onClick={() => void approve()} disabled={busy || !subject.trim() || !body.trim()}>
          <Icon name="check" /> Approve these words
        </button>
      ) : (
        <div className="stack">
          <hr className="divider" />
          <div className="row between wrap-ok">
            <span className="label">The approved words</span>
            {data.status === "approved" && <span className="small muted">Send these yourself, exactly as they are.</span>}
          </div>
          <div className="x-frozen selectable" aria-label="Approved text"><b>{approvedWords.subject}</b>{"\n\n"}{approvedWords.body}</div>
          <div className="row wrap-ok">
            <button className="btn ghost" onClick={() => void copyText(approvedWords.body)}><Icon name="todo" /> Copy</button>
            <button className="btn quiet" onClick={() => void copyText(approvedWords.subject)}>Copy subject</button>
            <a className="btn ghost" href={mailto(data.to, approvedWords.subject, approvedWords.body)}><Icon name="emails" /> Open in mail app</a>
            <span className="spacer" />
            {data.status === "approved" && <button className="btn primary" onClick={() => void sent()}><Icon name="check" /> Mark as sent</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function NewDraft({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const s = useVault();
  const clients = clientViews(s).filter((c) => c.client);
  const [clientId, setClientId] = useState(clients[0]?.client!.id || "");
  const cv = clients.find((c) => c.client!.id === clientId);
  const projects = (cv?.projects || []).filter((p) => !p.p.archived);
  const [projectId, setProjectId] = useState(projects[0]?.doc.id || "");
  const [tpl, setTpl] = useState<TemplateKey>("weekly");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setProjectId(projects[0]?.doc.id || ""); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pv = projects.find((p) => p.doc.id === projectId) || null;
  const preview = cv?.client ? buildEmail(tpl, { client: cv.client.data as ClientRec, pv, sign: isRedAccount(s) ? undefined : (settingsData(s).ownerName || "").trim() || "[your name]" }) : null;

  async function create() {
    if (!cv?.client || !preview) return;
    setBusy(true);
    try {
      const id = await saveDraft({
        clientId: cv.client.id, projectId: pv?.doc.id || null, template: tpl,
        to: cv.client.data.email || null, subject: preview.subject, body: preview.body, status: "draft",
      });
      toast("Draft created. Read it, edit it, then approve.");
      onCreated(id);
      onClose();
    } catch (e) { toast(String((e as Error).message || e)); setBusy(false); }
  }

  return (
    <Modal title="New email draft" onClose={onClose} wide footer={<>
      <button className="btn quiet" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={() => void create()} disabled={busy || !preview}>Create draft</button>
    </>}>
      <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label="Client">
          <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((c) => <option key={c.client!.id} value={c.client!.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!projects.length}>
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => <option key={p.doc.id} value={p.doc.id}>{p.p.title}</option>)}
          </select>
        </Field>
      </div>
      <div className="stack tight">
        <span className="label">Template</span>
        <div className="x-segs" role="radiogroup" aria-label="Template">
          {TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="chip" role="radio" aria-checked={tpl === t.key} aria-pressed={tpl === t.key} onClick={() => setTpl(t.key)} title={t.hint}>{t.label}</button>
          ))}
        </div>
        <span className="small muted">{TEMPLATES.find((t) => t.key === tpl)?.hint}</span>
      </div>
      {preview && (
        <div className="stack tight">
          <span className="label">Preview</span>
          <div className="x-frozen selectable" style={{ borderStyle: "solid", borderColor: "var(--line)" }}><b>{preview.subject}</b>{"\n\n"}{preview.body}</div>
          <span className="small muted">Anything in [square brackets] is for you to fill in before approving.</span>
        </div>
      )}
    </Modal>
  );
}
