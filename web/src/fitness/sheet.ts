// Reads the developer's trainer's plan sheet into a Program, and writes a logged week back in the same layout. The sheet ("Current split") has DAY 1 to DAY 4
// blocks, each with an Exercise | Sets and Reps | Weight | RIR header and one row per exercise,
// written by hand: "3 sets x 12, 10, 10", "4 x 8-10", "20kg each side", "bodyweight", "rir 1-2".
// Rows come from the Sheets API (values), a CSV download or a paste from Google Sheets (tabs).
// Nothing here touches the network; the caller fetches the rows read only.
import { REST, findExercise, getExercise, matchExercise } from "./library.ts";
import type {
  LoggedDay, LoggedExercise, LoggedSet, LoggedWeek, PlannedExercise, PlannedSet, Program, ProgramDay, RirSpec, SetsReps, WeightSpec,
} from "./types.ts";

export type Cell = string | number | boolean | null | undefined;

/** Hyphen-like characters people paste ("8\u201310") all read as "-". */
const DASHES = /[‐-―−]/g;
const EXAMPLE = /^e\.?\s?g\.?\s*:?\s*/i;
const NUM = "(\\d+(?:\\.\\d+)?)";

const cellText = (v: Cell) => String(v ?? "").replace(/\[merged\]/gi, " ").replace(/\s+/g, " ").trim();

