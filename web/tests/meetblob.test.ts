// Run: node --experimental-strip-types tests/meetblob.test.ts
// The meeting countdown's look (core/meetbubble.ts, PS 1.60): small blob by default, the long pill when chosen, reaches the Mac.
import { MEET_BUBBLE_DEFAULT, meetBubblePrefs, meetIsland } from "../src/core/meetbubble.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
ok("blob by default", MEET_BUBBLE_DEFAULT.style === "blob" && meetBubblePrefs(undefined).style === "blob" && meetBubblePrefs({}).style === "blob");
ok("pill only when chosen", meetBubblePrefs({ style: "pill" }).style === "pill" && meetBubblePrefs({ style: "long" }).style === "blob" && meetBubblePrefs({ style: 3 }).style === "blob");
ok("the other choices are kept", meetBubblePrefs({ style: "pill", on: false, lead: 30 }).lead === 30 && !meetBubblePrefs({ style: "pill", on: false }).on && meetBubblePrefs({ lead: 5 }).style === "blob");
const now = Date.parse("2026-11-14T10:00:00Z");
const ev = [{ id: "e1", title: "Weekly sync", start: "2026-11-14T10:10:00Z", end: "2026-11-14T10:40:00Z" }] as never;
ok("the island is told the style with the meeting", meetIsland(ev, [], meetBubblePrefs({}), now, false)?.style === "blob" && meetIsland(ev, [], meetBubblePrefs({ style: "pill" }), now, false)?.style === "pill");
if (fails) { console.log(`${fails} of ${n} failed`); process.exit(1); }
console.log(`ok, ${n} checks`);
