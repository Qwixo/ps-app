// The Mac's half of "sign in by scanning the Mac" (V1.55, src/core/phonepair.ts), inside Settings, Link your iPhone.
// While the code is on screen, the Mac keeps one open offer at a time (a new one every minute), watches it, and when a
// phone claims it shows the six digit code with Allow and Not my phone: a PS panel in Settings, never a pop-up that
// blocks anything. Allow seals this Mac's sign in to that phone (core/vault.ts sealLinkFor). Below it, the phones
// signed in this way, each with Remove.
import { useCallback, useEffect, useRef, useState } from "react";
import { OFFER_MS, ALLOW_MS, POLL_MS, linkCode, newOffer, offerPart, type MacSide } from "../core/phonepair";
import { canLinkPhone, listPhones, removePhone, sb, sealLinkFor, type LinkedPhone } from "../core/vault";
import { sfx } from "../ui/sfx";

type Phase =
  | { k: "off" }                                   // no pairing here (signed in without keys in memory, or the project is older)
  | { k: "ready" }                                 // the QR carries an offer, nobody has scanned it yet
  | { k: "confirm"; code: string; phone: string }  // a phone scanned it: compare the codes
  | { k: "sending" } | { k: "sent" } | { k: "done" } | { k: "error"; text: string };

/** The offer to put in the QR ("" when there is none) and the panel's state. Only while `on`. */
export function usePhonePairing(on: boolean) {
  const [phase, setPhase] = useState<Phase>({ k: "off" });
  const [part, setPart] = useState("");
  const cur = useRef<MacSide | null>(null);
  const phase$ = useRef(phase); phase$.current = phase;
  const gen = useRef(0);

  const drop = async (m: MacSide | null) => { if (m) await sb.from("ps_link_offers").delete().eq("id", m.offer.id).then(() => {}, () => {}); };
  const fresh = useCallback(async () => {
    const g = ++gen.current;
    const old = cur.current; cur.current = null; setPart("");
    void drop(old);
    if (!canLinkPhone()) { setPhase({ k: "off" }); return; }
    try {
      const m = await newOffer();
      const { error } = await sb.from("ps_link_offers").insert({ id: m.offer.id });
      if (g !== gen.current) { void drop(m); return; }
      if (error) { setPhase({ k: "off" }); return; }   // migration 029 not on this project yet: the code links the project only
      cur.current = m; setPart(offerPart(m.offer)); setPhase({ k: "ready" });
    } catch { if (g === gen.current) setPhase({ k: "off" }); }
  }, []);

  useEffect(() => {
    if (!on) return;
    void fresh();
    let made = Date.now(), claimedAt = 0, busy = false;
    const t = window.setInterval(async () => {
      const m = cur.current, p = phase$.current;
      if (busy || !m) return;
      busy = true;
      try {
        if (p.k === "ready") {
          if (Date.now() - made > OFFER_MS - 5_000) { made = Date.now(); await fresh(); return; }   // a new code every minute
          const { data } = await sb.from("ps_link_offers").select("phone_pub").eq("id", m.offer.id).maybeSingle();
          const phone = (data as { phone_pub?: string | null } | null)?.phone_pub;
          if (!phone || cur.current !== m) return;
          // The phone's key is fixed now: only now reveal the nonce the QR committed to (core/phonepair.ts step 3).
          const { error } = await sb.from("ps_link_offers").update({ reveal: m.nonce }).eq("id", m.offer.id);
          if (error) { await fresh(); return; }
          claimedAt = Date.now();
          sfx.click();
          setPhase({ k: "confirm", code: await linkCode(m.offer, phone, m.nonce), phone });
        } else if (p.k === "confirm" && Date.now() - claimedAt > ALLOW_MS) {
          made = Date.now(); await fresh();
        } else if (p.k === "sent") {
          const { data } = await sb.from("ps_link_offers").select("id").eq("id", m.offer.id).maybeSingle();
          if (!data) { cur.current = null; setPhase({ k: "done" }); }   // the phone took it: signed in there
          else if (Date.now() - claimedAt > ALLOW_MS) { made = Date.now(); await fresh(); }
        }
      } finally { busy = false; }
    }, POLL_MS);
    return () => { window.clearInterval(t); gen.current++; void drop(cur.current); cur.current = null; setPart(""); setPhase({ k: "off" }); };
  }, [on, fresh]);

  const allow = useCallback(async () => {
    const m = cur.current, p = phase$.current;
    if (!m || p.k !== "confirm") return;
    setPhase({ k: "sending" });
    try {
      const { sealed } = await sealLinkFor(m, p.phone);
      const { error } = await sb.from("ps_link_offers").update({ sealed }).eq("id", m.offer.id);
      if (error) throw new Error("PS could not reach your project. Try again.");
      setPhase({ k: "sent" });
    } catch (e) { setPhase({ k: "error", text: (e as Error).message || "That did not work. Try again." }); }
  }, []);
  const deny = useCallback(() => { sfx.click(); void fresh(); }, [fresh]);
  return { phase, part, allow, deny, again: fresh };
}

/** The code, Allow and Not my phone, under the QR. */
export function PairPanel({ p }: { p: ReturnType<typeof usePhonePairing> }) {
  const ph = p.phase;
  if (ph.k === "off" || ph.k === "ready") return null;
  return (
    <div className="li-pair" role="alert">
      {ph.k === "confirm" ? (<>
        <b>A phone scanned your code</b>
        <span className="li-pair-code" aria-label={`Code ${ph.code}`}>{ph.code}</span>
        <span>Does your phone show this same code? Allow signs it in to your PS, with no typing. Only press Allow for your own phone.</span>
        <div className="li-pair-btns">
          <button type="button" className="gs-go" onClick={() => void p.allow()}>Allow</button>
          <button type="button" className="gs-ghost" onClick={p.deny}>Not my phone</button>
        </div>
      </>) : ph.k === "sending" || ph.k === "sent" ? (
        <span>Signing your phone in...</span>
      ) : ph.k === "done" ? (<>
        <b>Your phone is signed in</b>
        <button type="button" className="gs-ghost" onClick={() => void p.again()}>Link another phone</button>
      </>) : (<>
        <span className="li-err">{ph.text}</span>
        <button type="button" className="gs-ghost" onClick={() => void p.again()}>Show a new code</button>
      </>)}
    </div>
  );
}

/** Phones signed in from a Mac, each with Remove. */
export function LinkedPhones({ refresh }: { refresh: unknown }) {
  const [list, setList] = useState<LinkedPhone[] | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const load = useCallback(() => { void listPhones().then(setList); }, []);
  useEffect(load, [load, refresh]);
  if (!list?.length) return null;
  const day = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="li-phones">
      <b>Phones signed in by scanning</b>
      {list.map((d, i) => (
        <div className="li-phone" key={d.id}>
          <span>Phone {i + 1}, since {day(d.created_at)}</span>
          {sure === d.id
            ? <button type="button" className="gs-ghost" onClick={() => { sfx.click(); setSure(null); void removePhone(d.id).then(load); }}>Yes, remove</button>
            : <button type="button" className="gs-ghost" onClick={() => setSure(d.id)}>Remove</button>}
        </div>
      ))}
      <small>Remove signs that phone out the next time it opens. Lost a phone? Remove it, then change your passphrase too.</small>
    </div>
  );
}
