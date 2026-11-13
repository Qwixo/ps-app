// "Link your phone" (V1.56, the developer: "if your phone isn't linked, then I want when you click on the phone icon ... it to come
// up with how to link your phone and it will give you QR stuff and help you log your phone on to the PS app"). Opens
// from the phone button in Edit mode (views/PhoneEditor.tsx) when no phone of that kind has opened PS yet.
//
// Nothing new is built for the linking itself: it is the V1.55 code from Settings, Sync and account (views/LinkIphone.tsx
// and views/LinkPair.tsx): one QR that links the project and carries a one time sign in offer, the same six numbers on
// both screens, Allow, and the phone signs in by itself. GrapheneOS first gets a QR to install PS GOS.
// When the phone signs in (Allow done, or its phone record arrives), it chimes and the caller zooms into its editor.
import { useEffect, useMemo, useRef, useState } from "react";
import { PS } from "../ps";
import { PROJECT } from "../core/vault";
import { onRedProject } from "../core/project";
import { useVault } from "../ui/kit";
import { phoneLinkUrl } from "../mobile/linkcode";
import { QrCode } from "./AddFriend";
import { PairPanel, usePhonePairing } from "./LinkPair";
import { phoneName, type PhoneKind } from "../core/phonelayout";
import type { PhoneDev } from "../core/phonedevices";
import { phoneSfx } from "../ui/phonesfx";
import "./addfriend.css";

/** Where PS for GrapheneOS is downloaded (the install help page on cincee.com, with the newest APK). */
export const GOS_INSTALL_URL = "https://cincee.com/ps-app-gos/";

export function PhoneLinkCard({ phone, devs, onLinked, onAnyway, onClose }: {
  phone: PhoneKind; devs: PhoneDev[]; onLinked: (d: PhoneDev | null) => void; onAnyway: () => void; onClose: () => void;
}) {
  const v = useVault();
  const red = onRedProject();
  // The same rule as Settings' Link your iPhone row: PS on this Mac, data synced (not only on this device).
  const can = PS && !v.local && (red || PROJECT.custom);
  const [step, setStep] = useState<"install" | "link">(phone === "gos" ? "install" : "link");
  const pair = usePhonePairing(can && step === "link");
  const made = useMemo(() => phoneLinkUrl(PROJECT.url, PROJECT.key, PROJECT.schema, undefined, red ? null : v.username, PROJECT), [v.username, red]);
  const text = "ok" in made ? made.ok + pair.part : "";
  // Signed in: Allow went through, or a phone of this kind wrote its record (it also signed in another way).
  const known = useRef(new Set(devs.map((d) => d.dev)));
  const [linked, setLinked] = useState(false);
  const fresh = devs.find((d) => d.phone === phone && !known.current.has(d.dev)) ?? null;
  useEffect(() => {
    if (linked || !(pair.phase.k === "done" || fresh)) return;
    setLinked(true);
    phoneSfx.linked();
    const t = window.setTimeout(() => onLinked(fresh), 1100);
    return () => window.clearTimeout(t);
  }, [pair.phase.k, fresh, linked]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = phone === "gos" ? "GrapheneOS phone" : "iPhone";
  return (
    <div className="pl-card" role="dialog" aria-label={`Link your ${name}`} onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className="pl-x" onClick={onClose} aria-label="Close">{"×"}</button>
      {linked ? (
        <div className="pl-done" role="status"><span className="pl-tick" aria-hidden="true" /><b>Linked!</b><em>Opening your {phoneName(phone)} layout</em></div>
      ) : (<>
        <h3>Link your {name}</h3>
        {phone === "gos" && (
          <div className="pl-steps" role="tablist">
            <button type="button" role="tab" aria-selected={step === "install"} className={step === "install" ? "on" : ""} onClick={() => { phoneSfx.click(); setStep("install"); }}>1. Install PS</button>
            <button type="button" role="tab" aria-selected={step === "link"} className={step === "link" ? "on" : ""} onClick={() => { phoneSfx.click(); setStep("link"); }}>2. Sign it in</button>
          </div>
        )}
        {step === "install" ? (
          <div className="pl-body" key="install">
            <div className="af-qr pl-qr"><QrCode text={GOS_INSTALL_URL} label="QR code: download PS for GrapheneOS" /></div>
            <ol className="pl-list">
              <li>Point the phone's camera here and open the link.</li>
              <li>Download PS for GrapheneOS and install it (allow installs from your browser once if asked).</li>
              <li>Open PS on the phone, then tap <b>Next</b> here.</li>
            </ol>
            <button type="button" className="ed-btn ed-done pl-next" onClick={() => { phoneSfx.click(); setStep("link"); }}>Next</button>
          </div>
        ) : !can ? (
          <div className="pl-body" key="cant">
            <p className="pl-note">Linking a phone needs PS on this Mac with your list synced to your account (Settings, Sync and account). Then come back here.</p>
          </div>
        ) : "ok" in made ? (
          <div className="pl-body" key="link">
            {pair.phase.k !== "confirm" && pair.phase.k !== "sending" && pair.phase.k !== "sent" && <div className="af-qr pl-qr"><QrCode text={text} label={`QR code: sign in your ${name}`} /></div>}
            <PairPanel p={pair} />
            {pair.phase.k === "ready" || pair.phase.k === "off" ? (
              <ol className="pl-list">
                {phone === "ios" ? (<>
                  <li>Open the Camera on your iPhone, point it here and tap the link.</li>
                  <li>Add PS to your Home Screen when it shows you how, then open it from there.</li>
                  <li>Tap <b>Scan the code on your Mac</b> and scan this again.</li>
                </>) : (<>
                  <li>Open PS on the phone.</li>
                  <li>Tap <b>Scan the code on your Mac</b> and point it here.</li>
                </>)}
                {pair.part ? <li>Both screens show the same six numbers: press <b>Allow</b> here. No typing.</li>
                  : <li>Then type your passphrase on the phone.</li>}
              </ol>
            ) : null}
            <p className="pl-note">The code changes every minute and never holds your passphrase or a secret key.</p>
          </div>
        ) : <div className="pl-body"><p className="pl-note">{made.error}</p></div>}
        <button type="button" className="pl-anyway" onClick={onAnyway}>Design the {phoneName(phone)} layout now, link later</button>
      </>)}
    </div>
  );
}
