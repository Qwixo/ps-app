// Receipts (PS 1.65): the phone's Scan receipt screen (camera, then the check screen) and the check screen itself, which is also
// how a receipt is typed in by hand (Mac, website) and how a saved one is fixed. The reading is the phone's own offline reader
// (src/gos/receiptscan.ts), the meaning of the text is core/receiptparse.ts, saving is src/receipts.ts. The picture stays in memory
// until Save (it is then shrunk and sealed) or Cancel (it is dropped). Esc and the phone's Back close the screen.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GOS, gos, haptic } from "../gos/bridge";
import { appName } from "../core/appname";
import { CAMERA_BUTTON, cameraOffText } from "../core/camerahelp";
import { receiptScan } from "../gos/receiptscan";
import { CURRENCIES, parseReceipt } from "../core/receiptparse";
import { draftOf, receiptOfDraft, type RcDraft, type Receipt } from "../core/receipts";
import { receiptPhoto, removeReceipt, saveReceipt, useReceiptCurrency } from "../receipts";
import { toISODate } from "../ui/kit";
import "./receiptscan.css";

export const RS_WORDS = {
  scan: "Scan receipt", add: "Add by typing", check: "Check this receipt", edit: "Receipt", readingNow: "Reading the receipt",
  hint: "Lay the receipt flat, fill the screen with it and tap Read.", read: "Read", cancel: "Cancel", typeIt: "Type it",
  noCamera: "No camera found. You can type the receipt instead.", failed: "That did not work. Try again, a little closer and in good light.",
  tooLong: "That took too long. Try again.", model: "The receipt reader could not start. You can type the receipt instead.",
  shop: "Shop", date: "Date", total: "Total", currency: "Currency", note: "Note", items: "Items", item: "Item", qty: "Qty", price: "Price",
  addItem: "Add item", remove: "Remove", save: "Save", saving: "Saving", noPhoto: "The receipt is saved, but its photo is not. Tap Save to try the photo again, or Cancel to keep the receipt without it.",
  photoOf: "Photo of the receipt", noPic: "No photo", loadingPic: "Loading the photo", gonePic: "The photo opens on the website and the phone.",
  del: "Delete receipt", sure: "Delete this receipt and its photo? This cannot be undone.", doDel: "Delete it", keep: "Keep it",
  readNote: "Read from the photo. Check every line before you save.",
  w_total: "No total was found. Type it.", w_date: "No date was found. Type it.", w_guess: "The total is a guess. Check it.", w_sum: "The items do not add up to the total. Check both.", w_none: "Nothing was read as an item. Add them if you want them in your lists.",
  bad_date: "The date needs a day, like 2026-11-17.", bad_total: "The total needs a number, like 12.50.", bad_item: "An item price needs a number, like 3.20.",
} as const;

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Esc (everywhere) and Back (the phone) close the topmost screen. */
export function useCloseKeys(on: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.preventDefault(); e.stopImmediatePropagation(); ref.current(); };
    const back = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); ref.current(); };
    window.addEventListener("keydown", key, true);
    window.addEventListener("gos-back", back, true);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("gos-back", back, true); };
  }, [on]);
}

/** The words a warning from the parser says. */
export const warnText = (w: string): string => (w === "no-total" ? RS_WORDS.w_total : w === "no-date" ? RS_WORDS.w_date : w === "total-guessed" ? RS_WORDS.w_guess : w === "sum-differs" ? RS_WORDS.w_sum : w === "no-items" ? RS_WORDS.w_none : "");

