// G Squad v3 (PS 1.65): profile pictures. The page makes the picture square, 256 px at most, under 40 KB, before it is
// sealed and sent (the hub never sees a big file). Rules only here; the canvas work is in views/GSquadPicture.tsx.
export const AVATAR_PX = 256;
export const AVATAR_MAX_BYTES = 40 * 1024;

/** The centre square of a picture: x, y, side. */
export function squareCrop(w: number, h: number): { x: number; y: number; side: number } {
  const side = Math.max(1, Math.min(w, h));
  return { x: Math.floor((w - side) / 2), y: Math.floor((h - side) / 2), side };
}
/** The size to draw the square at: never bigger than max, never upscaled. */
export const squareOut = (side: number, max = AVATAR_PX): number => Math.max(1, Math.min(Math.floor(side), max));
/** Bytes of a data URL's payload (base64). */
export function dataUrlBytes(url: string): number {
  const i = url.indexOf(",");
  if (i < 0) return 0;
  const b = url.slice(i + 1);
  return Math.floor((b.length * 3) / 4) - (b.endsWith("==") ? 2 : b.endsWith("=") ? 1 : 0);
}
export const isPictureUrl = (u: unknown): u is string => typeof u === "string" && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(u) && dataUrlBytes(u) <= AVATAR_MAX_BYTES * 2;

/** Tries smaller steps until the picture is under the limit: quality 0.85 down to 0.4, then 20 percent smaller, again.
 *  encode(px, quality) gives a data URL. Null when nothing fits (a broken picture). */
export async function fitPicture(side: number, encode: (px: number, quality: number) => Promise<string>, limit = AVATAR_MAX_BYTES): Promise<string | null> {
  let px = squareOut(side);
  for (let round = 0; round < 5; round++) {
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const url = await encode(px, q);
      if (url && dataUrlBytes(url) <= limit) return url;
    }
    px = Math.floor(px * 0.8);
    if (px < 48) break;
  }
  return null;
}

/** Letter pictures, toned down: one neutral grey blue per person (the same on every device), no rainbow. */
export const NEUTRAL_TONES: { bg: string; fg: string }[] = [
  { bg: "#e3e5ea", fg: "#4f5663" }, { bg: "#dfe3e8", fg: "#505a66" }, { bg: "#e6e4e9", fg: "#5a5663" },
  { bg: "#dde4e6", fg: "#4c5d62" }, { bg: "#e5e5e1", fg: "#5a5a50" }, { bg: "#e0e2e9", fg: "#4e5470" },
];
export function neutralTone(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % NEUTRAL_TONES.length;
}
