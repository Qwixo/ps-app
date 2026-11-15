// The WhatsApp link guide (Settings, WhatsApp settings, Link WhatsApp): left, step by step with a progress bar, Back and Done next,
// copy buttons and live checks; top right, a live example that is clearly marked "Example" (made up names, sends nothing).
// Esc closes it on a Mac or the website, Back on the phone. The island intro that opens this guide is a separate piece (the feature
// intro list, 9c).
import { useEffect, useMemo, useState } from "react";
import { activeProject } from "../core/project";
import { newCode, sha256Hex, validRef } from "../core/mailsetup";
import { DEMO, PRIVACY_LINE, WHICH, demoState, waSteps, whichAnswer, type Which } from "../core/wasetup";
import { sb } from "../core/vault";
import { toast } from "../ui/kit";
import { readWaStatus, type WaStatus } from "./WhatsAppSettings";
import { WaMark } from "./WaMark";

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Could not copy. Select the text and copy it."); }
}

export function WaGuide({ onClose }: { onClose: () => void }) {
  const ref = (() => { const r = activeProject()?.ref ?? null; return validRef(r) ? r : null; })();
  const [which, setWhich] = useState<Which | null>(null);
  const [i, setI] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [startedAt] = useState(() => new Date().toISOString());
  useEffect(() => { let live = true; if (code) void sha256Hex(code).then((h) => { if (live) setHash(h); }); else setHash(null); return () => { live = false; }; }, [code]);
  useEffect(() => { void Promise.resolve(sb.rpc("whatsapp_webhook_info")).then(({ data }) => setToken((data as { verify_token?: string } | null)?.verify_token ?? null)).catch(() => {}); }, []);
  // The live checks: the status is read every few seconds while the guide is open (the number, the webhook handshake, a message landing).
  useEffect(() => { const t = window.setInterval(() => void readWaStatus().then(setStatus), 4000); void readWaStatus().then(setStatus); return () => clearInterval(t); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const back = (e: Event) => { e.preventDefault(); onClose(); };
    window.addEventListener("keydown", key, true); window.addEventListener("gos-back", back);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("gos-back", back); };
  }, [onClose]);
  const steps = useMemo(() => waSteps({ ref, which, code, hash, verifyToken: token }), [ref, which, code, hash, token]);
  const st = steps[i];
  const landed = !!status?.last_in_at && status.last_in_at >= startedAt;
  const live = (k?: string) => k === "linked" ? !!status?.linked : k === "verified" ? !!status?.verified_at : k === "message" ? landed : null;
  const done = steps[i].live === "message" && landed;
  const canNext = i === 0 ? !!which : true;
  return (
    <div className="wa-guide" role="dialog" aria-modal="true" aria-label="Link WhatsApp" onMouseDown={(e) => e.stopPropagation()}>
      <div className="wa-guide-card">
        <header className="wa-g-head"><b><WaMark size={16} /> Link WhatsApp</b>
          <button type="button" className="btn quiet sm" onClick={onClose} aria-label="Close the guide">Close</button></header>
        <div className="wa-g-grid">
          <div className="wa-g-left">
            <div className="wa-prog" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={i + 1}><i style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
            <p className="small muted">Step {i + 1} of {steps.length}</p>
            {done ? (
              <div className="wa-linked" role="status"><span className="wa-tick" aria-hidden="true">&#10003;</span><b>WhatsApp linked</b></div>
            ) : (
              <>
                <p className="wa-step">{st.text}</p>
                {st.n === 1 && (
                  <div className="wa-which" role="radiogroup" aria-label="Which WhatsApp do you use?">
                    <b className="small">Which WhatsApp do you use?</b>
                    {WHICH.map((w) => (
                      <button key={w.id} type="button" role="radio" aria-checked={which === w.id} className={`chip wa-w${which === w.id ? " on" : ""}`} onClick={() => setWhich(w.id)}>
                        <span className={`wa-icon ${w.id}`} aria-hidden="true">{w.id === "business" ? "B" : w.id === "unsure" ? "?" : ""}</span>{w.name}<small>{w.line}</small>
                      </button>
                    ))}
                    {which && <p className="small">{whichAnswer(which)}</p>}
                  </div>
                )}
                {st.link && <a className="btn quiet sm" href={st.link.href} target="_blank" rel="noopener noreferrer">{st.link.label}</a>}
                {st.button === "code" && <div><button type="button" className="btn quiet sm" onClick={() => setCode(newCode())}>{code ? "Make another code" : "Make a code"}</button></div>}
                {st.code && (<><code className="ce-code">{st.code}</code><div><button type="button" className="btn quiet sm" onClick={() => void copy(st.code!)}>Copy</button></div></>)}
                {st.live && <p className={`small wa-live ${live(st.live) ? "ok" : ""}`} role="status">{live(st.live) ? "Done" : "Waiting"}: {st.live === "linked" ? "your number is linked" : st.live === "verified" ? "Meta has verified the webhook" : "a message from you has landed"}</p>}
              </>
            )}
            <p className="small muted">{PRIVACY_LINE}</p>
            <div className="wa-nav">
              <button type="button" className="btn quiet sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
              {done || i === steps.length - 1 ? <button type="button" className="btn sm" onClick={onClose}>{done ? "Finish" : "Close"}</button>
                : <button type="button" className="btn sm" disabled={!canNext} onClick={() => setI(i + 1)}>Done, next</button>}
            </div>
          </div>
          <WaDemo />
        </div>
      </div>
    </div>
  );
}

/** The live example: a made up client message bounces in, an animated pointer clicks Reply, a quick reply is picked, Send, then the
 *  ticks; then the same for an email. Always marked "Example". It sends nothing and uses made up names only. */
function WaDemo() {
  const [at, setAt] = useState(0);
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => { if (reduce) return; const t0 = Date.now(); const t = window.setInterval(() => setAt(Date.now() - t0), 100); return () => clearInterval(t); }, [reduce]);
  const d = demoState(reduce ? DEMO.t.waRead + 100 : at);
  const w = d.phase === "wa";
  const m = w ? DEMO.wa : DEMO.mail;
  return (
    <aside className="wa-demo" aria-label="Example" aria-live="off">
      <span className="wa-ex">Example</span>
      {d.card && (
        <article className={`wa-demo-card ${w ? "wa" : "mail"}`} key={d.phase}>
          <b>{w ? <WaMark size={13} /> : null} {m.who}</b>
          <p>{m.msg}</p>
          {!d.box && d.ticks === "none" && !d.mailSent && <span className={`wa-fakebtn${d.pointer === "reply" ? " hit" : ""}`}>Reply</span>}
          {d.box && (
            <div className="wa-demo-box">
              <span className={`wa-fakebtn small${d.pointer === "quick" ? " hit" : ""}`}>{m.quick.slice(0, 18)}</span>
              <div className="wa-fake-ta">{d.typed}</div>
              <span className={`wa-fakebtn${d.pointer === "send" ? " hit" : ""}`}>Send</span>
            </div>
          )}
          {w && d.ticks !== "none" && <p className="wa-ticks">{d.ticks === "sending" ? "Sending" : d.ticks === "sent" ? "Sent" : "Read"}</p>}
          {!w && d.mailSent && <p className="wa-ticks">Sent</p>}
        </article>
      )}
    </aside>
  );
}
