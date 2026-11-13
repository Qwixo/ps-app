// Run: node --experimental-strip-types tests/sentry.test.ts
// Sentry mode (V1.48, V1.49 Dim Screen; core/sentry.ts). The developer, 11 Nov 2026: lock the Mac but keep it fully awake so AI jobs keep running,
// even unplugged. Checks the prefs, the warning rules, the words (no em or en dashes), the settings index and, when
// ps-mac is next to this checkout (or PS_MAC_DIR), that the Mac uses the same numbers and the same message names.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { HELPER_CHECK, checkId, checksFresh, freshHelperCheck, type RestartFacts } from "../src/core/sentry.ts";
import { LOW_PCTS, MAC, RESTART_HOURS, SENTRY_DEFAULTS, WORDS, batteryStops, restartLabel, cleanSentry, noteFor, planOf, sentryOf, stateOf, sentryPrefsMsg, RESTART_WARN, RESTART_ON_HOURS, RESTART_ON_SLEEP_HOURS, helperFixable, restartCheck, restartWarnLines, checkTitle, restartGap, FILEVAULT_PANE, sleepSentry, sleepCheckLines, SLEEP_SENTRY_WORDS, SENTRY_SPOTS, SENTRY_SPOT_DEF, SENTRY_SPOT_LINE, SENTRY_SPOT_NAMES, okSpot } from "../src/core/sentry.ts";
import { groupsFor, rowsOf, searchSettings, type Ctx } from "../src/core/settingsindex.ts";
import { SLOTS } from "../src/core/tablayout.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("defaults: stop at 10 percent, lid closed on (V1.49), no warning seen", () => {
  assert.deepEqual(cleanSentry(undefined), SENTRY_DEFAULTS);
  assert.deepEqual(sentryOf({}), SENTRY_DEFAULTS);
  assert.ok(!("screen" in SENTRY_DEFAULTS), "V1.49: no Screen while engaged setting");
  assert.equal(SENTRY_DEFAULTS.lowStop, true);
  assert.equal(SENTRY_DEFAULTS.lowPct, 10);
  assert.equal(SENTRY_DEFAULTS.lid, true);
  assert.equal(SENTRY_DEFAULTS.lidSet, false);
  assert.ok((LOW_PCTS as readonly number[]).includes(SENTRY_DEFAULTS.lowPct));
});
ok("saved prefs are checked field by field", () => {
  assert.ok(!("screen" in cleanSentry({ screen: "off" })), "a V1.48 screen value is dropped");
  assert.equal(cleanSentry({ lowPct: 2 }).lowPct, 5);
  assert.equal(cleanSentry({ lowPct: 99 }).lowPct, 50);
  assert.equal(cleanSentry({ lowPct: "x" }).lowPct, 10);
  assert.equal(cleanSentry({ lowPct: null }).lowPct, 10);
  assert.equal(cleanSentry({ lowStop: "no" }).lowStop, true);
  assert.equal(cleanSentry({ lowStop: false }).lowStop, false);
  assert.equal(cleanSentry({ lid: "yes", lidSet: true }).lid, false);
  // V1.52: the heat and bag warning is gone; an old record's flags are read harmlessly and dropped
  const old = cleanSentry({ lid: true, warned: true, lidWarned: true }) as unknown as Record<string, unknown>;
  assert.ok(!("warned" in old) && !("lidWarned" in old));
});
ok("the lid (V1.49): on by default, kept off only when the person switched it off themselves", () => {
  // never touched: on (a V1.48 record saved lid false as its default with every other change)
  assert.equal(cleanSentry({}).lid, true);
  assert.equal(cleanSentry({ lid: false, lowPct: 15, warned: true }).lid, true);
  // V1.48: switched on at some point (the lid warning was seen), then off: theirs, stays off; still on: stays on
  assert.equal(cleanSentry({ lid: false, lidWarned: true }).lid, false);
  assert.equal(cleanSentry({ lid: true, lidWarned: true }).lid, true);
  assert.equal(cleanSentry({ lid: false, lidWarned: true }).lidSet, true);
  // V1.49 records carry lidSet
  assert.equal(cleanSentry({ lid: false, lidSet: true }).lid, false);
  assert.equal(cleanSentry({ lid: false, lidSet: false, lidWarned: true }).lid, true);
  assert.equal(cleanSentry({ lid: true, lidSet: true }).lid, true);
  // saved again, the choice survives (what save writes is what cleanSentry reads back)
  const off = cleanSentry({ ...SENTRY_DEFAULTS, lid: false, lidSet: true });
  assert.deepEqual(cleanSentry(JSON.parse(JSON.stringify(off))), off);
  assert.equal(planOf(SENTRY_DEFAULTS).lid, true);
  assert.equal(WORDS.lidHelperNeeded, "Keeping awake with the lid closed needs the PS app helper. Set it up in Security.");
});
ok("the plan sent to the Mac holds only what it needs", () => {
  assert.deepEqual(Object.keys(planOf(SENTRY_DEFAULTS)).sort(), ["lid", "lowPct", "lowStop", "restartH"]);
});
ok("the battery stop: only on battery, only at or under the level, only when switched on", () => {
  const p = { lowStop: true, lowPct: 10 };
  assert.equal(batteryStops(p, true, 10), true);
  assert.equal(batteryStops(p, true, 11), false);
  assert.equal(batteryStops(p, false, 3), false);
  assert.equal(batteryStops(p, true, null), false);
  assert.equal(batteryStops({ lowStop: false, lowPct: 10 }, true, 1), false);
});
ok("V1.52 (the developer): the heat and bag warning never shows: not on the first engage, the lid, or the sleep screen", () => {
  const v = readFileSync(new URL("../src/views/Sentry.tsx", import.meta.url), "utf8");
  const c = readFileSync(new URL("../src/core/sentry.ts", import.meta.url), "utf8");
  for (const w of ["SentryWarning", "needsWarning", "warnTitle", "warnBody", "very hot", "inside a bag", "setWarn"]) assert.ok(!v.includes(w) && !c.includes(w), w);
  assert.ok(!("warn" in sleepSentry(SENTRY_DEFAULTS, { helper: "on" })), "the sleep plan has no warning");
  // V1.54: no heat warning in between: the fresh helper check and the lid check together, then one decision
  assert.ok(v.includes("    if (s.busy || checking) return;\n    go(p);"), "the AI button goes straight to the checks (V1.54: the fresh helper check and the lid check, together)");
  assert.ok(v.includes("const on = () => { sfx.hover(); save(p, { lid: true, lidSet: true }); };"), "the lid switches on at once");
});
ok("the words: plain, no em or en dashes", () => {
  const src = readFileSync(new URL("../src/core/sentry.ts", import.meta.url), "utf8")
    + readFileSync(new URL("../src/views/Sentry.tsx", import.meta.url), "utf8") + readFileSync(new URL("../src/views/sentry.css", import.meta.url), "utf8");
  assert.ok(!/[–—]/.test(src), "no em or en dashes");
  assert.equal(WORDS.button, "AI");
});
ok("the Sentry screen's words: a fixed headline and the Dim Screen button", () => {
  assert.equal(WORDS.coverTitle, "Protected by PS");
  assert.equal(WORDS.coverSub, "Sentry mode engaged");
  assert.equal(WORDS.dimButton, "Dim Screen");
  assert.equal(WORDS.dimLine, "Battery saver, dims screen to save on battery life");
  assert.ok(MAC.dimFadeS > 0 && MAC.dimFadeS <= 1 && MAC.undimFadeS > 0 && MAC.undimFadeS <= MAC.dimFadeS, "smooth and short");
});
ok("the Mac's state and notes", () => {
  assert.deepEqual(stateOf(null), { phase: "off", since: null, note: null });
  assert.equal(stateOf({ phase: "covered", since: 5 }).since, 5);
  assert.equal(stateOf({ phase: "nonsense", since: 5 }).phase, "off");
  assert.equal(stateOf({ phase: "off", since: 5 }).since, null);
  assert.match(noteFor({ refused: "protected" })!, /protected app/);
  assert.match(noteFor({ refused: "battery" })!, /Plug in/);
  assert.match(noteFor({ stopped: "battery" })!, /locked/);
  assert.match(noteFor({ lid: "tooHot" })!, /While Sentry mode was on.*too hot/);   // V1.54: said after the unlock
  assert.equal(noteFor({ stopped: "unlock" }), null);
});
ok("restart if not unlocked: default 8 h, Off is 0, only the offered times", () => {
  assert.equal(SENTRY_DEFAULTS.restartH, 8);
  assert.deepEqual([...RESTART_HOURS], [0, 1, 2, 4, 8, 12, 18, 24, 48, 72]);
  // V1.52 (the developer): its own time under Sleep mode, 18 h by default, the same choices
  assert.equal(SENTRY_DEFAULTS.restartSleepH, 18);
  assert.equal(RESTART_ON_SLEEP_HOURS, 18);
  assert.equal(cleanSentry({ restartSleepH: 0 }).restartSleepH, 0);
  assert.equal(cleanSentry({ restartSleepH: 72 }).restartSleepH, 72);
  assert.equal(cleanSentry({ restartSleepH: 5 }).restartSleepH, 18);
  assert.equal(cleanSentry({ restartH: 18 }).restartH, 18, "18 h is a plain Sentry choice too");
  assert.equal(cleanSentry({ restartH: 0 }).restartSleepH, 18, "the two are separate");
  assert.equal(cleanSentry({ restartH: 0 }).restartH, 0);
  assert.equal(cleanSentry({ restartH: 24 }).restartH, 24);
  assert.equal(cleanSentry({ restartH: 5 }).restartH, 8);
  assert.equal(cleanSentry({ restartH: null }).restartH, 8);
  assert.equal(cleanSentry({ restartH: "" }).restartH, 8);
  assert.equal(restartLabel(0), "Off");
  assert.equal(restartLabel(48), "48 h");
});
ok("V1.52: no restart countdown on the Sentry screen, in any state", () => {
  const page = readFileSync(new URL("../src/core/sentry.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/views/Sentry.tsx", import.meta.url), "utf8");
  assert.ok(!/Restarts in|unless unlocked|restartLine/.test(page), "the page never words the restart time");
});
const MAC_CTX: Ctx = { red: false, where: "mac" }, RED: Ctx = { red: true, where: "mac" };
ok("Settings: a Sentry mode group on every Mac (public and private), never on the website or the phone", () => {
  for (const ctx of [MAC_CTX, RED]) {
    assert.ok(groupsFor(ctx).some((g) => g.id === "sentry"), `${ctx.red ? "Owner" : "friend"}: the group`);
    assert.deepEqual(rowsOf("sentry", ctx).main.map((e) => e.id), ["sentry-battery", "sentry-restart", "sentry-restart-sleep", "sentry-lid", "auto-approve"]);   // Auto approve sits here too (core/autoapprove.ts)
  }
  for (const ctx of [{ red: false, where: "web" }, { red: false, where: "phone", shell: "gos" }] as Ctx[]) {
    assert.ok(!groupsFor(ctx).some((g) => g.id === "sentry"), ctx.where);
    assert.equal(searchSettings("sentry", ctx).length, 0, ctx.where);
  }
});
ok("Settings search finds each Sentry setting", () => {
  const first = (q: string) => searchSettings(q, MAC_CTX)[0]?.e.id;
  assert.ok(searchSettings("sentry", MAC_CTX).slice(0, 3).every((h) => h.e.group === "sentry"));
  assert.ok(!searchSettings("screen while engaged", MAC_CTX).some((h) => h.e.id === "sentry-screen"), "the old row is gone");
  assert.equal(first("sentry battery"), "sentry-battery");
  assert.equal(first("lid closed"), "sentry-lid");
  assert.equal(first("clamshell"), "sentry-lid");
  assert.equal(first("stolen"), "sentry-restart");
  assert.equal(first("sentry restart"), "sentry-restart");
  assert.equal(first("restart during sleep mode"), "sentry-restart-sleep");
});
ok("Edit mode knows the AI button, placed between Time zones and Timelines", () => {
  const ids = SLOTS.map((s) => s.id);
  // V1.58 (the developer: "put the Pomodoro timer in between the time zones and the AI sentry mode by default"): Pomodoro sits between.
  assert.equal(ids.indexOf("pomodoro"), ids.indexOf("clocks") + 1);
  assert.equal(ids.indexOf("sentry"), ids.indexOf("pomodoro") + 1);
  assert.equal(ids.indexOf("timelines"), ids.indexOf("sentry") + 1);
  assert.ok(!SLOTS.find((s) => s.id === "sentry")!.red, "every account");
  const tm = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
  const a = tm.indexOf('<Slot id="clocks">'), b = tm.indexOf('<Slot id="sentry">'), c = tm.indexOf('<Slot id="timelines">');
  assert.ok(a > 0 && a < b && b < c, "drawn between them");
});

