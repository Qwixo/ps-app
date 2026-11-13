// "Scan the code on your Mac" on the phone's sign in screen (V1.55): the iPhone web app and PS GOS. The scanner reads
// the Mac's code (src/mobile/Scan.tsx); a code with a sign in offer runs the pairing (src/mobile/Pair.tsx) and, after
// Allow on the Mac, signs in with no typing (core/vault.ts unlockFromMac). Typing the passphrase stays right there.
import { useState } from "react";
import { createPortal } from "react-dom";
import { PROJECT, unlockFromMac } from "../core/vault";
import type { LinkPayload, Offer } from "../core/phonepair";
import type { AccountHint, Linked } from "./link";
import { saveAccountHint, saveLinked } from "./link";
import { savePhoneKeys } from "../core/phonekeys";
import { ScanScreen } from "./Scan";
import { PairScreen } from "./Pair";
import { appBase } from "./platform";
import "./mobile.css";

const same = (a: string, b: string) => a.trim().replace(/\/+$/, "").toLowerCase() === b.trim().replace(/\/+$/, "").toLowerCase();
const GOS = import.meta.env.MODE === "gos";

export function ScanSignIn({ className = "psm-link" }: { className?: string }) {
  const [step, setStep] = useState<"off" | "scan" | { l: Linked; account: AccountHint; offer: Offer }>("off");
  const [err, setErr] = useState("");
  function found(l: Linked, account: AccountHint, offer: Offer | null) {
    setErr("");
    if (!same(l.url, PROJECT.url)) {
      // PS GOS always uses its own project. The web app takes the new project and starts again on it (Connect's way).
      if (GOS) { setStep("off"); setErr("That code is for another PS project."); return; }
      if (!offer) { try { saveLinked(l); saveAccountHint(l.url, account); } catch { /* storage off */ } location.replace(appBase(location.pathname)); return; }
    }
    if (!offer) { setStep("off"); setErr("That code only links your phone. On your Mac, update PS and show the code again to sign in from there."); return; }
    setStep({ l, account, offer });
  }
  async function paired(p: LinkPayload) {
    if (typeof step !== "object") return;
    const { l, account } = step;
    try {
      if (!same(l.url, PROJECT.url)) {
        // Another project: keep its link and the keys for it, then start again there; it opens signed in.
        saveLinked(l); saveAccountHint(l.url, account);
        await savePhoneKeys(l.url, { u: p.u, a: p.a, k: p.k, d: p.d });
        location.replace(appBase(location.pathname));
        return;
      }
      setStep("off");
      await unlockFromMac(p);
    } catch (e) { setStep("off"); setErr((e as Error).message || "That did not work. Type your passphrase instead."); }
  }
  const over = (n: React.ReactNode) => createPortal(<div className="psm-over">{n}</div>, document.body);
  return (<>
    <button type="button" className={className} onClick={() => { setErr(""); setStep("scan"); }}>Scan the code on your Mac</button>
    {err && <p className="psm-err" role="alert">{err}</p>}
    {step === "scan" && over(<ScanScreen onFound={found} onCancel={() => setStep("off")} />)}
    {typeof step === "object" && over(
      <main className="psm-page psm-connect">
        <header className="psm-hero"><h1>Sign in from your Mac</h1></header>
        <PairScreen project={step.l} offer={step.offer} onDone={(p) => void paired(p)} onCancel={() => setStep("off")} />
      </main>,
    )}
  </>);
}
