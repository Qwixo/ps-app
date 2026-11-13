// Tab list, top left: your clock and the US and London clocks, how far behind you they are, and the
// next daylight saving change (and what it does to the gap). Hover a zone and its card pops out:
// that zone's clock next to yours, the clients on its time, and (V1.36) a converter on the right:
// type "2pm", pick a day, see it in your own zone.
// One timer ticks once a second for the whole panel; the hands tick like a real clock.
// V1.39 (every account): people. Add anyone with their zone (Add on the clients card, or the person button
// at the top), rename, move or take them off (with Undo), and find anyone by name (the magnifier at the top,
// or Cmd+F / Ctrl+F while the Tab list is open): the time strip glides from your zone to theirs and their card
// shows their time and how far ahead or behind you they are (TzPeople.tsx, core/tzpeople.ts).
// V1.40 (every account): your own list of clocks. Add any zone (Add a time zone under the clocks: a city, a
// country, a zone's name or abbreviation), take any off with the small x on its clock (Undo puts it back where
// it was) and drag a clock to move it (Option+arrows on the x do the same). The list syncs as one small record
// (TzZones.tsx, core/tzzones.ts); the pill, the converter and the clock changes follow it.
// V1.43 (every account): rename any clock (the built in ones too): double click its name or the small pencil,
// type, Enter saves, Esc cancels, an empty name brings its own name back, and Reset name does the same. The new
// name shows everywhere that zone is named (the pill, the converter, the clock changes, people on that clock).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEVICE_TZ, homeLabel, homeTz, dayShift, fmtDay, fmtTime, gapLabel, isRenamed, nextChange, offsetMin, setZoneList, tagOf, wall, wallAfter, wallBefore, type Change, type Zone } from "../core/tz";
import { addDays, convertWall, daysBetween, dayTag, dragSteps, newWheel, notchesOf, parseTyped, partAt, stepTyped, todayIn, wheelStep, zoneName, zoneShort, type Hit, type Part, type Ymd } from "../core/tzconvert";
import { handAngles } from "../core/clockface";
import { eventTitle, gcalLink } from "../core/gcal";
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { AddIcon, FIND_KEY, FindBox, PersonForm, SearchIcon, peopleOf, peopleOnClock, zoneLine, type FormMode, type Found } from "./TzPeople";
import { cityOf, gapWords, zoneTitle, type TzPerson } from "../core/tzpeople";
import { changeTzZones, removeTzPerson, restoreTzPerson } from "../core/actions";
import { ZONE_NAME_MAX, addZone, defaultName, moveZone, removeZone, renameZone, resetZoneName, restoreZone } from "../core/tzzones";
import { GlobeAdd, ZoneAdd, useZones } from "./TzZones";
import { doc } from "../core/vault";
import { useInst, useInstSave, useShownHere } from "./EditMode";
import { calendarDocs, remindRec, settingsData, todos } from "../core/select";
import { FREE_LENGTHS, FREE_LEN_DEF, calendarCovers, checkFree, clashName, eventBlocks, lenShort, lenWords, taskBlocks, type Busy, type FreeLen } from "../core/tzfree";
import type { PersonEntry } from "../core/tzpeople";
import "./tz.css";
import "./tz-people.css";
import "./tz-zones.css";

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t = 0;
    // Line up with the start of each second, so every clock ticks together.
    const tick = () => { setNow(Date.now()); t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5); };
    t = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(t);
  }, []);
  return now;
}

/** Top left: a small clock pill. Hover it and the full time zone panel loops out; move away and it
 *  tucks back in (it stays open while you are typing in a converter, and while the mouse is on it).
 *  V1.57 (the developer: "make it so you can click expand and it just keeps expanded"): a click on the pill, or on the pin
 *  at the top of the panel, keeps it open until clicked again. Each Time zones panel keeps its own choice (the main
 *  one and every copy on another page), saved with the Edit mode layout so it syncs; so a page can show every time
 *  zone open all the time. Hover still peeks while it is not kept open. */
export function TimeZones({ scale, slider }: { scale: number; slider: React.ReactNode }) {
  const [hover, setOpen] = useState(false);
  const [findReq, setFindReq] = useState(0);   // Cmd+F presses since the panel opened (below)
  const inst = useInst();
  const save = useInstSave();
  const shown = useShownHere();
  // Outside a Slot (the website's To-do page, the phone) the choice lasts while the page is open.
  const [ownPin, setOwnPin] = useState(false);
  const [pinNow, setPinNow] = useState<boolean | null>(null);   // a click shows at once, before the save lands
  const savedPin = save ? !!inst?.cfg.open : ownPin;
  useEffect(() => { setPinNow(null); }, [savedPin]);
  const pinned = pinNow ?? savedPin;
  const open = hover || (pinned && shown);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const togglePin = () => {
    const next = !pinned;
    sfx.click();
    setPinNow(next);
    if (save) save({ open: next }); else setOwnPin(next);
    if (next) setOpen(true);
    else if (!inside.current) { setOpen(false); setFindReq(0); }
  };
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const inside = useRef(false);
  const enter = () => { inside.current = true; window.clearTimeout(timer.current); setOpen(true); };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (inside.current) return;   // a blur while the mouse is still on the panel
      if (box.current?.contains(document.activeElement) && document.activeElement?.matches("input:not([type=range]), select")) return;
      setOpen(false);
      if (!pinnedRef.current) setFindReq(0);   // the next hover opens the panel as usual, without the find box
    }, 260);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Cmd+F (Ctrl+F off the Mac) while the Tab list is open: the panel opens with the find box ready. Only the
  // floating list answers it (the To-do page leaves the browser's own Find alone), and never while a note or
  // another window inside the list has the keyboard. V1.57: only the panel on the page showing answers it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f") return;
      const me = box.current?.closest(".tm-overlay");
      if (!me || me.classList.contains("tm-docked") || box.current?.closest(".ed-hidden")) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && !box.current?.contains(a) && (a.isContentEditable || a.tagName === "TEXTAREA" || a.closest(".nt-win, [role='dialog']:not(.tm-overlay), .scrim, .sm-overlay"))) return;
      e.preventDefault(); e.stopPropagation();
      sfx.hover();
      window.clearTimeout(timer.current);
      setOpen(true);
      setFindReq((n) => n + 1);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  return (
    <div ref={box} className={`tm-ckdock${open ? " open" : ""}${pinned ? " pinned" : ""}`} onMouseEnter={enter} onMouseLeave={() => { inside.current = false; leave(); }}
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) leave(); }} onMouseDown={(e) => e.stopPropagation()}>
      <ClockPill pinned={pinned} onToggle={togglePin} />
      {open && <Panel scale={scale} slider={slider} findReq={findReq} pinned={pinned} onTogglePin={togglePin} />}
    </div>
  );
}

/** The pin: kept open (filled) or opens on hover only (outline). */
function PinIcon({ on }: { on: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h6l-1 6 4 4H6l4-4z" /><path d="M12 13v8" />
    </svg>
  );
}

