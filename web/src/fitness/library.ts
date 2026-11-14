// The exercise library for the Fitness tab: about 150 common gym exercises and a forgiving search
// that copes with gym shorthand ("db", "rdl", "ohp"), plurals and typos, so a trainer's
// "Overhead dumbell press" still lands on the right exercise.
import { CUES } from "./cues.ts";
import type { Equipment, Exercise, Kind, Muscle } from "./types.ts";

/**
 * Default rest in seconds: 2 min compound, 90 s isolation, 3 min for the big barbell lifts
 * (Schoenfeld 2016: 3 min beat 1 min for strength and size; research.md has the rest).
 */
export const REST = { heavy: 180, compound: 120, isolation: 90 } as const;

/** The usual weight jump in kg, by equipment (machine stacks go up in 5s, cables in 2.5s). */
export const STEP: Record<Equipment, number> = {
  barbell: 2.5, ezbar: 2.5, smith: 2.5, trapbar: 2.5, dumbbell: 2, kettlebell: 4,
  machine: 5, cable: 2.5, plate: 2.5, bodyweight: 2.5, other: 2.5,
};

interface Opts { heavy?: boolean; perSide?: boolean; timed?: boolean; rest?: number; step?: number }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function ex(name: string, equipment: Equipment, k: "C" | "I", muscles: string, aliases = "", o: Opts = {}): Exercise {
  const kind: Kind = k === "C" ? "compound" : "isolation";
  const id = slug(name);
  return {
    id,
    name,
    aliases: aliases ? aliases.split("|").map((a) => a.trim()) : [],
    equipment,
    muscles: muscles.split(" ") as Muscle[],
    kind,
    restSec: o.rest ?? (o.heavy ? REST.heavy : REST[kind]),
    perSide: o.perSide ?? equipment === "dumbbell",
    bodyweight: equipment === "bodyweight",
    timed: !!o.timed,
    step: o.step ?? STEP[equipment],
    cue: CUES[id],
  };
}

const H = { heavy: true };
const ONE = { perSide: false };

