// Settings, WhatsApp settings (PS 1.60): status and Test connection, Link WhatsApp (the guide), Unlink, the switches, the shared quick
// replies, and Who messages me. Off for everyone until they link it. Only offered to the first owner of their own Supabase project
// (the messages are sealed to that project's owner). The guide is views/WaGuide.tsx.
import { useCallback, useEffect, useState } from "react";
import { saveSettings } from "../core/actions";
import { settingsData } from "../core/select";
import { mailCan } from "../core/mailswitch";
import { cleanSwitches } from "../core/features";
import { mailSwitchChanged, sb } from "../core/vault";
import { WA_FEATURE, waSwitch } from "../core/wasnap";
import { prefsOf, setListed, normalizePhone, showPhone } from "../core/whatsapp";
import { refreshWaTemplates, saveWaPrefs, waInvoke } from "../core/waactions";
import { PS, psPost } from "../ps";
import { toast, useVault } from "../ui/kit";
import { WaGuide } from "./WaGuide";
import { WaMark } from "./WaMark";
import "./whatsapp.css";

export const WA_NEEDS = "WhatsApp needs your own Supabase project, and you must be its first owner. Connect it in Settings, Sync and account.";
export interface WaStatus { linked: boolean; number: string | null; verified_at: string | null; last_in_at: string | null; last_error: string | null }
export async function readWaStatus(): Promise<WaStatus | null> {
  try { const { data } = await sb.rpc("whatsapp_status"); return data && typeof data === "object" ? data as WaStatus : null; } catch { return null; }
}

export function WhatsAppSettings() {
  const s = useVault();
  const can = mailCan(s);
  const st = settingsData(s), p = prefsOf(st);
  const on = waSwitch(st.squadFeatures) && p.on !== false;
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [num, setNum] = useState("");
  const load = useCallback(() => { void readWaStatus().then(setStatus); }, []);
  useEffect(() => { if (can) load(); }, [can, load]);
  if (!can) return (
    <section className="panel stack" aria-labelledby="wa-h"><h2 className="h2" id="wa-h"><WaMark size={16} /> WhatsApp settings</h2><p className="small muted">{WA_NEEDS}</p></section>
  );
  const setOn = (v: boolean) => {
    void saveSettings({ squadFeatures: { ...cleanSwitches(st.squadFeatures), [WA_FEATURE]: v }, wa: { ...p, on: v } })
      .then(() => { if (v) mailSwitchChanged(); toast(v ? "WhatsApp messages on" : "WhatsApp messages off"); }).catch(() => toast("Could not save."));
  };
  const test = async () => {
    setBusy(true);
    const r = await waInvoke({ op: "test" });
    if (r?.ok) { toast(`Connected: ${r.number}`); void refreshWaTemplates(); } else toast(r?.error === "not_linked" ? "Not linked yet." : String(r?.error || "Could not connect."));
    load(); setBusy(false);
  };
  const unlink = async () => {
    if (!window.confirm("Unlink WhatsApp? Your number is forgotten here. You can link it again any time.")) return;
    const r = await waInvoke({ op: "unlink" });
    toast(r?.ok ? "Unlinked" : "Could not unlink."); load();
  };
  const sw = (k: "notify" | "sound" | "markRead", label: string) => (
    <label className="wa-sw small"><input type="checkbox" checked={p[k] !== false} onChange={(e) => void saveWaPrefs({ [k]: e.target.checked })} /> {label}</label>
  );
  const list = (k: "muted" | "always", title: string) => (
    <div className="wa-list"><b className="small">{title}</b>
      {(p[k] || []).length ? (p[k] || []).map((n) => <span key={n} className="wa-num small">{showPhone(n)} <button type="button" className="btn quiet sm" aria-label={`Remove ${showPhone(n)}`} onClick={() => void saveWaPrefs(setListed(p, k, n, false))}>Remove</button></span>) : <em className="small muted">None</em>}
      <button type="button" className="btn quiet sm" onClick={() => { const n = normalizePhone(num, p.country); if (!n) { toast("Type the number with its country code, like +1 650 555 1234."); return; } void saveWaPrefs(setListed(p, k, n, true)); setNum(""); }}>Add the number above</button>
    </div>
  );
  return (
    <section className="panel stack" aria-labelledby="wa-h">
      <div className="stack tight" style={{ gap: 2 }}>
        <h2 className="h2" id="wa-h"><WaMark size={16} /> WhatsApp settings</h2>
        <p className="small muted">Reply to WhatsApp messages from PS. Off until you link your number. {`Messages go through Meta's servers to your own Supabase, where PS seals them.`}</p>
      </div>
      <p className="small" role="status">{status?.linked ? <>Linked{status.number ? `: ${status.number}` : ""}</> : "Not linked"}{status?.last_error ? ` (last problem: ${status.last_error})` : ""}</p>
      <div className="wa-row">
        <button type="button" className="btn sm" onClick={() => setGuide(true)}>Link WhatsApp</button>
        <button type="button" className="btn quiet sm" disabled={busy || !status?.linked} onClick={() => void test()}>Test connection</button>
        <button type="button" className="btn quiet sm" disabled={!status?.linked} onClick={() => void unlink()}>Unlink</button>
      </div>
      <div className="x-segs" role="radiogroup" aria-label="WhatsApp messages">
        <button className="chip" role="radio" aria-checked={on} aria-pressed={on} onClick={() => setOn(true)}>On</button>
        <button className="chip" role="radio" aria-checked={!on} aria-pressed={!on} onClick={() => setOn(false)}>Off</button>
      </div>
      {on && (
        <div className="stack tight">
          {sw("notify", "Notifications")}{sw("sound", "Sound")}{sw("markRead", "Mark as read when I reply")}
          <div className="small"><b>Quick replies</b> are the same list the email panel uses, one list for both. {PS
            ? <button type="button" className="btn quiet sm" onClick={() => psPost({ type: "looks", patch: { replySetup: true } })}>Open</button>
            : "Edit them in the email panel on your Mac."}</div>
          <label className="small">Who messages me: a number <input className="wa-input" value={num} onChange={(e) => setNum(e.target.value)} placeholder="+1 650 555 1234" inputMode="tel" aria-label="A phone number" /></label>
          {list("muted", "Muted numbers")}{list("always", "Always notify for")}
          <label className="small">Your calling code, for numbers typed without one <input className="wa-input" value={p.country || ""} onChange={(e) => void saveWaPrefs({ country: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="421" inputMode="numeric" aria-label="Your calling code" /></label>
        </div>
      )}
      {guide && <WaGuide onClose={() => { setGuide(false); load(); }} />}
    </section>
  );
}
