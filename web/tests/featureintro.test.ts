// Run: node --experimental-strip-types tests/featureintro.test.ts
// Feature intros (core/featureintro.ts, PS 1.60): every timing rule. Fake times only, no storage, no network.
import {
  ACTIVE_NEEDED_MS, GAP_MS, IDLE_MS, INTROS, LATER_AFTER_MS, TICK_CAP_MS, addActive, answer, cleanState, emptyState, introReply, markShown, nextIntro as nextOf, recheckMs, retire,
  type IntroDef, type IntroFacts, type IntroState,
} from "../src/core/featureintro.ts";
// These rules are checked on the first intro (WhatsApp) alone, as before; a later entry (screen recording, 12b) has its own tests in screenrecisland.test.ts.
const nextIntro = (s: IntroState, f: IntroFacts, defs: IntroDef[] = [INTROS[0]]) => nextOf(s, f, defs);
import { islandQueueRuntime } from "../src/core/islandqueue.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const j = JSON.stringify;
const DAY = 86_400_000, T0 = 1_800_000_000_000;

const calm = (now: number, over: Partial<IntroFacts> = {}): IntroFacts =>
  ({ now, notForThem: [], islandBusy: false, sleep: false, sentry: false, dnd: false, sharing: false, fullScreen: false, off: false, ...over });
const active = (ms = ACTIVE_NEEDED_MS): IntroState => ({ ...emptyState(), ver: "V1.60", activeMs: ms });
const shows = (s: IntroState, f: IntroFacts, defs?: IntroDef[]) => { const p = nextIntro(s, f, defs); return !!p && "show" in p; };
const waits = (s: IntroState, f: IntroFacts) => { const p = nextIntro(s, f); return p && "wait" in p ? p.wait : null; };

// ---- the list
ok("the list has the WhatsApp intro with its words", INTROS[0].id === "whatsapp" && INTROS[0].headline === "WhatsApp messages now supported" && INTROS[0].ask === "Did you know you can link WhatsApp?" && INTROS[0].show === "Show me" && INTROS[0].later === "Later");
ok("ids are unique", new Set(INTROS.map((d) => d.id)).size === INTROS.length);
ok("no dashes in the words", INTROS.every((d) => !/[–—]/.test(j(d))));

// ---- 1 minute of ACTIVE use, after an update, idle does not count
let s = emptyState();
s = addActive(s, { version: "V1.60", deltaMs: 5000, idleMs: 1000, listShown: true });
ok("active use counts", s.activeMs === 5000 && s.ver === "V1.60");
s = addActive(s, { version: "V1.60", deltaMs: 5000, idleMs: IDLE_MS + 1, listShown: true });
ok("idle time does not count", s.activeMs === 5000);
s = addActive(s, { version: "V1.60", deltaMs: 5000, idleMs: 100, listShown: false });
ok("the list not on screen does not count", s.activeMs === 5000);
s = addActive(s, { version: "V1.60", deltaMs: 600_000, idleMs: 100, listShown: true });
ok("a stalled or slept clock adds at most one tick", s.activeMs === 5000 + TICK_CAP_MS);
ok("negative or zero time adds nothing", addActive(s, { version: "V1.60", deltaMs: -5, idleMs: 0, listShown: true }).activeMs === s.activeMs && addActive(s, { version: "V1.60", deltaMs: 0, idleMs: 0, listShown: true }).activeMs === s.activeMs);
const upd = addActive(s, { version: "V1.61", deltaMs: 5000, idleMs: 0, listShown: true });
ok("a new version starts the count again (after an update)", upd.ver === "V1.61" && upd.activeMs === 5000);
const justUpdated = addActive(active(), { version: "V1.61", deltaMs: 0, idleMs: 0, listShown: true });
ok("not right after updating: the count is zero", justUpdated.activeMs === 0 && waits(justUpdated, calm(T0)) === "notActive");
ok("59 seconds is not enough", waits(active(ACTIVE_NEEDED_MS - 1), calm(T0)) === "notActive");
ok("a full minute shows it", shows(active(), calm(T0)));
let t = emptyState();
for (let i = 0; i < 12; i++) t = addActive(t, { version: "V1.60", deltaMs: 5000, idleMs: 200, listShown: true });
ok("twelve active ticks of 5 s reach the minute", t.activeMs === 60_000 && shows(t, calm(T0)));
let idle = emptyState();
for (let i = 0; i < 500; i++) idle = addActive(idle, { version: "V1.60", deltaMs: 5000, idleMs: 3_600_000, listShown: true });
ok("an hour of idle never reaches it", idle.activeMs === 0 && !shows(idle, calm(T0)));

