// Unit tests for stacked notifications (PS 1.65): the page's stack model, read straight out of Sources/Toast.swift between
// its ">>> stack model" and "<<< stack model" lines, so this checks the code PS ships. No window, no page, no clock (time is
// passed in). Run: node tests/notestack-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const swift = readFileSync(join(here, "..", "Sources", "Toast.swift"), "utf8");
let passed = 0;
function ok(name, cond, more = "") {
  if (cond) { passed++; console.log(`ok - ${name}`); } else { console.log(`FAIL - ${name} ${more}`); process.exit(1); }
}
const a = swift.indexOf("// >>> stack model"), b = swift.indexOf("// <<< stack model");
ok("the stack model block is in Toast.swift", a > 0 && b > a);
ok("no long dashes in the block", !/[–—]/.test(swift.slice(a, b)));
const Stack = new Function(swift.slice(a, b) + "\nreturn Stack;")();
const ca = swift.indexOf("// >>> card clock"), cb = swift.indexOf("// <<< card clock");
ok("the card clock block is in Toast.swift", ca > 0 && cb > ca && !/[–—]/.test(swift.slice(ca, cb)));
const Clock = new Function(swift.slice(ca, cb) + "\nreturn Clock;")();
const mk = (n, on = true) => { const s = Stack.make(); Stack.setOn(s, on); Stack.count(s, n); return s; };

// ---------- the badge: 0, 1, 2, 5, 50 notifications, never +0 ----------
ok("0 cards: no badge", Stack.text(0) === "" && Stack.more(0) === 0);
ok("1 card: no badge, never +0", Stack.text(1) === "" && !Stack.text(1).includes("0"));
ok("2 cards: +1", Stack.text(2) === "+1");
ok("5 cards: +4 (the developer's own example)", Stack.text(5) === "+4");
ok("50 cards: +49", Stack.text(50) === "+49");
for (let n = -3; n <= 60; n++) { const t = Stack.text(n); if (t === "+0" || t === "+-1" || (n > 1 && t !== "+" + (n - 1)) || (n <= 1 && t !== "")) ok("badge text right for " + n, false, t); }
ok("badge text right for every count from -3 to 60", true);
ok("a bad count counts as none", Stack.text(NaN) === "" && Stack.text(undefined) === "");

// ---------- shut and open ----------
for (const n of [0, 1]) { const s = mk(n); ok(`${n} card: never grouped, never shut`, !Stack.grouped(s) && !Stack.shut(s, 0) && !Stack.open(s, 0)); }
for (const n of [2, 5, 50]) { const s = mk(n); ok(`${n} cards: shut at first (newest plus a badge)`, Stack.shut(s, 0) && !Stack.open(s, 0)); }
{ const s = mk(5, false); ok("switch off: never grouped, every card as today", !Stack.grouped(s) && !Stack.shut(s, 0)); Stack.enter(s); ok("switch off: hover does nothing", !s.hover && !Stack.open(s, 0)); }
{ const s = mk(5, false); Stack.setOn(s, true); Stack.count(s, 5); ok("switch back on: shut again", Stack.shut(s, 0)); }

// ---------- hover, grace, leave ----------
{
  const s = mk(5);
  Stack.enter(s);
  ok("hover opens it", Stack.open(s, 100) && !Stack.shut(s, 100));
  Stack.leave(s, 1000);
  ok("still open right after the pointer leaves (grace)", Stack.open(s, 1000 + Stack.GRACE - 1));
  ok("shut once the grace is over", Stack.shut(s, 1000 + Stack.GRACE));
  ok("the timer asks for exactly the grace end", Stack.due(s, 1100) === 1000 + Stack.GRACE);
  Stack.tick(s, 1000 + Stack.GRACE);
  ok("tick clears it, nothing due after", Stack.due(s, 2000) === 0 && Stack.shut(s, 2000));
}
{
  const s = mk(5);
  Stack.enter(s); Stack.leave(s, 1000); Stack.enter(s);
  ok("coming back inside the grace keeps it open and cancels the timer", Stack.open(s, 5000) && Stack.due(s, 1100) === 0);
}
{ const s = mk(3); Stack.leave(s, 100); ok("leaving without having entered changes nothing", Stack.shut(s, 100) && Stack.due(s, 100) === 0); }

// ---------- arrival during hover ----------
{
  const s = mk(3); Stack.enter(s);
  Stack.count(s, 4);
  ok("a card arriving while hovering keeps it open, badge now +3", Stack.open(s, 10) && Stack.text(s.n) === "+3");
  Stack.count(s, 50);
  ok("fifty arriving: still open, +49", Stack.open(s, 10) && Stack.text(s.n) === "+49");
}
{
  const s = mk(2);
  Stack.count(s, 3);
  ok("arrival while shut: still shut, badge grows to +2", Stack.shut(s, 0) && Stack.text(s.n) === "+2");
}
{
  const s = mk(1); Stack.count(s, 2);
  ok("second card arriving makes the badge +1", Stack.shut(s, 0) && Stack.text(s.n) === "+1");
}

