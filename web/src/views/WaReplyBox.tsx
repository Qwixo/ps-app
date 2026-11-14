// The WhatsApp reply box under a message in the panel (a carbon copy of ReplyBox.tsx for email): the last message, a text box,
// the shared quick replies one click away, Send and Cancel. Cancel, Esc and the phone's Back close it and keep the words.
// Nothing here sends: `onSent` runs only after the person's own click on Send (the panel then shows the 10 second Undo).
import { useEffect, useMemo, useRef, useState } from "react";
import { MESSAGE_MAX } from "../core/inlinereply";
import { firstSentences } from "../core/mail";
import { fillPlaceholders, firstOf, responsesFor, type SavedResponse } from "../core/whatsapp";
import { drafts } from "./ReplyBox";
import { WaMark } from "./WaMark";

export interface QuickGroup { label: string; items: SavedResponse[] }
export function WaReplyBox({ cardId, who, company, last, windowText, quick, onClose, onSent }: {
  cardId: string; who: string; company: string; last: string; windowText: string;
  quick: SavedResponse[]; onClose: () => void; onSent: (text: string) => void;
}) {
  const [text, setText] = useState(() => drafts.get(cardId));
  const [err, setErr] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => { ta.current?.focus(); const n = ta.current?.value.length ?? 0; ta.current?.setSelectionRange(n, n); }, []);
  useEffect(() => {
    const close = () => { drafts.set(cardId, textRef.current); onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const back = (e: Event) => { e.preventDefault(); close(); };
    window.addEventListener("keydown", key, true);
    window.addEventListener("gos-back", back);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("gos-back", back); };
  }, [cardId, onClose]);
  const type = (v: string) => { setText(v); setErr(""); drafts.set(cardId, v); };
  // A quick reply fills the box (placeholders filled in, no signature: signatures stay email only). The person still presses Send.
  const fill = useMemo(() => ({ first: firstOf(who), name: who, company, email: "" }), [who, company]);
  const pick = (r: SavedResponse) => { type(fillPlaceholders(r.text, fill)); ta.current?.focus(); };
  const send = () => {
    const words = textRef.current;
    if (!words.trim()) { setErr("Type a reply first."); ta.current?.focus(); return; }
    drafts.set(cardId, words);
    onSent(words);
  };
  return (
    <div className="tm-rb tm-wa-rb" role="group" aria-label={`Reply to ${who} on WhatsApp`} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      {last && <blockquote className="tm-rb-last"><b>{who} wrote</b>{firstSentences(last, 12)}</blockquote>}
      {quick.length > 0 && (
        <div className="tm-wa-quick" role="group" aria-label="Quick replies">
          {quick.map((r) => <button key={r.id} type="button" className="tm-mail-done tm-wa-q" title={fillPlaceholders(r.text, fill)} onClick={() => pick(r)}>{r.name}</button>)}
        </div>
      )}
      <textarea ref={ta} className="tm-rb-ta no-drag" value={text} rows={3} maxLength={Math.min(MESSAGE_MAX, 4096)} placeholder={`Reply to ${who}`} aria-label="Your reply"
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
      {err && <p className="tm-rb-err" role="alert">{err}</p>}
      <p className="tm-rb-note" style={{ margin: 0, fontSize: 12, opacity: 0.7 }}><WaMark size={11} /> {windowText}</p>
      <div className="tm-rb-acts">
        <button type="button" className="tm-meet-j tm-rb-send" onClick={send} title="Sends from your WhatsApp number after a short Undo">Send</button>
        <button type="button" className="tm-mail-done" onClick={() => { drafts.set(cardId, textRef.current); onClose(); }} title="Closes the box. Your words stay for next time.">Cancel</button>
      </div>
    </div>
  );
}
export { responsesFor };
