// PS Fitness, Gym scan (V1.59, the developer: "a text scan for the gym... point it at a machine or its label, PS reads the text,
// translates it to English if it is German, and matches it to an exercise in my plan"). Pure: the phone reads the text
// (ps-gos GymScan.kt, Tesseract on the phone), and everything after that happens here. Tested in
// tests/fitness-scan.test.ts.
//  1. clean: what the camera read, without the specks a photo adds ("|", "ii", "~").
//  2. english: word by word through scan-words.ts (German compounds split into parts, typos forgiven), makers set aside.
//  3. match: the developer's own exercises (his plans and his own typed names) first, then the exercise library; a match needs
//     a real exercise word, never only "machine" or "cable".
import { LIBRARY, words } from "./library.ts";
import { BRANDS, DE_PARTS, DE_WORDS, EN_PHRASES, NOISE, OTHER_WORDS } from "./scan-words.ts";

export type ScanFrom = "yours" | "plan" | "library";
export interface ScanHit { name: string; exId: string | null; from: ScanFrom; score: number }
export interface ScanRead {
  /** What the camera read, cleaned, one label line per line. */
  text: string;
  /** The same in English (equal to text, give or take case, when it was English already). */
  english: string;
  /** "de" German, "other" another language in the list, "en" English or unknown. */
  lang: "de" | "other" | "en";
  /** The machine maker, when the label names one. */
  brand: string | null;
}
export interface ScanResult extends ScanRead { best: ScanHit | null; others: ScanHit[] }
/** One of the developer's own exercises (gym-logic yourExercises, or a library exercise in his active plan). */
export interface ScanOwn { name: string; exId: string | null; inPlan?: boolean }

// ---------- 1. clean ----------
const LETTER = /\p{L}/gu;
/** The camera's text without the specks: tokens with few letters, lines with nothing left. At most 6 lines. */
export function cleanRead(raw: string): string {
  const lines: string[] = [];
  for (const line of String(raw ?? "").split(/\r?\n/)) {
    const keep = line.split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}°.]+$/gu, "")).filter((t) => {
      if (!t) return false;
      const letters = (t.match(LETTER) ?? []).length;
      if (!letters) return /^\d{1,3}°?$/.test(t);   // "45°", "80": kept, they can be part of a name
      if (/^[il|!1jI]{2,3}$/.test(t)) return false;    // "ii", "Il": the edge of a frame or a bolt
      return letters >= 2 && letters / t.length >= 0.6;
    });
    if (keep.length) lines.push(keep.join(" "));
    if (lines.length >= 6) break;
  }
  return lines.join("\n").slice(0, 200);
}

// ---------- 2. english ----------
/** Lower case with umlauts and accents folded: "Rückenstrecker" "ruckenstrecker", "Gesäß" "gesass". */
export function fold(s: string): string {
  return s.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "");
}
/** "Ruecken" written without the umlaut. */
const fold2 = (w: string) => w.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");

function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const like = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length);

const PARTS = Object.keys(DE_PARTS).sort((a, b) => b.length - a.length);
/** A German compound split into known parts, eg "beinpressmaschine" "leg press machine". A linking s or e is allowed. */
function split(w: string, depth = 0): string[] | null {
  if (!w) return [];
  if (depth > 5) return null;
  for (const p of PARTS) {
    if (!w.startsWith(p)) continue;
    const rest = w.slice(p.length);
    for (const r of [rest, rest.startsWith("s") ? rest.slice(1) : null, rest.startsWith("e") ? rest.slice(1) : null]) {
      if (r == null || (r && r.length < 2)) continue;
      const tail = split(r, depth + 1);
      if (tail) return [DE_PARTS[p], ...tail];
    }
  }
  return null;
}

const DE_KEYS = Object.keys(DE_WORDS).filter((k) => !k.includes(" ") && k.length >= 5 && DE_WORDS[k]);
type Said = { en: string; lang: "de" | "other" | "en" | null };
/** One folded word in English, or null when the list does not know it. */
function sayWord(w: string): Said | null {
  for (const x of [w, fold2(w)]) {
    if (x in DE_WORDS) return { en: DE_WORDS[x], lang: "de" };
    if (x in OTHER_WORDS) return { en: OTHER_WORDS[x], lang: OTHER_WORDS[x] === x ? null : "other" };
  }
  if (NOISE.has(w)) return { en: "", lang: null };
  if (w.length >= 7) {
    const parts = split(w) ?? split(fold2(w));
    if (parts && parts.length >= 2) return { en: parts.join(" "), lang: "de" };
  }
  if (w.length >= 5) {
    // A letter misread by the camera ("belnpresse", "latzog"): the nearest German word, when it is close.
    let best = "", score = 0;
    for (const k of DE_KEYS) {
      if (Math.abs(k.length - w.length) > 2 || k[0] !== w[0] && k[1] !== w[1]) continue;
      const s = like(w, k);
      if (s > score) { score = s; best = k; }
    }
    if (score >= (w.length >= 8 ? 0.8 : 0.83)) return { en: DE_WORDS[best], lang: "de" };
  }
  return null;
}

