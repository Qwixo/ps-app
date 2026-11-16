// Run: node --experimental-strip-types tests/devicebg.test.ts
// PS 1.65 Backgrounds per device (core/devicebg.ts): the device records, the picks, the merge, the ticks, the device id.
import assert from "node:assert/strict";
import {
  BEAT_HOURS, DEVICES_MAX, ID_KEY, MARK_DAYS, PICKS_MAX, STALE_DAYS, applyTick, beatRecord, cleanDevice, cleanPicks, deviceId, deviceKind, devicesOf,
  effective, forgetMemoryId, hasPicks, mergePicks, pickOf, renamed, rows, shouldBeat, ticks, uaName, withPick, withoutPicks, type Device,
} from "../src/core/devicebg.ts";
import { mergeSettings } from "../src/core/cardsync.ts";
import type { Settings } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const ago = (h: number) => new Date(NOW - h * 3600e3).toISOString();
const valid = (b: string) => b === "none" || b.startsWith("video:") && b !== "video:gone" || b.startsWith("color:");
const mac: Device = { dev: "macaaaaa0001", kind: "mac", name: "Mac", seen: ago(1) };
const mac2: Device = { dev: "macbbbbb0002", kind: "mac", name: "Mac", seen: ago(5) };
const phone: Device = { dev: "phoneccc0003", kind: "phone", name: "Pixel 8", seen: ago(2) };

ok("which kind of device: the Mac app, the Android app, the iPhone web app, a browser", () => {
  assert.equal(deviceKind("ps", false), "mac");
  assert.equal(deviceKind("gos", false), "phone");
  assert.equal(deviceKind("web", true), "phone");
  assert.equal(deviceKind("web", false), "web");
  assert.equal(uaName("phone", "Mozilla iPhone OS"), "iPhone");
  assert.equal(uaName("phone", "Linux Android 14"), "Android phone");
  assert.equal(uaName("mac", "anything"), "Mac");
});

ok("a device record is checked; names lose dashes, are short and default to the kind", () => {
  assert.deepEqual(cleanDevice(mac), mac);
  assert.equal(cleanDevice({ ...mac, kind: "tv" }), null);
  assert.equal(cleanDevice({ ...mac, dev: "../x" }), null);
  assert.equal(cleanDevice({ ...mac, seen: "soon" }), null);
  assert.equal(cleanDevice(null), null);
  assert.equal(cleanDevice({ ...mac, name: "My—Mac\n" })!.name, "My Mac");
  assert.equal(cleanDevice({ ...mac, name: "" })!.name, "Mac");
  assert.equal(cleanDevice({ ...mac, name: "x".repeat(100) })!.name.length, 30);
  assert.equal(cleanDevice({ ...mac, own: true })!.own, true);
  assert.equal("own" in cleanDevice({ ...mac, own: "yes" })!, false);
});

ok("the device list: each device once (newest record), stale ones left out, newest first, at most 8", () => {
  const list = devicesOf([mac2, { ...mac, seen: ago(30) }, mac, phone, { ...phone, dev: "old000000001", seen: ago(24 * (STALE_DAYS + 1)) }, "junk", null], NOW);
  assert.deepEqual(list.map((d) => d.dev), [mac.dev, phone.dev, mac2.dev]);
  assert.equal(list[0].seen, mac.seen, "the newest record of a device wins");
  const many = Array.from({ length: 20 }, (_, i) => ({ ...mac, dev: `dev${String(i).padStart(9, "0")}`, seen: ago(i + 1) }));
  assert.equal(devicesOf(many, NOW).length, DEVICES_MAX);
  assert.deepEqual(devicesOf([], NOW), []);
});

ok("a device writes its record only when new, changed, or a day went by", () => {
  assert.equal(shouldBeat(null, { kind: "mac", name: "Mac" }, NOW), true);
  assert.equal(shouldBeat({ ...mac, seen: ago(2) }, { kind: "mac", name: "Mac" }, NOW), false);
  assert.equal(shouldBeat({ ...mac, seen: ago(BEAT_HOURS + 1) }, { kind: "mac", name: "Mac" }, NOW), true);
  assert.equal(shouldBeat({ ...mac, seen: ago(1) }, { kind: "phone", name: "Mac" }, NOW), true);
  assert.equal(shouldBeat({ ...mac, seen: ago(1) }, { kind: "mac", name: "Studio" }, NOW), true);
});

