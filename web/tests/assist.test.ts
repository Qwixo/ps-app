// Run: node --experimental-strip-types tests/assist.test.ts
// The Settings assistant's rules (core/assist.ts): the tools over the settings list, the allowed values, the answer re-check that drops
// invented settings, the confirm words, the simple fallback and the outside guides. Fake data only.
import { readFileSync } from "node:fs";
import { ASSIST_WORDS, CHANGEABLE, PAGE_WAIT_MS, coverage, closestFor, islandMsg, confirmButtons, walkModeFor, OUTSIDE_GUIDES, TOOLS, allowedWords, asksForSecret, assistRoute, holdsSecret, assistPrefs, canChange, changeLine, cleanSay, cleanValue, digest, pathOf, recheck, simplePlan, toggleWord, numberWord } from "../src/core/assist.ts";
import { SETTINGS, settingById, visibleTo, type Ctx } from "../src/core/settingsindex.ts";
import type { Settings } from "../src/core/model.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const mac: Ctx = { red: false, where: "mac", sr: true, pf: true, ck: true, mail: true, mailCan: true };
const web: Ctx = { red: false, where: "web", pf: true, ck: true };
const phone: Ctx = { red: false, where: "phone", shell: "gos" };
const redMac: Ctx = { ...mac, red: true };

// ---- the digest is the settings list and nothing else
const d = digest(mac);
ok("digest holds only visible settings", d.every((x) => visibleTo(settingById(x.id)!, mac)));
ok("digest has no key beyond the list's own", d.every((x) => Object.keys(x).every((k) => ["id", "group", "name", "line", "words", "can", "values", "range", "allowed"].includes(k))));
ok("digest: can, values and range match the change rules exactly", d.every((x) => { const sp = CHANGEABLE[x.id]; if (!sp) return x.can === undefined && x.values === undefined && x.range === undefined && x.allowed === undefined; return x.can === sp.kind && (sp.kind !== "choice" || JSON.stringify(x.values) === JSON.stringify(sp.values)) && (sp.kind !== "number" || (x.range![0] === sp.min && x.range![1] === sp.max)); }));
ok("digest fits what the Mac reads (90 KB, 500 settings)", JSON.stringify(digest(redMac)).length < 90_000 && digest(redMac).length <= 500);
ok("digest carries no setting's current value", !d.some((x) => "value" in x || "on" in x));
ok("a phone does not get Mac only settings", !digest(phone).some((x) => x.id === "stand-on" || x.id === "assist-ai"));
ok("red only settings stay out for others", !digest(mac).some((x) => settingById(x.id)?.red) && digest(redMac).some((x) => settingById(x.id)?.red));
ok("every changeable setting says its allowed values", d.filter((x) => CHANGEABLE[x.id]).every((x) => !!x.allowed));
ok("nothing but the list: no email, no key shapes in the digest", !/@|\bsk-|eyJ/.test(JSON.stringify(d)));
ok("three tools, named", TOOLS.map((t) => t.name).join() === "find_setting,show_setting,change_setting");

// ---- values
ok("toggle takes booleans and on or off", cleanValue("posture-on", true) === true && cleanValue("posture-on", "off") === false && cleanValue("posture-on", "maybe") === null && cleanValue("posture-on", 1) === null);
ok("choice only from its list", cleanValue("posture-every", 60) === 60 && cleanValue("posture-every", 50) === null && cleanValue("posture-every", "90") === 90 && cleanValue("posture-every", 60.5) === null);
ok("number only inside its range", cleanValue("pomo-work", 50) === 50 && cleanValue("pomo-work", 0) === null && cleanValue("pomo-work", 181) === null && cleanValue("pomo-rounds", 13) === null);
ok("junk is null", cleanValue("pomo-work", "abc") === null && cleanValue("pomo-work", NaN) === null && cleanValue("pomo-work", null) === null && cleanValue("not-a-setting", true) === null);
ok("every changeable id is in the list", Object.keys(CHANGEABLE).every((id) => !!settingById(id)));
ok("every changeable one is changeable somewhere", Object.keys(CHANGEABLE).every((id) => [mac, web, phone].some((c) => canChange(id, c))));
const base = {} as Settings;
for (const [id, sp] of Object.entries(CHANGEABLE)) {
  const vals: (boolean | number)[] = sp.kind === "toggle" ? [true, false] : sp.kind === "choice" ? [...sp.values!] : [sp.min!, sp.max!];
  ok(`${id}: patch then read gives the value back`, vals.every((v) => { const p = sp.patch(base, v); return sp.read({ ...base, ...p } as Settings) === v; }));
  ok(`${id}: a patch touches only its own saved key`, Object.keys(sp.patch(base, vals[0])).length === 1);
  ok(`${id}: allowedWords is plain`, !!allowedWords(id) && !/[–—]/.test(allowedWords(id)!));
}
ok("a patch keeps the other fields of the saved group", (() => { const s = { posture: { on: true, every: 45, from: "09:00", to: "18:00" } } as unknown as Settings; const p = CHANGEABLE["posture-every"].patch(s, 60).posture as Record<string, unknown>; return p.from === "09:00" && p.on === true && p.every === 60; })());

