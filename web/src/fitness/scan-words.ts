// PS Fitness, Gym scan (V1.59): the words on gym machine labels, German first (the developer trains in Germany), and a few in
// French, Spanish, Italian and Dutch. A word list beats a full translator here: the labels use a small set of words,
// the list is a few kilobytes, it works with no signal, and it is tuned to what the exercise matcher needs.
// Pure data, no React. Keys are lower case with umlauts folded (ä a, ö o, ü u, ß ss): see scan-logic.ts fold().

/** Whole German words (and short phrases) that mean one exercise or one gym thing. */
export const DE_WORDS: Record<string, string> = {
  // machines and exercises
  beinpresse: "leg press", beinpressen: "leg press", "45 grad beinpresse": "45 degree leg press",
  brustpresse: "chest press", brustdrucken: "chest press", schulterpresse: "shoulder press", schulterdrucken: "shoulder press",
  nackendrucken: "shoulder press", bankdrucken: "bench press", schragbankdrucken: "incline bench press",
  latzug: "lat pulldown", latziehen: "lat pulldown", latissimuszug: "lat pulldown", lat: "lat",
  klimmzug: "pull up", klimmzuge: "pull up", klimmzugmaschine: "assisted pull up", klimmzughilfe: "assisted pull up",
  dipmaschine: "machine dip", dips: "dip", barren: "dip",
  rudern: "seated row", rudermaschine: "machine row", ruderzug: "seated cable row", kabelrudern: "seated cable row",
  langhantelrudern: "barbell row", kurzhantelrudern: "dumbbell row", vorgebeugtes: "bent over",
  butterfly: "pec deck", fliegende: "fly", fliegenden: "fly", "butterfly reverse": "reverse pec deck", reversebutterfly: "reverse pec deck",
  abduktor: "abductor", abduktoren: "abductor", abduktion: "abductor", abduktorenmaschine: "abductor machine",
  adduktor: "adductor", adduktoren: "adductor", adduktion: "adductor", adduktorenmaschine: "adductor machine",
  beinstrecker: "leg extension", beinstreckung: "leg extension", beinbeuger: "leg curl", beinbeugen: "leg curl",
  "beinbeuger liegend": "lying leg curl", "beinbeuger sitzend": "seated leg curl",
  bauchmaschine: "ab crunch machine", bauchtrainer: "ab crunch machine", bauchpresse: "ab crunch machine", bauchcrunch: "crunch",
  bauchmuskeltrainer: "ab crunch machine", crunchmaschine: "ab crunch machine",
  ruckenstrecker: "back extension", ruckenstreckung: "back extension", ruckenmaschine: "back extension", hyperextension: "back extension",
  kniebeuge: "squat", kniebeugen: "squat", hackenschmidt: "hack squat", hackenschmidtmaschine: "hack squat",
  kreuzheben: "deadlift", rumanisches: "romanian", ausfallschritt: "lunge", ausfallschritte: "lunge",
  liegestutz: "push up", liegestutze: "push up", hufthub: "hip thrust", huftstoss: "hip thrust", huftstrecker: "hip thrust",
  gesassmaschine: "glute machine", glutealmaschine: "glute machine", gesassstrecker: "glute kickback",
  wadenheben: "calf raise", wadenmaschine: "calf raise machine", wadentrainer: "calf raise machine",
  seitheben: "lateral raise", seitenheben: "lateral raise", seitheber: "lateral raise", frontheben: "front raise",
  bizepscurl: "biceps curl", bizepsmaschine: "biceps curl machine", armbeuger: "biceps curl", armcurl: "biceps curl",
  trizepsdrucken: "triceps pushdown", trizepsstrecker: "triceps extension", trizepsmaschine: "triceps extension machine",
  armstrecker: "triceps extension", trizepsdips: "triceps dip", schulterheben: "shrug", nackenheben: "shrug",
  multipresse: "smith machine", smithmaschine: "smith machine", kabelzug: "cable", seilzug: "cable", kabelturm: "cable",
  kabelstation: "cable", kabelzugturm: "cable", kabelkreuz: "cable crossover", kabelcrossover: "cable crossover",
  rotation: "twist", oberkorperrotation: "twist", rumpfrotation: "twist", rumpfbeuge: "crunch",
  // body parts
  bein: "leg", beine: "leg", brust: "chest", schulter: "shoulder", schultern: "shoulder", rucken: "back",
  bauch: "ab", bauchmuskel: "ab", bauchmuskeln: "ab", wade: "calf", waden: "calf", oberschenkel: "thigh",
  oberschenkelruckseite: "hamstring", gesass: "glute", po: "glute", huft: "hip", hufte: "hip", huften: "hip",
  arm: "arm", arme: "arm", bizeps: "biceps", trizeps: "triceps", nacken: "neck", rumpf: "core", unterer: "lower", oberer: "upper",
  // how and with what
  maschine: "machine", gerat: "machine", gerate: "machine", station: "station", kabel: "cable", seil: "rope",
  kurzhantel: "dumbbell", kurzhanteln: "dumbbell", langhantel: "barbell", sz: "ez bar", szstange: "ez bar", stange: "bar",
  bank: "bench", schragbank: "incline bench", flachbank: "flat bench", negativbank: "decline bench", scottbank: "preacher",
  sitzend: "seated", sitzende: "seated", liegend: "lying", liegende: "lying", stehend: "standing", stehende: "standing",
  kniend: "kneeling", einarmig: "single arm", einbeinig: "single leg", beidarmig: "two arm", beidbeinig: "two leg",
  eng: "close grip", enger: "close grip", breit: "wide grip", breiter: "wide grip", griff: "grip", untergriff: "underhand",
  obergriff: "overhand", hammergriff: "hammer", neutralgriff: "neutral grip", schrag: "incline", negativ: "decline",
  vorne: "front", hinten: "rear", seitlich: "lateral", uber: "over", kopf: "head", uberkopf: "overhead", umgekehrt: "reverse",
  reverse: "reverse", gegen: "", presse: "press", drucken: "press", ziehen: "pull", zug: "pull", heben: "raise",
  strecker: "extension", streckung: "extension", beuger: "curl", beugen: "curl",
  // words on labels that are not the exercise
  ubung: "", ubungen: "", gewicht: "", gewichte: "", sitz: "", sitzhohe: "", hohe: "", einstellen: "", einstellung: "",
  ruckenlehne: "", polster: "", ausgangsposition: "", position: "", start: "", achtung: "", warnung: "", vorsicht: "",
  bitte: "", nicht: "", und: "", oder: "", mit: "", fur: "", der: "", die: "", das: "", den: "", dem: "", des: "", zum: "", zur: "",
  ein: "", eine: "", auf: "", aus: "", von: "", im: "", in: "", am: "", an: "", ab: "", nr: "", muskel: "", muskeln: "",
  trainierte: "", trainiert: "", hauptmuskulatur: "", muskulatur: "", anleitung: "", hinweis: "", sicherheit: "",
  langsam: "", kontrolliert: "", ausatmen: "", einatmen: "", wiederholungen: "", satze: "", satz: "",
};

