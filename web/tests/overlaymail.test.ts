// Run: node --experimental-strip-types tests/overlaymail.test.ts
// Reply in the Tab list's email panel (src/core/overlaymail.ts, the developer 10 Nov 2026: "I still don't see the ability to
// reply to emails in the tab overlay"), with FICTIONAL clients, leads and mail. When the Reply button shows, the
// card ids it carries (the same as the pop up cards'), the lead rows the overlay gets, the one setup line the reply
// panel shows while sending is not set up, and the wiring from the overlay to the main page. Nothing here can send:
// Reply only opens the panel (hard rule 7: the developer writes and sends his own replies).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const O = await import("../src/core/overlaymail.ts");
const L = await import("../src/core/leadcards.ts");
const MC = await import("../src/core/mailcards.ts");
const MR = await import("../src/core/mailreply.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---------- when the Reply button shows ----------
ok("PS on the Mac, the developer's account, a Gmail client email: Reply shows", () => {
  assert.equal(O.replyButtonShows({ mode: "ps", mail: true, cardId: "m:r1" }), true);
});
ok("PS on the Mac, the developer's account, a lead reply from Instantly: Reply shows", () => {
  assert.equal(O.replyButtonShows({ mode: "ps", mail: true, cardId: "n:e-123" }), true);
});
ok("the website's To-do page and the phone: no Reply (they cannot send; Open and Done stay)", () => {
  for (const mode of ["production", "development", "gos", "web"]) assert.equal(O.replyButtonShows({ mode, mail: true, cardId: "m:r1" }), false, mode);
});
ok("not the developer's account: no Reply (the email feeds are his)", () => {
  assert.equal(O.replyButtonShows({ mode: "ps", mail: false, cardId: "m:r1" }), false);
});
ok("an email PS cannot answer (no id, or an odd one): no Reply", () => {
  for (const cardId of [null, undefined, "", "c:chat", "m:", "m:has space", "x:r1", "m:" + "a".repeat(39)]) assert.equal(O.replyButtonShows({ mode: "ps", mail: true, cardId }), false, String(cardId));
});
ok("sending not set up yet still shows Reply (the panel says what to do instead of the button hiding)", () => {
  // replyButtonShows takes no sign in status at all: Gmail accounts 0 and no Instantly key change nothing here.
  assert.equal(O.replyButtonShows.length, 1);
  assert.equal(O.replyButtonShows({ mode: "ps", mail: true, cardId: "n:e1" }), true);
});

// ---------- the card ids: the same as the pop up cards ----------
ok("a Gmail row carries the card id the pop up card has, so the reply panel finds the same email", () => {
  const client = { id: "c1", ws: null, kind: "client", data: { name: "Northwind Silk", contactName: "Jane Doe", email: "jane@northwindsilk.example", ws: "w1", createdAt: "2026-10-01T00:00:00Z" } };
  for (const id of ["r1", "x".repeat(60)]) {
    const reply = { id, ws: null, kind: "reply", data: { clientId: "c1", account: "red@example.com", threadId: "t1", msgIds: ["m"], from: "jane@northwindsilk.example",
      fromName: "Jane Doe", subject: "Homepage draft", snippet: "Hi Sam.", date: "2026-10-20T11:00:00.000Z", count: 1, handled: false } };
    const [card] = MC.mailCards([client, reply] as never, "2026-10-20T10:00:00.000Z");
    assert.equal(O.gmailCardId(id), card.id);
    assert.ok(O.cleanReplyCardId(O.gmailCardId(id)));
  }
});
ok("cleanReplyCardId: only m: and n: ids up to 40 characters", () => {
  assert.equal(O.cleanReplyCardId("m:r1"), "m:r1");
  assert.equal(O.cleanReplyCardId("n:abc-123_x"), "n:abc-123_x");
  for (const v of [1, null, {}, "c:x", "m:<b>", "n:" + "a".repeat(39), "javascript:alert(1)"]) assert.equal(O.cleanReplyCardId(v), null);
});

// ---------- lead replies in the panel ----------
const now = Date.parse("2026-11-10T12:00:00.000Z");
const iso = (agoMin: number) => new Date(now - agoMin * 60_000).toISOString();
const rep = (id: string, agoMin: number, x: Record<string, unknown> = {}) => ({ id, threadId: "t-" + id, from: "jane@northwindsilk.example", fromName: "Jane Doe",
  at: iso(agoMin), subject: "Re: Jane, I rebuilt your homepage", opening: "Hi Sam, this looks great. Can we talk on Tuesday?", campaignId: "camp1", url: "https://app.instantly.ai/app/unibox", ...x });
const st = { since: iso(24 * 60) };

ok("an open lead reply becomes a row: first name, company domain, subject, opening, Open in Instantly, card id", () => {
  const [r] = O.leadRows(L.leadCards({ replies: [rep("e1", 3)] }, st, now));
  assert.deepEqual(r, { cardId: "n:e1", who: "Jane", company: "northwindsilk.example", subject: "Re: Jane, I rebuilt your homepage",
    preview: "Hi Sam, this looks great. Can we talk on Tuesday?", at: iso(3), url: "https://app.instantly.ai/app/unibox" });
  assert.equal(O.replyButtonShows({ mode: "ps", mail: true, cardId: r.cardId }), true);
});
ok("a dismissed lead reply (the card's Dismiss, or Done in the panel) is not in the panel", () => {
  const cards = L.leadCards({ replies: [rep("e1", 3)] }, st, now);
  const next = L.leadAnswer(st, cards, "n:e1", "dismiss", now)!;
  assert.equal(O.leadRows(L.leadCards({ replies: [rep("e1", 3)] }, next, now)).length, 0);
});
ok("auto replies never get a row", () => {
  assert.equal(O.leadRows(L.leadCards({ replies: [rep("e2", 3, { opening: "I am out of the office until Monday." })] }, st, now)).length, 0);
});
ok("the overlay's copy of the lead rows is checked: odd rows and other links are dropped, at most 6", () => {
  const good = { cardId: "n:e1", who: "Jane", company: "northwindsilk.example", subject: "Re: hi", preview: "Hi", at: iso(1), url: "https://app.instantly.ai/app/unibox" };
  assert.deepEqual(O.cleanLeadRows([good]), [good]);
  assert.deepEqual(O.cleanLeadRows([{ ...good, url: "https://evil.example/" }, { ...good, cardId: "m:r1" }, { ...good, cardId: "n:bad id" }, null, "x"]), []);
  assert.equal(O.cleanLeadRows(Array.from({ length: 9 }, (_, i) => ({ ...good, cardId: `n:e${i}` }))).length, 6);
  assert.deepEqual(O.cleanLeadRows(null), []);
  assert.deepEqual(O.cleanLeadRows({}), []);
});
ok("client emails and lead replies together, newest first, at most 6", () => {
  const g = (id: string, ago: number) => ({ cardId: `m:${id}`, via: "gmail" as const, replyId: id, who: "Ann", company: null, subject: "s", preview: "", at: iso(ago), url: "https://mail.google.com/", count: 1 });
  const l = (id: string, ago: number) => ({ cardId: `n:${id}`, who: "Jo", company: null, subject: "s", preview: "", at: iso(ago), url: "https://app.instantly.ai/app/unibox" });
  const rows = O.mailRows([g("a", 10), g("b", 1)], [l("x", 5)]);
  assert.deepEqual(rows.map((r) => r.cardId), ["m:b", "n:x", "m:a"]);
  assert.equal(rows[1].via, "instantly");
  assert.equal(rows[1].replyId, undefined);   // Done on a lead row dismisses it (no reply record to mark handled)
  assert.equal(O.mailRows(Array.from({ length: 5 }, (_, i) => g("g" + i, i)), [l("y", 0), l("z", 9)]).length, 6);
});
ok("the mirror keeps the checked rows and tells the panel only on a real change", () => {
  let calls = 0;
  const off = O.leadMirror.subscribe(() => calls++);
  const row = { cardId: "n:e1", who: "Jane", company: null, subject: "", preview: "", at: iso(1), url: "https://app.instantly.ai/app/unibox" };
  O.setLeadMirror([row]); O.setLeadMirror([row]);
  assert.equal(calls, 1);
  assert.equal(O.leadMirror.get().length, 1);
  O.setLeadMirror(null);   // locked: the panel shows none
  assert.equal(O.leadMirror.get().length, 0);
  assert.equal(calls, 2);
  off();
});

// ---------- the reply panel when sending is not set up ----------
ok("not set up: the panel says, once, what to do (Gmail: Connect Gmail for sending; Instantly: Add Instantly key)", () => {
  assert.match(MR.sendSetupHint("gmail", false, true), /Connect Gmail for sending once/);
  assert.match(MR.sendSetupHint("instantly", false, true), /Add Instantly key once/);
  for (const v of ["gmail", "instantly"] as const) assert.doesNotMatch(MR.sendSetupHint(v, false, true), /[\u2013\u2014]/, "no em or en dashes");
});
ok("set up, the Mac not heard from yet, or the Mac's own problem line showing: no extra line", () => {
  assert.equal(MR.sendSetupHint("gmail", true, true), "");
  assert.equal(MR.sendSetupHint("gmail", false, false), "");
  assert.equal(MR.sendSetupHint("instantly", false, true, "The key was refused"), "");
});

// ---------- wiring (source checks: the overlay holds no vault, the main page opens the panel) ----------
ok("the email panel has the Reply button, gated by replyButtonShows, before Open and Done", () => {
  const t = src("src/views/TaskMap.tsx");
  const panel = t.slice(t.indexOf("function ClientMail("), t.indexOf("// ---------- upcoming meetings"));
  assert.match(panel, /replyButtonShows\(\{ mode: import\.meta\.env\.MODE, mail, cardId: r\.cardId \}\)/);
  assert.match(panel, /taskMapActions\.replyOpen\(r\.cardId\)/);
  assert.ok(panel.indexOf(">Reply<") < panel.indexOf(">Open<") && panel.indexOf(">Open<") < panel.indexOf(">Done<"));
  assert.match(t, /mailOnSnap\(s\) && <Slot id="mail"><ClientMail s=\{s\} mail \/><\/Slot>/);
});
ok("the overlay posts Reply and a lead's Done to the main page as a looks patch (PS relays looks from the overlay)", () => {
  const p = src("src/views/PsApp.tsx");
  assert.match(p, /taskMapActions\.replyOpen = async \(cardId\) => psPost\(\{ type: "looks", patch: \{ replyOpen: cardId \} \}\)/);
  assert.match(p, /taskMapActions\.leadDone = async \(cardId\) => psPost\(\{ type: "looks", patch: \{ leadDone: cardId \} \}\)/);
});
ok("the main page opens the panel for a checked id, dismisses only n: ids on Done, and mirrors lead rows for the developer only", () => {
  const s = src("src/ps.ts");
  assert.match(s, /const id = cleanReplyCardId\(patch\.replyOpen\); if \(id\) openReplyFor\(id\);/);
  assert.match(s, /cleanReplyCardId\(patch\.leadDone\); if \(id && id\.startsWith\("n:"\)\) mailCardMessage/);
  assert.match(s, /const leads = unlocked && mailOnSnap\(s\) \? leadRows\(/);
  assert.match(s, /setLeadMirror\(st\.unlocked \? st\.leads : null\)/);
});
ok("the card's Reply and the panel's Reply go the same way, and nothing in it sends", () => {
  const e = src("src/replyengine.ts");
  assert.match(e, /m\.action === "reply" && typeof m\.id === "string"\) \{ openReplyFor\(m\.id\); return true; \}/);
  const fn = e.slice(e.indexOf("export function openReplyFor("), e.indexOf("/** Settings' \"Reply from PS\" row"));
  assert.match(fn, /type: "reply:open"/);
  assert.doesNotMatch(fn, /reply:queue|reply:send|fetch\(/);
});
ok("the pop up cards keep their Reply on the Mac (mailcards.ts reply: true in PS mode)", () => {
  const m = src("src/mailcards.ts");
  assert.match(m, /const REPLY = import\.meta\.env\.MODE === "ps" \? \{ reply: true \} : \{\};/);
  assert.equal((m.match(/\.\.\.REPLY/g) || []).length, 2);
});
ok("the Reply window route is still there after the V1.44 web app merge", () => {
  const a = src("src/App.tsx");
  assert.match(a, /if \(PS && p === "\/reply-window"\) return "reply-window";/);
  assert.match(a, /if \(r === "reply-window"\) \{ startReplyWindow\(\); return <ReplyWindow \/>; \}/);
});
ok("the reply panel shows the setup line under From", () => {
  const w = src("src/views/ReplyWindow.tsx");
  assert.match(w, /const setupHint = ctx \? sendSetupHint\(ctx\.via, ready, !!status, problem\) : "";/);
  assert.match(w, /\{setupHint && <div className="rw-hint rw-hint-row rw-setup" role="note">\{setupHint\}<\/div>\}/);
});

console.log(`\n${n} checks passed`);