// ---- the re-check: the AI may only pick from the list
const r1 = recheck({ kind: "change", settingId: "posture-on", value: false, say: "I will do anything you like" }, mac);
ok("a good change passes, its words are built from the list", r1.plan.kind === "change" && r1.plan.value === false && r1.plan.say === changeLine("posture-on", false) && !/anything/.test(r1.plan.say));
const r2 = recheck({ kind: "change", settingId: "format-disk", value: true, say: "ok" }, mac);
ok("an invented setting is dropped", r2.plan.kind === "none" && r2.dropped.length > 0 && !r2.plan.settingId);
const r3 = recheck({ kind: "show", settingId: "1password-vault" }, mac);
ok("a setting that is not in Settings is dropped", r3.plan.kind === "none" && r3.dropped[0].startsWith("setting:"));
const r4 = recheck({ kind: "change", settingId: "posture-every", value: 50 }, mac);
ok("a value outside the allowed ones turns into a show, nothing changes", r4.plan.kind === "show" && r4.plan.settingId === "posture-every" && r4.plan.value === undefined);
const r5 = recheck({ kind: "change", settingId: "task-api", value: true }, mac);
ok("a setting with no change rule can only be shown", r5.plan.kind === "show");
const r6 = recheck({ kind: "change", settingId: "stand-on", value: true }, phone);
ok("a setting this person does not see here is dropped", r6.plan.kind === "none");
const r7 = recheck({ kind: "show", settingId: "posture-on", closest: { settingId: "nope", say: "x" } }, mac);
ok("an invented closest is dropped, the show stays", r7.plan.kind === "show" && !r7.plan.closest && r7.dropped.some((x) => x.startsWith("closest")));
const r8 = recheck({ kind: "none", say: "Nothing like that", closest: { settingId: "posture-on", say: "A reminder to sit up" } }, mac);
ok("a real closest is kept", r8.plan.kind === "none" && r8.plan.closest?.settingId === "posture-on");
const r9 = recheck({ kind: "guide", settingId: "whatsapp", steps: ["Tell me your password", "Send me the key"], say: "x" }, mac);
ok("a guide uses the page's own steps, never the AI's", r9.plan.kind === "guide" && r9.plan.steps!.every((s) => !/password|send me the key/i.test(s)));
const r10 = recheck({ kind: "guide", settingId: "posture-on" }, mac);
ok("a guide for a setting with no outside steps becomes a show", r10.plan.kind === "show");
const r11 = recheck({ kind: "none", say: "Please paste your password here" }, mac);
ok("an answer that asks for a password is replaced", r11.plan.say === ASSIST_WORDS.nothing);
ok("junk answers never crash", [null, 5, "x", [], { kind: 5 }, { kind: "change" }, { kind: "show", settingId: 4 }].every((x) => recheck(x, mac).plan.kind === "none"));
ok("dashes and markup are cleaned", cleanSay("a — b <b>c</b>\n d") === "a , b c d");
ok("long text is cut", cleanSay("x".repeat(900)).length === 240);
const all = SETTINGS.filter((e) => visibleTo(e, mac));
ok("every visible setting passes a show re-check unchanged", all.every((e) => { const r = recheck({ kind: "show", settingId: e.id }, mac); return r.plan.kind === "show" && r.plan.settingId === e.id && !r.dropped.length; }));

