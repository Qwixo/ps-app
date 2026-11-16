// Sleep mode's own settings, full screen (V1.47). The developer, 10 Nov 2026: "Simplify the settings menu in the Sleep button.
// It's very confusing to navigate. Add a dedicated settings menu to the Sleep button. Also in the main Settings, add a
// tab called Sleep mode. Like the Security settings ... it brings you to the actual Sleep settings, which open full
// screen. Redesign it to be very simple, the same way the general Settings were redesigned."
// Laid out like Settings (views/SettingsScreen.tsx, the same styles): a search bar, a short list of groups (a side
// menu on a Mac or the website, a list to tap into on a phone or a narrow window), each group a simple page of rows, a
// name and one plain line for every setting, rarely used ones under "More", and a live preview of the sleep screen on
// the pages that change it. The groups, rows, lines and words are core/sleepsettings.ts.
// Opened by the Sleep button's pencil (or a right click on it), and from Settings, Sleep mode (whose search lands on
// one setting here, lit up). Esc and Back step out one layer at a time: a preview or warning first, then the search,
// then a page (narrow), then the screen.
import { SentryRestartSleepSetting, SentrySleepAutoSetting } from "./Sentry";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./macsettings.css";
import "./moresettings.css";
import "./settingsscreen.css";
import "./sleepmode.css";
import { psPost } from "../ps";
import { GOS, MWEB } from "../gos/bridge";
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { LOOK_DEF, PANEL_MAX, PANEL_MIN, inkHex, sleepModeOf } from "../core/sleepmode";
import { SLEEP_GROUPS, searchSleep, sleepEntry, sleepGroup, sleepRowsOf, type SleepEntry, type SleepGroupId } from "../core/sleepsettings";
import { WHERE, goToSleep, openSleep, sleepState, useSleepMode } from "../sleepmode/engine";
import { morph } from "./DimensionX";
import { PinnedPreview } from "../ui/PinnedPreview";
import { LookPiece, SleepPreview, useDraftLook, type LookKey } from "./SleepCustomise";
import { AlarmLoudness, OwnSoundRow, PlaylistSettings, StrobeSwitch, SunrisePick, WakeStyleList, WaveColour, wakeDeviceLine, wakeOverlayUp } from "./SleepWake";
import { AlarmList, WakeInSettings, savePrefs, sleepDeviceNote } from "./SleepMode";
import { askFitness } from "../fitness/fitask";

// ---------- open or closed, and a setting to land on ----------
type Want = { jump: string | null; n: number };
let want: Want | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** Opens Sleep mode's settings (on one setting, lit up, when `jump` is its id in core/sleepsettings.ts). */
export function openSleepSettings(jump: string | null = null) { want = { jump: jump && sleepEntry(jump) ? jump : null, n: Date.now() }; emit(); }
export function closeSleepSettings() { if (want) { want = null; emit(); } }
const useWant = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => want);
/** True while it is open (other layers leave Esc to it). */
export const sleepSettingsOpen = () => want !== null;
export const useSleepSettingsOpen = () => useWant() !== null;

