// Latin Georgian (Minecraft mode, Nov 2026): Georgian written in English letters, the way Magti and other
// carriers text it ("gaiaqtiure Sakvirveli Dgheebis shetavazebebi!", "100 tsuti - 4 lari") and the way people
// chat ("gaumarjos", "madloba"). It is lossy: t can be თ or ტ, k can be კ, ქ or ყ, p can be პ or ფ, ts can be
// ც or წ, ch can be ჩ or ჭ. So every word is read by trying the possible spellings and keeping the one a
// Georgian word list (300,000 forms, ships inside PS) and a small letter model built from it like best.
// Pure functions only: the page loads the word lists, this reads and writes the text. Offline, no network.

/** The 33 letters of the modern Georgian alphabet (Mkhedruli), U+10D0 to U+10F0. */
export const GEO_RE = /[ა-ჰ]/;
const GEO_ALL = /[ა-ჰ]/g;
const CYR_ALL = /[Ѐ-ӿ]/g;
const LAT_ALL = /[A-Za-z]/g;

// ---------- the word lists ----------

/** A word list: words sorted for prefix search, and each word's count bucket (2^(bucket/2) times). */
export type WordList = { words: string[]; bucket: Uint8Array; max: number };

/** Reads the shipped format (translate/*.txt.gz, unzipped, ps-mac tools/translate/make-lexicon.py): one word a
 *  line, already sorted, each led by one character chr(33 + bucket). Nothing to sort here, so it loads fast. */
export function parseWordList(text: string): WordList {
  const lines = text.split("\n");
  if (lines.length && !lines[lines.length - 1]) lines.pop();
  const words: string[] = new Array(lines.length), bucket = new Uint8Array(lines.length);
  let max = 0, sorted = true;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const b = Math.max(0, l.charCodeAt(0) - 33);
    words[i] = l.slice(1); bucket[i] = b;
    if (b > max) max = b;
    if (i && words[i - 1] > words[i]) sorted = false;
  }
  if (!sorted) {   // never for the shipped lists; a hand made list still works
    const idx = words.map((_, i) => i).sort((a, b) => (words[a] < words[b] ? -1 : words[a] > words[b] ? 1 : 0));
    return { words: idx.map((i) => words[i]), bucket: Uint8Array.from(idx.map((i) => bucket[i])), max };
  }
  return { words, bucket, max };
}
/** A word list from plain [word, bucket] pairs (tests and small lists). */
export function wordListOf(pairs: [string, number][]): WordList {
  return parseWordList(pairs.map(([w, b]) => String.fromCharCode(33 + b) + w).join("\n"));
}

/** First index whose word is >= s. */
function lowerBound(words: string[], s: string): number {
  let lo = 0, hi = words.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (words[mid] < s) lo = mid + 1; else hi = mid; }
  return lo;
}
/** The word's bucket, or -1 when it is not in the list. */
export function lookup(l: WordList, w: string): number {
  const i = lowerBound(l.words, w);
  return i < l.words.length && l.words[i] === w ? l.bucket[i] : -1;
}
function hasPrefix(l: WordList, p: string): boolean {
  const i = lowerBound(l.words, p);
  return i < l.words.length && l.words[i].startsWith(p);
}

// ---------- the letter model ----------

/** Letter n-grams (up to 4 letters) of Georgian words, hashed into one table: how Georgian words are spelled. */
export type LetterModel = { t: Float32Array; total: number; mask: number };
const ORDER = 4;
const FNV0 = 2166136261, FNVP = 16777619;
function h32(s: string): number {
  let h = FNV0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, FNVP); }
  return h >>> 0;
}
/** Built from the word list: every word counts once plus a little for being common, so rare forms still teach
 *  endings. Hashes are made in place (no strings cut), so 300,000 words take well under a second. */
