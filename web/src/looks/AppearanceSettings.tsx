// Appearance (V1.31): one section in More settings with every look in three columns (the current looks, Notebook,
// Productivity), the accent for the chosen look (presets or any colour, made readable automatically), and layout and
// text (density, text size, font). Everything switches live with a smooth fade; Preview shows a look for 2 seconds.
// The look is saved in the vault settings (look, lookAccent, lookDensity, lookText, lookFont), so the Mac and the
// phone match. Styles: src/looks/settings.css (ap-*).
// V1.43 (the developer 8 Nov 2026: "the diagrams don't change colour at all"): the Accent and the Layout and text cards each have
// a small live list (LiveSample, core/looksample.ts) that shows the choice the moment you point at it, click it or
// slide to it, so it is clear what it changes.
import { useEffect, useState, type CSSProperties } from "react";
import type { Settings } from "../core/model";
import {
  ACCENT_PRESETS, DENSITIES, WORK_STYLES, workStyle, FONTS, offeredLooks, NOTEBOOK_IDS, TEXT_SIZES, buildTokens, contrast, fontCss, hexRgb, lookById, resolveAppearance,
  rgbHex, type Appearance, type Density, type LookGroup, type LookSpec,
} from "../core/looks";
import { NOTEBOOK_ON } from "../core/features";
import { setLookPreview, setWorkPreview } from "./engine";
import { looksOption, type LooksPart } from "../core/looksoptions";
import { PinnedPreview } from "../ui/PinnedPreview";
import { sampleVars } from "../core/looksample";
import "./settings.css";

const GROUPS: { id: LookGroup; label: string; note: string }[] = [
  { id: "classic", label: "PS", note: "The looks PS app has always had" },
  { id: "notebook", label: "Notebook", note: "Paper, drawn by hand" },
  { id: "productivity", label: "Productivity", note: "From the research: palettes, type and density for how you work" },
].filter((g) => NOTEBOOK_ON || g.id !== "notebook") as { id: LookGroup; label: string; note: string }[];   // Notebook: core/features.ts

type Preview = (label: string, set: () => void, clear: () => void, part?: LooksPart) => void;

export function AppearanceSection({ st, set, preview }: { st: Settings; set: (p: Partial<Settings>) => void; preview: Preview }) {
  const a = resolveAppearance(st);
  const spec = lookById(a.look);
  return (
    <section className="ms-sec ap-sec" aria-labelledby="ap-h">
      <div className="ap-top">
        <h3 className="ms-h" id="ap-h">Appearance</h3>
        <p className="ms-changes">{looksOption("look").changes}</p>
        <p className="ms-note">Click a look to use it. The eye shows it on your list for 2 seconds. Your Mac and phone match.</p>
      </div>
      <LookPicker st={st} set={set} preview={preview} />
      <AccentCard st={st} set={set} look={spec} />
      <WorkCard st={st} set={set} preview={preview} look={spec} accent={a.accent} />
      <TypeCard st={st} set={set} />
    </section>
  );
}
const validFor = (st: Settings, id: string) => st.lookAccent?.[id] ?? null;
// The names the PS self test clicks (ps-mac main.swift pickLook and the More settings check): theme / notebook / look.
const kindOf = (l: LookSpec) => (l.group === "classic" ? "theme" : l.group === "notebook" ? "notebook" : "look");

/** One look: a small drawing in its own colours and type, its name and what it is for. */
/** The looks themselves, in their three columns (V1.43: the Look row of Settings, Appearance). */
export function LookPicker({ st, set, preview }: { st: Settings; set: (p: Partial<Settings>) => void; preview: Preview }) {
  const a = resolveAppearance(st);
  const pick = (l: LookSpec) => set({
    look: l.id,
    // older settings kept in step, so a phone or Mac on an older page still shows something close
    tmNotebook: NOTEBOOK_IDS.has(l.id) ? l.id : "off", tmTheme: l.id === "light" ? "light" : "dark",
  });
  return (
    <div className="ap-cols" data-cols={GROUPS.length}>
      {GROUPS.map((g) => (
        <div key={g.id} className={`ap-col ap-${g.id}`} role="radiogroup" aria-label={`${g.label} looks`}>
          <div className="ap-col-h"><b>{g.label}</b><span>{g.note}</span></div>
          {offeredLooks().filter((l) => l.group === g.id).map((l) => (
            <LookRow key={l.id} l={l} on={a.look === l.id} accent={validFor(st, l.id)}
              onPick={() => pick(l)}
              onPreview={() => preview(l.label, () => setLookPreview({ look: l.id }), () => setLookPreview(null), "look")} />
          ))}
          {g.id === "productivity" && offeredLooks().every((l) => l.group !== "productivity") && <p className="ap-empty">Coming with the research looks.</p>}
        </div>
      ))}
    </div>
  );
}
/** The accent, Working on and Layout and text cards, each on its own (V1.43: their own rows in Settings, Appearance). */
export function AccentPart({ st, set }: { st: Settings; set: (p: Partial<Settings>) => void }) {
  return <AccentCard st={st} set={set} look={lookById(resolveAppearance(st).look)} />;
}
export function WorkPart({ st, set, preview }: { st: Settings; set: (p: Partial<Settings>) => void; preview: Preview }) {
  const a = resolveAppearance(st);
  return <WorkCard st={st} set={set} preview={preview} look={lookById(a.look)} accent={a.accent} />;
}
export function TypePart({ st, set }: { st: Settings; set: (p: Partial<Settings>) => void }) {
  return <TypeCard st={st} set={set} />;
}

