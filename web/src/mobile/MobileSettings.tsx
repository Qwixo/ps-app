// The mobile web app's sign in extras. Its settings sheet (the PS GOS gear sheet's place in the dock) is gone since V1.47:
// every switch it had (Home Screen, layout, NEW badges, vibration, alerts, the project, lock) is a row of the same Settings
// as the Mac and the phone app (gos/PhoneRows.tsx, the "mweb" rows of core/settingsindex.ts), so public features keep their
// controls visible.
import { useState } from "react";
import { createPortal } from "react-dom";
import { activeProject } from "../core/project";
import { signOutAndForget } from "../core/vault";
import { forgetLinked, projectHost } from "./link";
import { appBase } from "./platform";

/** Forget this phone's project: signs out here (the list stays safe in the project), then back to Connect. */
export async function changeProject() {
  await signOutAndForget().catch(() => {});
  try { forgetLinked(); } catch { /* storage off */ }
  location.replace(appBase(location.pathname));
}

/** Under the sign in screen: which project this phone talks to, and a way to change it. */
export function MobileLockExtras() {
  const [sure, setSure] = useState(false);
  const host = projectHost(activeProject()?.url || "");
  if (!host) return null;
  return createPortal(
    <div className="psm-lockbar">
      <span className="psm-lockbar-h" title={host}>Project {host.split(".")[0].slice(0, 6)}…</span>
      {sure
        ? <button type="button" className="psm-link" onClick={() => void changeProject()}>Yes, change project</button>
        : <button type="button" className="psm-link" onClick={() => setSure(true)}>Change project</button>}
    </div>,
    document.body,
  );
}
