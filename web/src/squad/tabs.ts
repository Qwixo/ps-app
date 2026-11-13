// G Squad (V1.40): the pop-up's tabs, in one registry so the later V1.40 chats plug their tab in without touching
// the pop-up. Leaderboard, Screen time and Chat start as placeholders (views/GSquad.tsx); a chat that builds one
// calls registerSquadTab with the same id and its own Panel, which replaces the placeholder:
//
//   import { registerSquadTab } from "../squad/tabs";
//   registerSquadTab({ id: "leaderboard", title: "Leaderboard", order: 10, Panel: MyLeaderboard });
//
// A Panel gets the plain view (no keys), a way to send a squadOp, and your sharing switches. Anything it shares
// must go through core/squadshare.ts sealForSquad with its own piece, so its switch is enforced at the key.
import type { ComponentType } from "react";
import type { ShareOpts, SharePiece } from "../core/squadshare";
import type { SquadOp, SquadView } from "./view";

export interface SquadTabProps {
  view: SquadView;
  op: (o: SquadOp) => void;
  share: ShareOpts;
  setShare: (piece: SharePiece, on: boolean) => void;
}
export interface SquadTab {
  id: "leaderboard" | "tasks" | "screen" | "members" | "chat" | "fitness" | (string & {});
  title: string;
  order: number;
  Panel: ComponentType<SquadTabProps>;
  placeholder?: boolean;
  /** A small count on the tab (eg hand overs waiting), or nothing. */
  badge?: (v: SquadView) => number;
  /** A quiet dot on the tab instead of a count (V1.43: last month's amount not added yet). No sound, no pop-up. */
  dot?: (v: SquadView) => boolean;
}

const tabs = new Map<string, SquadTab>();
const subs = new Set<() => void>();
let list: SquadTab[] = [];

export function registerSquadTab(t: SquadTab) {
  if (t.placeholder && tabs.get(t.id) && !tabs.get(t.id)!.placeholder) return;   // a built tab is never put back to a placeholder
  tabs.set(t.id, t);
  list = [...tabs.values()].sort((a, b) => a.order - b.order);
  subs.forEach((l) => l());
}
export function squadTabs(): SquadTab[] { return list; }
export function onSquadTabs(l: () => void) { subs.add(l); return () => { subs.delete(l); }; }
/** The order the developer asked for. V1.43 (the messenger look): Chat first, then Tasks, Fitness, Leaderboard, Screen time, Members. */
export const TAB_ORDER = { chat: 10, tasks: 20, fitness: 30, leaderboard: 40, screen: 50, members: 60 } as const;

// Layers: things a G Squad part shows over the Tab list on its own, outside the pop-up (eg the monthly money
// question, squad/board.ts). They render wherever the G Squad button is (PS on a Mac, every account).
const layers = new Map<string, ComponentType>();
let layerList: ComponentType[] = [];
export function registerSquadLayer(id: string, L: ComponentType) {
  layers.set(id, L);
  layerList = [...layers.values()];
  subs.forEach((l) => l());
}
export function squadLayers(): ComponentType[] { return layerList; }
