// Sentry mode (V1.48, the developer 11 Nov 2026: lock the Mac but keep it fully awake so AI jobs keep running in the background,
// even unplugged). The big AI button in the Tab list engages it; the small gear on it opens three simple settings.
// What the Mac does (ps-mac Sentry.swift): PS covers every screen, keeps the Mac awake (on battery too), always shows
// "Protected by PS", and the only way out is Touch ID or the Mac password through the real macOS lock screen. V1.49
// (the developer, 12 Nov 2026): it no longer dims by itself; the pointer resting on its Dim Screen button dims the screens. Esc locks the Mac at once (the keep awake stays on); unlocking it ends
// Sentry mode. The phone (GOS) has no Sentry mode.
// Pure rules only (no React, no DOM), so tests/sentry.test.ts checks them. The Mac copies the numbers in SentryRules.

export interface SentryPrefs {
  /** Stop when the battery is low: Sentry mode ends and the Mac locks with the real lock screen. Default on. */
  lowStop: boolean;
  /** The battery percent it stops at. Default 10. */
  lowPct: number;
  /** Keep awake with the lid closed (the restart helper does it). V1.49 (the developer, 12 Nov 2026): on by default; only a
   *  person who switched it off themselves keeps it off. Without the helper Sentry mode still engages. */
  lid: boolean;
  /** The person picked On or Off for the lid themselves (V1.49). Until then the default (on) applies. */
  lidSet: boolean;
  /** Restart if not unlocked (the developer, 11 Nov 2026: a stolen Mac in Sentry mode restarts by itself, back to before first
   *  unlock): hours after engaging, 0 off. Default 8. Only a real Touch ID or password unlock cancels it. */
  restartH: number;
  /** V1.52 (the developer, 12 Nov 2026): the same restart, for Sentry mode turned on from Sleep mode's AI Sentry mode button. Its
   *  own time, default 18 h (a night's sleep and the morning); plain Sentry mode keeps restartH. */
  restartSleepH: number;
  /** PS 1.65 (the developer's friend, 17 Nov 2026): AI Sentry mode starts by itself whenever Sleep mode starts. On until the person
   *  turns it off (Sleep settings). Nobody pressed anything, so the stricter rule wins (the Mac's SleepSentryRules.autoPlan):
   *  Sleep mode's 20 percent battery stop always holds, a closed lid stays awake only if the person switched the lid on
   *  themselves, and the restart if not unlocked is not armed. Pressing the button keeps the person's own settings. */
  sleepAuto: boolean;
  // V1.52 (the developer): the heat and bag warning is gone everywhere. Old records may still hold `warned` and `lidWarned`;
  // cleanSentry drops them (lidWarned is still read once, by lidOf, for a V1.48 record's lid).
}

export const SENTRY_DEFAULTS: SentryPrefs = { lowStop: true, lowPct: 10, lid: true, lidSet: false, restartH: 8, restartSleepH: 18, sleepAuto: true };
/** The restart times to pick from (hours; 0 is Off). V1.52: 18 h added (the Sleep mode default). */
export const RESTART_HOURS = [0, 1, 2, 4, 8, 12, 18, 24, 48, 72] as const;
const okHours = (v: unknown): boolean => (RESTART_HOURS as readonly number[]).includes(Number(v)) && v !== null && v !== "";
/** The battery levels to pick from (percent). */
export const LOW_PCTS = [5, 10, 15, 20, 30] as const;
export const LOW_MIN = 5, LOW_MAX = 50;

/** Saved prefs, checked field by field (anything odd falls back to the default). V1.48's "screen" (Very dim or Fully
 *  off) is gone with its setting: the Dim Screen button on the Sentry screen does it now, so an old value is dropped. */
