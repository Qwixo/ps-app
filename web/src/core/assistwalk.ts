// The Settings assistant's guided walk (PS 1.65). A walk moves Settings step by step: a soft spotlight lands on the tab, then the
// section, then (under a group's More, if it is there) the More button, then the exact control. About a second per step.
// "Do it" walks and changes the setting when the spotlight reaches the control (the real control animates by itself because its
// value changes under it). "Show me how" walks and changes nothing: the spotlight waits on the control until the person clicks it.
// Esc ends a walk at any step. Reduced motion: no walking, one plain jump to the control with a highlight.
// Pure (no React, no DOM, no clock): views/AssistWalk.tsx draws the spotlight and runs the timer, tests/assistwalk.test.ts checks every
// rule and the path for every setting in core/settingsindex.ts.
import { groupById, landingOf, settingById, type Ctx, type GroupId } from "./settingsindex.ts";
import { pathOf } from "./assist.ts";

export const STEP_MS = 1000;
export type StepKind = "tab" | "section" | "more" | "control";
export interface WalkStep {
  kind: StepKind;
  group: GroupId;
  /** The row this step ends on (the one the group page draws), for the control step. */
  settingId?: string;
  /** The words on the island or the card while the spotlight is here. */
  say: string;
  /** Where the spotlight lands (a CSS selector inside Settings). */
  selector: string;
}
export interface Walk { settingId: string; path: string; steps: WalkStep[] }

const q = (s: string) => s.replace(/["\\]/g, "\\$&");
/** The steps to one setting, on a wide window (a side menu) or a narrow one (the phone's list of sections, where there is no section
 *  heading: the section step is left out). */
export function buildWalk(id: string, ctx: Ctx, narrow = false): Walk | null {
  const e = settingById(id);
  if (!e) return null;
  const land = landingOf(e), g = groupById(land.group);
  const steps: WalkStep[] = [
    { kind: "tab", group: g.id, say: `Settings, ${g.label}`, selector: narrow ? `.gs-home-i[data-group="${q(g.id)}"]` : `.gs-nav-i[data-group="${q(g.id)}"]` },
  ];
  if (!narrow) steps.push({ kind: "section", group: g.id, say: `Settings, ${g.label}`, selector: ".gs-grp-h" });
  if (land.more) steps.push({ kind: "more", group: g.id, say: `Settings, ${g.label}, More`, selector: ".gs-more-b" });
  steps.push({ kind: "control", group: g.id, settingId: land.id, say: pathOf(id), selector: `[data-set="${q(land.id)}"]` });
  void ctx;
  return { settingId: id, path: pathOf(id), steps };
}

export type Mode = "do" | "show";
export type Phase = "running" | "waiting" | "applied" | "done";
export interface WalkState { walk: Walk; mode: Mode; i: number; phase: Phase; reduce: boolean }
export type Effect = "apply" | "wait" | "end" | "clicked";
export type Ev = "tick" | "click" | "esc";

/** Start a walk. Reduced motion lands on the control at once. */
export function startWalk(walk: Walk, mode: Mode, reduce: boolean): { state: WalkState; effects: Effect[] } {
  const last = walk.steps.length - 1;
  const state: WalkState = { walk, mode, i: reduce ? last : 0, phase: "running", reduce };
  return reduce ? arrive(state) : { state, effects: [] };
}
function arrive(s: WalkState): { state: WalkState; effects: Effect[] } {
  if (s.i < s.walk.steps.length - 1) return { state: s, effects: [] };
  return s.mode === "do" ? { state: { ...s, phase: "applied" }, effects: ["apply"] } : { state: { ...s, phase: "waiting" }, effects: ["wait"] };
}
/** One event. tick: a second passed. click: the person clicked the control (Show me how). esc: end it. */
export function walkStep(s: WalkState, ev: Ev): { state: WalkState; effects: Effect[] } {
  if (s.phase === "done") return { state: s, effects: [] };
  if (ev === "esc") return { state: { ...s, phase: "done" }, effects: ["end"] };
  if (ev === "click") return s.phase === "waiting" ? { state: { ...s, phase: "done" }, effects: ["clicked", "end"] } : { state: s, effects: [] };
  // tick
  if (s.phase === "running") return arrive({ ...s, i: s.i + 1 });
  if (s.phase === "applied") return { state: { ...s, phase: "done" }, effects: ["end"] };
  return { state: s, effects: [] };   // waiting: only a click or Esc moves on
}
/** What the island says now. */
export const walkSay = (s: WalkState): string => s.walk.steps[Math.min(s.i, s.walk.steps.length - 1)].say;
/** The "Next time" line the card ends with (the path, as a link that opens that place). */
export const nextTimeLine = (path: string): string => `Next time: ${path}`;
