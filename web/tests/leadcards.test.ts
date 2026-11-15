// Run: node --experimental-strip-types tests/leadcards.test.ts
// Instantly reply cards (src/core/leadcards.ts), with FICTIONAL leads and mail.
import assert from "node:assert/strict";
const L = await import("../src/core/leadcards.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const now = Date.parse("2026-10-30T12:00:00.000Z");
const iso = (agoMin: number) => new Date(now - agoMin * 60_000).toISOString();
const since = iso(24 * 60);
const rep = (id: string, agoMin: number, x: Record<string, unknown> = {}) => ({ id, threadId: "t-" + id, from: "jane@northwindsilk.example", fromName: "Jane Doe",
  at: iso(agoMin), subject: "Re: Jane, I rebuilt your homepage", opening: "Hi the developer, this looks great. Can we talk on Tuesday?", campaignId: "camp1", url: "https://app.instantly.ai/app/unibox", ...x });
const st = { since };
const human = (opening: string, subject = "Re: Jane, I rebuilt your homepage") => !L.isAutoReply({ opening, subject, from: "jane@northwindsilk.example" });
const auto = (opening: string, subject = "Re: Jane, I rebuilt your homepage", from = "jane@northwindsilk.example") => L.isAutoReply({ opening, subject, from });

ok("a reply to a campaign shows a card: name, domain and subject, the opening, Open in Instantly", () => {
  const [c] = L.leadCards({ replies: [rep("r1", 1)] }, st, now);
  assert.equal(c.id, "n:r1");   // the email id, the same from the webhook and the feed
  assert.equal(c.title, "Jane replied in Instantly");
  assert.equal(c.sub, "northwindsilk.example · Re: Jane, I rebuilt your homepage");
  assert.equal(c.body, "Hi the developer, this looks great. Can we talk on Tuesday?");
  assert.match(c.url, /^https:\/\/app\.instantly\.ai\//);
  assert.equal(c.fresh, true);
});
ok("promos and newsletters landing in a sending inbox (no campaign, no thread the developer wrote in) never show", () => {
  assert.equal(L.leadCards({ replies: [rep("p1", 1, { campaignId: null, from: "info@shop.example", subject: "FREE SHIPPING OVER $125" })] }, st, now).length, 0);
});
ok("a reply in a thread the developer wrote in by hand counts even without a campaign", () => {
  assert.equal(L.leadCards({ replies: [rep("h1", 1, { campaignId: null })], sent: [{ threadId: "t-h1" }] }, st, now).length, 1);
});
ok("replies from before the start never flood in", () => {
  assert.equal(L.leadCards({ replies: [rep("o1", 48 * 60)] }, st, now).length, 0);
  assert.equal(L.leadCards({ replies: [rep("r1", 1)] }, undefined, now).length, 0);
});
ok("one card per thread, the newest reply", () => {
  const cs = L.leadCards({ replies: [rep("a", 30, { threadId: "T" }), rep("b", 5, { threadId: "T", opening: "Also, Friday works." })] }, st, now);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].body, "Also, Friday works.");
});
ok("auto replies are filtered: automated acknowledgements, out of office, bounces, tickets, left the company", () => {
  assert.equal(auto("Hi! This is an automated response to let you know that we received your email and we're happy to hear from you!", "Hey! Thanks for getting in touch Re: Jane, I rebuilt your homepage"), true);
  assert.equal(auto("Thank you for your email. I am currently out of the office with limited access to email until Monday 3 November."), true);
  assert.equal(auto("I'm away on holiday until the 12th and will reply when I'm back."), true);
  assert.equal(auto("I am on maternity leave. For anything urgent please contact the team."), true);
  assert.equal(auto("Jane is no longer with Northwind Silk. Please contact hello@northwindsilk.example."), true);
  assert.equal(auto("Thanks for reaching out! We will get back to you within 24 hours.", "Re: Jane, I rebuilt your homepage"), true);
  assert.equal(auto("Your request (#48213) has been received and is being reviewed by our support staff."), true);
  assert.equal(auto("Delivery has failed to these recipients or groups.", "Undeliverable: Jane, I rebuilt your homepage", "postmaster@northwindsilk.example"), true);
  assert.equal(auto("Hello", "Automatic reply: Jane, I rebuilt your homepage"), true);
  assert.equal(auto("This inbox is no longer monitored."), true);
  assert.equal(L.isAutoReply({ type: "auto_reply_received", opening: "Hi" }), true);
});
ok("people are kept: interested, not interested, questions, short replies", () => {
  assert.equal(human("Hi the developer, this looks great. Can we talk on Tuesday?"), true);
  assert.equal(human("Not interested, thanks."), true);
  assert.equal(human("Thanks for reaching out! How much would this cost?"), true);
  assert.equal(human("I'm away this week but love it, can we chat next Monday?"), true);
  assert.equal(human("Please remove me from your list."), true);
  assert.equal(human("Who is this?"), true);
  assert.equal(human("Thanks for your email, the office manager handles the website, I've forwarded it."), true);
  assert.equal(human("We already have an agency, but thanks for the effort on the demo."), true);
  assert.equal(human("ok"), true);
});
ok("an auto reply in the feed raises no card", () => {
  assert.equal(L.leadCards({ replies: [rep("a1", 1, { opening: "This is an automated response. We received your email." })] }, st, now).length, 0);
});
ok("Dismiss clears it; a newer reply in the same thread brings it back", () => {
  const cards = L.leadCards({ replies: [rep("r1", 10)] }, st, now);
  const s2 = L.leadAnswer(st, cards, "n:r1", "dismiss", now)!;
  assert.equal(L.leadCards({ replies: [rep("r1", 10)] }, s2, now).length, 0);
  assert.equal(L.leadCards({ replies: [rep("r1", 10), rep("r2", 1, { threadId: "t-r1" })] }, s2, now).length, 1);
});
ok("Remind me in 15 mins hides it until then; it comes back fresh (chimes); the timer knows when", () => {
  const feed = { replies: [rep("r1", 60)] };
  const s2 = L.leadAnswer(st, L.leadCards(feed, st, now), "n:r1", 15, now)!;
  assert.equal(L.leadCards(feed, s2, now).length, 0);
  assert.equal(L.nextLeadRemind(s2, now), now + 15 * 60_000);
  const back = L.leadCards(feed, s2, now + 15 * 60_000 + 1);
  assert.equal(back.length, 1);
  assert.equal(back[0].fresh, true);
});
ok("an old dismissal is still respected after another card is answered", () => {
  const feed = { replies: [rep("a", 10), rep("b", 5)] };
  const s2 = L.leadAnswer(st, L.leadCards(feed, st, now), "n:a", "dismiss", now)!;
  const s3 = L.leadAnswer(s2, L.leadCards(feed, s2, now), "n:b", 15, now)!;
  assert.equal(L.leadCards(feed, s3, now + 20 * 60_000).map((c) => c.id).join(), "n:b");
});
ok("the same email by webhook (no thread yet) and then from the feed keeps one card id: one phone notification", () => {
  const hook = L.leadCards({ replies: [rep("em1", 2, { threadId: null, via: "webhook" })] }, st, now);
  const feed = L.leadCards({ replies: [rep("em1", 2, { threadId: "th9", at: iso(1.9) })] }, st, now);
  assert.equal(hook.length, 1); assert.equal(feed.length, 1);
  assert.equal(hook[0].id, "n:em1");
  assert.equal(feed[0].id, hook[0].id);
  assert.equal(feed[0].rev, hook[0].rev);   // the reply time differs between the two, the revision does not
});
ok("dismissed while it had no thread yet stays dismissed once the feed brings the thread", () => {
  const hookFeed = { replies: [rep("em2", 3, { threadId: null })] };
  const s2 = L.leadAnswer(st, L.leadCards(hookFeed, st, now), "n:em2", "dismiss", now)!;
  assert.equal(L.leadCards({ replies: [rep("em2", 3, { threadId: "th2", at: iso(2.9) })] }, s2, now).length, 0);
  // A newer email in that thread still shows.
  assert.equal(L.leadCards({ replies: [rep("em2", 3, { threadId: "th2" }), rep("em3", 1, { threadId: "th2" })] }, s2, now).length, 1);
});
ok("reminded while it had no thread yet stays hidden from the feed until due, then comes back as a new revision", () => {
  const s2 = L.leadAnswer(st, L.leadCards({ replies: [rep("em4", 30, { threadId: null })] }, st, now), "n:em4", 15, now)!;
  const feed = { replies: [rep("em4", 30, { threadId: "th4", at: iso(29.9) })] };
  assert.equal(L.leadCards(feed, s2, now + 60_000).length, 0);
  const [back] = L.leadCards(feed, s2, now + 15 * 60_000 + 1);
  assert.equal(back.id, "n:em4");
  assert.notEqual(back.rev, "");
});
ok("the webhook copy and the feed copy of one email in the feed at once make one card, the one with the thread", () => {
  const cards = L.leadCards({ replies: [rep("em5", 2, { threadId: null }), rep("em5", 2, { threadId: "th5", at: iso(1.9) })] }, st, now);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "n:em5");
  assert.equal(cards[0].key, "th5");
});
ok("dismissed with its thread stays dismissed when the other copy of the email has another reply time", () => {
  const s2 = L.leadAnswer(st, L.leadCards({ replies: [rep("em6", 3, { threadId: "th6", at: iso(3) })] }, st, now), "n:em6", "dismiss", now)!;
  assert.equal(L.leadCards({ replies: [rep("em6", 3, { threadId: "th6", at: iso(2.9) })] }, s2, now).length, 0);
  const s3 = L.leadAnswer(st, L.leadCards({ replies: [rep("em7", 30, { threadId: "th7", at: iso(30) })] }, st, now), "n:em7", 15, now)!;
  assert.equal(L.leadCards({ replies: [rep("em7", 30, { threadId: "th7", at: iso(29.9) })] }, s3, now + 60_000).length, 0);
});
ok("card ids fit the pop-up's 40 character limit", () => {
  const [c] = L.leadCards({ replies: [rep("x", 1, { threadId: "y".repeat(80) })] }, st, now);
  assert.ok(c.id.length <= 40);
});
console.log(`\n${n} passed`);
