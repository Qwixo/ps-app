// Settings > Appearance > Mouse trail (V1.43, core/trail.ts has the rules and the developer's words). The effect, with a little
// moving picture on each tile; a pad to try it on straight away; and for the picked effect its colour (presets and the
// colour wheel), size, intensity and Burst on click. Everything shows on the pad as you change it; the sliders save
// when you let go and the colour a moment after you stop.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Settings } from "../core/model";
import {
  FX_INTENSITY, FX_SIZE, TRAIL_KINDS, TRAIL_PRESETS, fxOf, isDefaultFx, trailInfo, trailPrefs, withFx, type TrailFx, type TrailId, type TrailPrefs,
} from "../core/trail";
import { looksOption } from "../core/looksoptions";
import { sfx } from "../ui/sfx";
import { ColorWheel } from "./ColorWheel";
import { TrailPad, touchOnly } from "./Trail";
import { drawThumb } from "./trailfx";
import "./trail.css";

const reducedNow = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function Thumb({ kind, fx }: { kind: TrailId; fx: TrailFx }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const key = `${fx.c}|${fx.s}|${fx.i}`;
  useEffect(() => { if (cv.current && trailInfo(kind).canvas) drawThumb(cv.current, kind, fx); }, [kind, key]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (kind === "glow") return <span className="mt-thumb mt-thumb-glow" style={{ ["--gc" as string]: fx.c }} aria-hidden="true"><i /><i /></span>;
  if (kind === "off") return <span className="mt-thumb mt-thumb-off" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><path d="M6.5 17.5l11-11" /></svg></span>;
  return <span className="mt-thumb" aria-hidden="true"><canvas ref={cv} /></span>;
}

export function MouseTrailSettings({ st, set }: { st: Settings; set: (p: Partial<Settings>) => void }) {
  const savedKey = JSON.stringify(trailPrefs(st.tmTrail));
  const [p, setP] = useState<TrailPrefs>(() => trailPrefs(st.tmTrail));
  useEffect(() => { setP(trailPrefs(st.tmTrail)); }, [savedKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = (n: TrailPrefs) => { window.clearTimeout(timer.current); setP(n); set({ tmTrail: n }); };
  const saveSoon = (n: TrailPrefs) => { setP(n); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => set({ tmTrail: n }), 450); };
  const kind = p.kind, info = trailInfo(kind), fx = fxOf(p, kind);
  const reduced = reducedNow(), touch = useMemo(touchOnly, []);
  const [wheel, setWheel] = useState(false);
  const saved = trailPrefs(st.tmTrail);
  const letGo = () => { if (JSON.stringify(p) !== JSON.stringify(saved)) save(p); };

  return (
    <section className="ms-sec mt-sec" data-set="mouse-trail">
      <h3 className="ms-h">Mouse trail</h3>
      <p className="ms-changes">{looksOption("trail").changes}</p>
      {reduced && <p className="ms-note">Reduce motion is on in this device's settings, so the list shows the still Glow until you turn it off there.</p>}
      {touch && <p className="ms-note">This screen has no mouse to follow, so nothing is drawn here. Your choice still shows on your computer.</p>}
      <TrailPad live={{ kind, fx, burst: p.burst }} />
      <div className="mt-grid" role="radiogroup" aria-label="Mouse trail effect">
        {TRAIL_KINDS.map((k) => {
          const on = k.id === kind;
          return (
            <button key={k.id} type="button" role="radio" aria-checked={on} className={`tm-p1-tile mt-tile${on ? " on" : ""}`} data-kind="trail" data-id={k.id}
              data-tip={k.label} data-tip-line={k.note} onClick={() => { if (!on) { sfx.click(); save({ ...p, kind: k.id }); setWheel(false); } }}>
              <Thumb kind={k.id} fx={fxOf(p, k.id)} />
              <span className="tm-p1-name">{k.label}</span>
            </button>
          );
        })}
      </div>
      <p className="ms-note mt-what"><b>{info.label}.</b> {info.note}</p>
      {kind !== "off" && (
        <div className="mt-tune">
          <div className="mt-line">
            <span className="tm-pop-note tm-look-l">Colour</span>
            <div className="mt-swatches" role="radiogroup" aria-label={`${info.label} colour`}>
              {info.multi && (
                <button type="button" role="radio" aria-checked={fx.c === "multi"} className={`mt-sw mt-sw-multi${fx.c === "multi" ? " on" : ""}`} title="Its own mix of colours"
                  onClick={() => { sfx.hover(); save(withFx(p, kind, { c: "multi" })); }}><span className="sr">Its own mix of colours</span></button>
              )}
              {TRAIL_PRESETS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={fx.c === c} className={`mt-sw${fx.c === c ? " on" : ""}`} style={{ background: c }} title={c.toUpperCase()}
                  onClick={() => { sfx.hover(); save(withFx(p, kind, { c })); }}><span className="sr">{c}</span></button>
              ))}
              <button type="button" className={`mt-sw mt-sw-wheel${wheel ? " open" : ""}`} aria-expanded={wheel} title="Colour wheel"
                onClick={() => { sfx.hover(); setWheel(!wheel); }}><span className="sr">Colour wheel</span></button>
            </div>
          </div>
          {wheel && (
            <div className="mt-wheel">
              <ColorWheel label={`${info.label} colour`} value={fx.c === "multi" ? trailInfo(kind).colour === "multi" ? "#ff8a3c" : trailInfo(kind).colour : fx.c}
                onChange={(hex) => saveSoon(withFx(p, kind, { c: hex }))} />
            </div>
          )}
          <div className="tm-pop-row ms-slider"><span className="tm-pop-note tm-look-l">Size</span>
            <input type="range" min={0} max={100} step={5} value={fx.s} className="tm-pop-range" aria-label={`${info.label} size`}
              onChange={(e) => setP(withFx(p, kind, { s: Number(e.target.value) }))} onPointerUp={letGo} onKeyUp={letGo} />
            <b className="num tm-pop-v">{fx.s}%</b></div>
          <div className="tm-pop-row ms-slider"><span className="tm-pop-note tm-look-l">Intensity</span>
            <input type="range" min={0} max={100} step={5} value={fx.i} className="tm-pop-range" aria-label={`${info.label} intensity`}
              onChange={(e) => setP(withFx(p, kind, { i: Number(e.target.value) }))} onPointerUp={letGo} onKeyUp={letGo} />
            <b className="num tm-pop-v">{fx.i}%</b></div>
          <div className="mt-line">
            {info.canvas && (<>
              <span className="tm-pop-note tm-look-l">Burst on click</span>
              <div className="tm-ed-seg" role="radiogroup" aria-label="Burst on click">
                <button type="button" role="radio" aria-checked={p.burst} className={`dwell${p.burst ? " on" : ""}`} onClick={() => { if (!p.burst) { sfx.hover(); save({ ...p, burst: true }); } }}>On</button>
                <button type="button" role="radio" aria-checked={!p.burst} className={`dwell${!p.burst ? " on" : ""}`} onClick={() => { if (p.burst) { sfx.hover(); save({ ...p, burst: false }); } }}>Off</button>
              </div>
            </>)}
            {!isDefaultFx(kind, fx) && (
              <button type="button" className="ms-peek-btn mt-reset" onClick={() => { sfx.click(); save(withFx(p, kind, { c: info.colour, s: FX_SIZE, i: FX_INTENSITY })); }}>
                Reset {info.label}
              </button>
            )}
          </div>
          {info.canvas && <p className="ms-note">{p.burst ? "Click a task to see a pop of it." : "Burst on click adds a pop of the effect where you click."} It only draws while your mouse moves over your tasks, and never gets in the way of a click.</p>}
        </div>
      )}
    </section>
  );
}
