// Run: node --experimental-strip-types tests/welcome.test.ts
// The setup menu (V1.40, G Squad; cut to the few steps that matter in V1.43: core/welcome.ts, views/Welcome.tsx,
// views/MiniPs.tsx) and the setup screens' plain words (core/setupcopy.ts, ps-mac ui/supabase.html): 6 to 8 short cards
// that each say what it is and what happens on and off, and where it lives; Appearance is one card that opens
// Settings, Looks; choices start at what is set now; the progress bar adds up; Create sends only what changed (vault
// settings in one write); permissions are explained truthfully; it offers itself once on every account; nothing the developer
// only; no word has a long dash.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as W from "../src/core/welcome.ts";
import * as S from "../src/core/setupcopy.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const FULL = W.tourDeck();
const CH = FULL.filter((c) => !c.info);
const CTX: W.TourContext = { gym: { on: false } };
const DONE = "2026-11-07T12:00:00.000Z";
const nowAll = (): W.TourNow => Object.fromEntries(CH.map((c) => [c.id, W.TOUR_DEFAULTS[c.id]]));
const plan = (ch: W.Choices, now = nowAll(), ctx = CTX) => W.tourPlan(FULL, now, { ...W.startChoices(FULL, now), ...ch }, ctx, DONE);
const looksPatch = (ops: W.TourOp[]) => (ops.find((o) => o.to === "looks") as { patch: Record<string, unknown> }).patch;