// ---------- the check screen ----------
export function ReceiptCheck({ start, photo, photoId, id, from, warns, at, onClose, onSaved }: {
  start: RcDraft; photo?: string; photoId?: string; id?: string; at?: string; from: "scan" | "typed"; warns?: string[]; onClose: () => void; onSaved?: () => void;
}) {
  const [d, setD] = useState<RcDraft>(start);
  const [bad, setBad] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pic, setPic] = useState<string | null>(photo ?? null);
  const [picState, setPicState] = useState<"none" | "loading" | "ok" | "gone">(photo ? "ok" : photoId ? "loading" : "none");
  const [sure, setSure] = useState(false);
  const done = useRef<{ id?: string; ph?: string }>({});   // what the first Save wrote: a second Save changes that receipt, it never adds another
  useCloseKeys(true, onClose);
  useEffect(() => {
    if (!photoId || photo) return;
    let live = true, url: string | null = null;
    void receiptPhoto(photoId).then((u) => { url = u; if (!live) { if (u) URL.revokeObjectURL(u); return; } setPic(u); setPicState(u ? "ok" : "gone"); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [photoId, photo]);
  const set = (p: Partial<RcDraft>) => setD((x) => ({ ...x, ...p }));
  const setItem = (i: number, p: Partial<RcDraft["items"][number]>) => setD((x) => ({ ...x, items: x.items.map((it, k) => (k === i ? { ...it, ...p } : it)) }));
  const save = async () => {
    const keep = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();   // a corrected receipt keeps its first save time
    const r = receiptOfDraft(d, keep, from, photoId ?? done.current.ph);
    if ("bad" in r) { setBad(r.bad); return; }
    setBad([]); setBusy(true); setErr("");
    try {
      const out = await saveReceipt(r.ok, { id: id ?? done.current.id, photo: done.current.ph ? undefined : photo });
      done.current = { id: out.id, ph: out.ph };
      const lost = !!photo && !out.photo;
      if (lost) setErr(RS_WORDS.noPhoto);
      haptic("drop");
      onSaved?.();
      if (!lost) onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : RS_WORDS.failed); }
    finally { setBusy(false); }
  };
  const del = async () => { if (!id) return; setBusy(true); try { await removeReceipt(id); onSaved?.(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : ""); setBusy(false); } };
  const root = document.body;
  return createPortal(
    <div className="rs-layer" role="dialog" aria-modal="true" aria-label={id ? RS_WORDS.edit : RS_WORDS.check} onMouseDown={(e) => e.stopPropagation()}>
      <div className="rs-dim" onClick={onClose} />
      <div className="rs-sheet">
        <header className="rs-head"><b>{id ? RS_WORDS.edit : RS_WORDS.check}</b><button type="button" className="rs-x" aria-label={RS_WORDS.cancel} onClick={onClose}>&times;</button></header>
        <div className="rs-body">
          <figure className="rs-pic">
            {pic ? <img src={pic} alt={RS_WORDS.photoOf} /> : <figcaption>{picState === "loading" ? RS_WORDS.loadingPic : picState === "gone" ? RS_WORDS.gonePic : RS_WORDS.noPic}</figcaption>}
          </figure>
          <div className="rs-form">
            {from === "scan" && !id && <p className="rs-note">{RS_WORDS.readNote}</p>}
            {(warns ?? []).map((w) => warnText(w)).filter(Boolean).map((t) => <p key={t} className="rs-warn">{t}</p>)}
            <label className="rs-f"><span>{RS_WORDS.shop}</span><input value={d.shop} maxLength={60} onChange={(e) => set({ shop: e.target.value })} /></label>
            <div className="rs-row">
              <label className={cx("rs-f", bad.includes("date") && "bad")}><span>{RS_WORDS.date}</span><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></label>
              <label className={cx("rs-f", bad.includes("total") && "bad")}><span>{RS_WORDS.total}</span><input inputMode="decimal" value={d.total} onChange={(e) => set({ total: e.target.value })} /></label>
              <label className="rs-f"><span>{RS_WORDS.currency}</span>
                <select value={d.cur} onChange={(e) => set({ cur: e.target.value })}>{[...new Set([d.cur, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </label>
            </div>
            {bad.includes("date") && <p className="rs-warn">{RS_WORDS.bad_date}</p>}
            {bad.includes("total") && <p className="rs-warn">{RS_WORDS.bad_total}</p>}
            <div className="rs-items" role="group" aria-label={RS_WORDS.items}>
              <div className="rs-ih"><span>{RS_WORDS.item}</span><span>{RS_WORDS.qty}</span><span>{RS_WORDS.price}</span><span /></div>
              {d.items.map((it, i) => (
                <div className="rs-ir" key={i}>
                  <input aria-label={RS_WORDS.item} value={it.n} maxLength={80} onChange={(e) => setItem(i, { n: e.target.value })} />
                  <input aria-label={RS_WORDS.qty} inputMode="decimal" value={it.q} onChange={(e) => setItem(i, { q: e.target.value })} />
                  <input aria-label={RS_WORDS.price} inputMode="decimal" value={it.p} onChange={(e) => setItem(i, { p: e.target.value })} className={cx(bad.includes("item-price") && it.p.trim() && Number.isNaN(Number(it.p.replace(",", "."))) && "bad")} />
                  <button type="button" className="rs-x sm" aria-label={RS_WORDS.remove} onClick={() => setD((x) => ({ ...x, items: x.items.filter((_, k) => k !== i) }))}>&times;</button>
                </div>
              ))}
              <button type="button" className="rs-link" onClick={() => setD((x) => ({ ...x, items: [...x.items, { n: "", q: "", p: "" }] }))}>{RS_WORDS.addItem}</button>
            </div>
            {bad.includes("item-price") && <p className="rs-warn">{RS_WORDS.bad_item}</p>}
            <label className="rs-f"><span>{RS_WORDS.note}</span><input value={d.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} /></label>
            {err && <p className="rs-warn" role="alert">{err}</p>}
          </div>
        </div>
        <footer className="rs-foot">
          {id && (sure
            ? <span className="rs-sure">{RS_WORDS.sure} <button type="button" className="rs-b danger" disabled={busy} onClick={() => void del()}>{RS_WORDS.doDel}</button> <button type="button" className="rs-b" onClick={() => setSure(false)}>{RS_WORDS.keep}</button></span>
            : <button type="button" className="rs-b quiet" onClick={() => setSure(true)}>{RS_WORDS.del}</button>)}
          <span className="rs-gap" />
          <button type="button" className="rs-b" onClick={onClose}>{RS_WORDS.cancel}</button>
          <button type="button" className="rs-b on" disabled={busy} onClick={() => void save()}>{busy ? RS_WORDS.saving : RS_WORDS.save}</button>
        </footer>
      </div>
    </div>, root);
}

/** A blank draft for typing a receipt in. */
export const blankDraft = (cur: string): RcDraft => ({ shop: "", date: toISODate(new Date()), total: "", cur, note: "", items: [] });

/** The Add by typing screen. */
export function ReceiptTyped({ onClose }: { onClose: () => void }) {
  const cur = useReceiptCurrency();
  return <ReceiptCheck start={blankDraft(cur)} from="typed" onClose={onClose} />;
}

// ---------- the phone camera ----------
/** One still of the whole view: a colour copy for the saved photo and a grey, contrast stretched copy for the reader. */
function grab(v: HTMLVideoElement): { photo: string; ocr: string } | null {
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return null;
  const k = Math.min(1, 2200 / Math.max(vw, vh));
  const c = document.createElement("canvas");
  c.width = Math.round(vw * k); c.height = Math.round(vh * k);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(v, 0, 0, c.width, c.height);
  const photo = c.toDataURL("image/jpeg", 0.85);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; d[i] = y; hist[y]++; }
  const total = d.length / 4;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > total * 0.02) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += hist[hi]; if (acc > total * 0.02) break; }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const y = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)); d[i] = d[i + 1] = d[i + 2] = y; }
  ctx.putImageData(img, 0, 0);
  return { photo, ocr: c.toDataURL("image/jpeg", 0.92) };
}

