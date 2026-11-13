// The Tab list's moving looks rest behind full screens (V1.53, src/core/screenrest.ts). The developer: "the background of the
// settings menu randomly go dark then light, then dark again". Lightning, a background video and the storm rain's flash
// kept running behind the Settings screen, which (unlike Fitness and the Soundboard) never put them to rest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { restHolders, settingsRests } from "../src/core/screenrest.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("Settings puts the moving looks to rest while it is up and while it shrinks away", () => {
  assert.equal(settingsRests("open", false), true);
  assert.equal(settingsRests("closing", false), true);
  assert.equal(settingsRests("closed", false), false);
});
ok("a Looks preview shows the list as it really is: the looks move again for those 2 seconds", () => {
  assert.equal(settingsRests("open", true), false);
});
ok("the looks wake only when the last screen has gone (one closing never wakes them under another)", () => {
  let h = restHolders(new Set(), "settings", true);
  h = restHolders(h, "fitness", true);
  h = restHolders(h, "settings", false);
  assert.equal(h.size, 1, "Fitness still covers the list");
  h = restHolders(h, "fitness", false);
  assert.equal(h.size, 0);
  assert.equal(restHolders(new Set(), "settings", false).size, 0, "letting go twice is harmless");
});
ok("every full screen asks by name, and the rest really hides what flickered (lightning, video, rain, scenes)", () => {
  assert.match(readFileSync("src/views/SettingsScreen.tsx", "utf8"), /restBehind\(root, "settings", rests\)/);
  for (const f of ["src/fitness/FitnessButton.tsx", "src/soundboard/SoundboardButton.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /restBehind\(/, f);
    assert.doesNotMatch(src, /classList\.(add|remove)\("scr-open"\)/, `${f} no longer flips the class by itself`);
  }
  const css = ["src/views/moresettings.css", "src/views/storm.css", "src/fitness/fitness.css", "src/looks/peek.css"].map((f) => readFileSync(f, "utf8")).join("\n");
  for (const part of ["tm-bgvideo", "tm-bgvideo-dim", "tm-storm", "tm-p1-scene", "tm-rain", "tm-bgcolour"])
    assert.match(css, new RegExp(`\\.tm-overlay\\.scr-open[^{]*\\.${part}\\b[^{]*\\{[^}]*visibility: hidden`), part);
});

console.log(`screenrest tests: ${n} passed`);
