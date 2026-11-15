// Settings, Client emails (PS 1.60): the per person switch (core/mailswitch.ts), the Gmail accounts that are connected, and the
// step guide for connecting your own accounts (core/mailsetup.ts). Off unless you switch it on, and only offered to the first
// owner of their own Supabase project, because the mail functions seal every email to that project's own owner.
// Replies are sent by the Mac (Reply from PS app). On the website and the phone, Reply hands the reply to your Mac.
import { useEffect, useMemo, useState } from "react";
import { saveSettings } from "../core/actions";
import { settingsData } from "../core/select";
import { mailCan, MAIL_FEATURE } from "../core/mailswitch";
import { mailOnSnap } from "../core/mailsnap";
import { cleanSwitches } from "../core/features";
import { mailSteps, newCode, sha256Hex, validRef } from "../core/mailsetup";
import { activeProject } from "../core/project";
import { mailSwitchChanged } from "../core/vault";
import { toast, useVault } from "../ui/kit";
import { GmailSettings } from "./Replies";
import "./clientemails.css";

export const CE_NEEDS = "Client emails needs your own Supabase project, and you must be its first owner. Connect it in Settings, Sync and account.";
export const CE_MAC_SENDS = "Replies are sent by your Mac, when it is on. On the website and on your phone, Reply hands your reply to your Mac.";

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Could not copy. Select the text and copy it."); }
}

export function ClientEmailsSettings({ compact = false }: { compact?: boolean }) {
  const s = useVault();
  const can = mailCan(s);
  const st = settingsData(s);
  const on = mailOnSnap(s);   // V1.61: the same answer the cards use (the developer's own account takes his layer's default too)
  const ref = (() => { const r = activeProject()?.ref ?? null; return validRef(r) ? r : null; })();
  const [code, setCode] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => { let live = true; if (code) void sha256Hex(code).then((h) => { if (live) setHash(h); }); else setHash(null); return () => { live = false; }; }, [code]);
  const steps = useMemo(() => mailSteps(ref, code, hash), [ref, code, hash]);
  const set = (v: boolean) => {
    if (!can) return;
    void saveSettings({ squadFeatures: { ...cleanSwitches(st.squadFeatures), [MAIL_FEATURE]: v } }).then(() => { if (v) mailSwitchChanged(); toast(v ? "Client emails on" : "Client emails off"); }).catch((e) => toast(String((e as Error).message || e)));
  };
  return (
    <section className="panel stack" aria-labelledby="ce-h">
      <div className="stack tight" style={{ gap: 2 }}>
        <h2 className="h2" id="ce-h">Client emails</h2>
        <p className="small muted">Show emails from your clients' Gmail and your Instantly replies as cards and in the email panel. Off until you switch it on.</p>
      </div>
      <div className="x-segs" role="radiogroup" aria-label="Client emails">
        <button className="chip" role="radio" aria-checked={on} aria-pressed={on} disabled={!can} onClick={() => set(true)}>On</button>
        <button className="chip" role="radio" aria-checked={!on} aria-pressed={!on} disabled={!can} onClick={() => set(false)}>Off</button>
      </div>
      {!can && <p className="small muted ce-note">{CE_NEEDS}</p>}
      <p className="small muted ce-note">{CE_MAC_SENDS}</p>
      {can && (
        <details className="stack tight" open={!compact && !on}>
          <summary className="small" style={{ fontWeight: 600 }}>How to connect your accounts</summary>
          <ol className="ce-steps small">
            {steps.map((x) => (
              <li key={x.n}>
                {x.text}
                {x.n === 5 && (
                  <div className="ce-row">
                    <button type="button" className="btn quiet sm" onClick={() => setCode(newCode())}>{code ? "Make another code" : "Make a code"}</button>
                  </div>
                )}
                {x.code && (
                  <>
                    <code className="ce-code">{x.code}</code>
                    <div className="ce-row"><button type="button" className="btn quiet sm" onClick={() => void copy(x.code!)}>Copy</button></div>
                  </>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      {can && on && <GmailSettings embedded />}
    </section>
  );
}