// ---- never over another card (the island is free) and never in Sleep, Sentry, DND, sharing, full screen
ok("another island card on it: waits", waits(active(), calm(T0, { islandBusy: true })) === "busy");
ok("Sleep mode: waits", waits(active(), calm(T0, { sleep: true })) === "sleep");
ok("Sentry mode: waits", waits(active(), calm(T0, { sentry: true })) === "sentry");
ok("Do Not Disturb: waits", waits(active(), calm(T0, { dnd: true })) === "dnd");
ok("screen sharing: waits", waits(active(), calm(T0, { sharing: true })) === "sharing");
ok("full screen: waits", waits(active(), calm(T0, { fullScreen: true })) === "fullScreen");
ok("the feature switched off: waits", waits(active(), calm(T0, { off: true })) === "off");
ok("when the blocker goes, it shows (the next free moment)", waits(active(), calm(T0, { dnd: true })) === "dnd" && shows(active(), calm(T0 + 1000)));
ok("several blockers: still waits, never shows", !shows(active(), calm(T0, { sleep: true, dnd: true, sharing: true, islandBusy: true })));

// ---- only before linking, never again once linked
ok("already linked: never shows", nextIntro(active(), calm(T0, { notForThem: ["whatsapp"] })) === null);
ok("a Set works too", nextIntro(active(), calm(T0, { notForThem: new Set(["whatsapp"]) })) === null);
const closed = retire(active(), "whatsapp", T0);
ok("retired (linked once): never again even after months, even unlinked later", nextIntro(closed, calm(T0 + 400 * DAY)) === null);
ok("retire is idempotent", j(retire(closed, "whatsapp", T0 + 5)) === j(closed));
ok("retire keeps a shown count", retire(markShown(active(), "whatsapp", T0), "whatsapp", T0 + 1).recs.whatsapp.n === 1);

// ---- Later: once more after 3 days, then never
let a = markShown(active(), "whatsapp", T0);
ok("shown counts at once and starts as Later", a.recs.whatsapp.n === 1 && a.recs.whatsapp.later === true && a.lastAt === T0);
a = answer(a, "whatsapp", "later");
ok("Later is not the end", !a.recs.whatsapp.closed && a.recs.whatsapp.later === true);
ok("not again straight away", nextIntro(a, calm(T0 + 1000)) === null);
ok("not after 2 days 23 hours", nextIntro(a, calm(T0 + LATER_AFTER_MS - 1000)) === null);
ok("asks once more after 3 days", shows(a, calm(T0 + LATER_AFTER_MS)));
let b = markShown(a, "whatsapp", T0 + LATER_AFTER_MS);
ok("second time counts 2", b.recs.whatsapp.n === 2);
b = answer(b, "whatsapp", "later");
ok("Later the second time closes it", b.recs.whatsapp.closed === true);
ok("then never, even years later", nextIntro(b, calm(T0 + 2000 * DAY)) === null);
ok("a page that went away mid intro (never answered) still asks only once more", (() => {
  const x = markShown(active(), "whatsapp", T0);
  const y = markShown({ ...x }, "whatsapp", T0 + 4 * DAY);
  return nextIntro(y, calm(T0 + 9 * DAY)) === null;
})());
const showMe = answer(markShown(active(), "whatsapp", T0), "whatsapp", "show");
ok("Show me ends it for good", showMe.recs.whatsapp.closed === true && nextIntro(showMe, calm(T0 + 30 * DAY)) === null);
ok("an answer for an intro never shown changes nothing", j(answer(active(), "whatsapp", "show")) === j(active()));