/** German word parts for long compounds the list above does not hold ("Kurzhantelschragbankdrucken"). */
export const DE_PARTS: Record<string, string> = {
  bein: "leg", brust: "chest", schulter: "shoulder", rucken: "back", bauch: "ab", waden: "calf", wade: "calf",
  gesass: "glute", huft: "hip", arm: "arm", bizeps: "biceps", trizeps: "triceps", nacken: "neck", ober: "upper", unter: "lower",
  kabel: "cable", seil: "rope", kurzhantel: "dumbbell", langhantel: "barbell", hantel: "dumbbell", maschine: "machine",
  presse: "press", pressen: "press", press: "press", drucken: "press", druck: "press", zug: "pulldown", ziehen: "pull", rudern: "row", heben: "raise",
  strecker: "extension", streckung: "extension", beuger: "curl", beugen: "curl", curl: "curl", curls: "curl",
  schrag: "incline", negativ: "decline", flach: "flat", bank: "bench", sitz: "seated", seit: "lateral", seiten: "lateral",
  front: "front", fliegende: "fly", fliegenden: "fly", crunch: "crunch", trainer: "machine", gerat: "machine",
  abduktoren: "abductor", abduktor: "abductor", adduktoren: "adductor", adduktor: "adductor", lat: "lat",
};

