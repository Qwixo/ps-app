// The setup menu. V1.40 (the G Squad release) walked through every setting, about 50 cards. V1.43, the developer 8 Nov 2026:
// "instead of having 50 steps, simplify it. Obviously you don't need to go through each appearance option, so just
// direct the user to the appearance options in settings where they can change their appearance."
// So it is now the few things a new or updating person must decide, each short and plain: the Mac permissions and
// why, Do Not Disturb, auto reboot, sign in and sync, G Squad sharing and Fitness, then ONE Appearance card with a
// button that opens Settings, Looks. Every other setting stays where it lives, in Settings.
//
// Pure: the cards and their words, where each lives (for the preview's walk), what each choice starts at, the
// progress bar, what Create sends, and when the menu offers itself. tests/welcome.test.ts runs it; the panel is
// views/Welcome.tsx, the preview views/MiniPs.tsx.
//
// Rules: only what runs for every account (nothing the developer only). Each choice starts at what it is set to now (a fresh
// install: its default), so Create with nothing touched changes nothing. Skip leaves a card as it is. Create sends
// only what differs (plus anything PS had not told us yet), the vault settings in one write. Mac permissions and the
// G Squad switches take effect the moment they are used (they always did in their own places too).

// ---------- where things live (the preview) ----------
export type Anchor = "island" | "clock" | "glass" | "net" | "mixer" | "gear" | "tab" | "lock" | "padlock" | "squad" | "moon" | "zones" | "meetings"
  | "dimx" | "fitness" | "add" | "list" | "completed" | "notes" | "overdue" | "screen";
export interface Sheet { kind: "settings" | "security" | "dnd" | "macos" | "panel"; title: string; tab?: string; rows: string[]; row: number }
/** Where a setting lives: the button to click, and the screen it opens with the row that glows. `text` says it in words. */
export interface Where { at: Anchor; sheet?: Sheet; text: string }

const LOOKROWS = ["Appearance", "Accent", "Working on", "Layout and text", "Outline", "Background", "Rain"];
const SEC_ROWS = ["Auto reboot on this Mac", "Are you sure", "Signing in on this Mac"];
const W_MAC = (title: string, rows: string[], row: number, text: string): Where => ({ at: "screen", sheet: { kind: "macos", title, rows, row }, text });

// ---------- the Mac permissions ----------
export type PermId = "ax" | "calendar" | "audio" | "reboot";
export interface Perm {
  title: string;
  /** What macOS will show. */
  asks: string;
  /** Why the app needs it, and the feature it powers. */
  why: string;
  /** What the app never does with it (and, truthfully, how wide macOS makes it). */
  never: string;
  /** What stops working without it. */
  ifNo: string;
  button: string;
  where: Where;
}
export const PERMS: Record<PermId, Perm> = {
  ax: {
    title: "Let {app} notice when you hold Tab",
    asks: "macOS asks you to switch {app} on in System Settings, Privacy and Security, Accessibility.",
    why: "It is what lets your list float over any app when you hold Tab.",
    never: "macOS lets {app} see every key, so each key goes past it. It only acts on Tab, Esc, Right Option and / with . and lets the rest straight through. It never saves or sends what you type, and it stands aside while 1Password or Signal is in front.",
    ifNo: "Holding Tab does nothing outside {app}. This one is needed.",
    button: "Open System Settings",
    where: W_MAC("Accessibility", ["{app}", "Other apps"], 0, "System Settings, Privacy and Security, Accessibility."),
  },
  calendar: {
    title: "Your meetings from the Calendar app",
    asks: "macOS asks once, only when you press Allow, for full access to your calendars.",
    why: "So Coming up and the meeting alerts show your meetings, Google or Outlook ones too if they are in the Calendar app.",
    never: "macOS has no read only choice, but {app} only reads: it never adds, changes or deletes an event. It reads today and the next 7 days and keeps them encrypted in your vault.",
    ifNo: "Coming up stays empty and there are no meeting alerts.",
    button: "Allow Calendar",
    where: W_MAC("Calendars", ["{app}", "Other apps"], 0, "System Settings, Privacy and Security, Calendars."),
  },
  audio: {
    title: "The volume mixer",
    asks: "macOS asks you to allow {app} under Screen and System Audio Recording. Pick System Audio Recording Only.",
    why: "So the mixer (the sliders button at the top right of your list) can turn one app up, down or off on its own.",
    never: "Nothing is recorded, saved or sent. macOS gives this access to all the sound on your Mac, but {app} only touches an app when you move its slider.",
    ifNo: "The mixer shows what is playing but cannot change it.",
    button: "Allow the mixer",
    where: W_MAC("Screen and System Audio Recording", ["{app}", "Other apps"], 0, "System Settings, Privacy and Security, Screen and System Audio Recording."),
  },
  reboot: {
    title: "Allow the restart helper",
    asks: "macOS asks you to switch {app} on in System Settings, General, Login Items and Extensions, under Allow in the Background. If it already looks on, switch it off and then on again.",
    why: "Restarting a locked Mac needs a small helper that runs as the system itself, even while {app} is closed.",
    never: "It does one job: when the timer ends while this Mac is locked, it restarts it. It never restarts a Mac you are using. That is a lot of power, so you can remove it any time in Security.",
    ifNo: "Auto reboot cannot run. Nothing else changes.",
    button: "Set up the helper",
    where: W_MAC("Login Items and Extensions", ["{app}", "Other apps"], 0, "System Settings, General, Login Items and Extensions, Allow in the Background."),
  },
};
export const PERM_WORDS = {
  label: "macOS will ask",
  why: "Why",
  never: "What it never does",
  ifNo: "If you say no",
  done: "Done. macOS says yes.",
  waiting: "Waiting for you in System Settings. Switch {app} on there, then come back.",
  waitingHelper: "Waiting for you in System Settings. Find {app} under Allow in the Background and switch it on. If it already looks on, switch it off and then on again. Then come back.",
  denied: "macOS says no for now. You can switch it on in System Settings any time.",
  missing: "Not in this version of {app}.",
  fileVault: "FileVault is off. Without it a restart does not lock your disk: turn it on in System Settings, Privacy and Security.",
  passwordLater: "Your Mac does not ask for your password straight away after sleep, so a sleeping Mac may never count as locked. Set it to Immediately in System Settings, Lock Screen.",
} as const;

