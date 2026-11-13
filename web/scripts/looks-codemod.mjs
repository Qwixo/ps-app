#!/usr/bin/env node
// The appearance engine's codemod (V1.31, src/core/looks.ts). It rewrites the PS stylesheets so every colour, font
// size, spacing, corner and font reads a look token, with the old value as the fallback:
//   rgba(255,255,255,.55)  ->  color-mix(in srgb, var(--k-fg, #FFFFFF) min(100%, calc(55% * var(--k-ia, 1))), transparent)
//   #EC4E86               ->  var(--k-acc, #EC4E86)
//   font-size: 13px       ->  font-size: calc(13px * var(--k-fs, 1))
//   padding: 8px 12px     ->  padding: calc(8px * var(--k-dn, 1)) calc(12px * var(--k-dn, 1))
// With no token set (the default look) every value is exactly the old one. It is idempotent: anything already reading
// a --k- token is left alone, so after a merge brings in new CSS, run it again:
//   node scripts/looks-codemod.mjs            (rewrites the files in place)
//   node scripts/looks-codemod.mjs --check    (lists what it would change, exit 1 if anything)
// A rule (or one declaration, with the comment /* k-keep */) that must keep its literal colours: the light themes of
// other parts (tm-light-on, Fitness Chalk and its light theme) are skipped by selector.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

const ROOT = new URL("..", import.meta.url).pathname;
// The website's own sheets (light by default, the vault pages) and the notebook paper art are not PS glass.
const SKIP = new Set(["src/styles.css", "src/views/portal.css", "src/views/clients.css", "src/views/pipeline.css", "src/views/today.css",
  "src/views/todo.css", "src/views/notes.css", "src/views/pssignin.css", "src/views/brief.css", "src/views/campaigns.css", "src/views/notebook.css", "src/looks/looks.css", "src/looks/settings.css", "src/looks/working.css",
  // G Squad, the mobile web app (src/mobile/): its guide, Connect and sign in screens show before the vault opens, so no
  // look is applied yet (like pssignin.css). The phone home itself is src/gos/ CSS, which follows the look.
  "src/mobile/mobile.css",
  // The hover card (V1.43, src/ui/hovercard.css): dark glass with white words in every look, so it reads the same over
  // a light look, a dark look, a picture or a video.
  "src/ui/hovercard.css",
  // Reply from PS (V1.44, src/views/reply.css): the compose window floats over any app with no look of its own, dark
  // glass like the hover card.
  "src/views/reply.css"]);
const LIGHT_SEL = /tm-light|data-fit-style="chalk"|data-fit-theme="light"|data-theme="light"|data-nb/;
// Pictures of real things that keep their own colours and sizes whatever the look: the island editor's preview (a
// strip of screen, the menu bar, the black camera notch and the native island in its own colours), its look chips'
// little pictures and the hue slider's rainbow (views/islandlook.css). The editor's own controls do follow the look.
// Minecraft mode is its own designed look (its own tokens, block palette, pixel fonts, light and dark): its folder is
// skipped whole, and only its entry card in Settings (settingsscreen.css .mcw-entry, V1.32: the pickaxe button left
// the Tab list's top bar) follows the app's look; the pop up, scene and bubble keep their own colours.
const MC_DIR = "src/views/minecraft/";
const MC_OWN = (sel) => /\.(mcw|mcm|mcs)-|\.mct\b/.test(sel) && !/\.mcw-entry\b/.test(sel);
const PICTURE_SEL = /\.il-(stage|scale|bar|cam|notch-svg|np|pill|row|t|b|more|ring|scope|open|badges|orow|nc|drop|slim|nopen|sw-pill|sw-notch|hue|shade|grip)\b(?!-)/;

