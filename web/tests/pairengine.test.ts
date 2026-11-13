// Run: node --experimental-strip-types tests/pairengine.test.ts
// V1.57 phone-link-fast: the Mac's pairing as a plain engine (src/core/pairengine.ts), so the main window can run it for
// the Tab list (src/core/pairmac.ts). The developer: linking his phone from Edit mode took about 5 minutes; the card lived in the
// Tab list, which holds no keys, so its code never carried the sign in. Proves:
//  - the engine runs the exact V1.55 protocol against a relay with migration 029's rules: same code on both screens,
//    the phone opens what the Mac sealed, the offer is single use, Allow is required, Not my phone throws it away,
//    a new code every minute, stop deletes the open offer, nothing is sent without keys;
//  - what crosses to the Tab list is only the public view, checked again there (a bad view is "off");
//  - the Tab list's requests are checked, and a Tab list that stops pinging stops the pairing;
//  - the wiring: the card asks the main window in the Tab list, ps.ts runs it and mirrors it, the phone layout and the
//    phone records poke so the live edit sync starts at once, and the calm note is on both linking screens.
import * as P from "../src/core/phonepair.ts";
import { PairEngine, PairLeases, PAIR_LEASE_MS, PAIR_PING_MS, LINK_WAIT_NOTE, cleanPairOp, cleanPairView, type PairDeps } from "../src/core/pairengine.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let n = 0;
const ok = async (name: string, f: () => Promise<void> | void) => { await f(); n++; console.log("ok -", name); };
const waitFor = async (f: () => boolean, what: string) => {
  for (let i = 0; i < 400; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error(`timed out waiting for ${what}`);
};

// ---------- a relay with migration 029's rules (tests/phonepair.test.ts checks the SQL says the same) ----------
type Row = { id: string; expires: number; phone: string | null; claimed: number | null; reveal: string | null; sealed: string | null };
class Relay {
  rows = new Map<string, Row>();
  now = 1_000_000;
  migrated = true;
  claim(id: string, pub: string): boolean {
    const r = this.rows.get(id);
    if (!r || r.phone !== null || r.expires <= this.now) return false;
    r.phone = pub; r.claimed = this.now; return true;
  }
  poll(id: string, pub: string) {
    const r = this.rows.get(id);
    if (!r || r.phone !== pub || r.claimed! < this.now - P.ALLOW_MS) return null;
    if (r.sealed !== null) this.rows.delete(id);
    return { reveal: r.reveal, sealed: r.sealed };
  }
}
const PAY: P.LinkPayload = { v: 1, u: "alex.smith", a: "P_uFkuhoCjjX1rrKXN0Hgo2wbO3egTB3XdpMM6hDp3E", k: "97pQ70liffvRpRg2oifY8WJKAAt4L8zukO2-4-adMhU", d: "0f8fad5b-d9cb-469f-a165-70867728950e" };
function deps(relay: Relay, o: { can?: boolean } = {}): PairDeps & { clicks: number; dropped: string[] } {
  const d = {
    clicks: 0, dropped: [] as string[],
    can: () => o.can ?? true,
    async insert(id: string) { if (!relay.migrated) return false; relay.rows.set(id, { id, expires: relay.now + P.OFFER_MS, phone: null, claimed: null, reveal: null, sealed: null }); return true; },
    async drop(id: string) { d.dropped.push(id); relay.rows.delete(id); },
    async claimed(id: string) { return relay.rows.get(id)?.phone ?? null; },
    async reveal(id: string, nonce: string) { const r = relay.rows.get(id); if (!r) return false; r.reveal = nonce; return true; },
    async exists(id: string) { return relay.rows.has(id); },
    async seal(m: P.MacSide, phone: string) { return P.sealForPhone(m, phone, PAY); },
    async store(id: string, sealed: string) { const r = relay.rows.get(id); if (!r) return false; r.sealed = sealed; return true; },
    now: () => relay.now,
    every: () => () => {},   // the test calls tick() itself
    click: () => { d.clicks++; },
  };
  return d;
}
const offerOf = (part: string) => P.readOffer(new URLSearchParams(part.slice(1)))!;

await ok("happy path: the QR carries an offer, the phone claims it, same code, Allow, the phone opens it, the Mac says done", async () => {
  const relay = new Relay(), d = deps(relay), e = new PairEngine(d);
  e.start();
  await waitFor(() => e.get().phase.k === "ready", "ready");
  const offer = offerOf(e.get().part);
  assert.ok(offer, "the part reads back as an offer");
  // The phone: its own key, claims once.
  const me = await P.newPhoneKey();
  assert.equal(relay.claim(offer.id, me.pub), true);
  assert.equal(relay.claim(offer.id, (await P.newPhoneKey()).pub), false, "a second phone (a photo of the QR) cannot claim it");
  await e.tick();
  const ph = e.get().phase;
  assert.equal(ph.k, "confirm");
  assert.equal(d.clicks, 1);
  const seen = relay.poll(offer.id, me.pub)!;
  assert.ok(seen.reveal && !seen.sealed, "the nonce is revealed, nothing is sealed before Allow");
  assert.equal(await P.linkCode(offer, me.pub, seen.reveal!), (ph as { code: string }).code, "both screens show the same code");
  await e.allow();
  assert.equal(e.get().phase.k, "sent");
  const got = relay.poll(offer.id, me.pub)!;
  assert.deepEqual(await P.openOnPhone(me, offer, got.reveal!, got.sealed!), PAY);
  assert.equal(relay.rows.has(offer.id), false, "single use: the read deleted it");
  assert.equal(relay.poll(offer.id, me.pub), null, "a replayed poll gets nothing");
  await e.tick();
  assert.equal(e.get().phase.k, "done");
  e.stop();
});

await ok("nothing is sealed without Allow, and Allow outside the code step does nothing", async () => {
  const relay = new Relay(), d = deps(relay), e = new PairEngine(d);
  e.start();
  await waitFor(() => e.get().phase.k === "ready", "ready");
  await e.allow();
  assert.equal(e.get().phase.k, "ready");
  const offer = offerOf(e.get().part);
  const me = await P.newPhoneKey();
  relay.claim(offer.id, me.pub);
  await e.tick();
  relay.now += P.ALLOW_MS + 1;
  await e.tick();   // no Allow in time: a new code
  await waitFor(() => e.get().phase.k === "ready" && offerOf(e.get().part).id !== offer.id, "a new offer");
  assert.equal(relay.rows.get(offer.id), undefined, "the old offer was deleted, never sealed");
  e.stop();
});

await ok("Not my phone throws the offer away and shows a new code", async () => {
  const relay = new Relay(), d = deps(relay), e = new PairEngine(d);
  e.start();
  await waitFor(() => e.get().phase.k === "ready", "ready");
  const offer = offerOf(e.get().part);
  relay.claim(offer.id, (await P.newPhoneKey()).pub);
  await e.tick();
  assert.equal(e.get().phase.k, "confirm");
  e.deny();
  await waitFor(() => e.get().phase.k === "ready" && offerOf(e.get().part).id !== offer.id, "a new offer");
  assert.ok(d.dropped.includes(offer.id));
  e.stop();
});

await ok("a new code every minute, and stop deletes the open offer", async () => {
  const relay = new Relay(), d = deps(relay), e = new PairEngine(d);
  e.start();
  await waitFor(() => e.get().phase.k === "ready", "ready");
  const first = offerOf(e.get().part).id;
  relay.now += P.OFFER_MS - 4_000;
  await e.tick();
  await waitFor(() => e.get().part !== "" && offerOf(e.get().part).id !== first, "the minute's new code");
  const second = offerOf(e.get().part).id;
  assert.ok(d.dropped.includes(first));
  e.stop();
  assert.deepEqual(e.get(), { phase: { k: "off" }, part: "" });
  assert.ok(d.dropped.includes(second));
  assert.equal(relay.rows.size, 0);
});

await ok("no keys in this window, or no relay on the project: off, and nothing is written", async () => {
  const relay = new Relay(), e = new PairEngine(deps(relay, { can: false }));
  e.start(); await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(e.get(), { phase: { k: "off" }, part: "" });
  assert.equal(relay.rows.size, 0);
  e.stop();
  const old = new Relay(); old.migrated = false;
  const e2 = new PairEngine(deps(old));
  e2.start(); await new Promise((r) => setTimeout(r, 30));
  assert.equal(e2.get().phase.k, "off");
  e2.stop();
});

await ok("the Tab list's mirror: only the public view gets through, anything else is off", async () => {
  const mac = await P.newOffer();
  const part = P.offerPart(mac.offer);
  const pub = (await P.newPhoneKey()).pub;
  assert.deepEqual(cleanPairView({ phase: { k: "ready" }, part }), { phase: { k: "ready" }, part });
  assert.deepEqual(cleanPairView({ phase: { k: "confirm", code: "123 456", phone: pub }, part }).phase, { k: "confirm", code: "123 456", phone: pub });
  assert.equal(cleanPairView({ phase: { k: "ready" }, part: part + "&k=sb_secret_x" }).phase.k, "off", "nothing can be added to the QR");
  assert.equal(cleanPairView({ phase: { k: "ready" }, part: "&o=x&m=y&c=z" }).phase.k, "off");
  assert.equal(cleanPairView({ phase: { k: "confirm", code: "12345", phone: pub }, part }).phase.k, "off");
  assert.equal(cleanPairView({ phase: { k: "nope" } }).phase.k, "off");
  assert.equal(cleanPairView(null).phase.k, "off");
  // The view never holds the nonce or a key: only what the QR shows anyway.
  const json = JSON.stringify(cleanPairView({ phase: { k: "ready" }, part, nonce: mac.nonce, priv: "x" }));
  assert.ok(!json.includes(mac.nonce) && !json.includes("priv"));
});

await ok("the Tab list's requests are checked, and a Tab list that stops pinging stops the pairing", () => {
  assert.deepEqual(cleanPairOp({ op: "allow", who: "abc123def" }), { op: "allow", who: "abc123def" });
  assert.equal(cleanPairOp({ op: "seal", who: "abc123def" }), null);
  assert.equal(cleanPairOp({ op: "start", who: "x" }), null);
  assert.equal(cleanPairOp("start"), null);
  let t = 0;
  const l = new PairLeases(() => t);
  assert.equal(l.apply({ op: "start", who: "card0001" }), true);
  assert.equal(l.apply({ op: "start", who: "settings01" }), true);
  assert.equal(l.apply({ op: "stop", who: "settings01" }), true, "still one open");
  t += PAIR_PING_MS; assert.equal(l.apply({ op: "ping", who: "card0001" }), true);
  t += PAIR_LEASE_MS + 1;
  assert.equal(l.live(), false, "no ping for a while (a reload): it stops by itself");
  assert.ok(PAIR_LEASE_MS > PAIR_PING_MS * 3);
});

await ok("wiring: the card asks the main window from the Tab list, ps.ts runs and mirrors it", () => {
  const hook = read("src/views/LinkPair.tsx");
  assert.match(hook, /PS && psInOverlay\(\)/);
  assert.match(hook, /pairOp: \{ op, who: who\.current \}/);
  assert.doesNotMatch(hook, /from\("ps_link_offers"\)/, "the hook no longer talks to the relay itself");
  const ps = read("src/ps.ts");
  assert.match(ps, /cleanPairOp\(patch\.pairOp\); if \(o\) runPairOp\(o\)/);
  assert.match(ps, /setPairMirror\(st\.unlocked \? st\.pair : null\)/);
  assert.match(ps, /const pair = unlocked \? pairForMirror\(\) : null;/);
  assert.match(ps, /leads, pair \}\)/);
  const mac = read("src/core/pairmac.ts");
  assert.match(mac, /canLinkPhone/);
  assert.match(mac, /LINK_SYNC_MS = 3_000/);
  const card = read("src/views/PhoneLink.tsx");
  assert.match(card, /usePhonePairing\(can\)/, "the offer is made as the card opens, on either tab");
  assert.match(card, /useState<"install" \| "link">\("link"\)/, "GrapheneOS opens on the code, not on Install");
  assert.match(card, /Already signed in on the phone\? Just open PS there/);
});

