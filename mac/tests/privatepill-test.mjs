// Unit tests for private mode on the Mac's card page (V1.57, Sources/Toast.swift). A friend of the developer's (V1.56): "In
// private mode, PS still shows the full cards with their sounds, covering the screen and showing what Claude
// finished." The rule is read straight out of Toast.swift (between ">>> private pill model" and "<<< private pill
// model"), so this checks the code PS ships, and the page around it is checked to use it for every card. No window,
// nothing on screen. Run: node tests/privatepill-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, "..", "Sources", f), "utf8");
const swift = src("Toast.swift");
let passed = 0;
function ok(name, cond, more = "") {
  if (cond) { passed++; console.log(`ok - ${name}`); } else { console.log(`FAIL - ${name} ${more}`); process.exit(1); }
}
const page = swift.slice(swift.indexOf('private static let page = #"""'), swift.lastIndexOf('"""#'));
const script = page.slice(page.indexOf("<script>") + 8, page.lastIndexOf("</script>"));
let parses = true, why = "";
try { new Function(script); } catch (e) { parses = false; why = String(e); }
ok("the card page's script parses", parses, why);
const a = script.indexOf("// >>> private pill model"), b = script.indexOf("// <<< private pill model");
ok("the pill model block is there", a > 0 && b > a);
const Pill = new Function(script.slice(a, b) + "\nreturn Pill;")();

// ---------- the words: only that there is something, and that private mode is on ----------
ok("the pill says New notification", Pill.t === "New notification");
ok("and Private mode is on", Pill.s === "Private mode is on");

// ---------- which cards are pills ----------
const kinds = [
  { kind: "meet", tone: "done", title: "Fictional chat" },          // AI chat finished (one row of the bubble)
  { kind: "meet", tone: "mail", title: "Jane Fictional" },          // client email
  { kind: "meet", tone: "lead", title: "Lena replied" },            // Instantly lead
  { kind: "meet", tone: "booked", title: "Call with Northwind" },   // meeting
  { kind: "meet", tone: "warn", title: "Wi-Fi slow" },              // network
  { title: "Gym in 30 minutes", actions: [{ id: "ack" }] },          // the gym card and other plain cards
  { title: "Shall I end my day now?", actions: [{ id: "yes" }] },
  { title: "File from the M1" },
];
for (const d of kinds) {
  const c = { data: { ...d } };
  ok(`private mode on: "${d.title}" is a pill`, Pill.shut(c, true, false) === true);
  ok(`private mode off: "${d.title}" shows as itself`, Pill.shut(c, false, false) === false);
  ok(`clicked: "${d.title}" shows as itself`, Pill.shut({ data: { ...d }, shown: true }, true, false) === false);
  ok(`Tab held: "${d.title}" shows as itself`, Pill.shut(c, true, true) === false);
}
ok("the AI chats bubble is a pill too", Pill.shut({ group: true, data: { kind: "meet", tone: "done", discreet: true } }, true, false));
ok("a meeting card sent discreet is a pill even before the page hears private mode", Pill.shut({ data: { kind: "meet", tone: "booked", discreet: true } }, false, false));
ok("a pop up waiting behind a pill is always one (nothing else to show here)", Pill.shut({ data: { pill: true }, shown: true }, false, true));

