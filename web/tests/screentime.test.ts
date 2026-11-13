// Run: node --experimental-strip-types tests/screentime.test.ts
// Screen time per device (core/screentime.ts): Mac and phone records apart, old records count as the
// Mac's, the one time split of the days both devices wrote into one record, and the golden rule.
import assert from "node:assert/strict";
import { belongsTo, daysOf, isPhoneApp, mergeApps, nextApps, planSplit, stDevice } from "../src/core/screentime.ts";
import type { Doc, ScreenTimeApp, ScreenTimeDay } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const T = "2026-10-27T20:00:00.000Z";
const app = (id: string, secs: number, name = id): ScreenTimeApp => ({ id, name, secs });
const rec = (id: string, data: Partial<ScreenTimeDay> & { day: string; apps: ScreenTimeApp[] }): Doc<ScreenTimeDay> =>
  ({ id, ws: null, kind: "screentime", data: { updatedAt: T, ...data }, author: null, updatedAt: T } as Doc<ScreenTimeDay>);
// Apply writes the way saveScreenTime does (same id replaces, no id adds).
const apply = (docs: Doc<ScreenTimeDay>[], writes: { id?: string; data: ScreenTimeDay }[]) => {
  const out = [...docs];
  let k = 0;
  for (const w of writes) {
    const i = w.id ? out.findIndex((d) => d.id === w.id) : -1;
    if (i >= 0) out[i] = { ...out[i], data: w.data }; else out.push(rec(w.id ?? `new${k++}`, w.data));
  }
  return out;
};

ok("old records with no device are the Mac's", () => {
  assert.equal(stDevice({}), "mac");
  assert.equal(stDevice({ device: "mac" }), "mac");
  assert.equal(stDevice({ device: "gos" }), "gos");
  const docs = [rec("a", { day: "2026-10-26", apps: [app("com.apple.Safari", 600)] }), rec("b", { day: "2026-10-26", device: "gos", apps: [app("gos:com.android.chrome", 60)] })];
  assert.equal(daysOf(docs, "mac").get("2026-10-26")?.id, "a");
  assert.equal(daysOf(docs, "gos").get("2026-10-26")?.id, "b");
  assert.equal(daysOf(docs, "gos").get("2026-10-25"), undefined);
});

ok("the biggest record wins if a device ever saved a day twice", () => {
  const docs = [rec("a", { day: "2026-10-26", apps: [app("x", 10)] }), rec("b", { day: "2026-10-26", device: "mac", apps: [app("x", 99)] })];
  assert.equal(daysOf(docs, "mac").get("2026-10-26")?.id, "b");
});

ok("per device saving: each device keeps only its own apps", () => {
  assert.equal(isPhoneApp("gos:com.whatsapp"), true);
  assert.equal(isPhoneApp("com.apple.Safari"), false);
  // The phone sending into an empty day: only phone ids are kept.
  assert.deepEqual(mergeApps([], [app("gos:com.whatsapp", 100), app("com.apple.Safari", 50)], "gos"), [app("gos:com.whatsapp", 100)]);
  // The Mac sending: never takes a phone id.
  assert.deepEqual(mergeApps([], [app("com.apple.Safari", 50), app("gos:com.whatsapp", 100)], "mac"), [app("com.apple.Safari", 50)]);
});

ok("change only: larger counts kept, same totals write nothing", () => {
  const old = [app("com.apple.Safari", 600), app("com.tinyspeck.slackmacgap", 300)];
  assert.equal(mergeApps(old, [app("com.apple.Safari", 600)], "mac"), null);
  assert.equal(mergeApps(old, [app("com.apple.Safari", 500)], "mac"), null);
  const next = mergeApps(old, [app("com.apple.Safari", 700), app("com.figma.Desktop", 900)], "mac")!;
  assert.deepEqual(next.map((a) => [a.id, a.secs]), [["com.figma.Desktop", 900], ["com.apple.Safari", 700], ["com.tinyspeck.slackmacgap", 300]]);
});

