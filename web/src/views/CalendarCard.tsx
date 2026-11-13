// Meetings: the developer's Google Calendar (from the calendar-inbox function), day by day, with the client
// each call is with and a join button. Read only: changes happen in Google Calendar.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CalEvent } from "../core/model";
import { calendarSnap, clientViews } from "../core/select";
import { buildMatcher } from "../core/mail";
import { Icon, toast, useVault } from "../ui/kit";
import { calRefreshIfStale, calRefreshNow } from "../calrefresh";
import { calLine, calStatus } from "../core/calstatus";
import { Chevron, Collapse } from "./Accordion";
import "./calendar.css";
import { appName } from "../core/appname";

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const startOf = (e: CalEvent) => (e.start ? new Date(e.allDay ? e.start + "T00:00:00" : e.start) : null);
const endOf = (e: CalEvent) => (e.end ? new Date(e.allDay ? e.end + "T00:00:00" : e.end) : startOf(e));
const hm = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function dayLabel(k: string, today: string, tomorrow: string) {
  if (k === today) return "Today";
  if (k === tomorrow) return "Tomorrow";
  return new Date(k + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export function CalendarCard() {
  const s = useVault();
  const snap = calendarSnap(s);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const [past, setPast] = useState(false);

  const clients = clientViews(s).filter((c) => c.client);
  const match = useMemo(() => buildMatcher(clients.map((c) => c.client!)), [clients]);
  const nameOf = new Map(clients.map((c) => [c.client!.id, c.name]));

  if (!snap) {
    return (
      <section className="panel stack cal-card" aria-labelledby="cal-h">
        <div className="cal-head"><h2 className="h2" id="cal-h">Your calendar</h2><CalRefresh at={null} /></div>
        <p className="small muted">No calendar copy yet. Press refresh, or ask Claude to send your calendar.</p>
      </section>
    );
  }

  const today = dayKey(new Date(now));
  const tomorrow = dayKey(new Date(now + 864e5));
  const horizon = now + 14 * 864e5;
  const events = snap.data.events.filter((e) => startOf(e));
  const upcoming = events.filter((e) => (endOf(e)!.getTime() > now) && startOf(e)!.getTime() < horizon);
  const earlier = events.filter((e) => endOf(e)!.getTime() <= now).reverse();
  const group = (list: CalEvent[]) => {
    const m = new Map<string, CalEvent[]>();
    for (const e of list) { const k = dayKey(startOf(e)!); if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return [...m.entries()];
  };
  const clientOf = (e: CalEvent) => {
    for (const a of e.attendees) { if (a.self) continue; const id = match(a.email); if (id) return nameOf.get(id) || null; }
    return null;
  };
  const row = (e: CalEvent) => {
    const st = startOf(e)!; const en = endOf(e)!;
    const live = st.getTime() <= now && en.getTime() > now;
    const soon = !live && st.getTime() - now < 30 * 60_000 && st.getTime() > now;
    const who = e.attendees.filter((a) => !a.self);
    const client = clientOf(e);
    return (
      <li key={e.id + (e.start || "")} className={`cal-ev${live ? " live" : ""}`}>
        <span className="cal-time num">{e.allDay ? "All day" : <>{hm(st)}<small>{hm(en)}</small></>}</span>
        <span className="cal-main">
          <span className="cal-title">{e.title}</span>
          <span className="cal-meta">
            {client && <span className="pill good">{client}</span>}
            {live && <span className="pill bad">Now</span>}
            {soon && <span className="pill amber">Starts in {Math.max(1, Math.round((st.getTime() - now) / 60_000))} min</span>}
            {who.length > 0 && <span className="small muted trunc">{who.slice(0, 3).map((a) => a.name || a.email.split("@")[0]).join(", ")}{who.length > 3 ? ` +${who.length - 3}` : ""}</span>}
            {e.place && <span className="small muted trunc">{e.place}</span>}
          </span>
        </span>
        <span className="cal-act">
          {e.link && en.getTime() > now && <a className={`btn sm ${live || soon ? "primary" : "ghost"}`} href={e.link} target="_blank" rel="noopener noreferrer"><Icon name="link" size={14} /> Join</a>}
          {e.open && <a className="btn quiet icon sm" href={e.open} target="_blank" rel="noopener noreferrer" aria-label={`Open ${e.title} in Google Calendar`}><Icon name="arrow" size={15} /></a>}
        </span>
      </li>
    );
  };

  return (
    <section className="panel stack cal-card" aria-labelledby="cal-h">
      <div className="cal-head">
        <h2 className="h2" id="cal-h">Your calendar</h2>
        <CalRefresh at={snap.data.at} />
      </div>
      {upcoming.length === 0 ? (
        <p className="small muted">Nothing on your calendar in the next 14 days.</p>
      ) : (
        <div className="cal-days">
          {group(upcoming).map(([k, list]) => (
            <div key={k} className="cal-day">
              <h3 className={`cal-day-h${k === today ? " today" : ""}`}>{dayLabel(k, today, tomorrow)} <span className="num muted">{list.length}</span></h3>
              <ul className="cal-list">{list.map(row)}</ul>
            </div>
          ))}
        </div>
      )}
      {earlier.length > 0 && (
        <>
          <button type="button" className="mb-more" aria-expanded={past} aria-controls="cal-past" onClick={() => setPast((v) => !v)}>
            {past ? "Hide earlier calls" : `Earlier, last 14 days (${earlier.length})`} <Chevron open={past} size={15} />
          </button>
          <Collapse open={past} id="cal-past" lazy>
            <div className="cal-days">
              {group(earlier).map(([k, list]) => (
                <div key={k} className="cal-day past">
                  <h3 className="cal-day-h">{dayLabel(k, today, tomorrow)}</h3>
                  <ul className="cal-list">{list.map(row)}</ul>
                </div>
              ))}
            </div>
          </Collapse>
        </>
      )}
    </section>
  );
}

/** "Updated 3 min ago" (when Google was last read) plus a refresh button that reads Google Calendar again right now
 *  (src/calrefresh.ts; the server also reads it every minute by itself). */
function CalRefresh({ at }: { at: string | null }) {
  const st = useSyncExternalStore(calStatus.subscribe, calStatus.get);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    calRefreshIfStale();   // opening Meetings reads the calendar when this device has not for a minute
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  async function go() {
    setBusy(true);
    await calRefreshNow(true);
    setBusy(false);
    setNow(Date.now());
    const r = calStatus.get();
    if (r.connected === false) toast("Google Calendar is not linked, so this is Claude's daily copy. Press Link Google in the Tab list's Meetings panel.", undefined, 8000);
    else if (r.error) toast(`${r.error}. ${appName()} tries again every minute.`, undefined, 7000);
    else toast("Calendar up to date");
  }
  const line = calLine(st, at, now);
  return (
    <span className="cal-refresh">
      <span className={`xs${line.tone === "ok" ? " muted" : ""}`} style={line.tone === "ok" ? undefined : { color: line.tone === "bad" ? "var(--bad)" : "var(--warn)" }}>{line.text}</span>
      <button type="button" className="btn quiet icon sm" onClick={() => void go()} disabled={busy || st.busy} aria-label="Refresh calendar" title="Refresh calendar">
        <span style={{ display: "inline-flex", animation: busy || st.busy ? "cv-spin 1s linear infinite" : undefined }}><Icon name="sync" size={16} /></span>
      </button>
    </span>
  );
}
