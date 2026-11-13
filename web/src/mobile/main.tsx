// The mobile web app, G Squad on any phone: cincee.com/todolist-mobile, added to the Home Screen from the browser
// (no App Store). The same app as the website, PS on the Mac and PS GOS, built and deployed with the website
// (vite.config.ts input "mobile", scripts/postbuild.mjs), so a change can never ship to one and not the other.
// It shows the PS GOS phone home (src/gos/GosLayer.tsx: List, Plan, Inbox, Gym, Vault) with the browser standing in
// for the phone shell (src/gos/bridge.ts startMobileWeb). Each person's list lives in their own Supabase project.
import "./boot";   // FIRST: the mobile flag and the linked project, before the vault code (src/mobile/app.tsx) loads
import { StrictMode, Suspense, lazy, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "./mobile.css";
import { readLinked } from "./link";
import { GUIDE_SKIP_KEY, appBase, isInstallPath, isStandalone, showGuide } from "./platform";
import { InstallGuide } from "./Install";
import { AppMark } from "./mark";
import { ConnectScreen } from "./Connect";
import { startNoSelect } from "../ui/noselect";

// Nothing above may import the vault (core/vault.ts) or the phone layer: they load here, after boot.
const MobileApp = lazy(() => import("./app"));

const FAKE = import.meta.env.DEV && new URLSearchParams(location.search).has("fake");   // the dev server only: fictional data, pictures
type Stage = "guide" | "connect" | "app";
function firstStage(): Stage {
  if (FAKE) return new URLSearchParams(location.search).get("fake") === "guide" ? "guide" : new URLSearchParams(location.search).get("fake") === "connect" ? "connect" : "app";
  // Add to Home Screen first (the developer: say it right off the bat), unless this phone said "Not now" or this is already the Home Screen app.
  let skipped = false;
  try { skipped = localStorage.getItem(GUIDE_SKIP_KEY) === "1"; } catch { /* storage off */ }
  if (showGuide({ standalone: isStandalone(), skipped, installPath: isInstallPath(location.pathname) })) return "guide";
  // Local first (V1.44): Turn on sync asked for the Connect screen; a phone that started without an account opens its app.
  let connect = false, local = false;
  try { connect = sessionStorage.getItem(CONNECT) === "1"; sessionStorage.removeItem(CONNECT); local = localStorage.getItem(LOCAL) === "1"; } catch { /* storage off */ }
  if (connect && !readLinked()) return "connect";
  return readLinked() || local ? "app" : "connect";
}
const CONNECT = "psm.connect", LOCAL = "psm.local";
/** The Connect screen's way to the app without a project: Start now, or back to the data on this phone. */
function localWay(go: () => void) {
  let local = false;
  try { local = localStorage.getItem(LOCAL) === "1"; } catch { /* storage off */ }
  return { label: local ? "Back to my data on this phone" : "No account yet? Start now on this phone", go: () => { try { localStorage.setItem(LOCAL, "1"); } catch { /* storage off */ } go(); } };
}

function Root() {
  const [stage, setStage] = useState<Stage>(firstStage);
  if (stage === "guide") {
    return <InstallGuide onContinue={() => {
      try { localStorage.setItem(GUIDE_SKIP_KEY, "1"); } catch { /* storage off */ }   // "Not now": remembered on this phone
      if (isInstallPath(location.pathname)) history.replaceState(null, "", appBase(location.pathname));
      let local = false;
      try { local = localStorage.getItem(LOCAL) === "1"; } catch { /* storage off */ }
      setStage(readLinked() || FAKE || local ? "app" : "connect");
    }} />;
  }
  // A new project: start the page again so the vault opens on it (core/vault.ts reads it once, at load).
  if (stage === "connect") return <ConnectScreen onDone={() => location.replace(appBase(location.pathname))} onLocal={localWay(() => setStage("app"))} />;
  return <Suspense fallback={<div className="psm-splash"><AppMark size={72} /></div>}><MobileApp /></Suspense>;
}

// Fictional data as a G Squad friend's account (not the developer's), after the app part has loaded.
if (FAKE) void import("./app").then(() => Promise.all([import("../dev/fake"), import("../core/vault")])).then(([f, v]) => v.__devLoad(f.fakeDocs(), false));
// &gsquad: the fictional G Squad over it, opened as from the phone's menu (V1.47; same modes as the Tab list's).
if (FAKE && location.search.includes("gsquad")) void import("./app").then(() => import("../dev/gsquad-fake")).then((g) => g.loadGSquadFake());
startNoSelect();   // V1.43: no stray highlighting (src/ui/noselect.ts, ui/noselect.css)
createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);

// Offline: this app's own service worker (todolist-mobile/static/sw.js) keeps the app's files; the data stays in the
// encrypted local copy as on the website. Not on the dev server.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const base = appBase(location.pathname);
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
}
