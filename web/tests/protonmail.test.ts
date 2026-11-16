// Run: node --experimental-strip-types tests/protonmail.test.ts
// Proton Mail through Bridge (src/core/protonmail.ts): the rows PS hands over, who gets a row, the mirror and the words. FICTIONAL people only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const P = await import("../src/core/protonmail.ts");
const O = await import("../src/core/overlaymail.ts");
const MO = await import("../src/core/mailopen.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const client = { id: "c1", ws: null, kind: "client", data: { name: "Northwind Silk", contactName: "Jane Doe", email: "jane@northwindsilk.example", ws: "w1", createdAt: "2026-10-01T00:00:00Z" } } as never;
const archived = { id: "c2", ws: null, kind: "client", data: { name: "Old Co", email: "boss@oldco.example", archived: true, ws: "w1", createdAt: "2026-10-01T00:00:00Z" } } as never;
const row = (key: string, from: string, date: string, extra: Record<string, unknown> = {}) => ({ key, from, fromName: "Jane Doe", subject: "Homepage draft", snippet: "Can we move the banner up?", date, ...extra });

ok("cleanProtonRows keeps good rows and drops bad ones", () => {
  const rows = P.cleanProtonRows([row("h1", "Jane@NorthwindSilk.example", "2026-11-03T08:15:00Z"), row("h1", "dup@x.example", "2026-11-03T08:15:00Z"),
    row("bad key!", "a@b.example", "2026-11-03T08:15:00Z"), row("h2", "not an address", "2026-11-03T08:15:00Z"), row("h3", "a@b.example", "yesterday"), null, 7, "x"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, "jane@northwindsilk.example");
});
ok("cleanProtonRows limits sizes and the count", () => {
  const many = Array.from({ length: 90 }, (_, i) => row("k" + i, "a@b.example", "2026-11-03T08:15:00Z"));
  assert.equal(P.cleanProtonRows(many).length, 60);
  const [r] = P.cleanProtonRows([row("h1", "a@b.example", "2026-11-03T08:15:00Z", { subject: "s".repeat(900), snippet: "p".repeat(900) })]);
  assert.equal(r.subject.length, 300); assert.equal(r.snippet.length, 600);
  assert.deepEqual(P.cleanProtonRows("nope"), []);
});
ok("cleanProtonStatus: a link shows host, port and user; anything odd is dropped", () => {
  const s = P.cleanProtonStatus({ linked: true, host: "127.0.0.1", port: 1143, user: "me@example.com", problem: "bridgeDown", lastOk: 5, unread: 3, password: "secret", fingerprint: "aa" });
  assert.deepEqual(s, { linked: true, host: "127.0.0.1", port: 1143, user: "me@example.com", problem: "bridgeDown", linkProblem: null, lastOk: 5, unread: 3, checking: false });
  assert.ok(!("password" in s) && !("fingerprint" in s));
  assert.deepEqual(P.cleanProtonStatus({ linked: false, host: "x", problem: "bridgeDown" }), { ...P.NO_STATUS });
  assert.equal(P.cleanProtonStatus({ linked: true, problem: "<script>" }).problem, null);
  assert.deepEqual(P.cleanProtonStatus(null), P.NO_STATUS);
});
ok("a client's mail becomes a Proton row; strangers do not", () => {
  const rows = P.cleanProtonRows([row("h1", "jane@northwindsilk.example", "2026-11-03T08:15:00Z"), row("h2", "stranger@spam.example", "2026-11-03T09:00:00Z", { fromName: "Spam" })]);
  const out = P.protonMailRows(rows, [client], undefined, new Set());
  assert.equal(out.length, 1);
  assert.equal(out[0].via, "proton");
  assert.equal(out[0].cardId, "p:h1");
  assert.equal(out[0].who, "Jane");
  assert.equal(out[0].company, "Northwind Silk");
  assert.equal(out[0].subject, "Homepage draft");
  assert.equal(out[0].preview, "Can we move the banner up?");
  assert.equal(out[0].url, P.PROTON_INBOX);
});
ok("the Always notify list lets a stranger through, Mute beats a client, the person's own address never", () => {
  const rows = P.cleanProtonRows([row("h1", "friend@other.example", "2026-11-03T08:00:00Z"), row("h2", "jane@northwindsilk.example", "2026-11-03T09:00:00Z"), row("h3", "me@example.com", "2026-11-03T10:00:00Z")]);
  const notify = { e: { "friend@other.example": { l: "notify", at: "2026-11-01T00:00:00Z" } } };
  assert.deepEqual(P.protonMailRows(rows, [client], notify as never, new Set(["me@example.com"])).map((r) => r.cardId), ["p:h2", "p:h1"]);
  const mute = { e: { "jane@northwindsilk.example": { l: "mute", at: "2026-11-01T00:00:00Z" } } };
  assert.deepEqual(P.protonMailRows(rows, [client], mute as never, new Set(["me@example.com"])).map((r) => r.cardId), []);
});
ok("rows are newest first", () => {
  const rows = P.cleanProtonRows([row("h1", "jane@northwindsilk.example", "2026-11-03T08:00:00Z"), row("h2", "jane@northwindsilk.example", "2026-11-04T08:00:00Z")]);
  assert.deepEqual(P.protonMailRows(rows, [client, archived], undefined, new Set()).map((r) => r.cardId), ["p:h2", "p:h1"]);
});
ok("the card id and its key round trip, and Gmail or Instantly ids are not Proton's", () => {
  assert.equal(P.protonKeyOf(P.protonCardId("h1a2b3")), "h1a2b3");
  assert.equal(P.protonKeyOf("m:abc"), null); assert.equal(P.protonKeyOf("n:abc"), null); assert.equal(P.protonKeyOf("p:"), null); assert.equal(P.protonKeyOf("p:a b"), null);
  assert.equal(O.cleanReplyCardId("p:h1"), null);   // the Gmail and Instantly reply paths never take a Proton row
  assert.equal(O.replyButtonShows({ mode: "ps", mail: true, cardId: "p:h1" }), false);
});
ok("a Proton row sits in the panel's list with the others, newest first", () => {
  const proton = P.protonMailRows(P.cleanProtonRows([row("h1", "jane@northwindsilk.example", "2026-11-05T08:00:00Z")]), [client], undefined, new Set());
  const gmail = [{ cardId: "m:r1", via: "gmail" as const, who: "Sam", company: null, subject: "x", preview: "", at: "2026-11-04T08:00:00Z", url: "https://mail.google.com/", count: 1 }];
  assert.deepEqual(O.mailRows([...gmail, ...proton], []).map((r) => r.cardId), ["p:h1", "m:r1"]);
  assert.equal(MO.newestOf(O.mailRows([...gmail, ...proton], []), "gmail"), "m:r1");
});
ok("the mirror takes rows and status from PS, ignores other messages, and tells listeners only on a change", () => {
  P.protonMirror.reset();
  let calls = 0;
  const off = P.protonMirror.subscribe(() => calls++);
  assert.equal(P.protonShellMessage({ type: "tg:res" }), false);
  const m = { type: "proton:rows", rows: [row("h1", "a@b.example", "2026-11-03T08:15:00Z")], status: { linked: true, host: "127.0.0.1", port: 1143, user: "me@example.com", unread: 1 } };
  assert.equal(P.protonShellMessage(m), true);
  assert.equal(P.protonMirror.get().rows.length, 1); assert.equal(P.protonMirror.get().status.linked, true);
  const before = calls;
  P.protonShellMessage(m);
  assert.equal(calls, before);
  off();
});
ok("a reply's answer is kept per email, cleaned, and can be cleared", () => {
  P.protonMirror.reset();
  P.protonShellMessage({ type: "proton:sent", key: "h1", ok: true });
  P.protonShellMessage({ type: "proton:sent", key: "h2", ok: false, error: "bridgeDown" });
  P.protonShellMessage({ type: "proton:sent", key: "h3", ok: false, error: "<b>x</b>" });
  P.protonShellMessage({ type: "proton:sent", key: "bad key", ok: true });
  const s = P.protonMirror.get().sent;
  assert.deepEqual(s.h1, { ok: true, error: null }); assert.equal(s.h2.error, "bridgeDown"); assert.equal(s.h3.error, "protocol"); assert.ok(!("bad key" in s));
  P.clearProtonSent("h2");
  assert.ok(!("h2" in P.protonMirror.get().sent));
});
ok("every problem code has plain words, and the cert one asks the person to decide", () => {
  for (const c of ["bridgeDown", "badPassword", "certChanged", "notLoopback", "badInput", "timeout", "protocol", "keychain", "noLink", "gone", "maybeSent"]) assert.ok(P.protonProblemWords(c).length > 10, c);
  assert.equal(P.protonProblemWords("nope"), ""); assert.equal(P.protonProblemWords(null), "");
  assert.match(P.protonProblemWords("certChanged"), /Trust the new one/);
});
ok("no em or en dash anywhere in the words, and the password is never asked for on the page", () => {
  const all = JSON.stringify(P.PROTON_WORDS) + JSON.stringify(P.PROTON_PROBLEMS);
  assert.ok(!/[–—]/.test(all));
  assert.match(P.PROTON_WORDS.keychain, /Keychain/);
});
ok("ago words", () => {
  assert.equal(P.protonAgo(null), ""); assert.equal(P.protonAgo(1000, 1000), "just now"); assert.equal(P.protonAgo(0 + 1, 1 + 5 * 60_000), "5 min ago");
});
ok("the panel sends a Proton reply only from inside the Undo callback, and the page never names who it goes to", () => {
  const tm = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
  const sends = tm.match(/type: "proton:reply"/g) || [];
  assert.equal(sends.length, 1, "one place posts a Proton reply");
  assert.match(tm, /startUndoSend\(\(\) => \{ dropUndo\(r\.cardId\); clearProtonSent\(pk\); psPost\(\{ type: "proton:reply", key: pk, text \}\); \}\)/);
  assert.ok(!/proton:reply[^\n]*\bto:/.test(tm), "the page never says who it goes to: PS uses its own copy of the email");
});
console.log(`${n} passed`);
