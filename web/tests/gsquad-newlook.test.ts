// Run: node --experimental-strip-types tests/gsquad-newlook.test.ts
// PR 11, the G Squad New look: how chat messages are grouped, day lines, short times, unread counts, the send request
// and the New or Classic choice. Made up names only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const G = await import("../src/squad/chatgroups.ts");
const S = await import("../src/squad/chatsend.ts");
const L = await import("../src/squad/looks.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const line = (id: string, from: string, at: string, mine = false) => ({ id, from, name: from, mine, t: "hi " + id, at, edited: false, left: false });
const NOW = new Date(2026, 10, 14, 15, 0, 0);
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m, 0).toISOString();

ok("one sender close together is one group: first and last marked", () => {
  const items = G.groupChat([line("a", "kit", at(14, 9, 0)), line("b", "kit", at(14, 9, 1)), line("c", "kit", at(14, 9, 2))], { now: NOW });
  const m = items.filter((i) => i.kind === "msg") as any[];
  assert.deepEqual(m.map((x) => [x.first, x.last]), [[true, false], [false, false], [false, true]]);
});
ok("a different sender starts a new group", () => {
  const m = G.groupChat([line("a", "kit", at(14, 9, 0)), line("b", "sam", at(14, 9, 1)), line("c", "kit", at(14, 9, 2))], { now: NOW }).filter((i) => i.kind === "msg") as any[];
  assert.deepEqual(m.map((x) => [x.first, x.last]), [[true, true], [true, true], [true, true]]);
});
ok("a pause over five minutes starts a new group; exactly five does not", () => {
  const m = G.groupChat([line("a", "kit", at(14, 9, 0)), line("b", "kit", at(14, 9, 5)), line("c", "kit", at(14, 9, 11))], { now: NOW }).filter((i) => i.kind === "msg") as any[];
  assert.deepEqual(m.map((x) => [x.first, x.last]), [[true, false], [false, true], [true, true]]);
});
ok("classic grouping (gap Infinity) ignores the pause", () => {
  const m = G.groupChat([line("a", "kit", at(14, 9, 0)), line("b", "kit", at(14, 13, 0))], { gapMs: Infinity, now: NOW }).filter((i) => i.kind === "msg") as any[];
  assert.deepEqual(m.map((x) => [x.first, x.last]), [[true, false], [false, true]]);
});
ok("a new day gets a day line and always a new group", () => {
  const items = G.groupChat([line("a", "kit", at(13, 23, 59)), line("b", "kit", at(14, 0, 1))], { now: NOW });
  assert.deepEqual(items.map((i) => i.kind), ["day", "msg", "day", "msg"]);
  assert.equal((items[0] as any).label, "Yesterday");
  assert.equal((items[2] as any).label, "Today");
  const m = items.filter((i) => i.kind === "msg") as any[];
  assert.deepEqual(m.map((x) => [x.first, x.last]), [[true, true], [true, true]]);
});
ok("no messages, no items; keys are unique", () => {
  assert.deepEqual(G.groupChat([], { now: NOW }), []);
  const k = G.groupChat([line("a", "kit", at(14, 9, 0)), line("b", "sam", at(13, 9, 0))], { now: NOW }).map((i) => i.key);
  assert.equal(new Set(k).size, k.length);
});
ok("a bad date does not throw", () => {
  const items = G.groupChat([line("a", "kit", "nope"), line("b", "kit", "nope")], { now: NOW });
  assert.ok(items.length >= 2);
});
ok("time labels: clock today, Yesterday, short date; bad dates are empty", () => {
  assert.equal(G.listTime(at(14, 9, 5), NOW), "09:05");
  assert.equal(G.listTime(at(13, 9, 5), NOW), "Yesterday");
  assert.equal(G.listTime(at(6, 9, 5), NOW), "6 Nov");
  assert.equal(G.listTime("nope", NOW), "");
  assert.equal(G.clockTime(at(14, 21, 7)), "21:07");
  assert.equal(G.clockTime(""), "");
});
ok("unread counts: nothing at 0 or bad, the number, 99+ past ninety nine", () => {
  assert.equal(G.unreadText(0), ""); assert.equal(G.unreadText(-3), ""); assert.equal(G.unreadText(NaN), "");
  assert.equal(G.unreadText(7), "7"); assert.equal(G.unreadText(99), "99"); assert.equal(G.unreadText(100), "99+");
});
ok("a send: trimmed, blank is nothing, long text cut, chip kept, edit is an edit", () => {
  assert.equal(S.buildSend("   \n "), null);
  assert.deepEqual(S.buildSend("  hello  "), { op: "send", text: "hello" });
  assert.equal((S.buildSend("x".repeat(5000)) as any).text.length, 2000);
  const about = { k: "gym", l: "Leg day" } as any;
  assert.deepEqual(S.buildSend("hi", { about }), { op: "send", text: "hi", a: about });
  assert.deepEqual(S.buildSend("fix", { editId: "e1", about }), { op: "edit", id: "e1", text: "fix" });
});
ok("the look choice: New is the default, Classic is kept, junk falls back to New, the class follows", () => {
  assert.equal(L.DEFAULT_LOOKS.look, "new");
  assert.equal(L.cleanLooks(null).look, "new");
  assert.equal(L.cleanLooks({ look: "classic" }).look, "classic");
  assert.equal(L.cleanLooks({ look: "weird" }).look, "new");
  assert.ok(L.looksClass(L.cleanLooks({})).includes("lk-new"));
  assert.ok(L.looksClass(L.cleanLooks({ look: "classic" })).includes("lk-classic"));
  assert.deepEqual(L.LOOK_STYLES.map((x) => x.label), ["New", "Classic"]);
});
ok("saved looks from before this choice load as New with their other choices kept", () => {
  const m = new Map<string, string>([[L.LOOKS_KEY, JSON.stringify({ theme: "dark", bubbles: "soft", text: "xl", bg: "plain", accent: "blue" })]]);
  const l = L.readLooks({ getItem: (k: string) => m.get(k) ?? null });
  assert.equal(l.look, "new"); assert.equal(l.theme, "dark"); assert.equal(l.bubbles, "soft"); assert.equal(l.accent, "blue");
});
ok("the screens use the pieces: composer file, grouping, New CSS scoped to .lk-new, no brand names", () => {
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  assert.ok(/export function sendChat/.test(src("views/GSquadComposer.tsx")) && /export function useComposer/.test(src("views/GSquadComposer.tsx")));
  assert.ok(src("views/GSquadChat.tsx").includes("groupChat"));
  const css = src("views/gswnew.css");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("{").map((x) => x.split("}").pop()!.trim()).filter((s) => s && !s.startsWith("@media"));
  assert.ok(rules.every((r) => r.split(",").every((sel) => sel.trim().startsWith(".gsw.lk-new"))), "every selector is scoped");
  for (const f of ["views/gswnew.css", "views/GSquadComposer.tsx", "squad/chatgroups.ts", "squad/chatsend.ts"]) assert.ok(!/signal/i.test(src(f)), f);
});
console.log(`${n} passed`);