// ---------- the Mac (ps-mac next to this checkout, or PS_MAC_DIR) ----------
const mac = process.env.PS_MAC_DIR || `${process.env.HOME}/Projects/ps-mac`;
const swift = `${mac}/Sources/Sentry.swift`, core = `${mac}/Sources/SentryCore.swift`;
if (existsSync(swift) && existsSync(core)) {
  ok("the Mac uses the same numbers and message names", () => {
    const s = readFileSync(swift, "utf8") + readFileSync(core, "utf8");
    assert.match(s, new RegExp(`static let dimFade: Double = ${MAC.dimFadeS}\\b`));
    assert.match(s, new RegExp(`static let undimFade: Double = ${MAC.undimFadeS}\\b`));
    assert.ok(!/dimAfter|justMoved|plan\.screen|displaySleep/.test(s), "nothing dims by itself any more");
    // The headline is a fixed literal on the Mac too: never AppName (the app's own name or the person's rename).
    assert.ok(s.includes(`static let title = "${WORDS.coverTitle}"`), "the Mac's headline literal");
    assert.ok(s.includes("text(title, SentryRules.title,"), "the cover draws that literal");
    assert.ok(!/AppName/.test(s), "Sentry never uses the app's name");
    for (const w of [WORDS.coverSub, WORDS.dimButton, WORDS.dimLine]) assert.ok(s.includes(`"${w}"`), `the Mac says "${w}"`);
    assert.match(s, new RegExp(`static let powerEvery: Double = ${MAC.powerEveryS}\\b`));
    // V1.52 (the developer): the cover never shows the restart time. No countdown words, no line maker, no deadline drawn.
    for (const w of ["Restarts in", "unless unlocked", "restartLine", "restart: r"]) assert.ok(!s.includes(w), `the Mac never says or draws "${w}"`);
    assert.ok(!/setStatus\([^)]*restart/.test(s) && !/text\(restart\b/.test(s), "no restart layer on the cover");
    assert.match(s, /restartHours = \[0, 1, 2, 4, 8, 12, 18, 24, 48, 72\]/);
    assert.match(s, new RegExp(`var lid = ${SENTRY_DEFAULTS.lid}\\b`), "the Mac's lid default matches");
    for (const t of ["sentry:start", "sentry:get"]) assert.ok(s.includes(`"${t}"`), t);
    assert.ok(s.includes("__psSentry"));
    for (const r of ["protected", "battery", "screen", "nolock"]) assert.ok(s.includes(`"${r}"`), `refused ${r}`);
    assert.ok(!/[–—]/.test(s), "no em or en dashes in Sentry.swift or SentryCore.swift");
  });
} else console.log(`skip - ps-mac check: no ${swift} (set PS_MAC_DIR)`);

ok("V1.49 sentryPrefs: what the Mac's restart helper pop up needs (restartH, 8 by default, 0 is Off)", () => {
  // V1.52: either restart on means the helper is wanted, so the larger one goes (the Mac only checks for more than 0)
  assert.deepEqual(sentryPrefsMsg(undefined), { restartH: 18 });
  assert.deepEqual(sentryPrefsMsg({ sentry: { restartH: 0, restartSleepH: 0 } }), { restartH: 0 });
  assert.deepEqual(sentryPrefsMsg({ sentry: { restartH: 0 } }), { restartH: 18 });
  assert.deepEqual(sentryPrefsMsg({ sentry: { restartH: 24, restartSleepH: 0 } }), { restartH: 24 });
  assert.deepEqual(sentryPrefsMsg({ sentry: { restartH: 5, restartSleepH: 0 } }), { restartH: 8 });
  const shell = readFileSync(new URL("../src/sentryprefs.ts", import.meta.url), "utf8");
  assert.ok(shell.includes("type: \"sentryPrefs\""), "the shell sends sentryPrefs");
  assert.ok(readFileSync(new URL("../src/ps.ts", import.meta.url), "utf8").includes("startSentryPrefs(psPost)"), "ps.ts starts it");
  const alertMain = `${mac}/Sources/main.swift`, alertCore = `${mac}/Sources/HelperAlertCore.swift`;
  if (existsSync(alertCore)) {
    assert.ok(readFileSync(alertMain, "utf8").includes("case \"sentryPrefs\""), "the Mac takes sentryPrefs (main.swift)");
  } else console.log(`skip - ps-mac HelperAlertCore.swift not there (set PS_MAC_DIR to the v149-helper-alert checkout)`);
});

// ---------- V1.52 (the developer, 12 Nov 2026): check the restart to BFU before engaging ----------
ok("V1.52 restart check: everything fine means no warning and no extra step", () => {
  assert.equal(restartCheck({ helper: "on", mode: "watch" }, 8), null);
  assert.equal(restartCheck({ helper: "test" }, 1), null, "a self test copy");
  assert.equal(restartCheck(undefined, 8), null, "settings not known yet: engage as before");
  assert.equal(restartCheck({ helper: "on", mode: "off" }, 8), null, "the main Auto reboot Off alone is only a note");
});
ok("V1.52 restart check: every way the restart would not happen is found", () => {
  assert.deepEqual(restartCheck({ helper: "off" }, 8), { helper: "notSetUp", restartOff: false, autoRebootOff: false, fileVaultOff: false });
  assert.equal(restartCheck({ helper: "approve" }, 8)?.helper, "needsOk");
  assert.equal(restartCheck({ helper: "on", error: "no answer in 10 s" }, 8)?.helper, "notAnswering");
  assert.equal(restartCheck({ helper: "on", helperOld: true }, 8)?.helper, "older");
  assert.equal(restartCheck({ helper: "missing" }, 8)?.helper, "missing");
  assert.deepEqual(restartCheck({ helper: "on" }, 0), { helper: null, restartOff: true, autoRebootOff: false, fileVaultOff: false });
  assert.deepEqual(restartCheck({ helper: "off", mode: "off" }, 0), { helper: "notSetUp", restartOff: true, autoRebootOff: true, fileVaultOff: false });
  assert.deepEqual(restartCheck(undefined, 0), { helper: null, restartOff: true, autoRebootOff: false, fileVaultOff: false });
});
ok("V1.52 the fix: Turn on restart is the default 8 h; the helper is only fixable from here when it can be", () => {
  assert.equal(RESTART_ON_HOURS, 8);
  assert.ok(RESTART_HOURS.includes(RESTART_ON_HOURS));
  assert.ok(helperFixable("notSetUp") && helperFixable("needsOk") && helperFixable("notAnswering"));
  assert.ok(!helperFixable("older") && !helperFixable("missing") && !helperFixable(null));
});
ok("V1.52 the words: plain, say what happens, no em or en dashes", () => {
  assert.equal(RESTART_WARN.title, "Auto restart is off");
  assert.equal(RESTART_WARN.consequence, "If this Mac is taken while in Sentry mode, it will not restart into its locked state.");
  assert.equal(RESTART_WARN.setUpHelper, "Set up the helper");
  assert.equal(RESTART_WARN.turnOn, "Turn on restart");
  assert.equal(RESTART_WARN.engageAnyway, "Engage anyway");
  const lines = restartWarnLines({ helper: "notSetUp", restartOff: true, autoRebootOff: true, fileVaultOff: false });
  assert.deepEqual(lines, [RESTART_WARN.helper.notSetUp, RESTART_WARN.restartOff, RESTART_WARN.autoRebootOff, RESTART_WARN.consequence]);
  assert.deepEqual(restartWarnLines({ helper: null, restartOff: true, autoRebootOff: false, fileVaultOff: false }), [RESTART_WARN.restartOff, RESTART_WARN.consequence]);
  assert.ok(!/[–—]/.test(JSON.stringify(RESTART_WARN)), "no em or en dashes");
});
ok("V1.52 the page: checks before engaging, Esc cancels, Engage anyway and the fixes are there", () => {
  const v = readFileSync(new URL("../src/views/Sentry.tsx", import.meta.url), "utf8");
  assert.ok(v.includes("restartCheck(facts, pr.restartH)"), "the AI button checks the restart first (V1.54: on the fresh facts)");
  assert.match(v, /function RestartWarning/);
  assert.ok(/e\.key === "Escape"[\s\S]{0,120}onClose\(\)/.test(v.slice(v.indexOf("function RestartWarning"))), "Esc closes it");
  assert.ok(!/NSAlert/.test(v));
});

// ---------- sentry-real-lock (the developer, 12 Nov 2026: "unbruteforcible, like encryption"): FileVault off in the same check ----------
ok("FileVault: only a definite off warns; on, unknown and not known yet never do", () => {
  assert.equal(restartCheck({ helper: "on", fileVault: "on" }, 8), null);
  assert.equal(restartCheck({ helper: "on", fileVault: "unknown" }, 8), null);
  assert.equal(restartCheck({ helper: "on" }, 8), null);
  assert.deepEqual(restartCheck({ helper: "on", fileVault: "off" }, 8), { helper: null, restartOff: false, autoRebootOff: false, fileVaultOff: true });
  // with a restart gap too: both are said
  assert.deepEqual(restartCheck({ helper: "off", fileVault: "off" }, 0), { helper: "notSetUp", restartOff: true, autoRebootOff: false, fileVaultOff: true });
});
ok("FileVault: the title and lines say what is wrong, the restart lines only when the restart is the problem", () => {
  const fvOnly = restartCheck({ helper: "on", mode: "off", fileVault: "off" }, 8)!;
  assert.ok(!restartGap(fvOnly));
  assert.equal(checkTitle(fvOnly), "FileVault is off");
  assert.deepEqual(restartWarnLines(fvOnly), [RESTART_WARN.fileVault], "no restart consequence and no Auto reboot note when the restart works");
  const both = restartCheck({ helper: "off", mode: "off", fileVault: "off" }, 8)!;
  assert.equal(checkTitle(both), RESTART_WARN.title);
  assert.deepEqual(restartWarnLines(both), [RESTART_WARN.helper.notSetUp, RESTART_WARN.autoRebootOff, RESTART_WARN.consequence, RESTART_WARN.fileVault]);
  assert.equal(RESTART_WARN.fileVault, "FileVault is off, so this Mac's disk is not encrypted. Someone who takes it could read your files without your password.");
  assert.equal(RESTART_WARN.openFileVault, "Open FileVault settings");
  assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(RESTART_WARN)), "no em or en dashes");
});
ok("FileVault: PS only opens System Settings there, never changes it (no fdesetup enable or disable anywhere)", () => {
  assert.equal(FILEVAULT_PANE, "x-apple.systempreferences:com.apple.preference.security?FileVault");
  const v = readFileSync(new URL("../src/views/Sentry.tsx", import.meta.url), "utf8");
  assert.ok(v.includes('psPost({ type: "sentry:fileVault" })'), "the button asks the Mac to open the pane");
  assert.ok(v.includes("checkTitle(check)"));
  const all = v + readFileSync(new URL("../src/core/sentry.ts", import.meta.url), "utf8");
  assert.ok(!/fdesetup\s+(enable|disable)/.test(all));
});
ok("FileVault: the sleep screen gets the same line, and the title to use once only FileVault is left", () => {
  const fvOnly = sleepSentry(SENTRY_DEFAULTS, { helper: "on", fileVault: "off" }).check!;
  assert.equal(fvOnly.title, RESTART_WARN.fileVaultTitle);
  assert.equal(fvOnly.fileVault, RESTART_WARN.fileVault);
  assert.equal(fvOnly.consequence, "");
  assert.equal(fvOnly.autoOff, null);
  assert.deepEqual(sleepCheckLines(fvOnly), [RESTART_WARN.fileVault]);
  const both = sleepSentry({ ...SENTRY_DEFAULTS, restartSleepH: 0 }, { helper: "on", fileVault: "off" }).check!;
  assert.equal(both.title, RESTART_WARN.title);
  assert.equal(both.fileVaultTitle, RESTART_WARN.fileVaultTitle);
  assert.deepEqual(sleepCheckLines(both), [RESTART_WARN.restartSleepOff, RESTART_WARN.consequence, RESTART_WARN.fileVault]);
  assert.equal(sleepSentry(SENTRY_DEFAULTS, { helper: "on", fileVault: "on" }).check, null);
});
if (existsSync(`${mac}/Sources/Sentry.swift`)) {
  ok("FileVault: the Mac opens the same pane for sentry:fileVault, and the sleep screen reads the line", () => {
    const s = readFileSync(`${mac}/Sources/Sentry.swift`, "utf8"), c = readFileSync(`${mac}/Sources/SleepSentryCore.swift`, "utf8");
    assert.ok(s.includes('case "sentry:fileVault"'));
    assert.ok(s.includes(`"${FILEVAULT_PANE}"`), "the same pane");
    assert.ok(c.includes('c["fileVault"]') && c.includes('c["fileVaultTitle"]'));
  });
}

