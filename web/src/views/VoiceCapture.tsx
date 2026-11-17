// Voice capture in the Add task window (PS 1.65, rules in core/voicecapture.ts, the Mac's half in VoiceCapture.swift).
// The microphone button sits beside the task's name, on the Mac only (the shell says it can, voice:status). Hold it and talk,
// or click it and click Stop. While it listens a slim bar shows a red dot, a calm level meter, the time and the words so far.
// Then Apple's on device model (or the plain split) makes tasks, each through the dates parser, and a review list shows them:
// each row editable, removable, its date chip visible. Only the Add all click adds anything. Esc closes the voice part first.
// Switch: Settings, Your list, "Speak your tasks" (feature voice-capture, on by default).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PS, psPost } from "../ps";
import { feature } from "../core/features";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { nlDatesOn, nlParseCtx } from "./NlDates";
import {
  clock, meterBars, reviewCount, reviewRow, SPLIT_WAIT_MS, voiceHoldsEsc, voiceStart, voiceStep, VOICE_WORDS,
  type ReviewRow, type VoiceEvent, type VoiceOut, type VoicePerm, type VoiceState, type VoiceStatus,
} from "../core/voicecapture";
import "./voice.css";

export const voiceOn = () => feature("voice-capture");

// ---------- the bridge: the Mac calls window.__psVoice(message) ----------
type Msg = Record<string, unknown>;
const listeners = new Set<(m: Msg) => void>();
if (PS && typeof window !== "undefined") (window as Window & { __psVoice?: (m: Msg) => void }).__psVoice = (m) => { listeners.forEach((l) => l(m)); };
const post = (o: VoiceOut) => psPost(o);

/** A message from the Mac, as a flow event (null: not ours or not usable). */
function eventOf(m: Msg, featureOn: boolean): VoiceEvent | null {
  const s = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : "");
  const perm = (v: unknown): VoicePerm => (v === "ready" || v === "ask" || v === "denied" || v === "restricted" ? v : "denied");
  switch (m.type) {
    case "voice:status": return { type: "status", featureOn, status: { supported: m.supported === true, perm: perm(m.perm), onDevice: m.onDevice === true, lang: s("lang").slice(0, 60) } as VoiceStatus };
    case "voice:perm": return { type: "perm", perm: perm(m.perm), onDevice: m.onDevice === true };
    case "voice:started": return { type: "started", at: Date.now() };
    case "voice:level": return { type: "level", v: Number(m.v) };
    case "voice:partial": return { type: "partial", text: s("text") };
    case "voice:stopped": {
      const r = s("reason");
      const reason = r === "limit" || r === "protected" || r === "error" || r === "cancel" ? r : "user";
      return { type: "stopped", reason, text: s("text"), at: Date.now() };
    }
    case "voice:blocked": {
      const w = s("why");
      return { type: "blocked", why: w === "protected" || w === "onDevice" || w === "perm" ? w : "off" };
    }
    case "voice:tasks": return { type: "tasks", id: s("id"), tasks: m.tasks ?? null };
    default: return null;
  }
}

const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
function useReducedMotion() {
  return useSyncExternalStore((l) => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); mq.addEventListener("change", l); } catch { /* old engine */ }
    return () => { try { mq?.removeEventListener("change", l); } catch { /* ignore */ } };
  }, reduceMotion);
}

export type VoiceCtl = {
  st: VoiceState;
  on: boolean;
  send: (e: VoiceEvent) => void;
  /** Esc: true when the voice part took it (the window stays open). */
  esc: () => boolean;
  rows: ReviewRow[];
  count: number;
};

