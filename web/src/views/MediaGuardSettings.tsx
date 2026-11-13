// PS > Settings > AirPods card (the developer, 23 Oct 2026). Kept by the PS app on this Mac
// (Sources/MediaGuard.swift): one switch, off by default. Click only.
import { psPost, usePsSettings, type PsSettings } from "../ps";

export function MediaGuardSettings() {
  const st = usePsSettings() as (PsSettings & { mediaGuard?: { on: boolean } }) | null;
  const g = st?.mediaGuard;
  const set = (on: boolean) => { if (g && g.on !== on) psPost({ type: "mediaGuard", on }); };
  return (
    <section className="panel stack" aria-labelledby="mg-h">
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 className="h2" id="mg-h">AirPods card</h2>
        {g && <span className={`pill ${g.on ? "good" : "ink"}`}>{g.on ? "On" : "Off"}</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        When a browser tab takes your AirPods play and pause button and never answers (you hear the error sound), PS app gives
        the button back to Spotify by itself and shows a short card saying so. Off by default: "Give AirPods button back to
        Spotify" is always in the volume mixer's gear. PS app only reads the Mac's media log while this is on.
      </p>
      <div className="tabs" role="radiogroup" aria-label="AirPods button card on or off" style={{ justifySelf: "start" }}>
        <button className="tab" role="radio" aria-checked={!!g?.on} aria-selected={!!g?.on} disabled={!g} onClick={() => set(true)}>On</button>
        <button className="tab" role="radio" aria-checked={!!g && !g.on} aria-selected={!!g && !g.on} disabled={!g} onClick={() => set(false)}>Off</button>
      </div>
    </section>
  );
}