// ---- one intro at a time, at least a day apart
const two: IntroDef[] = [INTROS[0], { ...INTROS[0], id: "second", headline: "Second thing", mark: "spark" }];
ok("with two waiting, the first in the list goes first, alone", (() => { const p = nextIntro(active(), calm(T0), two); return !!p && "show" in p && p.show.id === "whatsapp"; })());
const afterFirst = answer(markShown(active(), "whatsapp", T0), "whatsapp", "show");
ok("the second does not follow the first within a day", (() => { const p = nextIntro(afterFirst, calm(T0 + DAY - 1000), two); return !!p && "wait" in p && p.wait === "gap"; })());
ok("a day later the second shows", (() => { const p = nextIntro(afterFirst, calm(T0 + GAP_MS), two); return !!p && "show" in p && p.show.id === "second"; })());
ok("a Later for one does not hold back the other beyond the day gap", (() => {
  const x = answer(markShown(active(), "whatsapp", T0), "whatsapp", "later");
  const p = nextIntro(x, calm(T0 + DAY + 5), two); return !!p && "show" in p && p.show.id === "second";
})());
ok("the gap counts even when the first is answered Later", (() => { const x = answer(markShown(active(), "whatsapp", T0), "whatsapp", "later"); const p = nextIntro(x, calm(T0 + 3600_000), two); return !!p && "wait" in p && p.wait === "gap"; })());
ok("an intro the person already did is skipped for the next one", (() => { const p = nextIntro(active(), calm(T0, { notForThem: ["whatsapp"] }), two); return !!p && "show" in p && p.show.id === "second"; })());

// ---- one at a time with the island's queue: it joins the same queue every card does
const rt = islandQueueRuntime(() => T0, () => 0);
ok("it takes its turn in the shared queue (an intro never opens over a card)", (() => {
  rt.join({ id: "reminder", kind: "reminder", priority: "high" }, () => {});
  const r = rt.join({ id: "intro:whatsapp", kind: "intro", priority: "low" }, () => {});
  return rt.queue.isActive("reminder") && !rt.queue.isActive("intro:whatsapp") && r !== undefined;
})());

// ---- saved state is never trusted
ok("nothing saved gives an empty record", j(cleanState(null)) === j(emptyState()) && j(cleanState("x")) === j(emptyState()));
ok("odd numbers are dropped", (() => { const c = cleanState({ ver: 5, activeMs: -1, lastAt: "x", recs: { whatsapp: { n: 99, at: NaN }, bad: "x", zero: { n: 0, at: 1 } } }); return c.ver === "" && c.activeMs === 0 && c.lastAt === 0 && c.recs.whatsapp.n === 5 && c.recs.whatsapp.at === 0 && !c.recs.bad && !c.recs.zero; })());
ok("a good record round trips", (() => { const x = answer(markShown(active(12345), "whatsapp", T0), "whatsapp", "later"); return j(cleanState(JSON.parse(j(x)))) === j(x); })());

// ---- the Mac's answers
ok("queued", j(introReply({ state: "queued" })) === j({ phase: "queued" }));
ok("go with the island's place", introReply({ state: "go", rect: { x: 700, bottom: 40, w: 320 } })?.phase === "go");
ok("go without a place is a plain card", j(introReply({ state: "go" })) === j({ phase: "go", anchor: null }));
ok("blocked with a known reason", j(introReply({ state: "blocked", why: "sentry" })) === j({ phase: "blocked", why: "sentry" }));
ok("blocked with a strange reason is no answer", introReply({ state: "blocked", why: "pizza" }) === null);
ok("junk is no answer", introReply(null) === null && introReply("go") === null && introReply({ state: "weird" }) === null);
ok("a blocked moment is looked at again sooner than a day", recheckMs("sleep") <= 60_000 && recheckMs("gap") > recheckMs("sleep"));

console.log(`${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