// ---------- dismiss during hover ----------
{
  const s = mk(4); Stack.enter(s);
  Stack.count(s, 3);
  ok("dismiss one while hovering: stays open, +2", Stack.open(s, 0) && Stack.text(s.n) === "+2");
  Stack.count(s, 2);
  ok("down to two: still open, +1", Stack.open(s, 0) && Stack.text(s.n) === "+1");
  Stack.count(s, 1);
  ok("down to one: no badge, not grouped, hover forgotten", !Stack.grouped(s) && !s.hover && Stack.text(1) === "" && !Stack.open(s, 0));
  Stack.count(s, 0);
  ok("down to none: nothing", !Stack.grouped(s) && Stack.text(0) === "");
  Stack.count(s, 2);
  ok("a new pair after that starts shut (no stale hover)", Stack.shut(s, 0));
}
{
  const s = mk(3); Stack.enter(s); Stack.leave(s, 0);
  Stack.count(s, 1);
  ok("dismiss down to one during the grace: timer state cleared", Stack.due(s, 10) === 0 && !Stack.open(s, 10));
}

// ---------- a click keeps it open, Esc closes ----------
{
  const s = mk(5);
  ok("Esc with nothing open does nothing and is not used up", Stack.esc(s, 0) === false);
  Stack.enter(s); ok("Esc on a list only the pointer holds open closes it and is used up (the real key never reaches the page)", Stack.esc(s, 0) === true && Stack.shut(s, 0));
  Stack.leave(s, 5); Stack.enter(s); Stack.pin(s); Stack.leave(s, 1000);
  ok("clicked: stays open after the pointer leaves", Stack.open(s, 1000 + Stack.GRACE + 100));
  ok("clicked: the away timer is the next thing due", Stack.due(s, 2000) === 1000 + Stack.AWAY);
  ok("clicked: shuts by itself after the away time", Stack.shut(s, 1000 + Stack.AWAY));
  Stack.tick(s, 1000 + Stack.AWAY);
  ok("clicked: the away time lets go of the click", !s.pinned);
}
{
  const s = mk(5); Stack.enter(s); Stack.pin(s);
  ok("Esc closes a clicked list and is used up", Stack.esc(s, 0) === true && Stack.shut(s, 0));
  Stack.enter(s);
  ok("pointer still resting there: stays shut after Esc", Stack.shut(s, 0));
  Stack.leave(s, 10); Stack.enter(s);
  ok("after the pointer left and came back it opens again", Stack.open(s, 10));
}
{
  const s = mk(5); Stack.enter(s); Stack.pin(s); Stack.count(s, 1);
  ok("clicked list down to one card: let go", !s.pinned && Stack.esc(s, 0) === false);
}
{
  const s = mk(1); Stack.pin(s);
  ok("a click on a single card pins nothing", !s.pinned);
}
{
  const s = mk(5); Stack.enter(s); Stack.pin(s); Stack.setOn(s, false);
  ok("switch turned off while open: everything let go", !s.hover && !s.pinned && !Stack.grouped(s));
}

// ---------- the real key path: tap, then the app, then the page ----------
const main = readFileSync(join(here, "..", "Sources", "main.swift"), "utf8");
{
  const tap = main.split("\n").find((l) => l.includes("keyboardEventKeycode) == 53") && l.includes("HelperAlert.upNow")) || "";
  ok("the global key handler passes Esc on while a notification list is open", tap.includes("Toast.stackOpenNow"), tap);
  const esc = main.slice(main.indexOf("func escKey()"), main.indexOf("guard shown else { escapeOut()", main.indexOf("func escKey()")));
  ok("the app's Esc reaches the notification list before anything else of the list's", esc.includes("Toast.shared.escapeStack()"));
  const local = main.slice(main.indexOf("func localEsc"), main.indexOf("func localEsc") + 1200);
  ok("a focused PS window's Esc reaches it too", local.includes("Toast.shared.escapeStack()"));
  ok("Toast sets and clears the open flag the tap reads", swift.includes("NoteStackCore.watch.set(") && swift.includes("static var stackOpenNow") && swift.includes("stackOpen = NoteStackCore.open(from: msg)"));
  ok("the page tells Swift when the list is open, not only pinned", swift.includes("post({type:'stack',pinned:stkPin,open:stkOpen})"));
  // The whole chain on the model: open by hover only, no click, no focus: the key tap asks the page, the page closes it.
  const s = mk(4); Stack.enter(s);
  ok("hover only: open, so the tap would pass Esc on", Stack.open(s, 0));
  ok("then the page closes it and says it used the key", Stack.esc(s, 0) === true && !Stack.open(s, 0) && !s.pinned);
}

