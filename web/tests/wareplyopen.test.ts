// Run: node --experimental-strip-types tests/wareplyopen.test.ts
// A WhatsApp card's Reply on the Mac: the id check, the wish that waits a few seconds, taken once. Never sends.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const R = await import("../src/core/wareplyopen.ts");
let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
ok("only w: ids", () => { assert.equal(R.cleanWaCardId("w:abc-1_2"), "w:abc-1_2"); for (const b of ["m:abc", "w:", "w:a b", "w:" + "a".repeat(39), 5, null]) assert.equal(R.cleanWaCardId(b), null); });
ok("a wish is taken once", () => { R.requestWaReply("w:x1", 1000); assert.equal(R.peekWaReply(2000), "w:x1"); assert.equal(R.takeWaReply(2000), "w:x1"); assert.equal(R.takeWaReply(2000), null); });
ok("an old wish is dropped", () => { R.requestWaReply("w:x2", 1000); assert.equal(R.takeWaReply(1000 + 10_001), null); });
ok("a bad id changes nothing", () => { R.requestWaReply("m:bad", 1000); assert.equal(R.takeWaReply(1001), null); });
ok("listeners hear a wish", () => { let c = 0; const off = R.onWaReply(() => c++); R.requestWaReply("w:x3", 1); off(); R.requestWaReply("w:x4", 2); assert.equal(c, 1); R.takeWaReply(3); });
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
ok("wired: card has Reply, the email compose window is not opened for w: ids, the Tab list handles waReply", () => {
  assert.ok(src("../src/mailcards.ts").includes('discreetText: "New WhatsApp message", ...REPLY'));
  assert.ok(/m\.id\.startsWith\("w:"\)\) return true/.test(src("../src/replyengine.ts")));
  assert.ok(src("../src/ps.ts").includes('m.type === "waReply"'));
  assert.ok(src("../src/views/WaMail.tsx").includes("onWaReply"));
});
console.log(`${n} passed`);
