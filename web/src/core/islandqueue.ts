// One shared queue for every card that comes out of the island (PS 1.60, the developer 14 Nov 2026: "never a notification on
// top of another ... one card at a time, queue the rest, never overlapping, one shared queue for all island cards").
// The same rules as the Mac's mac/Sources/IslandQueueCore.swift, with the same test cases (tests/islandqueue.test.ts and
// mac/tests/island-queue-test.swift). Pure: the clock is passed in, nothing here draws or sets a timer.
//
//  - One card is active (on screen); every other card waits, out of sight.
//  - A new card never interrupts the active one, whatever its priority: it goes next if it is more urgent.
//  - Waiting order: higher priority first, then the one that came first.
//  - The same id twice is the same card: it keeps its place and takes the higher priority, never a second copy.
//  - A waiting card with a time to live that waited longer is dropped, never shown stale.
//  - An active card whose view is gone without a word is let go after a short grace, so the queue never sticks.
//  - When the active card finishes, the next one comes after a short breath, never on the same frame.
// A new kind of card joins with one call: `queue.enqueue({ id, kind, priority }, now)`.

export type Priority = "low" | "normal" | "high";
const RANK: Record<Priority, number> = { low: 1, normal: 2, high: 3 };

export interface CardRef { id: string; kind: string; priority: Priority; seq: number; since: number; ttl: number | null }
export type Outcome = { r: "showNow" } | { r: "wait"; position: number } | { r: "updated" } | { r: "dropped" };

/** A pause between one card leaving and the next one coming out (ms). */
export const BREATH_MS = 250;
/** An active card not seen alive for this long is let go (ms). */
export const DEAD_GRACE_MS = 4000;
/** No more than this many cards wait. */
export const MAX_WAITING = 30;

export class IslandQueue {
  active: CardRef | null = null;
  waiting: CardRef[] = [];
  private seq = 0;
  private aliveAt = 0;
  private holdUntil = 0;

  enqueue(c: { id: string; kind: string; priority: Priority; ttl?: number | null }, now: number): Outcome {
    if (this.active?.id === c.id) {
      if (RANK[c.priority] > RANK[this.active.priority]) this.active.priority = c.priority;
      return { r: "updated" };
    }
    const w = this.waiting.find((x) => x.id === c.id);
    if (w) {
      if (RANK[c.priority] > RANK[w.priority]) { w.priority = c.priority; this.sort(); }
      return { r: "updated" };
    }
    const ref: CardRef = { id: c.id, kind: c.kind, priority: c.priority, seq: this.seq++, since: now, ttl: c.ttl ?? null };
    if (!this.active && now >= this.holdUntil && !this.waiting.length) { this.active = ref; this.aliveAt = now; return { r: "showNow" }; }
    if (this.waiting.length >= MAX_WAITING) return { r: "dropped" };
    this.waiting.push(ref);
    this.sort();
    return { r: "wait", position: this.waiting.findIndex((x) => x.id === c.id) + 1 };
  }

  private sort() {
    this.waiting.sort((a, b) => (a.priority !== b.priority ? RANK[b.priority] - RANK[a.priority] : a.seq - b.seq));
  }

  /** The card is finished, or cancelled while it waits. True when it was the active one. */
  finish(id: string, now: number): boolean {
    if (this.active?.id === id) { this.active = null; this.holdUntil = now + BREATH_MS; return true; }
    this.waiting = this.waiting.filter((x) => x.id !== id);
    return false;
  }

  /** Esc: the active card closes. Returns its id (the caller closes the view). */
  escape(now: number): string | null {
    const a = this.active;
    if (!a) return null;
    this.finish(a.id, now);
    return a.id;
  }

  /** Time moves on: drops waiting cards past their time to live, lets go of a dead active card, promotes the next one. */
  step(now: number, activeIsVisible: boolean): { promote: CardRef | null; dropped: CardRef[] } {
    const dropped: CardRef[] = [];
    this.waiting = this.waiting.filter((c) => { if (c.ttl !== null && now - c.since > c.ttl) { dropped.push(c); return false; } return true; });
    if (this.active) {
      if (activeIsVisible) this.aliveAt = now;
      else if (now - this.aliveAt > DEAD_GRACE_MS) { this.active = null; this.holdUntil = now + BREATH_MS; }
    }
    if (this.active || now < this.holdUntil || !this.waiting.length) return { promote: null, dropped };
    const next = this.waiting.shift()!;
    this.active = next; this.aliveAt = now;
    return { promote: next, dropped };
  }

  /** When to call step again at the latest (ms from now), or null when nothing is pending. */
  recheck(now: number): number | null {
    if (!this.waiting.length && !this.active) return null;
    let t = DEAD_GRACE_MS;
    if (!this.active) t = this.holdUntil > now ? Math.min(t, this.holdUntil - now + 10) : 10;
    for (const c of this.waiting) if (c.ttl !== null) t = Math.min(t, Math.max(10, c.ttl - (now - c.since) + 10));
    return t;
  }

  isActive(id: string) { return this.active?.id === id; }
  isWaiting(id: string) { return this.waiting.some((x) => x.id === id); }
  get count() { return (this.active ? 1 : 0) + this.waiting.length; }
}

/** The shared queue of this page, with a clock: `join` asks for the island, `leave` is always called when the card is gone.
 *  `onTurn` runs when a waiting card becomes active. */
export function islandQueueRuntime(clock: () => number = Date.now, later: (f: () => void, ms: number) => unknown = (f, ms) => setTimeout(f, ms)) {
  const q = new IslandQueue();
  const turns = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  let token = 0;
  const emit = () => listeners.forEach((f) => f());
  // Always the newest look-again time wins; an older timer that fires later does nothing.
  const arm = () => {
    const mine = ++token;
    const ms = q.recheck(clock());
    if (ms === null) return;
    later(() => { if (mine === token) tick(); }, ms);
  };
  const tick = () => {
    const r = q.step(clock(), true);
    for (const d of r.dropped) turns.delete(d.id);
    if (r.promote) { const f = turns.get(r.promote.id); f?.(); }
    if (r.promote || r.dropped.length) emit();
    arm();
  };
  return {
    queue: q,
    join(c: { id: string; kind: string; priority: Priority; ttl?: number | null }, onTurn: () => void): Outcome {
      const o = q.enqueue(c, clock());
      if (o.r === "wait" || o.r === "showNow") turns.set(c.id, onTurn);
      emit(); arm();
      return o;
    },
    leave(id: string) { turns.delete(id); q.finish(id, clock()); emit(); arm(); },
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
  };
}