// ---------- the cards (V1.43: the few that matter, the developer 8 Nov 2026) ----------
ok("a short menu: 6 to 9 cards, no more (PS 1.60 added the one Screen recording question)", () => {
  assert.ok(FULL.length >= 6 && FULL.length <= 9, `${FULL.length} cards`);
  assert.ok(W.tourDeck({ red: true }).length >= 6);
});
ok("the essentials, in this order: permissions, Do Not Disturb, auto reboot, sign in and sync, G Squad, Fitness, Appearance", () => {
  assert.deepEqual(FULL.map((c) => c.id), ["tabOver", "morePerms", "screenRec", "dnd", "reboot", "account", "squad", "gym", "appearance"]);
});
ok("ids are unique and every card says what it is and where it lives", () => {
  assert.equal(new Set(W.TOUR_CARDS.map((c) => c.id)).size, W.TOUR_CARDS.length);
  for (const c of W.TOUR_CARDS) { assert.ok(c.what.length > 10, c.id); assert.ok(c.where.text.length > 5, c.id); }
});
ok("every card is an On/Off with both If on and If off, or a card with nothing to switch", () => {
  for (const c of W.TOUR_CARDS) {
    assert.equal([!!c.ifOn, !!c.info].filter(Boolean).length, 1, c.id);
    if (c.ifOn) assert.ok(c.ifOff, `${c.id} says what happens when off`);
  }
});
ok("each card is short and plain: no sentence block over 60 words", () => {
  for (const c of W.TOUR_CARDS) for (const t of [c.what, c.ifOn, c.ifOff, c.note]) if (t) assert.ok(t.split(/\s+/).length <= 60, `${c.id}: ${t}`);
  for (const p of Object.values(W.PERMS)) for (const t of [p.asks, p.why, p.never, p.ifNo]) assert.ok(t.split(/\s+/).length <= 50, t);
});
ok("no appearance option cards: Appearance is ONE card with a button to Settings, Looks", () => {
  const ap = FULL.filter((c) => c.section === "Appearance");
  assert.equal(ap.length, 1);
  assert.equal(ap[0].open, "looks"); assert.ok(ap[0].info);
  assert.equal(ap[0].where.sheet?.tab, "Appearance");   // V1.43: the side menu group (core/settingsindex.ts)
  assert.equal(W.TOUR_WORDS.openLooks, "Open Appearance");
  for (const c of FULL) assert.ok(!("options" in c), `${c.id} has no option tiles`);
});
ok("no example task walkthrough cards (the delete stays on the summary and in Settings, About and updates)", () => {
  for (const c of FULL) assert.doesNotMatch(`${c.title} ${c.what}`, /example task/i, c.id);
  assert.match(src("views/Welcome.tsx"), /<ExamplesBox gone=\{exGone\}/);
  assert.match(src("views/SettingsGroups.tsx"), /<ExamplesEntry \/>/);   // V1.43: Settings, About and updates
});
ok("Hold Tab gives the Accessibility permission; Calendar and the mixer are optional, with Calendar not on the developer's account", () => {
  assert.equal(FULL[0].perm, "ax"); assert.equal(FULL[0].permWhen, "always");
  assert.deepEqual(W.cardPerms(FULL[1]), ["calendar", "audio"]);
  assert.deepEqual(W.cardPerms(W.tourDeck({ red: true })[1]), ["audio"]);
});
ok("Do Not Disturb points at the moon", () => {
  const c = FULL.find((x) => x.id === "dnd")!;
  assert.equal(c.where.at, "moon"); assert.match(c.what, /moon at the very top right/);
});
ok("auto reboot explains BFU and AFU, the timer, that it never restarts a Mac in use, and the risk", () => {
  const c = FULL.find((x) => x.id === "reboot")!;
  assert.match(c.what, /BFU, before first unlock/); assert.match(c.what, /AFU, after first unlock/);
  assert.match(c.ifOn!, /only counts while the Mac is locked or asleep/); assert.match(c.ifOn!, /never restarts a Mac you are using/);
  assert.match(c.ifOn!, /not saved is lost/); assert.match(c.note!, /no warning on this Mac/); assert.match(c.note!, /FileVault/);
  assert.equal(c.perm, "reboot"); assert.equal(c.permWhen, "on");
});
ok("sign in and sync: encrypted with the passphrase, syncs, nobody can reset it", () => {
  const c = FULL.find((x) => x.id === "account")!;
  assert.match(c.what, /encrypted on this Mac with your passphrase/); assert.match(c.what, /in sync/); assert.match(c.note!, /Nobody can reset your passphrase/);
});
ok("G Squad shows the real sharing switches and says they save at once", () => {
  const c = FULL.find((x) => x.id === "squad")!;
  assert.ok(c.share); assert.match(c.note!, /save straight away/); assert.match(c.note!, /What you share/);
  assert.match(src("views/Welcome.tsx"), /card\.share && <div className="wt-share"><SharingList \/><\/div>/);
});
ok("Fitness: the gym reminder switch with the small Fitness screen", () => {
  const c = FULL.find((x) => x.id === "gym")!;
  assert.equal(c.fit, "intro"); assert.equal(c.where.at, "fitness"); assert.equal(W.TOUR_DEFAULTS.gym, false);
  assert.equal(c.sumTitle, "Gym reminder", "the summary names the switch, not the whole card");
});
ok("every Mac permission says what macOS asks, why, what it never does, and what stops without it", () => {
  for (const [id, p] of Object.entries(W.PERMS)) for (const k of ["title", "asks", "why", "never", "ifNo", "button"] as const) assert.ok(p[k].length > 3, `${id}.${k}`);
  assert.match(W.PERMS.ax.never, /each key goes past/);          // honest: the tap sees every key
  assert.match(W.PERMS.calendar.never, /no read only choice/); assert.match(W.PERMS.calendar.asks, /only when you press Allow/);
  assert.match(W.PERMS.audio.never, /all the sound on your Mac/);
  assert.match(W.PERMS.reboot.never, /a lot of power/);
});
ok("nothing the developer only (the colour red is fine): no Claude, Gmail, Instantly, Second Computer, Numerology, rule book, AirPods, VPN or Telegram", () => {
  for (const t of W.tourCopy()) assert.doesNotMatch(t, /Claude|Gmail|Instantly|Second Computer|Numerology|rule book|AirPods|VPN|Telegram|Morning brief/i, t);
});
ok("no long dashes and nothing that looks like HTML in any word", () => {
  for (const t of [...W.tourCopy(), ...S.setupCopy()]) assert.doesNotMatch(t, /[\u2013\u2014<>]/, t);
});
ok("{app} and {version} are filled in", () => {
  assert.equal(W.fillApp(W.TOUR_WORDS.updateEyebrow, "G Squad", "1.43"), "G Squad 1.43 is here");
  assert.ok(W.tourCopy().every((t) => !W.fillApp(t, "G Squad", "1.43").includes("{")));
});
ok("every place the drawing points at exists", () => {
  const anchors = new Set(["island", "clock", "glass", "net", "mixer", "gear", "tab", "lock", "padlock", "squad", "moon", "zones", "meetings", "dimx", "fitness", "add", "list", "completed", "notes", "overdue", "screen"]);
  for (const c of W.TOUR_CARDS) {
    assert.ok(anchors.has(c.where.at), c.id);
    if (c.where.sheet) assert.ok(c.where.sheet.row >= 0 && c.where.sheet.row < c.where.sheet.rows.length, `${c.id} row`);
  }
  assert.match(src("views/MiniPs.tsx"), /squad: \{ x:/);
});

// ---------- choices start at what is set now ----------
ok("a choice starts at what it is now, else its default", () => {
  const c = W.startChoices(FULL, { reboot: true });
  assert.equal(c.reboot, true); assert.equal(c.dnd, false); assert.equal(c.gym, false);
  assert.ok(!("tabOver" in c) && !("appearance" in c));
});
ok("the summary says On or Off", () => {
  const dnd = FULL.find((c) => c.id === "dnd")!;
  assert.equal(W.choiceLabel(dnd, true), "On"); assert.equal(W.choiceLabel(dnd, false), "Off");
});

// ---------- progress ----------
ok("the welcome: 0% and every card left; the summary: 100% and 0 left", () => {
  assert.deepEqual(W.tourProgress(0, FULL), { pct: 0, left: FULL.length });
  assert.deepEqual(W.tourProgress(W.lastStep(FULL), FULL), { pct: 100, left: 0 });
});
ok("progress only goes up and left only goes down", () => {
  let p = -1, l = Infinity;
  for (let s = 0; s <= W.lastStep(FULL); s++) { const x = W.tourProgress(s, FULL); assert.ok(x.pct >= p && x.left <= l, `step ${s}`); p = x.pct; l = x.left; }
});
ok("the words: \"35% done\", \"5 left\", \"1 left\"; the section line", () => {
  assert.deepEqual(W.progressWords({ pct: 35, left: 5 }), { done: "35% done", left: "5 left" });
  assert.equal(W.progressWords({ pct: 90, left: 1 }).left, "1 left");
  assert.deepEqual(W.sectionAt(1, FULL), { name: "Mac permissions", i: 1, of: 2 });
  assert.equal(W.sectionAt(0, FULL), null);
});

// ---------- Create ----------
ok("Create with nothing touched only marks it done", () => { assert.deepEqual(plan({}), [{ to: "looks", patch: { welcomeDone: DONE } }]); });
ok("auto reboot PS has not reported is sent anyway", () => {
  const now = { ...nowAll(), reboot: undefined };
  const msgs = W.tourPlan(FULL, now, W.startChoices(FULL, now), CTX, DONE).filter((o) => o.to === "native").map((o) => (o as { msg: unknown }).msg);
  assert.deepEqual(msgs, [{ type: "reboot:set", mode: "off" }]);
});
ok("Do Not Disturb, auto reboot and the gym reminder: their own action, a message to PS, and the one vault write", () => {
  const ops = plan({ dnd: true, reboot: true, gym: true }, nowAll(), { gym: { on: false, at: "08:00" } as W.TourContext["gym"] });
  assert.deepEqual(ops, [
    { to: "dnd", on: true },
    { to: "native", msg: { type: "reboot:set", mode: "active" } },
    { to: "looks", patch: { gym: { on: true, at: "08:00" }, welcomeDone: DONE } },
  ]);
  assert.equal(ops.filter((o) => o.to === "looks").length, 1);
});
ok("Not now or Esc only mark it seen", () => { assert.deepEqual(W.tourSeenOnly(DONE), [{ to: "looks", patch: { welcomeDone: DONE } }]); });
ok("the Appearance button saves what was picked, then opens Settings, Looks", () => {
  const v = src("views/Welcome.tsx");
  assert.match(v, /close\(tourPlan\(deck, now, choices, ctx, new Date\(\)\.toISOString\(\)\), \(\) => openSettings\("looks"\)\)/);
});

// ---------- when it offers itself ----------
ok("once on every account in PS after the first sync, never again once done anywhere", () => {
  assert.equal(W.welcomeStep({ ps: true, owner: true, synced: true, localDone: null, syncedDone: undefined }), "show");
  assert.equal(W.welcomeStep({ ps: true, owner: true, synced: true, localDone: DONE, syncedDone: undefined }), "quiet");
  assert.equal(W.welcomeStep({ ps: true, owner: true, synced: true, localDone: null, syncedDone: DONE }), "quiet");
  assert.equal(W.welcomeStep({ ps: false, owner: true, synced: true, localDone: null, syncedDone: null }), "quiet");
  assert.equal(W.welcomeStep({ ps: true, owner: false, synced: true, localDone: null, syncedDone: null }), "quiet");
  assert.equal(W.welcomeStep({ ps: true, owner: true, synced: false, localDone: null, syncedDone: null }), "quiet");
});
ok("only a real time counts as done", () => {
  assert.equal(W.cleanWelcomeDone(DONE), DONE);
  for (const bad of ["yes", "", 5, null, "2026-11-07", "<b>"]) assert.equal(W.cleanWelcomeDone(bad), null, String(bad));
});

// ---------- wiring ----------
ok("PS's settings filter lets the done mark through, and the engine runs example deletes and their Undo", () => {
  const ps = src("ps.ts");
  assert.match(ps, /cleanWelcomeDone\(p\.welcomeDone\)/);
  assert.match(ps, /patch\.examplesOp === "delete"\) void deleteExamples\(\); else if \(patch\.examplesOp === "undo"\) void undoExamples\(\);/);
  assert.match(ps, /startExamples\(true\);/);
});
ok("the menu is in PS's Tab list window, What's new waits for it, Settings, About and updates opens it and has Example tasks", () => {
  assert.match(src("views/PsApp.tsx"), /<WelcomeHost \/>/);
  assert.match(src("views/WhatsNew.tsx"), /const open = want && listShown && front && !tour( && !face)?;/);
  // V1.43: rows of Settings, About and updates (views/SettingsGroups.tsx): What's new, Setup menu, Example tasks.
  const groups = src("views/SettingsGroups.tsx");
  for (const c of ["<WhatsNewEntry />", "<WelcomeEntry />", "<ExamplesEntry />"]) assert.ok(groups.includes(c), c);
});
ok("it keeps PS's keyboard rules (dimx) and only shows with the list on screen", () => {
  const v = src("views/Welcome.tsx");
  assert.match(v, /psPost\(\{ type: "dimx", open: true \}\)/); assert.match(v, /psPost\(\{ type: "dimx", open: false \}\)/); assert.match(v, /useOverlayShown\(\)/);
});

