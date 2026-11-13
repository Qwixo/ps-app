// The mobile web app: the Add to Home Screen guide. Shown when the page is opened in a browser tab (not from the
// Home Screen icon), and at /todolist-mobile/install any time. The steps follow the phone and browser it is on
// (src/mobile/platform.ts). Installing first matters on iPhone: a Home Screen app keeps its own storage, so
// connecting in a Safari tab first would mean doing it twice.
import { useEffect, useState, type ReactNode } from "react";
import { MOBILE_APP_NAME } from "../core/appname";
import { detectPlatform, isStandalone, type Platform } from "./platform";
import { AppMark } from "./mark";
import { fragmentLink } from "./boot";
import { ArtAddButton, ArtAddRow, ArtOpen, ArtShare } from "./GuideArt";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: BIP | null = null;
const waiting = new Set<() => void>();
// Android Chrome offers its own Install sheet; keep the offer for the button below.
if (typeof window !== "undefined") window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BIP; waiting.forEach((f) => f()); });

const sv = { viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const ShareIcon = () => <svg {...sv}><path d="M12 15V3.5M7.5 8L12 3.5 16.5 8" /><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" /></svg>;
const AddIcon = () => <svg {...sv}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></svg>;
const DotsIcon = () => <svg {...sv}><circle cx="12" cy="5.5" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="18.5" r="1.3" fill="currentColor" /></svg>;
const ToggleIcon = () => <svg {...sv}><rect x="3" y="7" width="18" height="10" rx="5" /><circle cx="16" cy="12" r="3" fill="currentColor" /></svg>;
const HomeIcon = () => <svg {...sv}><path d="M4 11l8-6.5 8 6.5" /><path d="M6 9.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5" /></svg>;

function Step({ n, icon, art, children }: { n: number; icon?: ReactNode; art?: ReactNode; children: ReactNode }) {
  return (
    <li className={`psm-step psm-in${art ? " has-art" : ""}`} style={{ ["--d" as string]: `${80 + n * 110}ms`, ["--n" as string]: n }}>
      <span className="psm-step-n">{n}</span>
      <span className="psm-step-t">{children}</span>
      {art ? <span className="psm-step-art">{art}</span> : <span className="psm-step-ic">{icon}</span>}
    </li>
  );
}

function Steps({ p }: { p: Platform }) {
  if (p === "ios-safari" || p === "ios-other") return (
    <ol className="psm-steps-big">
      <Step n={1} art={<ArtShare />}>Tap the <b>Share</b> button (a square with an arrow). {p === "ios-safari" ? <>Do not see it? Tap the <b>three dots</b> <b>⋯</b> first.</> : <>It is next to the address bar. Do not see it? Open this page in <b>Safari</b>.</>}</Step>
      <Step n={2} art={<ArtAddRow />}>Tap <b>Add to Home Screen</b>. Tap <b>View More</b> if you do not see it.</Step>
      <Step n={3} art={<ArtAddButton />}>Tap <b>Add</b>. Leave <b>Open as Web App</b> on.</Step>
      <Step n={4} art={<ArtOpen />}>Then open <b>{MOBILE_APP_NAME}</b> from your Home Screen.</Step>
    </ol>
  );
  if (p === "android") return (
    <ol className="psm-steps-big">
      <Step n={1} icon={<DotsIcon />}>Tap the browser menu <b>⋮</b> at the top right.</Step>
      <Step n={2} icon={<AddIcon />}>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.</Step>
      <Step n={3} icon={<HomeIcon />}>Open <b>{MOBILE_APP_NAME}</b> from your Home screen and sign in there.</Step>
    </ol>
  );
  return null;
}

export function InstallGuide({ onContinue, installed }: { onContinue: () => void; installed?: boolean }) {
  // The dev server only: ?platform=ios-safari shows another phone's steps (pictures from a desktop browser).
  const devP = import.meta.env.DEV ? new URLSearchParams(location.search).get("platform") as Platform | null : null;
  const [p] = useState<Platform>(() => devP || detectPlatform(navigator.userAgent, navigator.maxTouchPoints || 0));
  const [canPrompt, setCanPrompt] = useState(!!deferred);
  useEffect(() => { const f = () => setCanPrompt(true); waiting.add(f); return () => { waiting.delete(f); }; }, []);
  const standalone = installed ?? isStandalone();
  const here = `${location.host}${location.pathname.replace(/install\/?$/, "")}`.replace(/\/$/, "");

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const r = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    deferred = null;
    setCanPrompt(false);
    if (r.outcome === "accepted") onContinue();
  }

  return (
    <main className="psm-page psm-guide" data-platform={p}>
      <header className="psm-hero psm-in">
        <AppMark size={84} />
        <h1>{MOBILE_APP_NAME}</h1>
        <p>{p === "desktop" ? "Your to-do list on your phone, end to end encrypted." : <>Save it as an app on your {p === "android" ? "phone" : "iPhone"}. Takes about 20 seconds. It opens full screen, like any app.</>}</p>
      </header>

      {standalone ? (
        <section className="psm-card psm-in" style={{ ["--d" as string]: "120ms" }}>
          <h2>Already on your Home Screen</h2>
          <p>You opened {MOBILE_APP_NAME} from its icon. Nothing else to do.</p>
        </section>
      ) : p === "desktop" ? (
        <section className="psm-card psm-in" style={{ ["--d" as string]: "120ms" }}>
          <h2>Open this on your phone</h2>
          <p>Type this address into your phone's browser (Safari on iPhone):</p>
          <p className="psm-addr">{here}</p>
          <p className="psm-dim">On a computer, PS app on your Mac is the better fit.</p>
        </section>
      ) : (
        <section className="psm-card psm-in" style={{ ["--d" as string]: "120ms" }}>
          <h2>Add to Home Screen</h2>
          {p === "android" && canPrompt && <button type="button" className="psm-btn" onClick={() => void install()}>Install {MOBILE_APP_NAME}</button>}
          <Steps p={p} />
          {(p === "ios-safari" || p === "ios-other") && <p className="psm-dim psm-after">First time in the app, tap <b>Scan the code on your Mac</b> to link it.</p>}
        </section>
      )}

      {/* Opened from the Mac's code with the Camera: linked in this browser. A Home Screen app keeps its own storage. */}
      {fragmentLink?.state === "saved" && !standalone && (
        <section className="psm-card psm-linked psm-in" style={{ ["--d" as string]: "260ms" }} role="status">
          <h2>Linked to your PS project</h2>
          <p>{p === "ios-safari" || p === "ios-other" ? <>This is saved in the browser only. After you add {MOBILE_APP_NAME} to your Home Screen, open it and tap <b>Scan the code on your Mac</b> once, with the same code.</> : <>Tap <b>Not now</b> below to sign in.</>}</p>
        </section>
      )}

      <footer className="psm-foot psm-in" style={{ ["--d" as string]: "420ms" }}>
        <button type="button" className="psm-link" onClick={onContinue}>{standalone ? `Back to ${MOBILE_APP_NAME}` : p === "ios-safari" ? "Not now, use it in Safari" : "Not now, use it in the browser"}</button>
      </footer>
    </main>
  );
}