// ---------- the cards ----------
export type ChoiceValue = string | number | boolean;
export type FitPeekKind = "intro" | "rest" | "restSmall" | "sets" | "style" | "theme" | "gym";
export interface TourCard {
  id: string;
  section: string;
  title: string;
  what: string;
  /** On/off cards: what happens either way. */
  ifOn?: string;
  ifOff?: string;
  /** No setting to switch on this card (it explains, gives permissions, or opens a place). */
  info?: boolean;
  note?: string;
  where: Where;
  /** A Mac permission to give right here. `on`: only while the switch is On. */
  perm?: PermId;
  permWhen?: "always" | "on";
  /** Optional permissions, each in a short box of its own. */
  perms?: PermId[];
  /** The G Squad sharing switches (they save at once, like in G Squad itself). */
  share?: boolean;
  /** Local first (V1.44): where the list lives, with Turn on sync (views/LocalFirst.tsx StoreBox). */
  store?: boolean;
  /** A button that saves what was picked and opens this Settings tab. */
  open?: "looks";
  /** A small live Fitness screen (views/FitPeek.tsx). */
  fit?: FitPeekKind;
  /** The switch's name on the summary, when the title says more than the switch does. */
  sumTitle?: string;
}

export const TOUR_CARDS: readonly TourCard[] = [
  // ----- Mac permissions -----
  { id: "tabOver", section: "Mac permissions", title: "Hold Tab over any app", info: true, perm: "ax", permWhen: "always",
    what: "Hold Tab in any app and your list floats over it. Let go and it goes away. A quick tap still types a Tab.",
    where: { at: "screen", text: "Hold Tab anywhere." } },
  { id: "morePerms", section: "Mac permissions", title: "Calendar and sound", info: true, perms: ["calendar", "audio"],
    what: "Two optional permissions. Each one only adds a feature, so say yes now, later, or never.",
    where: W_MAC("Privacy and Security", ["Calendars", "Screen and System Audio Recording"], 0, "System Settings, Privacy and Security. Change them there any time.") },

  // ----- quiet and safe -----
  { id: "dnd", section: "Quiet and safe", title: "Do Not Disturb",
    what: "A quiet mode for {app}. One click on the moon at the very top right of your list turns it on.",
    ifOn: "Pop-ups, meeting cards and their sounds wait. Nothing is lost: they show when you turn it off. Click the moon again to pick how long and what still gets through.",
    ifOff: "Everything shows as it comes in.",
    note: "It never changes your Mac's own Focus settings.",
    where: { at: "moon", sheet: { kind: "dnd", title: "Do Not Disturb", rows: ["1 hour", "Until tomorrow at 8:00", "Until I turn it off", "What still gets through"], row: 0 }, text: "The moon at the very top right of your list." } },
  { id: "reboot", section: "Quiet and safe", title: "Auto reboot (BFU)", perm: "reboot", permWhen: "on",
    what: "Right after a restart your Mac's disk stays locked until you type your password: BFU, before first unlock. Once unlocked it is AFU, after first unlock, and your files sit open in memory even behind the lock screen.",
    ifOn: "If this Mac stays locked for the time you choose (18 hours to start), it restarts by itself, back to BFU. The timer only counts while the Mac is locked or asleep, and it never restarts a Mac you are using. Anything not saved is lost.",
    ifOff: "Your Mac only restarts when you restart it.",
    note: "There is no warning on this Mac first, because it is locked: save your work before you walk away. It needs FileVault on.",
    where: { at: "padlock", sheet: { kind: "security", title: "Security", rows: SEC_ROWS, row: 0 }, text: "The padlock at the top right of your list, then Auto reboot on this Mac." } },

  // ----- your account -----
  { id: "account", section: "Your account", title: "Sign in and sync", info: true,
    what: "Your list is encrypted on this Mac with your passphrase before it is saved, so only you can read it. Sign in to the same account on your phone or another Mac and everything stays in sync.",
    note: "Lock at the top right locks it. With Remember me on, Touch ID opens it again. Nobody can reset your passphrase, so keep your recovery key somewhere safe.",
    where: { at: "lock", text: "Lock, at the top right of your list." } },

  // ----- G Squad -----
  { id: "squad", section: "G Squad", title: "G Squad sharing", info: true, share: true,
    what: "G Squad is a small group of friends who keep each other going: see who is working, share tasks and compare. Everything shared is end to end encrypted. Pick what your squad can see.",
    note: "Tasks start off: switch Tasks on, then pick each task you want seen with Share with G Squad (in Add task or the right click menu). These switches save straight away. They are also in G Squad, under What you share.",
    where: { at: "squad", text: "The G Squad button (three heads) at the top right of your list." } },

  // ----- Fitness -----
  { id: "gym", section: "Fitness", title: "Fitness and the gym reminder", sumTitle: "Gym reminder", fit: "intro",
    what: "A workout tracker in your list: plans, sets, a rest timer and a week goal. Rest times, sets and its colours are in Fitness, Settings. The switch below is the gym reminder.",
    ifOn: "A card on your Mac reminds you 2 hours, 1 hour, 30 minutes and 10 minutes before gym time (8am every day until you change it in Fitness, Settings).",
    ifOff: "No gym reminders. Fitness still works.",
    where: { at: "fitness", text: "The dumbbell at the bottom left of your list." } },

  // ----- appearance: one card, the choices themselves are in Settings, Looks -----
  { id: "appearance", section: "Appearance", title: "Make it look your way", info: true, open: "looks",
    what: "Looks, accent colours, backgrounds, rain and more are in Settings, Appearance. Every choice has a picture that changes as you pick, and a Preview that shows it on your list first.",
    note: "Open Appearance saves what you picked here and takes you there.",
    where: { at: "gear", sheet: { kind: "settings", title: "Settings", tab: "Appearance", rows: LOOKROWS.slice(0, 6), row: 0 }, text: "The gear at the top right of your list, then Settings, Appearance." } },
];