export function cleanSentry(v: unknown): SentryPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pct = Math.round(Number(o.lowPct));
  return {
    lowStop: typeof o.lowStop === "boolean" ? o.lowStop : SENTRY_DEFAULTS.lowStop,
    lowPct: Number.isFinite(pct) && o.lowPct !== null && o.lowPct !== "" ? Math.max(LOW_MIN, Math.min(LOW_MAX, pct)) : SENTRY_DEFAULTS.lowPct,
    ...lidOf(o),
    restartH: okHours(o.restartH) ? Number(o.restartH) : SENTRY_DEFAULTS.restartH,
    restartSleepH: okHours(o.restartSleepH) ? Number(o.restartSleepH) : SENTRY_DEFAULTS.restartSleepH,
    sleepAuto: typeof o.sleepAuto === "boolean" ? o.sleepAuto : SENTRY_DEFAULTS.sleepAuto,
  };
}
/** The lid: the default (on) until the person picks it. A V1.48 record has no lidSet: there, the lid warning seen
 *  (lidWarned) means they switched it on themselves at some point, so its saved lid stands (an Off after that was
 *  theirs); otherwise lid was never touched (V1.48 saved its default, off, with every other change) and it goes on. */
function lidOf(o: Record<string, unknown>): { lid: boolean; lidSet: boolean } {
  const lidSet = typeof o.lidSet === "boolean" ? o.lidSet : o.lidWarned === true;
  return { lid: lidSet ? o.lid === true : SENTRY_DEFAULTS.lid, lidSet };
}
export const sentryOf = (st: { sentry?: unknown } | null | undefined): SentryPrefs => cleanSentry(st?.sentry);

/** What the page sends with sentry:start: only what the Mac needs. */
export interface SentryPlan { lowStop: boolean; lowPct: number; lid: boolean; restartH: number }
export const planOf = (p: SentryPrefs): SentryPlan => ({ lowStop: p.lowStop, lowPct: p.lowPct, lid: p.lid, restartH: p.restartH });

/** Engaging now would stop at once: on battery at or under the stop level (with the stop switched on). */
export function batteryStops(p: Pick<SentryPrefs, "lowStop" | "lowPct">, onBattery: boolean, pct: number | null): boolean {
  return p.lowStop && onBattery && pct !== null && pct <= p.lowPct;
}

// ---------- the words (the developer sees these exact words before release; no em or en dashes) ----------
export const WORDS = {
  button: "AI",
  buttonTip: "Sentry mode",
  buttonLine: "Locks your Mac and keeps it awake so AI jobs keep running, even on battery. Touch ID or your password ends it.",
  gear: "Sentry mode settings",
  restartOff: "Off",
  setUpHelper: "Set up the helper",
  helperNeeded: "Restarting needs the PS app helper. Set it up in Security.",
  lidHelperNeeded: "Keeping awake with the lid closed needs the PS app helper. Set it up in Security.",
  // The Sentry screen (the Mac draws these, SentryRules; the test checks they match). The headline is always exactly
  // "Protected by PS": a fixed literal, never the app's name or the person's rename.
  coverTitle: "Protected by PS",
  coverSub: "Sentry mode engaged",
  dimButton: "Dim Screen",
  dimLine: "Battery saver, dims screen to save on battery life",
} as const;
/** "1 h", "8 h", "Off": the restart choices' labels. */
export const restartLabel = (h: number) => h === 0 ? WORDS.restartOff : `${h} h`;
// V1.52 (the developer): the Sentry screen never shows the restart time or a countdown, in any state. The restart itself is
// unchanged (the PS app helper holds the deadline); only the gear row "Restart if not unlocked" names the hours.

// ---------- V1.52 (the developer, 12 Nov 2026): check the restart to BFU before engaging ----------
// Pressing the AI button first checks that Sentry mode's restart would really happen: the restart helper is set up,
// switched on and answering, and "Restart if not unlocked" is not Off. If not, a warning shows BEFORE engaging, with the
// fix and Engage anyway. Esc cancels. When all is well it engages at once with no extra step. The facts come from the
// Mac's own helper status (ps.ts RebootSettings, what Security shows); nothing new is asked of the helper.

/** What the page knows about the restart helper (a slice of ps.ts RebootSettings; undefined: not known yet). fileVault
 *  is the Mac's own read only `fdesetup status` (ps-mac AutoReboot.swift), "on", "off" or "unknown". */
export interface RestartFacts {
  helper?: string; error?: string; helperOld?: boolean; mode?: string; fileVault?: string;
  /** V1.54: this Mac can check the helper fresh (reboot:check); an older Mac never sends it. */
  checks?: number;
  /** V1.54: the id of the last fresh check the Mac finished. */
  checked?: string;
}
/** Why the helper cannot hold the restart: not set up, switched off in System Settings (or waiting for the yes), not
 *  answering, from an older PS app (proto before Sentry mode), or this build has none. */
