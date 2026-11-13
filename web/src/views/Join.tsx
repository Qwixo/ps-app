import { useState, type FormEvent } from "react";
import { joinExisting, joinWithInvite, openWithWords, parseInviteFragment, BASE } from "../core/vault";
import { suggestPassphrase } from "../core/crypto";
import { Icon, Logo, useVault } from "../ui/kit";

// Read the invite secret once, then strip it from the address bar and history. A three word login
// link stays as it is: it is the client's own login page, so they can bookmark it.
// Only on /client/join itself: an owner invite (/client/join-owner#...) has a fragment of the same shape.
const onJoin = typeof location !== "undefined" && /\/join\/?$/.test(location.pathname);
const invite = onJoin ? parseInviteFragment(location.hash) : null;
if (invite && !(invite.hint.words && invite.hint.user)) history.replaceState(null, "", `${BASE}join`);
// Who sent the link: the developer's links carry no name, every other owner's carry their first name.
const WHO = invite?.hint.owner || "Owner";

/** Three word login: the link plus the words the developer gave them. First visit sets up, later visits sign in. */
function WordsLogin({ onDone }: { onDone: () => void }) {
  const s = useVault();
  const [words, setWords] = useState("");
  const [err, setErr] = useState("");
  const busy = s.status === "busy";
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await openWithWords(invite!.inviteId, invite!.secret, invite!.hint.user!, words);
      // This device remembers the link (never the words), so the normal sign in page can send them back here.
      try { localStorage.setItem("cv.clientLogin", JSON.stringify({ link: location.href, name: invite!.hint.name })); } catch { /* private window */ }
      onDone();
    }
    catch (e2) { setErr((e2 as Error).message || "Something went wrong."); }
  }
  return (
    <div className="lock">
      <form className="lock-card" onSubmit={submit}>
        <div className="row between">
          <span className="brand"><Logo /> Cincee</span>
          <span className="pill good">Private</span>
        </div>
        <div className="seal"><Icon name="shield" size={26} /></div>
        <div className="stack tight">
          <h1 className="h2" style={{ fontSize: 24 }}>{invite!.hint.name ? `Hi ${invite!.hint.name}` : "Welcome"}</h1>
          <p className="muted small">Type the three words {WHO} sent you to open your project page. It is end-to-end encrypted: only you and {WHO} can see it.</p>
        </div>
        <label className="field"><span>Your three words</span>
          <input className="input" value={words} onChange={(e) => setWords(e.target.value)} placeholder="word word word" autoFocus
            autoComplete="current-password" autoCapitalize="none" spellCheck={false} required style={{ fontSize: 18, letterSpacing: ".02em" }} />
        </label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary block" type="submit" disabled={busy}>{busy ? "Opening your page..." : "Open my project page"}</button>
        <p className="hint" style={{ textAlign: "center" }}>Bookmark this page: it is your login. Next time, the same three words.</p>
      </form>
    </div>
  );
}

export function JoinScreen({ onDone }: { onDone: () => void }) {
  if (invite?.hint.words && invite.hint.user) return <WordsLogin onDone={onDone} />;
  return <PasswordJoin onDone={onDone} />;
}

function PasswordJoin({ onDone }: { onDone: () => void }) {
  const s = useVault();
  const [existing, setExisting] = useState(false);
  const [username, setUsername] = useState(invite?.hint.email || "");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const busy = s.status === "busy";
  const MIN = 10;

  if (!invite) {
    return (
      <div className="lock">
        <div className="lock-card">
          <span className="brand"><Logo /> Cincee</span>
          <h1 className="h2" style={{ fontSize: 24 }}>This link is not complete</h1>
          <p className="muted small">Open the full private link {WHO} sent you, exactly as it was sent. If it still does not work, ask {WHO} for a fresh one.</p>
          <a className="btn ghost" href={BASE}>Go to sign in</a>
        </div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      if (!existing) {
        if (!username.trim()) throw new Error("Choose a username.");
        if (pass.length < MIN) throw new Error(`Your password needs at least ${MIN} characters.`);
        await joinWithInvite(invite!.inviteId, invite!.secret, username, pass);
      } else {
        await joinExisting(invite!.inviteId, invite!.secret, username, pass);
      }
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message || "Something went wrong.");
    }
  }

  return (
    <div className="lock">
      <form className="lock-card" onSubmit={submit}>
        <div className="row between">
          <span className="brand"><Logo /> Cincee</span>
          <span className="pill good">Private</span>
        </div>
        <div className="seal"><Icon name="shield" size={26} /></div>
        <div className="stack tight">
          <h1 className="h2" style={{ fontSize: 24 }}>
            {existing ? "Add this project to your account" : invite.hint.name ? `Hi ${invite.hint.name}, let's set up your project page` : "Welcome. Let's set up your project page"}
          </h1>
          <p className="muted small">
            {invite.hint.email && !existing ? "Your email is your username. Just choose a password only you know. " : "Pick any username you like and a password only you know. "}
            Your page is end-to-end encrypted: nobody else can read it, and nobody can open it without your password.
          </p>
        </div>
        <label className="field"><span>{invite.hint.email ? "Your email (your username)" : existing ? "Your username" : "Choose a username"}</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </label>
        <label className="field"><span>{existing ? "Your password" : "Choose a password"}</span>
          <div className="row">
            <input className="input" type={show ? "text" : "password"} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={existing ? "current-password" : "new-password"} required />
            <button type="button" className="btn quiet icon" onClick={() => setShow(!show)} aria-label="Show password"><Icon name="eye" /></button>
          </div>
        </label>
        {!existing && (
          <p className="hint">
            {pass.length > 0 && pass.length < MIN ? `${MIN - pass.length} more character${MIN - pass.length === 1 ? "" : "s"} to go. ` : `At least ${MIN} characters. `}
            Forgot it later? Ask {WHO} for a new link and type the same username with a new password.{" "}
            <button type="button" className="btn quiet sm cv-inline" onClick={() => { setPass(suggestPassphrase()); setShow(true); }}>Suggest one</button>
          </p>
        )}
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary block" type="submit" disabled={busy}>{busy ? "Securing your page..." : existing ? "Sign in and add" : "Open my project page"}</button>
        <button type="button" className="btn quiet sm" onClick={() => { setExisting(!existing); setErr(""); }}>
          {existing ? "I am new here" : "I already have an account"}
        </button>
      </form>
    </div>
  );
}
