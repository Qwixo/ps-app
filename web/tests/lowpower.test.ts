// Run: node --experimental-strip-types tests/lowpower.test.ts
// Low power mode (core/lowpower.ts, PS 1.65): which timers stop, that nothing polls while asleep (a fake clock and a
// fake fetch that fails the test if called), the staggered catch up on wake, and that every feed in core is wired.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  asleepLine, asleepNames, cleanPrefs, createLowPower, decide, DEFAULT_PREFS, FEEDS, feedAsleep, FIRST_CATCH_MS, lpClear, lpInterval,
  SLOW_SYNC_MS, STAGGER_MS, type Clock,
} from "../src/core/lowpower.ts";

let n = 0;
const fails: string[] = [];
const ok = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { fails.push(`${name}: ${(e as Error).message.split("\n")[0]}`); } };

/** A fake clock: nothing runs until advance(). Counts live timers and every wake up. */
function fakeClock() {
  let t = 0, id = 1, wakeups = 0;
  const jobs = new Map<number, { at: number; every: number | null; fn: () => void }>();
  const c: Clock & { advance(ms: number): void; live(): number; wakeups(): number; time(): number } = {
    now: () => t,
    setTimeout: (fn, ms) => { const h = id++; jobs.set(h, { at: t + ms, every: null, fn }); return h; },
    clearTimeout: (h) => { jobs.delete(h as number); },
    setInterval: (fn, ms) => { const h = id++; jobs.set(h, { at: t + ms, every: ms, fn }); return h; },
    clearInterval: (h) => { jobs.delete(h as number); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next: [number, { at: number; every: number | null; fn: () => void }] | null = null;
        for (const e of jobs) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
        if (!next) break;
        const [h, j] = next;
        t = j.at;
        if (j.every === null) jobs.delete(h); else j.at += j.every;
        wakeups++;
        j.fn();
      }
      t = end;
    },
    live: () => jobs.size,
    wakeups: () => wakeups,
    time: () => t,
  };
  return c;
}
/** A fetch that fails the test the moment anything calls it. */
const failFetch = (what: string) => () => { throw new Error(`${what} polled while asleep`); };

// ---------- the rules ----------
ok("prefs: odd values fall back field by field", () => {
  assert.deepEqual(cleanPrefs(null), DEFAULT_PREFS);
  assert.deepEqual(cleanPrefs({ hand: "yes", autoMac: false, alarms: 0 }), { ...DEFAULT_PREFS, autoMac: false });
});
ok("decide: by hand first, then the Mac, then the phone, each only with its switch", () => {
  assert.deepEqual(decide({ ...DEFAULT_PREFS, hand: true }, { mac: true, phone: false }), { on: true, why: "hand" });
  assert.deepEqual(decide(DEFAULT_PREFS, { mac: true, phone: false }), { on: true, why: "mac" });
  assert.deepEqual(decide({ ...DEFAULT_PREFS, autoMac: false }, { mac: true, phone: false }), { on: false, why: null });
  assert.deepEqual(decide(DEFAULT_PREFS, { mac: false, phone: true }), { on: true, why: "phone" });
  assert.deepEqual(decide({ ...DEFAULT_PREFS, autoPhone: false }, { mac: false, phone: true }), { on: false, why: null });
  assert.deepEqual(decide({ ...DEFAULT_PREFS, hand: true }, { mac: true, phone: true }, false), { on: false, why: null });   // feature off
});
ok("alarms sleep only when their switch is off; unknown feeds sleep", () => {
  const alarms = FEEDS.find((f) => f.id === "alarms");
  assert.equal(feedAsleep(true, DEFAULT_PREFS, alarms), false);
  assert.equal(feedAsleep(true, { ...DEFAULT_PREFS, alarms: false }, alarms), true);
  assert.equal(feedAsleep(true, DEFAULT_PREFS, undefined), true);
  assert.equal(feedAsleep(false, DEFAULT_PREFS, undefined), false);
});
ok("feed ids are unique and well formed, names short", () => {
  assert.equal(new Set(FEEDS.map((f) => f.id)).size, FEEDS.length);
  for (const f of FEEDS) { assert.match(f.id, /^[a-z0-9]+(-[a-z0-9]+)*$/); assert.ok(f.name.length > 0 && f.name.length <= 40, f.id); }
  for (const id of ["gsquad", "squad-chat", "squad-dms", "squad-board", "squad-gym", "squad-p1", "squad-notify", "gmail", "instantly", "proton", "campaigns",
    "calendar", "updates", "second", "net", "mixer", "activity", "backgrounds", "assistant", "receipts", "history", "alarms"]) assert.ok(FEEDS.some((f) => f.id === id), id);
});
ok("the line: three names, then a count", () => {
  assert.equal(asleepLine([]), "Nothing is asleep");
  assert.equal(asleepLine(["Gmail"]), "Asleep: Gmail");
  assert.equal(asleepLine(["Gmail", "Squad chat"]), "Asleep: Gmail and Squad chat");
  assert.equal(asleepLine(["A", "B", "C", "D", "E"]), "Asleep: A, B, C and 2 more");
});
ok("names: later feeds and Mac only feeds are left out where they do not run", () => {
  const lp = createLowPower(fakeClock(), { prefs: { hand: true } });
  const mac = asleepNames(lp.state(), lp.feeds(), true), web = asleepNames(lp.state(), lp.feeds(), false);
  assert.ok(mac.includes("Network monitor") && !web.includes("Network monitor"));
  assert.ok(!mac.includes("Activity monitor"));   // still being built: listed once it registers
  lp.register({ id: "activity", name: "Activity monitor", group: "system" });
  assert.ok(asleepNames(lp.state(), lp.feeds(), true).includes("Activity monitor"));
  assert.ok(!mac.includes("Alarms and reminders"));   // alarms keep ringing by default
});

