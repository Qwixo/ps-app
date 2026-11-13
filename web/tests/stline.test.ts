// Run: node --experimental-strip-types tests/stline.test.ts
// The screen time line across devices (core/stline.ts, V1.31): a device's timeline is cut into hour
// records for the vault, only changed hours are written, the other device joins them back into the
// same timeline, and 1Password and Signal never get through on either side.
import assert from "node:assert/strict";
import { HOUR, cleanTimeline, clipTimeline, joinLines, planLines, toHours, type Timeline } from "../src/core/stline.ts";
import type { Doc, StLine } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const M = 60_000;
const T0 = Date.UTC(2026, 10, 4, 8, 0, 0);        // 08:00 UTC, on the hour
const AT = "2026-11-04T12:00:00.000Z";
const doc = (id: string, data: StLine): Doc<StLine> => ({ id, ws: null, kind: "stline", data, author: null, updatedAt: AT } as Doc<StLine>);
// Save the way saveScreenLine does: same id replaces, no id adds.
const apply = (docs: Doc<StLine>[], writes: { id?: string; data: StLine }[]) => {
  const out = [...docs];
  let k = 0;
  for (const w of writes) {
    const i = w.id ? out.findIndex((d) => d.id === w.id) : -1;
    if (i >= 0) out[i] = { ...out[i], data: w.data }; else out.push(doc(w.id ?? `new${k++}`, w.data));
  }
  return out;
};

const mac: Timeline = {
  now: T0 + 3 * HOUR + 20 * M, from: T0 - 2 * HOUR,
  apps: [{ id: "com.apple.Safari", name: "Safari" }, { id: "com.microsoft.VSCode", name: "Code" }, { id: "org.whispersystems.signal-desktop", name: "Signal" }],
  segs: [[0, T0 + 10 * M, T0 + 50 * M], [1, T0 + 50 * M, T0 + 2 * HOUR + 5 * M], [2, T0 + 2 * HOUR + 5 * M, T0 + 2 * HOUR + 30 * M], [0, T0 + 3 * HOUR, T0 + 3 * HOUR + 20 * M]],
  away: [[T0 + 2 * HOUR + 30 * M, T0 + 3 * HOUR]],
};

ok("a line is cut into the hours that hold something, seconds from the hour", () => {
  const h = toHours(mac, "mac", AT);
  assert.deepEqual(h.map((x) => x.hour), [T0, T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR]);
  assert.deepEqual(h[0].segs, [[0, 600, 3000], [1, 3000, 3600]]);
  assert.deepEqual(h[1].segs, [[0, 0, 3600]]);            // Code all hour (its own index in this hour)
  assert.equal(h[1].apps[0].name, "Code");
  assert.equal(h[0].slot, Math.round(T0 / HOUR) % 24);
  assert.equal(h[3].upTo, mac.now);                         // the current hour: counted up to now
  assert.equal(h[0].upTo, T0 + HOUR);
});

ok("golden rule: Signal and 1Password are never cut into an hour", () => {
  const h = toHours(mac, "mac", AT);
  assert.ok(h.every((x) => x.apps.every((a) => !/signal|1password/i.test(a.id + a.name))));
  assert.deepEqual(h[2].segs, [[0, 0, 300]]);               // only Code's five minutes; Signal's stretch left nothing
  assert.deepEqual(h[2].away, [[1800, 3600]]);
});

ok("a device's line holds only its own apps", () => {
  const mixed: Timeline = { ...mac, apps: [{ id: "gos:com.whatsapp", name: "WhatsApp" }, ...mac.apps] };
  assert.ok(toHours(mixed, "mac", AT).every((x) => x.apps.every((a) => !a.id.startsWith("gos:"))));
  const phone = toHours({ ...mixed, segs: [[0, T0, T0 + 5 * M], [1, T0 + 5 * M, T0 + 9 * M]] }, "gos", AT);
  assert.deepEqual(phone[0].apps.map((a) => a.id), ["gos:com.whatsapp"]);
});

ok("the other device joins the hours back into the same timeline", () => {
  const docs = apply([], planLines([], toHours(mac, "mac", AT)));
  const tl = joinLines(docs, "mac", mac.from, mac.now)!;
  const named = tl.segs.map(([a, s, e]) => [tl.apps[a].name, (s - T0) / M, (e - T0) / M]);
  assert.deepEqual(named, [["Safari", 10, 50], ["Code", 50, 125], ["Safari", 180, 200]]);   // Code's 75 minutes are one stretch again
  assert.deepEqual(tl.away.map(([s, e]) => [(s - T0) / M, (e - T0) / M]), [[150, 180]]);
  assert.equal(tl.upTo, mac.now);
  assert.equal(joinLines(docs, "gos", mac.from, mac.now), null);   // nothing saved for the phone: no line, not a fake one
});

ok("a second save writes only the hour that changed", () => {
  let docs = apply([], planLines([], toHours(mac, "mac", AT)));
  assert.equal(docs.length, 4);
  assert.deepEqual(planLines(docs, toHours(mac, "mac", AT)), []);       // nothing new: nothing written
  const later: Timeline = { ...mac, now: mac.now + 10 * M, segs: [...mac.segs.slice(0, 3), [0, T0 + 3 * HOUR, T0 + 3 * HOUR + 30 * M]] };
  const w = planLines(docs, toHours(later, "mac", AT));
  assert.equal(w.length, 1);
  assert.equal(w[0].data.hour, T0 + 3 * HOUR);
  assert.equal(w[0].id, docs.find((d) => d.data.hour === T0 + 3 * HOUR)!.id);   // same record, replaced
  docs = apply(docs, w);
  assert.equal(docs.length, 4);
});