export function buildLetterModel(l: WordList, bits = 19): LetterModel {
  const size = 1 << bits, t = new Float32Array(size), mask = size - 1;
  const codes = new Uint16Array(64);
  const HAT = 94, DOLLAR = 36;   // "^" and "$"
  let total = 0;
  for (let i = 0; i < l.words.length; i++) {
    const w = l.words[i], wt = 1 + l.bucket[i] / 8;
    const len = Math.min(w.length, 60) + 2;
    codes[0] = HAT;
    for (let k = 0; k < len - 2; k++) codes[k + 1] = w.charCodeAt(k);
    codes[len - 1] = DOLLAR;
    t[h32("^") & mask] += wt;   // the start, as a context of the first letter
    for (let j = 1; j < len; j++) {
      for (let n = 1; n <= ORDER && j - n + 1 >= 0; n++) {
        let h = FNV0;
        for (let k = j - n + 1; k <= j; k++) { h ^= codes[k]; h = Math.imul(h, FNVP); }
        t[(h >>> 0) & mask] += wt;
      }
      total += wt;
    }
  }
  return { t, total, mask };
}
const LAMBDA = [0.1, 0.15, 0.3, 0.45];   // weights of 1, 2, 3 and 4 letter grams
/** log P(next letter | the letters before it), interpolated over the gram lengths. */
function letterLogP(m: LetterModel, before: string, c: string): number {
  let p = LAMBDA[0] * ((m.t[h32(c) & m.mask] + 0.5) / (m.total + 17));
  for (let n = 1; n < ORDER; n++) {
    if (before.length < n) break;
    const ctx = before.slice(before.length - n);
    const cc = m.t[h32(ctx) & m.mask];
    if (cc > 0) p += LAMBDA[n] * (m.t[h32(ctx + c) & m.mask] / cc);
  }
  return Math.log(p + 1e-9);
}
/** How Georgian a whole word looks (higher is better), start and end included. */
export function wordLogP(m: LetterModel, w: string): number {
  let s = 0, before = "^";
  for (const c of w + "$") { s += letterLogP(m, before, c); before += c; }
  return s;
}

// ---------- Latin letters to Georgian ones ----------

/** [Latin, Georgian, cost]: lower cost is the more usual reading. The word list settles the rest. */
const RULES: [string, string, number][] = [
  ["a", "ა", 0], ["b", "ბ", 0], ["g", "გ", 0], ["d", "დ", 0], ["e", "ე", 0], ["v", "ვ", 0], ["z", "ზ", 0],
  ["t", "თ", 0], ["t", "ტ", 0.4], ["i", "ი", 0], ["k", "კ", 0], ["k", "ქ", 0.3], ["k", "ყ", 1.2], ["l", "ლ", 0],
  ["m", "მ", 0], ["n", "ნ", 0], ["o", "ო", 0], ["p", "პ", 0], ["p", "ფ", 0.3], ["r", "რ", 0], ["s", "ს", 0],
  ["u", "უ", 0], ["f", "ფ", 0], ["q", "ქ", 0], ["q", "ყ", 0.6], ["h", "ჰ", 0.2], ["h", "ხ", 1.4], ["x", "ხ", 0],
  ["j", "ჯ", 0], ["j", "ჟ", 1.2], ["c", "ც", 0.4], ["c", "ჩ", 0.8], ["w", "წ", 0.4], ["w", "ვ", 1], ["y", "ყ", 0.4], ["y", "ი", 1.2],
  ["zh", "ჟ", 0], ["gh", "ღ", 0], ["sh", "შ", 0], ["ch", "ჩ", 0], ["ch", "ჭ", 0.4], ["ts", "ც", 0], ["ts", "წ", 0.1],
  ["tz", "ც", 0.6], ["tz", "წ", 0.6], ["dz", "ძ", 0], ["kh", "ხ", 0], ["th", "თ", 0.6], ["ph", "ფ", 0.6], ["dj", "ჯ", 0.6],
  ["t'", "ტ", 0], ["k'", "კ", 0], ["p'", "პ", 0], ["q'", "ყ", 0], ["ts'", "წ", 0], ["ch'", "ჭ", 0], ["tch", "ჭ", 0.8],
];
/** The Georgian keyboard's capitals, used as letters in chat ("gaumarjoT"): only inside a word. */
const CAPS: Record<string, string> = { T: "თ", S: "შ", R: "ღ", C: "ჩ", Z: "ძ", W: "ჭ", J: "ჟ" };
const BY_FIRST = new Map<string, [string, string, number][]>();
for (const r of RULES) { const k = r[0][0]; if (!BY_FIRST.has(k)) BY_FIRST.set(k, []); BY_FIRST.get(k)!.push(r); }