/** Lower case, dashes and "x" signs made plain, "e.g." dropped, "22,5" read as 22.5. */
function norm(raw: string) {
  return raw.replace(DASHES, "-").replace(/[×*]/g, "x").replace(EXAMPLE, "").toLowerCase()
    .replace(/(\d),(\d)(?!\d)/g, "$1.$2").replace(/\s+/g, " ").trim();
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Sets and reps

const TIME = /^(s|sec|secs|second|seconds|min|mins|minute|minutes)$/;
const toSec = (n: number, unit?: string) => (unit && unit.startsWith("m") ? n * 60 : n);

function repItem(raw: string): PlannedSet | null {
  const t = raw.replace(/\breps?\b/g, "").replace(/\beach\b/g, "").trim();
  if (!t) return null;
  if (/^(amrap|max|max reps|failure|to failure)$/.test(t)) return { amrap: true };
  let m = t.match(/^(\d+):(\d\d)$/);
  if (m) return { seconds: +m[1] * 60 + +m[2] };
  m = t.match(new RegExp(`^${NUM}\\s*(?:-|to)\\s*${NUM}\\s*([a-z]*)$`));
  if (m && (!m[3] || TIME.test(m[3]))) {
    const [a, b] = [+m[1], +m[2]].sort((x, y) => x - y);
    return m[3] ? { seconds: toSec(a, m[3]) } : a === b ? { reps: a } : { reps: a, repsMax: b };
  }
  m = t.match(new RegExp(`^${NUM}\\s*([a-z]*)$`));
  if (m && (!m[2] || TIME.test(m[2]))) return m[2] ? { seconds: toSec(+m[1], m[2]) } : { reps: +m[1] };
  return null;
}

function setsPart(p: string, notes: string[]): PlannedSet[] | null {
  let count: number | null = null;
  let rest = p;
  let m = p.match(/^(\d+)\s*(?:-|to)\s*(\d+)\s*(?:sets?|rounds?)?\s*(?:x|of)\s*(.+)$/);
  if (m) { count = Math.max(+m[1], +m[2]); rest = m[3]; notes.push(`${m[1]} to ${m[2]} sets`); }
  else if ((m = p.match(/^(\d+)\s*(?:sets?|rounds?)?\s*(?:x|of)\s*(.+)$/))) { count = +m[1]; rest = m[2]; }
  else if ((m = p.match(/^(\d+)\s*(?:sets?|rounds?)\s*[,:]?\s*(.*)$/))) { count = +m[1]; rest = m[2]; }
  rest = rest.trim();
  if (count !== null && !rest) return Array.from({ length: count }, () => ({}));
  const items = rest.split(/\s*(?:,|\/|;|\bthen\b|\band\b)\s*/).filter(Boolean).map(repItem);
  if (!items.length || items.some((x) => !x)) return null;
  let list = items as PlannedSet[];
  if (count === null) {
    if (list.length === 1) notes.push("set count missing");
    return list;
  }
  // "12x3" is almost always 3 sets of 12 written the other way round.
  if (count > 10 && list.length === 1 && list[0].reps !== undefined && !list[0].repsMax && list[0].reps <= 5) {
    notes.push(`read as ${list[0].reps} sets of ${count}`);
    [count, list] = [list[0].reps, [{ reps: count }]];
  }
  if (list.length === 1) return Array.from({ length: count }, () => ({ ...list[0] }));
  if (list.length < count) {
    notes.push(`${count} sets but ${list.length} rep counts`);
    return [...list, ...Array.from({ length: count - list.length }, () => ({ ...list[list.length - 1] }))];
  }
  if (list.length > count) notes.push(`${count} sets but ${list.length} rep counts`);
  return list;
}

export function parseSetsReps(raw: string): SetsReps {
  let s = norm(raw);
  const out: SetsReps = { sets: [], eachSide: false, ok: false, raw };
  if (!s) return out;
  const side = /\b(?:each|per|a)\s+(?:side|leg|arm|hand)\b|\/\s*(?:side|leg|arm)\b|\be\/s\b/g;
  if (side.test(s)) { out.eachSide = true; s = s.replace(side, " ").replace(/\s+/g, " ").trim(); }
  // Our own week export names drop sets, eg "3 sets x 10, 8, 8 (1 drop)" (V1.29): the sets are read as written.
  s = s.replace(/\(\s*\d+\s+drops?\s*\)/g, " ").replace(/\s+/g, " ").trim();
  const notes: string[] = [];
  let ok = true;
  for (const part of s.split("+").map((x) => x.trim()).filter(Boolean)) {
    const got = setsPart(part, notes);
    if (got) out.sets.push(...got);
    else ok = false;
  }
  out.ok = ok && out.sets.length > 0;
  if (!out.ok) notes.unshift("could not read sets and reps");
  if (notes.length) out.note = notes.join("; ");
  return out;
}

// Weight

export function parseWeight(raw: string): WeightSpec {
  let s = norm(raw);
  const w: WeightSpec = { perSide: null, bodyweight: false, raw };
  if (!s) return w;
  const side = /\b(?:each|per|a)\s+(?:side|hand|arm|dumbbell|db|bell|leg)\b|\/\s*(?:side|hand)\b|\beach\b|\bea\b|\bx\s*2\b/g;
  if (side.test(s)) { w.perSide = true; s = s.replace(side, " "); }
  if (/^2\s*x\s*\d/.test(s)) { w.perSide = true; s = s.replace(/^2\s*x\s*/, ""); }
  if (/\b(?:total|combined)\b/.test(s)) { w.perSide = false; s = s.replace(/\b(?:in\s+)?(?:total|combined)\b/g, " "); }
  const bw = /\b(?:bw|body\s*weight|bodyweight|own\s*weight|no\s*weight|body)\b/;
  if (bw.test(s)) { w.bodyweight = true; s = s.replace(bw, " "); }
  const assist = /\bassist(?:ed|ance)?\b/.test(s) || (w.bodyweight && /-\s*\d/.test(s.replace(/\d\s*-\s*\d/g, "")));
  if (assist) w.bodyweight = true;
  const lb = /\d\s*(?:lbs?|pounds?)\b|\b(?:lbs?|pounds?)\b/.test(s);
  if (/\b(?:level|pin|plate|stack|notch|setting|hole)\b/.test(s)) { w.note = raw.replace(EXAMPLE, "").trim(); return w; }
  const kg = (n: number) => (lb ? round1(n * 0.45359237) : n);
  if (lb) w.fromLb = true;
  const range = s.match(new RegExp(`${NUM}\\s*(?:kgs?|lbs?)?\\s*(?:-|to)\\s*${NUM}`));
  const nums = [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => +m[0]);
  if (w.bodyweight) {
    if (nums.length) w.kg = (assist ? -1 : 1) * kg(nums[0]);
  } else if (range && !/[,/;]/.test(s)) {
    w.kg = kg(+range[1]);
    w.kgMax = kg(+range[2]);
  } else if (nums.length > 1) {
    w.perSet = nums.map(kg);
    w.kg = w.perSet[0];
  } else if (nums.length === 1) w.kg = kg(nums[0]);
  const left = s.replace(/\d+(?:\.\d+)?/g, " ").replace(/\b(?:kgs?|kilos?|lbs?|pounds?|assist(?:ed|ance)?|with|plus|added|extra)\b/g, " ").replace(/[^a-z?]+/g, " ").trim();
  if (left || (!nums.length && !w.bodyweight)) w.note = raw.replace(EXAMPLE, "").trim();
  return w;
}

// Reps in reserve

export function parseRir(raw: string): RirSpec | null {
  let s = norm(raw);
  if (!s) return null;
  if (/fail/.test(s)) return { min: 0, max: 0, raw };
  const fromRpe = /\brpe\b/.test(s);
  s = s.replace(/\b(?:rir|rpe|reps? in reserve|in reserve)\b|@/g, " ").trim();
  const conv = (n: number) => (fromRpe ? round1(10 - n) : n);
  const okN = (n: number) => Number.isFinite(n) && n >= 0 && n <= 10;
  const m = s.match(new RegExp(`^${NUM}\\s*(?:-|to)\\s*${NUM}$`));
  if (m) {
    const [a, b] = [conv(+m[1]), conv(+m[2])].sort((x, y) => x - y);
    return okN(a) && okN(b) ? { min: a, max: b, raw, ...(fromRpe && { fromRpe }) } : null;
  }
  const list = s.split(/\s*[,/;]\s*|\s+/).filter(Boolean).map((x) => conv(+x));
  if (!list.length || !list.every(okN)) return null;
  const spec: RirSpec = { min: Math.min(...list), max: Math.max(...list), raw };
  if (list.length > 1) spec.perSet = list;
  if (fromRpe) spec.fromRpe = true;
  return spec;
}

/** Rest cell to seconds: "90s", "2 min", "1:30", "2-3 min" (the lower end). A bare 1 to 10 is minutes. */
export function parseRest(raw: string): number | null {
  const s = norm(raw);
  if (!s) return null;
  let m = s.match(/^(\d+):(\d\d)/);
  if (m) return +m[1] * 60 + +m[2];
  m = s.match(new RegExp(`^${NUM}\\s*(?:(?:-|to)\\s*${NUM}\\s*)?([a-z]*)`));
  if (!m) return null;
  const n = +m[1];
  const unit = m[3];
  if (unit.startsWith("m")) return Math.round(n * 60);
  if (unit.startsWith("s")) return Math.round(n);
  return unit ? null : n <= 10 ? Math.round(n * 60) : Math.round(n);
}

// The sheet

/** CSV or tab separated text (a paste from Google Sheets) to rows of cells. */
export function parseDelimited(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = first.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

interface Cols { exercise: number; setsReps: number; weight: number; rir: number; rest: number; notes: number }

const HEAD: [keyof Cols, RegExp][] = [
  ["exercise", /exercise|movement|^name$/],
  ["setsReps", /sets|reps/],
  ["weight", /weight|load|^kgs?$|lbs/],
  ["rir", /rir|rpe|effort|reserve|intensity/],
  ["rest", /rest/],
  ["notes", /note|comment|cue|tempo/],
];

function headerCols(row: string[], c0: number, c1: number): Cols | null {
  const cols: Cols = { exercise: -1, setsReps: -1, weight: -1, rir: -1, rest: -1, notes: -1 };
  for (let c = c0; c < Math.min(c1, row.length); c++) {
    const t = row[c].toLowerCase();
    if (!t) continue;
    const hit = HEAD.find(([k, re]) => cols[k] < 0 && re.test(t));
    if (hit) cols[hit[0]] = c;
  }
  const found = Object.values(cols).filter((v) => v >= 0).length;
  return cols.exercise >= 0 && found >= 2 ? cols : null;
}

/** "A1. Bench press" is superset A; "1)" or "2." numbering is dropped. */
function splitLabel(name: string): { name: string; superset?: string } {
  let m = name.match(/^([a-z])\s*(\d+)\s*[).:-]?\s+(.+)$/i) ?? name.match(/^(\d+)\s*([a-z])\s*[).:-]\s*(.+)$/i);
  if (m) {
    const letter = /[a-z]/i.test(m[1]) ? m[1] : m[2];
    return { name: m[3].trim(), superset: letter.toUpperCase() };
  }
  m = name.match(/^\d+\s*[).:-]\s*(.+)$/);
  return { name: (m ? m[1] : name).trim() };
}

