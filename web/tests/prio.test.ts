// Priority 1 is an optional group at the top (core/prio.ts): who becomes P1 after a drag, P numbers.
import assert from "node:assert/strict";
import { movedId, p1AfterMove, prioNumbers, sortPrio, unrankedAfterMove, BG_DESIGNS, OLD_SCENES, bgDesign, p1Design, P1_DESIGNS,
  P1_COLORS, P1_ROW_BACK, colorHue, contrast, hueColor, p1Color, p1Tones } from "../src/core/prio.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("dragging to the very top with no P1 group makes it P1", () => {
  assert.equal(p1AfterMove(["c", "a", "b"], "c", new Set()), true);
  assert.equal(p1AfterMove(["a", "c", "b"], "c", new Set()), false);
});
ok("into the P1 group joins it; just below it stays out", () => {
  const p1 = new Set(["a", "b"]);
  assert.equal(p1AfterMove(["a", "x", "b", "c"], "x", p1), true);
  assert.equal(p1AfterMove(["a", "b", "x", "c"], "x", p1), false);
});
ok("a P1 task dragged below the group drops P1, and nothing forces one back", () => {
  assert.equal(p1AfterMove(["b", "a", "c"], "a", new Set(["a"])), false, "the only P1 task moved down one");
  assert.equal(p1AfterMove(["a", "b", "c"], "a", new Set(["a"])), true, "dropped back where it was");
  assert.equal(p1AfterMove(["b", "c", "a"], "a", new Set(["a", "b"])), false);
  assert.equal(p1AfterMove(["b", "a", "c"], "a", new Set(["a", "b"])), true, "the end of its own group: still P1");
});
ok("P numbers: the group is P1, the rest count from P2 (no P1 at all is fine)", () => {
  assert.deepEqual([...prioNumbers([{ id: "a", p1: true }, { id: "b", p1: true }, { id: "c", p1: false }, { id: "d", p1: false }]).values()], [1, 1, 2, 3]);
  assert.deepEqual([...prioNumbers([{ id: "c", p1: false }, { id: "d", p1: false }]).values()], [2, 3]);
});
ok("the P1 group always sorts first, then by order", () => {
  const d = (id: string, order: number, p1?: boolean) => ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order, p1 } }) as never;
  assert.deepEqual(sortPrio([d("a", 0), d("b", 5, true), d("c", 1)]).map((x: { id: string }) => x.id), ["b", "a", "c"]);
});
ok("the googly eyes look is gone (V1.53); anyone who had it gets the default look", () => {
  assert.ok(!P1_DESIGNS.some((d) => d.id === "eyes" || /watching/i.test(d.label)));
  assert.equal(p1Design("eyes"), "red-glisten");
});
ok("movedId finds the one task that moved", () => {
  assert.equal(movedId(["a", "b", "c", "d"], ["a", "c", "d", "b"]), "b");
  assert.equal(movedId(["a", "b", "c"], ["c", "a", "b"]), "c");
  assert.equal(movedId(["a", "b"], ["a", "b"]), null);
});
ok("outline and background are two separate choices, each with None", () => {
  assert.ok(P1_DESIGNS.some((d) => d.id === "none") && BG_DESIGNS.some((d) => d.id === "none"));
  assert.equal(bgDesign("storm-aimed"), "storm-aimed");
  assert.equal(bgDesign("red-glisten"), "none");        // an outline is never a background
  assert.equal(p1Design("spotlight"), "red-glisten");    // and a background never an outline
  for (const [old, to] of Object.entries(OLD_SCENES)) {  // old saved screen-wide looks move over
    assert.equal(bgDesign(to.bg), old); assert.equal(p1Design(to.outline), to.outline);
  }
});
// No priority (unranked, 27 Oct 2026): a task added without a place shows no P number until the developer
// drags it among the numbered tasks.
const t = (id: string, order: number, more: Record<string, unknown> = {}) => ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order, ...more } }) as never;
ok("a task with no priority gets no P number and does not use one up", () => {
  const nums = prioNumbers([{ id: "a", p1: true }, { id: "b", p1: false }, { id: "u", p1: false, unranked: true }, { id: "c", p1: false }]);
  assert.equal(nums.get("a"), 1);
  assert.equal(nums.get("b"), 2);
  assert.equal(nums.has("u"), false);
  assert.equal(nums.get("c"), 3, "the next numbered task carries on from P2, the unranked one skipped");
});
ok("tasks with no priority sort below the numbered ones, each group by order", () => {
  const list = [t("u1", 0, { unranked: true }), t("n2", 5), t("p", 9, { p1: true }), t("u2", 1, { unranked: true }), t("n1", 3)];
  assert.deepEqual(sortPrio(list).map((x: { id: string }) => x.id), ["p", "n1", "n2", "u1", "u2"]);
});
ok("old tasks (no unranked field) keep their numbers and order", () => {
  assert.deepEqual([...prioNumbers([{ id: "a", p1: false }, { id: "b", p1: false }]).values()], [2, 3]);
  assert.deepEqual(sortPrio([t("b", 2), t("a", 1)]).map((x: { id: string }) => x.id), ["a", "b"]);
});
ok("dragging a task with no priority among the numbered ones gives it a number", () => {
  const u = new Set(["u1", "u2"]);
  assert.equal(unrankedAfterMove(["n1", "u2", "n2", "u1"], "u2", u), false, "a numbered task below it");
  assert.equal(unrankedAfterMove(["u2", "n1", "n2", "u1"], "u2", u), false, "to the very top");
});
ok("moving it around among the other unranked tasks keeps it unranked", () => {
  const u = new Set(["u1", "u2"]);
  assert.equal(unrankedAfterMove(["n1", "n2", "u2", "u1"], "u2", u), true, "just below the last numbered task");
  assert.equal(unrankedAfterMove(["n1", "n2", "u1", "u2"], "u2", u), true);
});
ok("a numbered task dragged below an unranked one loses its number; elsewhere it keeps it", () => {
  const u = new Set(["u1"]);
  assert.equal(unrankedAfterMove(["n2", "u1", "n1"], "n1", u), true);
  assert.equal(unrankedAfterMove(["n2", "n1", "u1"], "n1", u), false);
  assert.equal(unrankedAfterMove(["n1", "n2"], "n1", new Set()), false, "no unranked tasks at all: nothing changes");
});
ok("P1 colour: only real colours are kept, cleaned to #rrggbb; anything else means unset", () => {
  assert.equal(p1Color("#FF2E3E"), "#ff2e3e");
  assert.equal(p1Color("f0a"), "#ff00aa");
  assert.equal(p1Color(" #3d7bff "), "#3d7bff");
  for (const bad of [null, undefined, "", "red", "#12345", "#1234567", "#ggg000", 42, {}]) assert.equal(p1Color(bad), null, String(bad));
});
ok("P1 colour: every preset reads on the darkest row and keeps its own colour", () => {
  assert.ok(P1_COLORS.length >= 8);
  for (const c of P1_COLORS) {
    assert.equal(p1Color(c.id), c.id, c.label);
    const t = p1Tones(c.id);
    assert.equal(t.text, c.id, `${c.label} is strong enough as it is`);
    assert.ok(contrast(t.text, P1_ROW_BACK) >= 4.5, c.label);
    assert.ok(contrast(t.on, t.accent) >= 3, `${c.label}: the P1 badge's text reads on it`);
  }
});
ok("P1 colour: a dark custom colour is lifted until it reads (navy, black)", () => {
  for (const c of ["#000080", "#000000", "#202020", "#400000"]) {
    const t = p1Tones(c);
    assert.ok(contrast(t.text, P1_ROW_BACK) >= 4.5, c);
    assert.ok(contrast(t.accent, P1_ROW_BACK) >= 3, c);
    assert.match(t.rgb, /^\d{1,3}, \d{1,3}, \d{1,3}$/);
  }
});
ok("P1 colour: the custom slider's hue goes to a strong colour and back", () => {
  assert.equal(hueColor(0), "#ff0000");
  assert.equal(hueColor(120), "#00ff00");
  assert.equal(hueColor(240), "#0000ff");
  assert.equal(hueColor(360), "#ff0000");
  for (let h = 0; h < 360; h += 7) assert.ok(Math.abs(colorHue(hueColor(h)) - h) <= 1, String(h));
});
console.log(`prio tests: ${n} passed`);
