// WhatsApp messages in the same panel as client emails (Tab overlay, Inbox tab, phone Inbox page): newest first, with Open,
// Reply and Done. Reply opens the small box (views/WaReplyBox.tsx) with the shared quick replies and "You can reply for 5 more
// hours". Send shows "Sending in 10 s, Undo" first; only when that runs out does the reply leave. After the 24 hour window
// closes, Reply becomes "Send a template" (approved templates the person made in Meta). Reads the same chat records the cards read.
import { useEffect, useMemo, useState } from "react";
import { settingsData } from "../core/select";
import { startUndoSend, type UndoSend } from "../core/inlinereply";
import { responsesFor, responsesOf } from "../core/mailreply";
import { chatsForClient, prefsOf, showMsg, TICK_TEXT, waRows } from "../core/whatsapp";
import { waOnSnap } from "../core/wasnap";
import { refreshWaTemplates } from "../core/waactions";
import { firstSentences } from "../core/mail";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { taskMapActions } from "./TaskMap";
import { drafts } from "./ReplyBox";
import { WaReplyBox } from "./WaReplyBox";
import { WaMark } from "./WaMark";
import type { ClientRec, Doc } from "../core/model";

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export function WaMail({ s }: { s: ReturnType<typeof useVault> }) {
  const st = settingsData(s), prefs = prefsOf(st);
  const [, tick] = useState(0);
  const rows = useMemo(() => waRows(s.docs.values(), prefs.since, prefs), [s, prefs.since, prefs.on, prefs.muted, prefs.notify, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [openId, setOpenId] = useState<string | null>(null);
  const [tplId, setTplId] = useState<string | null>(null);
  const [undo, setUndo] = useState<Map<string, UndoSend>>(() => new Map());
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), undo.size ? 500 : 60_000);   // the Undo counts down; the window text moves each minute
    return () => clearInterval(t);
  }, [undo.size]);
  // Templates are saved in the WhatsApp settings (not secret): refreshed here when a window has closed and none are known (the Tab list reads them).
  const needTpl = rows.some((r) => r.plan === "template") && !(prefs.templates?.length) && !(prefs.templatesAt && Date.now() - Date.parse(prefs.templatesAt) < 3600_000);
  useEffect(() => { if (needTpl && import.meta.env.MODE !== "ps") void refreshWaTemplates(); }, [needTpl]);
  if (!rows.length) return null;
  const names: Record<string, string> = {};
  for (const d of s.docs.values()) if (d.kind === "client") names[d.id] = (d as Doc<ClientRec>).data.name;
  const dropUndo = (id: string) => setUndo((m) => { const n = new Map(m); n.delete(id); return n; });
  const sendFrom = (chatId: string, cardId: string, text: string) => {
    setOpenId(null);
    const u = startUndoSend(() => { dropUndo(cardId); void taskMapActions.waSend(chatId, text).catch(() => {}); });   // a problem comes back on the row as "Not sent"
    setUndo((m) => new Map(m).set(cardId, u));
  };
  const undoIt = (cardId: string) => { if (undo.get(cardId)?.undo()) { dropUndo(cardId); setOpenId(cardId); } };
  const quickFor = (clientId: string | null) => {
    const all = responsesOf(st.mailReply, st.ownerName);
    const groups = responsesFor(all, clientId ? [clientId] : [], names, true);
    return groups.flatMap((g) => g.items).filter((r, i, a) => a.findIndex((x) => x.id === r.id) === i);
  };
  return (
    <aside className="tm-meet tm-mail tm-wa" aria-label="WhatsApp messages" onMouseDown={(e) => e.stopPropagation()}>
      <span className="tm-meet-h"><WaMark size={13} /> WhatsApp<em> · {rows.length} new</em></span>
      <ul className="tm-mail-list">
        {rows.map((r) => {
          const u = undo.get(r.cardId), boxOpen = openId === r.cardId, busy = !!u;
          const clientId = r.clientId;
          return (
            <li key={r.cardId} className={Date.now() - Date.parse(r.at) < 3600_000 ? "fresh" : ""}>
              <span className="tm-mail-who">{r.who}{r.company && <em> · {r.company}</em>}</span>
              <span className="tm-mail-t num" title={new Date(r.at).toLocaleString()}>{ago(r.at)}{r.count > 1 ? ` · ${r.count} messages` : ""}</span>
              {r.preview && !boxOpen && <span className="tm-mail-p">{firstSentences(r.preview, 4)}</span>}
              {!boxOpen && <span className="tm-mail-s" style={{ opacity: 0.7 }}>{r.plan === "none" ? "No number to answer" : r.window.open ? r.window.text : r.window.text}</span>}
              {u ? (
                <span className="tm-mail-st" role="status">Sending in {u.left()} s
                  <button type="button" className="tm-mail-undo" onClick={() => { sfx.click(); undoIt(r.cardId); }}>Undo</button></span>
              ) : r.out ? (
                <span className={`tm-mail-st ${r.out.ticks === "failed" ? "failed" : "replied"}`} role="status" title={r.out.error || undefined}>
                  {r.out.ticks === "failed" ? `Not sent: ${r.out.error || ""}` : TICK_TEXT[r.out.ticks || "sent"]}</span>
              ) : null}
              {boxOpen && <WaReplyBox cardId={r.cardId} who={r.who} company={r.company || ""} last={r.preview} windowText={r.window.text} quick={quickFor(clientId)} onClose={() => setOpenId(null)} onSent={(text) => sendFrom(r.chatId, r.cardId, text)} />}
              {tplId === r.cardId && (
                <span className="tm-wa-tpl" role="group" aria-label="Templates">
                  {(prefs.templates || []).length ? (prefs.templates || []).map((t) => (
                    <button key={t.name + t.language} type="button" className="tm-mail-done" title={t.text}
                      onClick={() => { sfx.click(); setTplId(null); void taskMapActions.waTemplate(r.chatId, t.name, t.language).catch(() => {}); }}>{t.name}</button>
                  )) : <em className="small">No approved templates yet. Make one in Meta, then open WhatsApp settings and press Test connection.</em>}
                </span>
              )}
              {!boxOpen && (
                <span className="tm-mail-a">
                  {r.plan === "text" && !busy && <button type="button" className="tm-meet-j tm-mail-reply" title="Reply right here. Nothing is sent until you press Send, and Undo shows for a few seconds after."
                    onClick={() => { sfx.click(); setOpenId(r.cardId); }}>{drafts.has(r.cardId) ? "Reply (draft)" : "Reply"}</button>}
                  {r.plan === "template" && !busy && <button type="button" className="tm-meet-j tm-mail-reply" title="The 24 hour window is closed. Pick one of your approved templates."
                    onClick={() => { sfx.click(); setTplId(tplId === r.cardId ? null : r.cardId); }}>Send a template</button>}
                  <a className={r.plan === "none" ? "tm-meet-j" : "tm-mail-done"} href={r.url} target="_blank" rel="noopener noreferrer">Open in WhatsApp</a>
                  <button type="button" className="tm-mail-done" onClick={() => { sfx.click(); void taskMapActions.waDone(r.chatId); }}>Done</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** The client's page: the WhatsApp messages from the number saved on this client (read only here; Reply is in the panel). Nothing shows without WhatsApp on. */
export function WaClientMessages({ s, clientId }: { s: ReturnType<typeof useVault>; clientId: string }) {
  if (!waOnSnap(s)) return null;
  const chats = chatsForClient(s.docs.values(), clientId, prefsOf(settingsData(s)).country);
  if (!chats.length) return null;
  return (
    <section className="panel stack tm-wa" aria-label="WhatsApp messages">
      <span className="tm-meet-h"><WaMark size={13} /> WhatsApp</span>
      {chats.map(({ id, chat }) => (
        <ul key={id} className="tm-mail-list">
          {chat.msgs.slice(-6).map((m) => (
            <li key={m.id} className={m.dir === "out" ? "replied" : ""}>
              <span className="tm-mail-who">{m.dir === "out" ? "You" : chat.name || "Them"}</span>
              <span className="tm-mail-t num" title={new Date(m.at).toLocaleString()}>{ago(m.at)}</span>
              <span className="tm-mail-p">{showMsg(m)}{m.dir === "out" && m.ticks ? ` (${TICK_TEXT[m.ticks]})` : ""}</span>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}