export interface ImportOpts {
  /** Keep rows that start with "e.g." (the template's example row). Off by default. */
  keepExamples?: boolean;
  /** Lowest library match score that still counts as a match (0 to 1). */
  minMatch?: number;
}

interface Anchor { r: number; c: number; index: number; title: string }

/** The trainer's sheet as rows of cells (first row first) to a Program. */
export function importTrainerSheet(rows: Cell[][], o: ImportOpts = {}): Program {
  const grid = rows.map((r) => (r ?? []).map(cellText));
  const warnings: string[] = [];
  const anchors: Anchor[] = [];
  grid.forEach((row, r) => row.forEach((t, c) => {
    const m = t.match(/^day\s*(\d+)\b\s*[:.-]?\s*(.*)$/i);
    // A merged heading comes back repeated in every cell it covers: keep the leftmost.
    if (m && !anchors.some((a) => a.r === r && a.index === +m[1])) anchors.push({ r, c, index: +m[1], title: m[2].trim() || `Day ${+m[1]}` });
  }));
  if (!anchors.length) {
    warnings.push("No DAY headings found; read the whole sheet as Day 1");
    anchors.push({ r: -1, c: 0, index: 1, title: "Day 1" });
  }
  const days: ProgramDay[] = [];
  for (const a of anchors) {
    const sameRow = anchors.filter((b) => b.r === a.r && b.c > a.c).map((b) => b.c);
    const c1 = sameRow.length ? Math.min(...sameRow) : Infinity;
    const below = anchors.filter((b) => b.r > a.r && Math.abs(b.c - a.c) <= 1).map((b) => b.r);
    const r1 = below.length ? Math.min(...below) : grid.length;
    let cols: Cols | null = null;
    let start = a.r + 1;
    for (let r = a.r + 1; r < r1 && !cols; r++) {
      cols = headerCols(grid[r] ?? [], a.c, c1);
      if (cols) start = r + 1;
    }
    cols ??= { exercise: a.c, setsReps: a.c + 1, weight: a.c + 2, rir: a.c + 3, rest: -1, notes: -1 };
    const day: ProgramDay = { index: a.index, title: a.title, exercises: [] };
    for (let r = start; r < r1; r++) {
      const ex = readRow(grid[r] ?? [], r, cols, o);
      if (typeof ex === "string") warnings.push(`Day ${a.index}, row ${r + 1}: ${ex}`);
      else if (ex) {
        day.exercises.push(ex);
        for (const w of ex.warnings) warnings.push(`Day ${a.index}, row ${r + 1}: ${w}`);
      }
    }
    if (days.some((d) => d.index === day.index)) warnings.push(`DAY ${day.index} appears more than once`);
    days.push(day);
  }
  days.sort((x, y) => x.index - y.index);
  return { days, warnings };
}

