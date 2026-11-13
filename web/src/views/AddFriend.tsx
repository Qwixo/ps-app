// Add friend (V1.44). Three pieces:
//   AddFriendPanel   Settings, Add friend (top of Settings; the phone, the Mac Tab list and the website): a big QR code
//                    drawn here (core/qrcode.ts, no outside service), Copy link and New code. A fresh code each time
//                    it opens; closing it (Esc, back, leaving the page) calls an unused code off on the hub.
//   FriendLanding    what someone who scanned sees on the website before PS is open: their name and Join (when the
//                    local first start is in), or Sign in, plus Get the Mac app and Get the phone app.
//   FriendJoinCard   once PS is open as owner with a scanned link waiting: joins (or asks) at once and says so.
// The squad steps are in squad/addfriend.ts and squad/engine.ts (acceptFriendLink is the entry point).
import { useEffect, useMemo, useRef, useState } from "react";
import { makeQr, qrPath } from "../core/qrcode";
import { FRIEND_BASE, GET_MAC_URL, GET_PHONE_URL, friendExpired } from "../core/friendlink";
import { vaultStore } from "../core/vault";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { PS } from "../ps";
import { squadOp, useSquad } from "../squad/mirror";
import type { FriendView } from "../squad/view";
import type { FriendResult } from "../squad/addfriend";
import { friendStarter, setFriendStarter } from "../squad/addfriend";
import { acceptFriendLink, dropFriendLink, friendClose, friendCode, pendingFriendLink, squadStore } from "../squad/engine";
import "./addfriend.css";

/** The QR code itself: one SVG path, dark on white with the quiet zone round it (cameras need the white edge). */
export function QrCode({ text, label = "QR code" }: { text: string; label?: string }) {
  const q = useMemo(() => { try { return qrPath(makeQr(text, "M")); } catch { return null; } }, [text]);
  if (!q) return null;
  return (
    <svg className="af-svg" viewBox={`0 0 ${q.n} ${q.n}`} role="img" aria-label={label} shapeRendering="crispEdges" data-qr={text}>
      <rect width={q.n} height={q.n} fill="#FFFFFF" />
      <path d={q.d} fill="#000000" />
    </svg>
  );
}

// The dev server only (never in a build): ?friend=join|ask|none|private shows a fictional code with no hub call,
// ?friendresult=in|asked|already|expired|error a fictional join result, ?friendstart a fictional local first start.
const devQ = (k: string) => (import.meta.env.DEV && typeof location !== "undefined" ? new URLSearchParams(location.search).get(k) : null);
const DEV_ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
function devCode(k: string | null): FriendView | null {
  const exp = new Date(Date.now() + 24 * 3_600_000 - 60_000).toISOString();
  return k === "join" ? { kind: "join", url: `${FRIEND_BASE}#add=${DEV_ID}.Zm9yIHRoZSBkZXYgc2VydmVyIG9ubHksIG5vdCBhIGtleS4`, expiresAt: exp }
    : k === "ask" ? { kind: "ask", url: `${FRIEND_BASE}#ask=${DEV_ID}.${Math.floor(Date.parse(exp) / 1000).toString(36)}`, expiresAt: exp }
    : k === "none" ? { kind: "none", why: "no-squad" } : k === "private" ? { kind: "none", why: "private" } : null;
}
if (devQ("friendstart") !== null) setFriendStarter(async () => { await new Promise((r) => setTimeout(r, 600)); });

// ---------- Settings, Add friend ----------
/** The Tab list holds no keys: it asks the main page for the code (squadOp) and reads it from the state PS sends. */
const inTabList = () => PS && vaultStore.get().userId === "ps-overlay";

function useFriendCode(): { v: FriendView | null; again: () => void } {
  const remote = inTabList();
  const mirror = useSquad();
  const dev = devCode(devQ("friend"));
  const [local, setLocal] = useState<FriendView | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (dev) return;
    if (remote) {
      squadOp({ op: "friend" });
      return () => squadOp({ op: "friendClose" });
    }
    let live = true;
    setLocal({ kind: "busy" });
    void friendCode().then((v) => { if (live) setLocal(v); });   // a code closed before it came back is called off by the engine
    return () => { live = false; void friendClose(); };
  }, [remote, n]);
  return { v: dev ?? (remote ? mirror.friend ?? { kind: "busy" } : local), again: () => { sfx.click(); setN((x) => x + 1); } };
}