ok("golden rule: Signal and 1Password never saved, older records scrubbed, on both devices", () => {
  const phone = ["gos:org.thoughtcrime.securesms", "gos:com.onepassword.android", "gos:com.agilebits.onepassword"].map((id) => app(id, 500));
  assert.equal(mergeApps([], phone, "gos"), null);
  assert.deepEqual(mergeApps([], [...phone, app("gos:com.spotify.music", 9)], "gos"), [app("gos:com.spotify.music", 9)]);
  // A label alone is enough.
  assert.equal(mergeApps([], [app("gos:some.repack", 50, "Signal")], "gos"), null);
  const mac = [app("org.whispersystems.signal-desktop", 400), app("com.1password.1password", 300), app("com.agilebits.onepassword7", 200)];
  assert.equal(mergeApps([], mac, "mac"), null);
  // An older record that still holds one is scrubbed even with no new counts.
  assert.deepEqual(mergeApps([app("com.apple.Safari", 5), app("com.1password.1password", 300)], [], "mac"), [app("com.apple.Safari", 5)]);
  assert.equal(belongsTo("gos")(app("gos:com.onepassword.android", 1)), false);
  // And the split never moves one either.
  const docs = [rec("m", { day: "2026-10-27", apps: [app("com.apple.Safari", 100), app("gos:org.thoughtcrime.securesms", 50)] })];
  const w = planSplit(docs, "gos", T);
  assert.equal(w.some((x) => x.data.apps.some((a) => /securesms/.test(a.id))), false);
  assert.deepEqual(w.find((x) => x.id === "m")?.data.apps, [app("com.apple.Safari", 100)]);
});

ok("a Mac save leaves a mixed day's phone apps alone until the phone has moved them", () => {
  const old = [app("com.apple.Safari", 600), app("gos:com.whatsapp", 300)];
  assert.equal(mergeApps(old, [app("com.apple.Safari", 600)], "mac"), null);
  assert.deepEqual(mergeApps(old, [app("com.apple.Safari", 700)], "mac"), [app("com.apple.Safari", 700), app("gos:com.whatsapp", 300)]);
  // But the screens never show them as the Mac's.
  assert.equal(belongsTo("mac")(app("gos:com.whatsapp", 300)), false);
});

// The developer's 27 Oct: the Mac record of the day holds both devices.
const mixed = () => [
  rec("mac27", { day: "2026-10-27", apps: [app("com.apple.Safari", 5400, "Safari"), app("gos:com.whatsapp", 2400, "WhatsApp"), app("com.tinyspeck.slackmacgap", 1200, "Slack"), app("gos:com.android.chrome", 900, "Chrome")] }),
  rec("mac26", { day: "2026-10-26", apps: [app("com.apple.Safari", 7000, "Safari")] }),
];

ok("split on the phone: phone apps move into a new phone record, Mac apps untouched", () => {
  const w = planSplit(mixed(), "gos", T);
  assert.equal(w.length, 2);
  assert.equal(w[0].id, undefined);                                 // the phone record comes first, new
  assert.deepEqual(w[0].data, { day: "2026-10-27", device: "gos", apps: [app("gos:com.whatsapp", 2400, "WhatsApp"), app("gos:com.android.chrome", 900, "Chrome")], updatedAt: T });
  assert.equal(w[1].id, "mac27");
  assert.equal(w[1].data.device, "mac");
  assert.deepEqual(w[1].data.apps, [app("com.apple.Safari", 5400, "Safari"), app("com.tinyspeck.slackmacgap", 1200, "Slack")]);
  // 26 Oct had no phone apps: not written.
  assert.equal(w.some((x) => x.id === "mac26"), false);
});

ok("split on the phone keeps the larger count when the phone record already exists", () => {
  const docs = [...mixed(), rec("gos27", { day: "2026-10-27", device: "gos", apps: [app("gos:com.whatsapp", 3000, "WhatsApp")] })];
  const w = planSplit(docs, "gos", T);
  assert.equal(w[0].id, "gos27");
  assert.deepEqual(w[0].data.apps, [app("gos:com.whatsapp", 3000, "WhatsApp"), app("gos:com.android.chrome", 900, "Chrome")]);
});

