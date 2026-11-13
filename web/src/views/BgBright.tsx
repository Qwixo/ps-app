// The developer's own background video: its brightness slider and the phone's Add video tile (V1.33).
// Kept out of TaskMap.tsx so the list file only gains a few lines: the slider (Settings, Looks, Background,
// shown while a video is the picked background), the darkening layer the list puts over the video, and the
// live preview while the slider moves (this page only, nothing saved until the finger or mouse lets go).
import { looksOption } from "../core/looksoptions";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Settings } from "../core/model";
import { BG_BRIGHT_DEFAULT, bgBright, bgDim } from "../core/bgbright";
import { useVaultVideos } from "../core/bgvault";

let preview: number | null = null;
const subs = new Set<() => void>();
function setPreview(v: number | null) {
  if (v === preview) return;
  preview = v;
  subs.forEach((f) => f());
}
/** The brightness to draw: the slider while it moves, else the saved one. */
export function useBgBright(saved: unknown): number {
  const p = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => preview);
  return p ?? bgBright(saved);
}

/** The black layer over the video (the list's background, or a Looks tile's sample when `sample`). Nothing at 100%. */
export function BgDim({ saved, sample }: { saved: unknown; sample?: boolean }) {
  const dim = bgDim(useBgBright(saved));
  if (dim <= 0) return null;
  return <i className={`tm-bgvideo-dim${sample ? " sample" : ""}`} style={{ ["--bgv-dim" as string]: dim }} aria-hidden="true" />;
}

/** Settings, Looks, Background: how bright the picked video is, 0 to 100. Moves live, saves on let go. */
export function BgBrightControls({ st, set }: { st: Settings; set: (p: Partial<Settings>) => void }) {
  const saved = bgBright(st.tmBgVideoBright);
  const [v, setV] = useState(saved);
  useEffect(() => { setV(saved); if (preview === saved) setPreview(null); }, [saved]);
  useEffect(() => () => setPreview(null), []);
  const save = (n: number) => { if (n === saved) setPreview(null); else set({ tmBgVideoBright: n }); };
  return (
    <section className="ms-sec ms-storm ms-bgbright">
      <h3 className="ms-h">Video brightness</h3>
      <p className="ms-changes">{looksOption("videoBright").changes}</p>
      <div className="tm-pop-row ms-slider"><span className="tm-pop-note tm-look-l">Brightness</span>
        <input type="range" min={0} max={100} step={5} value={v} className="tm-pop-range" aria-label="Background video brightness"
          onChange={(e) => { const n = Number(e.target.value); setV(n); setPreview(n); }}
          onPointerUp={() => save(v)} onKeyUp={() => save(v)} />
        <b className="num tm-pop-v">{v}%</b></div>
      <p className="ms-note">{v === BG_BRIGHT_DEFAULT ? "100% shows the video as it is." : "Lower darkens the video behind your list."} The same on your Macs and your phone.</p>
    </section>
  );
}

/** The phone's Looks tab: an Add video tile next to the video tiles (the developer's account only). The file is checked
 *  to play on this phone, encrypted here, put in the vault for his Macs, and picked as the background. */
export function GosAddVideoTile() {
  const v = useVaultVideos();
  return (
    <div className="ms-tile-wrap bg">
      <label className={`tm-p1-tile ms-tile ms-add${v.busy ? " busy" : ""}`} title="Pick a video from this phone. It plays here at once and goes to your Macs through your vault.">
        <span className="tm-p1-sample ms-add-plus" aria-hidden="true">+</span>
        <span className="tm-p1-name">{v.busy ? "Adding..." : "Add video"}</span>
        <input type="file" accept="video/*" className="ms-add-file" disabled={!!v.busy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void v.add(f); }} />
      </label>
      {v.note && <p className="ms-note ms-add-note" role="status">{v.note}</p>}
    </div>
  );
}
