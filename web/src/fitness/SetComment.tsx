// PS Fitness V1.59 (the developer: "after a set is done I can add a comment, like 'left knee felt off' or 'seat at 4'").
// A small comment button on a done set, a short text box under the set, the comment shown under the set in the
// gym and in History. The comment is a field of the set, so it is saved, synced and sealed with the workout
// (core/fitness.ts setComment). Esc and the phone's Back close the box and keep what was typed.
import { useEffect, useRef, useState } from "react";
import { COMMENT_MAX, cleanComment } from "../core/fitness";
import { haptic } from "../gos/bridge";
import { setNote } from "./store";

export const BubbleIcon = ({ size = 22, filled }: { size?: number; filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5V17H4.5A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5z" />
    {!filled && <path d="M7.5 10h9M7.5 13h5.5" />}
  </svg>
);

/** The small round button on a done set: an outline bubble when empty, a filled one when it has a comment. */
export function CommentBtn({ n, has, open, onClick }: { n: number; has: boolean; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`fg-cmt-btn${has ? " has" : ""}${open ? " open" : ""}`} aria-expanded={open}
      aria-label={has ? `Set ${n} comment. Tap to change` : `Add a comment to set ${n}`} onClick={onClick}>
      <BubbleIcon filled={has} />
    </button>
  );
}

/** The comment under a set. A button, so tapping it opens the box to change it. */
export function CommentLine({ text, onClick }: { text: string; onClick?: () => void }) {
  if (!onClick) return <p className="fg-cmt-line"><BubbleIcon size={15} filled /><span>{text}</span></p>;
  return <button type="button" className="fg-cmt-line" onClick={onClick} aria-label={`Comment: ${text}. Tap to change`}><BubbleIcon size={15} filled /><span>{text}</span></button>;
}

/** The short text box. Saves when the developer leaves it, presses Enter, taps Save, or closes it with Esc or Back. */
export function CommentBox({ wid, exId, setId, n, value, onClose }: { wid: string; exId: string; setId: string; n: number; value: string; onClose: () => void }) {
  const [text, setText] = useState(value);
  const [out, setOut] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const c = cleanComment(textRef.current);
    if (c !== cleanComment(value)) { haptic("tick"); void setNote(wid, exId, setId, c); }
    setOut(true);
    window.setTimeout(onClose, 160);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const el = ta.current;
    if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(el.value.length, el.value.length); el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    // Esc and the phone's Back close the box first (capture: before the screen's own handling).
    const back = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); finishRef.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopImmediatePropagation(); finishRef.current(); } };
    window.addEventListener("gos-back", back, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("gos-back", back, true); window.removeEventListener("keydown", key, true); };
  }, []);

  return (
    <div className={`fg-cmt-box${out ? " out" : ""}`} role="group" aria-label={`Comment on set ${n}`}>
      <textarea ref={ta} rows={2} maxLength={COMMENT_MAX} value={text} enterKeyHint="done" autoComplete="off"
        placeholder="A short note, e.g. left knee felt off, seat at 4" aria-label={`Comment on set ${n}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { const box = e.currentTarget.parentElement; if (!box || !box.contains(e.relatedTarget as Node | null)) finish(); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(); } }} />
      <div className="fg-cmt-row">
        <small className="f-num" aria-hidden="true">{text.length}/{COMMENT_MAX}</small>
        {value && <button type="button" className="fg-cmt-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { setText(""); textRef.current = ""; finish(); }}>Remove</button>}
        <button type="button" className="fg-cmt-save" onMouseDown={(e) => e.preventDefault()} onClick={finish}>Save</button>
      </div>
    </div>
  );
}
