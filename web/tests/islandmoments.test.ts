// Run: node --experimental-strip-types tests/islandmoments.test.ts
// The island's sound switch (core/island.ts, settings.island.sounds, PS 1.60): on unless switched off, reaches the Mac.
import { ISLAND_DEFAULT, islandPrefs, islandState } from "../src/core/island.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };

ok("on by default", ISLAND_DEFAULT.sounds === true && islandPrefs(undefined).sounds === true && islandPrefs({}).sounds === true);
ok("off only when set to false", islandPrefs({ sounds: false }).sounds === false);
ok("anything else is on", islandPrefs({ sounds: "no" }).sounds === true && islandPrefs({ sounds: 0 }).sounds === true && islandPrefs(null).sounds === true);
ok("the other choices are kept", islandPrefs({ sounds: false, cards: false, fsMove: false }).cards === false && islandPrefs({ sounds: false }).fsMove === true);
const st = (sounds: unknown) => islandState({ settings: { island: { sounds } } as never, todos: [], mail: 0, leads: 0, today: "2026-11-14", event: null });
ok("the state carries it to the Mac, even with the island off", st(false).sounds === false && st(true).sounds === true && islandState({ settings: { island: { mode: "off", sounds: false } } as never, todos: [], mail: 0, leads: 0, today: "2026-11-14", event: null }).sounds === false);

if (fails) { console.log(`${fails} of ${n} failed`); process.exit(1); }
console.log(`ok, ${n} checks`);
