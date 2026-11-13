// Settings, Looks, List transparency (V1.43). Until V1.42 this was the glass slider at the top middle of the Tab list;
// core/bgfade.ts says why it did not work on most backgrounds and what changed. 0% is the usual look, 100% shows your
// screen clearly behind the list (the background you chose fades away with it). The little picture shows it live, the
// Tab list behind the Settings screen follows while the slider moves, and it is saved when you let go.
import { useEffect, useRef, useState } from "react";
import { backdropFor, transparencyOf } from "../core/bgfade";
import { looksOption } from "../core/looksoptions";

// ---------- the Tab list's live preview (set by the list while it is up) ----------
let live: ((v: number | null) => void) | null = null;
/** The Tab list registers how to show a value straight on the page; returns the clean up. */
export function setLiveBackdrop(f: (v: number | null) => void) { live = f; return () => { if (live === f) live = null; }; }
/** Show a saved value on the list now (null: back to the saved one). Both sliders hear it too (V1.44), so the one in
 *  the Tab list's top bar and this one in Settings stay in step while either moves. */
export function previewBackdrop(v: number | null) { live?.(v); watchers.forEach((w) => w(v)); }
const watchers = new Set<(v: number | null) => void>();
/** A slider follows the other one's live value (null: back to the saved one); returns the clean up. */
export function watchBackdrop(f: (v: number | null) => void) { watchers.add(f); return () => { watchers.delete(f); }; }

export function ListTransparency({ saved, save }: { saved: unknown; save: (v: number, keep: boolean) => unknown }) {
  const pct = transparencyOf(saved);
  const [v, setV] = useState(pct);
  useEffect(() => { setV(pct); }, [pct]);
  // Closed mid drag (Esc): the list and the Mac's own glass go back to the saved value.
  const kept = useRef(saved);
  kept.current = saved;
  // The slider in the Tab list's top bar moving: this one follows it (V1.44).
  useEffect(() => watchBackdrop((pv) => setV(transparencyOf(pv ?? kept.current))), []);
  useEffect(() => () => { previewBackdrop(null); void save(backdropFor(transparencyOf(kept.current)), false); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const move = (n: number) => { setV(n); const b = backdropFor(n); previewBackdrop(b); void save(b, false); };
  const done = (n: number) => { if (n === pct) { previewBackdrop(null); void save(backdropFor(n), false); } else void save(backdropFor(n), true); };
  return (
    <section className="ms-sec ms-lt">
      <h3 className="ms-h">List transparency</h3>
      <p className="ms-changes">{looksOption("transparency").changes}</p>
      <div className="lt-row">
        <div className="lt-prev" style={{ ["--lt" as string]: String(v / 100) }} aria-hidden="true">
          <i className="lt-win a" /><i className="lt-win b" />
          <span className="lt-list"><i /><i /><i className="short" /></span>
        </div>
        <div className="lt-ctl">
          <div className="tm-pop-row ms-slider"><span className="tm-pop-note tm-look-l">See through</span>
            <input type="range" min={0} max={100} step={10} value={v} className="tm-pop-range" aria-label="List transparency"
              onChange={(e) => move(Number(e.target.value))}
              onPointerUp={(e) => done(Number((e.target as HTMLInputElement).value))} onKeyUp={(e) => done(Number((e.target as HTMLInputElement).value))} />
            <b className="num tm-pop-v">{v}%</b></div>
          <p className="ms-note">{v === 0 ? "0% is the usual look." : v === 100 ? "100%: your screen shows clearly and the background you chose is hidden." : "Your screen shows through, and the background you chose fades with it."} Your tasks and panels keep a solid backing so they stay easy to read.</p>
          {v > 0 && <button type="button" className="lt-reset" onClick={() => { setV(0); previewBackdrop(null); void save(backdropFor(0), true); }}
            data-tip="Back to the usual look" data-tip-line="Sets List transparency to 0%">Back to 0%</button>}
        </div>
      </div>
    </section>
  );
}
