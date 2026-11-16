// G Squad chat composer (PR 11): the box at the bottom of the chat and the one place a message is sent from. It is a small
// piece on its own so another part of PS (the pop up Reply for a new message, PR 10) can use it: useComposer() holds the
// text, the chip and an edit; ChatComposer draws it; sendChat() is the plain send. What a send is lives in squad/chatsend.ts.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { chatOp } from "../squad/chatmirror";
import { composeStore } from "../squad/chatopen";
import { buildSend } from "../squad/chatsend";
import { useBack } from "../squad/back";
import type { ChatLine } from "../squad/chatview";
import { MAX_TEXT, type ChatAbout, type ChatReply } from "../core/squadchat";
import { insertAt } from "../squad/chatreact";
import { EmojiIcon, GifIcon } from "./GSquadPickers";
import { sfx } from "../ui/sfx";

/** Sends one message to the squad chat. False when there was nothing to send. */
export function sendChat(text: string, about?: ChatAbout | null): boolean {
  const op = buildSend(text, { about });
  if (!op) return false;
  sfx.drop();
  chatOp(op);
  return true;
}

export interface ComposerState {
  box: RefObject<HTMLTextAreaElement | null>;
  text: string; setText: (t: string) => void;
  about: ChatAbout | null; setAbout: (a: ChatAbout | null) => void;
  editing: ChatLine | null;
  startEdit: (l: ChatLine) => void;
  stopEdit: () => void;
  send: () => void;
  /** Puts an emoji at the cursor (PS 1.63). */
  insert: (e: string) => void;
  /** PS 1.64: the message being answered (the strip above the box), and the way to start or drop it. */
  reply: ReplyDraft | null;
  startReply: (r: ReplyDraft) => void;
  stopReply: () => void;
}
/** What the composer's quote strip shows and what the sent reply carries (name is only for the strip). */
export interface ReplyDraft extends ChatReply { name: string }

/** The composer's state. onSent runs after a send or a save (the chat scrolls to the newest). listenAsk: another part of PS
 *  may ask the chat to open with a draft and a chip (squad/chatopen.ts); it is never sent by itself. */
export function useComposer(opts: { onSent?: () => void; listenAsk?: boolean } = {}): ComposerState {
  const box = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [about, setAbout] = useState<ChatAbout | null>(null);
  const [editing, setEditing] = useState<ChatLine | null>(null);
  const [reply, setReply] = useState<ReplyDraft | null>(null);
  const ask = useSyncExternalStore(composeStore.subscribe, composeStore.get);

  useEffect(() => {
    if (opts.listenAsk === false || !ask.n) return;
    setEditing(null); setReply(null); setAbout(ask.about); setText(ask.draft);
    window.setTimeout(() => { box.current?.focus(); const n = box.current?.value.length ?? 0; box.current?.setSelectionRange(n, n); }, 30);
  }, [ask.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopEdit = () => { setEditing(null); setText(""); };
  const send = () => {
    const q = !editing && reply ? { id: reply.id, w: reply.w, s: reply.s } : null;
    const op = buildSend(text, { about: editing ? null : about, editId: editing?.id ?? null, reply: q });
    if (!op) return;
    sfx.drop();
    chatOp(op);
    setText(""); setAbout(null); setEditing(null); setReply(null);
    opts.onSent?.();
  };
  // Esc: in the G Squad window an edit or a reply stops first, then the window closes.
  useBack(!!editing, stopEdit);
  const stopReply = () => setReply(null);
  useBack(!!reply && !editing, stopReply);
  const startEdit = (l: ChatLine) => { setEditing(l); setReply(null); setAbout(null); setText(l.t); window.setTimeout(() => box.current?.focus(), 20); };
  const startReply = (r: ReplyDraft) => {
    if (editing) { setEditing(null); setText(""); }
    setReply(r);
    window.setTimeout(() => box.current?.focus(), 20);
  };
  const insert = (e: string) => {
    const el = box.current;
    const r = insertAt(text, el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length, e, MAX_TEXT);
    setText(r.text);
    window.setTimeout(() => { box.current?.focus(); box.current?.setSelectionRange(r.at, r.at); }, 0);
  };
  return { box, text, setText, about, setAbout, editing, startEdit, stopEdit, send, insert, reply, startReply, stopReply };
}

export function About({ a, onClear }: { a: ChatAbout; onClear?: () => void }) {
  return (
    <span className="gc-about">
      <b>{a.k === "gym" ? "Gym log" : "About"}</b>{a.l}
      {onClear && <button type="button" className="gc-about-x" onClick={onClear} aria-label="Remove">×</button>}
    </span>
  );
}

/** PS 1.63: the emoji button, and the GIF button (gif is null while the hub has not said it is set up: then no button). */
export interface ComposerExtras { emoji: boolean; gif: boolean | null; onEmoji: () => void; onGif: () => void }
export function ChatComposer({ c, ready, loaded, extras }: { c: ComposerState; ready: boolean; loaded: boolean; extras?: ComposerExtras }) {
  const { box, text, editing, about } = c;
  // The box grows with the text (up to 6 lines).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    el.style.overflowY = el.scrollHeight > 132 ? "auto" : "hidden";
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="gc-compose" onSubmit={(e) => { e.preventDefault(); c.send(); }}>
      {editing && <span className="gc-editing">Editing your message<button type="button" className="gc-about-x" onClick={c.stopEdit} aria-label="Stop editing">×</button></span>}
      {c.reply && !editing && (
        <span className="gc-qstrip" role="group" aria-label={`Replying to ${c.reply.name}`}>
          <span className="gc-qstrip-m"><b>{c.reply.name}</b><span>{c.reply.s || " "}</span></span>
          <button type="button" className="gc-about-x" onClick={() => { sfx.click(); c.stopReply(); }} aria-label="Cancel reply" title="Cancel reply (Esc)">×</button>
        </span>
      )}
      {about && !editing && <About a={about} onClear={() => c.setAbout(null)} />}
      <div className="gc-row">
        {extras && !editing && <button type="button" className={`gc-tool${extras.emoji ? " on" : ""}`} aria-label="Emoji" aria-pressed={extras.emoji} title="Emoji" onClick={() => { sfx.click(); extras.onEmoji(); }}><EmojiIcon /></button>}
        <textarea ref={box} className="gc-box" rows={1} value={text} maxLength={MAX_TEXT} placeholder={ready || !loaded ? "Message the squad" : "Getting the chat's key..."}
          onChange={(e) => c.setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();   // the Tab list's own shortcuts never fire while typing here
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); c.send(); }
            if (e.key === "Escape" && editing) { e.preventDefault(); c.stopEdit(); }
            else if (e.key === "Escape" && c.reply) { e.preventDefault(); c.stopReply(); }
          }} />
        {extras && extras.gif !== null && !editing && <button type="button" className={`gc-tool${extras.gif ? " on" : ""}`} aria-label="GIF" aria-pressed={extras.gif} title="GIFs" onClick={() => { sfx.click(); extras.onGif(); }}><GifIcon /></button>}
        <button type="submit" className="gc-send" disabled={!text.trim()} aria-label={editing ? "Save" : "Send"}>
          {editing ? "Save" : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5.5M5.8 11.5L12 5.3l6.2 6.2" /></svg>}
        </button>
      </div>
    </form>
  );
}
