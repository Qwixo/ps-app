// Tab list, right column: notes left open after a call (the 2 days after it ended). One click turns
// them into tasks on the list (and ticks them off on the meeting), or clears them. Data: the same
// meeting notes as the Meetings panel and the pop-up (core/notescard.ts leftovers).
import { useMemo } from "react";
import { settingsData, calendarSnap } from "../core/select";
import { leftovers } from "../core/notescard";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { taskMapActions } from "./TaskMap";
import "./notesleft.css";

export function NotesLeftovers() {
  const s = useVault();
  const st = settingsData(s);
  const notes = st.meetingNotes || [];
  const list = useMemo(() => leftovers(Date.now(), calendarSnap(s)?.data.events || [], notes), [s, notes]);
  if (!list.length) return null;
  const close = (key: string, ids: string[]) =>
    taskMapActions.meetingNotes({ meetingNotes: notes.map((n) => (n.key === key ? { ...n, items: n.items.map((x) => (ids.includes(x.id) ? { ...x, done: true } : x)) } : n)) });
  const makeTasks = async (l: (typeof list)[number]) => {
    sfx.done();
    for (const it of l.items) await taskMapActions.add({ title: `${it.text} (from ${l.title})`.slice(0, 500), due: null, type: "once" });
    await close(l.key, l.items.map((i) => i.id));
  };
  return (
    <section className="tm-nl" aria-label="Notes left from your calls" onMouseDown={(e) => e.stopPropagation()}>
      <span className="tm-nl-h">Left from your calls</span>
      {list.map((l) => (
        <div key={l.key} className="tm-nl-m">
          <b>{l.title}</b>
          <ul>{l.items.map((i) => <li key={i.id}>{i.text}</li>)}</ul>
          <div className="tm-nl-a">
            <button type="button" className="main" onClick={() => void makeTasks(l)}>Make {l.items.length > 1 ? `${l.items.length} tasks` : "a task"}</button>
            <button type="button" onClick={() => { sfx.click(); void close(l.key, l.items.map((i) => i.id)); }}>Clear</button>
          </div>
        </div>
      ))}
    </section>
  );
}