/** One sheet row to an exercise, null for a row to skip quietly, or a warning to skip loudly. */
function readRow(row: string[], r: number, cols: Cols, o: ImportOpts): PlannedExercise | string | null {
  const at = (c: number) => (c >= 0 ? row[c] ?? "" : "");
  const raw = { exercise: at(cols.exercise), setsReps: at(cols.setsReps), weight: at(cols.weight), rir: at(cols.rir) };
  const cells = [...Object.values(raw), at(cols.rest), at(cols.notes)];
  if (cells.every((x) => !x)) return null;
  if (/^exercises?$/i.test(raw.exercise)) return null;
  if (cells.some((x) => EXAMPLE.test(x)) && !o.keepExamples) return null;
  if (!raw.exercise) return "values but no exercise name, skipped";
  const { name, superset } = splitLabel(raw.exercise.replace(EXAMPLE, "").trim());
  const warnings: string[] = [];
  const hit = matchExercise(name, o.minMatch ?? 0.6);
  if (!hit) warnings.push(`no library match for "${name}"`);
  else if (hit.score < 0.85) warnings.push(`"${name}" read as ${hit.exercise.name}, please check`);
  const sr = parseSetsReps(raw.setsReps);
  if (raw.setsReps && sr.note) warnings.push(sr.note);
  if (!raw.setsReps) warnings.push("no sets and reps");
  const weight = parseWeight(raw.weight);
  const rir = parseRir(raw.rir);
  if (raw.rir && !rir) warnings.push(`could not read RIR "${raw.rir}"`);
  const rest = parseRest(at(cols.rest));
  const sets = sr.sets.map((s, i) => {
    const p: PlannedSet = { ...s };
    const kg = weight.perSet?.[i] ?? weight.perSet?.[weight.perSet.length - 1] ?? weight.kg;
    if (kg !== undefined) p.kg = kg;
    if (weight.kgMax !== undefined) p.kgMax = weight.kgMax;
    if (rir) {
      const one = rir.perSet?.[i] ?? rir.perSet?.[rir.perSet.length - 1];
      p.rirMin = one ?? rir.min;
      p.rirMax = one ?? rir.max;
    }
    return p;
  });
  const out: PlannedExercise = {
    name,
    exerciseId: hit?.exercise.id ?? null,
    match: hit?.score ?? 0,
    alternatives: hit?.alternatives.map((e) => e.id) ?? [],
    sets,
    eachSide: sr.eachSide,
    weight,
    rir,
    restSec: rest ?? hit?.exercise.restSec ?? REST.compound,
    perSide: weight.perSide ?? hit?.exercise.perSide ?? false,
    warnings,
    row: r,
    raw,
  };
  if (superset) out.superset = superset;
  const note = [at(cols.notes), weight.note].filter(Boolean).join("; ");
  if (note) out.note = note;
  return out;
}

