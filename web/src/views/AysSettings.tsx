// PS > Settings > Are you sure (the developer, 24 Oct 2026). Kept by the PS app on this Mac
// (Sources/AreYouSure.swift): on or off, which sites ask first (YouTube and Netflix to start), how
// long the countdown runs, how long a pass lasts, the phrase that lets him straight in, and today's
// count of cards and passes (this Mac only). Click only: buttons, plus a box to type a site or phrase.
import { useEffect, useState } from "react";
import { psPost, usePsSettings, type PsSettings } from "../ps";

type AysPrefs = { on: boolean; sites: string[]; countdown: number; pass: number; phrase: string; button?: string; today: { prompts: number; passes: number }; passLeft: number };
/** The card's button words when nothing was typed (ps-mac AreYouSure.defaultButton); {site} is the site's name. */
const DEFAULT_BUTTON = "Continue to {site}";
const COUNTDOWNS = [5, 10, 15, 20, 30, 60];
const PASSES: [number, string][] = [[10, "10 min"], [15, "15 min"], [20, "20 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1.5 hours"], [120, "2 hours"]];
const set = (patch: Record<string, unknown>) => psPost({ type: "ays", ...patch });

export function AysSettings() {
  const st = usePsSettings() as (PsSettings & { ays?: AysPrefs }) | null;
  const a = st?.ays;
  const [site, setSite] = useState("");
  const [phrase, setPhrase] = useState("");
  useEffect(() => { if (a?.phrase) setPhrase(a.phrase); }, [a?.phrase]);
  const [button, setButton] = useState(DEFAULT_BUTTON);
  useEffect(() => { if (a?.button) setButton(a.button); }, [a?.button]);
  const sites = a?.sites ?? [];
  // Several at once (the developer, 10 Nov 2026): names or domains, split by commas (so a name like Prime Video stays whole).
  const addSite = () => {
    const next = [...sites];
    for (const raw of site.split(/[,;\n]+/)) {
      const v = raw.trim().slice(0, 40);
      if (v && !next.some((s) => s.toLowerCase() === v.toLowerCase())) next.push(v);
    }
    if (next.length !== sites.length) set({ sites: next.slice(0, 20) });
    setSite("");
  };
  const phraseOk = phrase.trim().length >= 3 && phrase.trim().length <= 80;
  return (
    <section className="panel stack" aria-labelledby="ays-h">
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 className="h2" id="ays-h">Are you sure</h2>
        {a && <span className={`pill ${a.on ? "good" : "ink"}`}>{a.on ? "On" : "Off"}</span>}
        {a && a.passLeft > 0 && <span className="pill amber num">Pass: {a.passLeft} min left</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        When one of these sites comes to the front in your browser, a card asks "Are you sure?" with a countdown. Leave the
        site and it goes away. When the countdown ends, Continue lets you in, or type your phrase to go in straight away.
        Then you have a pass, and it asks again when the pass runs out. PS only checks the browser window's title against
        this list and keeps nothing of it. It never looks while 1Password or Signal is in front, and it stays off during
        meetings and calls.
      </p>
      <div className="tabs" role="radiogroup" aria-label="Are you sure on or off" style={{ justifySelf: "start" }}>
        <button className="tab" role="radio" aria-checked={!!a?.on} aria-selected={!!a?.on} disabled={!a} onClick={() => { if (!a?.on) set({ on: true }); }}>On</button>
        <button className="tab" role="radio" aria-checked={!!a && !a.on} aria-selected={!!a && !a.on} disabled={!a} onClick={() => { if (a?.on) set({ on: false }); }}>Off</button>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Sites that ask first</span>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {sites.map((s) => (
            <span key={s} className="pill ink" style={{ gap: 6 }}>
              {s}
              <button type="button" className="btn quiet sm" style={{ padding: "0 6px", minHeight: 0 }} aria-label={`Remove ${s}`} disabled={!a}
                onClick={() => set({ sites: sites.filter((x) => x !== s) })}>Remove</button>
            </span>
          ))}
          {a && sites.length === 0 && <small className="hint">None: nothing asks first.</small>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="input" value={site} maxLength={40} placeholder="Names or domains, eg twitch.com, x.com, Reddit" style={{ maxWidth: 360 }} disabled={!a}
            onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addSite(); }} />
          <button className="btn ghost sm" disabled={!a || !site.trim()} onClick={addSite}>Add</button>
          {a && !(sites.includes("YouTube") && sites.includes("Netflix")) && (
            <button className="btn quiet sm" onClick={() => set({ sites: [...new Set([...sites, "YouTube", "Netflix"])] })}>Add YouTube and Netflix back</button>
          )}
        </div>
        <small className="hint">Type as many as you like, split by commas, then Add. Up to 20. A domain counts by its name in the tab title (x.com is X).</small>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }} id="ays-c">Countdown</span>
        <div className="tabs" role="radiogroup" aria-labelledby="ays-c" style={{ justifySelf: "start", flexWrap: "wrap" }}>
          {COUNTDOWNS.map((s) => (
            <button key={s} className="tab" role="radio" aria-checked={a?.countdown === s} aria-selected={a?.countdown === s} disabled={!a}
              onClick={() => { if (a?.countdown !== s) set({ countdown: s }); }}>{s} sec</button>
          ))}
        </div>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }} id="ays-p">A pass lasts</span>
        <div className="tabs" role="radiogroup" aria-labelledby="ays-p" style={{ justifySelf: "start", flexWrap: "wrap" }}>
          {PASSES.map(([m, l]) => (
            <button key={m} className="tab" role="radio" aria-checked={a?.pass === m} aria-selected={a?.pass === m} disabled={!a}
              onClick={() => { if (a?.pass !== m) set({ pass: m }); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>The phrase that lets you straight in</span>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="input" value={phrase} maxLength={80} style={{ maxWidth: 360 }} disabled={!a} aria-label="Phrase" onChange={(e) => setPhrase(e.target.value)} />
          <button className="btn ghost sm" disabled={!a || !phraseOk || phrase.trim() === a?.phrase} onClick={() => set({ phrase: phrase.trim() })}>Save</button>
        </div>
        <small className="hint">Capitals, spaces and the punctuation at the end do not matter.</small>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>The button on the card</span>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="input" value={button} maxLength={40} style={{ maxWidth: 360 }} disabled={!a} aria-label="Button words" onChange={(e) => setButton(e.target.value)} />
          <button className="btn ghost sm" disabled={!a || !button.trim() || button.trim() === a?.button} onClick={() => set({ button: button.trim() })}>Save</button>
          {a && a.button !== DEFAULT_BUTTON && <button className="btn quiet sm" onClick={() => { setButton(DEFAULT_BUTTON); set({ button: "" }); }}>Back to default</button>}
        </div>
        <small className="hint">Write {"{site}"} where the site's name should go, like "Fine, take me to {"{site}"}".</small>
      </div>
      {a && (
        <p className="small" style={{ margin: 0 }}>
          Today on this Mac: <b className="num">{a.today.prompts}</b> {a.today.prompts === 1 ? "card" : "cards"}, <b className="num">{a.today.passes}</b> {a.today.passes === 1 ? "pass" : "passes"}.
        </p>
      )}
    </section>
  );
}