ok("a day later the slot is reused, so there are never more than 24 per device", () => {
  let docs: Doc<StLine>[] = [];
  for (let d = 0; d < 3; d++) {
    const now = T0 + d * 24 * HOUR + 23 * HOUR + 59 * M;
    const busy: Timeline = { now, from: now - 24 * HOUR, apps: [{ id: "com.apple.Safari", name: "Safari" }],
      segs: Array.from({ length: 24 }, (_, i) => [0, now - (i + 1) * HOUR + 5 * M, now - (i + 1) * HOUR + 20 * M] as [number, number, number]) };
    busy.away = [];
    docs = apply(docs, planLines(docs, toHours(busy, "mac", AT)));
  }
  assert.ok(docs.length <= 24, `${docs.length} records`);
  assert.equal(new Set(docs.map((d) => d.data.slot)).size, docs.length);
});

ok("an older hour never overwrites a newer one in its slot", () => {
  const newer = toHours(mac, "mac", AT);
  const docs = apply([], planLines([], newer));
  const old = toHours({ ...mac, now: mac.now - 24 * HOUR, from: mac.from - 24 * HOUR, segs: mac.segs.map(([a, s, e]) => [a, s - 24 * HOUR, e - 24 * HOUR] as [number, number, number]), away: [] }, "mac", AT);
  assert.deepEqual(planLines(docs, old), []);
});

ok("the phone and the Mac never touch each other's records", () => {
  const macDocs = apply([], planLines([], toHours(mac, "mac", AT)));
  const phone: Timeline = { now: mac.now, from: mac.from, apps: [{ id: "gos:com.whatsapp", name: "WhatsApp" }], segs: [[0, T0 + 5 * M, T0 + 15 * M]], away: [] };
  const w = planLines(macDocs, toHours(phone, "gos", AT));
  assert.equal(w.length, 1);
  assert.equal(w[0].id, undefined);                           // a new phone record, the Mac's slot stays
  const all = apply(macDocs, w);
  assert.equal(joinLines(all, "gos", mac.from, mac.now)!.segs.length, 1);
  assert.equal(joinLines(all, "mac", mac.from, mac.now)!.segs.length, 3);
});

ok("an old record that holds Signal never shows", () => {
  const bad = doc("x", { device: "mac", hour: T0, slot: 8, upTo: T0 + HOUR, updatedAt: AT,
    apps: [{ id: "org.whispersystems.signal-desktop", name: "Signal" }, { id: "com.agilebits.onepassword7", name: "1Password" }, { id: "com.apple.Notes", name: "Notes" }],
    segs: [[0, 0, 600], [1, 600, 900], [2, 900, 1200]], away: [] });
  const tl = joinLines([bad], "mac", T0, T0 + HOUR)!;
  assert.deepEqual(tl.apps.map((a) => a.name), ["Notes"]);
  assert.equal(tl.segs.length, 1);
});

ok("only the hours inside the window count, cut at its edges", () => {
  const docs = apply([], planLines([], toHours(mac, "mac", AT)));
  const tl = joinLines(docs, "mac", T0 + 30 * M, T0 + 60 * M)!;
  assert.deepEqual(tl.segs.map(([, s, e]) => [(s - T0) / M, (e - T0) / M]), [[30, 50], [50, 60]]);
});

ok("a timeline from a bridge is checked: bad numbers out, ids prefixed, Signal dropped", () => {
  const raw = { now: T0 + HOUR, from: T0, apps: [{ id: "com.whatsapp", name: "WhatsApp" }, { id: "org.thoughtcrime.securesms", name: "Signal" }, { id: 5 }],
    segs: [[0, T0 - 10 * M, T0 + 10 * M], [1, T0 + 10 * M, T0 + 20 * M], [0, "x", 3], [2, T0, T0 + M], [0, T0 + 50 * M, T0 + 2 * HOUR]], away: [[T0 + 20 * M, T0 + 30 * M], ["a", 1]] };
  const tl = cleanTimeline(raw, "gos:")!;
  assert.deepEqual(tl.apps, [{ id: "gos:com.whatsapp", name: "WhatsApp" }]);
  assert.deepEqual(tl.segs, [[0, T0, T0 + 10 * M], [0, T0 + 50 * M, T0 + HOUR]]);    // cut to [from, now]
  assert.deepEqual(tl.away, [[T0 + 20 * M, T0 + 30 * M]]);
  assert.equal(cleanTimeline(null), null);
  assert.equal(cleanTimeline({ now: 1, from: 2, apps: [], segs: [] }), null);
});

ok("the pop-up shows its own range out of a day long line", () => {
  const tl = clipTimeline(cleanTimeline(mac)!, 1);           // 07:20 to 08:20 after T0's hour 3
  assert.equal(tl.from, mac.now - HOUR);
  assert.deepEqual(tl.segs.map(([a, s, e]) => [a, (s - T0) / M, (e - T0) / M]), [[0, 180, 200]]);
  assert.deepEqual(tl.away, [[T0 + 150 * M, T0 + 180 * M]]);
  const cut = clipTimeline(cleanTimeline(mac)!, 2);           // a stretch across the edge is cut at it
  assert.deepEqual(cut.segs[0].slice(1).map((t) => (t - T0) / M), [80, 125]);
  assert.equal(clipTimeline(mac, 24), mac);
});

console.log(`\n${n} passed`);