// ---------- the page uses it for every card ----------
ok("shut() is the model's rule", /function shut\(c\)\{return Pill\.shut\(c,privacyOn,revealAll\)\}/.test(script));
ok("paint() puts the pill on every card first", /function paint\(c\)\{\s*pillEl\(c\);c\.el\.classList\.toggle\('pill',shut\(c\)\);/.test(script));
ok("plain cards (not only meeting ones) are painted when they arrive", /Click to open in Gmail'\)\);\s*paint\(c\);/.test(script));
ok("private mode on or off repaints EVERY card, not only meeting ones", /privacy:function\(on\)\{privacyOn=!!on;cards\.forEach\(function\(c\)\{[^}]*\}?[^}]*paint\(c\)\}\);layout\(\)\}/.test(script) && !/privacy:function\(on\)\{[^\n]*if\(c\.data\.kind==='meet'\)\{c\.data\.discreet/.test(script));
ok("the first click on a pill shows the card (any card)", /if\(shut\(c\)\)\{c\.shown=true;paint\(c\);/.test(script));
ok("a waiting pop up's pill asks Swift to bring it out", /if\(c\.data\.pill\)\{post\(\{type:'action',id:c\.data\.id,action:'show'\}\);remove\(c\);return\}/.test(script));
ok("the pill element holds only the lock and the two lines", /c\.pv\.appendChild\(el\('b','',Pill\.t\)\);c\.pv\.appendChild\(el\('span','',Pill\.s\)\)/.test(script));
ok("a pill hides the whole card inside, its x and its line", page.includes(".card.pill>.in,.card.pill>.x,.card.pill>.life{display:none}"));
ok("the pill is small: as wide as its words, round", /\.card\.pill\{left:auto;right:14px;width:max-content;[^}]*border-radius:99px/.test(page));
ok("no long dashes in the page", !/[–—]/.test(page));

// ---------- the Mac side: pills for pop ups with windows of their own, and no card sounds ----------
ok("Swift's pill card carries only the two lines", /\["id": id, "title": PrivateCore\.title, "sub": PrivateCore\.sub, "pill": true, "sticky": true\]/.test(swift));
ok("private mode reaches the pop ups with windows of their own", swift.includes("if role == .corner { PrivateHold.shared.set(on) }"));
ok("a pill's click brings its pop up out; a swipe only takes the pill", swift.includes('if let id = msg["id"] as? String, let key = PrivateCore.key(ofCard: id) { if (msg["action"] as? String) == "show" { PrivateHold.shared.opened(key) }; return }'));
ok("the stack's own alert sound is skipped", swift.includes("guard let name = otherSound, PrivateCore.cardSound(privateOn: PrivateHold.shared.on) else { return }"));
const main = src("main.swift");
ok("the page's card sounds (card:true) are skipped", main.includes('if (msg["card"] as? Bool) == true && !PrivateCore.cardSound(privateOn: PrivateHold.shared.on) { break }'));
const rem = src("Reminders.swift");
ok("reminders: no sound", rem.includes("if PrivateCore.cardSound(privateOn: PrivateHold.shared.on) { play(c.item) }"));
ok("reminders: wait behind a pill, and their pill goes with them", rem.includes('PrivateHold.shared.waits("rem:" + id, show:') && rem.includes('PrivateHold.shared.gone("rem:" + id)') && rem.includes("PrivateHold.shared.watch"));
const up = src("UpdateUI.swift");
ok("the update card: waits, goes, and is watched (never the installer)", up.includes('PrivateHold.shared.waits("update", show:') && up.includes('PrivateHold.shared.gone("update")') && up.includes("if !install { PrivateHold.shared.watch"));
const helper = src("HelperAlert.swift");
ok("the restart helper card: waits, goes, and is watched", helper.includes('PrivateHold.shared.waits("helper", show:') && helper.includes('PrivateHold.shared.gone("helper")') && helper.includes("PrivateHold.shared.watch"));
const notes = src("NotesCard.swift");
ok("meeting notes: wait, go, and are watched", notes.includes('PrivateHold.shared.waits("notes", show:') && notes.includes('PrivateHold.shared.gone("notes")') && notes.includes("PrivateHold.shared.watch"));
ok("the AFK stretch card: no sound", src("Afk.swift").includes('if self.prefs.sound && PrivateCore.cardSound(privateOn: PrivateHold.shared.on) { Sfx.shared.play("meet-soon"'));
ok("alarms are untouched: Sleep mode and Soundboard timed plays never ask", !src("Soundboard.swift").includes("PrivateHold") && !src("SleepSound.swift").includes("PrivateHold"));

console.log(`\n${passed} private mode checks passed`);