// ---------- V1.52: AI Sentry mode from Sleep mode (the sleep plan's part; ps-mac SleepSentry.swift) ----------
ok("V1.52 sleep: the plan's part carries the settings, the same restart check and the words", () => {
  const fine = sleepSentry(SENTRY_DEFAULTS, { helper: "on" });
  // V1.52 (the developer): the helper deadline is armed with the Sleep mode time (18 h by default), not plain Sentry's 8 h
  assert.deepEqual(fine.plan, { ...planOf(SENTRY_DEFAULTS), restartH: 18 });
  assert.equal(sleepSentry({ ...SENTRY_DEFAULTS, restartH: 0, restartSleepH: 12 }, { helper: "on" }).plan.restartH, 12);
  assert.equal(fine.check, null, "all fine: no check, it engages with no extra step");
  assert.equal(fine.restartOn, RESTART_ON_SLEEP_HOURS);
  const first = sleepSentry(SENTRY_DEFAULTS, { helper: "off", mode: "off" });
  const c = first.check!;
  assert.equal(c.title, RESTART_WARN.title);
  assert.equal(c.helper, RESTART_WARN.helper.notSetUp);
  assert.equal(c.restartOff, null);
  assert.equal(c.autoOff, RESTART_WARN.autoRebootOff);
  assert.equal(c.fixHelper, true);
  // the same lines as the AI button's warning, in the same order
  assert.deepEqual(sleepCheckLines(c), restartWarnLines(restartCheck({ helper: "off", mode: "off" }, SENTRY_DEFAULTS.restartSleepH)!));
  // the check follows the Sleep mode time: plain Sentry Off does not matter here, the Sleep one Off does
  assert.equal(sleepSentry({ ...SENTRY_DEFAULTS, restartH: 0 }, { helper: "on" }).check, null);
  const off = sleepSentry({ ...SENTRY_DEFAULTS, restartSleepH: 0 }, { helper: "on" }).check!;
  assert.equal(off.restartOff, RESTART_WARN.restartSleepOff);
  assert.equal(off.helper, null);
  assert.equal(off.fixHelper, false);
  assert.equal(sleepSentry(SENTRY_DEFAULTS, { helper: "missing" }).check?.fixHelper, false, "nothing to set up in a copy with no helper");
});
ok("V1.52 sleep: where the button sits, left centre by default", () => {
  assert.equal(SENTRY_SPOT_DEF, "left");
  assert.deepEqual(SENTRY_SPOTS, ["left", "right", "bottomLeft", "bottomRight", "hidden"]);
  assert.deepEqual(Object.values(SENTRY_SPOT_NAMES), ["Left centre", "Right centre", "Bottom left", "Bottom right", "Hidden"]);
  assert.ok(okSpot("hidden") && !okSpot("middle") && !okSpot(undefined));
});
ok("V1.52 sleep: the words are plain, the shield says exactly Protected by PS, no em or en dashes", () => {
  assert.equal(SLEEP_SENTRY_WORDS.on, WORDS.coverTitle);
  assert.equal(SLEEP_SENTRY_WORDS.button, "AI Sentry mode");
  assert.ok(SLEEP_SENTRY_WORDS.batteryStop.includes("{pct}"));
  for (const w of [...Object.values(SLEEP_SENTRY_WORDS), SENTRY_SPOT_LINE, ...Object.values(SENTRY_SPOT_NAMES)]) assert.ok(!/[\u2013\u2014]/.test(w), w);
  // the refusals say the same as the AI button's notes
  assert.equal(SLEEP_SENTRY_WORDS.refusedProtected, noteFor({ refused: "protected" }));
  assert.equal(SLEEP_SENTRY_WORDS.refusedBattery, noteFor({ refused: "battery" }));
  assert.equal(SLEEP_SENTRY_WORDS.refusedNolock, noteFor({ refused: "nolock" }));
});
ok("V1.52 sleep: the page saves what the sleep screen's panels change, and opens Security for Set up the helper", () => {
  const v = readFileSync(new URL("../src/views/Sentry.tsx", import.meta.url), "utf8");
  const e = readFileSync(new URL("../src/sleepmode/engine.ts", import.meta.url), "utf8");
  assert.ok(v.includes("__psSentryAsk") && !v.includes('"warned"') && v.includes('what === "restartOn") save(p, { restartSleepH: RESTART_ON_SLEEP_HOURS })'));
  assert.ok(v.includes('addEventListener("ps-sentry-security"') && e.includes('m.stopped === "security"') && e.includes('"ps-sentry-security"'));
  assert.ok(e.includes("onPsSettings(refreshPlan)"), "a change in the helper's state refreshes the check on the sleep screen");
  assert.ok(e.includes('m.stopped === "sentryBattery"'));
});
const sleepSwift = `${mac}/Sources/SleepSentryCore.swift`;
if (existsSync(sleepSwift)) {
  ok("V1.52 sleep: the Mac's fallback words and numbers are the page's, word for word", () => {
    const s = readFileSync(sleepSwift, "utf8");
    for (const [k, w] of Object.entries(SLEEP_SENTRY_WORDS)) {
      if (k === "on") { assert.ok(s.includes('"on": SentryRules.title'), "the shield's words are the Sentry headline literal"); continue; }
      assert.ok(s.includes(`"${k}": "${w}"`), `the Mac says ${k}: "${w}"`);
    }
    assert.ok(s.includes(`static let spots = [${SENTRY_SPOTS.map((x) => `"${x}"`).join(", ")}]`), "the same spots");
    assert.ok(s.includes(`static let spotDef = "${SENTRY_SPOT_DEF}"`));
    assert.ok(s.includes(`static let restartSleepDef = ${RESTART_ON_SLEEP_HOURS}`) && s.includes("static let restartOnHours = restartSleepDef"), "the Sleep mode restart default and Turn on restart match");
    assert.ok(!readFileSync(`${mac}/Sources/SleepSentry.swift`, "utf8").includes('\\"do\\":\\"warned\\"'), "no heat warning on the sleep screen");
    for (const t of ["restartOn"]) assert.ok(readFileSync(`${mac}/Sources/SleepSentry.swift`, "utf8").includes(`\\"do\\":\\"${t}\\"`), `the Mac asks the page: ${t}`);
  });
} else console.log(`skip - ps-mac sleep sentry check: no ${sleepSwift} (set PS_MAC_DIR)`);