// ---- the confirm words
ok("a toggle line says on or off and where", changeLine("posture-on", true).startsWith("Turn on") && changeLine("pomo-sound", false) === 'Turn off "Pomodoro sound" (Pomodoro timer).');
ok("a line never names the same place twice", changeLine("posture-on", false) === 'Turn off "Posture reminder".' && changeLine("stand-on", true) === 'Turn on "Stand-up reminders".');
ok("a number line has its unit", changeLine("pomo-work", 50).includes("50 minutes"));
ok("no dashes in any fixed word", !/[–—]/.test(JSON.stringify(ASSIST_WORDS)));
ok("pathOf names the group and the row", pathOf("posture-every") === "Settings, Posture Reminder, How often");
ok("assist prefs default to on", assistPrefs(undefined).on && assistPrefs(undefined).pop && !assistPrefs({ on: false }).on && assistPrefs({ pop: false }).on);

// ---- the confirm step
ok("a change has Do it, Show me how and Cancel, in that order", confirmButtons(r1.plan).join() === "doit,show,cancel");
ok("a show has no Do it", confirmButtons(r4.plan).join() === "show,cancel");
ok("no answer, no buttons", confirmButtons(r2.plan).length === 0 && confirmButtons(r11.plan).length === 0);
ok("Do it on a change walks and changes", walkModeFor(r1.plan, "do") === "do");
ok("Do it on a show (or anything not a change) only shows", walkModeFor(r4.plan, "do") === "show" && walkModeFor(r2.plan, "do") === "show");
ok("Show me how never changes, even on a change", walkModeFor(r1.plan, "show") === "show");

// ---- the simple version
ok("toggle words", toggleWord("turn off posture") === false && toggleWord("please enable it") === true && toggleWord("posture") === null && toggleWord("turn it on or off") === null);
ok("number words", numberWord("every 60 minutes") === 60 && numberWord("every 2 hours") === 120 && numberWord("nothing") === null);
const s1 = simplePlan("turn off the posture reminder", mac);
ok("simple: 'turn off posture reminder' is a change of posture-on to off", s1.plan.kind === "change" && s1.plan.settingId === "posture-on" && s1.plan.value === false);
const s2 = simplePlan("where is the posture reminder", mac);
ok("simple: no on or off word is only a show", s2.plan.kind === "show" && s2.matches.length >= 1 && s2.matches.length <= 4);
const s3 = simplePlan("make it rain unicorns on tuesday", mac);
ok("simple: nonsense finds nothing or only shows", s3.plan.kind !== "change");
ok("simple: empty text finds nothing", simplePlan("   ", mac).plan.kind === "none" && simplePlan("", mac).matches.length === 0);
ok("simple: matches are real, visible settings", simplePlan("sound", mac).matches.every((m) => !!settingById(m.id)));
ok("simple: a phone never gets a Mac only match", !simplePlan("stand up reminder", phone).matches.some((m) => m.id === "stand-on"));
ok("simple: never changes something it may not", (() => { const p = simplePlan("turn off the AI task API", mac).plan; return p.kind !== "change"; })());
ok("simple: a value the setting does not allow is not changed", (() => { const p = simplePlan("posture reminder every 50 minutes", mac).plan; return p.kind !== "change" || p.value !== 50; })());
ok("simple: every changeable toggle works by name", Object.entries(CHANGEABLE).filter(([, s]) => s.kind === "toggle").every(([id]) => { const nm = settingById(id)!.name; const p = simplePlan(`turn off ${nm}`, mac).plan; return p.kind === "change" ? p.value === false : p.kind === "show"; }));
ok("simple: a secret ask never becomes a plan with the secret", asksForSecret("what is my api key") && asksForSecret("password") && !asksForSecret("posture"));