const hoursLeft = (iso: string) => {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return "now";
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000);
  return h ? `in ${h} h ${m} min` : `in ${m} min`;
};

export function AddFriendPanel() {
  const { v, again } = useFriendCode();
  const name = useSquadName();
  const [copied, setCopied] = useState(false);
  const url = v && (v.kind === "join" || v.kind === "ask") ? v.url : v?.kind === "none" ? FRIEND_BASE : null;
  const copy = async () => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); sfx.click(); window.setTimeout(() => setCopied(false), 1600); } catch { /* the link is still in the QR code */ }
  };
  const squad = name || "your G Squad";
  return (
    <div className="af" data-kind={v?.kind ?? "busy"}>
      <div className={`af-qr${url ? "" : " wait"}`}>
        {url ? <QrCode text={url} label={v?.kind === "none" ? "QR code: get PS" : "QR code: add a friend to G Squad"} /> : <span className="af-spin" aria-label="Making a code" />}
      </div>
      <div className="af-say" role="status" aria-live="polite">
        {!v || v.kind === "busy" ? <><b>Making a code</b><span>One moment.</span></>
          : v.kind === "join" ? <><b>Scan with any phone camera</b><span>They open PS in the browser and join {squad} straight away.</span></>
          : v.kind === "ask" ? <><b>Scan with any phone camera</b><span>They open PS in the browser and are in {squad} as soon as they sign in.</span></>
          : v.kind === "none" ? <><b>This code gets them PS app</b><span>{v.why === "private"
            ? "Only your squad's admin can add people with a code. Ask your admin to show theirs."
            : "You are not in a G Squad yet. Join or start one, then this code adds people to it."}</span></>
          : <><b>No code right now</b><span>{v.message}</span></>}
      </div>
      <div className="af-row">
        {url && <button type="button" className="gs-go" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>}
        {v && v.kind !== "busy" && <button type="button" className="gs-ghost" onClick={again}>{v.kind === "error" ? "Try again" : "New code"}</button>}
      </div>
      {v?.kind === "join" && <p className="af-small">Works once and runs out {hoursLeft(v.expiresAt)}. Closing this cancels it if nobody used it. The part after the # is the key to the squad: it never goes to any server.</p>}
      {v?.kind === "ask" && <p className="af-small">Runs out {hoursLeft(v.expiresAt)}. It holds no key: PS puts them in {squad} by itself once they sign in.</p>}
    </div>
  );
}
function useSquadName(): string {
  const mirror = useSquad();
  const [own, setOwn] = useState(() => squadStore.get().name);
  useEffect(() => squadStore.subscribe(() => setOwn(squadStore.get().name)), []);
  return inTabList() ? mirror.name : own;
}

// ---------- someone who scanned ----------
function GetApp() {
  return (
    <div className="af-get">
      <a className="gs-ghost" href={GET_MAC_URL} target="_blank" rel="noopener noreferrer">Get the Mac app</a>
      <a className="gs-ghost" href={GET_PHONE_URL} target="_blank" rel="noopener noreferrer">Get the phone app</a>
    </div>
  );
}

/** The website before PS is open, with a scanned link waiting. */
export function FriendLanding({ onSignIn }: { onSignIn: () => void }) {
  const link = pendingFriendLink();
  const start = friendStarter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onSignIn(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onSignIn]);
  if (!link) return null;
  const ask = link.kind === "ask";
  if (friendExpired(link)) return (
    <main className="gsl af-land"><div className="gsl-card">
      <h1>This code has run out</h1>
      <p>Ask for a new one: it works for 24 hours.</p>
      <GetApp />
      <button type="button" className="af-link" onClick={() => { dropFriendLink(); onSignIn(); }}>Sign in to PS app</button>
    </div></main>
  );
  const go = async () => {
    const n = name.replace(/\s+/g, " ").trim();
    if (!n || !start || busy) return;
    setBusy(true); setErr(null);
    try { await start(n); } catch { setErr("PS app could not start. Try again."); setBusy(false); }
    // The vault is open now: FriendJoinCard takes it from here.
  };
  return (
    <main className="gsl af-land">
      <div className="gsl-card">
        <h1>{ask ? "Join The G Squad" : "You are invited to a G Squad"}</h1>
        {start ? <>
          <p>Type your name and you are in.</p>
          <form className="af-form" onSubmit={(e) => { e.preventDefault(); void go(); }}>
            <label className="gs-field">Your name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="given-name" spellCheck={false} /></label>
            <button type="submit" className="gs-go" disabled={!name.trim() || busy}>{busy ? "Starting..." : "Join"}</button>
          </form>
          {err && <p className="af-err" role="alert">{err}</p>}
          <button type="button" className="af-link" onClick={onSignIn}>I already use PS app: sign in</button>
        </> : <>
          <p>Already use PS app? Sign in and you join straight away.</p>
          <button type="button" className="gs-go" onClick={onSignIn}>Sign in to PS app</button>
          <p>New to PS app? Get the app first, then scan the code again.</p>
        </>}
        <GetApp />
        <p className="gsl-small">The key in this link stays on your device. It is never sent to any server.</p>
      </div>
    </main>
  );
}

