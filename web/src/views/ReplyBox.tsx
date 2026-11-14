// Reply in the email panel (V1.59, core/inlinereply.ts): the small reply box under an email in the email panel, on the
// phone's Inbox, the website and the Mac's Tab list. The last message, a text box, Send and Cancel. The developer types the words;
// Send asks nothing more and shows "Sending in 10 s, Undo" on the row first. Cancel, Esc and the phone's Back close the
// box and keep the words for next time (on this device). Nothing here sends: `onSend` runs only when the Undo window
// has run out after the developer's own click on Send.
import { useEffect, useRef, useState } from "react";
import { MESSAGE_MAX, makeDrafts } from "../core/inlinereply";
import { firstSentences } from "../core/mail";

const store = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };
export const drafts = makeDrafts(store());

/** The reply box for one email. */
export function ReplyBox({ cardId, who, last, onClose, onSent }: {
  cardId: string; who: string; last: string;
  onClose: () => void;
  /** Send pressed: the panel starts the Undo window (core/inlinereply.ts startUndoSend) and the box closes. */
  onSent: (text: string) => void;
}) {
  const [text, setText] = useState(() => drafts.get(cardId));
  const [err, setErr] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => { ta.current?.focus(); const n = ta.current?.value.length ?? 0; ta.current?.setSelectionRange(n, n); }, []);
  // Esc on a Mac or the website, Back on the phone: close, keeping the words (they are saved as they are typed).
  useEffect(() => {
    const close = () => { drafts.set(cardId, textRef.current); onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const back = (e: Event) => { e.preventDefault(); close(); };
    window.addEventListener("keydown", key, true);
    window.addEventListener("gos-back", back);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("gos-back", back); };
  }, [cardId, onClose]);
  const type = (v: string) => { setText(v); setErr(""); drafts.set(cardId, v); };
  const send = () => {
    const words = textRef.current;
    if (!words.trim()) { setErr("Type a reply first."); ta.current?.focus(); return; }
    drafts.set(cardId, words);   // kept until the reply has really gone
    onSent(words);
  };
  return (
    <div className="tm-rb" role="group" aria-label={`Reply to ${who}`} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {last && <blockquote className="tm-rb-last"><b>{who} wrote</b>{firstSentences(last, 12)}</blockquote>}
      <textarea ref={ta} className="tm-rb-ta no-drag" value={text} rows={4} maxLength={MESSAGE_MAX} placeholder={`Reply to ${who}`} aria-label="Your reply"
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
      {err && <p className="tm-rb-err" role="alert">{err}</p>}
      <div className="tm-rb-acts">
        <button type="button" className="tm-meet-j tm-rb-send" onClick={send} title="Sends from the account and in the thread this email came in on, after a short Undo">Send</button>
        <button type="button" className="tm-mail-done" onClick={() => { drafts.set(cardId, textRef.current); onClose(); }} title="Closes the box. Your words stay for next time.">Cancel</button>
      </div>
    </div>
  );
}