export const TOUR_WORDS = {
  introEyebrow: "Welcome to {app}",
  introTitle: "Let's set {app} up",
  introBody: "A few quick steps through what matters most: the Mac permissions and why, Do Not Disturb, auto reboot, your account, G Squad and Fitness. Everything is optional. Your choices are saved when you press Create at the end; macOS permissions and G Squad sharing take effect straight away.",
  introExamples: "Your list has a few example tasks. You can delete them all at the end, or later in Settings, About and updates.",
  updateEyebrow: "{app} {version} is here",
  updateTitle: "A quick setup, just what matters",
  updateBody: "A few short steps: the Mac permissions and why, Do Not Disturb, auto reboot, your account, G Squad and Fitness. Nothing changes until you press Create at the end, except macOS permissions and G Squad sharing.",
  start: "Start",
  startUpdate: "Show me",
  later: "Not now",
  laterNote: "You can open it any time from Settings, About and updates, Setup menu.",
  labelWhat: "What it is",
  labelOn: "If on",
  labelOff: "If off",
  labelWhere: "Where it lives",
  on: "On",
  off: "Off",
  openLooks: "Open Appearance",
  back: "Back",
  next: "Next",
  skip: "Skip",
  skipTitle: "Leave this one as it is",
  toEnd: "Skip to the end",
  summaryEyebrow: "All done",
  summaryTitle: "Ready to go",
  summaryBody: "Here is what you picked. Press Create and {app} sets it up. Click a line to go back to it.",
  summaryNote: "Everything else, and how it all looks, is in Settings. Open this menu again from Settings, About and updates.",
  changed: "changed",
  create: "Create",
  creating: "Setting up",
  created: "All set. Enjoy {app}.",
  entryTitle: "Setup menu",
  entrySub: "The few settings that matter, in plain words",
} as const;