export const EXERCISES: readonly Exercise[] = [
  // Chest
  ex("Barbell bench press", "barbell", "C", "chest triceps front_delts", "bench press|flat bench|bench|flat barbell bench press", H),
  ex("Incline barbell bench press", "barbell", "C", "chest front_delts triceps", "incline bench|incline bench press|incline barbell press"),
  ex("Decline barbell bench press", "barbell", "C", "chest triceps", "decline bench|decline bench press"),
  ex("Close grip bench press", "barbell", "C", "triceps chest", "close grip bench|cgbp"),
  ex("Dumbbell bench press", "dumbbell", "C", "chest triceps front_delts", "db bench|flat dumbbell press|dumbbell chest press|db bench press"),
  ex("Incline dumbbell press", "dumbbell", "C", "chest front_delts triceps", "incline db press|incline dumbbell bench press|incline dumbbell chest press"),
  ex("Decline dumbbell press", "dumbbell", "C", "chest triceps", "decline db press|decline dumbbell bench press"),
  ex("Dumbbell floor press", "dumbbell", "C", "chest triceps", "db floor press"),
  ex("Machine chest press", "machine", "C", "chest triceps", "chest press|seated chest press|chest press machine"),
  ex("Incline machine press", "machine", "C", "chest front_delts", "incline chest press machine|incline machine chest press"),
  ex("Cable chest press", "cable", "C", "chest triceps", "standing cable press"),
  ex("Smith machine bench press", "smith", "C", "chest triceps", "smith bench|smith bench press"),
  ex("Smith machine incline press", "smith", "C", "chest front_delts", "smith incline|smith incline bench"),
  ex("Dumbbell fly", "dumbbell", "I", "chest", "db fly|flat dumbbell fly|chest fly"),
  ex("Incline dumbbell fly", "dumbbell", "I", "chest", "incline db fly|incline fly"),
  ex("Cable fly", "cable", "I", "chest", "cable crossover|cable chest fly|standing cable fly|crossover"),
  ex("Low to high cable fly", "cable", "I", "chest", "low cable fly|upward cable fly|low to high crossover"),
  ex("High to low cable fly", "cable", "I", "chest", "high cable fly|downward cable fly|high to low crossover"),
  ex("Pec deck", "machine", "I", "chest", "machine fly|pec fly|butterfly|chest fly machine|pec deck fly"),
  ex("Push up", "bodyweight", "C", "chest triceps front_delts", "press up|pushup"),
  ex("Incline push up", "bodyweight", "C", "chest triceps", "incline press up"),
  ex("Chest dip", "bodyweight", "C", "chest triceps", "weighted dip|chest dips"),
  ex("Dumbbell pullover", "dumbbell", "I", "chest lats", "pullover|db pullover", ONE),

  // Back and hinge
  ex("Deadlift", "barbell", "C", "hamstrings glutes lower_back", "conventional deadlift|barbell deadlift", H),
  ex("Sumo deadlift", "barbell", "C", "glutes adductors hamstrings", "sumo", H),
  ex("Trap bar deadlift", "trapbar", "C", "quads glutes hamstrings", "hex bar deadlift|trap bar lift", H),
  ex("Romanian deadlift", "barbell", "C", "hamstrings glutes", "rdl|barbell rdl|barbell romanian deadlift"),
  ex("Dumbbell romanian deadlift", "dumbbell", "C", "hamstrings glutes", "db rdl|dumbbell rdl"),
  ex("Stiff leg deadlift", "barbell", "C", "hamstrings glutes", "sldl|straight leg deadlift"),
  ex("Single leg romanian deadlift", "dumbbell", "C", "hamstrings glutes", "single leg rdl|sl rdl|one leg rdl"),
  ex("Rack pull", "barbell", "C", "upper_back lower_back glutes", "block pull"),
  ex("Good morning", "barbell", "C", "hamstrings lower_back", "barbell good morning"),
  ex("Back extension", "bodyweight", "I", "lower_back glutes hamstrings", "hyperextension|45 degree back extension|roman chair back extension"),
  ex("Reverse hyperextension", "machine", "I", "glutes hamstrings", "reverse hyper"),
  ex("Pull up", "bodyweight", "C", "lats biceps", "pullup|wide grip pull up|weighted pull up"),
  ex("Chin up", "bodyweight", "C", "lats biceps", "chinup|underhand pull up"),
  ex("Assisted pull up", "machine", "C", "lats biceps", "assisted pull up machine|gravitron|assisted chin up"),
  ex("Lat pulldown", "cable", "C", "lats biceps", "lat pull down|wide grip lat pulldown|pulldown|lat pulldown machine"),
  ex("Close grip lat pulldown", "cable", "C", "lats biceps", "close grip pulldown|v bar pulldown|neutral grip pulldown"),
  ex("Underhand lat pulldown", "cable", "C", "lats biceps", "reverse grip pulldown|supinated pulldown|underhand pulldown"),
  ex("Single arm lat pulldown", "cable", "C", "lats", "one arm pulldown|single arm pulldown"),
  ex("Straight arm pulldown", "cable", "I", "lats", "straight arm pushdown|cable pullover|straight arm lat pulldown"),
  ex("Barbell row", "barbell", "C", "upper_back lats", "bent over row|bb row|bent over barbell row"),
  ex("Pendlay row", "barbell", "C", "upper_back lats"),
  ex("Seal row", "barbell", "C", "upper_back lats", "bench row"),
  ex("Meadows row", "barbell", "C", "lats upper_back", "landmine single arm row"),
  ex("Dumbbell row", "dumbbell", "C", "lats upper_back", "single arm dumbbell row|one arm dumbbell row|db row|single arm db row|bent over dumbbell row"),
  ex("Chest supported dumbbell row", "dumbbell", "C", "upper_back lats", "incline dumbbell row|chest supported row|incline db row"),
  ex("Seated cable row", "cable", "C", "upper_back lats", "cable row|seated row|low row|wide grip seated row"),
  ex("Single arm cable row", "cable", "C", "lats upper_back", "one arm cable row"),
  ex("T bar row", "plate", "C", "upper_back lats", "landmine row|chest supported t bar row"),
  ex("Machine row", "machine", "C", "upper_back lats", "seated machine row|chest supported machine row|hammer strength row|row machine"),
  ex("Inverted row", "bodyweight", "C", "upper_back lats", "bodyweight row|australian pull up|ring row"),
  ex("Face pull", "cable", "I", "rear_delts upper_back", "cable face pull|rope face pull"),
  ex("Barbell shrug", "barbell", "I", "traps", "shrug|shrugs"),
  ex("Dumbbell shrug", "dumbbell", "I", "traps", "db shrug"),

  // Shoulders
  ex("Overhead press", "barbell", "C", "front_delts triceps", "ohp|military press|standing barbell press|barbell shoulder press|barbell overhead press", H),
  ex("Seated dumbbell shoulder press", "dumbbell", "C", "front_delts side_delts triceps", "dumbbell shoulder press|db shoulder press|seated db press|seated dumbbell press"),
  ex("Standing dumbbell overhead press", "dumbbell", "C", "front_delts side_delts triceps", "overhead dumbbell press|dumbbell overhead press|standing db press|standing dumbbell press"),
  ex("Arnold press", "dumbbell", "C", "front_delts side_delts triceps", "arnold dumbbell press"),
  ex("Machine shoulder press", "machine", "C", "front_delts triceps", "shoulder press machine|seated shoulder press|shoulder press"),
  ex("Smith machine shoulder press", "smith", "C", "front_delts triceps", "smith shoulder press|smith overhead press"),
  ex("Push press", "barbell", "C", "front_delts triceps quads"),
  ex("Landmine press", "barbell", "C", "front_delts chest", "single arm landmine press"),
  ex("Dumbbell lateral raise", "dumbbell", "I", "side_delts", "lateral raise|side raise|lat raise|db lateral raise|side lateral raise|seated lateral raise"),
  ex("Cable lateral raise", "cable", "I", "side_delts", "single arm cable lateral raise|cable side raise"),
  ex("Machine lateral raise", "machine", "I", "side_delts", "lateral raise machine"),
  ex("Dumbbell front raise", "dumbbell", "I", "front_delts", "front raise|db front raise"),
  ex("Cable front raise", "cable", "I", "front_delts"),
  ex("Plate front raise", "plate", "I", "front_delts", "plate raise", { step: 5 }),
  ex("Rear delt fly", "dumbbell", "I", "rear_delts", "reverse fly|bent over reverse fly|rear delt raise|db rear delt fly|bent over lateral raise"),
  ex("Reverse pec deck", "machine", "I", "rear_delts", "reverse machine fly|rear delt machine|reverse fly machine"),
  ex("Cable rear delt fly", "cable", "I", "rear_delts", "cable reverse fly|cable rear delt"),
  ex("Upright row", "barbell", "C", "side_delts traps", "barbell upright row"),
  ex("Dumbbell upright row", "dumbbell", "C", "side_delts traps", "db upright row"),
  ex("Cable upright row", "cable", "C", "side_delts traps"),

  // Biceps and forearms
  ex("Barbell curl", "barbell", "I", "biceps", "bb curl|standing barbell curl"),
  ex("EZ bar curl", "ezbar", "I", "biceps", "ez curl|ez bar bicep curl"),
  ex("Dumbbell curl", "dumbbell", "I", "biceps", "db curl|bicep curl|biceps curl|alternating dumbbell curl|dumbbell bicep curl"),
  ex("Hammer curl", "dumbbell", "I", "biceps forearms", "db hammer curl|dumbbell hammer curl"),
  ex("Incline dumbbell curl", "dumbbell", "I", "biceps", "incline curl|incline db curl"),
  ex("Preacher curl", "ezbar", "I", "biceps", "ez bar preacher curl|barbell preacher curl"),
  ex("Dumbbell preacher curl", "dumbbell", "I", "biceps", "db preacher curl|single arm preacher curl"),
  ex("Machine preacher curl", "machine", "I", "biceps", "machine curl|bicep curl machine|machine bicep curl"),
  ex("Concentration curl", "dumbbell", "I", "biceps"),
  ex("Spider curl", "dumbbell", "I", "biceps"),
  ex("Cable curl", "cable", "I", "biceps", "cable bicep curl|straight bar cable curl"),
  ex("Rope hammer curl", "cable", "I", "biceps forearms", "cable hammer curl|rope curl"),
  ex("Bayesian curl", "cable", "I", "biceps", "behind the body cable curl"),
  ex("Reverse curl", "ezbar", "I", "forearms biceps", "reverse grip curl|ez bar reverse curl"),
  ex("Wrist curl", "dumbbell", "I", "forearms", "forearm curl"),

  // Triceps
  ex("Triceps pushdown", "cable", "I", "triceps", "tricep pushdown|cable pushdown|bar pushdown|tricep pressdown|triceps pressdown"),
  ex("Rope pushdown", "cable", "I", "triceps", "rope tricep pushdown|rope pressdown|rope triceps extension"),
  ex("Overhead cable triceps extension", "cable", "I", "triceps", "overhead rope extension|cable overhead extension|overhead tricep extension cable"),
  ex("Overhead dumbbell triceps extension", "dumbbell", "I", "triceps", "dumbbell overhead extension|seated tricep extension|overhead tricep extension", ONE),
  ex("Skull crusher", "ezbar", "I", "triceps", "lying triceps extension|skullcrusher|ez bar skull crusher"),
  ex("Dumbbell skull crusher", "dumbbell", "I", "triceps", "db skull crusher|dumbbell lying triceps extension"),
  ex("Triceps kickback", "dumbbell", "I", "triceps", "tricep kickback|db kickback|dumbbell kickback"),
  ex("Cable triceps kickback", "cable", "I", "triceps", "cable kickback tricep"),
  ex("Machine triceps extension", "machine", "I", "triceps", "tricep extension machine|seated triceps extension machine"),
  ex("Triceps dip", "bodyweight", "C", "triceps chest", "dip|dips|parallel bar dip|tricep dip"),
  ex("Bench dip", "bodyweight", "C", "triceps", "bench dips|chair dip"),
  ex("Machine dip", "machine", "C", "triceps chest", "seated dip machine|dip machine|assisted dip"),
  ex("Diamond push up", "bodyweight", "C", "triceps chest", "close grip push up|diamond press up"),

  // Legs
  ex("Back squat", "barbell", "C", "quads glutes", "squat|barbell squat|high bar squat|low bar squat|barbell back squat", H),
  ex("Front squat", "barbell", "C", "quads glutes", "barbell front squat", H),
  ex("Goblet squat", "dumbbell", "C", "quads glutes", "db goblet squat|kettlebell goblet squat|dumbbell goblet squat", ONE),
  ex("Smith machine squat", "smith", "C", "quads glutes", "smith squat"),
  ex("Hack squat", "machine", "C", "quads glutes", "machine hack squat|hack squat machine"),
  ex("Leg press", "machine", "C", "quads glutes", "45 degree leg press|seated leg press|leg press machine"),
  ex("Single leg press", "machine", "C", "quads glutes", "single leg leg press|one leg press"),
  ex("Pendulum squat", "machine", "C", "quads glutes"),
  ex("Belt squat", "machine", "C", "quads glutes"),
  ex("Bulgarian split squat", "dumbbell", "C", "quads glutes", "rear foot elevated split squat|bss|rfess|bulgarians"),
  ex("Split squat", "dumbbell", "C", "quads glutes", "static lunge|dumbbell split squat"),
  ex("Forward lunge", "dumbbell", "C", "quads glutes", "lunge|lunges|dumbbell lunge|db lunge"),
  ex("Walking lunge", "dumbbell", "C", "quads glutes", "db walking lunge|dumbbell walking lunge"),
  ex("Reverse lunge", "dumbbell", "C", "quads glutes", "rear lunge|dumbbell reverse lunge"),
  ex("Barbell lunge", "barbell", "C", "quads glutes", "barbell walking lunge"),
  ex("Step up", "dumbbell", "C", "quads glutes", "dumbbell step up|box step up"),
  ex("Leg extension", "machine", "I", "quads", "quad extension|knee extension|leg extension machine"),
  ex("Lying leg curl", "machine", "I", "hamstrings", "prone leg curl|lying hamstring curl"),
  ex("Seated leg curl", "machine", "I", "hamstrings", "leg curl|hamstring curl|seated hamstring curl"),
  ex("Nordic curl", "bodyweight", "I", "hamstrings", "nordic hamstring curl|nordics"),
  ex("Sissy squat", "bodyweight", "I", "quads"),
  ex("Hip thrust", "barbell", "C", "glutes hamstrings", "barbell hip thrust|glute thrust"),
  ex("Machine hip thrust", "machine", "C", "glutes", "hip thrust machine|glute drive"),
  ex("Glute bridge", "bodyweight", "C", "glutes hamstrings", "bridge|barbell glute bridge"),
  ex("Cable pull through", "cable", "C", "glutes hamstrings", "pull through"),
  ex("Cable glute kickback", "cable", "I", "glutes", "glute kickback|cable kickback"),
  ex("Hip abduction machine", "machine", "I", "abductors glutes", "hip abduction|abductor machine|outer thigh machine|abductors"),
  ex("Hip adduction machine", "machine", "I", "adductors", "hip adduction|adductor machine|inner thigh machine|adductors"),
  ex("Standing calf raise", "machine", "I", "calves", "calf raise|calf raises|machine calf raise"),
  ex("Seated calf raise", "machine", "I", "calves", "seated calf"),
  ex("Leg press calf raise", "machine", "I", "calves", "calf press|calf press on leg press"),
  ex("Smith machine calf raise", "smith", "I", "calves", "smith calf raise"),
  ex("Dumbbell calf raise", "dumbbell", "I", "calves", "single leg calf raise|db calf raise"),
  ex("Kettlebell swing", "kettlebell", "C", "glutes hamstrings", "kb swing|russian swing|swings"),

  // Core and carries
  ex("Plank", "bodyweight", "I", "abs", "front plank", { timed: true }),
  ex("Side plank", "bodyweight", "I", "obliques", "", { timed: true }),
  ex("Crunch", "bodyweight", "I", "abs", "crunches|floor crunch"),
  ex("Decline sit up", "bodyweight", "I", "abs", "sit up|situps|decline crunch"),
  ex("Cable crunch", "cable", "I", "abs", "kneeling cable crunch|rope crunch"),
  // V1.59 (the developer): the way he types it. Kneeling at a high cable, so "abs", "cable" and "crunch" all find it.
  ex("Abs cable crunch", "cable", "I", "abs", "abs crunch|ab cable crunch|cable abs|high cable crunch|cable ab crunch|kneeling rope crunch"),
  ex("Machine crunch", "machine", "I", "abs", "ab crunch machine|ab machine"),
  ex("Hanging leg raise", "bodyweight", "I", "abs", "hanging knee raise|leg raises|toes to bar"),
  ex("Captains chair knee raise", "bodyweight", "I", "abs", "roman chair leg raise|knee raise|captains chair"),
  ex("Lying leg raise", "bodyweight", "I", "abs", "floor leg raise"),
  ex("Ab wheel rollout", "other", "I", "abs", "ab rollout|ab wheel|rollout"),
  ex("Russian twist", "bodyweight", "I", "obliques", "russian twists"),
  ex("Pallof press", "cable", "I", "obliques abs", "anti rotation press"),
  ex("Cable woodchop", "cable", "I", "obliques", "woodchopper|wood chop"),
  ex("Dead bug", "bodyweight", "I", "abs", "deadbug"),
  ex("Farmers carry", "dumbbell", "C", "forearms traps", "farmers walk|farmer walk|loaded carry|farmer carry", { timed: true }),
];

