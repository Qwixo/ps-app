// The mobile web app: "Scan the code on your Mac". The camera in the page (getUserMedia) and a small QR reader
// (jsQR, loaded only when this opens), because iOS Safari has no BarcodeDetector. It exists because a web app added
// to the Home Screen keeps its own storage, apart from Safari's: a link saved by opening the code with the Camera
// app (Safari) never reaches the Home Screen app, so the Home Screen app has to be able to scan it itself.
// Nothing is recorded or sent: frames are read on the phone and thrown away. The code holds the project address and
// the publishable key only (src/mobile/linkcode.ts), never a secret key.
import { useEffect, useRef, useState } from "react";
import type { AccountHint, Linked } from "./link";
import type { Offer } from "../core/phonepair";
import { readLinkText } from "./linkcode";

type Phase = "starting" | "looking" | "denied" | "nocamera";
const SAY: Record<string, string> = {
  starting: "Opening the camera...",
  looking: "Point the camera at the code on your Mac.",
};

export function ScanScreen({ onFound, onCancel }: { onFound: (l: Linked, account: AccountHint, offer: Offer | null) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [note, setNote] = useState("");
  const [hit, setHit] = useState(false);
  const found = useRef(onFound);
  found.current = onFound;

  useEffect(() => {
    let live = true, raf = 0, stream: MediaStream | null = null, last = 0, noteAt = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const stop = () => { live = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); const v = video.current; if (v) v.srcObject = null; };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia || !ctx) { setPhase("nocamera"); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        if (live) setPhase((e as DOMException)?.name === "NotFoundError" ? "nocamera" : "denied");
        return;
      }
      if (!live) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      try { await v.play(); } catch { /* it plays once the first frame is in */ }
      setPhase("looking");
      const { default: jsQR } = await import("jsqr");
      const tick = (t: number) => {
        if (!live) return;
        raf = requestAnimationFrame(tick);
        if (t - last < 110 || v.readyState < 2 || !v.videoWidth) return;   // about 9 looks a second is plenty
        last = t;
        const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * k); canvas.height = Math.round(v.videoHeight * k);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (!code?.data) return;
        const r = readLinkText(code.data);
        if (r && "ok" in r) { setHit(true); stop(); found.current(r.ok, r.account, r.offer); return; }
        // Some other code, or a bad one: say so (not on every look), keep looking.
        if (t - noteAt > 2500) { noteAt = t; setNote(r ? r.error : "That is not the PS code. Scan the code PS shows on your Mac."); }
      };
      raf = requestAnimationFrame(tick);
    }
    void start();
    return stop;
  }, []);

  const msg = phase === "denied" ? "The camera is off for this app. Allow it in Settings, then Safari (or this app), Camera. Or type it in instead."
    : phase === "nocamera" ? "No camera found here. Type it in instead." : note || SAY[phase];
  const bad = phase === "denied" || phase === "nocamera" || !!note;
  return (
    <main className={`psm-page psm-scan${hit ? " hit" : ""}`} role="dialog" aria-label="Scan the code on your Mac">
      <div className="psm-scan-view psm-in">
        <video ref={video} playsInline muted autoPlay aria-hidden="true" />
        <span className="psm-scan-frame" aria-hidden="true"><i /><i /><i /><i /><b /></span>
      </div>
      <p className={`psm-scan-say${bad ? " bad" : ""}`} role="status" aria-live="polite" key={msg}>{msg}</p>
      <div className="psm-scan-foot">
        <button type="button" className="psm-link" onClick={onCancel}>{phase === "denied" || phase === "nocamera" ? "Type it in instead" : "Cancel"}</button>
      </div>
    </main>
  );
}
