// The Productivity looks (V1.31): the eight proposals in the research sub chat's file
// (~/Projects/ps-handover-notes/v131-productivity-research.md, section 5), with its palettes, fonts and densities.
// Every value passed the contrast guard as written (tests/looks.test.ts); the engine still runs each through
// readable() so a custom accent can never break them. Layout ideas in the research that need new screens (Day Plan's
// time rail, Calm Focus's Today only view, Control Room's left rail and sparklines) are not built yet.
import { registerLooks, type LookSpec } from "./looks.ts";

export const PRODUCTIVITY: LookSpec[] = [
  { id: "control", group: "productivity", label: "Control Room", note: "Very dense and dark, for a normal working day with many clients: the most on screen. JetBrains Mono for times.",
    fg: "#E6E8EE", base: "#111318", surface: "#181B22", acc: "#6D4FD6", accText: "#A78BFA",
    ok: "#5BD69A", warn: "#F5C451", bad: "#FF7A7A", info: "#6CB6FF", prio: ["#FF6B6B", "#FFB347", "#6CB6FF", "#9AA3B2"],
    font: "inter", mono: "jetbrains", density: "dense", textScale: 0.94, radius: 0.6, opaque: 0.95, swatch: ["#111318", "#A78BFA", "#E6E8EE"] },
  { id: "ledger", group: "productivity", label: "Ledger", note: "Control Room's density in daylight: small text reads best dark on light. IBM Plex, a little narrower, so more fits.",
    fg: "#1C1C1E", base: "#F7F6F3", surface: "#FFFFFF", acc: "#5B3FD9",
    ok: "#1E7A4C", warn: "#8F5B00", bad: "#B42318", info: "#174982", prio: ["#862213", "#996100", "#174982", "#656972"],
    font: "plex", mono: "plex", density: "dense", textScale: 0.96, radius: 0.5, opaque: 0.97, swatch: ["#F7F6F3", "#5B3FD9", "#1C1C1E"] },
  { id: "calm", group: "productivity", label: "Calm Focus", note: "Minimal and dark with a sage accent, more air and bigger type: for deep work or a day that feels like too much.",
    fg: "#E9E6DF", base: "#1A1D1B", surface: "#212522", acc: "#8FC1A0", acc2: "#B79CFF",
    ok: "#8FC1A0", warn: "#E3B565", bad: "#F0907E", info: "#94B9E0", prio: ["#F0907E", "#E3B565", "#94B9E0", "#A9A59B"],
    font: "inter", density: "focus", textScale: 1.08, radius: 1.2, opaque: 0.95, swatch: ["#1A1D1B", "#8FC1A0", "#E9E6DF"] },
  { id: "bigprint", group: "productivity", label: "Big Print", note: "Large, light and impossible to misread, from across the room or with tired eyes. Atkinson Hyperlegible, AAA contrast.",
    fg: "#111111", base: "#FFFDF8", surface: "#FFFFFF", acc: "#5B21B6",
    ok: "#1B6B40", warn: "#7A4300", bad: "#A8201A", info: "#2066B6", prio: ["#862213", "#996B00", "#2066B6", "#565A61"],
    font: "atkinson", mono: "atkinson", density: "focus", textScale: 1.25, opaque: 0.98, swatch: ["#FFFDF8", "#5B21B6", "#111111"] },
  { id: "dayplan", group: "productivity", label: "Day Plan", note: "Light and warm with a teal accent and a serif day title, for days full of calls and client blocks.",
    fg: "#23201B", base: "#FBF8F2", surface: "#FFFFFF", acc: "#0F766E", acc2: "#5B3FD9",
    ok: "#2F7D4F", warn: "#8A5300", bad: "#B42318", info: "#174982", prio: ["#862213", "#9B6508", "#174982", "#696E77"],
    font: "inter", heading: "serif", density: "comfortable", opaque: 0.97, swatch: ["#FBF8F2", "#0F766E", "#23201B"] },
  { id: "night", group: "productivity", label: "Night Shift", note: "Very dark and warm for late evening: amber instead of bright blue, warm off white text, nothing glaring.",
    fg: "#E8DCC8", base: "#0F0D0B", surface: "#171411", acc: "#E6A85C", acc2: "#C4A8F0",
    ok: "#A8C98A", warn: "#E6C35C", bad: "#FF8A70", info: "#9DB8D9", prio: ["#FF8A70", "#E6C35C", "#9DB8D9", "#A39784"],
    font: "inter", density: "comfortable", opaque: 0.96, swatch: ["#0F0D0B", "#E6A85C", "#E8DCC8"] },
  { id: "signal", group: "productivity", label: "Signal", note: "Colour blind safe and high contrast (the Okabe Ito colours): priorities you cannot miss. Atkinson Hyperlegible.",
    fg: "#F2F4F7", base: "#0E1013", surface: "#161A1F", acc: "#CC79A7", accText: "#E08CC0",
    ok: "#2EC4A0", warn: "#F0C419", bad: "#F07A2E", info: "#56B4E9", prio: ["#F07A2E", "#F0C419", "#56B4E9", "#AEB5C0"],
    font: "atkinson", mono: "atkinson", density: "comfortable", opaque: 0.96, swatch: ["#0E1013", "#E08CC0", "#F0C419"] },
  { id: "tuned", group: "productivity", label: "PS Purple Tuned", note: "Today's PS app with every contrast problem fixed: brighter purple text, a deeper button purple, clearer muted text.",
    fg: "#F3EEF8", base: "#150F1C", surface: "#1D1626", acc: "#7C3AED", accText: "#B79CFF",
    ok: "#5FD6A0", warn: "#FFC970", bad: "#FF8A8A", info: "#7CC4FF", prio: ["#FF7A90", "#FFB65C", "#7CC4FF", "#A99DBA"],
    font: "inter", density: "comfortable", opaque: 0.94, swatch: ["#150F1C", "#B79CFF", "#F3EEF8"] },
];
registerLooks(PRODUCTIVITY);
