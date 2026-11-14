// Run: node --experimental-strip-types tests/whatsnewisland.test.ts
// What's new from the island (core/whatsnew.ts, PS 1.60): the Mac's answer and where the panel hangs.
import { attachedLayout, cleanAnchor, islandReply, ISLAND_ASK_MS, ISLAND_QUEUED_MS, PANEL_W } from "../src/core/whatsnew.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const j = JSON.stringify;

ok("a real rect is kept, rounded", j(cleanAnchor({ x: 720.4, bottom: 38.6, w: 330 })) === j({ x: 720, bottom: 39, w: 330 }));
for (const [name, v] of [["nothing", null], ["text", "x"], ["missing", { x: 1, bottom: 2 }], ["NaN", { x: NaN, bottom: 5, w: 300 }], ["negative", { x: -5, bottom: 5, w: 300 }],
  ["huge", { x: 5, bottom: 99999, w: 300 }], ["tiny island", { x: 5, bottom: 5, w: 3 }], ["strings", { x: "5", bottom: "5", w: "300" }]] as const) {
  ok(`a bad rect is no anchor: ${name}`, cleanAnchor(v) === null);
}
ok("queued", j(islandReply({ state: "queued" })) === j({ phase: "queued" }));
ok("go with a rect", islandReply({ state: "go", rect: { x: 700, bottom: 40, w: 320 } })?.phase === "go");
ok("go without a rect opens in the middle", j(islandReply({ state: "go" })) === j({ phase: "go", anchor: null }));
ok("go with a bad rect opens in the middle", j(islandReply({ state: "go", rect: { x: 1 } })) === j({ phase: "go", anchor: null }));
ok("any other answer is no answer", islandReply({ state: "weird" }) === null && islandReply(null) === null && islandReply("go") === null);

const L = attachedLayout({ x: 720, bottom: 38, w: 330 }, 1440);
ok("centred under the island", L.left === 500 && L.originX === 220);
ok("touching the island's lower edge, one point tucked in", L.top === 37);
ok("it grows out of the island's width", Math.abs(L.from - 330 / PANEL_W) < 0.01);
const edge = attachedLayout({ x: 100, bottom: 38, w: 330 }, 1440);
ok("kept on screen at the left", edge.left === 8 && edge.originX === 92);
const right = attachedLayout({ x: 1430, bottom: 38, w: 330 }, 1440);
ok("kept on screen at the right", right.left === 1440 - PANEL_W - 8 && right.originX <= PANEL_W);
const narrow = attachedLayout({ x: 150, bottom: 30, w: 330 }, 300);
ok("a narrow window shrinks the panel, never off screen", narrow.left >= 8 && narrow.left + 284 <= 300 && narrow.originX >= 0);
ok("a very wide island never grows past the panel", attachedLayout({ x: 720, bottom: 30, w: 1200 }, 1440).from === 1);
ok("waits", ISLAND_ASK_MS < ISLAND_QUEUED_MS && ISLAND_QUEUED_MS > 120_000);

if (fails) { console.log(`${fails} of ${n} failed`); process.exit(1); }
console.log(`ok, ${n} checks`);
