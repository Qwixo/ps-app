// The pairing engine (core/pairengine.ts) wired to this project's relay and the vault (V1.57, phone-link-fast).
//
// PS on a Mac has two windows: the main window holds the keys, the Tab list (where Edit mode and its Link your phone
// card live) holds none. So:
//  - In the main window (and the website, and Settings when it is drawn there) the engine runs right here.
//  - In the Tab list, the card asks the main window to run it (a "looks" patch, pairOp, through the shell exactly as the
//    Tab list's other saves go) and reads back only the public view in the overlay state's `pair` (src/ps.ts).
// While a card is open the main window also syncs every few seconds, so a phone that was already signed in and only
// needs to open PS shows up on the Mac within seconds even if that phone is too old to poke (core/vault.ts pokes).
import { canLinkPhone, sb, sealLinkFor, sync } from "./vault";
import { PAIR_OFF, PairEngine, PairLeases, cleanPairView, type PairDeps, type PairOp, type PairView } from "./pairengine";

const offers = () => sb.from("ps_link_offers");

export function vaultPairDeps(click?: () => void): PairDeps {
  return {
    can: canLinkPhone,
    async insert(id) { const { error } = await offers().insert({ id }); return !error; },
    async drop(id) { await offers().delete().eq("id", id).then(() => {}, () => {}); },
    async claimed(id) {
      const { data } = await offers().select("phone_pub").eq("id", id).maybeSingle();
      const p = (data as { phone_pub?: string | null } | null)?.phone_pub;
      return typeof p === "string" && p ? p : null;
    },
    async reveal(id, nonce) { const { error } = await offers().update({ reveal: nonce }).eq("id", id); return !error; },
    async exists(id) { const { data, error } = await offers().select("id").eq("id", id).maybeSingle(); return !!data || !!error; },
    async seal(m, phone) { return (await sealLinkFor(m, phone)).sealed; },
    async store(id, sealed) { const { error } = await offers().update({ sealed }).eq("id", id); return !error; },
    now: () => Date.now(),
    every(ms, f) { const t = window.setInterval(f, ms); return () => window.clearInterval(t); },
    click,
  };
}

// ---------- main window: one engine for whoever asks from the Tab list ----------

/** How often the main window syncs while a Link card is open in the Tab list (a tiny probe when nothing changed). */
export const LINK_SYNC_MS = 3_000;

let main: PairEngine | null = null;
const leases = new PairLeases(() => Date.now());
let watch: number | null = null;
let lastSync = 0;

/** The main window's engine (made on first use). */
export function mainPair(): PairEngine {
  if (!main) main = new PairEngine(vaultPairDeps());
  return main;
}
/** A pairOp from the Tab list (already checked with cleanPairOp). */
export function runPairOp(o: PairOp) {
  const e = mainPair();
  const on = leases.apply(o);
  if (o.op === "allow") void e.allow();
  else if (o.op === "deny") e.deny();
  else if (o.op === "again") e.again();
  if (on) { e.start(); keepWatching(); } else stopMain();
}
function keepWatching() {
  if (watch !== null) return;
  watch = window.setInterval(() => {
    if (!leases.live()) { stopMain(); return; }
    if (Date.now() - lastSync >= LINK_SYNC_MS) { lastSync = Date.now(); void sync().catch(() => {}); }
  }, 1_000);
}
function stopMain() {
  if (watch !== null) { window.clearInterval(watch); watch = null; }
  main?.stop();
}
/** What the Tab list sees (only the public part). */
export function pairForMirror(): PairView { return main ? main.get() : PAIR_OFF; }

// ---------- Tab list: the mirror of the main window's engine ----------

let mirror: PairView = PAIR_OFF;
const mirrorSubs = new Set<() => void>();
/** The overlay state's `pair`, checked again on arrival. */
export function setPairMirror(x: unknown) {
  const v = cleanPairView(x);
  if (JSON.stringify(v) === JSON.stringify(mirror)) return;
  mirror = v;
  mirrorSubs.forEach((f) => f());
}
export const pairMirror = {
  get: () => mirror,
  subscribe(f: () => void) { mirrorSubs.add(f); return () => { mirrorSubs.delete(f); }; },
};