// ---------- the setup words ----------
ok("the setup words say the passphrase is the key, and that the Supabase password is not", () => {
  const all = S.setupCopy().join(" ");
  assert.match(all, /Your passphrase is the key/);
  assert.match(all, /Supabase password is not the key|log in to Supabase is not the key/);
  assert.match(all, /keeps your Mac and your phone in sync/);
});
ok("the invite version never claims the database is their own", () => {
  const t = S.privacyPoints({ own: false, device: "device" }).map((p) => p.text).join(" ");
  assert.doesNotMatch(t, /your own Supabase|Supabase password/);
});
ok("Create account and the invite page show the note", () => {
  assert.match(src("views/PsCreate.tsx"), /<PrivacyNote own device="Mac" \/>/);
  assert.match(src("views/JoinOwner.tsx"), /<PrivacyNote own=\{false\} device="device" \/>/);
});
const macDir = process.env.PS_MAC_DIR || join(homedir(), "Projects", "ps-mac");
const page = existsSync(join(macDir, "ui", "supabase.html")) ? readFileSync(join(macDir, "ui", "supabase.html"), "utf8") : "";
if (page.includes('id="whyOpen"')) {
  ok(`the installer's Supabase setup has every sentence word for word (${macDir})`, () => {
    for (const t of S.SUPABASE_SETUP_COPY) {
      const m = /^(Why a database\?|Is it safe\?) (.*)$/.exec(t);
      assert.ok(m ? page.includes(`<b>${m[1]}</b> ${m[2]}`) : page.includes(t), t);
    }
    assert.doesNotMatch(page, /[–—]/);
  });
} else console.log(`skip - ${macDir}/ui/supabase.html has no "Why do I need this" sheet yet (ps-mac branch gsquad-welcome not merged); set PS_MAC_DIR to check it`);

console.log(`\n${n} passed`);