function LookRow({ l, on, accent, onPick, onPreview }: { l: LookSpec; on: boolean; accent: string | null; onPick: () => void; onPreview: () => void }) {
  const t = buildTokens({ look: l.id, accent, density: "comfortable", text: 100, font: null });
  const acc = t["--k-acc"] ?? l.acc, accT = t["--k-acc-t"] ?? l.acc;
  const style = { "--s-base": l.base, "--s-surf": l.surface, "--s-fg": l.fg, "--s-acc": acc, "--s-acct": accT, "--s-font": fontCss(l.font) } as CSSProperties;
  return (
    <div className={`ap-look${on ? " on" : ""}`} data-look-id={l.id}>
      <button type="button" role="radio" aria-checked={on} className={`ap-pick ms-tile${on ? " on" : ""}`} data-kind={kindOf(l)} data-id={l.id}
        onClick={() => { if (!on) onPick(); }} title={l.note}>
        <span className={`ap-sample${NOTEBOOK_IDS.has(l.id) ? ` nb-sample nbs-${l.id}` : ""}`} style={style} aria-hidden="true">
          {NOTEBOOK_IDS.has(l.id)
            ? <><b className="nbs-top" /><span className="nbs-line"><i className="nbs-box on" /><em>Call Jo back</em></span><span className="nbs-line"><i className="nbs-box" /><em>Pay the invoice</em></span></>
            : <><span className="ap-s-card"><i className="ap-s-tick" /><i className="ap-s-l1" /><i className="ap-s-pill" /></span><span className="ap-s-card dim"><i className="ap-s-tick o" /><i className="ap-s-l2" /></span><em className="ap-s-aa">Aa</em></>}
        </span>
        <span className="ap-name"><b>{l.label}</b><span>{l.note}</span></span>
        <span className="ap-check" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
      </button>
      <button type="button" className="ap-peek ms-peek-btn" data-kind={kindOf(l)} data-id={l.id} onClick={onPreview} aria-label={`Preview ${l.label} for 2 seconds`} title="Preview for 2 seconds">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
      </button>
    </div>
  );
}

