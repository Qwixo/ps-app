// Run: node --experimental-strip-types tests/privatecards.test.ts
// V1.57 private mode on the Mac (a friend of the developer's, V1.56: "In private mode, PS still shows the full cards with their
// sounds"). The Mac does the pills and the silence (ps-mac PrivateCore.swift, Toast.swift, tests/private-test.sh); this
// checks the page's side: every card sound it asks the Mac to play says card:true, so the Mac can skip it while private
// mode is on, and the plain words.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const sfx = (f: string) => [...src(f).matchAll(/post\(\{ type: "sfx"[^\n]*\}\)/g)].map((m) => m[0]);

for (const f of ["src/mailcards.ts", "src/meetwatch.ts", "src/gymwatch.ts", "src/squad/chatengine.ts"]) {
  ok(`${f}: every card sound says card:true`, () => {
    const all = sfx(f);
    assert.ok(all.length >= 1, "it has a card sound");
    for (const p of all) assert.match(p, /card: true \}\)$/, p);
  });
}
ok("the Tab list's own clicks and hovers are no card sounds (they keep playing)", () => {
  assert.doesNotMatch(src("src/ui/sfx.ts"), /card: true/);
});
ok("the phone's gym ring is not touched (it is no card sound)", () => {
  assert.doesNotMatch(src("src/gymwatch.ts").split("if (PHONE) {")[1].split("return;")[0], /sfx/);
});
ok("the words say what private mode does now, plainly", () => {
  assert.match(src("src/meetwatch.ts"), /Notification cards become small pills with no sound, and the island hides names and messages/);
  const tm = src("src/views/TaskMap.tsx"), hw = src("src/core/hoverwords.ts");
  for (const k of ["Private mode is on: cards are small pills with no sound", "Private mode: cards become small pills with no sound, the island hides names"]) {
    assert.ok(tm.includes(k), k);
    assert.ok(hw.includes(`"${k.toLowerCase()}"`), "its hover words: " + k);
  }
  assert.doesNotMatch(tm + hw, /[–—]/);
});
console.log(`\n${n} passed`);