export type HelperGap = "notSetUp" | "needsOk" | "notAnswering" | "older" | "missing";
export interface RestartCheck {
  /** The helper cannot hold the restart (null: it can, or this is not known yet). */
  helper: HelperGap | null;
  /** Sentry mode's "Restart if not unlocked" is Off. */
  restartOff: boolean;
  /** The main Auto reboot in Security is Off. Only a note: Sentry's restart does not depend on it. */
  autoRebootOff: boolean;
  /** FileVault is off on this Mac (sentry-real-lock, the developer 12 Nov 2026: "unbruteforcible, like encryption"). Without it
   *  the restart to BFU protects nothing: the disk can be read from Recovery or another Mac without the password. Only
   *  a definite "off" counts; "unknown" never warns. PS only reads it and links to System Settings, never changes it. */
  fileVaultOff: boolean;
}
/** The warning is about the restart (the helper or the restart setting), not only FileVault. */
export const restartGap = (c: RestartCheck): boolean => !!c.helper || c.restartOff;
/** null: the restart will work and the disk is encrypted, engage with no extra step. */
export function restartCheck(reboot: RestartFacts | null | undefined, restartH: number): RestartCheck | null {
  let helper: HelperGap | null = null;
  const h = reboot?.helper;
  if (h === "off") helper = "notSetUp";
  else if (h === "approve") helper = "needsOk";
  else if (h === "missing") helper = "missing";
  else if (h === "on") helper = reboot?.error ? "notAnswering" : reboot?.helperOld ? "older" : null;   // "test" and not known yet: fine
  const restartOff = restartH === 0;
  const fileVaultOff = reboot?.fileVault === "off";
  if (!helper && !restartOff && !fileVaultOff) return null;
  return { helper, restartOff, autoRebootOff: reboot?.mode === "off", fileVaultOff };
}
/** A helper gap the person can fix by setting it up (Security shows the steps); "older" and "missing" fix themselves
 *  (the next restart of this Mac) or cannot be fixed here. */
export const helperFixable = (g: HelperGap | null): boolean => g === "notSetUp" || g === "needsOk" || g === "notAnswering";

// V1.54 (helper-check-154). The developer, 12 Nov 2026: "despite just allowing the restart helper in settings, when I went into
// Sentry mode, it popped up saying I have no restart helper enabled, then went to PS app settings and it was active..
// Then went back to the Sentry and it suddenly worked again??" The button read what the Mac remembered, not the helper
// at that moment (a miss from while it was off outlived the switch on; opening Security asked fresh, so that "fixed"
// it). Now the button first asks the Mac to check the helper fresh (ps-mac HelperCheckCore.swift: macOS and the helper
// itself, trying again for a few seconds before it says off) and decides on that answer.
export const HELPER_CHECK = {
  /** The page's own limit, seconds (ps-mac HelperCheckCore.pageWait): longer than the Mac's longest check. */
  waitS: 10,
  /** The button's small line while it checks. */
  words: "Checking the restart helper",
} as const;
/** This Mac can check the helper fresh. An older PS app on the Mac: the button decides as before. */
export const checksFresh = (r: RestartFacts | null | undefined): boolean => r?.checks === 1;
/** A fresh check id (only has to differ from the last one on this page). */
export const checkId = (now: number, rnd: number): string => `c${now.toString(36)}${Math.floor(rnd * 1e6).toString(36)}`;
/** Asks the Mac for a fresh check and gives back the restart facts once the Mac says that check finished, or what it
 *  has after HELPER_CHECK.waitS (the Mac stopped answering: decide on what is known, as before). Never throws. */
export function freshHelperCheck(io: {
  id: string; post: (m: { type: "reboot:check"; id: string }) => void; now: () => RestartFacts | null | undefined;
  listen: (f: () => void) => () => void; later: (f: () => void, ms: number) => unknown; waitS?: number;
}): Promise<RestartFacts | null | undefined> {
  return new Promise((resolve) => {
    let over = false;
    let stop = (): void => {};
    const end = () => { if (over) return; over = true; stop(); resolve(io.now()); };
    stop = io.listen(() => { if (io.now()?.checked === io.id) end(); });
    io.later(end, (io.waitS ?? HELPER_CHECK.waitS) * 1000);
    io.post({ type: "reboot:check", id: io.id });
  });
}

