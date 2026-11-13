// Unit tests for the AI chats bubble (V1.56, Sources/Toast.swift's card page): every finished AI chat is a row of one
// bubble, each row with its own clock that the pointer on the bubble holds, a circle that shrinks over that clock, and
// "X secs ago" counting up. The model is read straight out of Toast.swift (between its ">>> chat rows model" and
// "<<< chat rows model" lines), so this checks the code PS ships. No window, no page, nothing on the screen: safe while
// someone uses the Mac. Run: node tests/chatgroup-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const swift = readFileSync(join(here, "..", "Sources", "Toast.swift"), "utf8");
let passed = 0;
function ok(name, cond, more = "") {
  if (cond) { passed++; console.log(`ok - ${name}`); } else { console.log(`FAIL - ${name} ${more}`); process.exit(1); }
}

// ---------- the whole page script parses ----------
// V1.58: the page takes the AI message card's style and script from AiMessageCard.swift (\#(...) in Swift); filled in here.
const aiCard = readFileSync(join(here, "..", "Sources", "AiMessageCard.swift"), "utf8");
const aiRaw = (n) => { const i = aiCard.indexOf('#"""', aiCard.indexOf(n)) + 4; return aiCard.slice(i, aiCard.indexOf('"""#', i)); };
const page = swift.slice(swift.indexOf('private static let page = #"""'), swift.lastIndexOf('"""#'))
  .replace("\\#(AiMessageCard.css)", () => aiRaw("static let css")).replace("\\#(AiMessageCard.js)", () => aiRaw("static let js"));
const script = page.slice(page.indexOf("<script>") + 8, page.lastIndexOf("</script>"));
let parses = true, why = "";
try { new Function(script); } catch (e) { parses = false; why = String(e); }
ok("the card page's script parses", parses, why);
ok("no long dashes in the page", !/[\u2013\u2014]/.test(page));

// ---------- the model ----------
const a = script.indexOf("// >>> chat rows model"), b = script.indexOf("// <<< chat rows model");
ok("the model block is there", a > 0 && b > a);
const ChatRows = new Function(script.slice(a, b) + "\nreturn ChatRows;")();

const T0 = Date.parse("2026-11-13T10:00:00Z");
const card = (id, title, life = 10, sub = "Claude finished", at = T0) => ({ id, title, sub, life, at: new Date(at).toISOString() });

// Grouping: newest at the top, one row per chat.
{
  const g = ChatRows.make();
  ChatRows.add(g, card("c:a", "PS app manager chat"), T0);
  ChatRows.add(g, card("c:b", "Fictional login fix"), T0 + 1000);
  ok("two finished chats: two rows in one bubble", g.rows.length === 2);
  ok("the newest chat is the top row", g.rows[0].id === "c:b" && g.rows[1].id === "c:a");
  ChatRows.add(g, card("c:a", "PS app manager chat", 10, "Claude finished", T0 + 5000), T0 + 5000);
  ok("the same chat finishing again replaces its row and goes to the top", g.rows.length === 2 && g.rows[0].id === "c:a");
  ok("its clock starts again", g.rows[0].used === 0);
  ok("one tool: the line reads Claude finished once", ChatRows.head(g) === "Claude finished" && !ChatRows.mixed(g));
  ChatRows.add(g, card("c:codex-x", "Fictional Codex thread", 10, "Codex finished"), T0 + 6000);
  ok("mixed tools: each row says its tool and the line reads AI chats finished", ChatRows.mixed(g) && ChatRows.head(g) === "AI chats finished" && g.rows[0].tool === "Codex" && g.rows[1].tool === "Claude");
  ok("private mode: a plain count, no names", ChatRows.discreet(g) === "3 AI chats finished");
  const one = ChatRows.make(); ChatRows.add(one, card("c:z", "Secret fictional name"), T0);
  ok("private mode with one chat", ChatRows.discreet(one) === "A Claude chat finished");
  ChatRows.add(one, card("c:y", "Another"), T0);
  ok("private mode with two Claude chats", ChatRows.discreet(one) === "2 Claude chats finished");
  ok("a card with no tool line counts as Claude", ChatRows.add(ChatRows.make(), { id: "c:q", title: "x", at: new Date(T0).toISOString(), life: 10 }, T0).tool === "Claude");
}

