// PS GOS settings pieces: the switches, rows and permission rows the phone's settings are drawn with. Until V1.46 they
// made one long sheet that slid up from the dock (the developer, 10 Nov 2026: "I don't like how cluttered it is"). Since V1.47 each
// phone setting is a row of the same Settings as the Mac (gos/PhoneRows.tsx, core/settingsindex.ts), built from these.
import { type ReactNode } from "react";
import { gos, haptic, type GosPerms, type GosPrefs } from "./bridge";
import { GOS_LAYOUTS, useGosLayout, type GosLayout } from "./layout";

export const OPENERS: { k: GosPrefs["open"]; t: string; d: string }[] = [
  { k: "tile", t: "Quick Settings tile", d: "Swipe down twice and tap PS app. Works from any app and on top of the lock screen menu." },
  { k: "notification", t: "Quiet notification", d: "A silent PS app line in your notification shade. Tap it, or Add task." },
  { k: "widget", t: "Home screen widget", d: "Your top tasks on the home screen. Hold the home screen, Widgets, PS app." },
  { k: "bubble", t: "Floating bubble", d: "A small PS app bubble over other apps. Needs Display over other apps. Never over Signal or 1Password." },
];

/** Layout: four looks for the list, each with a small drawing of itself. Applies at once (a crossfade). */
export function LayoutPicker({ bare = false }: { bare?: boolean }) {
  const [now, set] = useGosLayout();
  return (
    <section className="gos-group">
      {!bare && <h3>Layout</h3>}
      <div className="gos-lay" role="radiogroup" aria-label="List layout">
        {GOS_LAYOUTS.map((l) => (
          <button key={l.k} type="button" role="radio" aria-checked={now === l.k} className={`gos-lay-o${now === l.k ? " on" : ""}`} onClick={() => set(l.k)}>
            <LayoutDrawing k={l.k} />
            <span className="gos-lay-t">{l.t}</span>
            <span className="gos-lay-d">{l.d}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
function LayoutDrawing({ k }: { k: GosLayout }) {
  const rows = k === "focus" ? ["hero", "r", "r", "r"] : k === "cards" ? ["r", "r", "r"] : ["r", "r", "r", "r", "r"];
  return (
    <span className={`gos-lay-pic ${k}`} aria-hidden="true">
      {rows.map((r, i) => <i key={i} className={r}><b /><em /></i>)}
    </span>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="gos-group"><h3>{title}</h3><div className="gos-card">{children}</div></section>;
}
export function Row({ title, desc, right, extra }: { title: string; desc?: string; right?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="gos-row">
      <div className="gos-row-main">
        <div className="gos-row-t">{title}</div>
        {desc && <div className="gos-row-d">{desc}</div>}
        {extra}
      </div>
      {right && <div className="gos-row-r">{right}</div>}
    </div>
  );
}
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`gos-switch${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}
export function PermBtn({ which, text }: { which: keyof GosPerms; text: string }) {
  return <button type="button" className="gos-btn sm" onClick={() => { haptic("press"); gos.openPermission(which); }}>{text}</button>;
}
export function PermRow({ perms, which, title, desc }: { perms: GosPerms | null; which: keyof GosPerms; title: string; desc: string }) {
  const ok = !!perms?.[which];
  return (
    <Row title={title} desc={desc}
      right={ok ? <span className="gos-ok">Allowed</span> : <button type="button" className="gos-btn sm" onClick={() => { haptic("press"); gos.openPermission(which); }}>Allow</button>} />
  );
}
