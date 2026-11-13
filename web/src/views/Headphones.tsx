// Headphones mode (V1.40, G Squad), at the top of the volume mixer pop-up on every account. A Speakers |
// Headphones switch; its own Auto switch On or Off (off until turned on); Devices opens the lists: for each mode
// a sound output and a microphone in fallback order (1st, then 2nd when the 1st is not connected).
// The Mac switches (ps-mac Sources/Headphones.swift); the lists and the auto switch are saved as settings.tmAudio
// (core/audiomode.ts) and sync like other PS settings. Click only.
import { useEffect, useState, useSyncExternalStore } from "react";
import { psPost } from "../ps";
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { addTo, audioPrefs, cleanAudioState, listsFor, moveUp, pickNow, removeFrom, type AudioDev, type AudioList, type AudioMode, type AudioPrefs, type AudioState } from "../core/audiomode";
import "./headphones.css";

let state: AudioState | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  (window as Window & { __psHpMode?: unknown }).__psHpMode = (m: unknown) => {
    const s = cleanAudioState(m);
    if (!s) return;
    state = s;
    listeners.forEach((l) => l());
  };
}
const useHp = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
const send = (m: Record<string, unknown>) => psPost({ type: "hpmode", ...m });

const SpeakerIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>;
const HeadphonesIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="14" width="4.5" height="7" rx="1.6" fill="currentColor" /><rect x="16.5" y="14" width="4.5" height="7" rx="1.6" fill="currentColor" /></svg>;

const EMPTY: Record<AudioList, string> = {
  spkOut: "None picked: your Mac's built in speakers.",
  hpOut: "None picked: the first headphones that are connected.",
  spkMic: "None picked: the microphone stays as it is.",
  hpMic: "None picked: the microphone stays as it is.",
};

