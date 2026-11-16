// Receipts (PS 1.65): the phone reads the text on a paper receipt. The page takes one still from its own camera view
// (src/views/ReceiptScan.tsx) and hands it to PS GOS (ps-gos ReceiptScan.kt), which reads it with the same offline Tesseract as
// the gym scan, with the Georgian and English models bundled in the app, and answers with the text. The picture is held in memory
// until the person saves or cancels; nothing is sent anywhere. Where there is no shell (the Mac, the website) available() is
// false: there the person can still add a receipt by typing it.
import { gosPost, onShell } from "./bridge";

export type ReceiptRead = { text: string; conf: number } | { error: "busy" | "model" | "image" | "failed" | "timeout" };

const hasShell = () => typeof window !== "undefined" && !!(window as Window & { gosNative?: unknown }).gosNative;
let seq = 0;

export const receiptScan = {
  available: hasShell,
  /** Read the text in one picture (a data: URL, JPEG or PNG). Times out after 30 s (the Georgian model is a little slower). */
  read(img: string): Promise<ReceiptRead> {
    if (!hasShell()) return Promise.resolve({ error: "failed" });
    const id = `r${Date.now().toString(36)}${(seq++).toString(36)}`;
    return new Promise((done) => {
      let off = () => {};
      const t = window.setTimeout(() => { off(); done({ error: "timeout" }); }, 30_000);
      off = onShell((m) => {
        if (m.type !== "receiptscan" || m.id !== id) return;
        window.clearTimeout(t); off();
        if (typeof m.error === "string") done({ error: (["busy", "model", "image", "failed"].includes(m.error) ? m.error : "failed") as "failed" });
        else done({ text: String(m.text ?? ""), conf: Number(m.conf ?? 0) });
      });
      gosPost({ type: "receiptscan:read", id, img });
    });
  },
  /** Load the reader ahead (when the camera opens), so the first read is quick. */
  warm() { if (hasShell()) gosPost({ type: "receiptscan:warm" }); },
};