// ---------- which timers stop ----------
ok("on: every background timer is gone, only the alarms stay; alarms switch off: none at all", () => {
  const c = fakeClock();
  const lp = createLowPower(c);
  const ids = ["gsquad", "squad-chat", "squad-dms", "squad-board", "squad-gym", "squad-p1", "gmail", "calendar", "updates", "checks", "alarms"];
  for (const id of ids) lp.every(id, 30_000, () => {});
  assert.equal(c.live(), ids.length);
  lp.setPrefs({ hand: true });
  assert.equal(c.live(), 1, "only the alarms timer is left");
  assert.equal(lp.liveTimers(), 1);
  lp.setPrefs({ alarms: false });
  assert.equal(c.live(), 0, "no timer at all");
  const before = c.wakeups();
  c.advance(3 * 3600_000);
  assert.equal(c.wakeups(), before, "not one wake up in three hours");
});
ok("lpInterval and lpClear behave like setInterval and clearInterval", () => {
  const c = fakeClock();
  const lp = createLowPower(c);
  let hits = 0;
  const h = lpInterval("calendar", () => hits++, 1000, undefined, lp);
  c.advance(3500);
  assert.equal(hits, 3);
  lpClear(h); lpClear(undefined); lpClear(h);
  c.advance(5000);
  assert.equal(hits, 3);
  assert.equal(c.live(), 0);
});

// ---------- nothing polls while asleep ----------
ok("asleep: a fake fetch behind every feed is never called, by timers or wake hooks", () => {
  const c = fakeClock();
  const lp = createLowPower(c, { prefs: { hand: true, alarms: false } });
  for (const f of FEEDS) {
    lp.every(f.id, 5_000, failFetch(f.id));
    lpInterval(f.id, failFetch(f.id), 7_000, undefined, lp);
    lp.onWake(f.id, failFetch(`${f.id} wake`));
  }
  c.advance(24 * 3600_000);
  assert.equal(c.live(), 0);
});
ok("the macOS Low Power Mode auto switch puts it to sleep, and its own switch keeps it awake", () => {
  const c = fakeClock();
  const lp = createLowPower(c);
  lp.every("gmail", 1000, failFetch("gmail"));
  lp.setOs("mac", true);
  assert.equal(lp.state().why, "mac");
  c.advance(60_000);
  const lp2 = createLowPower(c, { prefs: { autoMac: false } });
  let hits = 0;
  lp2.every("gmail", 1000, () => hits++);
  lp2.setOs("mac", true);
  c.advance(3000);
  assert.equal(hits, 3);
  assert.equal(lp2.on(), false);
});
ok("Battery Saver on the phone does the same", () => {
  const lp = createLowPower(fakeClock());
  lp.setOs("phone", true);
  assert.equal(lp.state().why, "phone");
  assert.equal(lp.asleep("squad-chat"), true);
  assert.equal(lp.asleep("alarms"), false);
});
ok("vault sync slows down, never stops", () => {
  const lp = createLowPower(fakeClock());
  assert.equal(lp.syncEvery(25_000), 25_000);
  lp.setPrefs({ hand: true });
  assert.equal(lp.syncEvery(25_000), SLOW_SYNC_MS);
  assert.equal(lp.syncEvery(10 * 60_000), 10 * 60_000);
  assert.equal(lp.asleep("vault"), true, "an id nobody declared sleeps (vault sync never asks asleep, only syncEvery)");
});

