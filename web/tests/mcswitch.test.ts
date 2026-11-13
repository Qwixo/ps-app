// Minecraft mode's off switch (V1.32, src/core/mcmode.ts MINECRAFT_ENABLED; native half ps-mac Sources/MinecraftSwitch.swift).
// While it is off nothing on the page leads into it: the pop up (and so its bubble and window.__psOpenMinecraft) and the
// Settings card are only drawn behind the switch, and no top bar button exists. The pieces themselves stay in the repo.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MINECRAFT_ENABLED } from "../src/core/mcmode.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : []; });
const src = files("src").filter((f) => !f.startsWith(join("src", "views", "minecraft")) && f !== join("src", "views", "Minecraft.tsx"));

ok("the switch is off for V1.32", () => assert.equal(MINECRAFT_ENABLED, false));
ok("every place that draws Minecraft mode checks the switch", () => {
  let uses = 0;
  for (const f of src) for (const line of readFileSync(f, "utf8").split("\n")) {
    if (/<(MinecraftWindow|MinecraftEntry|MinecraftButton)\b/.test(line)) { uses++; assert.match(line, /MINECRAFT_ENABLED &&/, `${f}: ${line.trim()}`); }
  }
  assert.ok(uses >= 2, "the pop up and the Settings card");
});
ok("nothing else opens it or calls into it", () => {
  for (const f of src) {
    const t = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");   // code only, not comments
    assert.ok(!/openMinecraft\(|minecraft\.open\(|__psOpenMinecraft|MinecraftButton/.test(t), f);
  }
});
ok("the pieces are all still there to bring back", () => {
  for (const f of ["src/views/Minecraft.tsx", "src/views/minecraft/Translator.tsx", "src/views/minecraft/Torch.tsx", "src/views/minecraft/PowerClock.tsx", "src/views/minecraft/Scene.tsx"])
    assert.ok(statSync(f).size > 500, f);
});
console.log(`${n} passed`);
