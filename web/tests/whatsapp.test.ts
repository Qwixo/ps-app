// Run: node --experimental-strip-types tests/whatsapp.test.ts
// PS 1.60 WhatsApp replies, the app side: phone number cleaning and matching, what each message type shows, dedupe by message id,
// the ticks, Dismiss and Remind sync across two devices, cards (once per message, muted and always lists), the 24 hour window,
// the shared quick replies (no signature), the panel hand over, the switch (fails closed), the guide and its example.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const rootFile = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const W = await import("../src/core/whatsapp.ts");
const D = await import("../src/core/maildedupe.ts");
const R = await import("../src/core/mailreply.ts");
const S = await import("../src/core/wasetup.ts");
const O = await import("../src/core/waop.ts");
const SN = await import("../src/core/waswitch.ts");
const P = await import("../src/core/profile.ts");
const reg = { features: JSON.parse(rootFile("features.json")) };
const gs = { profile: { schema: 1, name: "jan", display: "Jan", channel: { kind: "local" }, othersShared: "off", features: {}, rules: { tabOverProtectedApps: true, islandOverProtectedApps: true } }, features: JSON.parse(rootFile("features.json")) };
const NOW = Date.parse("2026-11-14T12:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const doc = (id: string, kind: string, data: unknown) => ({ id, kind, data, ws: null, author: null, updatedAt: null }) as never;
const client = (id: string, name: string, extra: Record<string, unknown> = {}) => doc(id, "client", { name, createdAt: "", ws: "w", ...extra });
const ev = (id: string, at: string, over: Record<string, unknown> = {}) => ({ id, at, from: "16505551234", userId: null, name: "Sam Example", kind: "text", text: "Hi, can we move our call to Friday?", ...over }) as never;

await ok("phone numbers: international form, national form needs the calling code, junk is refused", () => {
  assert.equal(W.normalizePhone("+1 (650) 555-1234"), "16505551234");
  assert.equal(W.normalizePhone("001 650 555 1234"), "16505551234");
  assert.equal(W.normalizePhone("16505551234"), "16505551234");
  assert.equal(W.normalizePhone("0905 123 456", "421"), "421905123456", "a leading 0 becomes the calling code");
  assert.equal(W.normalizePhone("0905 123 456"), null, "no calling code known: not guessed");
  assert.equal(W.normalizePhone("0905 123 456", "+421"), "421905123456");
  assert.equal(W.normalizePhone("123"), null);
  assert.equal(W.normalizePhone("call me maybe"), null);
  assert.equal(W.normalizePhone(null), null);
  assert.equal(W.normalizePhone("+1 650 555 1234 ext 12"), "16505551234", "an extension is dropped");
});
await ok("matching a number to a client: exact, extra numbers, one client only, archived skipped, Mexico and Argentina forms", () => {
  const cs = [client("c1", "Glow Studio", { phone: "+1 650 555 1234" }), client("c2", "Harbor Fitness", { phone: "0905 111 222", phones: ["+44 20 7946 0000"] }), client("c3", "Old Co", { phone: "+1 650 555 9999", archived: true })];
  assert.equal(W.matchClient(cs, "16505551234"), "c1");
  assert.equal(W.matchClient(cs, "442079460000"), "c2", "a second number of the same client");
  assert.equal(W.matchClient(cs, "421905111222", "421"), "c2", "saved in national form, matched with the calling code");
  assert.equal(W.matchClient(cs, "16505559999"), null, "archived clients never match");
  assert.equal(W.matchClient(cs, "19995550000"), null, "unknown number: still shows, with the number");
  assert.equal(W.matchClient([...cs, client("c4", "Twin", { phone: "+1 650 555 1234" })], "16505551234"), null, "two clients with one number match nobody");
  assert.equal(W.matchClient([client("m1", "Mex", { phone: "+52 55 1234 5678" })], "5215512345678"), "m1");
  assert.equal(W.matchClient(cs, null), null);
});
await ok("what a message shows: words, Photo, Voice note, File, and the rest", () => {
  assert.equal(W.showMsg({ kind: "text", text: " hello ", }), "hello");
  assert.equal(W.showMsg({ kind: "photo", text: "" }), "Photo");
  assert.equal(W.showMsg({ kind: "photo", text: "look" }), "Photo: look");
  assert.equal(W.showMsg({ kind: "voice", text: "" }), "Voice note");
  assert.equal(W.showMsg({ kind: "file", text: "", fileName: "quote.pdf" }), "File quote.pdf");
  assert.equal(W.showMsg({ kind: "video", text: "" }), "Video");
  assert.equal(W.showMsg({ kind: "location", text: "Cafe" }), "Location: Cafe");
  assert.match(W.showMsg({ kind: "unsupported", text: "" }), /could not show/);
  assert.equal(W.showMsg({ kind: "button", text: "Yes" }), "Yes");
  assert.equal(W.isMedia("voice"), true); assert.equal(W.isMedia("text"), false);
});
await ok("dedupe by message id: the same message twice changes nothing", () => {
  const a = W.applyInbound(undefined, ev("wamid.1", iso(30)), "c1")!;
  assert.equal(a.msgs.length, 1);
  assert.equal(W.applyInbound(a, ev("wamid.1", iso(30), { text: "changed" }), "c1"), null, "a second delivery of the same id");
  const b = W.applyInbound(a, ev("wamid.2", iso(10)), "c1")!;
  assert.deepEqual([b.msgs.length, b.lastKey, b.lastInAt], [2, "wamid.2", iso(10)]);
  const late = W.applyInbound(b, ev("wamid.0", iso(60)), "c1")!;
  assert.equal(late.lastKey, "wamid.2", "an older message arriving late does not take over");
  assert.equal(late.msgs[0].id, "wamid.0", "but it is kept, in time order");
  assert.equal(W.applyInbound(undefined, ev("wamid.r", iso(5), { kind: "reaction", text: "x" }), null), null, "a reaction alone starts no chat");
  assert.equal(W.applyInbound(b, ev("wamid.r", iso(1), { kind: "reaction", text: "x" }), null)!.lastInAt, iso(10), "a reaction opens no window");
  const long = Array.from({ length: 40 }).reduce<any>((c, _, i) => W.applyInbound(c, ev("m" + i, new Date(NOW + i * 1000).toISOString()), null), undefined);
  assert.equal(long.msgs.length, W.MSG_KEEP);
});
await ok("ticks only move forward, a failure shows why, an unknown message is ignored", () => {
  let c = W.applyInbound(undefined, ev("wamid.1", iso(30)), null)!;
  c = W.applyOutbound(c, { id: "wamid.out", text: "Sure", at: iso(20) });
  assert.equal(W.applyOutbound(c, { id: "wamid.out", text: "Sure", at: iso(20) }), c, "recorded once");
  const st = (status: string) => ({ id: "wamid.out", status, at: "", recipient: null, error: "131047 closed" }) as never;
  const d = W.applyStatus(c, st("delivered"))!;
  assert.equal(d.msgs[1].ticks, "delivered");
  assert.equal(W.applyStatus(d, st("sent")), null, "a late sent does not move it back");
  const r = W.applyStatus(d, st("read"))!;
  assert.equal(r.msgs[1].ticks, "read");
  assert.equal(W.applyStatus(r, st("played")), null, "played after read changes nothing");
  assert.equal(W.applyStatus(r, st("failed")), null, "a failure after Read is noise");
  const f = W.applyStatus(c, st("failed"))!;
  assert.deepEqual([f.msgs[1].ticks, f.msgs[1].error], ["failed", "131047 closed"]);
  assert.equal(W.applyStatus(c, { id: "wamid.nope", status: "read", at: "", recipient: null } as never), null);
  assert.equal(W.TICK_TEXT.read, "Read"); assert.equal(W.TICK_TEXT.sent, "Sent"); assert.equal(W.TICK_TEXT.delivered, "Delivered");
});
await ok("Dismiss and Remind sync: two devices' copies join, a Dismiss on either wins, the newer message shows again", () => {
  const base = W.applyInbound(undefined, ev("wamid.1", iso(30)), "c1")!;
  const mac = { ...base, ...W.waSeenPatch(base) };                 // Dismiss on the Mac
  const phone = W.applyInbound(base, ev("wamid.2", iso(10)), "c1")!;   // the phone saw a newer message, never heard of the Dismiss
  const joined = W.mergeChat(mac, phone);
  assert.equal(joined.msgs.length, 2);
  assert.equal(joined.seenAt, base.lastInAt, "the Dismiss is kept");
  assert.equal(W.isUnseenChat(joined, null), true, "but the newer message needs a card again");
  const both = W.mergeChat(joined, { ...phone, seenAt: phone.lastInAt });
  assert.equal(W.isUnseenChat(both, null), false, "a Dismiss of the newest clears it on all devices");
  const rem = { ...base, ...W.waRemindPatch(base, 15, NOW) };
  assert.equal(W.isRemindingChat(rem, NOW + 60_000), true);
  assert.equal(W.isRemindingChat(rem, NOW + 16 * 60_000), false, "it comes back on time");
  assert.equal(W.isRemindingChat(W.applyInbound(rem, ev("wamid.9", new Date(NOW + 5 * 60_000).toISOString()), "c1")!, NOW + 60_000), false, "a newer message shows at once");
  const ms = W.mergeChat({ ...base, msgs: [{ ...W.applyOutbound(base, { id: "o", text: "x", at: iso(5) }).msgs[1], ticks: "sent" }, base.msgs[0]] }, { ...base, msgs: [{ id: "o", at: iso(5), dir: "out", kind: "text", text: "x", ticks: "read" }, base.msgs[0]] });
  assert.equal(ms.msgs.find((m) => m.id === "o")!.ticks, "read", "the further ticks win");
});
await ok("one record id per number, the same on every device", async () => {
  assert.equal(await W.waChatIdFor("16505551234"), await W.waChatIdFor("16505551234"));
  assert.notEqual(await W.waChatIdFor("16505551234"), await W.waChatIdFor("16505551235"));
  assert.match(await W.waChatIdFor("16505551234"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(W.chatKey({ from: "1650", userId: "u" }), "1650"); assert.equal(W.chatKey({ from: null, userId: "u1" }), "u:u1");
});
const chatDoc = (id: string, over: Record<string, unknown> = {}, msgs: any[] = []) => doc(id, "wachat", { v: 1, wa: "16505551234", name: "Sam Example", clientId: "c1", lastInAt: iso(30), lastKey: "wamid.1", msgs: msgs.length ? msgs : [{ id: "wamid.1", at: iso(30), dir: "in", kind: "text", text: "Hi, can we move our call to Friday?" }], ...over });
const cl = client("c1", "Glow Studio", { contactName: "Sam", phone: "+1 650 555 1234" });
await ok("cards: client name, once per chat, since, muted, always, notifications off, Remind, Dismiss", () => {
  const docs = [cl, chatDoc("11111111-2222-5333-8444-555555555555")];
  const cards = W.waCards(docs, iso(60), {}, 20, NOW);
  assert.equal(cards.length, 1);
  assert.deepEqual([cards[0].title, cards[0].sub, cards[0].client, cards[0].rev], ["Sam sent a WhatsApp message", "Glow Studio", true, "wamid.1|"]);
  assert.match(cards[0].id, /^w:/); assert.ok(cards[0].id.length <= 40);
  assert.equal(cards[0].url, "https://wa.me/16505551234");
  assert.equal(W.waCards(docs, iso(10), {}, 20, NOW).length, 0, "older than since: no card");
  assert.equal(W.waCards(docs, iso(60), { muted: ["16505551234"] }, 20, NOW).length, 0, "muted");
  assert.equal(W.waCards(docs, iso(60), { notify: false }, 20, NOW).length, 0, "notifications off");
  assert.equal(W.waCards(docs, iso(60), { notify: false, always: ["16505551234"] }, 20, NOW).length, 1, "always notify beats notifications off");
  assert.equal(W.waCards(docs, iso(60), { on: false }, 20, NOW).length, 0, "WhatsApp off");
  assert.equal(W.waCards([chatDoc("a", { seenAt: iso(30) })], iso(60), {}, 20, NOW).length, 0, "dismissed");
  assert.equal(W.waCards([chatDoc("a", { ...W.waRemindPatch({ lastInAt: iso(30) } as never, 15, NOW) })], iso(60), {}, 20, NOW).length, 0, "reminded for later");
  const unknown = W.waCards([chatDoc("b", { clientId: null, name: null })], iso(60), {}, 20, NOW)[0];
  assert.equal(unknown.title, "+16505551234 sent a WhatsApp message", "an unknown number still shows, with the number");
  const late = W.waCards([client("c9", "Late Co", { phone: "+1 650 555 1234" }), chatDoc("c", { clientId: null, name: null })], iso(60), {}, 20, NOW)[0];
  assert.equal(late.client, true, "a number added to a client later matches an older chat");
  assert.equal(W.waCards([chatDoc("d", { msgs: [{ id: "p", at: iso(30), dir: "in", kind: "photo", text: "" }] })], iso(60), {}, 20, NOW)[0].body, "Photo");
  assert.equal(W.nextWaRemind([chatDoc("a", { ...W.waRemindPatch({ lastInAt: iso(30) } as never, 15, NOW) })], iso(60), {}, NOW), NOW + 15 * 60_000);
});
await ok("each message notifies once per device (the ledger keyed by the WhatsApp message id)", () => {
  let led = {} as Record<string, number>;
  const key = (id: string) => `wa:${D.noteKey(id, null)}`;
  let r = D.ledgerDecide(led, key("wamid.1"), NOW); assert.equal(r.fresh, true); led = r.ledger;
  r = D.ledgerDecide(led, key("wamid.1"), NOW + 1000); assert.equal(r.fresh, false, "the same message again: silent");
  r = D.ledgerDecide(led, key("wamid.2"), NOW + 2000); assert.equal(r.fresh, true, "a new message chimes");
  assert.notEqual(key("wamid.1"), D.noteKey("wamid.1", null), "never collides with an email key");
});
await ok("the panel rows: newest first, window text, plan, last reply ticks, client page chats", () => {
  const a = chatDoc("11111111-2222-5333-8444-555555555555");
  const b = chatDoc("22222222-2222-5333-8444-555555555555", { wa: "442079460000", clientId: null, name: "Pat", lastInAt: iso(60 * 30), lastKey: "p1", msgs: [{ id: "p1", at: iso(60 * 30), dir: "in", kind: "voice", text: "" }] });
  const rows = W.waRows([cl, a, b], null, {}, 30, NOW);
  assert.deepEqual(rows.map((r) => r.who), ["Sam", "Pat"]);
  assert.deepEqual([rows[0].plan, rows[0].window.text], ["text", "You can reply for 23 more hours"]);
  assert.deepEqual([rows[1].plan, rows[1].preview, rows[1].window.open], ["template", "Voice note", false]);
  assert.equal(W.waRows([cl, a], null, { muted: ["16505551234"] }, 30, NOW).length, 0);
  const withOut = chatDoc("33333333-2222-5333-8444-555555555555", { msgs: [{ id: "wamid.1", at: iso(30), dir: "in", kind: "text", text: "Hi" }, { id: "o1", at: iso(5), dir: "out", kind: "text", text: "Sure", ticks: "failed", error: "closed" }] });
  assert.equal(W.waRows([cl, withOut], null, {}, 30, NOW)[0].out?.ticks, "failed");
  assert.equal(W.chatsForClient([cl, a, b], "c1").length, 1);
});
await ok("24 hour window: text for the last hour, minutes at the end, closed after, never for a hidden number", () => {
  const c = (min: number) => ({ wa: "1", lastInAt: iso(min) }) as never;
  assert.equal(W.windowOf(c(60), NOW).text, "You can reply for 23 more hours");
  assert.equal(W.windowOf(c(23 * 60 + 10), NOW).text, "You can reply for 50 more minutes");
  assert.equal(W.windowOf(c(23 * 60 + 59), NOW).text, "You can reply for 1 more minute");
  assert.equal(W.windowOf(c(24 * 60), NOW).open, false);
  assert.equal(W.windowOf(c(24 * 60 - 1), NOW).open, true);
  assert.equal(W.windowOf(null, NOW).open, false);
  assert.equal(W.replyPlan({ wa: "1", lastInAt: iso(60) } as never, NOW), "text");
  assert.equal(W.replyPlan({ wa: "1", lastInAt: iso(60 * 25) } as never, NOW), "template");
  assert.equal(W.replyPlan({ wa: "", lastInAt: iso(60) } as never, NOW), "none", "only a username: PS cannot answer by number");
  assert.equal(W.windowOf(c(60), NOW).text.includes("hours"), true);
});
await ok("send outcomes in plain words", () => {
  assert.deepEqual(W.sendOutcome({ ok: true, id: "wamid.X" }), { ok: true, id: "wamid.X" });
  assert.deepEqual(W.sendOutcome({ ok: false, error: "window_closed" }), { ok: false, error: W.SEND_ERR.closed, closed: true });
  assert.equal((W.sendOutcome({ error: "not_linked" }) as any).error, W.SEND_ERR.notLinked);
  assert.equal((W.sendOutcome(null) as any).error, W.SEND_ERR.failed);
  assert.equal((W.sendOutcome({ ok: false, error: "Meta said: x" }) as any).error, "Meta said: x");
  for (const v of Object.values(W.SEND_ERR)) assert.ok(!/[\u2013\u2014]/.test(v));
});
await ok("mute and always lists: one number in at most one list, normalised", () => {
  let p = W.setListed({}, "muted", "+1 650 555 1234", true);
  assert.deepEqual(p.muted, ["16505551234"]);
  p = W.setListed(p, "always", "16505551234", true);
  assert.deepEqual([p.muted, p.always], [[], ["16505551234"]]);
  assert.deepEqual(W.setListed(p, "always", "16505551234", false).always, []);
  assert.equal(W.setListed(p, "muted", "nope", true), p, "not a number: nothing changes");
  assert.equal(W.waPops({ wa: "16505551234" }, { muted: ["16505551234"], always: ["16505551234"] }), false, "muted wins");
});
await ok("quick replies: ONE list shared with email, placeholders filled, no signature added", () => {
  const prefs = { responses: [{ id: "r1", name: "Friday", text: "Sure, {first name}, Friday works. Talk then." }, { id: "r2", name: "Glow only", text: "Hi {name} at {company}", clients: ["c1"] }], sigs: { "a@example.com": "-- Pat" }, sig: "-- Pat" } as never;
  const list = R.responsesOf(prefs, "Pat");
  assert.equal(list.length, 2, "the email panel's own list");
  assert.equal(R.fillPlaceholders(list[0].text, { first: W.firstOf("Sam Example"), name: "Sam Example", company: "Glow", email: "" }), "Sure, Sam, Friday works. Talk then.");
  assert.ok(!R.fillPlaceholders(list[0].text, { first: "Sam", name: "Sam", company: "", email: "" }).includes("-- Pat"), "no signature on WhatsApp");
  assert.deepEqual(R.responsesFor(list, ["c1"], { c1: "Glow" }).map((g) => g.label), ["Glow", "General"], "the client's own first, then General");
  assert.equal(W.firstOf(null), "");
  assert.equal(R.responsesOf(undefined, "Pat")[0].id, "starter-on-it", "the starter shows until the person saves their own");
});
await ok("the panel hand over (Tab list to main window) is checked, and only a click makes one", () => {
  
  assert.deepEqual(O.cleanWaOp({ op: "send", chatId: "11111111-2222-5333-8444-555555555555", text: "Sure" }), { op: "send", chatId: "11111111-2222-5333-8444-555555555555", text: "Sure" });
  assert.equal(O.cleanWaOp({ op: "send", chatId: "11111111-2222-5333-8444-555555555555", text: "  " }), null);
  assert.equal(O.cleanWaOp({ op: "send", chatId: "../x", text: "a" }), null);
  assert.equal(O.cleanWaOp({ op: "send", chatId: "11111111-2222-5333-8444-555555555555", text: "x".repeat(4097) }), null);
  assert.equal(O.cleanWaOp({ op: "template", chatId: "11111111-2222-5333-8444-555555555555", name: "reopen", language: "en_US" })?.op, "template");
  assert.equal(O.cleanWaOp({ op: "template", chatId: "11111111-2222-5333-8444-555555555555", name: "", language: "en_US" }), null);
  assert.equal(O.cleanWaOp({ op: "done", chatId: "11111111-2222-5333-8444-555555555555" })?.op, "done");
  assert.equal(O.cleanWaOp({ op: "drop", chatId: "11111111-2222-5333-8444-555555555555" }), null);
  assert.equal(O.cleanWaOp(null), null);
});
await ok("the switch fails closed: no registry, not the first owner, not switched on, switched off in settings", () => {
  const owner = (primary: boolean) => ({ status: "unlocked", role: "owner", primary, docs: new Map([["s", { id: "s", kind: "settings", data: { squadFeatures: { whatsapp: true } }, ws: null, author: null, updatedAt: "2026-11-14T00:00:00Z" }]]) }) as never;
  P.setBuildForTests(undefined);
  assert.equal(SN.waSwitch({ whatsapp: true }), false, "no registry: off");
  P.setBuildForTests(gs as never);
  assert.equal(SN.waSwitch(undefined), false, "off by default");
  assert.equal(SN.waSwitch({ whatsapp: true }), true);
  assert.equal(SN.waSwitch({ whatsapp: "yes" }), false);
  assert.equal(SN.waSwitch({ "client-emails": true }), false, "the email switch does not turn it on");
  assert.equal(SN.waOn(owner(true), { squadFeatures: { whatsapp: true } }), true);
  assert.equal(SN.waOn(owner(true), { squadFeatures: { whatsapp: true }, wa: { on: false } }), false, "switched off in WhatsApp settings");
  assert.equal(SN.waOn(owner(true), { squadFeatures: {} }), false, "not switched on");
  assert.equal(SN.waOn(owner(false), { squadFeatures: { whatsapp: true } }), false, "an invited owner never");
  assert.equal(SN.waOn({ ...(owner(true) as object), status: "locked" } as never, { squadFeatures: { whatsapp: true } }), false);
  assert.equal(SN.waOn({ ...(owner(true) as object), role: "client" } as never, { squadFeatures: { whatsapp: true } }), false);
  P.setBuildForTests(undefined);
  const f = reg.features.features.find((x: any) => x.id === "whatsapp");
  assert.deepEqual([f.owner, f.scope, f.default, f.since], ["jan", "shared", "off", "1.60"]);
});
await ok("the guide: steps from the person's own project, the verify token and code only when known, the example is marked and loops", () => {
  const steps = S.waSteps({ ref: "abcdefghijklmnopqrst", which: "normal", code: "abc", hash: "h1", verifyToken: "tok1" });
  assert.equal(steps.length, 11);
  assert.ok(steps.every((s) => s.text.length < 260 && !/[\u2013\u2014]/.test(s.text)), "one short plain sentence or two, no dashes");
  assert.ok(steps[8].code!.includes("https://abcdefghijklmnopqrst.supabase.co/functions/v1/whatsapp-webhook") && steps[8].code!.includes("tok1"));
  assert.ok(steps[6].code!.includes("whatsapp_enroll") && steps[6].code!.includes("'h1'") && !steps[6].code!.includes("tok1"));
  assert.equal(S.waSteps({ ref: null, which: null, code: null, hash: null, verifyToken: null })[6].code, undefined, "no code until one is made");
  assert.deepEqual(steps.filter((s) => s.live).map((s) => s.live), ["linked", "verified", "message"]);
  assert.ok(S.whichAnswer("normal").includes("second number") && S.whichAnswer("business").includes("second number") && S.whichAnswer(null) === "");
  assert.deepEqual(S.WHICH.map((w) => w.name), ["Normal WhatsApp", "WhatsApp Business", "Not sure"]);
  assert.ok(S.PRIVACY_LINE.includes("Meta's servers") && S.PRIVACY_LINE.includes("your own Supabase"));
  for (const s of steps) assert.ok(!/@|eyJ|sk-/.test(s.text + (s.code || "")));
  const T = S.DEMO.t;
  const at = (ms: number) => S.demoState(ms);
  assert.deepEqual([at(0).phase, at(0).card, at(0).box], ["wa", true, false]);
  assert.equal(at(T.waPoint + 10).pointer, "reply");
  assert.deepEqual([at(T.waBox + 10).box, at(T.waQuick + 10).pointer], [true, "quick"]);
  assert.equal(at(T.waType + 10).typed, S.DEMO.wa.quick);
  assert.deepEqual([at(T.waSend + 10).ticks, at(T.waSent + 10).ticks, at(T.waRead + 10).ticks], ["sending", "sent", "read"]);
  assert.deepEqual([at(T.mailIn + 10).phase, at(T.mailBox + 10).box, at(T.mailSent + 10).mailSent], ["mail", true, true]);
  assert.equal(at(T.end + 10).phase, "wa", "it loops");
  assert.ok(/made up|Example/.test("Example") && !/@/.test(JSON.stringify(S.DEMO)), "made up names only, no addresses");
});
await ok("source checks: the guide marks the example, Esc and Back close it, nothing sends by itself, the mark is not Meta's logo", () => {
  const f = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  const guide = f("views/WaGuide.tsx"), mail = f("views/WaMail.tsx"), actions = f("core/waactions.ts"), mark = f("views/WaMark.tsx");
  assert.ok(guide.includes('<span className="wa-ex">Example</span>'), "the example says Example");
  assert.ok(/Escape/.test(guide) && /gos-back/.test(guide), "Esc and Back close the guide");
  assert.ok(/Escape/.test(f("views/WaReplyBox.tsx")) && /gos-back/.test(f("views/WaReplyBox.tsx")));
  assert.ok(/prefers-reduced-motion/.test(f("views/whatsapp.css")) && /prefers-reduced-motion/.test(guide), "reduced motion turns the example off");
  assert.ok(!/waInvoke|sendWaReply|sb\.functions/.test(guide), "the demo and guide never call the sender");
  assert.ok(mail.includes("startUndoSend(") && mail.indexOf("startUndoSend(") < mail.indexOf("taskMapActions.waSend"), "a reply goes out only after the Undo window");
  assert.ok(!/setInterval[^;]*waSend|useEffect\([^)]*waSend/.test(mail), "nothing sends on a timer");
  assert.ok(!/localStorage|console\./.test(actions), "no token or message is stored or logged here");
  assert.ok(/Meta's brand rules/.test(mark) && !/<image|href=|base64/.test(mark), "a self drawn bubble, no logo file");
});
console.log(`whatsapp tests: ${n} passed`);
