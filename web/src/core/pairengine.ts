// The Mac's half of "sign in by scanning the Mac" as a plain engine (V1.57, phone-link-fast). The developer, 13 Nov 2026: linking
// his GrapheneOS phone from Edit mode took about 5 minutes: "Make it faster to link. Maybe make it so you scan a QR
// containing all the session info on your GOS/phone to make it much quicker to link live?"
//
// Why it was slow (the note ps-handover-notes/phone-link-fast.md has the evidence): the Link your phone card lives in the
// Tab list window, which holds no keys. Its pairing (views/LinkPair.tsx usePhonePairing, V1.55) asked core/vault.ts
// canLinkPhone() there, got false, and quietly fell back to a code that only links the project. So the one scan sign in
// never ran from Edit mode: the phone had to be signed in some other way and the Mac only noticed at its next paced pull.
//
// Now the engine is the same V1.55 protocol (core/phonepair.ts, migration 029, nothing new on the server) without React,
// so the MAIN window (which has the keys) can run it for the Tab list and mirror only the public part (core/pairmac.ts):
// the phase, the six digit code and the QR's offer part (offer id, the Mac's public key, the commitment). The nonce and
// the private key never leave the main window. Pure: the database, the sealing and the clock are handed in
// (tests/pairengine.test.ts drives it with a fake relay).
import { ALLOW_MS, OFFER_MS, POLL_MS, linkCode, newOffer, offerPart, readOffer, type MacSide } from "./phonepair.ts";

/** The calm note on every linking screen (the developer, 13 Nov 2026: "add a slight warning say phone pairing may take up to a
 *  few minutes"). Edit mode's Link your phone card and Settings, Link your iPhone. */
export const LINK_WAIT_NOTE = "Phone pairing may take up to a few minutes.";

export type PairPhase =
  | { k: "off" }                                   // no pairing here (no keys in memory, or the project is older)
  | { k: "ready" }                                 // the QR carries an offer, nobody has scanned it yet
  | { k: "confirm"; code: string; phone: string }  // a phone scanned it: compare the codes
  | { k: "sending" } | { k: "sent" } | { k: "done" } | { k: "error"; text: string };

export interface PairView { phase: PairPhase; part: string }
export const PAIR_OFF: PairView = { phase: { k: "off" }, part: "" };

/** What the engine needs from the outside world. The Mac's PS gives it the project's relay and the vault's sealing. */
export interface PairDeps {
  /** This window holds the keys to sign a phone in right now. */
  can(): boolean;
  /** Make the offer row (false: the project has no relay yet, migration 029). */
  insert(id: string): Promise<boolean>;
  drop(id: string): Promise<void>;
  /** The phone's public key once a phone claimed the offer, else null. */
  claimed(id: string): Promise<string | null>;
  /** Reveal the nonce the QR committed to (only after the phone's key is fixed). */
  reveal(id: string, nonce: string): Promise<boolean>;
  /** Whether the offer row is still there (the phone deletes it when it takes the sign in). */
  exists(id: string): Promise<boolean>;
  /** Seal this Mac's sign in for that phone. */
  seal(m: MacSide, phonePub: string): Promise<string>;
  store(id: string, sealed: string): Promise<boolean>;
  now(): number;
  every(ms: number, f: () => void): () => void;
  /** A soft click when a phone scans (optional). */
  click?(): void;
}

export class PairEngine {
  private view: PairView = PAIR_OFF;
  private cur: MacSide | null = null;
  private gen = 0;
  private made = 0;
  private claimedAt = 0;
  private busy = false;
  private stopTick: (() => void) | null = null;
  private subs = new Set<() => void>();

  private d: PairDeps;
  constructor(d: PairDeps) { this.d = d; }

  get(): PairView { return this.view; }
  subscribe(f: () => void): () => void { this.subs.add(f); return () => { this.subs.delete(f); }; }
  running(): boolean { return this.stopTick !== null; }

  private set(phase: PairPhase, part = this.view.part) {
    this.view = { phase, part };
    this.subs.forEach((f) => f());
  }

  /** Start showing offers (idempotent). */
  start() {
    if (this.stopTick) return;
    this.made = this.d.now();
    void this.fresh();
    this.stopTick = this.d.every(POLL_MS, () => void this.tick());
  }

  /** Stop: the open offer is deleted, nothing waits on the relay any more. */
  stop() {
    if (!this.stopTick) return;
    this.stopTick(); this.stopTick = null;
    this.gen++;
    const m = this.cur; this.cur = null;
    if (m) void this.d.drop(m.offer.id).catch(() => {});
    this.set({ k: "off" }, "");
  }

  /** A new offer (a new QR). The old one is deleted. */
  async fresh() {
    const g = ++this.gen;
    const old = this.cur; this.cur = null;
    this.view = { ...this.view, part: "" };
    if (old) void this.d.drop(old.offer.id).catch(() => {});
    if (!this.d.can()) { this.set({ k: "off" }, ""); return; }
    try {
      const m = await newOffer();
      const ok = await this.d.insert(m.offer.id);
      if (g !== this.gen) { void this.d.drop(m.offer.id).catch(() => {}); return; }
      if (!ok) { this.set({ k: "off" }, ""); return; }   // migration 029 not on this project yet: the code links the project only
      this.cur = m; this.made = this.d.now();
      this.set({ k: "ready" }, offerPart(m.offer));
    } catch { if (g === this.gen) this.set({ k: "off" }, ""); }
  }