function ClockPill({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  const now = useNow();
  // Eastern and Pacific as before while both are on your list (V1.40), else the first two clocks on it.
  const home = homeTz();
  const mine = useZones().filter((z) => z.id !== home);
  const usual = mine.filter((z) => z.id === "America/New_York" || z.id === "America/Los_Angeles");
  const two = usual.length === 2 ? usual : mine.slice(0, 2);
  return (
    <div className="tm-ckpill" role="button" tabIndex={0} aria-pressed={pinned}
      aria-label={pinned ? "Time zones, kept open. Click to let it close" : "Time zones (hover to open, click to keep it open)"}
      title={pinned ? "Kept open. Click to let it close again" : "Click to keep it open"}
      onClick={onToggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      <b className="num">{fmtTime(now, home)}</b>
      {two.length > 0 && <span>{two.map((z) => `${tagOf(z)} ${fmtTime(now, z.id)}`).join(" · ")}</span>}
      {pinned && <i className="tz-pin-on" aria-hidden="true"><PinIcon on /></i>}
    </div>
  );
}

type Spot = { p: Found; at: number };
function Panel({ scale, slider, findReq, pinned, onTogglePin }: { scale: number; slider: React.ReactNode; findReq: number; pinned: boolean; onTogglePin: () => void }) {
  const now = useNow();
  const home = homeTz();
  const mine = offsetMin(now, home);
  const s = useVault();
  const people = useMemo(() => peopleOf(s), [s]);
  const aside = useRef<HTMLElement>(null);
  // Hover a zone: a bigger card pops out to the right, that zone's clock next to yours.
  const [cmp, setCmp] = useState<{ tz: string; name: string; top: number; who?: string } | null>(null);
  const t = useRef(0);
  // The converter on the card: while the developer is typing in it the card stays put (moving the mouse off it,
  // or across another row, does not swap or close it). What he typed is kept per zone while the
  // panel is open, so hovering back finds it again.
  const typing = useRef({ focus: false, text: false });
  const onCard = useRef(false);
  const kept = useRef(new Map<string, ConvState>());
  // V1.39: find someone (the magnifier, or Cmd+F), the person they picked, and the add form at the top.
  const [finding, setFinding] = useState(findReq > 0);
  const [findKey, setFindKey] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [landed, setLanded] = useState(0);
  const [form, setForm] = useState<(FormMode & { k: number }) | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ name: string; k: number; failed?: boolean; back?: () => void } | null>(null);
  const undoT = useRef(0);
  // V1.40: your list of clocks. A change shows at once (before the save lands) and syncs as one small record.
  const stored = useZones();
  const [local, setLocal] = useState<Zone[] | null>(null);
  const pend = useRef(0);
  const list = local ?? stored;
  setZoneList(list);
  const changeList = (f: (l: Zone[]) => Zone[]) => {
    setLocal(f(list));
    pend.current++;
    return changeTzZones(f).finally(() => { if (--pend.current === 0) setLocal(null); });
  };
  const [adding, setAdding] = useState(false);
  const over = (tz: string, name: string, el: HTMLElement, who?: string) => {
    if (typing.current.focus && typing.current.text && cmp && cmp.tz !== tz) return;
    // An empty, focused box on the old card: let go of it first, so the list hears the blur.
    if (typing.current.focus && cmp && cmp.tz !== tz) (document.activeElement as HTMLElement | null)?.blur?.();
    window.clearTimeout(t.current);
    setSpot(null);
    const dock = el.closest(".tm-ckdock")?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // The card's top lines up a little above the row and only grows downwards, so it never jumps.
    setCmp({ tz, name, top: dock ? Math.max(0, r.top - dock.top - 70) : 0, who });
  };
  const out = () => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => { if (!typing.current.focus) setCmp(null); }, 220);
  };
  // A pick folds the find list away, so the rows slide up under a mouse that never moved: that is not a
  // hover, and must not swap the person's card for a zone card. A row only opens once the mouse really moves.
  const mouse = useRef({ x: -1, y: -1 });
  const dragging = useRef(false);
  const pickedAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const mv = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
    document.addEventListener("mousemove", mv, true);
    return () => document.removeEventListener("mousemove", mv, true);
  }, []);
  const rowOver = (tz: string, name: string, el: HTMLElement) => {
    if (dragging.current) return;   // a clock being dragged past is not a hover
    const p = pickedAt.current;
    if (!p) { over(tz, name, el); return; }
    const moved = (x: number, y: number) => Math.hypot(x - p.x, y - p.y) > 6;
    if (moved(mouse.current.x, mouse.current.y)) { pickedAt.current = null; over(tz, name, el); return; }
    const mv = (e: MouseEvent) => {
      if (!moved(e.clientX, e.clientY)) return;
      el.removeEventListener("mousemove", mv);
      pickedAt.current = null;
      if (el.matches(":hover")) over(tz, name, el);
    };
    el.addEventListener("mousemove", mv);
    el.addEventListener("mouseleave", () => el.removeEventListener("mousemove", mv), { once: true });
  };
  const keep = () => { onCard.current = true; window.clearTimeout(t.current); };
  const leaveCard = () => { onCard.current = false; out(); };
  // Made once: the panel redraws every second and the converter must not see new hooks each time.
  const conv = useMemo<ConvHooks>(() => ({
    kept: kept.current,
    typing: (focus, text, quiet) => {
      typing.current = { focus, text };
      // Done typing with the mouse elsewhere: tuck the card away (the same short wait as a hover out).
      if (!focus && !quiet && !onCard.current) {
        window.clearTimeout(t.current);
        t.current = window.setTimeout(() => { if (!typing.current.focus && !onCard.current) setCmp(null); }, 220);
      }
    },
    close: () => { typing.current = { focus: false, text: false }; window.clearTimeout(t.current); setCmp(null); },
  }), []);
  useEffect(() => () => { window.clearTimeout(t.current); window.clearTimeout(undoT.current); }, []);
  useEffect(() => { if (findReq) { setFinding(true); setFindKey((k) => k + 1); } }, [findReq]);
  useEffect(() => { if (!fresh) return; const x = window.setTimeout(() => setFresh(null), 2600); return () => window.clearTimeout(x); }, [fresh]);

  const closeFind = useCallback(() => { setFinding(false); setSpot(null); setLanded(0); pickedAt.current = null; }, []);
  const pick = (p: Found) => { sfx.hover(); conv.close(); setLanded(0); pickedAt.current = { ...mouse.current }; setSpot({ p, at: Date.now() }); };
  const openForm = (f: FormMode) => { sfx.click(); setForm({ ...f, k: Date.now() }); };
  // Taken off: gone at once everywhere, with Undo for a few seconds (it comes back as it was).
  const removeP = useCallback((id: string) => {
    const d = doc<TzPerson>(id);
    if (!d || d.kind !== "tzperson") return;
    sfx.click();
    const k = Date.now();
    const p = d.data;
    showUndo({ name: p.name, k, back: () => void restoreTzPerson(p).then((nid) => setFresh(nid), () => {}) });
    // Not taken off after all (locked, offline with no room): say so instead of offering an Undo that would add a second copy.
    void removeTzPerson(id).catch(() => failed(p.name, k));
  }, []);
  const showUndo = (u: { name: string; k: number; back: () => void }) => {
    window.clearTimeout(undoT.current);
    setUndo(u);
    undoT.current = window.setTimeout(() => setUndo(null), 9000);
  };
  const failed = (name: string, k: number) => {
    window.clearTimeout(undoT.current);
    setUndo({ name, k, failed: true });
    undoT.current = window.setTimeout(() => setUndo(null), 6000);
  };
  const doUndo = () => {
    if (!undo || undo.failed) return;
    sfx.click();
    window.clearTimeout(undoT.current);
    undo.back?.();
    setUndo(null);
  };
  // V1.40: a clock taken off your list (the built in ones too), with Undo putting it back where it was.
  // The next clock slides up under the mouse, its x right where the last one was: a second click that the mouse
  // never moved for is not taken as a second remove, and that clock's card waits for a real move (rowOver).
  const lastX = useRef<{ x: number; y: number; at: number } | null>(null);
  const removeZ = (id: string, byMouse: boolean) => {
    const m = mouse.current, last = lastX.current;
    if (byMouse && last && Date.now() - last.at < 900 && Math.hypot(m.x - last.x, m.y - last.y) <= 4) return;
    const r = removeZone(list, id);
    if (!r.zone) return;
    const z = r.zone, at = r.index, k = Date.now();
    lastX.current = { ...m, at: k };
    pickedAt.current = { ...m };
    sfx.click();
    conv.close();
    showUndo({ name: z.label, k, back: () => { setFresh(z.id); void changeList((l) => restoreZone(l, z, at)); } });
    void changeList((l) => removeZone(l, id).list).catch(() => failed(z.label, k));
  };
  // V1.43: a clock renamed (null: Reset name). Shows at once, syncs as the same one small record.
  const renameZ = (id: string, name: string | null) => {
    sfx.click();
    void changeList((l) => (name === null ? resetZoneName(l, id) : renameZone(l, id, name)));
  };
  // Moving a clock: Option+arrows on its x, or dragging it (below).
  const moveBy = (id: string, d: number) => {
    const ids = zones.map((z) => z.id), i = ids.indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const order = ids.filter((x) => x !== id);
    order.splice(j, 0, id);
    sfx.click();
    void changeList((l) => moveZone(l, id, order[j + 1] ?? null));
  };
  // Drag a clock up or down (the mouse; on a phone the page scrolls as usual). The others slide out of its way
  // and it drops into the gap. A press that never moves is not a drag, so hovering and clicking work as before.
  const listEl = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ id: string; dy: number; from: number; to: number; step: number } | null>(null);
  const [settle, setSettle] = useState(false);
  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest("button, input")) return;
    const rows = [...(listEl.current?.querySelectorAll<HTMLElement>("li.tm-ck[data-z]") ?? [])];
    const from = rows.findIndex((r) => r.dataset.z === id);
    if (from < 0 || rows.length < 2) return;
    const rects = rows.map((r) => r.getBoundingClientRect());
    const step = rects[1].top - rects[0].top;
    const mid = rects.map((r) => r.top + r.height / 2);
    const ids = rows.map((r) => r.dataset.z!);
    const y0 = e.clientY;
    let on = false, to = from;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0;
      if (!on) {
        if (Math.abs(dy) < 5) return;
        on = true; dragging.current = true;
        window.clearTimeout(t.current); conv.close(); sfx.hover();
      }
      ev.preventDefault();
      const c = mid[from] + dy;
      to = from;
      for (let i = 0; i < from; i++) if (c < mid[i]) { to = i; break; }
      for (let i = mid.length - 1; i > from; i--) if (c > mid[i]) { to = i; break; }
      const dyc = Math.max(rects[0].top - rects[from].top - 8, Math.min(rects[rects.length - 1].bottom - rects[from].bottom + 8, dy));
      setDrag({ id, dy: dyc, from, to, step });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!on) return;
      dragging.current = false;
      const order = ids.filter((x) => x !== id);
      order.splice(to, 0, id);
      // Dropped: the list takes the new order in the same frame the slide stops, so nothing jumps back.
      setSettle(true);
      setDrag(null);
      requestAnimationFrame(() => requestAnimationFrame(() => setSettle(false)));
      if (to !== from) { sfx.click(); void changeList((l) => moveZone(l, id, order[to + 1] ?? null)); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const shiftOf = (i: number, id: string) => {
    if (!drag) return 0;
    if (id === drag.id) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.step;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.step;
    return 0;
  };
  // Esc with the keyboard somewhere else in the panel: the form goes, then the search. The Tab list stays.
  useEffect(() => {
    if (!finding && !spot && !form && !adding) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const a = document.activeElement as HTMLElement | null;
      if (a?.matches("input, textarea, select, [contenteditable='true']")) return;   // the box answers it itself
      e.preventDefault(); e.stopImmediatePropagation();
      if (form) setForm(null); else if (adding) setAdding(false); else closeFind();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [finding, spot, form, adding, closeFind]);

  const zones = list.filter((z) => z.id !== home);
  const spotOff = spot?.p.tz && landed ? offsetMin(now, spot.p.tz) : null;
  return (
    <>
      <aside ref={aside} className="tm-clocks" style={{ ["--ck" as string]: scale / 100 }} aria-label="Time zones">
        <div className="tm-ck-head">
          <span className="tm-panel-h">Time zones</span>
          <span className="tz-head-b">
            {slider}
            <button type="button" className={`tz-hbtn tz-pinb${pinned ? " on" : ""}`} aria-pressed={pinned}
              title={pinned ? "Kept open. Click to let it close when the mouse leaves" : "Keep it open"} aria-label={pinned ? "Let Time zones close" : "Keep Time zones open"}
              onClick={onTogglePin}>
              <PinIcon on={pinned} />
            </button>
            <button type="button" className={`tz-hbtn${form?.mode === "add" ? " on" : ""}`} title="Add a person and their time zone" aria-label="Add a person"
              onClick={() => { if (form) { sfx.click(); setForm(null); } else openForm({ mode: "add", tz: home }); }}>
              <AddIcon />
            </button>
            <button type="button" className={`tz-hbtn${finding ? " on" : ""}`} title={`Find a client or person (${FIND_KEY})`} aria-label="Find a client or person" aria-expanded={finding}
              onClick={() => { sfx.click(); if (finding) closeFind(); else { setFinding(true); setFindKey((k) => k + 1); } }}>
              <SearchIcon />
            </button>
          </span>
        </div>
        {finding && (
          <FindBox key={findKey} list={people} now={now} picked={spot?.p.key ?? null} onPick={pick} onClose={() => { sfx.hover(); closeFind(); }}
            onAdd={(name) => { closeFind(); openForm({ mode: "add", tz: home, name }); }} />
        )}
        {form && (
          <PersonForm key={form.k} form={form} now={now} onDone={() => setForm(null)} onRemove={removeP} onSaved={(id) => setFresh(id)} />
        )}
        <ul ref={listEl} className={`tm-ck-list${drag ? " tz-dragging" : ""}${settle ? " tz-settle" : ""}`}>
          <ClockRow ts={now} tz={home} name="You" gap={homeLabel()} you found={spotOff === mine ? landed : 0} />
          {zones.map((z, i) => {
            const shift = dayShift(now, z.id);
            return <ClockRow key={z.id} ts={now} tz={z.id} name={z.label} active={!drag && cmp?.tz === z.id} found={spotOff !== null && spotOff !== mine && offsetMin(now, z.id) === spotOff ? landed : 0}
              gap={gapLabel(offsetMin(now, z.id) - mine) + (shift ? ` · ${shift}` : "")}
              onOver={(el) => rowOver(z.id, z.label, el)} onOut={out}
              zone={z.id} isNew={fresh === z.id} lift={drag?.id === z.id} shiftY={shiftOf(i, z.id)}
              onDown={(e) => startDrag(e, z.id)} onRemove={(byMouse) => removeZ(z.id, byMouse)} onMove={(d) => moveBy(z.id, d)}
              renamed={isRenamed(z)} ownName={defaultName(z)} onRename={(name) => renameZ(z.id, name)} onResetName={() => renameZ(z.id, null)} />;
          })}
        </ul>
        {zones.length === 0 && !adding && <p className="tz-zempty">Only your clock is here. Add a time zone to see another next to it.</p>}
        {adding ? (
          <ZoneAdd list={list} now={now} onClose={() => setAdding(false)}
            onAdd={(z) => { setFresh(z.id); void changeList((l) => addZone(l, z)); }} />
        ) : (
          <button type="button" className="tz-zadd-b" onClick={() => { sfx.click(); setAdding(true); }}>
            <GlobeAdd /> Add time zone
          </button>
        )}
        {undo && (
          <div key={undo.k} className="tz-undo" role="status">
            {undo.failed ? <span>Could not take off <b>{undo.name}</b>. Try again.</span> : (
              <>
                <span><b>{undo.name}</b> taken off</span>
                <button type="button" className="tz-btn go sm" onClick={doUndo}>Undo</button>
              </>
            )}
          </div>
        )}
        <ClockChanges now={now} mine={mine} list={zones} />
      </aside>
      {cmp && <Compare key={cmp.tz} ts={now} tz={cmp.tz} name={list.find((z) => z.id === cmp.tz)?.label ?? cmp.name} top={cmp.top} who={cmp.who} onEnter={keep} onLeave={leaveCard} conv={conv}
        people={people} fresh={fresh} onRemove={removeP} onSaved={setFresh} />}
      {spot?.p.tz && !cmp && (
        <Spotlight key={`${spot.p.key}${spot.at}`} p={spot.p} tz={spot.p.tz} ts={now} top={(aside.current?.offsetTop ?? 0) + 4}
          onLanded={() => setLanded(Date.now())} onClose={() => { sfx.hover(); setSpot(null); setLanded(0); pickedAt.current = null; }}
          onEdit={spot.p.kind === "person" ? () => { const p = spot.p; setSpot(null); setLanded(0); openForm({ mode: "edit", id: p.id, name: p.name, tz: p.tz! }); } : undefined}
          onCompare={(el) => { const p = spot.p; setSpot(null); setLanded(0); over(p.tz!, zoneTitle(p.tz!), el, p.name); }} />
      )}
    </>
  );
}

/** An analog clock face that ticks with the panel's one-second timer. */
function Face({ ts, tz, className, numbers }: { ts: number; tz: string; className: string; numbers?: boolean }) {
  const a = handAngles(ts, offsetMin(ts, tz));
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18.5" className="ck-rim" />
      {/* With numbers (the big pop-up faces): minute ticks and short hour marks out at the rim, so
          the large 1 to 12 sit clear of them. Without: the small faces' longer hour marks. */}
      {numbers && Array.from({ length: 60 }, (_, i) => i).filter((i) => i % 5).map((i) => (
        <line key={"m" + i} x1="20" y1="2.2" x2="20" y2="3.2" className="ck-mark min" transform={`rotate(${i * 6} 20 20)`} />
      ))}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => numbers
        ? <line key={i} x1="20" y1="2" x2="20" y2={i % 3 ? 4 : 4.6} className="ck-mark" transform={`rotate(${i * 30} 20 20)`} />
        : <line key={i} x1="20" y1={i % 3 ? 4.5 : 3.5} x2="20" y2={i % 3 ? 6.5 : 8} className="ck-mark" transform={`rotate(${i * 30} 20 20)`} />
      )}
      {numbers && [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n, i) => {
        const a = (i * 30 * Math.PI) / 180;
        return <text key={n} x={20 + 13.1 * Math.sin(a)} y={20 - 13.1 * Math.cos(a)} className="ck-num" textAnchor="middle" dominantBaseline="central">{n}</text>;
      })}
      {/* V1.47: the hands live in a group moved to the centre and turn around its 0,0 (core/clockface.ts says
          why: a px pivot drifts under the page zoom PS uses on a "Larger text" Mac). */}
      <g className="ck-hands" transform="translate(20 20)">
        <line x1="0" y1="0" x2="0" y2="-9.5" className="ck-h" style={{ transform: `rotate(${a.h}deg)` }} />
        <line x1="0" y1="1.5" x2="0" y2="-14" className="ck-m" style={{ transform: `rotate(${a.m}deg)` }} />
        <line x1="0" y1="3.5" x2="0" y2="-15" className="ck-s" style={{ transform: `rotate(${a.s}deg)`, transition: a.s === 0 ? "none" : undefined }} />
      </g>
      <circle cx="20" cy="20" r="1.6" className="ck-dot" />
    </svg>
  );
}

