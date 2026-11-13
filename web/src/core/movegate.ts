// Turn on sync, the part that decides (V1.44 local first): what happens between "an account is about to open" and
// "the local vault's records are verified inside it". src/localfirst.ts wires it to the screens and the vault engine
// (core/vault.ts finishUnlock calls it before the account opens); this file has no screen and no browser in it, so
// tests/localfirst-gate.test.ts can walk every path: success, a failure then Try again, a failure then Back, a key
// that needs Allow, a key that is lost, and an account that already holds records.
//
// What it promises (the developer, 8 Nov 2026: "make sure they don't lose their data is the important part"):
// - The local copy is never changed here except its head's state and journal. No record is ever deleted.
// - The head says "moved" only after runMove (core/move.ts) verified every record. Any failure leaves "moving" (so a
//   crash or quit carries on next time), and Back puts it to "local" again: the person is exactly where they were.
// - An account that already holds records gets a question first; nothing is sent until the person says Move.
import type { MoveJournal, LocalHead, OpenResult, Row } from "./localstore.ts";
import { MoveError, newJournal, runMove, type MoveProgress, type MoveTarget, type Payload } from "./move.ts";

export type GateChoice = "start" | "retry" | "rest" | "allow" | "back";
export type GateView =
  | { phase: "confirm"; count: number; existing: number }
  | { phase: "running"; progress: MoveProgress | null; count: number }
  | { phase: "failed"; code: string; message: string; failed: number; unreadable: boolean }
  | { phase: "key"; denied: boolean };

export interface GateDeps {
  /** Opens the local vault with the device's key holders (core/localstore.ts openLocalVault). */
  open(): Promise<OpenResult>;
  /** Every record of the local vault, unsaved changes included (core/localstore.ts loadLocalRows). */
  rows(h: LocalHead): Promise<Row[]>;
  /** Reads, changes and writes the head (core/localstore.ts updateHead). */
  update(fn: (h: LocalHead) => LocalHead): Promise<LocalHead>;
  /** Shows a screen and waits for the person's button. */
  ask(v: GateView): Promise<GateChoice>;
  /** Shows a screen that needs no answer (the progress). */
  show(v: GateView): void;
  /** Mac: lets this build read the Keychain item (the person's Allow). */
  allow(): Promise<void>;
  decrypt(vk: CryptoKey, r: Row): Promise<Payload>;
  /** The linked project (ref or url): a move never continues into another one. */
  project: string;
  now?: () => string;
  batch?: number;
}
export type GateResult =
  | { kind: "none" }                                 // nothing waits to move: open the account as usual
  | { kind: "moved"; rows: Row[]; count: number }    // verified: the account opens with these rows, nothing downloaded twice
  | { kind: "back" };                                // the person went back to the data on this device

/** Moves the local vault into the account that is opening. Never throws for a failed move: the person chooses. */
export async function moveIntoAccount(d: GateDeps, a: { target: MoveTarget; userId: string; fresh: boolean }): Promise<GateResult> {
  const now = d.now ?? (() => new Date().toISOString());
  const back = async (): Promise<GateResult> => {
    // The local vault opens again as it was. What already arrived stays in the account; the next Turn on sync into the
    // same account carries on from the journal (same ids, so never twice).
    await d.update((x) => ({ ...x, state: x.state === "moving" ? "local" : x.state, syncIntent: null, snoozedFor: d.project })).catch(() => {});
    return { kind: "back" };
  };

  // 1. The local vault's key (no password: the device holds it).
  let local: { head: LocalHead; vk: CryptoKey } | null = null;
  while (!local) {
    const o = await d.open();
    if (o.status === "none") return { kind: "none" };
    if (o.status === "ok") { local = { head: o.head, vk: o.vk }; break; }
    const c = await d.ask({ phase: "key", denied: o.status === "denied" });
    if (c === "back") return back();
    if (c === "allow") await d.allow().catch(() => {});
  }
  const h = local.head, vk = local.vk;
  if (h.state === "moved") return { kind: "none" };
  const count = (await d.rows(h)).filter((r) => !r.deleted).length;

  // 2. Into an account that already holds records (not one just made, not this move's own): ask first.
  const same = h.move && h.move.target.userId === a.userId && h.move.target.project === d.project ? h.move : null;
  if (!same && !a.fresh) {
    let existing = 0;
    try { existing = (await a.target.stamps()).filter((s) => !s.deleted).length; } catch { existing = -1; }
    if (existing !== 0) {
      const c = await d.ask({ phase: "confirm", count, existing: Math.max(0, existing) });
      if (c !== "start") return back();
    }
  }
  let journal: MoveJournal = same ?? newJournal({ project: d.project, userId: a.userId }, now());
  await d.update((x) => ({ ...x, state: "moving", move: journal }));

  // 3. Move, verify, and only then switch over. Any failure: the person chooses (try again, or back to local).
  let allowUnreadable = false;
  for (;;) {
    d.show({ phase: "running", progress: null, count });
    try {
      const res = await runMove({
        source: { rows: await d.rows(h), decrypt: (r) => d.decrypt(vk, r) },
        target: a.target, journal, allowUnreadable, batch: d.batch, now,
        save: async (j) => { journal = j; await d.update((x) => ({ ...x, move: j })); },
        progress: (p) => d.show({ phase: "running", progress: p, count }),
      });
      if (!journal.verified || journal.verified.count !== res.count) throw new MoveError("verify", "The move could not prove every record arrived. Your data is safe on this device. Try again.");
      await d.update((x) => ({ ...x, state: "moved", movedAt: now(), syncIntent: null, snoozedFor: null, move: journal }));
      return { kind: "moved", rows: res.rows, count: res.count };
    } catch (e) {
      const m = e instanceof MoveError ? e : new MoveError("failed", String((e as Error)?.message || e));
      const c = await d.ask({ phase: "failed", code: m.code, message: m.message, failed: m.failed.length, unreadable: m.code === "unreadable" });
      if (c === "back") return back();
      if (c === "rest") allowUnreadable = true;
    }
  }
}