/** PS is open as owner and a scanned link waits: join (or ask) at once, then say how it went. Esc or OK closes. */
export function FriendJoinCard() {
  const s = useVault();
  const [link] = useState(() => pendingFriendLink());
  const [r, setR] = useState<FriendResult | "busy" | "name" | null>(null);
  const [name, setName] = useState("");
  const ran = useRef(false);
  const owner = s.status === "unlocked" && s.role === "owner";
  const run = (n: string) => { setR("busy"); void acceptFriendLink(n).then(setR); };
  useEffect(() => {
    if (!link || !owner || ran.current) return;
    ran.current = true;
    const dr = devQ("friendresult");
    if (dr) {
      setR(dr === "in" ? { state: "in", squad: "The G Squad" } : dr === "asked" ? { state: "asked", squad: "The G Squad" } : dr === "already" ? { state: "already" }
        : dr === "expired" ? { state: "expired" } : dr === "name" ? "name" : dr === "busy" ? "busy" : { state: "error", message: "This code was used already or has run out. Ask them to show a new one." });
      return;
    }
    if (!(settingsData(vaultStore.get()).ownerName || "").trim()) { setR("name"); return; }
    run("");
  }, [link, owner]);
  const close = () => { if (r === "name") dropFriendLink(); setR(null); };
  useEffect(() => {
    if (!r || r === "busy") return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  });
  if (!r) return null;
  const body = r === "busy" ? <><h2>Joining The G Squad</h2><span className="af-spin" aria-label="Working" /></>
    : r === "name" ? <>
      <h2>{link?.kind === "ask" ? "Join The G Squad" : "You are invited to a G Squad"}</h2>
      <p>Your name in the squad:</p>
      <form className="af-form" onSubmit={(e) => { e.preventDefault(); const n = name.replace(/\s+/g, " ").trim(); if (n) run(n); }}>
        <label className="gs-field">Your name<input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus spellCheck={false} /></label>
        <button type="submit" className="gs-go" disabled={!name.trim()}>Join</button>
      </form>
    </>
    : r.state === "in" ? <><h2>You are in {r.squad}</h2><p>Your squad sees you now. Get PS app on your Mac or phone to keep it with you.</p><GetApp /></>
    : r.state === "asked" ? <><h2>You are joining {r.squad}</h2><p>PS app puts you in by itself in a moment. Get PS app on your Mac or phone meanwhile.</p><GetApp /></>
    : r.state === "already" ? <><h2>You are already in a G Squad</h2><p>Leave it first (G Squad, Members, Leave the squad), then scan a new code.</p></>
    : r.state === "expired" ? <><h2>This code has run out</h2><p>Ask for a new one: it works for 24 hours.</p></>
    : r.state === "none" ? null
    : <><h2>Could not join</h2><p>{r.message}</p></>;
  if (!body) return null;
  return (
    <div className="af-layer" role="dialog" aria-modal="true" aria-label="G Squad" onMouseDown={(e) => { if (e.target === e.currentTarget && r !== "busy") close(); }}>
      <div className="gsl-card af-card">
        {body}
        {r !== "busy" && r !== "name" && <button type="button" className="gs-go" onClick={close} autoFocus>OK</button>}
        {r === "name" && <button type="button" className="af-link" onClick={close}>Not now</button>}
      </div>
    </div>
  );
}