const ClockRow = memo(function ClockRow({ ts, tz, name, gap, you, active, found, onOver, onOut, zone, isNew, lift, shiftY, onDown, onRemove, onMove, renamed, ownName, onRename, onResetName }: {
  ts: number; tz: string; name: string; gap: string; you?: boolean; active?: boolean;
  /** V1.39: the person just found lives on this row's clock (the time it landed, so each find pulses again). */
  found?: number;
  onOver?: (el: HTMLElement) => void; onOut?: () => void;
  /** V1.40: a clock on your list: it can be dragged (onDown), taken off (onRemove) or moved with Option+arrows (onMove). */
  zone?: string; isNew?: boolean; lift?: boolean; shiftY?: number;
  onDown?: (e: React.PointerEvent) => void; onRemove?: (byMouse: boolean) => void; onMove?: (d: number) => void;
  /** V1.43: rename this clock (double click the name or the pencil). renamed: it has a name of your own;
   *  ownName: the name Reset name brings back. */
  renamed?: boolean; ownName?: string; onRename?: (name: string) => void; onResetName?: () => void;
}) {
  const li = useRef<HTMLLIElement>(null);
  // Renaming: the text being typed (null while not renaming). `ended` stops Enter and the blur after it saving twice.
  const [edit, setEdit] = useState<string | null>(null);
  const ended = useRef(false);
  const startEdit = () => { if (!onRename || edit !== null) return; sfx.click(); ended.current = false; setEdit(name); };
  const endEdit = (save: boolean) => {
    if (ended.current || edit === null) return;
    ended.current = true;
    if (save && edit.trim() !== name) onRename?.(edit);
    setEdit(null);
  };
  useEffect(() => { if (found) li.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [found]);
  useEffect(() => { if (isNew) li.current?.scrollIntoView({ block: "nearest" }); }, [isNew]);
  return (
    <li ref={li} data-z={zone} className={`tm-ck${you ? " you" : ""}${active ? " active" : ""}${found ? " found" : ""}${zone ? " tz-movable" : ""}${isNew ? " new" : ""}${lift ? " lift" : ""}`}
      style={shiftY ? { transform: `translate3d(0,${shiftY}px,0)` } : undefined} onPointerDown={onDown}
      onMouseEnter={onOver ? (e) => { onOver(e.currentTarget); sfx.hover(); } : undefined} onMouseLeave={onOut}>
      {!!found && <i key={found} className="tz-ping" aria-hidden="true" />}
      {onRemove && (
        <button type="button" className="tz-zx" aria-label={`Take ${name} off your clocks`} title="Take off (drag the clock to move it)" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          onClick={(e) => { e.stopPropagation(); onRemove(e.detail > 0); }}
          onKeyDown={(e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); e.stopPropagation(); onMove?.(e.key === "ArrowUp" ? -1 : 1); } }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
      <Face ts={ts} tz={tz} className="tm-ck-face" />
      {edit !== null ? (
        <span className="tz-ren" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <input type="text" className="tz-ren-in" value={edit} maxLength={ZONE_NAME_MAX} autoFocus autoComplete="off" spellCheck={false}
            aria-label={`New name for ${name}`} placeholder={ownName}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setEdit(e.target.value)}
            onKeyDown={(e) => {
              // Every key here is the box's own: nothing in the Tab list reacts to it.
              if (e.key !== "Tab") e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); endEdit(true); }
              else if (e.key === "Escape") { e.preventDefault(); sfx.hover(); endEdit(false); }
            }}
            onKeyUp={(e) => { if (e.key !== "Tab") e.stopPropagation(); }}
            onBlur={() => endEdit(true)} />
          {renamed && (
            <button type="button" className="tz-ren-reset" title={`Back to ${ownName}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); ended.current = true; setEdit(null); onResetName?.(); }}>
              Reset name
            </button>
          )}
        </span>
      ) : onRename ? (
        <span className="tz-nm">
          <span className="tm-ck-n" onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }} title={renamed ? `${name} (was ${ownName}). Double click to rename` : "Double click to rename"}>{name}</span>
          <button type="button" className="tz-zpen" aria-label={`Rename ${name}`} title="Rename" onClick={(e) => { e.stopPropagation(); startEdit(); }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
          </button>
        </span>
      ) : <span className="tm-ck-n">{name}</span>}
      <span className="tm-ck-t num">{fmtTime(ts, tz)}</span>
      {gap && <span className="tm-ck-g">{gap}</span>}
    </li>
  );
});

/** The pop-out: that zone's big clock, then yours sliding out to its right, and the gap between.
 *  You can move the mouse onto it. Hover a clock and it grows, and a separate small card drops
 *  out underneath listing the clients in that zone, one per line. */
function Compare({ ts, tz, name, top, who, onEnter, onLeave, conv, people, fresh, onRemove, onSaved }: {
  ts: number; tz: string; name: string; top: number; who?: string; onEnter: () => void; onLeave: () => void; conv: ConvHooks;
  people: PersonEntry[]; fresh: string | null; onRemove: (id: string) => void; onSaved: (id: string) => void;
}) {
  const home = homeTz();
  const gap = offsetMin(ts, tz) - offsetMin(ts, home);
  const shift = dayShift(ts, tz);
  // The clients card shows straight away for the zone you hovered; point at your own clock to
  // see yours instead, and it goes back when you move off it.
  const [sub, setSub] = useState<"zone" | "home" | null>("zone");
  // V1.39: Add (or a person's pencil) opens a small form on the clients card. While it is open the card
  // stays on that clock, so the form never vanishes under the mouse.
  const [form, setForm] = useState<(FormMode & { k: number }) | null>(null);
  // V1.47: the moment picked in Convert a time (and the zone it was typed in), so each client on the card can
  // get a Create event of their own.
  const [picked, setPicked] = useState<Picked | null>(null);
  const formOpen = useRef(false);
  formOpen.current = !!form;
  const t = useRef(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const enterSide = (k: "zone" | "home") => { window.clearTimeout(t.current); if (formOpen.current) return; if (k !== sub) sfx.hover(); setSub(k); };
  const leaveSide = () => { window.clearTimeout(t.current); if (formOpen.current) return; t.current = window.setTimeout(() => setSub("zone"), 160); };
  const formFocus = useCallback((on: boolean) => conv.typing(on, on), [conv]);
  // Clients and people whose own time zone runs on the same clock right now (Vancouver counts as Pacific).
  const inZone = (zone: string) => peopleOnClock(people, zone, ts);
  const side = (k: "zone" | "home", zone: string, label: string, extra?: string) => (
    <div className={`tm-cmp-side${k === "home" ? " you" : ""}${sub === k ? " hot" : ""}`} onMouseEnter={() => enterSide(k)} onMouseLeave={leaveSide}>
      <Face ts={ts} tz={zone} className="tm-cmp-face" numbers />
      <span className="tm-cmp-n">{label}</span>
      <b className="tm-cmp-t num">{fmtTime(ts, zone)}</b>
      <span className="tm-cmp-d num">{fmtDay(ts, zone)}{extra}</span>
    </div>
  );
  const subZone = sub === "zone" ? tz : home;
  const subLabel = sub === "zone" ? name : homeLabel();
  const names = sub ? inZone(subZone) : [];
  // Never off the screen: measured before it paints (and again when the clients card changes).
  // Too low: it moves up. Too big for the window: the whole card shrinks a little.
  const card = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ dy: 0, k: 1 });
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect(), f = fitRef.current;
      const baseTop = r.top - f.dy;
      const sc = el.querySelector<HTMLElement>(".tm-cmp-sub");
      const total = el.offsetHeight + (sc ? sc.offsetHeight + 10 : 0);
      const k = Math.max(0.5, Math.min(1, (innerWidth - 16 - r.left) / el.offsetWidth, (innerHeight - 24) / total));
      const want = Math.max(12, Math.min(baseTop, innerHeight - 12 - total * k));
      const next = { dy: Math.round(want - baseTop), k: Math.round(k * 1000) / 1000 };
      if (Math.abs(next.dy - f.dy) > 0.5 || Math.abs(next.k - f.k) > 0.002) setFit(next);
    };
    place();
    window.addEventListener("resize", place);
    // The converter changes the card's size as the developer types (a clock change night adds a note).
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    ro?.observe(el);
    return () => { window.removeEventListener("resize", place); ro?.disconnect(); };
  }, [top, sub, names.length, form]);
  const w = todayIn(tz, ts);
  return (
    <div ref={card} className="tm-cmp" style={{ top: top + fit.dy, ["--fit" as string]: fit.k }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="tm-cmp-clocks">
        {side("zone", tz, name, shift ? ` · ${shift}` : "")}
        <div className="tm-cmp-gap">
          <b className="num">{gap === 0 ? "=" : `${Math.abs(gap) / 60}h`}</b>
          <span>{gap < 0 ? "behind you" : gap > 0 ? "ahead of you" : "same time"}</span>
          <svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><path d="M1 6h30M26 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        {side("home", home, `You · ${homeLabel()}`)}
        {sub && (
          <div key={sub} className={`tm-cmp-sub ${sub}`} onMouseEnter={() => window.clearTimeout(t.current)} onMouseLeave={leaveSide}>
            <div className="tz-sub-h">
              <span className="tm-panel-h">Clients on {subLabel} time</span>
              {!form && (
                <button type="button" className="tz-add" onClick={() => { sfx.click(); setForm({ mode: "add", tz: subZone, k: Date.now() }); }}
                  title={`Add a person on ${subLabel} time`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  Add
                </button>
              )}
            </div>
            {form && (
              <PersonForm key={form.k} form={form} now={ts} onDone={() => setForm(null)} onRemove={onRemove} onSaved={onSaved} onFocusChange={formFocus} />
            )}
            {names.length ? (
              <ul>
                {names.map((p) => (
                  <li key={p.key} className={`${p.kind}${p.id === fresh ? " new" : ""}`} title={p.kind === "person" ? `Added here (not a client) · ${zoneLine(p.tz!)}` : undefined}>
                    <span className={`dot ${p.kind}`} aria-hidden="true" />
                    <span className="tz-li-n">{p.name}</span>
                    {picked && <EventLink start={picked.ts} tz={picked.tz} who={p.name} small />}
                    {p.kind === "person" && (
                      <button type="button" className="tz-edit" aria-label={`Rename, move or remove ${p.name}`} title="Rename, move or remove"
                        onClick={() => { sfx.click(); setForm({ mode: "edit", id: p.id, name: p.name, tz: p.tz!, k: Date.now() }); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : !form && <p>No clients in this time zone. <button type="button" className="tz-link" onClick={() => { sfx.click(); setForm({ mode: "add", tz: subZone, k: Date.now() }); }}>Add someone</button></p>}
          </div>
        )}
      </div>
      <Convert tz={tz} home={home} today={`${w.y}-${w.mo}-${w.d}`} hooks={conv} who={who} onPick={setPicked} />
    </div>
  );
}

// ---------- the person found (V1.39) ----------
// Pick someone in the find box and their card slides out: a strip of every time zone on Earth, each cell
// showing the hour it is there now, glides from your zone to theirs while the big clock's hands sweep
// round to their time and the hours count up. Then their zone pulses, their row in the list lights up, and
// the line reads "Alex · New York · 9:14 AM · 7 h behind you". With reduced motion it simply appears.
const CELL = 46;                     // one hour on the strip
const FIRST = -12, LAST = 14;        // the strip runs from UTC-12 to UTC+14
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Where an offset (minutes ahead of UTC) sits on the strip: the middle of its hour cell. */
const stripX = (off: number) => (off / 60 - FIRST) * CELL + CELL / 2;

function Spotlight({ p, tz, ts, top, onLanded, onClose, onEdit, onCompare }: {
  p: Found; tz: string; ts: number; top: number; onLanded: () => void; onClose: () => void; onEdit?: () => void; onCompare: (el: HTMLElement) => void;
}) {
  const home = homeTz();
  const mineOff = offsetMin(ts, home), theirOff = offsetMin(ts, tz);
  const gap = theirOff - mineOff;
  const still = useMemo(reducedMotion, []);
  const [k, setK] = useState(still ? 1 : 0);
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;
  useEffect(() => {
    if (still) { landedRef.current(); return; }
    // A short wait for the card to arrive, then the glide: longer for a longer way round, never sluggish.
    const dur = Math.min(1500, 700 + (Math.abs(gap) / 60) * 60);
    let raf = 0, start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const x = Math.min(1, (t - start) / dur);
      setK(easeInOut(x));
      if (x < 1) raf = requestAnimationFrame(step);
      else { sfx.click(); landedRef.current(); }
    };
    const wait = window.setTimeout(() => { raf = requestAnimationFrame(step); }, 220);
    return () => { window.clearTimeout(wait); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const done = k >= 1;
  const shift = gap * k;                                   // minutes travelled so far
  const shown = ts + shift * 60000;                        // your clock moved by that much reads their time
  const view = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(360);
  useLayoutEffect(() => { if (view.current) setVw(view.current.offsetWidth); }, []);
  const camX = vw / 2 - stripX(mineOff + shift);
  const u = new Date(ts);
  const twelve = twelveHour();
  const cells = [];
  for (let o = FIRST; o <= LAST; o++) {
    const h = (u.getUTCHours() + o + 24 * 2) % 24;
    const part = h < 5 || h >= 22 ? "night" : h < 7 || h >= 19 ? "dusk" : "day";
    cells.push(
      <span key={o} className={`tz-cell ${part}`} style={{ left: (o - FIRST) * CELL }}>
        <b className="num">{twelve ? (h % 12 || 12) : String(h).padStart(2, "0")}</b>{twelve && <i>{h < 12 ? "am" : "pm"}</i>}
      </span>,
    );
  }
  const dayTagText = dayShift(ts, tz);
  const city = zoneLine(tz);
  const hoursSoFar = Math.round(Math.abs(shift) / 60);
  // The keyboard stays in the find box, so the next name can be typed straight away.
  return (
    <div className={`tz-spot${done ? " landed" : ""}`} style={{ top }} role="region" aria-label={`${p.name}'s time`}
      onMouseDown={(e) => e.stopPropagation()}>
      <div className="tz-spot-h">
        <span className={`tz-tag ${p.kind}`}>{p.kind === "client" ? "Client" : "Person"}</span>
        <button type="button" className="tz-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <h3 className="tz-spot-name">{p.name}</h3>
      <p className="tz-spot-line" aria-live="polite">
        {done ? <>{p.name} · {cityOf(tz)} · <span className="num">{fmtTime(ts, tz)}</span> · {gapWords(gap)}</> : <>Finding {cityOf(tz)}…</>}
      </p>
      <div className="tz-spot-mid">
        <Face ts={shown} tz={home} className="tz-spot-face" numbers />
        <div className="tz-spot-time">
          <b className="num">{fmtTime(shown, home)}</b>
          <span className="num">{fmtDay(shown, home)}{done && dayTagText ? <em> · {dayTagText}</em> : null}</span>
          <span className={`tz-gap-chip${done ? " in" : ""}`}>
            {done ? gapWords(gap) : gap === 0 ? "same time" : `${hoursSoFar} h ${gap < 0 ? "behind" : "ahead"}`}
          </span>
        </div>
      </div>
      <div ref={view} className="tz-strip-view" aria-hidden="true">
        <div className="tz-strip" style={{ width: (LAST - FIRST + 1) * CELL, transform: `translate3d(${camX}px,0,0)` }}>
          {cells}
          <span className="tz-pin you" style={{ left: stripX(mineOff) }}><i />You</span>
          {gap !== 0 && <span className={`tz-pin them${done ? " on" : ""}`} style={{ left: stripX(theirOff) }}><i />{p.name.split(" ")[0]}</span>}
          <span className="tz-trail" style={{ left: Math.min(stripX(mineOff), stripX(mineOff + shift)), width: Math.abs(stripX(mineOff + shift) - stripX(mineOff)) }} />
        </div>
        <span className="tz-lens" />
      </div>
      <div className="tz-spot-f">
        <span className="tz-spot-zone">{city}<small>{tz}</small></span>
        <span className="tz-grow" />
        {onEdit && <button type="button" className="tz-btn sm" onClick={onEdit}>Edit</button>}
        <button type="button" className="tz-btn go sm" onClick={(e) => onCompare(e.currentTarget)} title="Their clock next to yours, and the converter">Convert a time</button>
      </div>
    </div>
  );
}

// ---------- the converter on each zone's card (V1.36) ----------
// The developer hovers Pacific, types "2pm" (or 14:00, 2:30pm, 1430), steps the day with the arrows, and sees
// at once what that is in his own zone, with the day it lands on there. It replaced the old
// "Convert a time" box at the bottom of the panel (the developer, 5 Nov 2026).
type ConvState = { text: string; dayOff: number };
type ConvHooks = { kept: Map<string, ConvState>; typing: (focus: boolean, text: boolean, quiet?: boolean) => void; close: () => void };

/** A wall clock time ("2:30 PM" or "14:30", the same style as the clocks above). */
const clockOf = (mins: number) => fmtTime(Date.UTC(2000, 0, 1, Math.floor(mins / 60), mins % 60), "UTC");
const ymdKey = (d: Ymd) => `${d.y}-${String(d.mo).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
const noonOf = (d: Ymd) => Date.UTC(d.y, d.mo - 1, d.d, 12);
/** The clocks here say "2:30 PM" rather than "14:30". */
const twelveHour = () => /[ap]/i.test(fmtTime(Date.UTC(2000, 0, 1, 13), "UTC"));

// Scrolling the time and the day (the developer, 7 Nov 2026). Up is later. On a Mac with natural scrolling
// (WebKit says so on the event, which PS always has) fingers moving up mean later too.
type WheelLike = WheelEvent & { webkitDirectionInvertedFromDevice?: boolean };
/** The steps one wheel event makes towards later (signed), from that target's own running total. */
function wheelSteps(w: ReturnType<typeof newWheel>, e: WheelLike) {
  const d = e.deltaY || (e.shiftKey ? e.deltaX : 0);
  return wheelStep(w, (e.webkitDirectionInvertedFromDevice === true ? 1 : -1) * d, e.timeStamp, notchesOf(d, e.deltaMode));
}
let measure: CanvasRenderingContext2D | null = null;
/** The character in the box under the pointer (the text length past the end of the text). */
function charUnder(input: HTMLInputElement, clientX: number) {
  const text = input.value;
  measure ||= document.createElement("canvas").getContext("2d");
  if (!measure || !text) return 0;
  const cs = getComputedStyle(input);
  measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const ls = parseFloat(cs.letterSpacing) || 0;
  const x = clientX - input.getBoundingClientRect().left - (parseFloat(cs.paddingLeft) || 0) + input.scrollLeft;
  if (x < 0) return 0;
  for (let i = 0; i < text.length; i++) {
    if (x < measure.measureText(text.slice(0, i + 1)).width + ls * (i + 1)) return i;
  }
  return text.length;
}

const Convert = memo(function Convert({ tz, home, today: _today, hooks, who, onPick }: {
  tz: string; home: string; today: string; hooks: ConvHooks;
  /** V1.47: the person this card was opened for (Find, then Convert a time): their name goes in the event. */
  who?: string;
  /** V1.47: tells the card the picked moment, so its clients can each get a Create event. */
  onPick?: (p: Picked | null) => void;
}) {
  const saved = hooks.kept.get(tz);
  const [text, setText] = useState(saved?.text ?? "");
  const [dayOff, setDayOff] = useState(saved?.dayOff ?? 0);
  const input = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  useEffect(() => { hooks.kept.set(tz, { text, dayOff }); }, [hooks, tz, text, dayOff]);
  useEffect(() => { if (focused.current) hooks.typing(true, text.trim() !== ""); }, [hooks, text]);
  // The card going away while the box still had focus: forget the typing hold (quietly, the card is
  // already on its way out or another zone's card is taking its place).
  useEffect(() => () => { if (focused.current) hooks.typing(false, false, true); }, [hooks]);

  const base = todayIn(tz);
  const day = addDays(base, dayOff);
  const typed = parseTyped(text);
  const from = typed?.zone || tz;
  const res = typed ? convertWall(day, typed.h, typed.mi, from, home) : null;
  // The real moment(s) picked: one, or two on the night the clocks go back (the same wall time happens twice).
  const moments = !res ? [] : res.kind === "twice" ? [res.first.ts, res.second.ts] : [res.hit.ts];
  const pickKey = moments.length ? `${moments[0]}|${from}` : "";
  useEffect(() => { onPick?.(pickKey ? { ts: Number(pickKey.split("|")[0]), tz: pickKey.split("|")[1] } : null); }, [pickKey, onPick]);
  const homeCity = homeLabel().split(" (")[0];
  const short = zoneShort(from);
  const rel = dayOff === 0 ? "today" : dayOff === 1 ? "tomorrow" : dayOff === -1 ? "yesterday" : "";
  const step = (n: number) => { sfx.hover(); setDayOff((d) => d + n); };
  // Scroll, the arrow keys and (on the phone) a drag move the time. The latest text is kept in a ref
  // so quick steps in a row build on each other before React has drawn the last one.
  const live = useRef({ text, dayOff });
  live.current = { text, dayOff };
  const nudge = (part: Part, n: number) => {
    if (!n) return;
    const w = wall(Date.now(), tz);
    const r = stepTyped(live.current.text, part, n, { h: w.h, mi: w.mi, h12: twelveHour() });
    if (!r) return;
    live.current = { text: r.text, dayOff: live.current.dayOff + r.days };
    sfx.hover();
    setText(r.text);
    if (r.days) setDayOff((d) => d + r.days);
  };
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;
  const box = useRef<HTMLLabelElement>(null);
  const dateBox = useRef<HTMLLabelElement>(null);
  useEffect(() => {
    const el = box.current, dl = dateBox.current, inp = input.current;
    if (!el || !dl || !inp) return;
    const tw = newWheel(), dw = newWheel();
    // Over the box: the minutes (or the am/pm after them) move by a quarter hour, anything else the
    // hour. Shift held: always the minutes. Only a box holding a time, or an empty one, takes it.
    const onTime = (e: WheelEvent) => {
      const t = live.current.text;
      if (t.trim() && !parseTyped(t)) return;
      e.preventDefault(); e.stopPropagation();
      const k = wheelSteps(tw, e);
      if (k) nudgeRef.current(e.shiftKey ? "min" : partAt(t, charUnder(inp, e.clientX)), k);
    };
    const onDay = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const k = wheelSteps(dw, e);
      if (k) { sfx.hover(); setDayOff((d) => d + k); }
    };
    // The phone: drag a finger up or down the box. A short tap still types as before.
    let drag: { y: number; part: Part; done: number; on: boolean; id: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const t = live.current.text;
      drag = { y: e.clientY, part: partAt(t, charUnder(inp, e.clientX)), done: 0, on: false, id: e.pointerId };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const up = drag.y - e.clientY;
      if (!drag.on) {
        if (Math.abs(up) < 8) return;
        const t = live.current.text;
        if (t.trim() && !parseTyped(t)) { drag = null; return; }
        drag.on = true;
        try { el.setPointerCapture(e.pointerId); } catch { /* fine without */ }
      }
      const k = dragSteps(up, drag.done);
      if (k) { drag.done += k; nudgeRef.current(drag.part, k); }
    };
    const end = (e: PointerEvent) => { if (drag && e.pointerId === drag.id && !drag.on) drag = null; };
    // A drag is not a tap: no keyboard popping up when the finger lifts.
    const touchEnd = (e: TouchEvent) => { if (drag?.on) { e.preventDefault(); drag = null; } };
    el.addEventListener("wheel", onTime, { passive: false });
    dl.addEventListener("wheel", onDay, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("touchend", touchEnd, { passive: false });
    return () => {
      el.removeEventListener("wheel", onTime);
      dl.removeEventListener("wheel", onDay);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("touchend", touchEnd);
    };
  }, [tz]);

  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Every key typed here is the converter's own: nothing in the Tab list reacts to it.
    if (e.key !== "Tab") e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (text) { setText(""); return; }                    // first Esc clears the time
      e.currentTarget.blur(); hooks.close();                  // then it closes the card
    } else if (e.key === "Enter") {
      e.preventDefault(); e.currentTarget.select();
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && (e.altKey || e.metaKey)) {
      e.preventDefault(); step(e.key === "ArrowUp" ? 1 : -1);  // Option+arrows step the day
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // Arrows step the hour, Shift+arrows a quarter hour (half typed text is left alone).
      e.preventDefault(); nudge(e.shiftKey ? "min" : "hour", e.key === "ArrowUp" ? 1 : -1);
    }
  };
  const line = (h: Hit, big?: boolean) => {
    const tag = dayTag(h.dayDiff);
    return (
      <div key={`${h.ts}${home}`} className={`tm-cv-hit${big ? " big" : ""}`}>
        <b className="tm-cv-t num">{fmtTime(h.ts, home)}</b>
        <span className="tm-cv-d">
          <span className="num">{fmtDay(h.ts, home)}</span> in {homeCity}
          {tag ? <i className="tm-cv-tag num">{tag}</i> : <i className="tm-cv-tag same">same day</i>}
        </span>
      </div>
    );
  };

  return (
    <div className="tm-cv" onMouseDown={(e) => e.stopPropagation()}>
      <div className="tm-cv-head">
        <span className="tm-panel-h">Convert a time</span>
        {dayOff !== 0 && <button type="button" className="tm-cv-today" onClick={() => { sfx.hover(); setDayOff(0); }}>Today</button>}
      </div>
      <label ref={box} className={`tm-cv-in${text && !typed ? " bad" : ""}`}
        title="Scroll or use the arrow keys: over the hour it moves an hour, over the minutes 15 minutes">
        <input ref={input} type="text" inputMode="text" autoComplete="off" spellCheck={false} placeholder="2pm" value={text}
          aria-label={`A time in ${zoneName(tz)}`} maxLength={24}
          onChange={(e) => setText(e.target.value)} onKeyDown={keys} onKeyUp={(e) => { if (e.key !== "Tab") e.stopPropagation(); }}
          onFocus={() => { focused.current = true; hooks.typing(true, text.trim() !== ""); }}
          onBlur={() => { focused.current = false; hooks.typing(false, false); }} />
        <span className="tm-cv-zone">{short || zoneName(from)}</span>
      </label>
      <div className="tm-cv-day">
        <button type="button" className="tm-cv-step" onClick={() => step(-1)} aria-label="The day before" title="The day before">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <label ref={dateBox} className="tm-cv-date" title="Pick a day, or scroll to move it">
          <span key={ymdKey(day)} className="tm-cv-date-l"><b className="num">{fmtDay(noonOf(day), "UTC")}</b>{rel && <em>{rel}</em>}</span>
          <input type="date" value={ymdKey(day)} aria-label={`The day in ${zoneName(tz)}`}
            onKeyDown={(e) => { if (e.key !== "Tab") e.stopPropagation(); }}
            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* the browser opens it itself */ } }}
            onFocus={() => hooks.typing(true, text.trim() !== "")} onBlur={() => hooks.typing(false, false)}
            onChange={(e) => {
              const [y, mo, d] = e.target.value.split("-").map(Number);
              if ([y, mo, d].every(Number.isFinite) && y > 1900) setDayOff(daysBetween(base, { y, mo, d }));
            }} />
        </label>
        <button type="button" className="tm-cv-step" onClick={() => step(1)} aria-label="The day after" title="The day after">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
      <div className="tm-cv-out" aria-live="polite">
        {!text.trim() ? (
          <p className="tm-cv-hint">Type a time, like <b>2pm</b>, <b>14:00</b> or <b>1430</b>, or scroll on the box, to see it in {homeCity}.</p>
        ) : !typed || !res ? (
          <p className="tm-cv-hint bad">Not a time yet. Try <b>2pm</b>, <b>2:30pm</b>, <b>14:00</b> or <b>1430</b>.</p>
        ) : (
          <>
            <span key={`${from}${ymdKey(day)}${typed.h}:${typed.mi}`} className="tm-cv-src">
              {clockOf(typed.h * 60 + typed.mi)} {zoneName(from)}, <span className="num">{fmtDay(noonOf(day), "UTC")}</span>
            </span>
            {res.kind === "ok" && line(res.hit, true)}
            {res.kind === "ok" && <FreeCheck start={res.hit.ts} home={home} />}
            {res.kind === "ok" && <EventLink start={res.hit.ts} tz={from} who={who} />}
            {res.kind === "twice" && (
              <>
                <p className="tm-cv-note">
                  {clockOf(typed.h * 60 + typed.mi)} happens twice in {zoneName(from)} that night: at {clockOf(res.jumpFrom)} the clocks go back to {clockOf(res.jumpTo)}.
                </p>
                <span className="tm-cv-which">The first time</span>
                {line(res.first)}
                <FreeCheck start={res.first.ts} home={home} />
                <span className="tm-cv-which">The second time</span>
                {line(res.second)}
                <FreeCheck start={res.second.ts} home={home} />
                <span className="tm-cv-evs">
                  <EventLink start={res.first.ts} tz={from} who={who} label="Event at the first" />
                  <EventLink start={res.second.ts} tz={from} who={who} label="Event at the second" />
                </span>
              </>
            )}
            {res.kind === "missing" && (
              <>
                <p className="tm-cv-note">
                  {clockOf(typed.h * 60 + typed.mi)} never happens in {zoneName(from)} that night: the clocks jump from {clockOf(res.jumpFrom)} to {clockOf(res.jumpTo)}. Read as {clockOf((typed.h * 60 + typed.mi + res.jumpTo - res.jumpFrom + 1440) % 1440)}:
                </p>
                {line(res.hit, true)}
                <FreeCheck start={res.hit.ts} home={home} />
                <EventLink start={res.hit.ts} tz={from} who={who} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// ---------- Are you free then? (V1.57, core/tzfree.ts) ----------
// Under the converted time: is a meeting of 30 minutes, 1 hour or 2 hours starting then clear of your meetings and
// your PS tasks with a time? "Free for 1 hour", or "Busy" with each thing in the way and its time in your zone.
// Private mode hides the names. All from the vault on this device: nothing is fetched or sent.
let lastLen: FreeLen = FREE_LEN_DEF;   // the length picked last, for the next card (while PS runs)

function FreeCheck({ start, home }: { start: number; home: string }) {
  const s = useVault();
  const [len, setLen] = useState<FreeLen>(lastLen);
  const unlocked = s.status === "unlocked";
  const st = unlocked ? settingsData(s) : null;
  const priv = !!st?.privateMode;
  // The meetings and the tasks, worked out again only when the vault changes (not every second).
  const data = useMemo(() => {
    if (!unlocked) return null;
    const cals = calendarDocs(s);
    const set = settingsData(s);
    return {
      meetings: eventBlocks(cals.flatMap((d) => d.data.events || []), home, set.meetHidden),
      ranges: cals.map((d) => ({ from: d.data.from, to: d.data.to })),
      tasks: todos(s).map((d) => ({ id: d.id, title: d.data.title, due: d.data.due, done: d.data.done, clearedAt: d.data.clearedAt })),
      reminders: remindRec(s)?.list ?? [],
    };
  }, [s, unlocked, home]);
  if (!data) return null;
  const end = start + len * 60000;
  const busy: Busy[] = [...data.meetings, ...taskBlocks(data.tasks, data.reminders, start, end, home, DEVICE_TZ)];
  const ans = checkFree(start, len, busy);
  const covers = calendarCovers(data.ranges, start, end);
  const startDay = fmtDay(start, home);
  const when = (b: Busy) => {
    const d1 = fmtDay(b.start, home), d2 = fmtDay(b.end - 1, home);
    const from = `${d1 !== startDay ? `${d1}, ` : ""}${fmtTime(b.start, home)}`;
    return `${from} to ${d2 !== d1 ? `${d2}, ` : ""}${fmtTime(b.end, home)}`;
  };
  const pick = (n: FreeLen) => { if (n === len) return; sfx.hover(); lastLen = n; setLen(n); };
  return (
    <div className={`tz-free${ans.free ? " ok" : " busy"}`} aria-live="polite">
      <div className="tz-free-h">
        {ans.free ? (
          <b className="tz-free-ans">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            Free for {lenWords(len)}
          </b>
        ) : <b className="tz-free-ans">Busy</b>}
        <span className="tz-free-len" role="radiogroup" aria-label="How long the meeting is">
          {FREE_LENGTHS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={n === len} className={n === len ? "on" : ""}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(n)} title={`Check ${lenWords(n)} from this time`}>{lenShort(n)}</button>
          ))}
        </span>
      </div>
      {!ans.free && (
        <ul className="tz-free-list">
          {ans.clashes.map((b) => (
            <li key={b.key} className={b.kind} aria-label={`${clashName(b, priv)}, ${when(b)}`}>
              <span className={`tz-free-tag ${b.kind}`}>{b.kind === "meeting" ? "Meeting" : "Task"}</span>
              {!priv && <span className="tz-free-n">{b.title}</span>}
              <span className="tz-free-t num">{when(b)}</span>
            </li>
          ))}
        </ul>
      )}
      {ans.allDay.length > 0 && (
        <p className="tz-free-note">That day: {ans.allDay.map((b) => (priv ? "an all day event" : b.title)).join(", ")} (all day, not counted)</p>
      )}
      {covers === "none" && <p className="tz-free-note">No calendar linked yet, so only your PS tasks were checked.</p>}
      {covers === "no" && <p className="tz-free-note">Your calendar copy does not reach that day yet, so only your PS tasks were checked.</p>}
    </div>
  );
}
// ---------- Create event (V1.47) ----------
type Picked = { ts: number; tz: string };

/** Opens Google Calendar's new event page with the time filled in, in the browser (PS sends a new window link to
 *  the default browser on the Mac and to the phone's browser or Calendar app). Nothing is written by PS. */
function EventLink({ start, tz, who, label, small }: { start: number; tz: string; who?: string; label?: string; small?: boolean }) {
  const title = eventTitle(who);
  return (
    <a className={`tm-cv-ev${small ? " sm" : ""}`} href={gcalLink({ start, tz, title })} target="_blank" rel="noopener noreferrer"
      title={`Opens Google Calendar with "${title}" at this time (${zoneName(tz)}), 30 minutes`}
      aria-label={small ? `Create event: ${title}` : undefined}
      onMouseDown={(e) => e.stopPropagation()} onClick={() => sfx.click()}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4M12 13.5v4M10 15.5h4" /></svg>
      {!small && <span>{label ?? "Create event"}</span>}
    </a>
  );
}

// ---------- the next clock change ----------
function inDays(at: number, now: number) {
  const d = Math.ceil((at - now) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}
function hoursWord(mins: number) { const h = Math.abs(mins) / 60; return `${h} hour${h === 1 ? "" : "s"}`; }

// The US zones say "USA" together, as before; any other set of clocks changing the same way is named one by one.
const US_IDS = new Set(["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage",
  "America/Detroit", "America/Boise", "America/Indiana/Indianapolis", "Pacific/Honolulu"]);

function ClockChanges({ now, mine, list }: { now: number; mine: number; list: Zone[] }) {
  // Recomputed at most once a minute, or when your list changes (the search is cached per day anyway).
  const minute = Math.floor(now / 60000);
  const ids = list.map((z) => `${z.id}=${z.label}=${z.short}`).join(",");
  const data = useMemo(() => {
    const me = nextChange(homeTz(), now);
    // V1.40: the clocks on your list, grouped when they change on the same day the same way (the US zones
    // all go from 2:00 to 1:00 on one Sunday), soonest first.
    const groups = new Map<string, { z: Zone; c: Change }[]>();
    for (const z of list) {
      const c = nextChange(z.id, now);
      if (!c) continue;
      const k = `${fmtDay(c.at, z.id)}|${wallBefore(c)}|${wallAfter(c)}`;
      groups.set(k, [...(groups.get(k) || []), { z, c }]);
    }
    return { me, groups: [...groups.values()].sort((a, b) => a[0].c.at - b[0].c.at) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute, ids]);
  const after = (c: Change, tz: string) => {
    const myAfter = data.me && data.me.at <= c.at ? data.me.after : mine;
    return gapLabel(offsetMin(c.at + 60000, tz) - myAfter);
  };
  return (
    <div className="tm-dst">
      <span className="tm-panel-h">Clocks change</span>
      {data.groups.map((g) => {
        const { z, c } = g[0];
        const how = <>clocks go {c.after < c.before ? "back" : "forward"} {hoursWord(c.after - c.before)}.</>;
        if (g.length === 1) return (
          <p key={z.id}>
            <b>{z.label}</b> · {fmtDay(c.at, z.id)}, {inDays(c.at, now)}.{" "}
            {wallBefore(c)} becomes {wallAfter(c)}: {how}{" "}
            <span className="tm-dst-gap">{gapLabel(c.before - mine)} → {after(c, z.id)}</span>
          </p>
        );
        const title = g.every((x) => US_IDS.has(x.z.id)) ? "USA" : g.map((x) => x.z.label).join(", ");
        return (
          <p key={z.id}>
            <b>{title}</b> · {fmtDay(c.at, z.id)}, {inDays(c.at, now)}.{" "}
            {wallBefore(c)} becomes {wallAfter(c)} in each zone: {how}
            <span className="tm-dst-list">
              {g.map((x) => (
                <span key={x.z.id} className="tm-dst-gap">{tagOf(x.z)} {gapLabel(x.c.before - mine).replace(" behind", "").replace(" ahead", "")} → {after(x.c, x.z.id)}</span>
              ))}
            </span>
          </p>
        );
      })}
      <p className="tm-dst-note">{data.me ? `Your clocks change ${fmtDay(data.me.at, homeTz())}.` : `${homeLabel().split(" (")[0]} does not change its clocks.`}</p>
    </div>
  );
}