  /** One look at the relay (every POLL_MS while running). */
  async tick() {
    const m = this.cur, p = this.view.phase;
    if (this.busy || !m) return;
    this.busy = true;
    try {
      if (p.k === "ready") {
        if (this.d.now() - this.made > OFFER_MS - 5_000) { await this.fresh(); return; }   // a new code every minute
        const phone = await this.d.claimed(m.offer.id);
        if (!phone || this.cur !== m) return;
        // The phone's key is fixed now: only now reveal the nonce the QR committed to (core/phonepair.ts step 3).
        if (!(await this.d.reveal(m.offer.id, m.nonce))) { await this.fresh(); return; }
        if (this.cur !== m) return;
        this.claimedAt = this.d.now();
        this.d.click?.();
        this.set({ k: "confirm", code: await linkCode(m.offer, phone, m.nonce), phone });
      } else if (p.k === "confirm" && this.d.now() - this.claimedAt > ALLOW_MS) {
        await this.fresh();
      } else if (p.k === "sent") {
        if (!(await this.d.exists(m.offer.id))) { this.cur = null; this.set({ k: "done" }, ""); }   // the phone took it: signed in there
        else if (this.d.now() - this.claimedAt > ALLOW_MS) await this.fresh();
      }
    } catch { /* a dropped request: look again next tick */ } finally { this.busy = false; }
  }

  /** Allow on the Mac: seal the sign in to the phone that claimed the offer. Only in the confirm phase. */
  async allow() {
    const m = this.cur, p = this.view.phase;
    if (!m || p.k !== "confirm") return;
    this.set({ k: "sending" });
    try {
      const sealed = await this.d.seal(m, p.phone);
      if (this.cur !== m) return;
      if (!(await this.d.store(m.offer.id, sealed))) throw new Error("PS could not reach your project. Try again.");
      this.set({ k: "sent" });
    } catch (e) { if (this.cur === m) this.set({ k: "error", text: (e as Error).message || "That did not work. Try again." }); }
  }
  /** Not my phone: throw this offer away and show a new code. */
  deny() { this.d.click?.(); void this.fresh(); }
  again() { void this.fresh(); }
}

// ---------- the Tab list's side: what crosses between the two windows ----------

const PART_RE = /^&o=[A-Za-z0-9_-]{22}&m=[A-Za-z0-9_-]{87}&c=[A-Za-z0-9_-]{22}$/;
const CODE_RE = /^\d{3} \d{3}$/;
const PUB_RE = /^[A-Za-z0-9_-]{87}$/;

/** The view the main window sends to the Tab list, checked again there: only these phases, a six digit code, and an
 *  offer part that reads back as an offer. Anything else is "off" (the QR then links the project only). */
export function cleanPairView(x: unknown): PairView {
  if (!x || typeof x !== "object") return PAIR_OFF;
  const o = x as { phase?: { k?: unknown; code?: unknown; phone?: unknown; text?: unknown }; part?: unknown };
  const k = o.phase?.k;
  const part = typeof o.part === "string" && PART_RE.test(o.part) && readOffer(new URLSearchParams(o.part.slice(1))) ? o.part : "";
  switch (k) {
    case "ready": return part ? { phase: { k }, part } : PAIR_OFF;
    case "confirm": {
      const code = String(o.phase?.code ?? ""), phone = String(o.phase?.phone ?? "");
      return CODE_RE.test(code) && PUB_RE.test(phone) ? { phase: { k, code, phone }, part } : PAIR_OFF;
    }
    case "sending": case "sent": case "done": return { phase: { k }, part };
    case "error": return { phase: { k, text: String(o.phase?.text ?? "That did not work. Try again.").slice(0, 160) }, part };
    default: return PAIR_OFF;
  }
}

export type PairOp = { op: "start" | "ping" | "stop" | "allow" | "deny" | "again"; who: string };
/** A request from the Tab list (the patch's pairOp), or null. */
export function cleanPairOp(x: unknown): PairOp | null {
  if (!x || typeof x !== "object") return null;
  const o = x as { op?: unknown; who?: unknown };
  const ops = ["start", "ping", "stop", "allow", "deny", "again"] as const;
  const op = ops.find((v) => v === o.op);
  const who = typeof o.who === "string" && /^[a-z0-9]{6,24}$/.test(o.who) ? o.who : "";
  return op && who ? { op, who } : null;
}

/** How long the main window keeps pairing for a Tab list that stopped saying it is still there (a reload, a crash):
 *  the Tab list pings every PAIR_PING_MS while its card is open. */
export const PAIR_PING_MS = 10_000;
export const PAIR_LEASE_MS = 35_000;

/** Who still wants the pairing to run: each card or Settings row that is open, by its random id, with its last ping. */
export class PairLeases {
  private at = new Map<string, number>();
  private now: () => number;
  constructor(now: () => number) { this.now = now; }
  /** Apply one op. Returns whether pairing should run now. */
  apply(o: PairOp): boolean {
    if (o.op === "stop") this.at.delete(o.who);
    else if (o.op === "start" || o.op === "ping") this.at.set(o.who, this.now());
    return this.live();
  }
  /** Drops the ones that stopped pinging. */
  live(): boolean {
    const t = this.now();
    for (const [w, a] of this.at) if (t - a > PAIR_LEASE_MS) this.at.delete(w);
    return this.at.size > 0;
  }
}