ok("split on the Mac: only apps the phone record already holds leave the Mac record", () => {
  assert.deepEqual(planSplit(mixed(), "mac", T), []);              // no phone record yet: nothing removed
  const docs = [...mixed(), rec("gos27", { day: "2026-10-27", device: "gos", apps: [app("gos:com.whatsapp", 3000, "WhatsApp")] })];
  const w = planSplit(docs, "mac", T);
  assert.equal(w.length, 1);                                        // the Mac never writes the phone's record
  assert.equal(w[0].id, "mac27");
  assert.deepEqual(w[0].data.apps.map((a) => a.id), ["com.apple.Safari", "com.tinyspeck.slackmacgap", "gos:com.android.chrome"]);
});

ok("the split is idempotent and the totals add up", () => {
  let docs = mixed();
  const before = docs[0].data.apps.reduce((n, a) => n + a.secs, 0);
  docs = apply(docs, planSplit(docs, "gos", T));
  assert.deepEqual(planSplit(docs, "gos", T), []);
  assert.deepEqual(planSplit(docs, "mac", T), []);
  const m = daysOf(docs, "mac").get("2026-10-27")!.data.apps, g = daysOf(docs, "gos").get("2026-10-27")!.data.apps;
  assert.equal(m.reduce((n, a) => n + a.secs, 0) + g.reduce((n, a) => n + a.secs, 0), before);
  assert.equal(m.some((a) => isPhoneApp(a.id)), false);
  assert.equal(g.every((a) => isPhoneApp(a.id)), true);
  // The phone then sends its full day: counts grow in its own record only.
  assert.deepEqual(mergeApps(g, [app("gos:com.whatsapp", 2500, "WhatsApp")], "gos")?.[0], app("gos:com.whatsapp", 2500, "WhatsApp"));
});

ok("two Mac records of one mixed day both get cleaned, one phone record made", () => {
  const docs = [...mixed(), rec("mac27b", { day: "2026-10-27", apps: [app("gos:com.whatsapp", 2600, "WhatsApp"), app("com.apple.Notes", 60, "Notes")] })];
  const w = planSplit(docs, "gos", T);
  assert.equal(w.filter((x) => x.data.device === "gos").length, 1);
  assert.deepEqual(w[0].data.apps[0], app("gos:com.whatsapp", 2600, "WhatsApp"));
  assert.deepEqual(w.find((x) => x.id === "mac27b")?.data.apps, [app("com.apple.Notes", 60, "Notes")]);
});

ok("the phone's exact count (usage events) replaces an old count of the day once, then grows as before", () => {
  // The old way (the system's stored totals) said 2 hours for YouTube today because it took in yesterday evening.
  const old = { apps: [app("gos:com.google.android.youtube", 7200), app("gos:com.whatsapp", 60)] };
  const exact = [app("gos:com.google.android.youtube", 1500), app("gos:com.whatsapp", 900)];
  assert.deepEqual(nextApps(old, exact, "gos", true), [app("gos:com.google.android.youtube", 1500), app("gos:com.whatsapp", 900)]);
  // Once exact, the larger count per app wins (a day's totals only grow).
  const saved = { apps: exact, exact: true };
  assert.equal(nextApps(saved, [app("gos:com.google.android.youtube", 1400)], "gos", true), null);
  assert.deepEqual(nextApps(saved, [app("gos:com.google.android.youtube", 1600)], "gos", true)?.[0], app("gos:com.google.android.youtube", 1600));
  // A count the old way never undoes an exact one, and the Mac is unchanged.
  assert.equal(nextApps(saved, [app("gos:com.whatsapp", 10)], "gos"), null);
  assert.deepEqual(nextApps({ apps: [app("com.apple.Safari", 60)] }, [app("com.apple.Safari", 120)], "mac"), [app("com.apple.Safari", 120)]);
  // Golden rule still holds on the replace.
  assert.deepEqual(nextApps(old, [app("gos:org.thoughtcrime.securesms", 600), app("gos:com.whatsapp", 30)], "gos", true), [app("gos:com.whatsapp", 30)]);
});

console.log(`\n${n} screen time checks passed`);
