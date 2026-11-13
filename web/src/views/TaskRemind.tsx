// Reminders ON tasks (V1.55, the developer 12 Nov 2026): "if I right click on the task or click edit on the task I can add an
// annoying 15 minute reminder and when I click on the settings for it it will pop up with the 15 minute reminder display
// where I can then customize the reminder for the task and I can have a task recurring every day etc."
// - Add annoying reminder (the right click menu, the task's edit, the bell) opens this pop-up: the same reminder display
//   as Settings > Annoying 15 min reminder, filled in for the task (its name on the pop-up, once today from the next
//   whole hour, Done in one click). Nothing is saved until Add reminder; Cancel or Esc leaves no trace.
// - Once it has one, the same pop-up changes it as you go (like Settings), and Remove reminder takes it away.
// - Repeat: once on a day, every day, weekdays or chosen days. On a one-off task a repeating reminder offers
//   "Make it an Every day task too".
// - The bell on the task row: the next time on hover, a click opens this pop-up.
// The rules are in core/remind.ts; the pop-ups and notifications come from the shells like every other reminder.
// Esc closes it (one layer: a Test showing ends first). Motion: transform and opacity only, none with Reduce motion.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Doc, Todo } from "../core/model";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { isRedAccount } from "../core/account";
import { remindRec } from "../core/select";
import { saveRemind } from "../core/actions";
import { DEVICE_TZ } from "../core/tz";
import {
  REM_TASK_MAX, addTaskReminder, cleanReminder, freshId, newTaskReminder, nextWords, onTasksOf, patchReminder, pillOf, remindOrDefault,
  reminderOfTask, removeReminder, repeatOf, type Reminder,
} from "../core/remind";
import { RemEditor, RemTestCard } from "./RemindSettings";
import { stopTest, useRemSound } from "../remsound";
import { taskMapActions } from "./TaskMap";
import "./remind.css";

type Open = { task: string; root: Element | null; key: number };
let open: Open | null = null;
const subs = new Set<() => void>();
const setOpen = (o: Open | null) => { open = o; subs.forEach((f) => f()); };
const useOpen = () => useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => open);

/** Opens the reminder pop-up for a task. `from`: the element clicked (so only that list's host shows it). */
export function openTaskRemind(task: string, from?: Element | null) {
  sfx.click();
  // A click inside a list: that list. One floating on the page (the Overdue card's edit): the only list there is.
  const lists = document.querySelectorAll(".tm-overlay");
  const root = from ? (from.closest(".tm-overlay") ?? (from.closest(".tm-ctx-ed") && lists.length === 1 ? lists[0] : null)) : null;
  setOpen({ task, root, key: Date.now() });
}
export const closeTaskRemind = () => { if (open) setOpen(null); };

/** The menu's words: "Add annoying reminder", or "Reminder settings" once the task has one. */
export function useTaskReminder(task: string): Reminder | null {
  const s = useVault();
  return s.status === "unlocked" ? reminderOfTask(remindRec(s), task) : null;
}
export function reminderWords(has: boolean) { return has ? "Reminder settings" : "Add annoying reminder"; }

/** One per list, next to the task menu (views/TaskMenu.tsx TaskMenuHost); only the one the click came from shows. */
export function TaskRemindHost() {
  const o = useOpen();
  const probe = useRef<HTMLSpanElement>(null);
  const mine = !!o && !!probe.current && probe.current.closest(".tm-overlay") === o.root;
  return <><span ref={probe} hidden />{mine && o && <Pop key={o.key} task={o.task} />}</>;
}