ok("a name the person chose is kept by the daily beat; the default name never overwrites it", () => {
  const mine = renamed(mac, "Studio", NOW);
  assert.deepEqual([mine.name, mine.own], ["Studio", true]);
  assert.equal(shouldBeat({ ...mine, seen: ago(1) }, { kind: "mac", name: "Mac" }, NOW), false);
  const beat = beatRecord(mine, { dev: mac.dev, kind: "mac", name: "Mac" }, NOW);
  assert.deepEqual([beat.name, beat.own], ["Studio", true]);
  assert.equal(beatRecord(mac, { dev: mac.dev, kind: "mac", name: "MacBook" }, NOW).name, "MacBook");
  const back = renamed(mine, "  ", NOW);
  assert.deepEqual([back.name, "own" in back], ["Mac", false], "an empty name goes back to the default");
  assert.equal(beatRecord(mine, { dev: mac.dev, kind: "phone", name: "iPhone" }, NOW).name, "iPhone", "a changed kind drops the old name");
});

ok("the list names: this device first as This Mac, twins numbered, a chosen name shown", () => {
  const r = rows([mac2, phone, mac], mac.dev);
  assert.deepEqual(r.map((x) => x.label), ["This Mac", "Mac", "Pixel 8"]);
  assert.equal(r[0].here, true);
  const twins = rows([mac, { ...mac2, dev: "macddddd0004" }, { ...mac2 }], phone.dev);
  assert.deepEqual(twins.map((x) => x.label), ["Mac (1)", "Mac (2)", "Mac (3)"]);
  assert.equal(rows([renamed(mac, "Studio", NOW)], mac.dev)[0].label, "This Mac (Studio)");
  assert.deepEqual(rows([phone], mac.dev).map((x) => x.label), ["Pixel 8"], "this device not listed yet: the others still show");
});

ok("picks are checked, newest 12 kept, marks expire, junk ignored", () => {
  assert.deepEqual(cleanPicks(undefined, NOW), {});
  assert.deepEqual(cleanPicks([1, 2], NOW), {});
  assert.deepEqual(cleanPicks({ [mac.dev]: { b: "video:a", t: NOW } }, NOW), { [mac.dev]: { b: "video:a", t: NOW } });
  assert.deepEqual(cleanPicks({ "../x": { b: "none", t: NOW }, [mac.dev]: { b: 5, t: NOW }, [phone.dev]: { b: "none", t: 0 }, short: { b: "none", t: NOW } }, NOW), {});
  assert.deepEqual(cleanPicks({ [mac.dev]: { b: "x".repeat(61), t: NOW } }, NOW), {});
  const big: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) big[`dev${String(i).padStart(9, "0")}`] = { b: "none", t: NOW + i };
  const kept = cleanPicks(big, NOW);
  assert.equal(Object.keys(kept).length, PICKS_MAX);
  assert.ok(kept["dev000000029"] && !kept["dev000000000"], "the newest are kept");
  assert.ok(JSON.stringify(kept).length < 1000, "stays small");
  assert.deepEqual(cleanPicks({ [mac.dev]: { b: null, t: NOW - (MARK_DAYS + 1) * 864e5 } }, NOW), {}, "an old removed mark goes");
  assert.deepEqual(cleanPicks({ [mac.dev]: { b: null, t: NOW - 864e5 } }, NOW), { [mac.dev]: { b: null, t: NOW - 864e5 } });
});

ok("a device with no pick, a removed pick, or a pick that is no longer valid keeps today's background", () => {
  const picks = { [mac.dev]: { b: "video:a", t: NOW }, [phone.dev]: { b: null, t: NOW }, [mac2.dev]: { b: "video:gone", t: NOW } };
  assert.equal(effective(picks, mac.dev, valid, "none"), "video:a");
  assert.equal(effective(picks, phone.dev, valid, "color:blue"), "color:blue", "removed");
  assert.equal(effective(picks, mac2.dev, valid, "color:blue"), "color:blue", "that video was deleted");
  assert.equal(effective(picks, "unknown0000x", valid, "color:blue"), "color:blue", "a device with no pick at all");
  assert.equal(effective(undefined, mac.dev, valid, undefined), undefined, "an account that never used this: nothing changes");
  assert.equal(effective("junk", mac.dev, valid, "none"), "none");
  assert.equal(pickOf(null, mac.dev, valid), null);
});