// Row timers and expiry: each row runs out after its own time (10 s by default), the circle shrinks meanwhile.
{
  const g = ChatRows.make();
  ChatRows.add(g, card("c:a", "First"), T0);
  ChatRows.add(g, card("c:b", "Second"), T0 + 4000);
  ok("a fresh row's circle is full size", ChatRows.size(g.rows[0]) === 1 && ChatRows.left(g.rows[0]) === 1);
  ok("nothing runs out early", ChatRows.tick(g, T0 + 9000).length === 0 && g.rows.length === 2);
  ok("at half its time the circle is smaller", Math.abs(ChatRows.left(g.rows[1]) - 0.1) < 0.001 && ChatRows.size(g.rows[1]) < 0.4 && ChatRows.size(g.rows[0]) > ChatRows.size(g.rows[1]));
  const out = ChatRows.tick(g, T0 + 10000);
  ok("the first row runs out at 10 s, the second stays", out.length === 1 && out[0].id === "c:a" && g.rows.length === 1 && g.rows[0].id === "c:b");
  ok("the circle shrinks to a dot, never to nothing", ChatRows.size({ life: 10000, used: 10000 }) === 0.22);
  const out2 = ChatRows.tick(g, T0 + 14000);
  ok("the second runs out 10 s after it came", out2.length === 1 && out2[0].id === "c:b" && g.rows.length === 0);
}
{
  const g = ChatRows.make();
  ChatRows.add(g, card("c:a", "One", 5), T0);
  ChatRows.add(g, card("c:b", "Two", 5), T0);
  ok("two rows that run out together both come back from the same tick", ChatRows.tick(g, T0 + 5000).length === 2 && g.rows.length === 0);
}

// Hovering the bubble holds every row's clock; leaving lets them run on from where they were.
{
  const g = ChatRows.make();
  ChatRows.add(g, card("c:a", "A"), T0);
  ChatRows.add(g, card("c:b", "B"), T0 + 2000);
  ChatRows.hold(g, true, T0 + 6000);                     // pointer on the bubble at 6 s
  ok("held: nothing runs out, however long", ChatRows.tick(g, T0 + 60000).length === 0 && g.rows.length === 2);
  ok("held: the circles stay where they were", Math.abs(ChatRows.left(g.rows[1]) - 0.4) < 0.001 && Math.abs(ChatRows.left(g.rows[0]) - 0.6) < 0.001);
  ChatRows.hold(g, false, T0 + 60000);                   // pointer leaves
  const out = ChatRows.tick(g, T0 + 64000);
  ok("let go: the older row runs out 4 s later", out.length === 1 && out[0].id === "c:a");
  ok("and the newer 2 s after that", ChatRows.tick(g, T0 + 66000).length === 1 && g.rows.length === 0);
}

// Off (0) and the limits.
{
  const g = ChatRows.make();
  ChatRows.add(g, card("c:a", "Stays", 0), T0);
  ok("Off: a row never runs out", ChatRows.tick(g, T0 + 3600_000).length === 0 && ChatRows.size(g.rows[0]) === 1);
  ChatRows.add(g, card("c:b", "Short", 1), T0);
  ok("a time under 3 s counts as 3 s", g.rows[0].life === 3000);
  ChatRows.add(g, card("c:c", "Long", 9999), T0);
  ok("a time over 10 minutes counts as 10 minutes", g.rows[0].life === 600000);
}

// One row dismissed on its own.
{
  const g = ChatRows.make();
  ChatRows.add(g, card("c:a", "A"), T0); ChatRows.add(g, card("c:b", "B"), T0); ChatRows.add(g, card("c:c", "C"), T0);
  const r = ChatRows.drop(g, "c:b");
  ok("dropping one row leaves the others in order", r && r.id === "c:b" && g.rows.map((x) => x.id).join() === "c:c,c:a");
  ok("dropping a row that is not there does nothing", ChatRows.drop(g, "c:nope") === null && g.rows.length === 2);
  ok("find", ChatRows.find(g, "c:a") && !ChatRows.find(g, "c:b"));
}

// "X secs ago", counting up from when the chat finished.
{
  const ago = (s) => ChatRows.ago(T0, T0 + s * 1000);
  ok("just now", ago(0) === "just now");
  ok("1 sec ago", ago(1) === "1 sec ago");
  ok("7 secs ago", ago(7.9) === "7 secs ago");
  ok("59 secs ago", ago(59) === "59 secs ago");
  ok("1 min ago", ago(60) === "1 min ago");
  ok("5 mins ago", ago(330) === "5 mins ago");
  ok("1 hr ago", ago(3600) === "1 hr ago");
  ok("2 hrs ago", ago(7300) === "2 hrs ago");
  ok("a clock a little behind never says minus", ChatRows.ago(T0 + 5000, T0) === "just now");
}

// V1.57: the card stack self test (Sources/StackSelfTest.swift) needs cards that each stay their own card. Finished AI
// chat cards are rows of one bubble, so with them the stack never held more than one card and the 3 and 12 card checks
// failed (found 13 Nov 2026 after V1.57's merge; the bubble came in V1.56).
{
  const st = readFileSync(join(here, "..", "Sources", "StackSelfTest.swift"), "utf8");
  const addFn = st.slice(st.indexOf("func add(_ i: Int)"), st.indexOf("func addMany("));
  ok("the stack self test adds cards that stack (not AI chat rows)", addFn.includes('"tone": "mail"') && !addFn.includes('"tone": "done"') && !/c:test-s/.test(st));
  ok("this page groups only AI chat cards into the bubble", /if\(d\.kind==='meet'&&d\.tone==='done'\)\{addChat\(d\);return\}/.test(script));
}
console.log(`\n${passed} AI chats bubble checks passed`);