// ---------- hidden cards keep their time (the card clock) ----------
{
  const mkc = (n) => Array.from({ length: n }, () => ({ sticky: false, held: false, run: false, left: 14000, t0: 0 }));
  // a burst of 5 at once, list shut: only the newest runs
  const cs = mkc(5), shut = (i) => i > 0;
  let r = Clock.sync(cs, shut, 0);
  ok("a burst of 5, list shut: only the newest card's time starts", r.start.length === 1 && r.start[0] === cs[0] && cs.slice(1).every((c) => !c.run));
  r = Clock.sync(cs, shut, 14000);
  ok("14 s later the hidden four still have all their time", cs.slice(1).every((c) => c.left === 14000 && !c.run));
  const open = () => false;
  r = Clock.sync(cs, open, 20000);
  ok("the list opens: the hidden four start with their full time, the newest keeps running", r.start.length === 4 && cs[0].run && cs[0].left === 14000);
  ok("a card that just started has its full 14 s", Clock.due(cs[1]) === 14000);
  r = Clock.sync(cs, shut, 25000);
  ok("the list shuts again: the four stop and keep what they had left (5 s of it used)", r.stop.length === 4 && cs.slice(1).every((c) => c.left === 14000 - 5000 && !c.run));
  ok("the newest card never stopped", cs[0].run);
}
{
  const cs = [{ sticky: false, held: false, run: false, left: 14000, t0: 0 }, { sticky: true, held: false, run: false, left: 14000, t0: 0 }];
  Clock.sync(cs, () => false, 0);
  ok("a sticky card never gets a clock", !cs[1].run);
  cs[0].held = true; const r = Clock.sync(cs, () => false, 4000);
  ok("the pointer on a card stops its time and keeps what is left", r.stop.length === 1 && cs[0].left === 10000);
  cs[0].held = false; const r2 = Clock.sync(cs, () => false, 9000);
  ok("the pointer leaves: it runs again from where it was", r2.start.length === 1 && Clock.due(cs[0]) === 10000);
  cs[0].left = 100; ok("never less than 2.5 s once running again", Clock.due(cs[0]) === Clock.MIN);
  const again = Clock.sync(cs, () => false, 9500);
  ok("syncing again changes nothing", again.start.length === 0 && again.stop.length === 0);
}
ok("only the badge opens the list on hover: the shut hit area has no card in it", /if\(stkCol\)rs\.push\(badge\.getBoundingClientRect\(\)\);/.test(swift) && !swift.includes("rs.push(cards[0]"));
ok("the newest card keeps its place when the list opens: the bar's room is kept while shut", swift.includes("var off=cards.length>1?BAR:0,y=TOP+off"));
ok("cards ignore the pointer for a moment after the list opens", swift.includes("#wrap.settle .card{pointer-events:none}") && swift.includes("function settle()"));
ok("a click on a card keeps nothing open", swift.includes("if(t&&t.closest&&t.closest('.card'))return;"));

// ---------- the whole page still parses with the new code in it ----------
const aiCard = readFileSync(join(here, "..", "Sources", "AiMessageCard.swift"), "utf8");
const sqCard = readFileSync(join(here, "..", "Sources", "SquadMessageCard.swift"), "utf8");
const raw = (src, n) => { const i = src.indexOf('#"""', src.indexOf(n)) + 4; return src.slice(i, src.indexOf('"""#', i)); };
const page = swift.slice(swift.indexOf('private static let page = #"""'), swift.lastIndexOf('"""#'))
  .replace("\\#(AiMessageCard.js)", () => raw(aiCard, "static let js")).replace("\\#(SquadMessageCard.js)", () => raw(sqCard, "static let js"))
  .replace("\\#(AiMessageCard.css)", () => raw(aiCard, "static let css")).replace("\\#(SquadMessageCard.css)", () => raw(sqCard, "static let css"));
const script = page.slice(page.indexOf("<script>") + 8, page.lastIndexOf("</script>"));
let parses = true, why = "";
try { new Function(script); } catch (e) { parses = false; why = String(e); }
ok("the card page's script parses", parses, why);
ok("no long dashes in the page", !/[–—]/.test(page));
ok("the page has the badge and its words", page.includes('id="badge"') && page.includes("more notifications"));

console.log(`${passed} checks passed`);
