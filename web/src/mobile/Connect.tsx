// The mobile web app: Connect your project. A G Squad friend's list lives in their own Supabase project (made by
// PS on their Mac). The phone needs that project's address and publishable key once (src/mobile/link.ts), then the
// usual sign in with username and passphrase. Nothing secret is typed here.
import { useState, type FormEvent } from "react";
import { MOBILE_APP_NAME } from "../core/appname";
import type { DbSchema } from "../core/project";
import { parseConnect, saveAccountHint, saveLinked, type AccountHint, type Linked } from "./link";
import { AppMark } from "./mark";
import { ScanScreen } from "./Scan";
import { PairScreen } from "./Pair";
import { savePhoneKeys } from "../core/phonekeys";
import type { LinkPayload, Offer } from "../core/phonepair";
import { fragmentLink } from "./boot";

/** One tiny call to the project's sign in service (a few hundred bytes) to check the address and key work. */
async function reachable(url: string, key: string): Promise<"ok" | "key" | "offline" | "unknown"> {
  try {
    const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: AbortSignal.timeout?.(12_000) });
    if (r.ok) return "ok";
    return r.status === 401 || r.status === 403 ? "key" : "unknown";
  } catch {
    return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unknown";
  }
}

export function ConnectScreen({ onDone, onLocal }: { onDone: () => void; onLocal?: { label: string; go: () => void } }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [ps, setPs] = useState(false);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Scan first (Link your iPhone): the code PS shows on the Mac. Typing it in is still here, one tap away.
  const [scan, setScan] = useState(false);
  const [typed, setTyped] = useState(false);
  const [linked, setLinked] = useState(false);
  const bad = fragmentLink?.state === "bad" ? fragmentLink.message : "";

  // V1.55: the code also carries a sign in offer: sign in right here (src/mobile/Pair.tsx), no passphrase to type.
  const [pairing, setPairing] = useState<{ l: Linked; account: AccountHint; offer: Offer } | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  function scanned(l: Linked, account: AccountHint, offer: Offer | null = null) {
    if (offer) { setScan(false); setPairing({ l, account, offer }); return; }
    keep(l, account);
  }
  function keep(l: Linked, account: AccountHint, viaMac = false) {
    try { saveLinked(l); saveAccountHint(l.url, account); } catch { setScan(false); setPairing(null); setErr("This browser will not keep anything (private browsing?). Open the page normally and try again."); return; }
    setScan(false); setPairing(null); setSignedIn(viaMac); setLinked(true);
    window.setTimeout(onDone, 900);   // a moment to see it worked, then the page starts again on the new project
  }
  async function paired(p: LinkPayload) {
    const c = pairing;
    if (!c) return;
    try { await savePhoneKeys(c.l.url, { u: p.u, a: p.a, k: p.k, d: p.d }); }
    catch { keep(c.l, c.account); return; }   // storage refused: linked, the passphrase signs in
    keep(c.l, c.account, true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const r = parseConnect(url, key, (ps ? "ps" : "public") as DbSchema);
    if ("error" in r) { setErr(r.error); return; }
    setBusy(true);
    const ok = await reachable(r.ok.url, r.ok.key);
    setBusy(false);
    if (ok === "key") { setErr("Your project answered, but did not accept that key. Copy the publishable key again."); return; }
    if (ok === "offline") { setErr("You are offline. Connect once you have internet."); return; }
    if (ok === "unknown") { setErr("Could not reach that project. Check the Project URL, and that the project is not paused in Supabase."); return; }
    try { saveLinked(r.ok); } catch { setErr("This browser will not keep anything (private browsing?). Open the page normally and try again."); return; }
    onDone();
  }

  const paste = (set: (v: string) => void) => async () => {
    try { const t = await navigator.clipboard.readText(); if (t) set(t.trim()); } catch { /* the browser said no: typing still works */ }
  };

  if (scan) return <ScanScreen onFound={scanned} onCancel={() => { setScan(false); }} />;
  if (pairing) return (
    <main className="psm-page psm-connect">
      <header className="psm-hero"><AppMark size={56} /><h1>Sign in from your Mac</h1></header>
      <PairScreen project={pairing.l} offer={pairing.offer} onDone={(p) => void paired(p)} onCancel={() => keep(pairing.l, pairing.account)} />
    </main>
  );
  if (linked) return (
    <main className="psm-page psm-connect psm-done" role="status">
      <header className="psm-hero">
        <span className="psm-tick" aria-hidden="true"><svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
        <h1>{signedIn ? "Signed in" : "Linked"}</h1>
        <p>{signedIn ? "Opening your list..." : "Now type your passphrase."}</p>
      </header>
    </main>
  );

  return (
    <main className="psm-page psm-connect">
      <header className="psm-hero psm-in">
        <AppMark size={64} />
        <h1>Link your iPhone</h1>
        <p>{MOBILE_APP_NAME} keeps your list encrypted in your own Supabase project, the one PS on your Mac set up. Scan the code PS shows on your Mac and you are linked.</p>
      </header>

      <section className="psm-scan-go psm-in" style={{ ["--d" as string]: "80ms" }}>
        <button type="button" className="psm-btn" onClick={() => { setErr(""); setScan(true); }}>Scan the code on your Mac</button>
        <p className="psm-fine">On your Mac: open PS, then Settings, Sync and account, then <b>Link your iPhone</b>.</p>
        {(bad || err) && !typed && <p className="psm-err" role="alert">{bad || err}</p>}
        {!typed && <button type="button" className="psm-link" onClick={() => setTyped(true)} aria-expanded={false}>Type it in instead</button>}
      </section>

      {typed && (<div className="psm-typed">
      <div className="psm-typed-in">
      <ol className="psm-steps">
        <li><b>1</b><span>Open <u>supabase.com/dashboard</u> and pick your project (PS names it <i>ps-vault</i>).</span></li>
        <li><b>2</b><span>Tap <i>Connect</i> at the top, or go to <i>Project Settings</i>, then <i>API Keys</i>.</span></li>
        <li><b>3</b><span>Copy the <i>Project URL</i> and the <i>publishable</i> key into the boxes below.</span></li>
      </ol>

      <form className="psm-form" onSubmit={(e) => void submit(e)} noValidate>
        <label className="psm-field">
          <span>Project URL</span>
          <span className="psm-input">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcdefghijklmnopqrst.supabase.co"
              inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" />
            <button type="button" className="psm-paste" onClick={paste(setUrl)}>Paste</button>
          </span>
        </label>
        <label className="psm-field">
          <span>Publishable key</span>
          <span className="psm-input">
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_..."
              autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" />
            <button type="button" className="psm-paste" onClick={paste(setKey)}>Paste</button>
          </span>
        </label>
        <button type="button" className="psm-more" onClick={() => setMore(!more)} aria-expanded={more}>{more ? "Less" : "More options"}</button>
        {more && (
          <label className="psm-check">
            <input type="checkbox" checked={ps} onChange={(e) => setPs(e.target.checked)} />
            <span>My project also runs another app, so PS keeps its tables in the <i>ps</i> schema</span>
          </label>
        )}
        {(err || bad) && <p className="psm-err" role="alert">{err || bad}</p>}
        <button className="psm-btn" disabled={busy}>{busy ? "Checking..." : "Connect"}</button>
        <p className="psm-fine">Never paste a secret key. The address and publishable key are public by design; your passphrase never leaves this phone and your list is encrypted before it is sent.</p>
      </form>
      </div></div>)}

      {/* Local first (V1.44): no project yet? Start now on this phone; turn on sync later. */}
      {onLocal && <button type="button" className="psm-link psm-local" onClick={onLocal.go}>{onLocal.label}</button>}
    </main>
  );
}