/** One Add task window's voice capture. `onAdd` gets the rows of the Add all click, and only those. */
export function useVoiceCapture(onAdd: (rows: ReviewRow[]) => void): VoiceCtl {
  const st0 = settingsData(useVault());
  const featureOn = voiceOn();
  const on = PS && featureOn;
  const dates = nlDatesOn();
  const { tz, opts } = nlParseCtx(st0);
  const ref = useRef<VoiceState>(voiceStart());
  const [st, setSt] = useState<VoiceState>(ref.current);
  const addRef = useRef(onAdd);
  addRef.current = onAdd;
  const ctxRef = useRef({ tz, opts, dates });
  ctxRef.current = { tz, opts, dates };

  const send = useCallback((e: VoiceEvent) => {
    const before = ref.current;
    const c = ctxRef.current;
    // 1Password or Signal in front is decided by the Mac (it knows the app in front); the page never asks for its name.
    const r = voiceStep(before, e, { now: Date.now(), tz: c.tz, opts: c.opts, dates: c.dates });
    ref.current = r.st;
    for (const o of r.out) post(o);
    // Soft sounds, following the PS sound settings (sfx: the volume, off at 0).
    if (before.phase !== "starting" && r.st.phase === "starting") sfx.voice("start");
    if ((before.phase === "recording" || before.phase === "starting") && r.st.phase === "thinking") sfx.voice("stop");
    if (r.add.length) { sfx.drop(); addRef.current(r.add); }
    if (r.st !== before) setSt(r.st);
  }, []);

  // The Mac's messages, and what it can do now. Only on the Mac page with the switch on.
  useEffect(() => {
    if (!on) {
      // Switched off while it listens: the Mac stops at once.
      if (ref.current.phase === "recording" || ref.current.phase === "starting") post({ type: "voice:cancel" });
      if (ref.current.phase !== "off") send({ type: "blocked", why: "off" });
      return;
    }
    const l = (m: Msg) => { const e = eventOf(m, featureOn); if (e) send(e); };
    listeners.add(l);
    post({ type: "voice:status" });
    return () => {
      listeners.delete(l);
      const p = ref.current.phase;
      if (p === "recording" || p === "starting") post({ type: "voice:cancel" });   // the window closed while listening
      ref.current = voiceStart();
    };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  // The model gets SPLIT_WAIT_MS; after that the plain split is used.
  useEffect(() => {
    if (st.phase !== "thinking") return;
    const id = st.ask;
    const t = window.setTimeout(() => send({ type: "splitTimeout", id }), SPLIT_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [st.phase, st.ask, send]);

  // A plain line fades by itself after a while (the denied and on device lines stay until Esc or the next press).
  useEffect(() => {
    if (st.phase !== "idle" || !st.note || st.note === VOICE_WORDS.denied || st.note === VOICE_WORDS.restricted || st.note.includes("will not listen")) return;
    const t = window.setTimeout(() => send({ type: "esc" }), 6000);
    return () => window.clearTimeout(t);
  }, [st.phase, st.note, send]);

  const esc = useCallback(() => {
    if (!voiceHoldsEsc(ref.current)) return false;
    send({ type: "esc" });
    return true;
  }, [send]);

  const rows = useMemo(() => (st.review ? st.review.items.map((it) => reviewRow(it, Date.now(), tz, opts, dates)) : []), [st.review, tz, dates]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = st.review ? reviewCount(st.review, Date.now(), tz, opts, dates) : 0;
  return { st, on: on && st.phase !== "off", send, esc, rows, count };
}

const MIC = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;

/** The microphone button. Pointer down starts; a long press stops when let go, a click keeps listening until Stop. It never
 *  takes the keyboard from the name field (and never from another app: it only works on a click in PS). */
export function VoiceMic({ v }: { v: VoiceCtl }) {
  if (!v.on) return null;
  const live = v.st.phase === "recording" || v.st.phase === "starting";
  const busy = v.st.phase === "thinking" || v.st.phase === "review" || v.st.phase === "asking";
  return (
    <button type="button" className={`vc-mic${live ? " live" : ""}`} disabled={busy} aria-pressed={live}
      aria-label={live ? VOICE_WORDS.stop : VOICE_WORDS.mic} title={live ? VOICE_WORDS.stop : VOICE_WORDS.micTitle}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } v.send({ type: "down", at: Date.now() }); }}
      onPointerUp={(e) => { if (e.button !== 0) return; v.send({ type: "up", at: Date.now() }); }}
      onPointerCancel={() => v.send({ type: "up", at: 0 })}
      onKeyDown={(e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); e.stopPropagation(); const t = Date.now(); v.send({ type: "down", at: t }); v.send({ type: "up", at: t }); } }}>
      {MIC}
    </button>
  );
}

function Meter({ level }: { level: number }) {
  const reduced = useReducedMotion();
  return (
    <span className="vc-meter" aria-hidden="true">
      {meterBars(level, reduced).map((h, i) => <i key={i} style={{ transform: `scaleY(${h})` }} />)}
    </span>
  );
}