/** The words inside the small Fitness screen on the Fitness card (views/FitPeek.tsx). */
export const FIT_PEEK_WORDS = {
  big: "Bench press",
  small: "Curls",
  set: "Set {n} of {of}",
  rest: "Rest",
  kg: "kg",
  reps: "reps",
  finish: "Finish exercise",
  skipped: "Done with {n} of {of}. The rest are left out.",
  light: "Light",
  dark: "Dark",
} as const;

export const progressWords = (p: { pct: number; left: number }) => ({ done: `${p.pct}% done`, left: p.left === 1 ? "1 left" : `${p.left} left` });
/** "{app}" in the words is the app's own name (core/appname.ts); "{version}" the version, filled in when shown. */
export const fillApp = (s: string, app: string, version = "") => s.split("{app}").join(app).split("{version}").join(version);

// ---------- what each choice is now, and its default ----------
export type TourNow = Record<string, ChoiceValue | undefined>;
export type Choices = Record<string, ChoiceValue>;
const isChoice = (c: TourCard) => !c.info;

/** A fresh install's setting for each choice card, used while PS has not told us (ps-mac and core/gym.ts defaults). */
export const TOUR_DEFAULTS: Record<string, ChoiceValue> = { dnd: false, reboot: false, gym: false };

/** The cards for this account: the Calendar permission not on the developer's (his meetings come from his own feed, ps-mac
 *  LocalCalendar.swift never asks there). */
export function tourDeck(have: { red?: boolean; local?: boolean } = {}): TourCard[] {
  return TOUR_CARDS.map((c) => (c.perms && have.red ? { ...c, perms: c.perms.filter((p) => p !== "calendar") } : c))
    .map((c) => (c.id === "account" && have.local && !have.red ? LOCAL_ACCOUNT : c));
}
/** The account card while the list lives only on this Mac (local first, V1.44): where it is, and the way to sync. */
export const LOCAL_ACCOUNT: TourCard = {
  id: "account", section: "Your account", title: "Where your list lives", info: true, store: true,
  what: "Your list is encrypted and kept only on this Mac. No account and no Supabase: everything that does not need a server works.",
  note: "Turn on sync to have your list on your phone and your other Macs too. PS moves everything into a free Supabase project of your own, encrypted, and checks every record arrived before it switches over. Nothing is lost.",
  where: { at: "list", text: "Settings, Sync and account, or the line under your list's headline." },
};
/** The optional permissions a card shows. */
export const cardPerms = (c: TourCard): PermId[] => c.perms ?? [];

/** Each choice's starting point: what it is now, else its default. */
export function startChoices(deck: readonly TourCard[], now: TourNow): Choices {
  const o: Choices = {};
  for (const c of deck) if (isChoice(c)) o[c.id] = now[c.id] !== undefined ? now[c.id]! : TOUR_DEFAULTS[c.id];
  return o;
}

/** The label of a choice as the summary shows it. */
export function choiceLabel(_c: TourCard, v: ChoiceValue): string {
  return v ? TOUR_WORDS.on : TOUR_WORDS.off;
}

// ---------- steps and progress ----------
/** 0 is the welcome, 1..n the cards, n+1 the summary. */
export const lastStep = (deck: readonly TourCard[]) => deck.length + 1;
export const clampStep = (step: number, deck: readonly TourCard[]) => Math.max(0, Math.min(lastStep(deck), Math.round(step) || 0));
export function tourProgress(step: number, deck: readonly TourCard[]): { pct: number; left: number } {
  const n = deck.length;
  if (!n) return { pct: 100, left: 0 };
  const s = clampStep(step, deck);
  const passed = Math.max(0, Math.min(n, s - 1));
  return { pct: Math.round((passed / n) * 100), left: s === 0 ? n : n - passed };
}
/** The section a step is in, and which of its cards (for the line above the title: "Mac permissions, 1 of 2"). */
export function sectionAt(step: number, deck: readonly TourCard[]): { name: string; i: number; of: number } | null {
  const c = deck[clampStep(step, deck) - 1];
  if (!c) return null;
  const same = deck.filter((x) => x.section === c.section);
  return { name: c.section, i: same.indexOf(c) + 1, of: same.length };
}