// ---------- the staggered catch up ----------
ok("wake: one catch up per feed, one at a time, STAGGER_MS apart, never a burst", () => {
  const c = fakeClock();
  const lp = createLowPower(c, { prefs: { hand: true } });
  const calls: { id: string; at: number }[] = [];
  const ids = ["gsquad", "squad-chat", "gmail", "calendar", "updates"];
  for (const id of ids) lp.every(id, 10 * 60_000, () => calls.push({ id, at: c.time() }));
  lp.onWake("history", () => calls.push({ id: "history", at: c.time() }));
  c.advance(3600_000);
  assert.equal(calls.length, 0);
  lp.setPrefs({ hand: false });
  assert.equal(calls.length, 0, "nothing runs in the click itself");
  c.advance(FIRST_CATCH_MS + STAGGER_MS * 10);
  assert.deepEqual(calls.map((x) => x.id), [...ids, "history"], "in declared order, each once");
  const t0 = calls[0].at;
  calls.forEach((x, i) => assert.equal(x.at - t0, i * STAGGER_MS, `${x.id} at its own moment`));
  assert.ok(new Set(calls.map((x) => x.at)).size === calls.length, "never two at once");
});
ok("a tick timer with catchUp false is not called on wake", () => {
  const c = fakeClock();
  const lp = createLowPower(c, { prefs: { hand: true } });
  let ticks = 0;
  lp.every("squad-chat", 60_000, () => ticks++, { catchUp: false });
  lp.setPrefs({ hand: false });
  c.advance(FIRST_CATCH_MS + STAGGER_MS);
  assert.equal(ticks, 0);
  c.advance(60_000);
  assert.equal(ticks, 1);
});
ok("back asleep halfway through the catch up: the rest wait and nothing polls", () => {
  const c = fakeClock();
  const lp = createLowPower(c, { prefs: { hand: true } });
  const done: string[] = [];
  for (const id of ["gsquad", "squad-chat", "gmail", "calendar"]) lp.every(id, 3600_000, () => done.push(id));
  lp.setPrefs({ hand: false });
  c.advance(FIRST_CATCH_MS + STAGGER_MS);   // two ran
  assert.deepEqual(done, ["gsquad", "squad-chat"]);
  lp.setPrefs({ hand: true });
  c.advance(3 * 3600_000);
  assert.deepEqual(done, ["gsquad", "squad-chat"]);
  assert.equal(c.live(), 0);
});
ok("a hook asked again while asleep is still called once", () => {
  const c = fakeClock();
  const lp = createLowPower(c, { prefs: { hand: true } });
  let n2 = 0;
  const f = () => n2++;
  for (let i = 0; i < 20; i++) lp.onWake("history", f);
  lp.setPrefs({ hand: false });
  c.advance(60_000);
  assert.equal(n2, 1);
});
ok("one feed's error never stops the other catch ups", () => {
  const c = fakeClock();
  const lp = createLowPower(c, { prefs: { hand: true } });
  let after = 0;
  lp.every("gsquad", 3600_000, () => { throw new Error("boom"); });
  lp.every("gmail", 3600_000, () => after++);
  lp.setPrefs({ hand: false });
  c.advance(10_000);
  assert.equal(after, 1);
});

// ---------- Wake everything, the feature switch, register ----------
ok("Wake everything while the Mac's own Low Power Mode is on: off until that mode changes", () => {
  const lp = createLowPower(fakeClock(), { os: { mac: true } });
  assert.equal(lp.on(), true);
  lp.wakeAll();
  assert.equal(lp.on(), false);
  lp.setOs("mac", false); lp.setOs("mac", true);
  assert.equal(lp.on(), true, "the next time macOS turns it on, it works again");
  lp.setPrefs({ hand: true }); lp.wakeAll();
  assert.equal(lp.on(), false);
  assert.equal(lp.state().prefs.hand, false);
});
ok("the feature switch off: never on, every timer runs", () => {
  const c = fakeClock();
  const lp = createLowPower(c, { prefs: { hand: true } });
  let hits = 0;
  lp.every("gmail", 1000, () => hits++);
  lp.setFeature(false);
  c.advance(2000);
  assert.ok(hits >= 2);
});
ok("register: a new feed sleeps, a bad id is refused, subscribers hear changes", () => {
  const lp = createLowPower(fakeClock());
  let heard = 0;
  lp.subscribe(() => heard++);
  lp.register({ id: "voice-capture", name: "Voice capture", group: "system" });
  assert.throws(() => lp.register({ id: "Bad Id", name: "x", group: "system" }));
  lp.setPrefs({ hand: true });
  assert.ok(lp.asleep("voice-capture"));
  assert.ok(lp.state().asleep.includes("voice-capture"));
  assert.ok(heard >= 1);
});