ok("ticking sets a device's pick, unticking removes it, the other devices are untouched", () => {
  let p = applyTick(undefined, mac.dev, "video:a", true, NOW);
  p = applyTick(p, phone.dev, "video:a", true, NOW + 1);
  assert.equal(pickOf(p, mac.dev, valid), "video:a");
  assert.equal(pickOf(p, phone.dev, valid), "video:a");
  p = applyTick(p, mac.dev, "video:a", false, NOW + 2);
  assert.equal(pickOf(p, mac.dev, valid), null);
  assert.equal(pickOf(p, phone.dev, valid), "video:a");
  assert.deepEqual(applyTick(undefined, mac.dev, "video:a", false, NOW), {}, "unticking what was never picked saves nothing new");
  assert.equal(hasPicks(p, valid), true);
  const reset = withoutPicks(p, NOW + 3);
  assert.equal(hasPicks(reset, valid), false);
  assert.equal(pickOf(reset, phone.dev, valid), null);
  assert.deepEqual(withPick({}, mac.dev, null, NOW), {});
});

ok("the ticks: ticked when the device shows it; a device that only follows the shared one cannot be unticked", () => {
  const list = rows([mac, phone, mac2], mac.dev);
  const t = ticks(list, { [phone.dev]: { b: "video:a", t: NOW } }, "video:a", "color:blue", valid);
  assert.deepEqual(t.map((x) => [x.dev, x.on, x.shared]), [[mac.dev, false, false], [phone.dev, true, false], [mac2.dev, false, false]]);
  const s = ticks(list, undefined, "color:blue", "color:blue", valid);
  assert.ok(s.every((x) => x.on && x.shared));
});

ok("two devices' picks merge device by device: the later pick wins, a removal sticks, a tie keeps this device's", () => {
  const a = { [mac.dev]: { b: "video:a", t: NOW }, [phone.dev]: { b: "video:old", t: NOW - 10 } };
  const b = { [phone.dev]: { b: "video:new", t: NOW }, [mac2.dev]: { b: null, t: NOW } };
  const m = mergePicks(a, b, NOW)!;
  assert.equal(m[mac.dev].b, "video:a");
  assert.equal(m[phone.dev].b, "video:new");
  assert.equal(m[mac2.dev].b, null);
  assert.equal(mergePicks({ [mac.dev]: { b: "x1", t: NOW } }, { [mac.dev]: { b: "x2", t: NOW } }, NOW)![mac.dev].b, "x1");
  assert.equal(mergePicks({ [mac.dev]: { b: "x1", t: NOW } }, { [mac.dev]: { b: null, t: NOW + 5 } }, NOW)![mac.dev].b, null);
  assert.equal(mergePicks(undefined, undefined, NOW), null);
  assert.deepEqual(mergePicks(undefined, a, NOW), cleanPicks(a, NOW));
});

ok("the settings merger joins the picks and leaves everything else as this device has it", () => {
  const local = { tmBg: "none", tmBgDev: { [mac.dev]: { b: "video:a", t: NOW } } } as unknown as Settings;
  const remote = { tmBg: "color:blue", tmBgDev: { [phone.dev]: { b: "video:b", t: NOW } } } as unknown as Settings;
  const m = mergeSettings(local, remote);
  assert.equal(m.tmBg, "none");
  assert.equal(Object.keys(m.tmBgDev!).length, 2);
  const none = mergeSettings({ tmBg: "none" } as Settings, { tmBg: "none" } as Settings);
  assert.equal("tmBgDev" in none, false, "an account that never used it gets no new field");
});

ok("the device id: random, 16 letters or digits, kept in storage, survives a storage that fails", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  forgetMemoryId();
  const a = deviceId(store, () => new Uint8Array(16).map((_, i) => i * 7));
  assert.match(a, /^[a-z0-9]{16}$/);
  assert.equal(mem.get(ID_KEY), a);
  assert.equal(deviceId(store), a, "the same id the next time");
  mem.set(ID_KEY, "not valid!");
  forgetMemoryId();
  assert.match(deviceId(store), /^[a-z0-9]{16}$/, "a damaged id is replaced");
  const broken = { getItem: () => { throw new Error("off"); }, setItem: () => { throw new Error("off"); } };
  forgetMemoryId();
  const b = deviceId(broken);
  assert.equal(deviceId(broken), b, "one id for the whole session when storage is off");
  assert.match(deviceId(null), /^[a-z0-9]{16}$/);
});

console.log(`${n} passed`);
