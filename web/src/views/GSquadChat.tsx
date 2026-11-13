// G Squad chat (V1.40), the developer 7 Nov 2026: the Chat tab in the G Squad pop-up (PS), and on the website a chat button in
// the To-do page's top bar with the same panel. End to end encrypted: the words are opened on the page that holds
// the vault (squad/chatengine.ts) and arrive here as plain lines; this window holds no key in PS.
// Text only, smooth and simple. Your own messages: Edit and Delete (for everyone). New messages: a small badge on the
// G Squad icon; no sound unless switched on here (Mac). History votes: a pop-up with Yes and No (a PS card on the
// Mac, a pop-up on the website) and the same question at the top of this tab until answered.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { registerSquadTab, TAB_ORDER, type SquadTabProps } from "../squad/tabs";
import { chatNow, chatOp, useChat } from "../squad/chatmirror";
import { composeStore } from "../squad/chatopen";
import { badgeText, type ChatLine, type ChatVoteView } from "../squad/chatview";
import { MAX_TEXT, type ChatAbout } from "../core/squadchat";
import { startChat } from "../squad/chatengine";
import { sfx } from "../ui/sfx";
import { useBack } from "../squad/back";
import { dayLabel, sameDay, toneOf } from "../squad/window";
import { Avatar } from "./SquadAvatar";
import "./gschat.css";

const PS = import.meta.env.MODE === "ps";

/** The time in a bubble (V1.43): the day is on the day line above the messages. */
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ---------- a history vote, in the tab and in the website's pop-up ----------
export function VoteBox({ v }: { v: ChatVoteView }) {
  return (
    <div className="gc-vote" role="group" aria-label="History vote">
      <p className="gc-vote-t">{v.title}</p>
      <p className="gc-vote-s">{v.sub}</p>
      <p className="gc-vote-b">{v.body}</p>
      <div className="gc-vote-row">
        <button type="button" className={`gs-mini go${v.mine === true ? " on" : ""}`} onClick={() => { sfx.click(); chatOp({ op: "vote", id: v.id, yes: true }); }}>Yes</button>
        <button type="button" className={`gs-mini bad${v.mine === false ? " on" : ""}`} onClick={() => { sfx.click(); chatOp({ op: "vote", id: v.id, yes: false }); }}>No</button>
        {v.n > 0 && <span className="gc-vote-n">{v.k} of {v.n} answered</span>}
      </div>
    </div>
  );
}

// ---------- one message ----------
// V1.43, the messenger look: messages from one person in a row are one group; others' groups carry their picture at
// the bottom and their name (in their colour) at the top; the last bubble of a group has a small tail.
function Line({ l, first, last, onEdit }: { l: ChatLine; first: boolean; last: boolean; onEdit: (l: ChatLine) => void }) {
  const [sure, setSure] = useState(false);
  return (
    <li className={`gc-line${l.mine ? " mine" : ""}${first ? " first" : ""}${last ? " last" : ""}${l.edited ? " edited" : ""}${l.sending ? " sending" : ""}${l.failed ? " failed" : ""}`} data-id={l.id}>
      {!l.mine && <span className="gc-av">{last && <Avatar id={l.from} name={l.name} size={30} />}</span>}
      <div className="gc-col">
        <div className="gc-bubble">
          {first && !l.mine && <span className={`gc-who t${toneOf(l.from || l.name)}`}>{l.name}{l.left && <em> (left)</em>}</span>}
          {l.a && <About a={l.a} />}
          <span className="gc-text selectable">{l.t}<span className="gc-pad" aria-hidden="true" /></span>
          <span className="gc-meta">{l.failed ? "Not sent" : l.sending ? "Sending" : `${l.edited ? "edited " : ""}${when(l.at)}`}</span>
        </div>
        {l.mine && !l.sending && (
          <span className="gc-acts">
            {l.failed
              ? <button type="button" className="gc-act" onClick={() => chatOp({ op: "retry" })}>Try again</button>
              : sure
                ? <><button type="button" className="gc-act bad" onClick={() => { sfx.click(); chatOp({ op: "del", id: l.id }); setSure(false); }}>Delete for everyone</button>
                  <button type="button" className="gc-act" onClick={() => setSure(false)}>Keep</button></>
                : <><button type="button" className="gc-act" onClick={() => onEdit(l)}>Edit</button>
                  <button type="button" className="gc-act" onClick={() => setSure(true)}>Delete</button></>}
          </span>
        )}
      </div>
    </li>
  );
}
function About({ a, onClear }: { a: ChatAbout; onClear?: () => void }) {
  return (
    <span className="gc-about">
      <b>{a.k === "gym" ? "Gym log" : "About"}</b>{a.l}
      {onClear && <button type="button" className="gc-about-x" onClick={onClear} aria-label="Remove">×</button>}
    </span>
  );
}