/** The contract name for the list. */
export const LIBRARY = EXERCISES;

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));
export const getExercise = (id: string | null | undefined) => (id ? BY_ID.get(id) : undefined);

/** The weight jump for an "add weight" hint. */
export const stepFor = (ex: Exercise) => ex.step;

/** Muscles in plain words for the screen. */
export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: "chest", lats: "lats", upper_back: "upper back", traps: "traps", front_delts: "front shoulders",
  side_delts: "side shoulders", rear_delts: "rear shoulders", biceps: "biceps", triceps: "triceps",
  forearms: "forearms", quads: "quads", hamstrings: "hamstrings", glutes: "glutes", calves: "calves",
  adductors: "inner thighs", abductors: "outer hips", abs: "abs", obliques: "obliques", lower_back: "lower back",
};

// Search. Words are cleaned the same way on both sides: lower case, gym shorthand expanded,
// split words joined ("pull down" = "pulldown"), plurals dropped, filler words removed.
const SHORT: Record<string, string> = {
  db: "dumbbell", dbs: "dumbbell", dumbell: "dumbbell", dumbells: "dumbbell", bb: "barbell", kb: "kettlebell",
  ohp: "overhead press", rdl: "romanian deadlift", rdls: "romanian deadlift", sldl: "stiff leg deadlift",
  bss: "bulgarian split squat", rfess: "bulgarian split squat", cgbp: "close grip bench press",
  tri: "triceps", tricep: "triceps", bicep: "biceps", bi: "biceps", lats: "lat", delts: "delt", pecs: "pec",
  ext: "extension", flye: "fly", flyes: "fly", flies: "fly", one: "single", "1": "single", sl: "single leg",
  alt: "alternating", inc: "incline", bw: "bodyweight", pressdown: "pushdown",
  hammies: "hamstring", hams: "hamstring", quads: "quad", glutes: "glute", hex: "trap", ez: "ez",
  military: "military", peck: "pec", situp: "situp", chinups: "chinup", pullups: "pullup", pushups: "pushup",
};
const STOP = new Set(["the", "a", "an", "with", "on", "and", "of", "for", "to", "exercise", "eg", "e", "g", "using", "x", "w"]);
const JOIN = /\b(pull|push|chin|sit|step|kick|press|skull|dead|t|ez|wood)[\s-]+(ups?|downs?|backs?|crushers?|lifts?|bar|bugs?|chops?)\b/g;