// ---------- accent ----------
function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return rgbHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
function hueOf(hex: string): number {
  const [r, g, b] = (hexRgb(hex) ?? [236, 78, 134]).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

function AccentCard({ st, set, look }: { st: Settings; set: (p: Partial<Settings>) => void; look: LookSpec }) {
  const saved = st.lookAccent?.[look.id] ?? null;
  const own = look.acc;
  const current = saved ?? own;
  const [hue, setHue] = useState(hueOf(current));
  const [moved, setMoved] = useState(false);
  useEffect(() => { setHue(hueOf(current)); setMoved(false); }, [current]);
  const save = (c: string | null) => {
    const next = { ...(st.lookAccent ?? {}) };
    if (c) next[look.id] = c; else delete next[look.id];
    set({ lookAccent: next });
  };
  const shown = buildTokens({ look: look.id, accent: saved, density: "comfortable", text: 100, font: null });
  const shownAcc = shown["--k-acc"] ?? current;
  const adjusted = saved && shownAcc.toUpperCase() !== saved.toUpperCase();
  const custom = hsl(hue, 0.72, 0.56);
  // The picture: the colour being pointed at, else the one being slid to, else the saved one (null = the look's own).
  const [hover, setHover] = useState<string | null | undefined>(undefined);
  const pictured = hover !== undefined ? hover : moved ? custom : saved;
  const point = (c: string | null) => ({ onMouseEnter: () => setHover(c), onMouseLeave: () => setHover(undefined), onFocus: () => setHover(c), onBlur: () => setHover(undefined) });
  return (
    <div className="ap-card ap-accent">
      <div className="ap-card-h"><b>Accent for {look.label}</b><span className="ap-changes">{looksOption("accent").changes}</span><span>Each look keeps its own. Point at a colour to see it in the picture, click to use it.</span></div>
      {/* V1.47: the picture stays in view while the colours scroll (ui/PinnedPreview.tsx) */}
      <PinnedPreview id="look-accent" label="Preview" size={300}
        preview={<LiveSample a={{ look: look.id, accent: pictured, density: "comfortable", text: 100, font: null }} mark="accent" />}>
        <div className="ap-split-l">
          <div className="ap-swatches" role="radiogroup" aria-label="Accent colour">
            <button type="button" role="radio" aria-checked={!saved} className={`ap-sw own${!saved ? " on" : ""}`} style={{ "--sw": own } as CSSProperties}
              onClick={() => save(null)} title={`${look.label}'s own colour`} {...point(null)}><i /><span>Own</span></button>
            {ACCENT_PRESETS.map((p) => (
              <button key={p.c} type="button" role="radio" aria-checked={saved === p.c} className={`ap-sw${saved === p.c ? " on" : ""}`} style={{ "--sw": p.c } as CSSProperties}
                onClick={() => save(p.c)} title={p.label} aria-label={p.label} {...point(p.c)}><i /></button>
            ))}
          </div>
          <div className="ap-custom">
            <span className="ap-l">Any colour</span>
            <input type="range" min={0} max={359} value={hue} className="ap-hue" aria-label="Accent hue"
              onChange={(e) => { setHue(Number(e.target.value)); setMoved(true); setLookPreview({ accent: hsl(Number(e.target.value), 0.72, 0.56) }); }}
              onPointerUp={() => { setLookPreview(null); if (moved) save(custom); }}
              onKeyUp={() => { setLookPreview(null); if (moved) save(custom); }}
              // A drag let go outside the window (no pointer up here) used to leave this colour on screen for good.
              onPointerCancel={() => setLookPreview(null)} onBlur={() => setLookPreview(null)} />
            <i className="ap-dot" style={{ background: moved ? custom : shownAcc }} aria-hidden="true" />
            <b className="ap-hex num">{(moved ? custom : shownAcc).toUpperCase()}</b>
          </div>
          <p className="ap-fine">{adjusted
            ? `Shown a little ${contrast(shownAcc, "#000000") > contrast(saved!, "#000000") ? "lighter" : "darker"} than ${saved} so text in it stays readable on this look.`
            : "A colour too light or too dark for this look is nudged until text in it reads."}</p>
        </div>
      </PinnedPreview>
    </div>
  );
}

// ---------- Working on ----------
function WorkCard({ st, set, preview, look, accent }: { st: Settings; set: (p: Partial<Settings>) => void; preview: Preview; look: LookSpec; accent: string | null }) {
  const cur = workStyle(st.tmWorkStyle);
  const t = buildTokens({ look: look.id, accent, density: "comfortable", text: 100, font: null });
  const style = { "--s-base": look.base, "--s-surf": look.surface, "--s-fg": look.fg, "--s-acc": t["--k-acc"] ?? accent ?? look.acc,
    "--s-tint": t["--k-work-bg"], "--s-card": t["--k-work-card"], "--s-hl": t["--k-hl"] } as CSSProperties;
  return (
    <div className="ap-card ap-work">
      <div className="ap-card-h"><b>Working on</b><span className="ap-changes">{looksOption("working").changes}</span><span>Each one uses this look's accent and keeps its words readable.</span></div>
      <div className="ap-works" role="radiogroup" aria-label="Working on look">
        {WORK_STYLES.map((w) => (
          <div key={w.id} className={`ap-look ap-wk${cur === w.id ? " on" : ""}`}>
            <button type="button" role="radio" aria-checked={cur === w.id} className={`ap-pick ms-tile${cur === w.id ? " on" : ""}`} data-kind="work" data-id={w.id}
              onClick={() => { if (cur !== w.id) set({ tmWorkStyle: w.id }); }} title={w.note}>
              <span className={`ap-work-sample w-${w.id}`} style={style} aria-hidden="true"><b><i /><em /></b></span>
              <span className="ap-name"><b>{w.label}</b><span>{w.note}</span></span>
              <span className="ap-check" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
            </button>
            <button type="button" className="ap-peek ms-peek-btn" data-kind="work" data-id={w.id} aria-label={`Preview ${w.label} for 2 seconds`} title="Preview for 2 seconds"
              onClick={() => preview(w.label, () => setWorkPreview(w.id), () => setWorkPreview(null), "work")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- layout and text ----------
function TypeCard({ st, set }: { st: Settings; set: (p: Partial<Settings>) => void }) {
  const a = resolveAppearance(st);
  const spec = lookById(a.look);
  const ownFont = FONTS.find((f) => f.id === spec.font) ?? FONTS[0];
  // The picture shows what is pointed at, else what is saved.
  const [hover, setHover] = useState<Partial<{ density: Density; text: number; font: string | null }>>({});
  const point = (x: typeof hover) => ({ onMouseEnter: () => setHover(x), onMouseLeave: () => setHover({}), onFocus: () => setHover(x), onBlur: () => setHover({}) });
  const pictured = { ...a, ...hover };
  return (
    <div className="ap-card ap-type">
      <div className="ap-card-h"><b>Layout and text</b><span>For every look. Point at a choice to see it in the picture.</span></div>
      <PinnedPreview id="look-type" label="Preview" size={300} preview={<LiveSample a={pictured} mark="type" />}>
      <div className="ap-type-set">
      <p className="ap-changes">{looksOption("density").changes}</p>
      <div className="ap-row">
        <span className="ap-l">Density</span>
        <div className="ap-seg" role="radiogroup" aria-label="Density">
          {DENSITIES.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={a.density === d.id} className={a.density === d.id ? "on" : ""} title={d.note}
              onClick={() => set({ lookDensity: d.id })} {...point({ density: d.id })}>{d.label}</button>
          ))}
        </div>
      </div>
      <p className="ap-fine">{DENSITIES.find((d) => d.id === a.density)?.note}{!st.lookDensity && spec.density ? ` (${spec.label}'s own)` : ""}</p>
      <p className="ap-changes">{looksOption("textSize").changes}</p>
      <div className="ap-row">
        <span className="ap-l">Text size</span>
        <div className="ap-seg" role="radiogroup" aria-label="Text size">
          {TEXT_SIZES.map((s) => (
            <button key={s.v} type="button" role="radio" aria-checked={a.text === s.v} className={a.text === s.v ? "on" : ""}
              onClick={() => set({ lookText: s.v })} style={{ fontSize: `${Math.round(12 * s.v / 100)}px` }} {...point({ text: s.v })}>{s.label}</button>
          ))}
        </div>
      </div>
      <p className="ap-changes">{looksOption("font").changes}</p>
      <div className="ap-row top">
        <span className="ap-l">Font</span>
        <div className="ap-fonts" role="radiogroup" aria-label="Font">
          <button type="button" role="radio" aria-checked={!a.font} className={!a.font ? "on" : ""} onClick={() => set({ lookFont: null })} title={`${spec.label}'s own font`} {...point({ font: null })}>
            <b style={{ fontFamily: ownFont.css }}>Aa</b><span>Look's own</span><em>{ownFont.label}</em></button>
          {FONTS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={a.font === f.id} className={a.font === f.id ? "on" : ""} onClick={() => set({ lookFont: f.id })} title={f.note} {...point({ font: f.id })}>
              <b style={{ fontFamily: f.css }}>Aa</b><span>{f.label}</span></button>
          ))}
        </div>
      </div>
      </div>
      </PinnedPreview>
    </div>
  );
}

/** A small live list in one appearance (core/looksample.ts sampleVars): the title with its + button, a ticked task, a
 *  selected task with its priority, and a switch. `mark` says which part the card changes: the accent ("accent": the
 *  button, tick, selection and switch are labelled) or the words and spacing ("type"). */
function LiveSample({ a, mark }: { a: Appearance; mark: "accent" | "type" }) {
  return (
    <div className={`ap-live m-${mark}`} style={sampleVars(a) as CSSProperties} aria-hidden="true">
      <div className="ap-live-h"><b>Mission agenda</b><i className="ap-live-add">+</i></div>
      <div className="ap-live-row done"><i className="ap-live-tick on" /><span>Call Jo back</span></div>
      <div className="ap-live-row sel"><i className="ap-live-tick" /><span>Send the proposal</span><em className="ap-live-p">P1</em></div>
      <div className="ap-live-row"><i className="ap-live-tick" /><span>Book the dentist</span></div>
      <div className="ap-live-sw"><span>Sounds</span><i className="ap-live-tog"><b /></i></div>
      {mark === "accent" && <div className="ap-live-key"><span>Button</span><span>Tick</span><span>Selected</span><span>Switch</span></div>}
    </div>
  );
}
