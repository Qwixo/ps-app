// Settings, Notifications (V1.36, the developer 5 Nov 2026): the cards at the top right of the Mac, one card here per kind
// (Claude chats finished, client emails, lead replies, meetings, other alerts). Each has a live preview of the real
// card, its colour (As now, presets or your own; the whole card follows the one colour, core/notelook.ts cardTones),
// sound On or Off and which sound, with a play button beside each. Saved in settings.noteLook through cleanLooks
// (ps.ts); the Mac's stack repaints at once (src/notelook.ts -> ps-mac Toast.swift). Click only, like every setting.
// Its own classes start with nl (notification look).
import { useEffect, useState, type CSSProperties } from "react";
import type { Settings } from "../core/model";
import { NOTE_COLORS, NOTE_DEFAULTS, NOTE_KINDS, NOTE_NOW, NOTE_SOUNDS, cardTones, notePref, withNotePref, type NoteKind, type NotePref, type NoteResolved, type NoteSoundId, type NoteTones } from "../core/notelook";
import { p1Color } from "../core/prio";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { GsCard } from "./SettingsScreen";
import { taskMapActions } from "./TaskMap";
import "./notelook.css";

type Kind = (typeof NOTE_KINDS)[number];

/** The page: one wide card per kind, one under the other (the preview left, its colour and sound right). */
export function NotifyPage() {
  const st = settingsData(useVault());
  return (
    <div className="gs-list nl-cols">
      {NOTE_KINDS.map((k) => <NoteKindCard key={k.id} kind={k} st={st} />)}
    </div>
  );
}

const ICON: Record<NoteKind, string> = {
  done: "M5 12.5l4.5 4.5L19 7.5",
  mail: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM4 7.5l8 5.5 8-5.5",
  lead: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v4",
  meet: "M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 15l2 2 4-4",
  other: "",
};

/** The card as the Mac draws it, in these tones (every colour comes in here; notelook.css names none). */
export function NotePreview({ kind, tones }: { kind: Kind; tones: NoteTones }) {
  const k = kind.id, plain = k === "other";
  const style = {
    "--nl-c": tones.c, "--nl-top": tones.top, "--nl-bot": tones.bot, "--nl-icbg": tones.icBg, "--nl-ic": tones.ic, "--nl-sub": tones.sub,
    "--nl-rem": tones.rem, "--nl-line": tones.line, "--nl-btn": tones.btn, "--nl-ink": tones.ink,
    "--nl-fg": "#ffffff", "--nl-b": "rgba(255,255,255,.86)", "--nl-dim": "rgba(255,255,255,.5)", "--nl-chip": "rgba(255,255,255,.14)",
    "--nl-chipline": "rgba(255,255,255,.28)", "--nl-white": "rgba(255,255,255,.92)", "--nl-dark": "#17121a", "--nl-shadow": "rgba(0,0,0,.34)",
  } as CSSProperties;
  return (
    // Keyed by its colour: a new colour plays the arrival sheen again, like a fresh card.
    <div key={tones.c + tones.top} className={`nl-card${plain ? " plain" : ""}`} style={style} role="img" aria-label={`Preview: ${kind.sample.title}`}>
      <div className="nl-h">
        {plain ? <span className="nl-dot" /> : (
          <span className="nl-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[k]} /></svg></span>
        )}
        <span className="nl-t">{kind.sample.title}</span>
        <span className="nl-when">now</span>
      </div>
      <div className="nl-sub">{kind.sample.sub}</div>
      {kind.sample.body && <div className="nl-b">{kind.sample.body}</div>}
      {k === "meet" && <span className="nl-cd">In 1 day</span>}
      {(k === "done" || k === "mail" || k === "lead") && (
        <div className="nl-acts">
          {k === "mail" && <span className="nl-btn main">Open in Gmail</span>}
          {k === "lead" && <span className="nl-btn main">Open in Instantly</span>}
          <span className="nl-btn rem">Remind me in <i>{k === "done" ? "2 mins" : "15 mins"}</i></span>
          <span className="nl-btn dis">Dismiss</span>
        </div>
      )}
    </div>
  );
}