// ---------- the panel ----------
export function ChatPanel() {
  const v = useChat();
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const atBottom = useRef(true);
  const [text, setText] = useState("");
  const [about, setAbout] = useState<ChatAbout | null>(null);
  const [editing, setEditing] = useState<ChatLine | null>(null);
  const ask = useSyncExternalStore(composeStore.subscribe, composeStore.get);

  // Open while on screen: the page that holds the keys pulls every 5 s and marks what you see as read.
  useEffect(() => { chatOp({ op: "open", on: true }); return () => chatOp({ op: "open", on: false }); }, []);
  // Another part of PS asked to open the chat about something (squad/chatopen.ts): its draft and chip, never sent by itself.
  useEffect(() => {
    if (!ask.n) return;
    setEditing(null); setAbout(ask.about); setText(ask.draft);
    window.setTimeout(() => { box.current?.focus(); const n = box.current?.value.length ?? 0; box.current?.setSelectionRange(n, n); }, 30);
  }, [ask.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stay at the newest message when it comes in, unless you scrolled up to read.
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !atBottom.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: placed.current ? "smooth" : "instant" });   // the first time straight to the newest, then gliding
    if (v.lines.length) placed.current = true;
  }, [v.lines.length, v.lines.at(-1)?.id, v.votes.length, v.note, about, editing]);
  // The box grows with the text (up to 6 lines).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    el.style.overflowY = el.scrollHeight > 132 ? "auto" : "hidden";
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    sfx.drop();
    if (editing) chatOp({ op: "edit", id: editing.id, text: t });
    else chatOp(about ? { op: "send", text: t, a: about } : { op: "send", text: t });
    setText(""); setAbout(null); setEditing(null);
    atBottom.current = true;
  };
  // Esc (V1.43): in the G Squad window an edit stops first, then the window closes.
  useBack(!!editing, () => { setEditing(null); setText(""); });
  const startEdit = (l: ChatLine) => { setEditing(l); setAbout(null); setText(l.t); window.setTimeout(() => box.current?.focus(), 20); };

  const votes = v.votes;
  return (
    <div className="gc">
      <div ref={list} className="gc-list" onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {votes.map((x) => <VoteBox key={x.id} v={x} />)}
        {v.note && <p className="gc-note">{v.note}</p>}
        {v.more && <button type="button" className="gc-older" onClick={() => { atBottom.current = false; chatOp({ op: "older" }); }}>Show older messages</button>}
        {!v.loaded && v.lines.length === 0 && <p className="gc-empty">Opening the chat...</p>}
        {v.loaded && v.lines.length === 0 && <p className="gc-empty">No messages yet. Say hi to the squad.</p>}
        <ul className="gc-lines">
          {v.lines.map((l, i) => {
            const prev = v.lines[i - 1], next = v.lines[i + 1];
            const newDay = !prev || !sameDay(prev.at, l.at);
            return (
              <Fragment key={l.id}>
                {newDay && <li className="gc-day" aria-label={dayLabel(l.at)}><span>{dayLabel(l.at)}</span></li>}
                <Line l={l} first={newDay || prev.from !== l.from} last={!next || next.from !== l.from || !sameDay(next.at, l.at)} onEdit={startEdit} />
              </Fragment>
            );
          })}
        </ul>
      </div>
      {v.error && <p className="gs-err" role="alert">{v.error}</p>}
      <form className="gc-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {editing && <span className="gc-editing">Editing your message<button type="button" className="gc-about-x" onClick={() => { setEditing(null); setText(""); }} aria-label="Stop editing">×</button></span>}
        {about && !editing && <About a={about} onClear={() => setAbout(null)} />}
        <div className="gc-row">
          <textarea ref={box} className="gc-box" rows={1} value={text} maxLength={MAX_TEXT} placeholder={v.ready || !v.loaded ? "Message the squad" : "Getting the chat's key..."}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();   // the Tab list's own shortcuts never fire while typing here
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              if (e.key === "Escape" && editing) { e.preventDefault(); setEditing(null); setText(""); }
            }} />
          <button type="submit" className="gc-send" disabled={!text.trim()} aria-label={editing ? "Save" : "Send"}>
            {editing ? "Save" : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5.5M5.8 11.5L12 5.3l6.2 6.2" /></svg>}
          </button>
        </div>
      </form>
      {PS && (
        <button type="button" role="switch" aria-checked={v.sound} className={`gc-sound${v.sound ? " on" : ""}`} onClick={() => { sfx.click(); chatOp({ op: "sound", on: !v.sound }); }}>
          <i className="gs-tog" aria-hidden="true"><b /></i>Sound for new messages
        </button>
      )}
      <p className="gc-foot">End to end encrypted. Only the squad can read these messages.</p>
    </div>
  );
}

