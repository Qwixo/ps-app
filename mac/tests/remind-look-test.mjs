// Unit tests for the reminder card's colours on a Mac (V1.58, Sources/Reminders.swift, between ">>> rem look" and
// "<<< rem look" in its page). The developer, 13 Nov 2026: "when you choose the white coloured theme for the fifteen minute
// reminder, the text almost becomes invisible. The text doesn't adapt to the colour." The model is read straight out
// of Reminders.swift, so this checks the code PS ships: every theme, light custom colours and a sweep of backgrounds
// read at 4.5 to 1, and the page's CSS takes every colour from it. No window, nothing on screen.
// Run: node tests/remind-look-test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const swift = readFileSync(join(here, "..", "Sources", "Reminders.swift"), "utf8");
let passed = 0;
function ok(name, cond, more = "") {
  if (cond) { passed++; console.log(`ok - ${name}`); } else { console.log(`FAIL - ${name} ${more}`); process.exit(1); }
}
const page = swift.slice(swift.indexOf('private static let page = #"""'), swift.lastIndexOf('"""#'));
const script = page.slice(page.indexOf("<script>") + 8, page.lastIndexOf("</script>"));
const css = page.slice(page.indexOf("<style>") + 7, page.indexOf("</style>"));
let parses = true, why = "";
try { new Function(script); } catch (e) { parses = false; why = String(e); }
ok("the card page's script parses", parses, why);
const a = script.indexOf("// >>> rem look"), b = script.indexOf("// <<< rem look");
ok("the look model block is there", a > 0 && b > a);
const Look = new Function(script.slice(a, b) + "\nreturn Look;")();
const c = Look.con, mix = Look.mix, AA = 4.5;

// The page's themes (web core/remind.ts REM_COLOURS) and light custom colours from the wheel.
const presets = [["Pink", "#28121e", "#ec4e86"], ["Ocean", "#0f1b2d", "#3b82f6"], ["Forest", "#0f2418", "#22c55e"], ["Amber", "#2a1a08", "#f59e0b"],
  ["Violet", "#1c1230", "#8b5cf6"], ["Red alert", "#2a0d0d", "#ef4444"], ["Graphite", "#18181b", "#e5e7eb"], ["Paper", "#f6f3ee", "#e0457b"]];
const themes = [...presets];
for (const bg of ["#ffffff", "#fff8e1", "#fffde7", "#e5e7eb", "#d4d4d8", "#fbcfe8", "#bbf7d0", "#bae6fd", "#c8c8c8", "#b0b0b0", "#9a9a9a", "#ec4e86", "#f59e0b", "#22c55e"])
  for (const acc of ["#ec4e86", "#ffffff", "#f59e0b", "#e5e7eb", "#3b82f6"]) themes.push([`custom ${bg} / ${acc}`, bg, acc]);

ok("ink: white on the dark themes, near black on Paper, white and cream", presets.slice(0, 7).every(([, bg]) => Look.ink(bg) === "#ffffff")
  && Look.ink("#f6f3ee") === "#17121a" && Look.ink("#ffffff") === "#17121a" && Look.ink("#fff8e1") === "#17121a");
ok("ink: never white on a light grey or a mid colour (white there was about 2 to 1)", ["#b0b0b0", "#a0a0a0", "#ec4e86", "#f59e0b", "#22c55e"].every((bg) => Look.ink(bg) !== "#ffffff" && c(Look.ink(bg), bg) >= AA));

let worst = "";
for (let r = 0; r < 256 && !worst; r += 8) for (let g = 0; g < 256 && !worst; g += 8) for (let bl = 0; bl < 256 && !worst; bl += 8) {
  const bg = "#" + [r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("");
  const L = Look.look(bg, "#ec4e86");
  if (Math.min(c(L.ink, bg), c(L.ink, L.top), c(L.sub, bg), c(L.sub, L.top), c(L.ph, L.fieldTone), c(L.ink, L.fieldTone), c(L.hint, bg)) < AA) worst = bg;
}
ok("on ANY background (every 8th step of each channel) the words, smaller words, box, placeholder and hint read", !worst, worst);

for (const [name, bg, acc] of themes) {
  const L = Look.look(bg, acc);
  const glowTop = mix(acc, L.top, L.glow / 100);
  const fails = [];
  const at = (want, got, what) => { if (got < want) fails.push(`${what} ${got.toFixed(2)}`); };
  at(AA, Math.min(c(L.ink, bg), c(L.ink, L.top), c(L.ink, glowTop)), "question");
  at(AA, Math.min(c(L.sub, bg), c(L.sub, L.top)), "smaller words");
  at(AA, Math.min(c(L.ink, mix(L.ink, bg, L.btn / 100)), c(L.ink, mix(L.ink, L.top, L.btn / 100))), "Remind me / Open task");
  at(3, c(L.on, L.mainTone), "main button");
  at(AA, c(L.ink, L.fieldTone), "typed words");
  at(AA, c(L.ph, L.fieldTone), "placeholder");
  at(AA, Math.min(c(L.hint, bg), c(L.hint, L.top)), "hint");
  at(AA, c(L.pill, L.pillBg), "pill");
  ok(`${name}: question, smaller words, buttons, box, placeholder, hint and pill read`, !fails.length, fails.join(", "));
}
ok("the main button keeps white words on pink, ocean, violet, red and Paper", presets.filter(([n]) => ["Pink", "Ocean", "Violet", "Red alert", "Paper"].includes(n)).every(([, bg, acc]) => Look.look(bg, acc).on === "#ffffff"));
ok("and never white on a light accent (Graphite, white, cream, amber, green)", ["#e5e7eb", "#ffffff", "#fff8e1", "#f59e0b", "#22c55e"].every((acc) => { const L = Look.look("#18181b", acc); return L.on !== "#ffffff" && c(L.on, L.mainTone) >= AA; }));
ok("the dark themes look as before: white words, the sheen, the full glow and button fill, the light red hint",
  presets.slice(0, 7).every(([, bg, acc]) => { const L = Look.look(bg, acc); return L.ink === "#ffffff" && L.lift === "#ffffff" && L.glow === 22 && L.btn === 13 && L.hint === "#fca5a5" && L.field === "rgba(0,0,0,.28)"; }));
ok("a broken colour falls back to the pink look", Look.look("nope", 7).bg === "#28121e" && Look.look("nope", 7).acc === "#ec4e86");

// ---------- the page uses it for every colour ----------
ok("the card sets every colour from the model, never the plan's ink", /const L = Look\.look\(o\.bg, o\.accent\)/.test(script) && !/setProperty\('--ink', o\.ink\)/.test(script)
  && ["--ink", "--sub", "--lift", "--glow", "--pill", "--btn", "--on", "--field", "--ph", "--hint"].every((k) => script.includes(`'${k}': L.`)));
ok("the CSS: no fixed white on the main button, no faded label, no fixed light red hint, no fixed box fill",
  /button\.main\{color:var\(--on\)/.test(css) && /#box label\{[^}]*color:var\(--sub\)/.test(css) && !/#box label\{[^}]*opacity/.test(css)
  && /#hint\{[^}]*color:var\(--hint\)/.test(css) && /#t\{[^}]*background:var\(--field\)/.test(css) && /#t::placeholder\{color:var\(--ph\)\}/.test(css)
  && /\.pill\{[^}]*color:var\(--pill\)/.test(css) && /var\(--lift\) 8%/.test(css) && /var\(--acc\) var\(--glow\)/.test(css) && /var\(--ink\) var\(--btn\)/.test(css));
console.log(`\n${passed} passed`);