const BRAND_KEYS = Object.keys(BRANDS).sort((a, b) => b.split(" ").length - a.split(" ").length);
/** The camera's text in English, the language it was in, and the maker on the label. */
export function toEnglish(text: string): ScanRead {
  const clean = cleanRead(text);
  const toks = fold(clean).split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  let de = 0, other = 0, brand: string | null = null;
  for (let i = 0; i < toks.length; i++) {
    const two = i + 1 < toks.length ? `${toks[i]} ${toks[i + 1]}` : "";
    const three = i + 2 < toks.length ? `${two} ${toks[i + 2]}` : "";
    // a maker ("Life Fitness", "gym80", "gym 80")
    const b = BRAND_KEYS.find((k) => k === toks[i] || k === two);
    if (b) { if (BRANDS[b]) brand = brand ?? BRANDS[b]; i += b.split(" ").length - 1; continue; }
    // a phrase ("Beinbeuger liegend", "Butterfly reverse") or a word the camera split in two ("BEIN PRESSE")
    const ph = [three, two].find((p) => p && p in DE_WORDS) ?? (two && (toks[i] + toks[i + 1]) in DE_WORDS ? "join" : null);
    if (ph) {
      const key = ph === "join" ? toks[i] + toks[i + 1] : ph;
      if (DE_WORDS[key]) { out.push(DE_WORDS[key]); de++; }
      i += ph === "join" ? 1 : key.split(" ").length - 1;
      continue;
    }
    const w = toks[i];
    if (/^\d+$/.test(w)) { if (toks[i + 1] === "grad" || toks[i + 1] === "degree") out.push(w); continue; }
    if (w === "grad") { out.push("degree"); continue; }
    const s = sayWord(w);
    if (s) {
      if (s.en) out.push(s.en);
      if (s.lang === "de") de++;
      else if (s.lang === "other") other++;
      continue;
    }
    if (w.length >= 2) out.push(w);
  }
  let english = out.join(" ").replace(/\s+/g, " ").trim();
  for (const [re, to] of EN_PHRASES) english = english.replace(re, to);
  // A German word read twice ("Beinpresse leg press" on a two language label) says it once.
  english = dedupe(english);
  const lang = de ? "de" : other ? "other" : "en";
  return { text: clean, english: english ? english[0].toUpperCase() + english.slice(1) : "", lang, brand };
}
function dedupe(s: string): string {
  const w = s.split(" ");
  for (let n = Math.floor(w.length / 2); n >= 1; n--) {
    for (let i = 0; i + 2 * n <= w.length; i++) {
      const a = w.slice(i, i + n).join(" ");
      if (a === w.slice(i + n, i + 2 * n).join(" ")) { w.splice(i + n, n); return dedupe(w.join(" ")); }
    }
  }
  return w.join(" ");
}

// ---------- 3. match ----------
/** Words that say how or with what, never which exercise: they help a match but cannot make one. */
const GENERIC = new Set(words("machine cable dumbbell barbell seated standing lying kneeling single two arm leg station bench bar grip wide close incline decline flat smith rope over head degree 45 upper lower front rear back ab glute hip chest shoulder"));
const VOCAB = new Set<string>();
const LIB_KEYS = LIBRARY.map((e) => {
  const keys = [e.name, ...e.aliases].map(words).filter((k) => k.length);
  keys.forEach((k) => k.forEach((x) => VOCAB.add(x)));
  return { e, keys };
});
const KEYS_BY_ID = new Map(LIB_KEYS.map((x) => [x.e.id, x.keys]));

function sim(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 4 || b.length < 4) return 0;
  if (a.startsWith(b) || b.startsWith(a)) return 0.85;
  const r = like(a, b);
  return r >= 0.75 ? r * 0.95 : 0;
}
function keyScore(read: string[], gym: string[], k: string[]): { score: number; real: boolean } {
  const best = (w: string, list: string[]) => Math.max(0, ...list.map((x) => sim(w, x)));
  const hits = k.map((w) => best(w, read));
  const cand = hits.reduce((a, b) => a + b, 0) / k.length;
  const back = gym.length ? gym.reduce((a, w) => a + best(w, k), 0) / gym.length : 0;
  const real = k.some((w, i) => !GENERIC.has(w) && hits[i] >= 0.75);
  return { score: 0.65 * cand + 0.35 * back, real };
}

export interface MatchOpts { own?: ScanOwn[]; planIds?: ReadonlySet<string>; min?: number }
/** The exercise the label names: the developer's own first, then the library. Null when nothing is close enough. */
export function matchScan(raw: string, o: MatchOpts = {}): ScanResult {
  const read = toEnglish(raw);
  const rw = [...new Set(words(read.english))];
  const gym = rw.filter((w) => VOCAB.has(w) || [...VOCAB].some((v) => sim(w, v) >= 0.85));
  const min = o.min ?? 0.6;
  const hits: ScanHit[] = [];
  const add = (name: string, exId: string | null, from: ScanFrom, keys: string[][], bonus: number) => {
    let s = 0;
    keys.forEach((k, i) => {
      const r = keyScore(rw, gym, k);
      if (r.real) s = Math.max(s, r.score * (i ? 0.99 : 1));
    });
    if (s > 0) hits.push({ name, exId, from, score: Math.round(Math.min(1, s + bonus) * 1000) / 1000 });
  };
  if (rw.length) {
    for (const x of o.own ?? []) {
      const keys = [words(x.name), ...(x.exId ? KEYS_BY_ID.get(x.exId) ?? [] : [])].filter((k) => k.length);
      add(x.name, x.exId, x.inPlan ? "plan" : "yours", keys, 0.04);
    }
    for (const { e, keys } of LIB_KEYS) add(e.name, e.id, o.planIds?.has(e.id) ? "plan" : "library", keys, o.planIds?.has(e.id) ? 0.04 : 0);
  }
  hits.sort((a, b) => b.score - a.score || rank(a) - rank(b) || a.name.length - b.name.length);
  const seen = new Set<string>();
  const list = hits.filter((h) => {
    const k = h.exId ?? `n:${h.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const best = list[0] && list[0].score >= min ? list[0] : null;
  const others = best ? list.slice(1).filter((h) => h.score >= min - 0.05 && h.score >= best.score - 0.25).slice(0, 3) : [];
  return { ...read, best, others };
}
const rank = (h: ScanHit) => (h.from === "plan" ? 0 : h.from === "yours" ? 1 : 2);