// ---------- colours ----------
function hsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6; else if (max === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, l, c: d };
}
const hex2 = (v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase();
const hexOf = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
function family(r, g, b) {
  const { h, l, c } = hsl(r, g, b);
  if (c < 0.14 || l < 0.1) {
    if (l >= 0.82) return { fam: "fg" };
    if (l < 0.065) return { fam: "base" };
    if (l < 0.3) return { fam: "surface" };
    return { fam: "grey", l };
  }
  let fam;
  if (h >= 315 && h < 352) fam = "acc";
  else if (h >= 245 && h < 315) fam = "acc2";
  else if (h >= 352 || h < 14) fam = "bad";
  else if (h < 64) fam = "warn";
  else if (h < 175) fam = "ok";
  else fam = "info";
  const tier = l >= 0.7 ? "-t" : l < 0.3 ? "-bg" : "";
  return { fam, tier };
}
const pct = (a) => `${Math.round(a * 1000) / 10}%`;
/** One colour, as token CSS. ctx: "text-shadow" | "glow" | "on-<fam>" | null */
function tokenFor(r, g, b, alphaCss, ctx) {
  if (ctx === "keep") return alphaCss === null ? hexOf(r, g, b) : `rgba(${r}, ${g}, ${b}, ${alphaCss})`;   // a real shadow stays dark
  const lit = hexOf(r, g, b);
  const f = family(r, g, b);
  const alpha = (inner, boost) => {
    if (alphaCss === null) return inner;
    const p = /^[\d.]+$/.test(alphaCss) ? pct(Number(alphaCss)) : `calc(${alphaCss} * 100%)`;
    return `color-mix(in srgb, ${inner} ${boost ? `min(100%, calc(${p} * var(--k-ia, 1)))` : p}, transparent)`;
  };
  if (ctx === "text-shadow" && (f.fam === "fg" || f.fam === "base" || f.fam === "surface" || f.fam === "grey")) return alpha(`var(--k-tsh, ${lit})`, false);
  if (ctx === "glow" && f.fam === "fg") return alpha(`var(--k-glow, ${lit})`, false);
  if (ctx && ctx.startsWith("on-") && (f.fam === "fg" || f.fam === "base" || f.fam === "surface" || f.fam === "grey")) return alpha(`var(--k-${ctx}, ${lit})`, false);
  if (f.fam === "fg") return alpha(`var(--k-fg, ${lit})`, true);
  if (f.fam === "base" || f.fam === "surface") return alpha(`var(--k-${f.fam}, ${lit})`, false);
  if (f.fam === "grey") {
    // a grey between the ink and the page: the same mix of the look's ink and page (exact for pure greys)
    const p = Math.round(f.l * 1000) / 10;
    return alpha(`color-mix(in srgb, var(--k-fg, #FFFFFF) ${p}%, var(--k-base, #000000))`, true);
  }
  return alpha(`var(--k-${f.fam}${f.tier}, ${lit})`, false);
}

// Colour literals in a value (not inside url() or strings, not already in a token expression).
const COLOR = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b|rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*(?:[,/]\s*((?:var\((?:[^()]|\([^()]*\))*\))|[\d.]+%?)\s*)?\)/g;
function parseHex(h) {
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : null;
  return [r, g, b, a === null ? null : String(Math.round(a * 1000) / 1000)];
}
/** Hides the parts of a value the codemod must not touch, and gives them back afterwards. */
function mask(value) {
  const kept = [];
  const hold = (s) => { kept.push(s); return `\u0000${kept.length - 1}\u0000`; };
  let v = value.replace(/url\((?:[^()]|\([^()]*\))*\)/g, hold).replace(/"[^"]*"|'[^']*'/g, hold);
  // any function call that already reads a --k- token, innermost first
  let prev;
  do {
    prev = v;
    v = v.replace(/(?:color-mix|var|calc|min|max|clamp)\((?:[^()\u0000]|\u0000\d+\u0000)*\)/g, (m) => (m.includes("--k-") ? hold(m) : m));
  } while (v !== prev);
  return { v, back: (s) => { let o = s; for (let i = 0; i < 4; i++) o = o.replace(/\u0000(\d+)\u0000/g, (_, n) => kept[Number(n)]); return o; } };
}
function recolor(value, ctxFor) {
  if (!/#|rgb/.test(value)) return value;
  const { v, back } = mask(value);
  // split shadows into layers so each layer knows if it is a blurred shadow or a ring
  const out = v.replace(COLOR, (m, hex, r, g, b, a, offset, whole) => {
    let R, G, B, A;
    if (hex) [R, G, B, A] = parseHex(hex);
    else { R = Number(r); G = Number(g); B = Number(b); A = a === undefined ? null : a.endsWith("%") ? String(Number(a.slice(0, -1)) / 100) : a; }
    if (A === "1") A = null;
    if (A === "0" || A === "0.0") return m;   // fully clear stays clear
    return tokenFor(R, G, B, A, ctxFor(offset, whole, R, G, B));
  });
  return back(out);
}
const BLACKISH = (r, g, b) => r + g + b < 120;
/** Is the colour at this offset inside a blurred shadow layer (a real shadow, not a ring)? */
function shadowLayer(whole, offset) {
  // the layer is the text between the commas around the offset (top level)
  let depth = 0, start = 0, end = whole.length;
  for (let i = 0; i < whole.length; i++) {
    const ch = whole[i];
    if (ch === "(") depth++; else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) { if (i < offset) start = i + 1; else { end = i; break; } }
  }
  const layer = whole.slice(start, end).replace(/#[0-9a-fA-F]+|rgba?\([^)]*\)|color-mix\(.*\)|var\(.*\)/g, "").trim();
  const nums = layer.replace("inset", "").trim().split(/\s+/).filter(Boolean);
  const blur = nums[2] ? parseFloat(nums[2]) : 0;
  return blur > 0;
}

// ---------- sizes ----------
const SKIP_VAL = /^(inherit|initial|unset|revert|normal|smaller|larger|0)$/;
function scaleFont(value) {
  if (value.includes("--k-fs") || SKIP_VAL.test(value.trim())) return value;
  if (!/px|rem|vw|vh|vmin|vmax|clamp|min\(|max\(/.test(value) || /^[\d.]+(em|%)$/.test(value.trim()) || /(?:^|\s)[\d.]+em\b/.test(value) && !/px|rem/.test(value)) return value;
  return `calc(${value.trim()} * var(--k-fs, 1))`;
}
function scaleFontShorthand(value) {
  if (value.includes("--k-fs") || /^(inherit|initial|unset)$/.test(value.trim())) return value;
  // the size is the first length before an optional /line-height
  return value.replace(/(^|\s)(\d*\.?\d+(?:px|rem))(?=\s*\/|\s)/, (m, sp, size) => `${sp}calc(${size} * var(--k-fs, 1))`);
}
/** Every bare length outside a function in padding or gap: scaled by the density. */
function scaleSpace(value, token) {
  if (value.includes(`--${token}`)) return value;
  const { v, back } = mask(value);
  let depth = 0, out = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (depth === 0) {
      const m = /^(-?\d*\.?\d+)px\b/.exec(v.slice(i));
      const before = i === 0 ? " " : v[i - 1];
      if (m && /[\s(]/.test(before) && Number(m[1]) !== 0 && Math.abs(Number(m[1])) < 200) {
        out += `calc(${m[1]}px * var(--${token}, 1))`; i += m[0].length - 1; continue;
      }
    }
    out += ch;
  }
  return back(out);
}
const SANS = /^\s*("Inter Variable"|Inter\b|system-ui|-apple-system|ui-sans-serif)/;
const MONO = /^\s*(ui-monospace|"SF Mono"|SFMono|Menlo|monospace)/;

// ---------- one file ----------
function transform(css, file) {
  const root = postcss.parse(css, { from: file });
  let changes = 0;
  root.walkRules((rule) => {
    const parentAt = rule.parent && rule.parent.type === "atrule" ? rule.parent : null;
    if (parentAt && /keyframes/.test(parentAt.name) && LIGHT_SEL.test(rule.parent.parent?.selector ?? "")) return;
    if (LIGHT_SEL.test(rule.selector) || PICTURE_SEL.test(rule.selector) || MC_OWN(rule.selector)) return;
    if (/^(:root|html)\b/.test(rule.selector) && file === "src/styles.css") return;
    // the fill under this rule's text, to pick the text colour that reads on it
    let fillFam = null;
    rule.each((d) => {
      if (d.type !== "decl" || !/^background(-color)?$/.test(d.prop)) return;
      const m = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(d.value.replace(/url\([^)]*\)/g, ""));
      if (!m) return;
      const [r, g, b] = m[1] ? parseHex(m[1]) : [Number(m[2]), Number(m[3]), Number(m[4])];
      const f = family(r, g, b);
      if (!["fg", "base", "surface", "grey"].includes(f.fam) && f.tier !== "-bg") fillFam = f.fam;
    });
    rule.each((d) => {
      if (d.type !== "decl") return;
      const next = d.next();
      if (next && next.type === "comment" && /k-keep/.test(next.text)) return;
      const before = d.value;
      let v = d.value;
      const prop = d.prop.toLowerCase();
      if (prop === "font-size") v = scaleFont(v);
      else if (prop === "font") v = scaleFontShorthand(v);
      else if (/^(padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?|gap|row-gap|column-gap|grid-gap)$/.test(prop)) v = scaleSpace(v, "k-dn");
      else if (/^border(-(top|bottom)-(left|right))?-radius$/.test(prop) && !/%/.test(v)) v = scaleSpace(v, "k-rd");
      if (prop === "font-family" && !v.includes("--k-")) {
        if (SANS.test(v)) v = `var(--k-font, ${v})`;
        else if (MONO.test(v)) v = `var(--k-mono, ${v})`;
      }
      if (prop === "font" && !v.includes("--k-font") && !v.includes("--k-mono")) {
        v = v.replace(/((?:"Inter Variable"|Inter|system-ui|-apple-system)[^;]*)$/, "var(--k-font, $1)").replace(/((?:ui-monospace|"SF Mono"|SFMono-Regular|Menlo)[^;]*)$/, "var(--k-mono, $1)");
      }
      v = recolor(v, (offset, whole, r, g, b) => {
        if (prop === "text-shadow") return "text-shadow";
        if (prop === "box-shadow" || prop === "filter" || prop.endsWith("-shadow")) {
          if (shadowLayer(whole, offset)) {
            if (BLACKISH(r, g, b)) return "keep";
            if (family(r, g, b).fam === "fg") return "glow";
          }
          return null;
        }
        if (fillFam && /^(color|-webkit-text-fill-color|fill|stroke)$/.test(prop)) return `on-${fillFam}`;
        return null;
      });
      if (v !== before) { d.value = v; changes++; }
    });
  });
  return { css: root.toString(), changes };
}

const files = [];
const walk = (d) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (p.endsWith(".css")) files.push(p); } };
walk("src");
const check = process.argv.includes("--check");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
let total = 0;
for (const f of files) {
  if (SKIP.has(f) || f.startsWith(MC_DIR) || (only.length && !only.includes(f))) continue;
  const src = readFileSync(join(ROOT, f), "utf8");
  const { css, changes } = transform(src, f);
  if (changes) { total += changes; console.log(`${f}: ${changes}`); if (!check) writeFileSync(join(ROOT, f), css); }
}
console.log(`${check ? "would change" : "changed"} ${total} declarations`);
if (check && total) process.exit(1);
