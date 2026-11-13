// Shared shapes for the Fitness tab (the developer, 31 Oct 2026): the exercise library, a trainer's plan
// imported from his sheet, and a logged week exported back into the same layout. Weights are kg.

export type Muscle =
  | "chest" | "lats" | "upper_back" | "traps" | "front_delts" | "side_delts" | "rear_delts"
  | "biceps" | "triceps" | "forearms" | "quads" | "hamstrings" | "glutes" | "calves"
  | "adductors" | "abductors" | "abs" | "obliques" | "lower_back";

export type Equipment =
  | "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "kettlebell" | "smith"
  | "ezbar" | "trapbar" | "plate" | "other";

/** Compound = several joints move (squat, row, press); isolation = one joint (curl, raise). */
export type Kind = "compound" | "isolation";

export interface Exercise {
  id: string;
  name: string;
  aliases: string[];
  equipment: Equipment;
  /** Main muscles worked, most important first. */
  muscles: Muscle[];
  kind: Kind;
  /** Default rest between sets, in seconds. */
  restSec: number;
  /** The weight logged is per hand or per side (dumbbells), not the total. */
  perSide: boolean;
  /** Body weight is the load; logged kg is extra weight (negative = machine assistance). */
  bodyweight: boolean;
  /** Logged in seconds (planks, carries), not reps. */
  timed: boolean;
  /** The usual weight jump in kg (barbell 2.5, dumbbell 2, machine stack 5). */
  step: number;
  /** One short plain line on how to do it well. */
  cue?: string;
}

/** What one planned set asks for. Every field is optional because trainers leave things out. */
export interface PlannedSet {
  reps?: number;
  /** Top of a rep range ("8-10" is reps 8, repsMax 10). */
  repsMax?: number;
  seconds?: number;
  /** As many reps as possible. */
  amrap?: boolean;
  kg?: number;
  kgMax?: number;
  rirMin?: number;
  rirMax?: number;
}

export interface WeightSpec {
  kg?: number;
  kgMax?: number;
  /** One weight per set ("20, 22.5, 25kg"). */
  perSet?: number[];
  /** true / false when the sheet says so, null when it does not (use the exercise default). */
  perSide: boolean | null;
  bodyweight: boolean;
  /** The sheet said lb; the numbers here are already converted to kg. */
  fromLb?: boolean;
  /** Anything that is not a number ("light", "level 8"). */
  note?: string;
  raw: string;
}

export interface RirSpec {
  min: number;
  max: number;
  perSet?: number[];
  /** The sheet gave RPE; RIR = 10 - RPE. */
  fromRpe?: boolean;
  raw: string;
}

export interface SetsReps {
  sets: PlannedSet[];
  /** Reps are per side ("3x10 each leg"). */
  eachSide: boolean;
  /** False when the cell could not be read; sets is then empty. */
  ok: boolean;
  note?: string;
  raw: string;
}

export interface PlannedExercise {
  /** The name as the trainer wrote it, cleaned of "e.g." and superset labels. */
  name: string;
  /** Library match, or null when nothing came close enough. */
  exerciseId: string | null;
  /** 0 to 1, how close the library match is. */
  match: number;
  /** Next best library ids, for a "did you mean" picker. */
  alternatives: string[];
  /** Superset label ("A" for "A1. Bench press"). */
  superset?: string;
  sets: PlannedSet[];
  eachSide: boolean;
  weight: WeightSpec;
  rir: RirSpec | null;
  restSec: number;
  /** Per side weight after the sheet and the library default are combined. */
  perSide: boolean;
  note?: string;
  warnings: string[];
  /** Sheet row (0 based) the exercise came from. */
  row: number;
  raw: { exercise: string; setsReps: string; weight: string; rir: string };
}

export interface ProgramDay {
  /** 1 for DAY 1. */
  index: number;
  /** Text after "DAY 1" in the sheet ("Push"), or "Day 1". */
  title: string;
  exercises: PlannedExercise[];
}

export interface Program {
  days: ProgramDay[];
  warnings: string[];
}

export interface LoggedSet {
  kg?: number | null;
  reps?: number | null;
  seconds?: number | null;
  /** 4 means "4 or more". */
  rir?: number | null;
  warmup?: boolean;
  /** A drop set (V1.29): lighter, straight after the set before it. */
  drop?: boolean;
}

export interface LoggedExercise {
  name: string;
  exerciseId?: string | null;
  /** Overrides the library default. */
  perSide?: boolean;
  bodyweight?: boolean;
  eachSide?: boolean;
  sets: LoggedSet[];
  note?: string;
}

export interface LoggedDay {
  /** 1 for DAY 1; defaults to the day's place in the list. */
  index?: number;
  /** Heading as written ("DAY 1"); defaults to "DAY <index>". */
  name?: string;
  title?: string;
  /** YYYY-MM-DD the day was trained. */
  date?: string;
  exercises: LoggedExercise[];
}

export interface LoggedWeek {
  days: LoggedDay[];
}
