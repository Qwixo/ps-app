// Settings, Privacy and sharing, "Rewind (yearly recap)" (PS 1.64): the line under the switch and Delete my Rewind data.
// Public, on every device. It never shows what Rewind holds (there is nothing to look at before the recap on 1 January,
// core/rewind.ts openYear); Delete asks once more, then takes every Rewind record off every device.
import { useState } from "react";
import { useVault } from "../ui/kit";
import { deleteRewind } from "../rewind";

export const REWIND_ON_LINE = "On. PS keeps a private, encrypted history of your year on your account, for a recap on 1 January. Only you can open it, and not before then.";
export const REWIND_OFF_LINE = "Off. Nothing new is collected. What was kept stays sealed until you delete it.";

export function RewindBody({ on }: { on: boolean }) {
  const v = useVault();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const ready = v.status === "unlocked" && v.role === "owner";
  const del = () => {
    setBusy(true);
    deleteRewind()
      .then(() => setNote("Deleted. Your Rewind starts again from now."))
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : "Could not delete it. Try again."))
      .finally(() => { setBusy(false); setSure(false); });
  };
  return (
    <div className="gs-rewind stack" style={{ gap: 8 }}>
      <p className="gs-set-note">{on ? REWIND_ON_LINE : REWIND_OFF_LINE}</p>
      {ready && (sure
        ? <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="gs-set-note">Delete your whole Rewind history from every device? This cannot be undone.</span>
            <button type="button" className="btn danger sm" disabled={busy} onClick={del}>{busy ? "Deleting" : "Delete it"}</button>
            <button type="button" className="btn quiet sm" disabled={busy} onClick={() => setSure(false)}>Keep it</button>
          </div>
        : <button type="button" className="btn quiet sm" style={{ justifySelf: "start" }} onClick={() => { setNote(""); setSure(true); }}>Delete my Rewind data</button>)}
      {note && <p className="gs-set-note" role="status">{note}</p>}
    </div>
  );
}
