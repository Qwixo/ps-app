// Minecraft mode on or off (V1.32, the developer 4 Nov 2026: take it out of PS for now, keep it so it can come back with almost
// no work). Off: PowerWatch (the power out stopwatch) never starts, the translator helper (PSTranslate) is never
// started, the page's "mc", "power:get" and "torch:*" messages are ignored, and the self test areas minecraft, torch
// and power are skipped (the area mcoff checks that every way in is gone). All the code, the PSTranslate helper, its
// word lists and tests stay in the build; the translator model the developer downloaded stays on his Mac.
// To bring it back: set this to true AND MINECRAFT_ENABLED in web src/core/mcmode.ts, then run the self
// test areas minecraft, torch and power (and mcoff to see it now fails on purpose: it expects the off switch).
let MINECRAFT_ENABLED = false