function DevList({ k, title, prefs, devs, current, set }: { k: AudioList; title: string; prefs: AudioPrefs; devs: AudioDev[]; current: string; set: (p: AudioPrefs) => void }) {
  const list = prefs[k];
  const inUse = pickNow(list, devs);
  const others = devs.filter((d) => d.alive && !list.some((r) => r.uid === d.uid || (r.name && r.name.toLowerCase() === d.name.toLowerCase())));
  return (
    <div className="hp-sec" data-list={k}>
      <b className="hp-sec-t">{title}</b>
      {list.length === 0 && <span className="hp-empty">{EMPTY[k]}</span>}
      {list.map((r, i) => {
        const here = devs.find((d) => d.alive && (d.uid === r.uid || (!!r.name && d.name.toLowerCase() === r.name.toLowerCase())));
        const active = !!here && here.uid === current && inUse?.uid === here.uid;
        return (
          <div key={r.uid} className={`hp-dev${active ? " active" : ""}${here ? "" : " gone"}`} data-uid={r.uid}>
            {active ? <span className="hp-badge">Active</span> : <span className="hp-num num">{i + 1}</span>}
            <span className="hp-name">{r.name || r.uid}{!here && <em>not connected</em>}</span>
            {i > 0 && <button type="button" className="hp-mini" aria-label={`Move ${r.name} up`} title="Move up" onClick={() => { sfx.click(); set(moveUp(prefs, k, r.uid)); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
            </button>}
            <button type="button" className="hp-mini" aria-label={`Remove ${r.name}`} title="Remove" onClick={() => { sfx.click(); set(removeFrom(prefs, k, r.uid)); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        );
      })}
      {others.length > 0 && list.length < 8 && (
        <div className="hp-add"><span>Add</span>
          {others.map((d) => <button key={d.uid} type="button" className="mix-chip" onClick={() => { sfx.click(); set(addTo(prefs, k, d)); }}>{d.name}</button>)}
        </div>
      )}
    </div>
  );
}

export function HeadphonesSwitch() {
  const st = useHp();
  const saved = audioPrefs(settingsData(useVault()).tmAudio);
  const [local, setLocal] = useState<AudioPrefs | null>(null);
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<AudioMode | null>(null);
  const [asked, setAsked] = useState<AudioMode | null>(null);   // the switch lights at once; the Mac's answer follows
  useEffect(() => { send({ op: "get" }); }, []);
  useEffect(() => { if (local && JSON.stringify(local) === JSON.stringify(saved)) setLocal(null); }, [local, saved]);
  useEffect(() => { setAsked(null); }, [st]);
  const prefs = local ?? saved;
  const save = (p: AudioPrefs) => {
    setLocal(p);
    send({ op: "prefs", prefs: p });                         // the Mac at once
    psPost({ type: "looks", patch: { tmAudio: p } });       // the vault, so every device has it
  };
  const mode: AudioMode = asked ?? st?.mode ?? "speakers";
  const pick = (m: AudioMode) => { sfx.click(); setAsked(m); send({ op: "mode", mode: m }); };
  const view: AudioMode = tab ?? mode;
  const lk = listsFor(view);
  const outName = st?.outs.find((d) => d.uid === st.out)?.name;
  const micName = st?.ins.find((d) => d.uid === st.mic)?.name;
  return (
    <div className="hp" role="group" aria-label="Headphones mode">
      <div className="hp-seg" role="radiogroup" aria-label="Speakers or headphones">
        <button type="button" role="radio" aria-checked={mode === "speakers"} className={mode === "speakers" ? "on" : ""} onClick={() => pick("speakers")}><SpeakerIcon />Speakers</button>
        <button type="button" role="radio" aria-checked={mode === "headphones"} className={mode === "headphones" ? "on" : ""} onClick={() => pick("headphones")}><HeadphonesIcon />Headphones</button>
      </div>
      {st && (outName || micName) && <span className="hp-now">{outName && <>Sound: <b>{outName}</b></>}{outName && micName && " · "}{micName && <>Mic: <b>{micName}</b></>}</span>}
      {st?.note && <span className="hp-note" role="status">{st.note}</span>}
      <div className="hp-row">
        <span className="hp-lab">Auto switch</span>
        <button type="button" className={`mix-chip${prefs.auto ? " on" : ""}`} aria-pressed={prefs.auto} onClick={() => { sfx.click(); save({ ...prefs, auto: true }); }}>On</button>
        <button type="button" className={`mix-chip${!prefs.auto ? " on" : ""}`} aria-pressed={!prefs.auto} onClick={() => { sfx.click(); save({ ...prefs, auto: false }); }}>Off</button>
        <button type="button" className={`mix-b hp-edit${edit ? " on" : ""}`} aria-expanded={edit} onClick={() => { sfx.click(); setEdit((x) => !x); setTab(null); }}>Devices</button>
      </div>
      <span className="hp-why">{prefs.auto ? "Headphones when they connect, Speakers when they go." : "Off: PS only switches when you click above."}</span>
      {edit && (
        <div className="hp-edit-box">
          <div className="hp-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={view === "speakers"} className={`mix-chip${view === "speakers" ? " on" : ""}`} onClick={() => { sfx.click(); setTab("speakers"); }}>Speakers mode</button>
            <button type="button" role="tab" aria-selected={view === "headphones"} className={`mix-chip${view === "headphones" ? " on" : ""}`} onClick={() => { sfx.click(); setTab("headphones"); }}>Headphones mode</button>
          </div>
          {!st && <span className="hp-empty">Loading…</span>}
          {st && <>
            <DevList k={lk.out} title="Sound out" prefs={prefs} devs={st.outs} current={st.out} set={save} />
            <DevList k={lk.mic} title="Microphone" prefs={prefs} devs={st.ins} current={st.mic} set={save} />
          </>}
          <span className="hp-why">If the 1st is not connected, the next one is used. Saved to your account.</span>
        </div>
      )}
    </div>
  );
}