function NoteKindCard({ kind, st }: { kind: Kind; st: Settings }) {
  const p = notePref(st, kind.id), d = NOTE_DEFAULTS[kind.id];
  const tones = p.color ? cardTones(p.color) : NOTE_NOW[kind.id];
  const shown = p.color ?? kind.def;
  const [hex, setHex] = useState(shown);
  useEffect(() => { setHex(shown); }, [shown]);
  const save = (patch: NotePref) => { void taskMapActions.looks({ noteLook: withNotePref(st, kind.id, patch) }); };
  const pickColor = (c: string | null) => { sfx.hover(); save({ color: c }); };
  const typed = (v: string) => { setHex(v); const c = p1Color(v); if (c && c !== p.color) pickColor(c); };
  const changed = p.color !== d.color || p.on !== d.on || p.sound !== d.sound;
  return (
    <GsCard className={`nl-kind nl-${kind.id}`} title={kind.label} note={kind.hint}>
      <NotePreview kind={kind} tones={tones} />
      {/* The controls in one block: on a wide screen they sit to the right of the preview (notelook.css). */}
      <div className="nl-ctl">
      <span className="nl-lbl">Colour</span>
      <div className="tm-addset-sw nl-sw" role="radiogroup" aria-label={`${kind.label} colour`}>
        <button type="button" role="radio" aria-checked={!p.color} className={`nl-now${!p.color ? " on" : ""}`} title={kind.byKind ? "Each alert keeps its own colour, as now" : "The colour it has now"}
          onClick={() => { if (p.color) pickColor(null); }}>{kind.byKind ? "By kind" : "As now"}</button>
        {NOTE_COLORS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={p.color === c.id} aria-label={c.label} title={c.label}
            className={`tm-addset-dot${p.color === c.id ? " sel" : ""}`} style={{ ["--sw" as string]: c.id }} onClick={() => pickColor(c.id)} />
        ))}
        <label className="tm-addset-own" title="Your own colour">
          <input type="color" value={shown} aria-label={`${kind.label}: your own colour`} onChange={(e) => typed(e.target.value)} />
        </label>
        <input type="text" className="tm-addset-hex" value={hex} maxLength={7} spellCheck={false} aria-label={`${kind.label}: colour code`}
          onChange={(e) => typed(e.target.value)} onBlur={() => setHex(shown)} />
      </div>
      <span className="nl-lbl">Sound</span>
      <div className="tm-ed-seg" role="radiogroup" aria-label={`${kind.label} sound`}>
        <button type="button" role="radio" aria-checked={p.on} className={`dwell${p.on ? " on" : ""}`} onClick={() => { if (!p.on) { save({ on: true }); sfx.notePreview(p.sound); } }}>On</button>
        <button type="button" role="radio" aria-checked={!p.on} className={`dwell${!p.on ? " on" : ""}`} onClick={() => { if (p.on) { sfx.hover(); save({ on: false }); } }}>Off</button>
      </div>
      <SoundChips kind={kind} p={p} pick={(id) => { save({ sound: id, on: true }); sfx.notePreview(id); }} />
      {changed && (
        <button type="button" className="nl-reset" onClick={() => { sfx.click(); void taskMapActions.looks({ noteLook: withNotePref(st, kind.id, { ...d }) }); }}>
          Back to how it was
        </button>
      )}
      </div>
    </GsCard>
  );
}

/** Which sound: a chip each with its play button (picking one also turns the sound on). */
function SoundChips({ kind, p, pick }: { kind: Kind; p: NoteResolved; pick: (id: NoteSoundId) => void }) {
  const list: { id: NoteSoundId; label: string }[] = [...(kind.id === "meet" ? [{ id: "kind" as const, label: "By kind" }] : []), ...NOTE_SOUNDS];
  return (
    <div className={`tm-snd nl-snd${p.on ? "" : " off"}`} role="radiogroup" aria-label={`${kind.label}: which sound`}>
      {list.map((x) => {
        const on = p.sound === x.id;
        return (
          <span key={x.id} className={`tm-snd-i${on ? " on" : ""}`}>
            <button type="button" role="radio" aria-checked={on} className="tm-snd-pick" title={x.id === "kind" ? "Booked, a message before a call and 10 minutes before each keep their own sound" : undefined}
              onClick={() => { if (!on || !p.on) pick(x.id); else sfx.notePreview(x.id); }}>{x.label}</button>
            <button type="button" className="tm-snd-play" aria-label={`Play ${x.label}`} title={`Play ${x.label}`} onClick={() => sfx.notePreview(x.id)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
            </button>
          </span>
        );
      })}
    </div>
  );
}