function Pop({ task }: { task: string }) {
  const s = useVault();
  const red = isRedAccount(s);
  const ready = s.status === "unlocked";
  const d = s.docs.get(task) as Doc<Todo> | undefined;
  const t = d?.kind === "todo" ? d.data : undefined;
  const saved = ready ? reminderOfTask(remindRec(s), task) : null;
  // A new one is a draft here until Add reminder (its own id, so a sound picked for it stays with it).
  const [draft, setDraft] = useState<Reminder | null>(() => (saved ? null : newTaskReminder(freshId(remindOrDefault(remindRec(s), red)), task, Date.now(), DEVICE_TZ)));
  const [everyDay, setEveryDay] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sure, setSure] = useState(false);
  const full = ready && onTasksOf(remindOrDefault(remindRec(s), red)).length >= REM_TASK_MAX;
  const r = saved ?? draft;
  const snd = useRemSound();
  const close = () => { if (closing) return; setClosing(true); stopTest(); window.setTimeout(closeTaskRemind, 170); };
  // Esc: a Test showing ends first (its own listener is newer), then this pop-up closes. Nothing behind it sees the key.
  const testing = useRef(false);
  testing.current = !!snd.testing;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (testing.current) { stopTest(); return; }
      closeRef.current();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
  useEffect(() => { if (sure) { const x = window.setTimeout(() => setSure(false), 4000); return () => clearTimeout(x); } }, [sure]);
  // The task went (deleted on another device): nothing left to set.
  useEffect(() => { if (ready && !t) close(); }, [ready, t]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t || !r) return null;

  const change = (fn: (rec: ReturnType<typeof remindOrDefault>) => ReturnType<typeof remindOrDefault>) => {
    void saveRemind((cur) => fn(remindOrDefault(cur, red))).catch(() => {});
  };
  const set = (patch: Partial<Reminder>) => {
    if (saved) change((x) => patchReminder(x, saved.id, patch, Date.now()));
    else setDraft((x) => (x ? cleanReminder({ ...x, ...patch }, Date.now()) ?? x : x));
  };
  const once = t.type === "once";
  const repeats = repeatOf(r) !== "once";
  const makeDaily = () => void taskMapActions.update(task, { type: "daily", repeat: null, due: null, p1: false });
  const add = () => {
    if (!draft || full) return;
    sfx.done();
    const now = Date.now();
    change((x) => addTaskReminder(x, { ...draft, edited: now }, now));
    if (everyDay && once && repeats) makeDaily();
    close();
  };
  const remove = () => {
    if (!saved) return;
    sfx.click(); stopTest();
    change((x) => removeReminder(x, saved.id, Date.now()));
    close();
  };
  const whenExtra = once && repeats ? (
    <label className="rm-check">
      <input type="checkbox" checked={saved ? false : everyDay} disabled={!ready}
        onChange={(e) => { sfx.hover(); if (saved) { if (e.target.checked) makeDaily(); } else setEveryDay(e.target.checked); }} />
      <span><b>Make it an Every day task too</b>Done ticks the task. A one-off task leaves with its reminder once ticked, so a repeating reminder keeps coming back only on an Every day task.</span>
    </label>
  ) : !once ? <p className="rm-note">This is an Every day task: Done ticks it for today, and the reminder comes back next time.</p> : null;

  return createPortal(
    <div className={`trm-layer${closing ? " out" : ""}`} onPointerDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) close(); }}
      onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <div className="trm-pop" role="dialog" aria-modal="true" aria-label={`Reminder on ${t.title}`} style={{ "--rm-acc": r.accent } as CSSProperties}>
        <header className="trm-head">
          <span className="trm-bell" aria-hidden="true"><BellIcon /></span>
          <span className="trm-t">
            <small>{saved ? "Reminder on this task" : "Add an annoying reminder"}</small>
            <b>{t.title}</b>
          </span>
          {saved && (
            <button type="button" className={`rm-switch${saved.on ? " on" : ""}`} role="switch" aria-checked={saved.on} aria-label={`${pillOf(saved)} on or off`}
              onClick={() => { sfx.hover(); set({ on: !saved.on }); }}><i /></button>
          )}
          <button type="button" className="trm-x" onClick={close} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <p className="trm-intro">
          A pop-up on your Mac and a notification on your phone that keeps coming back until you answer, with this task's name on it.
          {saved ? ` ${nextWords(saved, remindRec(s)?.state[saved.id], Date.now(), DEVICE_TZ, t.done)}.` : ""}
        </p>
        <div className="trm-body">
          <RemEditor r={r} red={red} set={set} ready={ready} taskTitle={t.title} whenExtra={whenExtra} />
        </div>
        <footer className="trm-foot">
          {saved
            ? <>
                {!sure
                  ? <button type="button" className="rm-small danger" onClick={() => { sfx.hover(); setSure(true); }}>Remove reminder</button>
                  : <button type="button" className="rm-small danger sure" onClick={remove}>Sure? Remove it</button>}
                <span className="rm-grow" />
                <span className="rm-soft">Changes save as you go.</span>
                <button type="button" className="trm-go" onClick={() => { sfx.click(); close(); }}>Done</button>
              </>
            : <>
                <span className="rm-soft">{full ? `${REM_TASK_MAX} reminders on tasks is the most.` : !ready ? "Sign in to add a reminder." : "Esc or Cancel leaves the task as it is."}</span>
                <span className="rm-grow" />
                <button type="button" className="rm-small" onClick={() => { sfx.hover(); close(); }}>Cancel</button>
                <button type="button" className="trm-go" disabled={!ready || full} onClick={add}>Add reminder</button>
              </>}
        </footer>
      </div>
      <RemTestCard />
    </div>,
    document.body,
  );
}

function BellIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** The bell on a task that has a reminder: the next time on hover, a click opens the pop-up. Nothing when it has none. */
export function TaskBell({ task, done }: { task: string; done?: boolean }) {
  const s = useVault();
  const r = s.status === "unlocked" ? reminderOfTask(remindRec(s), task) : null;
  // The words follow the clock (a minute is plenty for "Next: Today, 14:00").
  const [, tick] = useState(0);
  useEffect(() => { if (!r) return; const x = window.setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(x); }, [r]);
  if (!r) return null;
  const words = nextWords(r, remindRec(s)?.state[r.id], Date.now(), DEVICE_TZ, done);
  const live = words === "Reminding you now";
  return (
    <button type="button" className={`tm-bell no-drag${r.on ? "" : " off"}${live ? " live" : ""}`} style={{ "--rm-acc": r.accent } as CSSProperties}
      data-tip={words} aria-label={`Reminder: ${words}. Open its settings`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); openTaskRemind(task, e.currentTarget); }}>
      <BellIcon size={14} />
    </button>
  );
}
