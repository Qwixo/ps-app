// Settings, Sync and account, "Link your iPhone" (Mac). A friend who runs PS on their own Supabase project links their
// iPhone by scanning this code instead of pasting the project address and publishable key. The code is a link to the
// phone web app with both after the # (browsers never send that part to any server), made here, on this Mac, with
// the QR code the Add friend screen already uses (core/qrcode.ts). Never the secret key (src/mobile/linkcode.ts refuses it).
// Shown only when PS is on a person's own project, never on the developer's (onRedProject), and not while the data is only on
// this device (nothing to link then). Tests: tests/phonelink.test.ts.
import { useEffect, useMemo, useState } from "react";
import { PS } from "../ps";
import { PROJECT } from "../core/vault";
import { onRedProject } from "../core/project";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { phoneLinkUrl } from "../mobile/linkcode";
import { QrCode } from "./AddFriend";
import { LinkedPhones, PairPanel, usePhonePairing } from "./LinkPair";
import { LINK_WAIT_NOTE } from "../core/pairengine";
import { SetRow } from "./SettingsScreen";
import type { SetEntry } from "../core/settingsindex";
import "./addfriend.css";
import "./linkiphone.css";

/** The dev server only (never in a build): ?linkiphone shows the code for a made up project, to look at it. */
const DEV = import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("linkiphone");
const DEV_URL = "https://abcdefghijklmnopqrst.supabase.co";
const DEV_KEY = "sb_publishable_madeUpKeyForTheDevServerOnly01";

export function LinkIphoneRow({ e, red = false }: { e: SetEntry; red?: boolean }) {
  const v = useVault();
  const local = !!v.local;
  const [open, setOpen] = useState(() => DEV && new URLSearchParams(location.search).get("linkiphone") === "open");
  const made = useMemo(() => phoneLinkUrl(DEV ? DEV_URL : PROJECT.url, DEV ? DEV_KEY : PROJECT.key, PROJECT.schema, undefined, DEV || red ? null : v.username, PROJECT), [v.username, red]);
  // V1.55: the same code also carries a one time sign in offer (views/LinkPair.tsx), so the phone signs in by itself
  // after Allow here. "red": the row on the developer's project, where the phone needs no project link, only the sign in.
  const shown = DEV || (PS && !local && (red ? onRedProject() : PROJECT.custom && !onRedProject()));
  const pair = usePhonePairing(!!shown && open && !DEV);
  const [doneAt, setDoneAt] = useState(0);
  useEffect(() => { if (pair.phase.k === "done") setDoneAt(Date.now()); }, [pair.phase.k]);
  if (!shown) return null;
  const toggle = () => { sfx.click(); setOpen((o) => !o); };
  const text = "ok" in made ? made.ok + pair.part : "";
  return (
    <SetRow e={e} className="li-row"
      right={<button type="button" className="gs-go" onClick={toggle} aria-expanded={open}>{open ? "Hide the code" : red ? "Show the code" : "Link your iPhone"}</button>}
      body={open ? (
        <div className="li" role="status">
          {"ok" in made ? (<>
            {pair.phase.k !== "confirm" && pair.phase.k !== "sending" && pair.phase.k !== "sent" && <div className="af-qr li-qr"><QrCode text={text} label={red ? "QR code: sign in your phone" : "QR code: link your iPhone to your PS project"} /></div>}
            <PairPanel p={pair} />
            {pair.part ? (pair.phase.k === "ready" && <>
              <div className="af-say"><b>Scan this in PS on your phone</b><span>Open PS app on your phone and tap <i>Scan the code on your Mac</i>. Both screens then show the same six numbers: press Allow here and your phone is signed in, with no typing.</span></div>
              <p className="af-small">{red ? "The code works once, for one minute, and only after you press Allow." : "Or open the Camera on your iPhone and point it here to link it, then type your passphrase."} The code changes every minute. It never holds your passphrase or a secret key.</p>
            </>) : red ? (
              <p className="af-small">Signing a phone in from here needs this Mac signed in with your passphrase or Remember me, and the latest PS on your project.</p>
            ) : (<>
              <div className="af-say"><b>Scan this with your iPhone</b><span>Open the Camera on your iPhone and point it here, then tap the link that pops up. Then type your passphrase. Nothing to copy or paste.</span></div>
              <p className="af-small">Already added PS to your Home Screen? Open it and tap <i>Scan the code on your Mac</i> on its first screen instead. The code holds your project's address and its public key only, never a secret.</p>
            </>)}
            {pair.phase.k !== "done" && <p className="af-small">{LINK_WAIT_NOTE}</p>}
            <LinkedPhones refresh={doneAt} />
          </>) : <p className="af-small li-err">{made.error}</p>}
        </div>
      ) : undefined} open={open} plain />
  );
}
