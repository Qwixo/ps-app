// Run: node tests/words.test.ts
// Three word client logins: the words, and that the invite only opens with link + right words.
import assert from "node:assert/strict";
import * as C from "../src/core/crypto.ts";
import { WORDLIST } from "../src/core/wordlist.ts";

assert.equal(new Set(WORDLIST).size, WORDLIST.length, "no repeated words");
const seen = new Set<string>();
for (let i = 0; i < 2000; i++) {
  const w = C.threeWords();
  const parts = w.split(" ");
  assert.equal(parts.length, 3);
  assert.equal(new Set(parts).size, 3);
  for (const p of parts) assert.ok(WORDLIST.includes(p));
  seen.add(w);
}
assert.ok(seen.size > 1990, "words are random");
assert.equal(C.normWords("  Maple, OTTER-rocket "), "maple otter rocket");

const link = C.randomBytes(32);
const a = await C.inviteMaterial(await C.wordsSecret(link, "maple otter rocket"));
const b = await C.inviteMaterial(await C.wordsSecret(link, " Maple  Otter Rocket"));
const c = await C.inviteMaterial(await C.wordsSecret(link, "maple otter rockets"));
const d = await C.inviteMaterial(link);
assert.equal(a.tokenHash, b.tokenHash, "spacing and capitals do not matter");
assert.notEqual(a.tokenHash, c.tokenHash, "a wrong word fails");
assert.notEqual(a.tokenHash, d.tokenHash, "the link alone fails");
const u = C.randomUsername();
assert.match(u, /^c[A-Za-z0-9_-]{16}$/);
console.log(`words: passed (${WORDLIST.length} words, about ${(3 * Math.log2(WORDLIST.length)).toFixed(0)} bits for three)`);