/** The restart a person gets from "Turn on restart": the default. */
export const RESTART_ON_HOURS = SENTRY_DEFAULTS.restartH;
/** V1.52: "Turn on restart" from the sleep screen sets the Sleep mode time to its default. */
export const RESTART_ON_SLEEP_HOURS = SENTRY_DEFAULTS.restartSleepH;

export const RESTART_WARN = {
  title: "Auto restart is off",
  consequence: "If this Mac is taken while in Sentry mode, it will not restart into its locked state.",
  helper: {
    notSetUp: "The restart helper is not set up on this Mac.",
    needsOk: "The restart helper is switched off in System Settings.",
    notAnswering: "The restart helper is on, but it is not answering.",
    older: "The restart helper on this Mac is from an older PS app. It updates the next time this Mac restarts.",
    missing: "This copy of PS app has no restart helper.",
  } satisfies Record<HelperGap, string>,
  restartOff: "Restart if not unlocked is set to Off.",
  restartSleepOff: "Restart if not unlocked during Sleep mode is set to Off.",
  autoRebootOff: "Auto reboot in Security is off too.",
  // sentry-real-lock: FileVault off. The developer sees these exact words before release.
  fileVaultTitle: "FileVault is off",
  fileVault: "FileVault is off, so this Mac's disk is not encrypted. Someone who takes it could read your files without your password.",
  openFileVault: "Open FileVault settings",
  setUpHelper: "Set up the helper",
  turnOn: "Turn on restart",
  engageAnyway: "Engage anyway",
  cancel: "Cancel",
} as const;
/** The warning's title: the restart first (it was there first), else FileVault. */
export const checkTitle = (c: RestartCheck): string => restartGap(c) ? RESTART_WARN.title : RESTART_WARN.fileVaultTitle;
/** The lines the warning shows, in order: why, the main Auto reboot note, what it means, then FileVault. The restart's
 *  lines only when the restart is the problem (FileVault alone shows just its own line). */
export function restartWarnLines(c: RestartCheck): string[] {
  const out: string[] = [];
  if (c.helper) out.push(RESTART_WARN.helper[c.helper]);
  if (c.restartOff) out.push(RESTART_WARN.restartOff);
  if (restartGap(c)) {
    if (c.autoRebootOff) out.push(RESTART_WARN.autoRebootOff);
    out.push(RESTART_WARN.consequence);
  }
  if (c.fileVaultOff) out.push(RESTART_WARN.fileVault);
  return out;
}
/** System Settings, Privacy and Security, FileVault (the Mac opens it; PS never switches FileVault on or off). */
export const FILEVAULT_PANE = "x-apple.systempreferences:com.apple.preference.security?FileVault";

// ---------- V1.54 (the developer, 12 Nov 2026; lid-notice-154): the lid row of the pop up before engaging ----------
// "before you even engage sentry mode it should come up saying that. And you should be able to fix it before you
// actually [start] the sentry mode basically." With Keep awake with the lid closed on, pressing AI first asks the Mac
// whether it really works (sentry:lidCheck: the restart helper turns it on and straight back off, retried for a few
// seconds, ps-mac SentryLid.probe). A gap adds a lid line under the restart check's lines, or shows a pop up of its own,
// with Set up the helper (it also starts a fresh helper after an update), Engage anyway and Cancel. The Sentry screen
// never shows lid text; a stop during Sentry mode is told once in the Tab list after the unlock (noteFor).
// Kept apart from the restart check above (helper-check-154 changes that one).

