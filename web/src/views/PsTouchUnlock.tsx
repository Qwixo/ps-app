// PS Mac app only: the locked screen after Lock (27 Oct 2026). Touch ID or the Mac password opens
// PS again (ps-mac TouchLock.swift asks macOS; the keys come back as a "remember" message). Holding
// Tab while locked asks too. The passphrase stays one click away.
import { useEffect, useRef } from "react";
import { psTouchUnlock, usePsTouchMissed } from "../ps";
import { useVault } from "../ui/kit";
import { PsSignInShell } from "./PsSignIn";
import { appName } from "../core/appname";

export function PsTouchUnlock({ onPassphrase }: { onPassphrase: () => void }) {
  const s = useVault();
  const missed = usePsTouchMissed();
  const shownAt = useRef(Date.now());
  const busy = s.status === "busy";
  // Focus the button so Return asks for Touch ID straight away.
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); }, []);
  // The same clean window as the sign in (PsSignIn.tsx).
  return (
    <PsSignInShell title={`${appName()} is locked`} sub="Touch ID or your Mac password opens it again. Your keys never left this Mac.">
      <div className="ps-si-form">
        <button ref={btn} className="ps-si-go" disabled={busy} onClick={psTouchUnlock}>
          {busy ? "Opening..." : "Unlock with Touch ID"}
        </button>
        {missed > shownAt.current && <p className="ps-si-note" role="status">Not unlocked. Try again, or use your passphrase.</p>}
        <button type="button" className="ps-si-link" onClick={onPassphrase}>Use my passphrase instead</button>
      </div>
    </PsSignInShell>
  );
}
