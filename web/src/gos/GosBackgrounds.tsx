// Backgrounds on the phone. The built in looks (lightning, storms, the outline scenes) work as on
// the Mac. The developer's own videos are private: they never go in the app file or anywhere public. They
// arrive after he signs in, from his vault (see src/gos/bgvault.ts), and play with an automatic
// portrait crop. Add a video (V1.33): a video from the phone's own files plays here at once (it becomes the
// background) and its encrypted copy goes to the vault, so the Macs get it too.
import { useState } from "react";
import { Group, Row } from "./GosSettings";
import { useVaultVideos } from "./bgvault";
import { haptic } from "./bridge";

export function GosBackgrounds() {
  const v = useVaultVideos();
  return (
    <Group title="Backgrounds">
      <Row title="Built in looks" desc="Lightning, storms and the outline scenes work here too. Pick them in the list's gear, Settings, Appearance." />
      <Row title="Your own videos" desc={v.list.length
        ? `${v.list.length} in your vault, ${v.local} on this phone. ${v.busy ? v.busy : "Each one downloads once, then plays from the phone."}`
        : "None in your vault yet. Add one here: it is encrypted on this phone before it leaves, and only your devices can open it."}
        extra={<label className="gos-btn sm gos-file">Add a video<input type="file" accept="video/*" disabled={!!v.busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void v.add(f); }} /></label>} />
      {v.note && <Row title="Last video added" desc={v.note} />}
      <Row title="Brightness" desc="Pick a video in the list's Settings, Appearance: under Background a slider turns it down and up." />
    </Group>
  );
}

/** A download of one of the developer's videos failed twice in a row (src/core/bgvault.ts): one small card with a
 * plain sentence and Copy error code (a short code and plain details the developer pastes to a chat, nothing
 * secret). Dismiss keeps it away until the problem changes. */
export function BgProblemCard() {
  const v = useVaultVideos();
  const [copied, setCopied] = useState(false);
  if (!v.problem) return null;
  const copy = async () => {
    haptic("press");
    const text = v.report();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* WebView without the clipboard API */ }
    if (!ok) {
      const t = document.createElement("textarea");
      t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      t.remove();
    }
    setCopied(ok);
    if (ok) haptic("tick");
  };
  return (
    <section className="gos-bgerr" role="status" aria-live="polite">
      <div className="gos-bgerr-t">Background videos did not sync</div>
      <div className="gos-bgerr-b">{v.problem.text}</div>
      <div className="gos-bgerr-a">
        <button type="button" className="gos-btn sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy error code"}</button>
        <button type="button" className="gos-btn sm ghost" onClick={() => { haptic("press"); setCopied(false); v.dismiss(); }}>Dismiss</button>
      </div>
    </section>
  );
}