// ---------- V1.54 (helper-check-154): the AI button checks the helper fresh before it decides ----------
// A fake Mac: posts are recorded, settings change when the test says, timers run when the test says.
function fakeMac(start: RestartFacts | undefined) {
  let facts = start;
  const subs = new Set<() => void>();
  const timers: (() => void)[] = [];
  const posts: { type: string; id: string }[] = [];
  return {
    io: (id: string) => ({ id, post: (m: { type: "reboot:check"; id: string }) => { posts.push(m); }, now: () => facts,
      listen: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; }, later: (f: () => void) => { timers.push(f); } }),
    send: (f: RestartFacts | undefined) => { facts = f; subs.forEach((x) => x()); },
    timeout: () => timers.forEach((t) => t()),
    posts, subs,
  };
}
const staleOn: RestartFacts = { helper: "on", error: "The restart helper is not switched on", checks: 1, mode: "watch" };
ok("V1.54: the bug replayed: an old miss with the helper on made the button warn (not answering)", () => {
  assert.equal(restartCheck(staleOn, 8)?.helper, "notAnswering");
});
await (async () => {
  const m = fakeMac(staleOn);
  const p = freshHelperCheck(m.io("c1"));
  assert.deepEqual(m.posts, [{ type: "reboot:check", id: "c1" }], "asks the Mac fresh, with its id");
  m.send({ ...staleOn, error: undefined });   // settings for something else (no checked id yet): still waits
  let settled = false; void p.then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false, "waits for its own check, not any settings");
  m.send({ helper: "on", checks: 1, checked: "c1", mode: "watch" });   // the Mac: on and answering
  const facts = await p;
  assert.equal(restartCheck(facts, 8), null, "fresh: on and answering, so no warning: Sentry mode engages");
  assert.equal(m.subs.size, 0, "stops listening once done");
  n++; console.log("ok - V1.54: the fresh check waits for its own id, then decides on the fresh answer (no false warning)");
})();
await (async () => {
  const m = fakeMac({ helper: "approve", checks: 1 });
  const p = freshHelperCheck(m.io("c2"));
  m.send({ helper: "approve", checks: 1, checked: "c2" });
  assert.equal(restartCheck(await p, 8)?.helper, "needsOk", "really switched off: still says so");
  n++; console.log("ok - V1.54: a helper really switched off still warns after the fresh check");
})();
await (async () => {
  const m = fakeMac({ helper: "on", checks: 1 });
  const p = freshHelperCheck(m.io("c3"));
  m.timeout();   // the Mac never said the check finished
  assert.deepEqual(await p, { helper: "on", checks: 1 }, "decides on what is known after the limit");
  assert.equal(m.subs.size, 0);
  m.send({ helper: "on", checks: 1, checked: "c3" });   // a late answer changes nothing
  n++; console.log("ok - V1.54: the Mac never answering: the page decides on what it knows after its limit, once");
})();
ok("V1.54: only a Mac that can check fresh is asked; the limit and the words", () => {
  assert.equal(checksFresh({ helper: "on", checks: 1 }), true);
  assert.equal(checksFresh({ helper: "on" }), false, "an older PS app: decides as before");
  assert.equal(checksFresh(undefined), false);
  assert.equal(HELPER_CHECK.words, "Checking the restart helper");
  assert.ok(!/[\u2013\u2014]/.test(HELPER_CHECK.words));
  assert.ok(HELPER_CHECK.waitS >= 8 && HELPER_CHECK.waitS <= 15, "a few seconds, never long");
  assert.notEqual(checkId(1, 0.5), checkId(2, 0.5));
  assert.ok(checkId(Date.now(), Math.random()).length <= 40, "the Mac keeps 40 characters");
});
ok("V1.54: the button waits for the fresh check and never engages after it went away", () => {
  const v = readFileSync(new URL("../src/views/Sentry.tsx", import.meta.url), "utf8");
  assert.ok(v.includes("freshHelperCheck({") && v.includes("if (!fresh) { decide(pr, reboot, null); return; }"), "an older Mac decides at once");
  assert.ok(v.includes("void Promise.all([helperNow, lidNow]).then(([facts, g]) => {") && v.includes("decide(pr, facts, g);"), "both checks together, then one decision");
  assert.ok(v.includes("if (!alive.current) return;"), "the Tab list closed meanwhile: nothing engages");
  assert.ok(v.includes("if (s.busy || checking) return;"), "a second press while checking does nothing");
  assert.ok(v.includes("{HELPER_CHECK.words}"), "the small checking line shows");
});
const helperCheckSwift = `${mac}/Sources/HelperCheckCore.swift`;
if (existsSync(helperCheckSwift)) {
  ok("V1.54: the Mac's check fits inside the page's limit, and the Mac answers reboot:check", () => {
    const c = readFileSync(helperCheckSwift, "utf8");
    const num = (k: string) => Number(new RegExp(`static let ${k}: Double = ([0-9.]+)`).exec(c)?.[1]);
    assert.equal(num("pageWait"), HELPER_CHECK.waitS, "same limit on both sides");
    assert.ok(num("onWait") + num("answerWait") + num("every") < HELPER_CHECK.waitS);
    const mainSwift = readFileSync(`${mac}/Sources/main.swift`, "utf8");
    assert.ok(mainSwift.includes(`case "reboot:check" where fromMain || fromOverlay:`));
    const ar = readFileSync(`${mac}/Sources/AutoReboot.swift`, "utf8");
    assert.ok(ar.includes(`d["checks"] = 1`) && ar.includes(`d["checked"] = checkedId`), "the fields the page reads");
  });
} else console.log(`skip - ps-mac HelperCheckCore.swift not there (set PS_MAC_DIR to the helper-check-154 checkout)`);

console.log(`sentry: ${n} passed`);
