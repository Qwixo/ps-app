// Settings, Client emails, Link Proton Mail (PS 1.65): steps in plain words, the Bridge address, port and username, and Link.
// The Bridge password is NOT typed here: Link opens a small PS window (a secure field) and the password goes from it straight into
// this Mac's Keychain. This page never sees it (core/protonmail.ts says what is where). Mac only: the reading is done by PS on
// the person's Mac. Off with the feature switch (Settings, From the squad, "Proton Mail through Bridge"), and it does nothing
// until a link exists.
import { useEffect, useState, useSyncExternalStore } from "react";
import { PS, psPost } from "../ps";
import { feature } from "../core/features";
import { sfx } from "../ui/sfx";
import { BRIDGE_DEFAULT_HOST, BRIDGE_DEFAULT_PORT, BRIDGE_DOWNLOAD, PROTON_FEATURE, PROTON_WORDS as W, protonAgo, protonMirror, protonProblemWords } from "../core/protonmail";
import "./protonbridge.css";

export function ProtonBridgeSettings() {
  if (!PS || !feature(PROTON_FEATURE)) return null;
  return <ProtonBridgeBody />;
}

function ProtonBridgeBody() {
  const { status } = useSyncExternalStore(protonMirror.subscribe, protonMirror.get);
  const [host, setHost] = useState(BRIDGE_DEFAULT_HOST);
  const [port, setPort] = useState(String(BRIDGE_DEFAULT_PORT));
  const [user, setUser] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 5000); return () => clearTimeout(t); }, [sure]);
  // A finished try (linked, or a problem) ends the waiting.
  useEffect(() => { setBusy(false); }, [status]);
  const portNum = Number(port.trim());
  const good = /^\S+$/.test(host.trim()) && Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535 && /^\S+@\S+\.\S+$/.test(user.trim());
  const link = () => { sfx.click(); setBusy(true); psPost({ type: "proton:link", host: host.trim(), port: portNum, user: user.trim() }); };
  const problem = protonProblemWords(status.problem) || protonProblemWords(status.linkProblem);
  return (
    <section className="panel stack pb-wrap" aria-labelledby="pb-h">
      <div className="stack tight" style={{ gap: 2 }}>
        <h3 id="pb-h">{W.title}</h3>
        <p className="pb-soft">{W.line}</p>
      </div>
      {status.linked ? (
        <>
          <div className="pb-status">
            <span className={`pb-pill ${status.problem ? "bad" : "good"}`}>{status.problem ? W.problem : W.linked}</span>
            <span>{status.user}{status.lastOk ? ` · ${protonAgo(status.lastOk)}` : ""}</span>
          </div>
          {problem && <p className="pb-bad" role="alert">{problem}</p>}
          <p className="pb-soft">{W.never} {W.keychain}</p>
          <div className="pb-row">
            {status.problem === "certChanged" && <button type="button" className="btn sm" onClick={() => { sfx.click(); psPost({ type: "proton:repin" }); }}>{W.trust}</button>}
            <button type="button" className="btn quiet sm" onClick={() => { sfx.click(); psPost({ type: "proton:refresh" }); }}>{W.refresh}</button>
            <button type="button" className="btn quiet sm" onClick={() => { if (!sure) { sfx.click(); setSure(true); } else { sfx.click(); setSure(false); psPost({ type: "proton:unlink" }); } }}>{sure ? W.unlinkSure : W.unlink}</button>
          </div>
        </>
      ) : (
        <>
          <h3>{W.link}</h3>
          <ol className="pb-steps">
            <li>{W.steps[0]} <a href={BRIDGE_DOWNLOAD} target="_blank" rel="noopener noreferrer">{W.download}</a></li>
            <li>{W.steps[1]}</li>
            <li>{W.steps[2]}</li>
          </ol>
          <div className="pb-row">
            <label className="pb-field addr"><span>{W.address}</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" />
              <em>{W.addressHint}</em></label>
            <label className="pb-field port"><span>{W.port}</span>
              <input value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} spellCheck={false} autoComplete="off" /></label>
            <label className="pb-field user"><span>{W.user}</span>
              <input value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off"
                onKeyDown={(e) => { if (e.key === "Enter" && good) link(); }} />
              <em>{W.userHint}</em></label>
            <button type="button" className="btn sm" disabled={!good || busy} onClick={link}>{busy ? W.linking : W.button}</button>
          </div>
          {problem && <p className="pb-bad" role="alert">{problem}</p>}
          <p className="pb-soft">{W.keychain}</p>
        </>
      )}
    </section>
  );
}