/** Narrow: the phone, or a window too small for a side menu. */
function useNarrow() {
  const phone = GOS || MWEB;
  const q = "(max-width: 720px)";
  const [n, setN] = useState(() => phone || (typeof matchMedia === "function" && matchMedia(q).matches));
  useEffect(() => {
    if (phone || typeof matchMedia !== "function") return;
    const m = matchMedia(q);
    const f = () => setN(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [phone]);
  return n;
}
const MORPH = { body: ".cs-content", tint: ".cs-morph" };
const FLASH_MS = 2200;
/** The pages that change the sleep screen show a live preview of it at the top. */
const PREVIEW_ON: SleepGroupId[] = ["clock", "screen", "watch"];

function GroupIcon({ id, size = 18 }: { id: SleepGroupId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={sleepGroup(id).icon} />
    </svg>
  );
}

/** Mounted once (views/SleepMode.tsx SleepHost, in the Tab list). */
export function SleepSettingsHost() {
  const w = useWant();
  // The gear on the Mac's or phone's clock (sleepmode/engine.ts sends this once the Tab list is up).
  useEffect(() => { const f = () => openSleepSettings(); window.addEventListener("ps-sleep-settings", f); return () => window.removeEventListener("ps-sleep-settings", f); }, []);
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  useEffect(() => {
    if (w && phase !== "open") setPhase("open");
    else if (!w && phase === "open") setPhase("closing");
  }, [w]); // eslint-disable-line react-hooks/exhaustive-deps
  if (phase === "closed") return null;
  return <SleepSettingsScreen want={w} closing={phase === "closing"} onGone={() => setPhase((p) => (p === "closing" ? "closed" : p))} />;
}

function SleepSettingsScreen({ want: w, closing, onGone }: { want: Want | null; closing: boolean; onGone: () => void }) {
  const p = sleepModeOf(settingsData(useVault()));
  const [look, change, flush] = useDraftLook();
  const narrow = useNarrow();
  const [group, setGroup] = useState<SleepGroupId>("alarms");
  const [inside, setInside] = useState(!narrow);
  const [q, setQ] = useState("");
  const [more, setMore] = useState<Set<SleepGroupId>>(() => new Set());
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const win = useRef<HTMLElement>(null), dim = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), scroll = useRef<HTMLDivElement>(null);
  // Over the web sleep screen (its gear): on the page body, above that screen.
  const [overSleep] = useState(() => WHERE === "web" && sleepState().here);
  const [host] = useState<HTMLElement>(() => (overSleep ? null : document.querySelector<HTMLElement>(".tm-overlay:not(.tm-docked)")) ?? document.body);
  // Opened from the Mac's or phone's clock (its gear): the sleep is still open, so "Back to sleep" goes straight back.
  const sm = useSleepMode();
  const o = openSleep();
  const backToSleep = WHERE !== "web" && !sm.here && !!o && !o.woke && Date.now() - Date.parse(o.at) < 20 * 3600_000;
  const pen = () => [...document.querySelectorAll<HTMLElement>(".slp-pen")].find((b) => b.offsetParent !== null) ?? null;

  // Land on one setting: its page, its More, scrolled to and lit up.
  const land = (id: string) => {
    const e = sleepEntry(id);
    if (!e) return;
    setQ(""); setGroup(e.group); setInside(true);
    if (e.more) setMore((m) => new Set(m).add(e.group));
    setFlash({ id: e.id, n: Date.now() });
  };
  useEffect(() => { if (w?.jump) land(w.jump); }, [w?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { flush(); sfx.drop(); closeSleepSettings(); };
  useLayoutEffect(() => {
    if (!closing) {
      if (WHERE === "mac") psPost({ type: "dimx", open: true });   // PS pins the list and gives it the keyboard (Esc comes back here)
      void morph(win.current, pen(), dim.current, "in", MORPH);
      if (!narrow) window.setTimeout(() => search.current?.focus({ preventScroll: true }), 60);
    } else {
      if (WHERE === "mac") psPost({ type: "dimx", open: false });
      void morph(win.current, pen(), dim.current, "out", MORPH).then(onGone);
    }
  }, [closing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back, one step: the search, a page (narrow), then the screen. A preview, the strobe warning or a Test over it
  // takes Esc first (one Esc, one layer).
  const back = (fromEsc: boolean) => {
    if (fromEsc && q) { setQ(""); return; }
    if (narrow && inside) { sfx.hover(); setInside(false); scroll.current?.scrollTo({ top: 0 }); return; }
    close();
  };
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    if (closing) return;
    const busy = () => wakeOverlayUp() || sleepState().customising;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy()) return;
      e.preventDefault(); e.stopImmediatePropagation(); backRef.current(true);
    };
    const escape = () => {
      if (busy()) window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      else backRef.current(true);
      return true;
    };
    const g = window as Window & { __psDimxClose?: () => boolean };
    window.addEventListener("keydown", key, true);
    if (WHERE === "mac") g.__psDimxClose = escape;
    return () => { window.removeEventListener("keydown", key, true); if (g.__psDimxClose === escape) delete g.__psDimxClose; };
  }, [closing]);
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => {
      const el = win.current?.querySelector<HTMLElement>(`[data-sset="${CSS.escape(flash.id)}"]`);
      const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }, 60);
    const off = window.setTimeout(() => setFlash((f) => (f && f.n === flash.n ? null : f)), FLASH_MS);
    return () => { window.clearTimeout(t); window.clearTimeout(off); };
  }, [flash, group]);
  useLayoutEffect(() => { if (!flash) scroll.current?.scrollTo({ top: 0 }); }, [group, inside]); // eslint-disable-line react-hooks/exhaustive-deps

  const hits = useMemo(() => (q.trim() ? searchSleep(q, WHERE) : []), [q]);
  const searching = q.trim().length > 0;
  const showList = narrow && !inside && !searching;
  const pick = (id: SleepGroupId) => { sfx.hover(); setQ(""); setFlash(null); setGroup(id); setInside(true); };
  const title = narrow && inside && !searching ? sleepGroup(group).label : "Sleep mode";
  const ctl = { p, look, change };
  const rows = sleepRowsOf(group, WHERE);
  const page = (<>
    <Rows list={rows.main} ctl={ctl} flash={flash} onGo={close} />
    {rows.more.length > 0 && (
      <div className={`gs-more${more.has(group) ? " open" : ""}`}>
        <button type="button" className="gs-more-b" aria-expanded={more.has(group)}
          onClick={() => { sfx.hover(); setMore((m) => { const n = new Set(m); if (n.has(group)) n.delete(group); else n.add(group); return n; }); }}>
          <span>More</span><em>{rows.more.length}</em>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {more.has(group) && <Rows list={rows.more} ctl={ctl} flash={flash} onGo={close} />}
      </div>
    )}
  </>);

  return createPortal(
    <div className={`dx-layer cs-layer ms-layer gs-layer sls-layer${host === document.body ? " docked" : ""}${overSleep ? " over-sleep" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
      <div ref={dim} className="cs-dim" onMouseDown={() => { if (!wakeOverlayUp()) close(); }} aria-hidden="true" />
      <section ref={win} className={`cs-win gs-win sls-win${narrow ? " gs-narrow" : ""}`} role="dialog" aria-modal="true" aria-label="Sleep mode settings" data-group={group}>
        <div className="cs-morph" aria-hidden="true" />
        <div className="cs-glow" aria-hidden="true" />
        <div className="cs-content">
          <header className="cs-head gs-head">
            <button type="button" className="cs-min gs-back" onClick={() => back(false)}
              aria-label={narrow && inside && !searching ? "Back to all Sleep settings" : "Close Sleep settings"}
              title={narrow && inside && !searching ? "Back to all Sleep settings (Esc)" : "Close (Esc)"}>
              {narrow && inside && !searching
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>}
            </button>
            <div className="cs-title"><h2>{title}</h2></div>
            {backToSleep && <button type="button" className="tm-pill-btn sls-back" onClick={() => { flush(); sfx.drop(); closeSleepSettings(); window.setTimeout(() => void goToSleep(), 400); }}>Back to sleep</button>}
            {(!narrow || !inside || searching) && (
              <label className="gs-search">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
                <input ref={search} type="search" value={q} placeholder="Search Sleep settings" aria-label="Search Sleep settings" spellCheck={false} autoComplete="off" enterKeyHint="go"
                  onChange={(e) => { setQ(e.target.value); setFlash(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); sfx.click(); land(hits[0].id); } }} />
                {q && <button type="button" className="gs-search-x" onClick={() => { setQ(""); search.current?.focus(); }} aria-label="Clear the search" data-tip="">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>}
              </label>
            )}
          </header>
          <div className="gs-main">
            {!narrow && (
              <nav className="gs-nav" aria-label="Sleep settings sections">
                {SLEEP_GROUPS.map((x) => (
                  <button key={x.id} type="button" className={`gs-nav-i${!searching && x.id === group ? " on" : ""}`} aria-current={!searching && x.id === group ? "page" : undefined}
                    onClick={() => pick(x.id)}>
                    <GroupIcon id={x.id} /><span>{x.label}</span>
                  </button>
                ))}
              </nav>
            )}
            <div ref={scroll} className="cs-scroll gs-scroll">
              {searching ? (
                hits.length ? (
                  <div className="gs-view gs-hits" role="list" aria-label={`${hits.length} matching Sleep settings`}>
                    {hits.map((e) => (
                      <button key={e.id} type="button" role="listitem" className="gs-hit" onClick={() => { sfx.click(); land(e.id); }}>
                        <span className="gs-hit-ic"><GroupIcon id={e.group} /></span>
                        <span className="gs-hit-t"><b>{e.name}</b><em>{e.line}</em></span>
                        <span className="gs-hit-g">{sleepGroup(e.group).label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="gs-view gs-none" role="status"><b>Nothing called "{q.trim()}"</b><span>Try another word, like alarm, font, sunrise or Touch ID.</span></div>
                )
              ) : showList ? (
                <div className="gs-home" role="list" aria-label="Sleep settings sections">
                  {SLEEP_GROUPS.map((x) => (
                    <button key={x.id} type="button" role="listitem" className="gs-home-i" onClick={() => pick(x.id)}>
                      <span className="gs-home-ic"><GroupIcon id={x.id} size={20} /></span>
                      <span className="gs-home-t"><b>{x.label}</b><em>{x.line}</em></span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                  ))}
                </div>
              ) : (
                <div key={group} className={`gs-view gs-pg gs-grp sls-grp sls-grp-${group}`} role="group" aria-label={sleepGroup(group).label}>
                  {!narrow && (
                    <div className="gs-grp-h">
                      <span className="gs-grp-ic"><GroupIcon id={group} size={22} /></span>
                      <div><h3>{sleepGroup(group).label}</h3><p>{sleepGroup(group).line}</p></div>
                    </div>
                  )}
                  {PREVIEW_ON.includes(group)
                    ? <PinnedPreview id="sleep-screen" label="Preview" preview={<SleepPreview look={look} />}>{page}</PinnedPreview>
                    : <div className="sls-rows">{page}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>, host);
}

type Ctl = { p: ReturnType<typeof sleepModeOf>; look: ReturnType<typeof useDraftLook>[0]; change: ReturnType<typeof useDraftLook>[1] };
function Rows({ list, ctl, flash, onGo }: { list: SleepEntry[]; ctl: Ctl; flash: { id: string; n: number } | null; onGo: () => void }) {
  return (
    <div className="gs-rows">
      {list.map((e) => {
        const c = control(e.id, ctl, onGo);
        const lit = flash?.id === e.id;
        return (
          <div key={lit ? `${e.id}-${flash!.n}` : e.id} className={`gs-set sls-set${c.body ? " has-body" : ""}${lit ? " gs-flash" : ""}`} data-sset={e.id}>
            <div className="gs-set-row">
              <div className="gs-set-t"><b>{e.name}</b><span>{c.line ?? e.line}</span></div>
              {c.right !== undefined && <div className="gs-set-c">{c.right}</div>}
            </div>
            {c.body && <div className="gs-set-body sls-body">{c.body}</div>}
          </div>
        );
      })}
    </div>
  );
}

const seg = <T extends string | boolean>(label: string, value: T, opts: [T, string][], set: (v: T) => void) => (
  <div className="tm-ed-seg slp-seg" role="radiogroup" aria-label={label}>
    {opts.map(([v, name]) => (
      <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`dwell${value === v ? " on" : ""}`}
        onClick={() => { if (value !== v) { sfx.hover(); set(v); } }}>{name}</button>
    ))}
  </div>
);
const LOOK_BODY: Partial<Record<string, LookKey>> = { face: "face", size: "size", font: "font", colour: "colour", text: "text", bright: "bright", bg: "bg", weight: "weight", spacing: "spacing", pieces: "pieces", sentry: "sentry" };
const LOOK_RIGHT: Partial<Record<string, LookKey>> = { hours: "hours", pos: "pos", watch: "watch", pointer: "pointer" };

/** Each setting's control: on the right of its row (small ones), or below it (bigger ones). `line` replaces the
 *  row's line when it says what the current choice does. */
function control(id: string, { p, look, change }: Ctl, onGo: () => void): { right?: ReactNode; body?: ReactNode; line?: string } {
  const lb = LOOK_BODY[id], lr = LOOK_RIGHT[id];
  if (lb) return { body: <LookPiece k={lb} look={look} change={change} /> };
  if (lr) return { right: <LookPiece k={lr} look={look} change={change} /> };
  const wake = p.wake, setWake = (w: typeof p.wake) => savePrefs(p, { wake: w });
  switch (id) {
    case "reset": return { right: <button type="button" className="tm-pill-btn" onClick={() => { sfx.click(); change(LOOK_DEF); }}>Back to the usual look</button> };
    // V1.52 (the developer): the same synced value as Settings, Sentry mode (core/sentry.ts restartSleepH).
    case "sentry-auto": return { right: <SentrySleepAutoSetting /> };
    case "sentry-restart": return { body: <SentryRestartSleepSetting /> };
    case "alarms": return { body: <AlarmList p={p} /> };
    case "ring-always": return {
      right: seg("Alarms ring even when Sleep mode is off", p.ringAlways, [[true, "On"], [false, "Off"]], (v) => savePrefs(p, { ringAlways: v })),
      line: p.ringAlways ? "On: your alarms ring at their time on your Mac and phone, whether or not you pressed Sleep. Stop ends it." : "Off: alarms ring only while Sleep mode is on.",
    };
    case "wake-in": return { body: <WakeInSettings p={p} /> };
    // The alarm sound: V1.47 alarm playlists and libraries put their picker here.
    case "sound": return { body: <div className="sls-sound"><OwnSoundRow wake={wake} /><PlaylistSettings wake={wake} set={setWake} where={WHERE} /></div> };
    case "loudness": return { body: <AlarmLoudness wake={wake} set={setWake} where={WHERE} /> };
    case "styles": return { body: <div className="slp-ws"><WakeStyleList wake={wake} set={setWake} ink={inkHex(p.look.color)} /><p className="gs-set-note">{wakeDeviceLine(WHERE)}</p></div> };
    case "sunrise": return { right: <SunrisePick wake={wake} set={setWake} /> };
    case "wave": return { body: <WaveColour wake={wake} set={setWake} /> };
    case "strobe": return { right: <StrobeSwitch wake={wake} set={setWake} /> };
    case "details": return {
      right: seg("What the screen shows", !p.details, [[true, "Counts only"], [false, "Full details"]], (v) => savePrefs(p, { details: !v })),
      line: p.details ? "Full details: your task titles show on the sleep screen, where anyone near it can read them." : "Counts only: \"5 tasks for today\", never a task title, a client's name or a message.",
    };
    case "panel": return {
      right: <span className="slp-panel">
        <input type="number" min={PANEL_MIN} max={PANEL_MAX} step={5} value={p.panel} aria-label="Minutes before your wake time"
          onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) savePrefs(p, { panel: Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(n))) }); }} />
        <span>min</span>
      </span>,
    };
    case "lock": return {
      right: seg("Ask for Touch ID to leave Sleep mode", p.lock, [[true, "On"], [false, "Off"]], (v) => savePrefs(p, { lock: v })),
      line: p.lock ? "On: Wake up and Customise ask for Touch ID or your password (a phone: its own unlock)." : "Off: Wake up and Customise leave at once.",
    };
    case "ask": return { right: seg("After Wake up", p.ask, [[true, "Ask before logging"], [false, "Log straight away"]], (v) => savePrefs(p, { ask: v })) };
    case "goal": return { right: <button type="button" className="gs-open" onClick={() => { sfx.click(); onGo(); window.setTimeout(() => askFitness("settings", { docked: !document.querySelector(".tm-overlay:not(.tm-docked)"), phone: GOS || MWEB }), 170); }}>
      Open Fitness<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></button> };
    case "button": return {
      right: seg("Sleep button", p.show, [[true, "Show"], [false, "Hide"]], (v) => savePrefs(p, { show: v })),
      line: p.show ? "Shown in your list. Hide it and Sleep mode is off on every device." : "Hidden: Sleep mode is off on every device. These settings stay in Settings, Sleep mode.",
    };
    case "here": return { body: <p className="gs-set-note">{sleepDeviceNote()}</p> };
    default: return {};
  }
}