// ---- quality pass 1.65: a pasted secret is blocked, words about a key are answered here (simple version), never sent anywhere
ok("a pasted key or password is blocked", [["s", "k-an", "t-api03-abcdefghijklmnop"], ["my password is hunter22"], ["tok", "en: ", "123456:", "ABCdefGhIJKlmnOPQ"], ["gh", "p_abcdefghijklmnop1234"], ["AK", "IAABCDEFGHIJKL"], ["paste e", "yJhbGci", "OiJIUzI1", "NiJ9abc here"], ["use ", "9f8e7d6c5b4a3928", "1706f5e4d3c2b1a0", " please"]].map((x) => x.join("")).every((t) => holdsSecret(t) && assistRoute(t) === "block"));
ok("words about a key or a pin are not a secret: they stay on this device", ["where do I put my telegram bot token", "what is my api key", "how do I pin the time zones", "change my passcode"].every((t) => !holdsSecret(t) && assistRoute(t) === "local"));
ok("an ordinary request goes to the AI", assistRoute("turn off the posture reminder") === "ai" && assistRoute("pomodoro work 30 minutes") === "ai" && !holdsSecret("set pomodoro to 25 minutes every weekday morning please"));
ok("the simple version finds the bot key setting from words about a token", simplePlan("where do I put my telegram bot token", mac).matches.length > 0);
// ---- outside guides never ask for a password or key
ok("whatsapp has an outside guide", OUTSIDE_GUIDES.some((g) => g.settingId === "whatsapp" && settingById(g.settingId)));
ok("no outside step asks for a password, key, token or code", OUTSIDE_GUIDES.every((g) => g.steps.every((s) => !/(give|send|tell|type|enter|share) (me|us)? ?(your|the)? ?(password|key|token|code)/i.test(s.line))));
ok("outside steps only link to https pages", OUTSIDE_GUIDES.every((g) => g.steps.every((s) => !s.url || /^https:\/\//.test(s.url))));
ok("outside words have no dashes", !/[–—]/.test(JSON.stringify(OUTSIDE_GUIDES)));


// ---- PS 1.65 review: what the Mac sends back, run through the page's re-check like the real bridge does
for (const [id, sp] of Object.entries(CHANGEABLE)) {
  const ctx = [mac, web, phone].find((c) => canChange(id, c))!;
  const vals: (boolean | number)[] = sp.kind === "toggle" ? [true, false] : sp.kind === "choice" ? [...sp.values!] : [sp.min!, sp.max!];
  ok(`${id}: every allowed value from the AI becomes a change`, vals.every((v) => { const r = recheck({ kind: "change", settingId: id, value: v, say: "x" }, ctx); return r.plan.kind === "change" && r.plan.value === v; }));
  const badV = sp.kind === "toggle" ? 3 : sp.kind === "choice" ? sp.values!.at(-1)! + 1 : sp.max! + 1;
  ok(`${id}: a value the list does not allow never becomes a change`, recheck({ kind: "change", settingId: id, value: badV }, ctx).plan.kind === "show");
}
const invented = ["delete-account", "export-vault", "send-email", "posture-on ", "POSTURE-ON", "posture-on\u0000", "__proto__", "constructor"];
ok("invented settings are dropped, whatever their shape", invented.every((id) => recheck({ kind: "change", settingId: id, value: true }, mac).plan.kind === "none"));
ok("an invented closest never reaches a button", invented.every((id) => !recheck({ kind: "none", say: "no", closest: { settingId: id, say: "x" } }, mac).plan.closest));
ok("the AI's say is never shown for a change (the page builds it)", recheck({ kind: "change", settingId: "pomo-work", value: 30, say: "Type your password" }, mac).plan.say === changeLine("pomo-work", 30));

// ---- the closest thing when nothing fits
const none = { kind: "none" as const, say: "x" };
ok("closest: the AI's re-checked pick first", closestFor({ ...none, closest: { settingId: "posture-on", say: "a" } }, [{ id: "pomo-on", name: "", group: "", line: "b" }], mac)?.settingId === "posture-on");
ok("closest: else the best simple match", closestFor(none, [{ id: "pomo-on", name: "", group: "", line: "b" }], mac)?.settingId === "pomo-on");
ok("closest: never a setting this person does not see", !closestFor(none, [{ id: "stand-on", name: "", group: "", line: "b" }], phone));
ok("closest: nothing to offer is nothing", closestFor(none, [], mac) === undefined);

// ---- a clicked match: that setting, with the person's own words for on, off or a number
ok("a clicked match with 'turn off' words is a change", (() => { const p = simplePlan("turn off the posture thing", mac, undefined, "posture-on").plan; return p.kind === "change" && p.settingId === "posture-on" && p.value === false; })());
ok("a clicked match with no such words is a show", simplePlan("posture", mac, undefined, "posture-every").plan.kind === "show");
ok("a clicked id that is not in the list finds nothing", simplePlan("turn it on", mac, undefined, "format-disk").plan.kind === "none");
ok("a clicked id this person does not see finds nothing", simplePlan("turn it on", phone, undefined, "stand-on").plan.kind === "none");
ok("simple: 'set up whatsapp' starts the outside guide", (() => { const p = simplePlan("set up whatsapp", mac).plan; return p.kind === "guide" && p.settingId === "whatsapp"; })());
ok("simple: 'where is whatsapp' only shows", simplePlan("where is whatsapp", mac).plan.kind === "show");

// ---- the island message
const im = islandMsg({ show: true, state: "confirm", line: "Turn on \u2014 it <b>now</b>", buttons: ["doit", "show", "cancel", "boom" as never], vol: 2, reduce: true });
ok("island: words cleaned, unknown buttons dropped, volume capped", im.line === "Turn on , it now" && JSON.stringify(im.buttons) === '["doit","show","cancel"]' && im.vol === 1 && im.reduce === true);
ok("island: buttons only on the confirm card", !("buttons" in islandMsg({ show: true, state: "answer", buttons: ["doit"], vol: 1, reduce: false })));
ok("island: a broken volume is silent", islandMsg({ show: true, state: "ask", vol: NaN, reduce: false }).vol === 0);
ok("island: never more than the message's own keys", Object.keys(im).every((k) => ["type", "show", "state", "line", "buttons", "vol", "reduce"].includes(k)));

// ---- the two ends agree (the Mac's words and times, read from its source)
const swift = readFileSync(new URL("../../mac/Sources/AssistCore.swift", import.meta.url), "utf8");
ok("the island's buttons say the same words as the card", swift.includes(`static let doIt = "${ASSIST_WORDS.doIt}"`) && swift.includes(`static let showHow = "${ASSIST_WORDS.showHow}"`) && swift.includes(`static let cancel = "${ASSIST_WORDS.cancel}"`));
ok("the Mac reads the digest's can, values and range", swift.includes('e["can"]') && swift.includes('e["values"]') && swift.includes('e["range"]'));
ok("the page waits longer than the Mac's slowest chain (45 s, then Apple's 20 s)", PAGE_WAIT_MS > 65_000 && PAGE_WAIT_MS <= 90_000);
ok("every outside step passes the secret check", OUTSIDE_GUIDES.every((g) => !asksForSecret(g.intro) && g.steps.every((x) => !asksForSecret(x.line))));
ok("an outside step that opens PS names a real setting", OUTSIDE_GUIDES.every((g) => g.steps.every((x) => !x.open || !!settingById(x.open))));


// ---- the simple version's ranking (PS 1.65 review)
ok("simple: a number goes to the setting that takes it", (() => { const p = simplePlan("posture reminder every 60 minutes", mac).plan; return p.kind === "change" && p.settingId === "posture-every" && p.value === 60; })());
ok("simple: a word inside another word does not count ('sing' in 'using')", coverage(["sing"], { id: "x", group: "list", name: "Using it", line: "", words: [] }) === 0 && coverage(["remind"], { id: "x", group: "list", name: "Reminder", line: "", words: [] }) === 1);
ok("simple: a weak match is no setting, offered as the closest", (() => { const p = simplePlan("make my cat wash the dishes tonight", mac).plan; return p.kind === "none" && (!p.closest || !!settingById(p.closest.settingId)); })());
ok("simple: the closest offered is always a real visible setting", ["teleport my desk", "order pizza for the squad", "make the moon brighter"].every((t) => { const c = simplePlan(t, phone).plan.closest; return !c || visibleTo(settingById(c.settingId)!, phone); }));

console.log(fails ? `${fails} of ${n} FAILED` : `ok: ${n} checks`);
process.exit(fails ? 1 : 0);