/** One reading of a Latin word: the Georgian spelling, its cost, and whether the word list knows it. */
export type Reading = { geo: string; score: number; known: boolean; bucket: number };

type Step = { len: number; geo: string; cost: number };
function steps(w: string, i: number): Step[] {
  const out: Step[] = [];
  const ch = w[i];
  if (i > 0 && CAPS[ch]) out.push({ len: 1, geo: CAPS[ch], cost: 0.2 });
  const low = w.slice(i, i + 3).toLowerCase();
  for (const [lat, geo, cost] of BY_FIRST.get(low[0]) || []) {
    if (low.startsWith(lat)) out.push({ len: lat.length, geo, cost: cost + (i === 0 && CAPS[ch] && lat.length === 1 ? 0 : 0) });
  }
  return out;
}

export type Lexicons = { ka: WordList; en: WordList; lm: LetterModel };

/** Every reading worth showing for one Latin word, best first (at most `top`). */
export function readWord(w: string, lx: Lexicons, top = 6): Reading[] {
  const found = new Map<string, Reading>();
  const add = (geo: string, cost: number) => {
    const b = lookup(lx.ka, geo);
    // Known words beat letter guesses: the letter model plus a bonus that grows with how common the word is.
    // A guess whose start is a known word (ჩატით: ჩატი, "chat", plus an ending) gets part of that bonus.
    let stem = 0;
    if (b < 0) for (let k = geo.length - 1; k >= 3; k--) { const sb = lookup(lx.ka, geo.slice(0, k)); if (sb >= 0) { stem = (k / geo.length) * (3 + sb * 0.15); break; } }
    const score = wordLogP(lx.lm, geo) - cost * 2 + (b >= 0 ? 6 + b * 0.5 : stem);
    const had = found.get(geo);
    if (!had || had.score < score) found.set(geo, { geo, score, known: b >= 0, bucket: b });
  };
  // 1. Words the list knows: walk the spellings, dropping any start no listed word has.
  let nodes = 0;
  const walk = (i: number, geo: string, cost: number) => {
    if (++nodes > 40000) return;
    if (i === w.length) { if (lookup(lx.ka, geo) >= 0) add(geo, cost); return; }
    for (const s of steps(w, i)) {
      const g = geo + s.geo;
      if (hasPrefix(lx.ka, g)) walk(i + s.len, g, cost + s.cost);
    }
  };
  walk(0, "", 0);
  // 2. Unknown words (new names, rare endings): a beam over the letter model.
  type Beam = { i: number; geo: string; cost: number; lp: number };
  let beam: Beam[] = [{ i: 0, geo: "", cost: 0, lp: 0 }];
  const done: Beam[] = [];
  for (let round = 0; round < w.length + 1 && beam.length; round++) {
    const next = new Map<string, Beam>();
    for (const b of beam) {
      if (b.i === w.length) { done.push(b); continue; }
      for (const s of steps(w, b.i)) {
        let lp = b.lp, before = "^" + b.geo;
        for (const c of s.geo) { lp += letterLogP(lx.lm, before, c); before += c; }
        const nb = { i: b.i + s.len, geo: b.geo + s.geo, cost: b.cost + s.cost, lp };
        const key = nb.i + "|" + nb.geo;
        const had = next.get(key);
        if (!had || had.lp - had.cost * 2 < nb.lp - nb.cost * 2) next.set(key, nb);
      }
    }
    beam = [...next.values()].sort((a, b) => (b.lp - b.cost * 2) - (a.lp - a.cost * 2)).slice(0, 48);
  }
  for (const b of done) add(b.geo, b.cost);
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, top);
}

// ---------- whole texts ----------

/** One piece of a text: kept as it is (numbers, codes, links, English) or a Latin Georgian word with its readings. */
export type Piece = { text: string; kind: "keep" | "ka" | "en"; readings?: Reading[]; pick?: number };

