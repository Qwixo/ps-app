// The example pictures on Settings, Looks and in the island menu (V1.43, the developer 8 Nov 2026: "the diagrams don't change
// colour at all so it's unclear what you're actually changing when you click on different colours", and "some of the
// appearances are broken when you actually try and preview them"). Every picture is painted from the same sums the
// real thing uses, so a click (or a hover, or a slider) changes the picture straight away and shows exactly what
// that choice changes. Pure, no DOM: tests/looksample.test.ts runs it; the pictures are in looks/AppearanceSettings.tsx,
// views/TaskMap.tsx (LooksPage, views/IslandSettings.tsx).
import { buildTokens, lookById, fontCss, type Appearance } from "./looks.ts";
import { notchTones, pillTones, type NotchLook, type PillLook } from "./islandlook.ts";

/** The CSS variables for a small live list in one appearance: the look's own colours with the accent made readable
 *  (buildTokens, as the whole app gets them), and the size, spacing and font. Every key is always set, so the picture
 *  never borrows a value from the page around it. */
export function sampleVars(a: Appearance): Record<string, string> {
  const spec = lookById(a.look);
  const t = buildTokens(a);
  return {
    "--s-base": t["--k-base"] ?? spec.base,
    "--s-surf": t["--k-surface"] ?? spec.surface,
    "--s-fg": t["--k-fg"] ?? spec.fg,
    "--s-acc": t["--k-acc"] ?? a.accent ?? spec.acc,
    "--s-acct": t["--k-acc-t"] ?? t["--k-acc"] ?? spec.acc,
    "--s-onacc": t["--k-on-acc"] ?? "#FFFFFF",
    "--s-fs": t["--k-fs"] ?? "1",
    "--s-dn": t["--k-dn"] ?? "1",
    "--s-font": t["--k-font"] ?? fontCss(spec.font),
  };
}

/** The colours of the small pictures beside "Around the notch" and "Pill below the notch" in the island menu, from the
 *  look and colours saved for each (the same tones the Mac paints the island with). */
export function islandPicVars(kind: "pill" | "notch", look: PillLook | NotchLook): Record<string, string> {
  if (kind === "pill") {
    const t = pillTones(look as PillLook);
    return { "--isl-bg": t.bg, "--isl-bg2": t.bg2, "--isl-edge": t.edge ?? "transparent", "--isl-acc": t.accent };
  }
  const t = notchTones(look as NotchLook);
  const fill = t.fill ?? "#000000";
  return { "--isl-bg": fill, "--isl-bg2": fill, "--isl-edge": t.tinted ? t.glow : "transparent", "--isl-acc": t.accent };
}

/** A lightning Preview lasts 5 seconds (LOOKS_PREVIEW_MS), but lightning strikes every few seconds: the preview strikes at these times
 *  (ms after it starts), so every lightning background is really seen while it is previewed. */
export const PREVIEW_STRIKES_MS: readonly number[] = [120, 1300, 2600, 3900];

/** The "How much rain" picture: the first layer of drops fades in up to half way, the second (in between) after it. */
export function rainLayers(amount: number): { a: number; b: number } {
  const x = Math.max(0, Math.min(100, Number.isFinite(amount) ? amount : 50)) / 100;
  const r = (v: number) => Math.round(v * 100) / 100;
  return { a: r(Math.min(1, 0.15 + x * 1.7)), b: r(Math.max(0, Math.min(1, (x - 0.5) * 2))) };
}
