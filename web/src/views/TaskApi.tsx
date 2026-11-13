// Settings > AI task API (the developer, 12 Nov 2026: "make the API have a dedicated tab in settings and set up the scope with
// everything changeable via API. Make the API also have a copy to clipboard button to copy a bunch of text to just paste
// to AI like Claude Code or GPT Codex"). For everyone, the public PS too; Mac only (the API runs in PS on the Mac).
// On or off, where it listens, the key (Show, Copy, New key), one switch per thing an AI may do, a one line safety
// note, and the big Copy for AI button. The key never lives in this page: PS on the Mac copies it (and the Copy for AI
// text with the key filled in) to the clipboard itself, and shows it here for 30 seconds only when asked.
// Rules: core/taskapi.ts. The text: core/taskapidoc.ts. The Mac's half: ps-mac TaskApi.swift.
import { useEffect, useState } from "react";
import { PS, psPost, usePsSettings } from "../ps";
import { sfx } from "../ui/sfx";
import { API_PORT, SCOPES, cleanScopes, type ScopeId, type Scopes } from "../core/taskapi";
import { copyAiGuide, hideApiKey, useShownApiKey } from "../taskapi";
import { ConnectAi } from "./AiMessage";
import "./taskapi.css";

const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

export function TaskApiSettings() {
  const ps = usePsSettings();
  const api = ps?.taskApi;
  const shown = useShownApiKey();
  const [sure, setSure] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 5000); return () => clearTimeout(t); }, [sure]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2200); return () => clearTimeout(t); }, [flash]);
  useEffect(() => () => hideApiKey(), []);

  if (!PS) return <p className="api-soft">The AI task API runs in PS app on your Mac: open Settings there to switch it on.</p>;
  if (!api) return <p className="api-soft">Waiting for PS app...</p>;

  const scopes: Scopes = cleanScopes(api.scopes);
  const port = api.port || API_PORT;
  const set = (p: { on?: boolean; scopes?: Scopes }) => { sfx.click(); psPost({ type: "api:set", ...p }); };
  const flip = (id: ScopeId) => set({ scopes: { ...scopes, [id]: !scopes[id] } });
  const copyGuide = () => {
    sfx.click();
    copyAiGuide(api);   // the same copy the "new in this version" pop-up uses (taskapi.ts)
    setFlash("guide");
  };
  const status = !api.on ? { t: "Off", c: "" } : api.running ? { t: "On, listening", c: "good" } : { t: "Not running", c: "bad" };

  return (
    <div className="api-wrap">
      <p className="api-intro">Lets an AI on this Mac, like Claude Code or Codex, add and manage your tasks while PS app is open. What it adds lands in the <b>AI Inbox</b> in Dimension X, marked with a small AI badge, and you move it wherever you like.</p>

      <div className="api-top">
        <button type="button" role="switch" aria-checked={api.on} className={`api-sw big${api.on ? " on" : ""}`} onClick={() => set({ on: !api.on })}>
          <i aria-hidden="true" /><span>{api.on ? "API on" : "API off"}</span>
        </button>
        <span className={`api-pill ${status.c}`} role="status">{status.t}</span>
        {api.on && api.running ? <code className="api-url">http://127.0.0.1:{port}</code> : null}
        {api.on && api.error ? <span className="api-bad">{api.error}</span> : null}
      </div>
      {api.last ? <p className="api-soft">Last request {ago(api.last.at)}: <code>{api.last.what}</code> answered {api.last.status}.{api.count ? ` ${api.count} since PS app started.` : ""}</p> : null}

      <section className="api-card" aria-label="API key">
        <h4>API key</h4>
        <div className="api-row">
          <code className={`api-key${shown ? " shown" : ""}`} aria-label={shown ? "API key" : "API key, hidden"}>{shown ?? (api.keyTail ? `ps_${"•".repeat(16)}${api.keyTail}` : "No key yet: switch the API on")}</code>
          {api.keyTail ? <>
            <button type="button" className="btn quiet sm" onClick={() => { sfx.click(); if (shown) hideApiKey(); else psPost({ type: "api:show" }); }}>{shown ? "Hide" : "Show"}</button>
            <button type="button" className="btn quiet sm" onClick={() => { sfx.click(); psPost({ type: "api:copyKey" }); setFlash("key"); }}>{flash === "key" ? "Copied" : "Copy"}</button>
            <button type="button" className={`btn quiet sm${sure ? " danger" : ""}`} onClick={() => {
              if (!sure) { sfx.click(); setSure(true); return; }
              setSure(false); hideApiKey(); sfx.click(); psPost({ type: "api:regen" });
            }}>{sure ? "Sure? Old key stops working" : "New key"}</button>
          </> : null}
        </div>
        <p className="api-soft">Kept in this Mac's Keychain only. An AI sends it with every request; a new key locks out every AI that has the old one.</p>
      </section>

      <section className="api-card" aria-label="What an AI may do">
        <h4>What an AI may do</h4>
        {(["where", "what"] as const).map((g) => (
          <div key={g} className="api-scopes">
            <span className="api-group">{g === "where" ? "Where" : "What"}</span>
            {SCOPES.filter((s) => s.group === g).map((s) => (
              <button key={s.id} type="button" role="switch" aria-checked={scopes[s.id]} className={`api-scope${scopes[s.id] ? " on" : ""}`} onClick={() => flip(s.id)}>
                <span className="api-sw" aria-hidden="true"><i /></span>
                <span className="api-sl"><b>{s.label}</b><em>{s.line}</em></span>
              </button>
            ))}
          </div>
        ))}
        <p className="api-note" role="note">Only apps on this Mac that have the key can use it, and web pages never can. Anything switched on here, an AI can do without asking you first.</p>
      </section>

      <button type="button" className={`api-copy${flash === "guide" ? " done" : ""}`} onClick={copyGuide} disabled={!api.keyTail}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {flash === "guide" ? <path d="M5 12l5 5L20 7" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
        </svg>
        <span><b>{flash === "guide" ? "Copied. Paste it into your AI" : "Copy for AI"}</b>
          <em>{api.keyTail ? "Everything an AI needs: the address, your key, every endpoint with examples, and what is switched on. Paste it into Claude Code, Codex or any AI." : "Switch the API on first: that makes your key."}</em></span>
      </button>

      <ConnectAi api={api} scopes={scopes} flip={() => flip("message")} />
    </div>
  );
}
