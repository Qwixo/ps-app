// The phone's half of "sign in by scanning the Mac" (V1.55, src/core/phonepair.ts). Runs right after the scan, with
// the project from the code, before the page restarts on it: it talks to that project's relay with its public key only
// (two database functions, ps_link_claim and ps_link_poll, migration 029), shows the six digit code, waits for Allow
// on the Mac, opens what the Mac sealed for this phone, and hands it over. Nothing here is logged or kept except by the
// caller (src/core/phonekeys.ts on the iPhone, the Keystore on PS GOS).
import { useEffect, useRef, useState } from "react";
import { POLL_MS, ALLOW_MS, linkCode, newPhoneKey, openOnPhone, revealOk, type LinkPayload, type Offer } from "../core/phonepair";
import type { DbSchema } from "../core/project";

export interface PairProject { url: string; key: string; schema: DbSchema }

async function rpc<T>(p: PairProject, fn: string, args: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: p.key };
  if (p.key.startsWith("eyJ")) headers.Authorization = `Bearer ${p.key}`;   // an older anon key is a JWT
  if (p.schema === "ps") headers["Content-Profile"] = "ps";
  const r = await fetch(`${p.url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
  if (r.status === 404) throw new Error("old");
  if (!r.ok) throw new Error(`relay ${r.status}`);
  return r.json() as Promise<T>;
}

type Phase =
  | { k: "claiming" } | { k: "waiting" } | { k: "code"; code: string } | { k: "opening" }
  | { k: "used" } | { k: "gone" } | { k: "wrong" } | { k: "old" } | { k: "offline" };
const SAY: Record<Exclude<Phase["k"], "code">, string> = {
  claiming: "Reaching your Mac...",
  waiting: "Waiting for your Mac...",
  opening: "Signing you in...",
  used: "This code was already used or has run out. Show a new code on your Mac and scan again.",
  gone: "Your Mac did not allow it, or it took too long. Show a new code on your Mac and scan again.",
  wrong: "Something is not right with this code. Do not press Allow on your Mac. Show a new code and scan again.",
  old: "Your PS project needs the latest PS on your Mac first. Update PS on your Mac, or type your passphrase.",
  offline: "No connection. Connect to the internet and scan again.",
};

export function PairScreen({ project, offer, onDone, onCancel }: { project: PairProject; offer: Offer; onDone: (p: LinkPayload) => void; onCancel: () => void }) {
  const [phase, setPhase] = useState<Phase>({ k: "claiming" });
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    let stop = false;
    void (async () => {
      try {
        const me = await newPhoneKey();
        const claimed = await rpc<boolean>(project, "ps_link_claim", { p_id: offer.id, p_pub: me.pub });
        if (stop) return;
        if (claimed !== true) { setPhase({ k: "used" }); return; }
        setPhase({ k: "waiting" });
        const until = Date.now() + ALLOW_MS + 15_000;
        let shown = "";
        while (!stop && Date.now() < until) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (stop) return;
          let got: { reveal: string | null; sealed: string | null } | null;
          try { got = await rpc(project, "ps_link_poll", { p_id: offer.id, p_pub: me.pub }); }
          catch (e) { if ((e as Error).message === "old") throw e; continue; }   // a dropped request: look again
          if (stop) return;
          if (!got) { setPhase({ k: "gone" }); return; }
          if (got.reveal && !shown) {
            if (!(await revealOk(offer, got.reveal))) { setPhase({ k: "wrong" }); return; }
            shown = got.reveal;
            setPhase({ k: "code", code: await linkCode(offer, me.pub, got.reveal) });
          }
          if (got.sealed && shown) {
            setPhase({ k: "opening" });
            let p: LinkPayload;
            try { p = await openOnPhone(me, offer, shown, got.sealed); }
            catch { setPhase({ k: "wrong" }); return; }
            if (!stop) done.current(p);
            return;
          }
        }
        if (!stop) setPhase({ k: "gone" });
      } catch (e) {
        if (!stop) setPhase({ k: (e as Error).message === "old" ? "old" : navigator.onLine ? "gone" : "offline" });
      }
    })();
    return () => { stop = true; };
  }, [project.url, offer.id]);
  // Esc always closes (the developer's standing rule).
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);

  const ended = phase.k === "used" || phase.k === "gone" || phase.k === "wrong" || phase.k === "old" || phase.k === "offline";
  return (
    <div className="psm-pair" role="status" aria-live="polite">
      {phase.k === "code" ? (<>
        <p className="psm-pair-h">Check the code on your Mac</p>
        <p className="psm-pair-code" aria-label={`Code ${phase.code}`}>{phase.code}</p>
        <p className="psm-pair-say">Same code on your Mac? Press <b>Allow</b> there. A different code: press <b>Not my phone</b> on the Mac.</p>
      </>) : (
        <p className={`psm-pair-say${ended ? " psm-pair-err" : ""}`}>{SAY[phase.k]}</p>
      )}
      <button type="button" className="psm-link" onClick={onCancel}>{ended ? "Back" : "Cancel"}</button>
    </div>
  );
}
