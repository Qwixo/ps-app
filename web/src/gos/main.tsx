// PS GOS: the same app as the website and the PS Mac app, inside a small GrapheneOS shell
// (~/Projects/ps/phone). Built with `vite build --mode gos`; the shell bundles dist-gos and serves it
// from https://appassets.androidplatform.net/client/ so WebCrypto has a secure origin.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import App from "../App";
import { GosLayer } from "./GosLayer";
import { startGos, gosPost } from "./bridge";
import { startFeatureSync } from "../featuresync";
import { startDeviceBeat } from "../devicebeat";
import { startBgVault } from "./bgvault";
import { startKeyboard } from "./keyboard";
import { startCalm } from "./calm";
import "./gos.css";
import "./polish/index.css";
import "./layouts.css";
import { startGosLayout } from "./layout";
import { startNoSelect } from "../ui/noselect";

startGosLayout();   // the list layout this phone used last, before the first paint (src/gos/layout.ts)
startGos();
startNoSelect();   // V1.43: no stray highlighting (src/ui/noselect.ts, ui/noselect.css)
startBgVault();
startKeyboard();
startDeviceBeat();   // PS 1.65: Backgrounds per device (src/devicebeat.ts)
startFeatureSync(gosPost);   // V1.61: every feature's answer to the phone shell (src/featuresync.ts, ps-gos Features.kt)
startCalm();   // no frames for endless animations nobody can see (src/gos/calm.ts, the 1 Nov 2026 freeze)
// Emulator tests with fictional data only; the release build leaves this out entirely.
if (import.meta.env.VITE_GOS_FAKE === "1") void import("./fake").then((m) => m.loadFake());
createRoot(document.getElementById("root")!).render(<StrictMode><App /><GosLayer /></StrictMode>);
