import { useState, type FormEvent } from "react";
import { BASE, ownerJoin } from "../core/vault";
import { parseOwnerInvite } from "../core/ownerInvite";
import { passphraseScore, suggestPassphrase } from "../core/crypto";
import { Icon, Logo, useVault } from "../ui/kit";
import { Strength, setRecovery } from "./Lock";
import { PrivacyNote } from "./PrivacyNote";

// A new owner's first visit, from a one-time "Invite someone" link: /client/join-owner#<id>.<secret>.
// Read the secret once, then strip it from the address bar and history. Their own vault, their own
// passphrase and recovery key; nobody (the developer included) can open it or reset the passphrase.
const onPage = typeof location !== "undefined" && /\/join-owner\/?$/.test(location.pathname);
const invite = onPage ? parseOwnerInvite(location.hash) : null;
if (onPage && location.hash) history.replaceState(null, "", `${BASE}join-owner`);

export function JoinOwnerScreen({ onDone }: { onDone: () => void }) {
  const s = useVault();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const busy = s.status === "busy";

  if (!invite) {
    return (
      <div className="lock">
        <div className="lock-card">
          <span className="brand"><Logo /> PS app</span>
          <h1 className="h2" style={{ fontSize: 24 }}>This link is not complete</h1>
          <p className="muted small">Open the full invite link exactly as it was sent to you. Each link works once. If it still does not work, ask for a new one.</p>
          <a className="btn ghost" href={BASE}>Go to sign in</a>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      if (!name.trim()) throw new Error("Type your first name.");
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(username.trim())) throw new Error("Choose a username of 3 to 40 letters or numbers.");
      if (!passphraseScore(pass).ok) throw new Error("Pick a stronger passphrase. It is the only thing protecting your vault.");
      if (pass !== pass2) throw new Error("The two passphrases do not match.");
      await ownerJoin(invite!.id, invite!.token, name, username, pass, setRecovery);
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message || "Something went wrong.");
    } finally {
      setPass("");
      setPass2("");
    }
  }

  return (
    <div className="lock">
      <form className="lock-card" onSubmit={submit} autoComplete="on">
        <div className="row between">
          <span className="brand"><Logo /> PS app</span>
          <span className="pill good">AES-256</span>
        </div>
        <div className="seal"><Icon name="shield" size={26} /></div>
        <div className="stack tight">
          <h1 className="h2" style={{ fontSize: 24 }}>Set up your own vault</h1>
          <p className="muted small">
            Your tasks, notes and clients are encrypted on this device before they are saved. Your passphrase never leaves it,
            and nobody can reset it, so keep it somewhere safe. Next you get a recovery key: save that too.
          </p>
          <PrivacyNote own={false} device="device" />
        </div>
        <label className="field"><span>Your first name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" required />
        </label>
        <label className="field"><span>Choose a username</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </label>
        <label className="field"><span>Choose a passphrase</span>
          <div className="row">
            <input className="input" type={show ? "text" : "password"} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" required />
            <button type="button" className="btn quiet icon" onClick={() => setShow(!show)} aria-label="Show passphrase"><Icon name="eye" /></button>
          </div>
        </label>
        <Strength value={pass} />
        <label className="field"><span>Type it again</span>
          <input className="input" type={show ? "text" : "password"} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" required />
        </label>
        <button type="button" className="btn quiet sm cv-inline" onClick={() => { const p = suggestPassphrase(); setPass(p); setPass2(p); setShow(true); }}>Suggest one</button>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary block" type="submit" disabled={busy}>{busy ? "Creating your vault..." : "Create my vault"}</button>
      </form>
    </div>
  );
}