/** Shortcut for a CSV download or a paste from Google Sheets. */
export const importTrainerText = (text: string, o: ImportOpts = {}) => importTrainerSheet(parseDelimited(text), o);

// Week export: a logged week back into the trainer's own layout, so the developer can hand it over as a
// file or a sheet in his own Drive. Nothing here sends or shares anything.

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const same = <T,>(xs: T[]) => xs.every((x) => x === xs[0]);
/** "12, 10, 10" or "10" when every set matches. */
const list = (xs: number[]) => (same(xs) ? fmt(xs[0]) : xs.map(fmt).join(", "));

export interface ExportOpts {
  /** A line above the first day ("Week 1, 3 to 6 Nov"). */
  title?: string;
  /** Keep warm up sets (off: the trainer wants working sets). */
  warmups?: boolean;
  /** Blank rows between days. */
  gap?: number;
  /** Put the date a day was trained next to its heading. */
  dates?: boolean;
}

function setsCell(ex: LoggedExercise, sets: LoggedSet[]) {
  if (!sets.length) return "not done";
  const timed = sets.every((s) => s.seconds != null && s.reps == null);
  const vals = sets.map((s) => (timed ? s.seconds : s.reps)).filter((v): v is number => v != null);
  const side = ex.eachSide ? " each side" : "";
  if (vals.length !== sets.length) return `${sets.length} sets${side}`;
  const label = sets.length === 1 ? "1 set" : `${sets.length} sets`;
  return `${label} x ${timed ? vals.map((v) => `${fmt(v)}s`).join(", ") : list(vals)}${side}`;
}