await ok("live: the phone layout and phone records poke, phones and the Mac's main window listen from unlock", () => {
  const v = read("src/core/vault.ts");
  assert.match(v, /phonePokeKinds = new Set<string>\(\["phonelayout", "phonedev"\]\)/);
  assert.match(v, /LIVE_POKES = new Set\(\["fit", "pl"\]\)/);
  assert.match(v, /if \(LISTEN_FROM_UNLOCK && snap\.role === "owner"\) listenFitPoke\(\);   \/\/ V1\.57: the phone layout pokes/);
  assert.match(v, /if \(fitCh \|\| secondCh \|\| !meta/, "never two joins of the same topic");
  assert.equal(P.POLL_MS, 1_000);
});

await ok("the calm note: on both linking screens, plain, no dashes", () => {
  assert.equal(LINK_WAIT_NOTE, "Phone pairing may take up to a few minutes.");
  assert.doesNotMatch(LINK_WAIT_NOTE, /[-–—]/);
  assert.match(read("src/views/PhoneLink.tsx"), /\{LINK_WAIT_NOTE\}/);
  assert.match(read("src/views/LinkIphone.tsx"), /\{LINK_WAIT_NOTE\}/);
  for (const f of ["src/core/pairengine.ts", "src/core/pairmac.ts", "src/views/PhoneLink.tsx", "src/views/LinkPair.tsx"]) {
    assert.doesNotMatch(read(f), /[–—]/, `${f} has no en or em dash`);
  }
});

console.log(`\n${n} passed`);