function ChatTab(_: SquadTabProps) { return <ChatPanel />; }
registerSquadTab({ id: "chat", title: "Chat", order: TAB_ORDER.chat, Panel: ChatTab, badge: () => chatNow().unread });

// ---------- the website: a chat button in the To-do page's top bar, and the history vote pop-up ----------
export function GSquadChatWeb() {
  useEffect(() => { startChat(null); }, []);
  const v = useChat();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const ask = useSyncExternalStore(composeStore.subscribe, composeStore.get);
  useEffect(() => { if (ask.n) setOpen(true); }, [ask.n]);
  if (!v.in) return null;
  const due = v.votes.filter((x) => x.stage);
  return (
    <span className="gs-wrap">
      <button ref={btn} type="button" className={`gs-btn${open ? " open" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label={v.unread ? `G Squad chat, ${v.unread} new` : "G Squad chat"}
        title="G Squad chat" onClick={() => { sfx.click(); setOpen(!open); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5h16v10H9l-5 4z" /></svg>
        {v.unread > 0 && <b className="gc-badge num" aria-hidden="true">{badgeText(v.unread)}</b>}
      </button>
      {open && <WebPop anchor={btn} onClose={() => setOpen(false)} />}
      {!open && due.length > 0 && createPortal(
        <div className="gc-modal" role="dialog" aria-modal="true" aria-label="History vote"><div className="gc-modal-card"><VoteBox v={due[0]} /></div></div>, document.body)}
    </span>
  );
}
function WebPop({ anchor, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 10, right: Math.max(8, window.innerWidth - r.right - 8) });
  }, [anchor]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down, true);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("pointerdown", down, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!at) return null;
  return createPortal(
    <div ref={box} className="gs-pop gc-pop" role="dialog" aria-label="G Squad chat" style={{ top: at.top, right: at.right }}>
      <div className="gs-head">
        <span className="gs-title">G Squad chat<em>End to end encrypted</em></span>
        <button type="button" className="gs-x" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
      </div>
      <div className="gs-body"><ChatPanel /></div>
    </div>, document.body);
}
