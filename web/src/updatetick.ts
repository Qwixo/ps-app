// The click to look for updates on the version's tick (Mac gear menu and phone settings). The timing rules
// are in core/updatetick.ts; this keeps one click's state outside the card, so it lives on while the menu
// closes or the screen changes, and wakes the card only when the phase can change.
import { useEffect, useReducer, useSyncExternalStore } from "react";
import { tickKeeps, tickNext, tickPhase, tickRecord, type TickCheck, type TickPhase } from "./core/updatetick";

export type Tick<T> = { check: TickCheck | null; home: T | null };

export function tickStore<T extends { state: string }>() {
  let cur: Tick<T> = { check: null, home: null };
  const subs = new Set<() => void>();
  const set = (t: Tick<T>) => { cur = t; subs.forEach((f) => f()); };
  return {
    get: () => cur,
    sub: (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; },
    /** The developer clicked the tick: `home` is the up to date card to come back to. */
    start: (home: T) => set({ check: { at: Date.now() }, home }),
    /** Each state the shell reports. An update that starts ends the tick's part. */
    seen: (u: T) => {
      if (!cur.check) return;
      if (!tickKeeps(u.state)) { set({ check: null, home: null }); return; }
      const check = tickRecord(cur.check, u.state, Date.now());
      if (check !== cur.check) set({ ...cur, check });
    },
    reset: () => { if (cur.check) set({ check: null, home: null }); },
  };
}
export type TickStore<T extends { state: string }> = ReturnType<typeof tickStore<T>>;

export function useTick<T extends { state: string }>(s: TickStore<T>): Tick<T> & { phase: TickPhase } {
  const t = useSyncExternalStore(s.sub, s.get);
  const [, wake] = useReducer((x: number) => x + 1, 0);
  const now = Date.now();
  const next = tickNext(t.check, now);
  useEffect(() => {
    if (next === null) return;
    const id = setTimeout(wake, Math.max(0, next - Date.now()) + 15);
    return () => clearTimeout(id);
  }, [next, t]);
  return { ...t, phase: tickPhase(t.check, now) };
}
