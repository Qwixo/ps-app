// "Your own background" for Minecraft mode: the developer picks any image, it lives on this device only (IndexedDB, works with
// no internet, never uploaded, never in the vault), and the scene shows it under a dark overlay that is measured on
// the image's real pixels so light text on top always reaches 4.5:1 (scene-logic.ts overlayFor).
import { coverCrop, isImageFile, overlayFor } from "./scene-logic.ts";

const DB = "ps-minecraft", STORE = "kv", KEY = "ownBg";
/** Long side cap when storing: a 40 MB photo becomes a few hundred KB and decodes fast next time. */
export const OWN_BG_MAX = 2560;

export interface OwnBg { blob: Blob; name: string; at: string; w: number; h: number }

let memory: OwnBg | null = null; // where IndexedDB is missing: kept for this session only
const listeners = new Set<() => void>();
export const onOwnBgChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const changed = () => { for (const f of listeners) f(); };

function open(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      if (typeof indexedDB === "undefined") return res(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((res, rej) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); res(req.result); };
      t.onerror = () => { db.close(); rej(t.error); };
      t.onabort = () => { db.close(); rej(t.error); };
    } catch (e) { db.close(); rej(e); }
  });
}

export async function loadOwnBg(): Promise<OwnBg | null> {
  try {
    const v = await tx<OwnBg | undefined>("readonly", (s) => s.get(KEY) as IDBRequest<OwnBg | undefined>);
    if (v && v.blob instanceof Blob) return v;
  } catch { /* fall through */ }
  return memory;
}

/** Decode, shrink to OWN_BG_MAX, store. Throws a plain message the developer can read when the file is not an image. */
export async function saveOwnBg(file: File | Blob, name = (file as File).name || "background"): Promise<OwnBg> {
  if (!isImageFile({ type: file.type, name })) throw new Error("That file is not a picture PS app can show.");
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("PS could not open that picture."); }
  const s = Math.min(1, OWN_BG_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  let blob: Blob = file;
  if (s < 1 || file.size > 4_000_000) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (g) {
      g.drawImage(bmp, 0, 0, w, h);
      blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b || file), "image/jpeg", 0.9));
    }
  }
  bmp.close?.();
  const rec: OwnBg = { blob, name: String(name).slice(0, 120), at: new Date().toISOString(), w, h };
  memory = rec;
  try { await tx("readwrite", (st) => st.put(rec, KEY)); } catch { /* memory only this session */ }
  changed();
  return rec;
}

export async function clearOwnBg(): Promise<void> {
  memory = null;
  try { await tx("readwrite", (s) => s.delete(KEY)); } catch { /* nothing stored */ }
  changed();
}

/** The overlay colour (a blue black, so it reads as night rather than grey) and the theme's light text colour. */
export const OVERLAY_RGB: [number, number, number] = [8, 10, 18];
export const TEXT_RGB: [number, number, number] = [255, 255, 255];

/**
 * Measure the shown crop of `img` in a box of bw x bh and return the overlay alpha that keeps TEXT_RGB at 4.5:1
 * or better over every sampled pixel (about one sample per 4 CSS px, so a thin bright streak still counts).
 * `skipBottom` is the crew strip at the bottom (CSS px), which has its own ground and no panel text.
 */
export function measureOverlay(img: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }, bw: number, bh: number, skipBottom = 0, target = 4.5) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih || !bw || !bh) return { alpha: 0.6, contrast: 0 };
  const sw = Math.max(16, Math.min(480, Math.round(bw / 4))), sh = Math.max(9, Math.round(sw * bh / bw));
  const c = document.createElement("canvas"); c.width = sw; c.height = sh;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return { alpha: 0.6, contrast: 0 };
  const cr = coverCrop(iw, ih, bw, bh);
  g.imageSmoothingEnabled = false; // nearest: keep the real brightest pixels, do not average them away
  g.drawImage(img, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, sw, sh);
  const rows = Math.max(1, sh - Math.round((skipBottom / bh) * sh));
  const px = g.getImageData(0, 0, sw, rows).data;
  return overlayFor(px, TEXT_RGB, OVERLAY_RGB, target + 0.2);
}