/** What the Mac's check found: the helper is not on (not set up, switched off, not answering), or macOS said no. */
export type LidGap = "helper" | "refused";
export const okLidGap = (v: unknown): LidGap | null => (v === "helper" || v === "refused" ? v : null);
/** The developer sees these exact words before release (no em or en dashes). The Mac has the same (SleepSentryRules.words). */
export const LID_WARN = {
  title: "Your Mac will sleep when the lid is closed",
  helper: "Keeping your Mac awake with the lid closed needs the restart helper, and it is not on.",
  refused: "macOS did not let the restart helper keep your Mac awake with the lid closed. Setting the helper up again usually fixes it.",
  setUp: "Set up the helper",
  anyway: "Engage anyway",
  cancel: "Cancel",
} as const;
export const lidLine = (g: LidGap): string => (g === "helper" ? LID_WARN.helper : LID_WARN.refused);
/** How long the page waits for the Mac's answer (the Mac takes 5 s at most, a little more if the helper is silent).
 *  No answer (an older Mac side): no lid row, so the button never sticks. */
export const LID_CHECK_WAIT_MS = 12000;
/** What the pop up before engaging holds. Null: nothing to say, engage at once. The lid row only with the lid on. */
export interface PreEngage { restart: RestartCheck | null; lid: LidGap | null }
export function preEngage(restart: RestartCheck | null, lidOn: boolean, gap: LidGap | null): PreEngage | null {
  const lid = lidOn ? gap : null;
  return restart || lid ? { restart, lid } : null;
}
/** Its title: the restart check's when that shows, else the lid's own. */
export const preEngageTitle = (w: PreEngage): string => (w.restart ? checkTitle(w.restart) : LID_WARN.title);
/** Its lines: the restart check's, then the lid line last. */
export const preEngageLines = (w: PreEngage): string[] => [...(w.restart ? restartWarnLines(w.restart) : []), ...(w.lid ? [lidLine(w.lid)] : [])];
/** Set up the helper shows for a helper gap of the restart check, or any lid gap. */
export const preEngageSetUp = (w: PreEngage): boolean => (w.restart ? helperFixable(w.restart.helper) : false) || !!w.lid;

// ---------- V1.52 (the developer, 12 Nov 2026): AI Sentry mode from Sleep mode ----------
// "when you've engaged the sleep mode ... there's a little AI Sentry mode button ... that button will turn into the
// Protected by PS shield symbol as well and then activate the AI Sentry mode with sleep mode engaged."
// The Mac's sleep screen (ps-mac SleepScreen.swift, SleepSentry.swift) draws a small button (where: the Sleep look's
// `sentry`, core/sleepmode.ts). Pressing it puts Sentry mode's protection UNDER Sleep mode: the clock, alarms and
// Wake up stay as they are; the Mac stays awake (on battery too, with Sentry's own battery stop), the lid option, the
// restart if not unlocked, the guard and leaving through the real lock screen all apply. The Mac cannot ask this page
// while the sleep screen is up, so the sleep plan carries everything it needs: the Sentry settings, the same restart
// check as the AI button (restartCheck), the heat warning when it was never seen, and the words.

/** Where the button sits on the sleep screen. Default: the left, half way up. */
export type SentrySpot = "left" | "right" | "bottomLeft" | "bottomRight" | "hidden";
export const SENTRY_SPOTS: SentrySpot[] = ["left", "right", "bottomLeft", "bottomRight", "hidden"];
export const SENTRY_SPOT_NAMES: Record<SentrySpot, string> = { left: "Left centre", right: "Right centre", bottomLeft: "Bottom left", bottomRight: "Bottom right", hidden: "Hidden" };
export const SENTRY_SPOT_DEF: SentrySpot = "left";
export const okSpot = (v: unknown): v is SentrySpot => (SENTRY_SPOTS as unknown[]).includes(v);
/** PS 1.65: the room (points, each side) the Mac's sleep screen keeps free for the AI Sentry mode button at the screen's edge: margin,
 *  button, a gap (the Mac's SleepRules.sentrySide). The Customise preview sizes a big clock with the same rule. */
export const SENTRY_SIDE = 28 + 210 + 24;
/** The widest the clock (share 94) or the analogue face (92) may be, in percent of the screen's width: the share, less the
 *  button's room on both sides, never under 40 (the Mac's SleepRules.roomWidth). */
