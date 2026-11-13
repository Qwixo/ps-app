// Messages from AIs on the Dynamic Island (V1.58, the developer 13 Nov 2026: "I want to be able to paste the API to any AI ... and I
// want the AI to write to me at the end of each chat instead of the AI completion cards"). Two pieces of Settings:
// - AiNotesChoice: what pops up when an AI chat ends: AI messages (a chat that sends none keeps its plain card), Plain
//   finished cards, or Off. One synced setting (settings.aiNotes, core/aimessage.ts), shown in Notifications beside the AI
//   chat finished cards and in the AI task API's Connect your AI box.
// - ConnectAi (Settings, AI task API): the "Send you messages" switch, the choice above, an honest line on which AIs can
//   do it, and one Copy button: a short rule the AI saves to its own memory (CLAUDE.md, AGENTS.md) with the curl command.
//   The key is filled in by PS on the Mac as it copies (ps-mac TaskApi.swift fillGuide): this page never has it.
// Click only, like every setting. Its own classes start with am-.
import { useEffect, useState } from "react";
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { saveSettings } from "../core/actions";
import { AI_NOTES, aiNotesMode } from "../core/aimessage";
import type { Scopes } from "../core/taskapi";
import { copyAiConnect } from "../taskapi";
import "./aimessage.css";

export const AI_NOTES_LABEL = "When an AI chat ends";
/** The plain words on who can use it (the API only listens on this Mac). */
export const CONNECT_WHO = "Works with AIs that run on this Mac and can run commands, like Claude Code and Codex. ChatGPT or Claude in a browser or the phone app cannot reach it, because the API only listens on this Mac.";

export function AiNotesChoice() {
  const mode = aiNotesMode(settingsData(useVault()).aiNotes);
  const cur = AI_NOTES.find((x) => x.id === mode)!;
  return (
    <div className="am-row" role="group" aria-label={AI_NOTES_LABEL}>
      <span className="am-l">{AI_NOTES_LABEL}<em role="status">{cur.line}</em></span>
      <div className="am-chips" role="radiogroup" aria-label={AI_NOTES_LABEL}>
        {AI_NOTES.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={mode === x.id} className={`am-chip${mode === x.id ? " sel" : ""}`}
            onClick={() => { if (mode !== x.id) { sfx.click(); void saveSettings({ aiNotes: x.id }); } }}>{x.label}</button>
        ))}
      </div>
    </div>
  );
}

/** Settings, AI task API: the Connect your AI box. `api` is psSettings.taskApi; `flip` turns the message switch. */
export function ConnectAi({ api, scopes, flip }: { api: { on?: boolean; keyTail?: string | null; port?: number }; scopes: Scopes; flip: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2200); return () => clearTimeout(t); }, [copied]);
  const ready = !!api.keyTail;
  return (
    <section className="api-card am-connect" aria-label="Connect your AI">
      <h4>Connect your AI</h4>
      <p className="api-soft am-lead">Your AI can message you on the Dynamic Island when it finishes a task, like "Fixed the login bug, tests pass", instead of the plain "chat finished" card. Click the message to read the rest.</p>
      <p className="am-who" role="note">{CONNECT_WHO}</p>
      <button type="button" role="switch" aria-checked={scopes.message} className={`api-scope${scopes.message ? " on" : ""}`} onClick={flip}>
        <span className="api-sw" aria-hidden="true"><i /></span>
        <span className="api-sl"><b>Send you messages</b><em>{scopes.message ? "On. An AI with your key can pop a message up on the island." : "Off. Switch it on so your AI's messages show."}</em></span>
      </button>
      <AiNotesChoice />
      <button type="button" className={`am-copy${copied ? " done" : ""}`} disabled={!ready} onClick={() => { sfx.click(); copyAiConnect(api); setCopied(true); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {copied ? <path d="M5 12l5 5L20 7" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
        </svg>
        <span><b>{copied ? "Copied. Paste it into your AI" : "Copy for your AI"}</b>
          <em>{ready ? "A short rule your AI saves to its own memory (Claude Code: CLAUDE.md, Codex: AGENTS.md), with your key filled in as it copies." : "Switch the API on first: that makes your key."}</em></span>
      </button>
    </section>
  );
}