/** Listening, thinking, a plain line, or the review list. Nothing when idle with nothing to say. */
export function VoicePanel({ v }: { v: VoiceCtl }) {
  const { st } = v;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (st.phase !== "recording") return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [st.phase]);
  if (!v.on) return null;
  if (st.phase === "recording" || st.phase === "starting") {
    return (
      <div className="vc-bar" role="status" aria-live="polite">
        <span className="vc-dot" aria-hidden="true" />
        <span className="vc-l">{VOICE_WORDS.listening}</span>
        <Meter level={st.level} />
        <span className="vc-time num">{clock(st.since ? now - st.since : 0)}</span>
        <span className="vc-words"><bdi>{st.partial}</bdi></span>
        {st.held
          ? <span className="vc-hint">{VOICE_WORDS.holding}</span>
          : <button type="button" className="vc-stop" onMouseDown={(e) => e.preventDefault()} onClick={() => v.send({ type: "stopClick" })}>{VOICE_WORDS.stop}</button>}
      </div>
    );
  }
  if (st.phase === "thinking") {
    return (
      <div className="vc-bar thinking" role="status" aria-live="polite">
        <span className="vc-spin" aria-hidden="true" />
        <span className="vc-l">{VOICE_WORDS.thinking}</span>
        <span className="vc-words">{st.transcript}</span>
      </div>
    );
  }
  if (st.phase === "review" && st.review) return <VoiceReview v={v} />;
  if (st.note) {
    const denied = st.note === VOICE_WORDS.denied;
    return (
      <div className={`vc-note${st.phase === "asking" ? " asking" : ""}`} role="status" aria-live="polite">
        <span>{st.note}</span>
        {denied && <button type="button" className="vc-link" onClick={() => v.send({ type: "settingsClick" })}>{VOICE_WORDS.openSettings}</button>}
      </div>
    );
  }
  return null;
}

/** The review list: every task editable and removable, its date chip visible; only the Add all click adds. */
function VoiceReview({ v }: { v: VoiceCtl }) {
  const list = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const reduced = useReducedMotion();
  const remove = (id: string) => {
    sfx.click();
    if (reduced) { v.send({ type: "review", a: { type: "remove", id } }); return; }
    setLeaving((s) => new Set(s).add(id));
    window.setTimeout(() => v.send({ type: "review", a: { type: "remove", id } }), 180);
  };
  // Enter moves to the next task (it never adds: only the Add all click does).
  const next = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); e.stopPropagation();
    const inputs = list.current?.querySelectorAll<HTMLInputElement>(".vc-row input");
    inputs?.[i + 1]?.focus({ preventScroll: true });
  };
  return (
    <div className="vc-review" role="group" aria-label={VOICE_WORDS.reviewHead(v.rows.length)}>
      <div className="vc-review-h">{VOICE_WORDS.reviewHead(v.rows.length)}</div>
      <div className="vc-rows" ref={list}>
        {v.rows.map((r, i) => (
          <div key={r.id} className={`vc-row${leaving.has(r.id) ? " leaving" : ""}${r.ok ? "" : " empty"}`} style={{ ["--i" as string]: i }}>
            <input value={r.text} onChange={(e) => v.send({ type: "review", a: { type: "edit", id: r.id, text: e.target.value } })} onKeyDown={(e) => next(e, i)}
              aria-label={`Task ${i + 1}`} maxLength={200} autoComplete="off" spellCheck />
            {r.parsed
              ? <button type="button" className="vc-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => { sfx.hover(); v.send({ type: "review", a: { type: "keepWords", id: r.id } }); }}
                  title={VOICE_WORDS.keepWords}>{r.parsed.label}</button>
              : !r.ok && <span className="vc-need">{VOICE_WORDS.needsName}</span>}
            <button type="button" className="vc-x" onMouseDown={(e) => e.preventDefault()} onClick={() => remove(r.id)} aria-label={`${VOICE_WORDS.remove}: ${r.title || `Task ${i + 1}`}`} title={VOICE_WORDS.remove}>×</button>
          </div>
        ))}
        {!v.rows.length && <div className="vc-empty">{VOICE_WORDS.reviewEmpty}</div>}
      </div>
      <div className="vc-review-foot">
        <button type="button" className="tm-ed-chip vc-discard" onClick={() => { sfx.click(); v.send({ type: "esc" }); }}>{VOICE_WORDS.discard}</button>
        <button type="button" className="tm-ed-save vc-addall" disabled={!v.count || busy}
          onClick={() => { if (busy) return; setBusy(true); v.send({ type: "review", a: { type: "addAll", by: "click" } }); }}>{VOICE_WORDS.addAll(v.count)}</button>
      </div>
    </div>
  );
}