function weightCell(ex: LoggedExercise, sets: LoggedSet[]) {
  const lib = getExercise(ex.exerciseId ?? null) ?? findExercise(ex.name);
  const perSide = ex.perSide ?? lib?.perSide ?? false;
  const kgs = sets.map((s) => s.kg).filter((v): v is number => v != null);
  // Negative kg is machine assistance on body weight, whatever the exercise.
  const bodyweight = (ex.bodyweight ?? lib?.bodyweight ?? false) || kgs.some((k) => k < 0);
  if (bodyweight) {
    const extra = kgs.filter((k) => k !== 0);
    if (!extra.length) return "bodyweight";
    if (extra.every((k) => k < 0)) return `assisted ${list(extra.map((k) => -k))}kg`;
    return `bodyweight + ${list(extra)}kg`;
  }
  if (!kgs.length) return "";
  return `${list(kgs)}kg${perSide ? " each side" : ""}`;
}

function rirCell(sets: LoggedSet[]) {
  const r = sets.map((s) => s.rir).filter((v): v is number => v != null);
  if (!r.length) return "";
  const shown = r.map((v) => (v >= 4 ? "4+" : fmt(v)));
  return `rir ${same(shown) ? shown[0] : shown.join(", ")}`;
}

/**
 * One logged week as sheet rows: column A blank, then a DAY block per day with the
 * Exercise | Sets and Reps | Weight | RIR header and one row per exercise, as the trainer laid it out.
 * Takes the days, or a LoggedWeek.
 */
export function exportWeekRows(week: LoggedDay[] | LoggedWeek, o: ExportOpts = {}): string[][] {
  const days = Array.isArray(week) ? week : week.days;
  const gap = o.gap ?? 1;
  const rows: string[][] = [["", "", "", "", ""]];
  if (o.title) rows.push(["", o.title, "", "", ""]);
  rows.push(["", "", "", "", ""]);
  days.forEach((d, i) => {
    if (i) for (let g = 0; g < gap; g++) rows.push(["", "", "", "", ""]);
    let head = d.name ?? `DAY ${d.index ?? i + 1}`;
    if (d.title && !/^day\s*\d+$/i.test(d.title)) head += `: ${d.title}`;
    rows.push(["", head, o.dates && d.date ? d.date : "", "", ""]);
    rows.push(["", "Exercise", "Sets and Reps", "Weight", "RIR"]);
    for (const ex of d.exercises) {
      const sets = ex.sets.filter((s) => o.warmups || !s.warmup);
      const drops = sets.filter((s) => s.drop).length;   // V1.29: drop sets are named, so the trainer can tell
      rows.push(["", ex.name, setsCell(ex, sets) + (drops ? ` (${drops} drop)` : ""), sets.length ? weightCell(ex, sets) : "", rirCell(sets)]);
    }
  });
  return rows;
}

/** A spreadsheet would run a cell that starts with = + @ as a formula; a leading ' stops that. */
const safe = (v: string) => (/^[=+@]/.test(v) || /^-[^\d]/.test(v) ? `'${v}` : v);

export function rowsToCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => {
    const v = safe(c);
    return /[",\n\r]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",")).join("\n") + "\n";
}

/** Tab separated: pastes straight into a Google Sheet. */
export function rowsToTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => safe(c).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n") + "\n";
}

/** The contract name for the importer. */
export const parseTrainerSheet = importTrainerSheet;
