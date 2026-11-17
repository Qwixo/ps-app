// The volume mixer's AirPods row (PS only, in its gear until 1.65): "Switch to AirPods Max when connected" and "Give AirPods button
// back to Spotify" (called "Reconfigure AirPods Max" until 4 Nov 2026, which the developer found unclear).
// One click hands the AirPods play and pause button back to Spotify (or Music): PS makes it the Now
// Playing app without a sound (Sources/MediaGuard.swift). Click only.
// Every account has the button (V1.40, the developer: only Numerology and the PS rules stay his). "Switch to AirPods Max when
// connected" is the developer's own (AutoRoute.swift, his AirPods Max and USB mic): anyone else has Audio priority (the ordered lists in the mixer, PS 1.65) instead.
import { useEffect, useState } from "react";
import { PS, psPost } from "../ps";
import { sfx } from "../ui/sfx";

let answer: ((t: string, ok: boolean) => void) | null = null;
let autoOn: ((on: boolean) => void) | null = null;
if (typeof window !== "undefined") {
  (window as Window & { __psAirpods?: unknown }).__psAirpods = (t: unknown, ok: unknown) => { if (typeof t === "string") answer?.(t.slice(0, 200), ok === true); };
  // Switch to AirPods Max when connected (Sources/AutoRoute.swift): its on or off, from the PS app.
  (window as Window & { __psAirpodsAuto?: unknown }).__psAirpodsAuto = (on: unknown) => { if (typeof on === "boolean") autoOn?.(on); };
}

export function AirPodsFix({ red = false }: { red?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ t: string; ok: boolean } | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => {
    answer = (t, ok) => { setBusy(false); setNote({ t, ok }); };
    autoOn = (on) => setAuto(on);
    if (PS && red) psPost({ type: "airpodsAuto:get" });
    return () => { answer = null; autoOn = null; };
  }, [red]);
  useEffect(() => { if (!note?.ok) return; const k = window.setTimeout(() => setNote(null), 5000); return () => window.clearTimeout(k); }, [note]);
  if (!PS) return null;
  // At the bottom of the volume mixer (views/Mixer.tsx; PS 1.65 took its gear away).
  return (
    <div className="mix-airpods">
      {red && <div className="mix-gr tm-airpods-auto"><span>AirPods</span>
        <button type="button" className={`mix-chip${auto === true ? " on" : ""}`} role="radio" aria-checked={auto === true} disabled={auto === null}
          onClick={() => { if (auto !== true) { sfx.click(); setAuto(true); psPost({ type: "airpodsAuto", on: true }); } }}>On</button>
        <button type="button" className={`mix-chip${auto === false ? " on" : ""}`} role="radio" aria-checked={auto === false} disabled={auto === null}
          onClick={() => { if (auto !== false) { sfx.click(); setAuto(false); psPost({ type: "airpodsAuto", on: false }); } }}>Off</button>
        <em>Switch to AirPods Max when connected</em>
      </div>}
      <div className="mix-gr"><span>{red ? "" : "AirPods"}</span>
        <button type="button" className="mix-chip mix-reconf" disabled={busy} onClick={(e) => { if (e.button !== 0) return; sfx.click(); setBusy(true); setNote(null); psPost({ type: "airpods" }); }}>
          {busy ? "Giving it back…" : "Give AirPods button back to Spotify"}
        </button>
      </div>
      <span className="mix-air-why">When a browser tab takes your AirPods play and pause button, this hands it back to Spotify, silently.</span>
      {note && <span className="mix-air-note" role="status" style={note.ok ? { color: "#A7F3D0" } : undefined}>{note.t}</span>}
    </div>
  );
}