const PROTECT = /(https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+|[\w.-]+\.(?:ge|com|net|org|ru|io|app)(?:\/\S*)?)/gi;
const WORD = /[A-Za-z][A-Za-z']*/g;

/** Should this Latin word stay as it is? Codes and brands do: MB, OK, SMS, 5G, MyMagti. */
function keepAsIs(tok: string, before: string, after: string): boolean {
  if (/[0-9]/.test(before.slice(-1)) || /[0-9]/.test(after[0] || "")) return true;   // 5G, 4G, x2
  if (tok.length >= 2 && tok === tok.toUpperCase()) return true;                        // MB, OK, SMS, AI
  if (/^[A-Z][a-z]+[A-Z]/.test(tok) && !/^[A-Z][a-z]+[TSRCZWJ][a-z]*$/.test(tok)) return true;   // MyMagti (not "gaumarjoT")
  return false;
}

/** Reads a Latin Georgian text: each word becomes its best Georgian spelling, English words and codes stay. */
export function readText(text: string, lx: Lexicons): Piece[][] {
  return text.split("\n").map((line) => readLine(line, lx));
}

function readLine(line: string, lx: Lexicons): Piece[] {
  const out: Piece[] = [];
  // Links, emails and web addresses first: never touched.
  const safe: [number, number][] = [];
  for (const m of line.matchAll(PROTECT)) safe.push([m.index!, m.index! + m[0].length]);
  let at = 0;
  const words: { p: Piece; en: number; ka: number }[] = [];
  const push = (s: string) => { if (s) out.push({ text: s, kind: "keep" }); };
  for (const m of line.matchAll(WORD)) {
    const s = m.index!, e = s + m[0].length;
    if (safe.some(([a, b]) => s < b && e > a)) continue;
    push(line.slice(at, s));
    at = e;
    const tok = m[0].replace(/'+$/, "");
    const tail = m[0].slice(tok.length);
    if (keepAsIs(tok, line.slice(0, s), line.slice(e))) { out.push({ text: m[0], kind: "keep" }); continue; }
    const readings = readWord(tok, lx);
    const best = readings[0];
    const enB = lookup(lx.en, tok.toLowerCase());
    // How sure each language is: a known Georgian word by how common it is; a guessed one only if it looks Georgian.
    const perLetter = best ? wordLogP(lx.lm, best.geo) / (best.geo.length + 1) : -99;
    const ka = !best ? 0 : best.known ? 4 + best.bucket : perLetter > -2.6 ? 3 : 0;
    const en = enB >= 0 ? enB : 0;
    const p: Piece = { text: m[0], kind: "ka", readings, pick: 0 };
    if (tail) out.push(p), out.push({ text: tail, kind: "keep" });
    else out.push(p);
    words.push({ p, en, ka });
  }
  push(line.slice(at));
  // Per line: a word only the English list knows stays English; a word both know follows the line.
  let kaN = 0, enN = 0;
  for (const w of words) { if (w.ka > 0 && w.en === 0) kaN++; else if (w.en > 0 && w.ka === 0) enN++; else if (w.ka > 0 && w.en > 0) { if (w.ka >= w.en) kaN += 0.5; else enN += 0.5; } }
  const lineKa = kaN >= enN;
  for (const w of words) {
    // Neither list knows it ("chatit"): it follows the line too.
    const isKa = w.ka === 0 && w.en === 0 ? lineKa : w.ka > 0 && (w.en === 0 || lineKa || w.ka > w.en + 6);
    if (!isKa) { w.p.kind = "en"; }
  }
  return out;
}

/** The text in Georgian script, from the pieces (each word's picked reading). */
export function piecesToGeorgian(lines: Piece[][]): string {
  return lines.map((ps) => ps.map((p) => (p.kind === "ka" && p.readings?.length ? p.readings[p.pick ?? 0]?.geo ?? p.text : p.text)).join("")).join("\n");
}

/** How many words were read as Latin Georgian, and how many as English. */
export function latinCounts(lines: Piece[][]): { ka: number; en: number } {
  let ka = 0, en = 0;
  for (const ps of lines) for (const p of ps) { if (p.kind === "ka") ka++; else if (p.kind === "en") en++; }
  return { ka, en };
}

// ---------- Georgian to Latin (for replies typed that way) ----------

const TO_LATIN: Record<string, string> = {
  "ა": "a", "ბ": "b", "გ": "g", "დ": "d", "ე": "e", "ვ": "v", "ზ": "z", "თ": "t", "ი": "i", "კ": "k", "ლ": "l", "მ": "m",
  "ნ": "n", "ო": "o", "პ": "p", "ჟ": "zh", "რ": "r", "ს": "s", "ტ": "t", "უ": "u", "ფ": "p", "ქ": "q", "ღ": "gh", "ყ": "y",
  "შ": "sh", "ჩ": "ch", "ც": "ts", "ძ": "dz", "წ": "ts", "ჭ": "ch", "ხ": "kh", "ჯ": "j", "ჰ": "h",
  "ჱ": "ey", "ჲ": "y", "ჳ": "wi", "ჴ": "q", "ჵ": "o", "ჶ": "f", "ჷ": "e", "ჸ": "'", "ჹ": "u", "ჺ": "'",
};
/** Georgian script in the Latin letters carriers and chats use (the same style Magti texts in). */
export function georgianToLatin(s: string): string {
  let out = "";
  for (const ch of s) out += TO_LATIN[ch] ?? ch;
  return out;
}

// ---------- which language is this? ----------

export type Lang = "en" | "ru" | "ka" | "kl";   // kl: Latin Georgian
export const LANG_NAMES: Record<Lang, string> = { en: "English", ru: "Russian", ka: "Georgian", kl: "Latin Georgian" };
/** NLLB's code for each language (Latin Georgian is read into Georgian first). */
export const NLLB: Record<Lang, string> = { en: "eng_Latn", ru: "rus_Cyrl", ka: "kat_Geor", kl: "kat_Geor" };

/** The language of a text by its letters; Latin text is English or Latin Georgian by its words (needs the lists). */
export function detectLang(text: string, lx: Lexicons | null): Lang {
  const g = (text.match(GEO_ALL) || []).length, c = (text.match(CYR_ALL) || []).length, l = (text.match(LAT_ALL) || []).length;
  if (g >= c && g >= l && g > 0) return "ka";
  if (c >= l && c > 0) return "ru";
  if (!lx) return "en";
  const n = latinCounts(readText(text, lx));
  return n.ka >= 2 && n.ka >= n.en * 0.6 ? "kl" : n.ka >= 1 && n.en === 0 ? "kl" : "en";
}

// ---------- before the model reads Georgian ----------

/** NLLB turns "4 ლარი" (lari, Georgia's money) into "four bucks" or "4 доллара", and the carriers' names into
 *  words ("5G ეს მაგთია!" became "5G is awesome!"). So amounts in lari are written "4 lari" and the carriers'
 *  names as names before the model sees them. ("GEL" made it invent a whole line, "₾" is not in its vocabulary;
 *  "lari" came out right in English and Russian, 4 Nov 2026.) Only Georgian script is touched. */
const CARRIERS: [RegExp, string][] = [[/მაგთი(?:ს|ით|ში|კომი?|ა)?(?![ა-ჰ])/g, "Magti"], [/სილქნეტ(?:ი|ის|ით|ში|ს)?(?![ა-ჰ])/g, "Silknet"],
  [/ბილაინ(?:ი|ის|ით|ში|ს)?(?![ა-ჰ])/g, "Beeline"], [/სელფი(?:ს|ით|ში)?(?![ა-ჰ])/g, "Cellfie"]];
export function protectForModel(geo: string): string {
  let s = geo.replace(/(\d[\d\s.,]*)\s*ლარ(?:ი|ს|ად|ის|ით|ამდე)?(?![ა-ჰ])/g, (_m, n: string) => `${n.trimEnd()} lari`);
  s = s.replace(/(\d[\d\s.,]*)\s*თეთრ(?:ი|ს|ად|ის|ით)?(?![ა-ჰ])/g, (_m, n: string) => `${n.trimEnd()} tetri`);
  for (const [re, name] of CARRIERS) s = s.replace(re, name);
  return s;
}
