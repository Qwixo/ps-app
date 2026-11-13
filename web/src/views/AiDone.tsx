// Settings, Notifications, AI chat finished cards (V1.53, the developer 12 Nov 2026: every PS user gets the "Claude finished"
// card, and other AI tools too). One row per tool PS can hear from on this Mac, each with its own On and Off.
// PS on the Mac does the work (ps-mac Sources/AiDone.swift): On puts a small hook into that tool's own settings,
// keeping everything already there and a backup beside it; Off takes out exactly what PS put in. The state comes in
// psSettings.aiDone and a click goes out as {type:"aiDone:set", tool, on}. Click only, like every setting.
// Its own classes start with ai-.
import { psPost } from "../ps";
import { sfx } from "../ui/sfx";
import { Choice } from "./TaskMap";
import "./aidone.css";

/** One tool as PS on the Mac describes it. */
export interface AiDoneTool {
  id: string;
  name: string;
  /** The tool is on this Mac. */
  found: boolean;
  on: boolean;
  /** Cards already come from a hook of the person's own (the developer's Claude Code hook): PS leaves it alone. */
  own?: boolean;
  /** Working on it (a click is being carried out). */
  busy?: boolean;
  /** One plain line from the Mac: what to do next, or why it could not. */
  note?: string;
}
export interface AiDoneState { tools: AiDoneTool[] }

/** The line under a tool's name. */
export function aiDoneLine(t: AiDoneTool): string {
  if (t.note) return t.note;
  if (t.own) return "On through your own hook. PS leaves it alone.";
  if (!t.found) return `${t.name} is not on this Mac.`;
  // Open source build: every tool starts Off; nothing is written into its settings until On is clicked here.
  return t.on ? "On. A card shows when a chat finishes." : "Off. On adds one line to its settings and keeps a backup of the file.";
}

export function AiDoneSettings({ state }: { state: AiDoneState | undefined }) {
  if (!state?.tools?.length) return <p className="gs-set-note">Checking this Mac…</p>;
  return (
    <div className="ai-list">
      {state.tools.map((t) => (
        <div key={t.id} className={`ai-row${t.found || t.on ? "" : " ai-missing"}`}>
          <div className="ai-text">
            <span className="ai-name">{t.name}</span>
            <span className="ai-line" role="status">{aiDoneLine(t)}</span>
          </div>
          {!t.own && (t.found || t.on) && (
            <div className={`tm-ed-seg${t.busy ? " gs-notyet" : ""}`} role="radiogroup" aria-label={t.name}>
              <Choice selected={t.on} onPick={() => { if (!t.busy) { sfx.hover(); psPost({ type: "aiDone:set", tool: t.id, on: true }); } }}>On</Choice>
              <Choice selected={!t.on} onPick={() => { if (!t.busy) { sfx.hover(); psPost({ type: "aiDone:set", tool: t.id, on: false }); } }}>Off</Choice>
            </div>
          )}
        </div>
      ))}
      <p className="gs-set-note ai-foot">The chat's name only, never what it did. It goes from this Mac straight into your encrypted list, never through a server. The ChatGPT and Claude apps have no way to say a chat finished, so they cannot show a card.</p>
    </div>
  );
}
