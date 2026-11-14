// PS Fitness, Gym scan (V1.59): the phone reads the text on a gym machine's label. The page takes one still from its own
// camera view (src/fitness/Scan.tsx), cropped to the frame and turned grey, and hands it to PS GOS (ps-gos GymScan.kt),
// which reads it with Tesseract on the phone and answers with the text. The picture is held in memory only: never
// saved, never sent anywhere, dropped as soon as it is read. Where there is no shell (the Mac, the website) available()
// is false and the Scan screen offers typing the label instead.
import { gosPost, onShell } from "./bridge";

/** `text` has the big title line first. `title` is that line alone ("" when the label had none), `turn` is how many degrees the
 *  picture was turned to read it (V1.60). */
export type ScanAnswer = { text: string; conf: number; title?: string; turn?: number } | { error: "busy" | "model" | "image" | "failed" | "timeout" };

const hasShell = () => typeof window !== "undefined" && !!(window as Window & { gosNative?: unknown }).gosNative;
let seq = 0;

export const gymScan = {
  available: hasShell,
  /** Read the text in one picture (a data: URL, JPEG or PNG). Times out after 20 s. */
  read(img: string): Promise<ScanAnswer> {
    if (!hasShell()) return Promise.resolve({ error: "failed" });
    const id = `s${Date.now().toString(36)}${(seq++).toString(36)}`;
    return new Promise((done) => {
      let off = () => {};
      const t = window.setTimeout(() => { off(); done({ error: "timeout" }); }, 20_000);
      off = onShell((m) => {
        if (m.type !== "gymscan" || m.id !== id) return;
        window.clearTimeout(t); off();
        if (typeof m.error === "string") done({ error: (["busy", "model", "image", "failed"].includes(m.error) ? m.error : "failed") as "failed" });
        else done({ text: String(m.text ?? ""), conf: Number(m.conf ?? 0), title: typeof m.title === "string" ? m.title : undefined, turn: typeof m.turn === "number" ? m.turn : undefined });
      });
      gosPost({ type: "gymscan:read", id, img });
    });
  },
  /** Load the reader ahead (when the Scan screen opens), so the first read is quick. */
  warm() { if (hasShell()) gosPost({ type: "gymscan:warm" }); },
};