// ---------- Create ----------
export interface TourContext {
  gym: { on: boolean };
}
export type TourOp =
  | { to: "native"; msg: Record<string, unknown> }
  | { to: "looks"; patch: Record<string, unknown> }
  | { to: "dnd"; on: boolean };

const NATIVE: Record<string, (v: ChoiceValue) => Record<string, unknown>> = {
  reboot: (on) => ({ type: "reboot:set", mode: on ? "active" : "off" }),
};

/** What Create sends: a choice that moved, or one whose real setting was not known. Vault settings go in ONE write
 *  together with `done`; each Mac setting its own message. */
export function tourPlan(deck: readonly TourCard[], now: TourNow, choices: Choices, ctx: TourContext, done: string): TourOp[] {
  const ops: TourOp[] = [];
  const looks: Record<string, unknown> = {};
  const val = (id: string) => (choices[id] !== undefined ? choices[id] : now[id] !== undefined ? now[id]! : TOUR_DEFAULTS[id]);
  for (const c of deck) {
    if (!isChoice(c)) continue;
    const v = val(c.id);
    if (now[c.id] !== undefined && now[c.id] === v) continue;
    if (NATIVE[c.id]) { ops.push({ to: "native", msg: NATIVE[c.id](v) }); continue; }
    if (c.id === "gym") looks.gym = { ...ctx.gym, on: v };
    else if (c.id === "dnd") ops.push({ to: "dnd", on: !!v });
  }
  looks.welcomeDone = done;
  ops.push({ to: "looks", patch: looks });
  return ops;
}
/** Not now, or closed with Esc: nothing changes, the menu is only marked as seen. */
export const tourSeenOnly = (done: string): TourOp[] => [{ to: "looks", patch: { welcomeDone: done } }];

// ---------- when it offers itself ----------
export const WELCOME_LOCAL_KEY = "ps.welcomeDone";
const SEEN = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
export const cleanWelcomeDone = (v: unknown): string | null => (typeof v === "string" && SEEN.test(v) && v.length <= 32 ? v : null);
/** Once on every account in PS on the Mac, after the first sync, never again after Create or Not now on any device.
 *  An account that ran an earlier version gets the update offer, a new one the welcome. */
export function welcomeStep(o: { ps: boolean; owner: boolean; synced: boolean; localDone: string | null | undefined; syncedDone: string | null | undefined }): "show" | "quiet" {
  if (!o.ps || !o.owner || !o.synced) return "quiet";
  if (cleanWelcomeDone(o.localDone) || cleanWelcomeDone(o.syncedDone)) return "quiet";
  return "show";
}

// ---------- PS's door after an update (src/setuphook.ts, ps-mac Updater.swift offerSetup) ----------
/** The setup menu's generation PS is told about ({type:"setup:can"}): PS offers "See what's new and set it up" once
 *  per generation after an update. 1 = the G Squad menu (V1.40); raise it when a later menu is worth offering again. */
export const SETUP_GEN = 1;
/** PS asked for the setup menu ("ps:open-setup"). Already on screen: it stays where it is (null). From the update
 *  card it opens as the update offer; from anywhere else as the menu. */
export function setupAsked(showing: boolean, from: unknown): { update: boolean } | null {
  if (showing) return null;
  return { update: from === "update" };
}

/** Every sentence the menu shows, in order (the no-dash and nothing-developer-only tests read this). */
export function tourCopy(): string[] {
  const out: string[] = [...Object.values(TOUR_WORDS), ...Object.values(PERM_WORDS), ...Object.values(FIT_PEEK_WORDS).map((t) => t.replace("{n}", "2").replace("{of}", "3"))];
  for (const p of Object.values(PERMS)) out.push(p.title, p.asks, p.why, p.never, p.ifNo, p.button, p.where.text, p.where.sheet?.title ?? "");
  for (const c of TOUR_CARDS) {
    out.push(c.section, c.title, c.what, c.where.text, c.sumTitle ?? "");
    for (const k of ["ifOn", "ifOff", "note"] as const) if (c[k]) out.push(c[k]!);
    if (c.where.sheet) out.push(c.where.sheet.title, ...c.where.sheet.rows);
  }
  return out.filter(Boolean);
}
