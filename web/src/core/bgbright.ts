// How bright the developer's own background video is (V1.33, the developer: "make the background video have a brightness toggle
// in settings so I can turn down and up the brightness"). Settings, Looks, Background: a slider from 0 to 100,
// default 100 (the video as it is). Synced like the other looks (settings.tmBgVideoBright, cleaned in ps.ts
// cleanLooks). The list draws it as a black layer over the video (TaskMap BgVideoLayer): one opacity, no
// filter on the video itself, so it costs nothing on the Mac or the phone.
export const BG_BRIGHT_DEFAULT = 100;

/** The saved value as a whole number from 0 to 100; anything else is the default. */
export function bgBright(v: unknown): number {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return BG_BRIGHT_DEFAULT;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : BG_BRIGHT_DEFAULT;
}

/** The darkening layer's opacity for a brightness: 100 is no layer at all, 0 is black. */
export function bgDim(bright: unknown): number {
  return Math.round((100 - bgBright(bright))) / 100;
}
