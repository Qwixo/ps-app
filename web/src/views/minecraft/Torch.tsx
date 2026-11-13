// Minecraft mode, the torch (the developer, 4 Nov 2026: "If I click on the torch icon, it comes up with basically
// a full screen of whiteness so I can use my MacBook as a torch, and different colours of the torch as
// well, red, green, white"). The torch button and the colour row: White, Warm, the developer (never raises the
// brightness, kind to your eyes at night), Green, Blue, and Custom (a hue and how pale). The last colour
// and the brightness setting are kept on this device only. Works fully offline.
// In PS the light is a native full screen window (ps-mac Sources/Torch.swift); elsewhere the page lights
// itself (torch-bridge.ts). Mount: <Torch /> anywhere in the Minecraft mode panel.
import { useEffect, useState, type CSSProperties } from "react";
import "./torch.css";
import { PS } from "../../ps";
import { askTorch, closeTorch, openTorch, useTorch } from "./torch-bridge";
import { CUSTOM_ID, customColor, inkOn, lightFor, mixColor, loadPrefs, savePrefs, toHuePale, TORCH_PRESETS, type TorchPrefs } from "./torch-logic";

const store = () => { try { return window.localStorage; } catch { return null; } };

type Px = [x: number, y: number, w?: number, h?: number];
const rects = (list: Px[], fill: string, cls?: string, op?: number) =>
  list.map(([x, y, w = 1, h = 1]) => <rect key={`${cls ?? fill}-${x}-${y}`} className={cls} x={x} y={y} width={w} height={h} fill={fill} opacity={op} />);

/** Our own pixel torch (16 by 16, crisp pixels, never anyone else's texture): a wooden stick with a dark
 *  collar and a glowing flame top tinted to the torch colour. It flickers on hover and while lit. */
export function TorchIcon({ color, lit, size = 52 }: { color: string; lit?: boolean; size?: number }) {
  const mid = mixColor(color, "#ffffff", 0.5);
  return (
    <svg className={"mct-icon" + (lit ? " lit" : "")} width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <g className="mct-glow">
        {rects([[4, 1, 8, 7]], color, "g1", 0.12)}
        {rects([[5, 0, 6, 9], [3, 2, 10, 5]], color, "g2", 0.1)}
      </g>
      <g className="mct-flame">
        {rects([[8, 1], [7, 2, 2, 1], [6, 3, 4, 4], [5, 4, 1, 2], [10, 4, 1, 2]], color, "f-out")}
        {rects([[8, 2], [7, 3, 2, 3], [6, 4, 1, 2], [9, 5, 1, 1]], mid, "f-mid")}
        {rects([[7, 5, 2, 2], [8, 4]], "#ffffff", "f-core")}
      </g>
      <g className="mct-sparks">
        {rects([[4, 1]], mid, "s1")}{rects([[11, 0]], mid, "s2")}{rects([[12, 3]], color, "s3")}
      </g>
      {/* the collar and the stick, with a little grain */}
      {rects([[6, 7, 4, 1]], "#2b1d10", "collar")}
      {rects([[7, 8, 1, 8]], "#b07a40", "wood-hi")}
      {rects([[8, 8, 1, 8]], "#7c5026", "wood-lo")}
      {rects([[7, 10], [8, 13]], "#8c5d2e", "grain")}
      {rects([[7, 15, 2, 1]], "#4e3017", "end")}
    </svg>
  );
}

/** A glowing pixel gem in the swatch's colour (12 by 12): a dark rim, light facets top left, shade bottom right. */
export function TorchGem({ color, size = 34 }: { color: string; size?: number }) {
  const rim = "var(--mct-edge, #121014)";
  return (
    <svg className="mct-gem" width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {rects([[4, 1, 4, 1], [3, 2, 6, 1], [2, 3, 8, 6], [3, 9, 6, 1], [4, 10, 4, 1]], rim, "rim")}
      {rects([[4, 2, 4, 1], [3, 3, 6, 6], [4, 9, 4, 1]], color, "body")}
      {rects([[4, 3, 2, 1], [3, 4, 2, 1], [3, 5, 1, 1]], "#ffffff", "lit", 0.62)}
      {rects([[6, 4]], "#ffffff", "spark", 0.9)}
      {rects([[7, 7, 2, 2], [5, 9, 2, 1], [8, 6, 1, 1]], "#000000", "shade", 0.3)}
    </svg>
  );
}