export function clockRoomPct(widthPx: number, sidesPx: number, share: number): number {
  if (!(widthPx > 0)) return share;
  return Math.max(40, Math.min(share, 100 * (widthPx - 2 * Math.max(0, sidesPx)) / widthPx));
}
/** PS 1.65: the Sleep settings row that opts out of starting AI Sentry mode with Sleep mode (core/sleepsettings.ts has the same words). */
export const SLEEP_AUTO_NAME = "Start AI mode with Sleep mode";
export const SLEEP_AUTO_LINE = "On: AI Sentry mode turns on by itself with Sleep mode. It stops at 20 percent battery and never restarts your Mac.";
/** The setting's one line (Customise and Sleep mode's settings). */
export const SENTRY_SPOT_LINE = "On your Mac's sleep screen. Pressing it turns on Sentry mode under Sleep mode: your Mac stays awake and protected, and leaving opens its lock screen.";

/** Every sentence the sleep screen says about it (the Mac has the same as fallbacks; the test checks they match). */
export const SLEEP_SENTRY_WORDS = {
  button: "AI Sentry mode",
  on: "Protected by PS",
  tip: "AI Sentry mode: keeps your Mac awake and protected while you sleep. Leaving opens your Mac's lock screen.",
  hint: "Wake up and Esc open your Mac's lock screen. Touch ID or your password there ends Sleep mode and Sentry mode.",
  batteryStop: "On battery. Sentry mode keeps your Mac awake and locks it at {pct}%.",
  batteryOn: "On battery. Sentry mode keeps your Mac awake.",
  refusedProtected: "Sentry mode did not start: a protected app is in front.",
  refusedBattery: "Sentry mode did not start: the battery is under your stop level. Plug in first.",
  refusedNolock: "Sentry mode did not start: this macOS has no way for PS app to lock it.",
  refusedOther: "Sentry mode did not start.",
  // V1.54: the lid row (LID_WARN; the Mac checks the lid itself when the button is pressed)
  lidTitle: LID_WARN.title,
  lidHelper: LID_WARN.helper,
  lidRefused: LID_WARN.refused,
  lidSetUp: LID_WARN.setUp,
  lidAnyway: LID_WARN.anyway,
  lidCancel: LID_WARN.cancel,
} as const;

/** The restart check as the sleep screen draws it: each line on its own, so the Mac can drop the restart line after
 *  Turn on restart (and engage at once when nothing else is missing, as the AI button does). */
export interface SleepSentryCheck {
  title: string; helper: string | null; restartOff: string | null; autoOff: string | null; consequence: string;
  /** sentry-real-lock: FileVault off (its line), and the title the Mac uses once only FileVault is left. */
  fileVault: string | null; fileVaultTitle: string;
  fixHelper: boolean; setUp: string; turnOn: string; anyway: string; cancel: string;
}
export interface SleepSentry {
  /** restartH here is the Sleep mode time (restartSleepH): the helper deadline is armed with it. */
  plan: SentryPlan;
  /** Null: the restart to BFU will work, engage with no extra step. */
  check: SleepSentryCheck | null;
  words: typeof SLEEP_SENTRY_WORDS;
  /** "Turn on restart" sets the Sleep mode time to this many hours (RESTART_ON_SLEEP_HOURS). */
  restartOn: number;
  /** PS 1.65: the Mac starts Sentry mode by itself when the sleep screen comes up (false: only the button does). */
  auto: boolean;
  /** PS 1.65: the person switched the lid on themselves (lidSet), so a Sentry mode that started by itself may keep a closed Mac
   *  awake. False: the default lid never does on an automatic start. */
  autoLid: boolean;
}
export function sleepSentry(p: SentryPrefs, reboot: RestartFacts | null | undefined): SleepSentry {
  const c = restartCheck(reboot, p.restartSleepH);
  return {
    plan: { ...planOf(p), restartH: p.restartSleepH },
    check: c ? {
      title: checkTitle(c),
      helper: c.helper ? RESTART_WARN.helper[c.helper] : null,
      restartOff: c.restartOff ? RESTART_WARN.restartSleepOff : null,
      autoOff: c.autoRebootOff && restartGap(c) ? RESTART_WARN.autoRebootOff : null,
      consequence: restartGap(c) ? RESTART_WARN.consequence : "",
      fileVault: c.fileVaultOff ? RESTART_WARN.fileVault : null,
      fileVaultTitle: RESTART_WARN.fileVaultTitle,
      fixHelper: helperFixable(c.helper),
      setUp: RESTART_WARN.setUpHelper, turnOn: RESTART_WARN.turnOn, anyway: RESTART_WARN.engageAnyway, cancel: RESTART_WARN.cancel,
    } : null,
    words: SLEEP_SENTRY_WORDS,
    restartOn: RESTART_ON_SLEEP_HOURS,
    auto: p.sleepAuto,
    autoLid: p.lidSet && p.lid,
  };
}
/** The lines the sleep screen's warning shows, in the same order as restartWarnLines. */
export const sleepCheckLines = (c: SleepSentryCheck): string[] => [c.helper, c.restartOff, c.autoOff, c.consequence, c.fileVault].filter((x): x is string => !!x);

