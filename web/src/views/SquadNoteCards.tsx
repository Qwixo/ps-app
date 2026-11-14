// G Squad message cards on the website (PS 1.60, PR 10, core/squadnotify.ts has the rules): a message from someone in the
// squad pops up in the bottom right corner with Open, Reply and Dismiss, like the client email cards (views/MailCards.tsx).
// Reply opens a box on the card. Send starts a short Undo; when it runs out the reply goes through the G Squad composer's
// send (views/GSquadComposer.tsx sendChat). Esc and Back close the box, then the card. Not shown inside PS (the Mac's own
// card stack has the same card, ps-mac SquadMessageCard.swift) or on the phone app (a notification).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { noteAction, noteStore } from "../squad/chatengine";
import { sendChat } from "./GSquadComposer";
import { useBack } from "../squad/back";
import { REPLY_IDLE, replyStep, withHeld, type NoteCard, type ReplyEvent, type ReplyState } from "../core/squadnotify";
import { MAX_TEXT } from "../core/squadchat";
import { PS } from "../ps";
import "./mailcards.css";
import "./squadnote.css";

// A card whose reply is waiting out its Undo is held here, so it stays on screen (with its Undo) even when the message
// itself is gone (read on another device, Do Not Disturb, the chat opened). The reply goes only when the Undo time is up.
const held = new Map<string, NoteCard>();
let heldList: NoteCard[] = [];
const heldSubs = new Set<() => void>();
const heldStore = { subscribe: (f: () => void) => { heldSubs.add(f); return () => { heldSubs.delete(f); }; }, get: () => heldList };
function hold(c: NoteCard, on: boolean) {
  if (on === held.has(c.id)) return;
  if (on) held.set(c.id, c); else held.delete(c.id);
  heldList = [...held.values()];
  heldSubs.forEach((f) => f());
}

export function SquadNoteCards() {
  const live = useSyncExternalStore(noteStore.subscribe, noteStore.get);
  const keep = useSyncExternalStore(heldStore.subscribe, heldStore.get);
  const list = withHeld(live, keep);
  if (PS || !list.length) return null;
  return (
    <aside className="mc mc-sq" aria-label="New G Squad messages">
      {list.slice(-3).map((c) => <Note key={c.id} c={c} />)}
    </aside>
  );
}

function Note({ c }: { c: NoteCard }) {
  const [st, setSt] = useState<ReplyState>(REPLY_IDLE);
  const box = useRef<HTMLTextAreaElement>(null);
  const stRef = useRef(st);
  stRef.current = st;
  const go = (ev: ReplyEvent) => {
    const r = replyStep(stRef.current, ev, Date.now());
    stRef.current = r.state; setSt(r.state);
    if (r.send && r.send.op === "send") sendChat(r.send.text);   // the composer's send
    if (r.send || (r.done && ev.e === "close")) noteAction(c.id, "dismiss");
  };
  // The Undo runs out by the clock.
  useEffect(() => {
    if (st.k !== "undo") return;
    const t = window.setInterval(() => go({ e: "tick" }), 250);
    return () => window.clearInterval(t);
  }, [st.k]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { hold(c, st.k === "undo"); }, [st.k]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => hold(c, false), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const art = useRef<HTMLElement>(null), was = useRef<ReplyState["k"]>("idle");
  useEffect(() => {
    if (st.k === "typing") box.current?.focus();
    if (st.k === "undo") art.current?.querySelector<HTMLButtonElement>(".mc-sqbox .mc-open")?.focus();   // Esc still reaches the card
    // The box closed: the keyboard stays on the card (its Reply button), so a second Esc closes the card.
    if (st.k === "idle" && was.current !== "idle") art.current?.querySelector<HTMLButtonElement>(".mc-rep")?.focus();
    was.current = st.k;
  }, [st.k]);
  // Back (phone web) and Esc: the box first, then the card.
  useBack(st.k !== "idle", () => go({ e: "close" }));
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); go({ e: "close" }); }
  };
  const secs = st.k === "undo" ? Math.max(1, Math.ceil((st.until - Date.now()) / 1000)) : 0;
  return (
    <article ref={art} className="mc-card mc-sqc" onKeyDown={key}>
      <header><span className="mc-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></span>
        <b>{c.title}</b><time>{new Date(c.at).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })}</time></header>
      <p className="mc-sub">{c.sub}</p>
      {c.body && <p className="mc-b">{c.body}</p>}
      {st.k === "typing" && (
        <form className="mc-sqbox" onSubmit={(e) => { e.preventDefault(); go({ e: "send" }); }}>
          <textarea ref={box} rows={2} maxLength={MAX_TEXT} value={st.text} placeholder="Reply to the squad" aria-label="Reply to the squad"
            onChange={(e) => go({ e: "type", text: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go({ e: "send" }); } }} />
          <div className="mc-acts">
            <button type="submit" className="mc-open" disabled={!st.text.trim()}>Send</button>
            <button type="button" className="mc-dis" onClick={() => go({ e: "close" })}>Cancel</button>
          </div>
        </form>
      )}
      {st.k === "undo" && (
        <div className="mc-sqbox" role="status">
          <p className="mc-b mc-sqsay">Sending in {secs}s</p>
          <div className="mc-acts"><button type="button" className="mc-open" onClick={() => go({ e: "undo" })}>Undo</button></div>
        </div>
      )}
      {st.k === "idle" && (
        <div className="mc-acts">
          <button type="button" className="mc-open" onClick={() => noteAction(c.id, "open")}>Open</button>
          <button type="button" className="mc-rep" onClick={() => go({ e: "open" })}>Reply</button>
          <button type="button" className="mc-dis" onClick={() => noteAction(c.id, "dismiss")}>Dismiss</button>
        </div>
      )}
    </article>
  );
}