function stem(w: string) {
  if (w.length <= 3) return w;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function words(s: string): string[] {
  const t = s.toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(JOIN, "$1$2");
  const out: string[] = [];
  for (const w of t.split(" ")) {
    if (!w) continue;
    for (const p of (SHORT[w] ?? w).split(" ")) {
      const x = stem(SHORT[p] ?? p);
      if (!STOP.has(x)) out.push(x);
    }
  }
  return out;
}

function lev(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** How alike two words are, 0 to 1. `prefix` lets a half typed word match ("pul" for "pulldown"). */
function wordSim(q: string, c: string, prefix: boolean) {
  if (q === c) return 1;
  if (prefix && q.length >= 1 && c.startsWith(q)) return 0.9;
  if (q.length >= 3 && c.length >= 3 && (c.startsWith(q) || q.startsWith(c))) return 0.8;
  if (q.length < 4 || c.length < 4) return 0;
  const r = 1 - lev(q, c) / Math.max(q.length, c.length);
  return r >= 0.75 ? r * 0.9 : 0;
}

/**
 * Word-bag likeness of query words q and candidate words c. `dice` needs both sides covered
 * (used to match a trainer's name); `cover` only asks that every typed word is found (search).
 */
function bagScore(q: string[], c: string[], prefixLast: boolean) {
  if (q.join(" ") === c.join(" ")) return { dice: 1, cover: 1 };
  const sim = (w: string, i: number, x: string) => wordSim(w, x, prefixLast && i === q.length - 1);
  let sq = 0;
  q.forEach((w, i) => { sq += Math.max(...c.map((x) => sim(w, i, x))); });
  let sc = 0;
  for (const x of c) sc += Math.max(...q.map((w, i) => sim(w, i, x)));
  return { dice: (sq + sc) / (q.length + c.length), cover: sq / q.length };
}

const INDEX = EXERCISES.map((e) => ({ e, keys: [e.name, ...e.aliases].map(words).filter((k) => k.length) }));

export interface Hit { exercise: Exercise; score: number }

function rank(q: string[], mode: "match" | "search"): Hit[] {
  const hits: Hit[] = [];
  for (const { e, keys } of INDEX) {
    let best = 0;
    keys.forEach((k, i) => {
      const r = bagScore(q, k, mode === "search");
      let s = mode === "search" ? 0.7 * r.cover + 0.3 * r.dice : r.dice;
      if (i > 0) s *= 0.99; // the real name wins a tie with an alias
      if (s > best) best = s;
    });
    if (best > 0) hits.push({ exercise: e, score: Math.round(best * 1000) / 1000 });
  }
  return hits.sort((a, b) => b.score - a.score || a.exercise.name.length - b.exercise.name.length);
}

export interface SearchOpts { limit?: number; muscle?: Muscle; equipment?: Equipment; kind?: Kind }

/** Search as the developer types, with scores. An empty query lists everything (after filters) A to Z. */
export function searchHits(query: string, o: SearchOpts = {}): Hit[] {
  const keep = (e: Exercise) => (!o.muscle || e.muscles.includes(o.muscle)) && (!o.equipment || e.equipment === o.equipment) && (!o.kind || e.kind === o.kind);
  const q = words(query);
  const list = q.length
    ? rank(q, "search").filter((h) => h.score >= 0.35 && keep(h.exercise))
    : EXERCISES.filter(keep).map((exercise) => ({ exercise, score: 0 })).sort((a, b) => a.exercise.name.localeCompare(b.exercise.name));
  return list.slice(0, o.limit ?? 10);
}

/** The phone picker: best matches first. */
export function searchExercises(query: string, limit: number | SearchOpts = 10): Exercise[] {
  return searchHits(query, typeof limit === "number" ? { limit } : limit).map((h) => h.exercise);
}

/** Best library exercise for a name written by someone else (a trainer's sheet), or null. */
export function matchExercise(name: string, min = 0.6): { exercise: Exercise; score: number; alternatives: Exercise[] } | null {
  const tries = [name, name.replace(/\([^)]*\)/g, " ")].map(words).filter((w) => w.length);
  let hits: Hit[] = [];
  for (const t of tries) {
    const r = rank(t, "match");
    if (!hits.length || (r[0] && r[0].score > hits[0].score)) hits = r;
  }
  if (!hits.length || hits[0].score < min) return null;
  return { exercise: hits[0].exercise, score: hits[0].score, alternatives: hits.slice(1, 4).filter((h) => h.score >= min * 0.8).map((h) => h.exercise) };
}

/** The library exercise a name means ("e.g." and typos forgiven), or null. */
export const findExercise = (text: string) => matchExercise(text.replace(/^\s*e\.?\s?g\.?\s*:?\s*/i, ""))?.exercise ?? null;
