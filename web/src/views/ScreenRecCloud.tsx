// Screen recording settings: the Cloud part (PS 1.60, pull request 12c). Where recordings go, the sign in, "Remove from this Mac after
// upload", "Keep the last X days", "Encrypt uploads". Each person brings their own app registration (their own Google Cloud OAuth
// desktop client file, Dropbox app key or Microsoft app registration), like the Gmail sign in: the login and its refresh token stay in
// this Mac's Keychain, never on anyone else's server. The words and the how-to steps are in core/recordings.ts (CLOUD_WORDS).
import { useEffect, useState } from "react";
import { sfx } from "../ui/sfx";
import { askRecordings, recSend, useCloud } from "../recstore";
import { API_PROVIDERS, CLOUD_WORDS as W, PROVIDER_LABEL, UP_LABEL, type CloudState, type RecProvider } from "../core/recordings";

function Seg<T extends string | number>({ value, options, set, label }: { value: T; options: { id: T; label: string }[]; set: (v: T) => void; label: string }) {
  return (
    <div className="tm-ed-seg sr-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} className={`dwell${value === o.id ? " on" : ""}`}
        onClick={() => { if (value !== o.id) { sfx.hover(); set(o.id); } }}>{o.label}</button>)}
    </div>
  );
}
const set = (patch: Record<string, unknown>) => recSend("cloudSet", { patch });

function Provider({ c }: { c: CloudState }) {
  const p = c.provider;
  const login = c.logins[p];
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  if (p === "none") return <span className="sr-hint">{W.nothing}</span>;
  return (
    <div className="sr-sec">
      {API_PROVIDERS.includes(p) && login && (
        <>
          <div className="sr-row">
            {p === "googleDrive" && <button type="button" className="sr-b" onClick={() => { sfx.click(); recSend("cloudGoogleFile"); }}>{W.googleFile}</button>}
            {p !== "googleDrive" && (
              <>
                <input className="gs-sel sr-sel" value={key} placeholder={p === "dropbox" ? W.dropboxKey : W.msId} aria-label={p === "dropbox" ? W.dropboxKey : W.msId} onChange={(e) => setKey(e.target.value)} />
                <button type="button" className="sr-b" disabled={!key.trim()} onClick={() => { sfx.click(); recSend("cloudClient", { provider: p, id: key.trim() }); setKey(""); }}>{W.saveKey}</button>
              </>
            )}
            {login.clientSet && !login.signedIn && <button type="button" className="sr-b on" onClick={() => { sfx.click(); recSend("cloudSignIn", { provider: p }); }}>{W.signIn}</button>}
            {login.signedIn && <button type="button" className="sr-b" onClick={() => { sfx.click(); recSend("cloudSignOut", { provider: p }); }}>{W.signOut}</button>}
          </div>
          <span className="sr-hint">{login.signedIn ? `${W.signedInAs}${login.label ? `: ${login.label}` : ""}` : login.clientSet ? W.notSignedIn : W.howLine}</span>
          <button type="button" className="sr-b" aria-expanded={open} onClick={() => { sfx.click(); setOpen((o) => !o); }}>{W.howTitle}</button>
          {open && (
            <div className="sr-help">
              <span className="sr-hint">{W.howLine}</span>
              <ol>{W.help[p]?.map((h, i) => <li key={i}>{h.href ? <a href={h.href} target="_blank" rel="noopener noreferrer">{h.text}</a> : h.text}</li>)}</ol>
              {p === "googleDrive" && <span className="sr-warn">{W.testingNote}</span>}
            </div>
          )}
        </>
      )}
      {(p === "folder" || p === "iCloud") && (
        <>
          <div className="sr-row">
            <span className="sr-fname">{c.folderName ?? (p === "iCloud" ? (c.iCloudFound ? W.iCloudFound : W.iCloudMissing) : W.folderNone)}</span>
            <button type="button" className="sr-b" onClick={() => { sfx.click(); recSend("cloudFolder"); }}>{W.chooseFolder}</button>
          </div>
          {p === "iCloud" && <span className="sr-hint">{c.iCloudFound ? W.iCloudFound : W.iCloudMissing}</span>}
        </>
      )}
    </div>
  );
}

export function CloudSettings() {
  const c = useCloud();
  useEffect(() => { askRecordings(); }, []);
  const [days, setDays] = useState<string | null>(null);
  if (!c || !c.enabled) return null;
  const on = (v: boolean) => (v ? "on" : "off");
  const OPTIONS: { id: RecProvider; label: string }[] = (["none", "googleDrive", "iCloud", "dropbox", "oneDrive", "folder"] as RecProvider[]).map((id) => ({ id, label: PROVIDER_LABEL[id] }));
  return (
    <>
      <h4>{W.title}</h4>
      <span className="sr-hint">{W.line}</span>
      <label className="sr-field"><span>{W.provider}</span>
        <select className="gs-sel sr-sel" value={c.provider} aria-label={W.provider} onChange={(e) => set({ provider: e.target.value })}>
          {OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <Provider c={c} />
      {c.problem && <span className="sr-warn" role="alert">{c.problem}</span>}
      {c.provider !== "none" && (
        <>
          <div className="sr-field inline"><span><b>{W.removeAfter}</b><em>{W.removeAfterLine}</em></span>
            <Seg value={on(c.removeAfter)} label={W.removeAfter} set={(v) => set({ removeAfter: v === "on" })} options={[{ id: "on", label: "On" }, { id: "off", label: "Off" }]} /></div>
          {c.removeAfter && (
            <div className="sr-field inline"><span><b>{W.keepDays}</b><em>{W.keepLine}</em></span>
              <span className="sr-row">
                <input className="gs-sel sr-sel" type="number" min={0} max={365} step={1} style={{ width: 72 }} aria-label={W.keepDays} value={days ?? String(c.keepDays)}
                  onChange={(e) => setDays(e.target.value)}
                  onBlur={() => { if (days !== null) { const n = Math.max(0, Math.min(365, Math.round(Number(days)))); if (Number.isFinite(n)) set({ keepDays: n }); setDays(null); } }} />
                <span>{W.days}</span>
              </span></div>
          )}
          <div className="sr-field inline"><span><b>{W.encrypt}</b><em>{W.encryptLine}</em></span>
            <Seg value={on(c.encrypt)} label={W.encrypt} set={(v) => set({ encrypt: v === "on" })} options={[{ id: "on", label: "On" }, { id: "off", label: "Off" }]} /></div>
          <div className="sr-sec">
            <h4>{W.queue}</h4>
            {c.wait && <span className="sr-hint" role="status">{c.wait}</span>}
            {!c.queue.length ? <span className="sr-hint">{W.none}</span> : c.queue.map((j) => (
              <span key={j.id} className="sr-hint">{j.name}: {UP_LABEL[j.state]}{j.state === "uploading" ? ` ${Math.round(j.fraction * 100)}%` : ""}{j.note ? `. ${j.note}` : ""}</span>
            ))}
          </div>
        </>
      )}
    </>
  );
}