/** The plain sentence after the Mac said no, or stopped Sentry mode. Null: nothing to say. */
export function noteFor(m: { refused?: unknown; stopped?: unknown; lid?: unknown }): string | null {
  if (m.refused === "protected") return "Sentry mode did not start: a protected app is in front.";
  if (m.refused === "battery") return "Sentry mode did not start: the battery is under your stop level. Plug in first.";
  if (m.refused === "screen") return "Sentry mode did not start: PS app could not find a screen to cover.";
  if (m.refused === "nolock") return "Sentry mode did not start: this macOS has no way for PS app to lock it.";
  if (m.stopped === "battery") return "Sentry mode stopped at your battery level, and your Mac locked.";
  // V1.54: the Mac sends the lid code with the end of Sentry mode (never text on the Sentry screen), so this is read
  // after the unlock. lidNote has the words.
  const lid = lidNote(m.lid);
  if (lid) return lid;
  return null;
}

/** V1.54: a stop of the lid keep awake during Sentry mode, said once after the unlock (null: none, or an unknown code). */
export function lidNote(code: unknown): string | null {
  const w = "While Sentry mode was on, keeping your Mac awake with the lid closed stopped";
  if (code === "batteryLow") return `${w}: the battery got low.`;
  if (code === "tooHot") return `${w}: your Mac got too hot.`;
  if (code === "helperMissing") return `${w}: the restart helper was not on. Set it up in Security.`;
  if (code === "refused") return `${w}: macOS did not let the restart helper keep it awake. Setting the helper up again in Security usually fixes it.`;
  if (code === "other") return `${w}.`;
  return null;
}

/** The Mac's state, checked (window.__psSentry). phase: off, covered (the PS cover is up), locked (the Mac is on its
 *  lock screen with the keep awake still on; unlocking ends it). */
export type SentryPhase = "off" | "covered" | "locked";
export interface SentryState { phase: SentryPhase; since: number | null; note: string | null }
export function stateOf(v: unknown): SentryState {
  const m = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const phase: SentryPhase = m.phase === "covered" || m.phase === "locked" ? m.phase : "off";
  const since = Number(m.since);
  return { phase, since: phase !== "off" && Number.isFinite(since) && since > 0 ? since : null, note: noteFor(m) };
}

/** The Mac side's numbers (ps-mac Sentry.swift SentryRules has the same; the test checks they match). */
export const MAC = {
  /** Seconds for the Dim Screen fade down, and back up when the pointer leaves the button. sentry-real-lock (the developer):
   *  dark is completely black (nothing lit, the button and the pointer hidden too), and both fades are quicker. */
  dimFadeS: 0.35,
  undimFadeS: 0.2,
  /** How often the battery is read, seconds. */
  powerEveryS: 30,
} as const;

/** V1.49 (the developer, 12 Nov 2026: the restart helper must never be off without the owner knowing): the Mac shows its
 *  "Your restart helper is off" pop up whenever auto reboot OR Sentry mode's restart if not unlocked is on. Only the
 *  page knows the Sentry setting, so src/sentryprefs.ts sends this to the Mac as {type:"sentryPrefs", restartH}
 *  (ps-mac HelperAlert.swift). 0 is Off. */
/** V1.52: either restart on means the helper is wanted (the Mac only checks for more than 0), so the larger one goes. */
export const sentryPrefsMsg = (st: { sentry?: unknown } | null | undefined): { restartH: number } => {
  const p = sentryOf(st);
  return { restartH: Math.max(p.restartH, p.restartSleepH) };
};