export function ReceiptScan({ onClose }: { onClose: () => void }) {
  const cur = useReceiptCurrency();
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<"starting" | "on" | "denied" | "nocamera">("starting");
  const [phase, setPhase] = useState<"cam" | "reading" | "check">("cam");
  const [say, setSay] = useState("");
  const [shot, setShot] = useState<{ photo: string; start: RcDraft; warns: string[]; from: "scan" | "typed" } | null>(null);
  useCloseKeys(phase !== "check", onClose);
  useEffect(() => {
    receiptScan.warm();
    let live = true, stream: MediaStream | null = null;
    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCam("nocamera"); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
      catch (e) { if (live) setCam((e as DOMException)?.name === "NotFoundError" ? "nocamera" : "denied"); return; }
      if (!live) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      try { await v.play(); } catch { /* plays when the first frame is in */ }
      setCam("on");
    })();
    return () => { live = false; stream?.getTracks().forEach((t) => t.stop()); const v = video.current; if (v) v.srcObject = null; };
  }, []);
  const shoot = async () => {
    const v = video.current;
    if (!v || cam !== "on" || phase !== "cam") return;
    const g = grab(v);
    if (!g) return;
    haptic("press"); setSay(""); setPhase("reading");
    const a = await receiptScan.read(g.ocr);
    if ("error" in a) {
      setSay(a.error === "model" ? RS_WORDS.model : a.error === "timeout" ? RS_WORDS.tooLong : RS_WORDS.failed);
      setPhase("cam"); haptic("reject"); return;
    }
    const p = parseReceipt(a.text, { currency: cur, today: toISODate(new Date()) });
    haptic("drop");
    setShot({ photo: g.photo, start: draftOf(p), warns: p.warn, from: "scan" });
    setPhase("check");
  };
  if (phase === "check" && shot) return <ReceiptCheck start={shot.start} photo={shot.photo || undefined} from={shot.from} warns={shot.warns} onClose={onClose} />;
  const bad = cam === "denied" || cam === "nocamera";
  const msg = cam === "denied" ? cameraOffText(appName(), "Or type the receipt.") : cam === "nocamera" ? RS_WORDS.noCamera : phase === "reading" ? RS_WORDS.readingNow + "..." : say || (cam === "starting" ? "Opening the camera..." : RS_WORDS.hint);
  return createPortal(
    <div className="rs-layer rs-cam" role="dialog" aria-modal="true" aria-label={RS_WORDS.scan}>
      <video ref={video} playsInline muted autoPlay aria-hidden="true" />
      <p className={cx("rs-say", (bad || !!say) && "bad")} role="status" aria-live="polite">{msg}</p>
      {cam === "denied" && GOS && <button type="button" className="rs-b" onClick={() => { haptic("press"); gos.openAppSettings(); }}>{CAMERA_BUTTON}</button>}
      <div className="rs-camfoot">
        <button type="button" className="rs-b" onClick={onClose}>{RS_WORDS.cancel}</button>
        <button type="button" className={cx("rs-shoot", phase === "reading" && "busy")} onClick={() => void shoot()} disabled={cam !== "on" || phase !== "cam"} aria-label={RS_WORDS.read}>{phase === "reading" ? <span className="rs-spin" aria-hidden="true" /> : RS_WORDS.read}</button>
        <button type="button" className="rs-b" onClick={() => { setShot({ photo: "", start: blankDraft(cur), warns: [], from: "typed" }); setPhase("check"); }}>{RS_WORDS.typeIt}</button>
      </div>
    </div>, document.body);
}

export type { Receipt };