export function Torch() {
  const st = useTorch();
  const [prefs, setPrefsState] = useState<TorchPrefs>(() => loadPrefs(store()));
  const [tried, setTried] = useState(false);
  const setPrefs = (p: TorchPrefs) => { setPrefsState(p); savePrefs(store(), p); };
  useEffect(() => { askTorch(); }, []);

  const light = lightFor(prefs);
  const hp = toHuePale(prefs.custom);
  const on = st.open;

  const go = (p: TorchPrefs = prefs) => { const l = lightFor(p); setTried(true); openTorch(l.color, l.bright); };
  const pick = (id: string) => {
    const p = { ...prefs, pick: id };
    setPrefs(p);
    if (on) go(p);                     // already on (another screen): the new colour at once
  };
  const setCustom = (hue: number, pale: number) => {
    const p = { ...prefs, pick: CUSTOM_ID, custom: customColor(hue, pale) };
    setPrefs(p);
    if (on) go(p);
  };
  const setBright = (b: boolean) => { setPrefs({ ...prefs, bright: b }); askTorch(b); };

  const swatch = (id: string, name: string, color: string, note?: string) => (
    <button key={id} type="button" className={"mct-swatch" + (prefs.pick === id ? " on" : "")} aria-pressed={prefs.pick === id}
      title={note ? `${name}: ${note}` : name} onClick={() => pick(id)} onDoubleClick={() => go({ ...prefs, pick: id })}
      style={{ "--mct-sw": color, "--mct-sw-ink": inkOn(color) } as CSSProperties}>
      <span className="mct-slot" aria-hidden="true"><TorchGem color={color} /></span>
      <span className="mct-name">{name}</span>
    </button>
  );

  return (
    <div className="mct" data-open={on ? "1" : "0"}>
      <div className="mct-head">
        <span className="mct-title">Torch</span>
        <span className="mct-hint">Press Esc to turn it off</span>
      </div>

      <button type="button" className={"mct-torch" + (on ? " lit" : "")} aria-pressed={on}
        onClick={() => (on ? closeTorch() : go())}
        style={{ "--mct-light": light.color } as CSSProperties}>
        <TorchIcon color={light.color} lit={on} />
        <span className="mct-torch-label">{on ? "Put it away" : "Light the torch"}</span>
      </button>

      <div className="mct-row" role="group" aria-label="Torch colour">
        {TORCH_PRESETS.map((p) => swatch(p.id, p.name, p.color, p.note))}
        {swatch(CUSTOM_ID, "Custom", prefs.custom)}
      </div>

      {prefs.pick === CUSTOM_ID && (
        <div className="mct-custom">
          <label className="mct-slider">
            <span>Colour</span>
            <input type="range" className="mct-hue" min={0} max={359} step={1} value={hp.hue} aria-label="Colour"
              onChange={(e) => setCustom(Number(e.currentTarget.value), hp.pale)} />
          </label>
          <label className="mct-slider">
            <span>Pale</span>
            <input type="range" className="mct-pale" min={0} max={100} step={1} value={hp.pale} aria-label="How pale"
              style={{ "--mct-pure": customColor(hp.hue, 0) } as CSSProperties}
              onChange={(e) => setCustom(hp.hue, Number(e.currentTarget.value))} />
          </label>
          <span className="mct-hex">{prefs.custom.toUpperCase()}</span>
        </div>
      )}

      {PS && (
        <label className="mct-bright">
          <input type="checkbox" checked={prefs.bright} onChange={(e) => setBright(e.currentTarget.checked)} />
          <span className="mct-check" aria-hidden="true" />
          <span>Full brightness while on</span>
        </label>
      )}
      {prefs.pick === "red" && <div className="mct-note">Red keeps your brightness as it is, easy on your eyes in the dark.</div>}
      {PS && prefs.bright && !st.canBright && <div className="mct-note">This screen's brightness cannot be changed by PS app.</div>}
      {tried && st.refused === "protected" && <div className="mct-note warn">Not over 1Password or Signal. Switch to another app first.</div>}
    </div>
  );
}

export default Torch;
