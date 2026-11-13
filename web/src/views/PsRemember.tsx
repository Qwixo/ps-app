// PS Mac app only: the "Remember me" box on the sign-in screen (ticked by default). Ticked, PS
// keeps the derived keys in this Mac's Keychain and never signs you out; Lock locks it and Touch ID opens it again.
import { useState } from "react";
import { PS, rememberChoice, setRememberChoice } from "../ps";
import { appName } from "../core/appname";

export function PsRememberBox() {
  const [on, setOn] = useState(rememberChoice());
  if (!PS) return null;
  return (
    <label className="row small" style={{ alignItems: "flex-start" }}>
      <input className="check" type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setRememberChoice(e.target.checked); }} />
      <span>Remember me on this Mac. {appName()} stays signed in. Lock it any time and open it again with Touch ID.</span>
    </label>
  );
}
