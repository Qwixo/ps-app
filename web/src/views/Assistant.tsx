// The Settings assistant's screen pieces (PS 1.65): the card (website and phone: plain at the top of Settings; Mac: its own card when the
// island is not there), the bot button in Settings' header, and the spotlight of the guided walk. All state is in src/assist.ts, all
// rules in core/assist.ts and core/assistwalk.ts. Esc: a walk ends first, then the answer clears, then Settings closes as always.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { assistEsc, assistOn, ask, cancel, confirm, confirmHere, controlClicked, guideNext, pickMatch, undoRequest, useAssist, botButton } from "../assist";
import { ASSIST_WORDS as W, confirmButtons, outsideGuideFor } from "../core/assist";
import { canUndo } from "../core/featreq";
import { nextTimeLine, walkSay } from "../core/assistwalk";
import { openSettings } from "./SettingsScreen";
import { landingOf, settingById } from "../core/settingsindex";
import "./assist.css";

/** The little bot: a rounded head with two eyes that blink and an antenna. Pure SVG, so no image is added to the app. */
export function BotIcon({ size = 22, swoop = false }: { size?: number; swoop?: boolean }) {
  return (
    <svg className={`as-bot${swoop ? " swoop" : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v3" /><circle cx="12" cy="2.6" r=".6" fill="currentColor" />
      <rect x="4.5" y="6" width="15" height="12" rx="4" />
      <g className="as-eyes"><path d="M9 11.5v1.4M15 11.5v1.4" strokeWidth="2.4" /></g>
      <path d="M9.6 15.4c1.4 1 3.4 1 4.8 0" />
    </svg>
  );
}

/** The bot button in Settings' header: brings the card back (on a Mac with an island, the island). */
export function AssistBotButton() {
  if (!assistOn()) return null;
  return (
    <button type="button" className="as-btn" onClick={botButton} aria-label={W.botButton} title={W.botButton} data-tip="">
      <BotIcon size={20} />
    </button>
  );
}

export function AssistCard({ inline = false }: { inline?: boolean }) {
  const a = useAssist();
  const [text, setText] = useState("");
  const box = useRef<HTMLInputElement>(null);
  // Esc, ahead of Settings' own key: a walk ends first, then the answer clears; with nothing to end Settings closes as it always did.
  // Added only while there is something to end, so it is the newest Esc layer (ui/escape.ts asks the newest first) and sits above
  // Settings' own. The phone's Back is the same Esc.
  const busy = a.phase !== "idle";
  useEffect(() => {
    if (!busy) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && assistEsc()) { e.preventDefault(); e.stopImmediatePropagation(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [busy]);
  // A click on the control the spotlight waits on finishes a Show me how.
  useEffect(() => {
    if (a.walk?.phase !== "waiting") return;
    const click = (e: MouseEvent) => { controlClicked(e.target instanceof Element ? e.target : null); };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [a.walk?.phase]);
  if (!assistOn()) return null;
  const p = a.plan;
  const guide = p?.kind === "guide" && p.settingId ? outsideGuideFor(p.settingId) : undefined;
  // The matches under an answer, without the one the answer is already about (or the closest thing already offered).
  const others = a.matches.filter((m) => m.id !== p?.settingId && m.id !== p?.closest?.settingId);
  const submit = () => { const t = text.trim(); if (t) { ask(t); setText(""); } };
  // In the first setup (inline) nothing walks away from the setup menu: the change happens in place (src/assist.ts confirmHere).
  const go = (how: "do" | "show") => { if (inline) void confirmHere(how); else confirm(how); };
  return (
    <section className={`as-card${busy ? " busy" : ""}${inline ? " inline" : ""}${a.phase === "walk" ? " walking" : ""}`} aria-label={W.title}>
      <div className="as-top">
        <span className={`as-ic${a.phase === "thinking" ? " think" : ""}${a.phase === "result" && a.nextTime ? " happy" : ""}`}><BotIcon size={26} swoop /></span>
        <form className="as-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input ref={box} className="as-in" value={text} onChange={(e) => setText(e.target.value)} placeholder={W.ask} aria-label={W.ask} spellCheck={false} autoComplete="off" enterKeyHint="send" />
          <button type="submit" className="as-send" disabled={!text.trim() || a.phase === "thinking"}>{W.send}</button>
        </form>
      </div>
      <div className="as-body" role="status" aria-live="polite">
        {a.phase === "thinking" && <p className="as-think"><span>{W.thinking}</span><i /><i /><i /></p>}
        {a.phase === "confirm" && p && !guide && (
          <>
            <p className="as-say">{p.say}</p>
            <div className="as-acts">
              {confirmButtons(p).includes("doit") && <button type="button" className="as-go" onClick={() => go("do")}>{W.doIt}</button>}
              {confirmButtons(p).includes("show") && <button type="button" className="as-sec" onClick={() => go("show")}>{W.showHow}</button>}
              {confirmButtons(p).includes("cancel") && <button type="button" className="as-sec quiet" onClick={() => cancel()}>{W.cancel}</button>}
            </div>
          </>
        )}
        {a.phase === "confirm" && p && guide && (
          <>
            <p className="as-say">{p.say}</p>
            <p className="as-step"><b>{a.guide + 1} / {guide.steps.length}</b> {guide.steps[a.guide].line}</p>
            <div className="as-acts">
              {guide.steps[a.guide].url && <a className="as-sec" href={guide.steps[a.guide].url} target="_blank" rel="noreferrer noopener">{W.guideOpen}</a>}
              {guide.steps[a.guide].open && <button type="button" className="as-sec" onClick={() => { const e = settingById(guide.steps[a.guide].open!); if (e) openSettings(landingOf(e).group, { jump: landingOf(e).id }); }}>{W.guideInPs}</button>}
              <button type="button" className="as-go" onClick={guideNext}>{a.guide + 1 >= guide.steps.length ? W.done : W.next}</button>
              <button type="button" className="as-sec quiet" onClick={() => cancel()}>{W.cancel}</button>
            </div>
            <p className="as-note">{W.guideNote}</p>
          </>
        )}
        {a.phase === "walk" && a.walk && (
          <p className="as-say"><b>{walkSay(a.walk)}</b>{a.walk.phase === "waiting" && <span className="as-wait"> {W.waitClick}</span>}</p>
        )}
        {a.phase === "result" && p && (
          <>
            {a.request && a.request.state !== "undone" && <p className="as-say">{W.frSent} {p.closest ? W.frCant : W.frNoClosest}</p>}
            {(!a.request || a.request.state === "undone") && <p className="as-say">{p.say}</p>}
            {p.closest && (
              <button type="button" className="as-closest" onClick={() => pickMatch(p.closest!.settingId)}>
                <b>{settingById(p.closest.settingId)?.name}</b><em>{p.closest.say}</em>
              </button>
            )}
            {a.request && canUndo(a.request) && <button type="button" className="as-sec quiet" onClick={() => void undoRequest(a.request!.req.id)}>{W.frUndo}</button>}
            {a.request?.state === "undone" && <p className="as-note">{W.frUndone}</p>}
            {a.request && a.request.state === "waiting" && <p className="as-note">{W.frKept}</p>}
            {a.request && a.request.state === "kept" && <p className="as-note">{W.frNoSquad}</p>}
            {a.nextTime && <button type="button" className="as-next" onClick={() => { const e = settingById(a.nextTime!.id); if (e) openSettings(landingOf(e).group, { jump: landingOf(e).id }); }}>{nextTimeLine(a.nextTime.path)}</button>}
          </>
        )}
        {a.note && <p className="as-note">{a.note}</p>}
        {others.length > 0 && a.phase !== "walk" && a.phase !== "thinking" && (
          <div className="as-matches">
            <p className="as-note">{p && p.kind !== "none" ? W.orThese : W.matches}</p>
            {others.map((m) => <button key={m.id} type="button" className="as-match" onClick={() => pickMatch(m.id)}><b>{m.name}</b><em>{m.group}</em></button>)}
          </div>
        )}
      </div>
    </section>
  );
}

/** The soft spotlight of a walk: a dim sheet with a rounded hole around the element the step points at. It never takes a click. */
export function AssistSpot() {
  const a = useAssist();
  const [r, setR] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const step = a.phase === "walk" && a.walk ? a.walk.walk.steps[Math.min(a.walk.i, a.walk.walk.steps.length - 1)] : null;
  const sel = step?.selector ?? null;
  useEffect(() => {
    if (!sel) { setR(null); return; }
    let raf = 0, last = "";
    const loop = () => {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) {
        const b = el.getBoundingClientRect();
        const k = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}`;
        if (k !== last) { last = k; setR({ x: b.x, y: b.y, w: b.width, h: b.height }); }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [sel]);
  // After Do it: the changed row glows for a moment (the real control already moved by itself).
  useEffect(() => {
    if (!a.glow) return;
    const el = document.querySelector<HTMLElement>(`[data-set="${a.glow.replace(/["\\]/g, "")}"]`);
    if (!el) return;
    el.classList.remove("as-glow"); void el.offsetWidth; el.classList.add("as-glow");
    const t = window.setTimeout(() => el.classList.remove("as-glow"), 1800);
    return () => { window.clearTimeout(t); el.classList.remove("as-glow"); };
  }, [a.glow]);
  if (!step || !r) return null;
  const pad = 6;
  return createPortal(
    <div className={`as-spot${a.walk?.reduce ? " plain" : ""}${step.kind === "control" ? " ctl" : ""}`} aria-hidden="true"
      style={{ left: r.x - pad, top: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2 }} />, document.body);
}

/** In PS's first setup (views/Welcome.tsx): "Not sure? Ask the Settings assistant" opens the same card under the card you are on. It
 *  finds and changes any setting right there (no walk, so the setup menu stays open) and ends with the Next time path. */
export function SetupAssist() {
  const [open, setOpen] = useState(false);
  if (!assistOn()) return null;
  return (
    <div className="as-setup">
      {!open
        ? <button type="button" className="as-sec" onClick={() => setOpen(true)}><BotIcon size={16} /><span style={{ marginLeft: 6 }}>{W.setupAsk}</span></button>
        : <AssistCard inline />}
    </div>
  );
}
