// The website's To-do page in web form (V1.44, the developer 8 Nov 2026: "Basically copy the exact thing over, just take out the
// parts to do with the Tab overlay. The same design as the Tab overlay but in web app form. Something that doesn't
// require all the permissions."). It IS the Tab list (views/TaskMap.tsx Overlay, `docked web`): the same list,
// priorities, Completed with Resurrect, Coming up, Timelines, G Squad, Fitness, Dimension X, Goals, Time zones, Sleep
// mode, Settings with search, hover cards, looks and backgrounds, filling the browser window under the site's bar.
// What needs PS on a Mac is left out (core/webtodo.ts WEB_HIDDEN), with one quiet "Get the Mac app" note at the end.
// Esc steps back one window at a time (ui/escape.ts, started for the website in escstart.ts) and so does the
// browser's Back button (ui/webback.ts).
import { useEffect, useState } from "react";
import { Overlay } from "./TaskMap";
import { MWEB } from "../gos/bridge";
import { startWebSquad } from "../squad/webhost";
import { startWebBack } from "../ui/webback";
import { MAC_NOTE, macNoteShown } from "../core/webtodo";
import { sfx } from "../ui/sfx";
import "./webtodo.css";

const NOTE_KEY = "ps.web.macNoteAt";
function readAt(): number | null { try { const v = localStorage.getItem(NOTE_KEY); return v ? Number(v) : null; } catch { return null; } }
function writeAt(v: number) { try { localStorage.setItem(NOTE_KEY, String(v)); } catch { /* private window */ } }

/** One quiet line at the end of the list: what the Mac app adds, and where to get it. Its x hides it for a month. */
function MacNote() {
  const [shown, setShown] = useState(() => macNoteShown(readAt(), Date.now()));
  const [leaving, setLeaving] = useState(false);
  if (!shown) return null;
  const hide = () => { sfx.click(); writeAt(Date.now()); setLeaving(true); window.setTimeout(() => setShown(false), 260); };
  return (
    <aside className={`wt-mac${leaving ? " out" : ""}`} aria-label={MAC_NOTE.title}>
      <svg className="wt-mac-i" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />
      </svg>
      <span className="wt-mac-t">{MAC_NOTE.line}</span>
      <a className="wt-mac-a" href={MAC_NOTE.link} target="_blank" rel="noopener noreferrer" data-tip={MAC_NOTE.title} data-tip-line="Opens the download page in a new tab">{MAC_NOTE.title}</a>
      <button type="button" className="wt-mac-x" onClick={hide} aria-label="Hide this note" data-tip="Hide" data-tip-line="Hides this note for a month">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </aside>
  );
}

export function WebTodoView() {
  useEffect(() => { startWebSquad(MWEB); }, []);
  useEffect(() => startWebBack(), []);
  // The page itself never scrolls behind the list: the list scrolls in its own layer, as in PS (webtodo.css).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("web-todo");
    return () => root.classList.remove("web-todo");
  }, []);
  return <Overlay docked web onClose={() => {}} footer={<MacNote />} />;
}