// ---------- every feed in core is wired (source checks) ----------
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const mac = (p: string) => readFileSync(new URL(`../../mac/Sources/${p}`, import.meta.url), "utf8");
ok("web: the feeds use the low power API, no bare setInterval left in them", () => {
  const wired: Record<string, string> = {
    "squad/engine.ts": "gsquad", "squad/chatengine.ts": "squad-chat", "squad/board.ts": "squad-board", "squad/gym.ts": "squad-gym", "squad/gymclient.ts": "squad-gym",
    "squad/p1engine.ts": "squad-p1", "squad/direngine.ts": "squad-join", "squad/autoengine.ts": "squad-auto", "calrefresh.ts": "calendar", "mailcards.ts": "mail-cards",
    "replyengine.ts": "gmail", "meetwatch.ts": "alarms", "remwatch.ts": "alarms", "remweb.ts": "alarms", "chkwatch.ts": "alarms", "posturewatch.ts": "alarms",
    "pomodoro.ts": "alarms", "sleepmode/engine.ts": "alarms", "gymwatch.ts": "alarms", "notescard.ts": "checks", "notelook.ts": "checks", "dnd.ts": "checks",
    "sentryprefs.ts": "checks", "psstatus.ts": "devices", "core/bgvault.ts": "backgrounds", "fitness/sync.ts": "fitness", "tgbot.ts": "telegram",
    "rewind.ts": "history", "views/WebUpdateNote.tsx": "updates", "ps.ts": "screentime", "gos/calm.ts": "checks",
  };
  for (const [f, id] of Object.entries(wired)) {
    const s = src(f);
    assert.ok(s.includes(`"${id}"`) && /lpInterval|lowPower\./.test(s), `${f} asks low power for ${id}`);
  }
  for (const f of Object.keys(wired).filter((f) => f.startsWith("squad/") || ["calrefresh.ts", "mailcards.ts", "replyengine.ts", "meetwatch.ts", "remwatch.ts", "chkwatch.ts", "posturewatch.ts", "pomodoro.ts", "notescard.ts", "notelook.ts", "dnd.ts", "sentryprefs.ts", "psstatus.ts"].includes(f)))
    assert.ok(!/window\.setInterval\(/.test(src(f)), `${f} has a bare setInterval`);
});
ok("web: every call to the G Squad hub goes through hubAwake", () => {
  for (const f of ["squad/hub.ts", "squad/chathub.ts", "squad/dmhub.ts", "squad/boardhub.ts", "squad/featreqhub.ts"]) assert.ok(src(f).includes("hubAwake();"), f);
  assert.ok(src("core/vault.ts").includes("lowPower.syncEvery(pace())"), "vault sync slows down");
  assert.ok(src("island.ts").includes("lowPowerWake"), "the island's Wake everything");
});
ok("mac: the Mac's feeds check LowPower", () => {
  const want: Record<string, string> = { "NetMonitor.swift": "\"net\"", "Mixer.swift": "\"mixer\"", "Updater.swift": "\"updates\"", "Backgrounds.swift": "\"backgrounds\"",
    "ScreenTime.swift": "\"screentime\"", "Reminders.swift": "\"alarms\"", "Posture.swift": "\"alarms\"", "ProtonBridge.swift": "\"proton\"", "Second.swift": "\"second\"", "main.swift": "\"updates\"" };
  for (const [f, id] of Object.entries(want)) assert.ok(mac(f).includes("LowPower.shared") && mac(f).includes(id), `${f} ${id}`);
  assert.ok(mac("main.swift").includes("LowPowerState.syncEvery(20"), "the Mac's sync ask slows down");
  assert.ok(mac("LowPower.swift").includes("NSProcessInfoPowerStateDidChange"), "macOS Low Power Mode is watched");
});

if (fails.length) { console.error(`lowpower: ${fails.length} failed of ${n + fails.length}\n  ` + fails.join("\n  ")); process.exit(1); }
console.log(`lowpower: ${n} passed`);