/** A few words in French, Spanish, Italian and Dutch, for a gym abroad. */
export const OTHER_WORDS: Record<string, string> = {
  // French
  presse: "press", cuisses: "leg", jambes: "leg", jambe: "leg", pectoraux: "chest", poitrine: "chest", epaules: "shoulder",
  developpe: "press", tirage: "pulldown", vertical: "", horizontal: "row", rameur: "row", abdominaux: "ab", abdos: "ab",
  mollets: "calf", fessiers: "glute", ischio: "hamstring", "ischio jambiers": "hamstring", assis: "seated", couche: "lying",
  // Spanish
  prensa: "press", piernas: "leg", pierna: "leg", pecho: "chest", hombros: "shoulder", hombro: "shoulder", remo: "row",
  jalon: "pulldown", polea: "cable", abdominales: "ab", gemelos: "calf", gluteos: "glute", femoral: "hamstring", sentado: "seated", tumbado: "lying",
  maquina: "machine", extension: "extension", curl: "curl",
  // Italian
  pressa: "press", gambe: "leg", petto: "chest", spalle: "shoulder", rematore: "row", lat: "lat", addominali: "ab", polpacci: "calf",
  macchina: "machine", seduto: "seated",
  // Dutch
  beenpers: "leg press", borstpers: "chest press", schouderpers: "shoulder press", roeien: "row", buikspieren: "ab",
  kuiten: "calf", benen: "leg", been: "leg", borst: "chest", zittend: "seated", liggend: "lying",
};

/** English phrases put right after the word list (word order on German labels, gym slang). */
export const EN_PHRASES: [RegExp, string][] = [
  [/\bpec deck reverse\b|\breverse pec deck\b|\bbutterfly reverse\b|\breverse butterfly\b/g, "reverse pec deck"],
  [/\bab crunch\b/g, "ab crunch"],
  [/\bpectorals?\b(?! press)/g, "pec fly"],   // Technogym style "PECTORAL" (a pec fly machine)
  [/\bleg curl lying\b/g, "lying leg curl"],
  [/\bleg curl seated\b/g, "seated leg curl"],
  [/\brow seated\b/g, "seated row"],
  [/\bcalf raise seated\b/g, "seated calf raise"],
  [/\bcalf raise standing\b/g, "standing calf raise"],
];

/** Machine makers printed on the labels: shown as the maker, never matched as an exercise word. */
export const BRANDS: Record<string, string> = {
  gym80: "Gym80", "gym 80": "Gym80", technogym: "Technogym", "life fitness": "Life Fitness", lifefitness: "Life Fitness",
  "hammer strength": "Hammer Strength", matrix: "Matrix", cybex: "Cybex", precor: "Precor", nautilus: "Nautilus",
  "star trac": "Star Trac", startrac: "Star Trac", panatta: "Panatta", egym: "eGym", milon: "milon", "bh fitness": "BH Fitness",
  hoist: "Hoist", freemotion: "Freemotion", ergofit: "ergo-fit", "ergo fit": "ergo-fit", schnell: "Schnell", compass: "Compass",
  "pure strength": "Pure Strength", "sygnum": "Gym80 Sygnum", "insignia": "Life Fitness Insignia", "signature series": "Life Fitness Signature",
  "selection": "Technogym Selection", "kraftwerk": "Kraftwerk", "atlantis": "Atlantis", "impulse": "Impulse", "nordic": "",
  mywellness: "", "my wellness": "", lk: "L+K", "l k": "L+K", "l+k": "L+K", "dhz": "DHZ", "johnson": "Johnson", "keiser": "Keiser", "flexx": "Flexx", "rogers": "Rogers", "prime": "Prime",
};

/** Words on labels in any language that never name an exercise. */
export const NOISE = new Set([
  "kg", "lb", "lbs", "max", "min", "warning", "caution", "instructions", "instruction", "muscles", "muscle", "worked", "primary",
  "secondary", "seat", "adjust", "adjustment", "height", "weight", "start", "position", "the", "and", "with", "your", "for",
  "www", "com", "de", "made", "germany", "italy", "usa", "model", "art", "serial", "no", "nr", "tm", "r", "pin", "set", "sets", "reps",
  "slowly", "controlled", "exhale", "inhale", "do", "not", "use", "this", "equipment", "only",
]);
