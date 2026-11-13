// Run: node tests/phonepair.test.ts  (Node 22.6+ strips types)
// V1.55: a phone signs itself in by scanning the Mac (src/core/phonepair.ts, migration 029). Proves the protocol:
// both screens agree only when nobody swapped a key, the sealed sign in opens only on the phone that claimed the offer,
// a photo of the QR gets nowhere, the Mac's nonce cannot be swapped after the fact, an old sealed box cannot be replayed
// into a new pairing, and the relay's rules (claim once, within 60 s, Allow before anything is sent, one read) hold.
import * as P from "../src/core/phonepair.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAY = (d = "0f8fad5b-d9cb-469f-a165-70867728950e"): P.LinkPayload => ({ v: 1, u: "alex.smith", a: "P_uFkuhoCjjX1rrKXN0Hgo2wbO3egTB3XdpMM6hDp3E", k: "97pQ70liffvRpRg2oifY8WJKAAt4L8zukO2-4-adMhU", d });

// ---------- a model of the relay, with migration 029's rules (the SQL is checked below to say the same) ----------
type Row = { id: string; created: number; expires: number; phone: string | null; claimed: number | null; reveal: string | null; sealed: string | null };
class Relay {
  rows = new Map<string, Row>();
  now = 0;
  offer(id: string) { this.rows.set(id, { id, created: this.now, expires: this.now + P.OFFER_MS, phone: null, claimed: null, reveal: null, sealed: null }); }
  claim(id: string, pub: string): boolean {   // ps_link_claim
    const r = this.rows.get(id);
    if (!P.ID_RE.test(id) || !P.PUB_RE.test(pub) || !r || r.phone !== null || r.expires <= this.now) return false;
    r.phone = pub; r.claimed = this.now; return true;
  }
  poll(id: string, pub: string) {              // ps_link_poll
    const r = this.rows.get(id);
    if (!r || r.phone !== pub || r.claimed! < this.now - P.ALLOW_MS) return null;
    if (r.sealed !== null) this.rows.delete(id);
    return { reveal: r.reveal, sealed: r.sealed };
  }
}
let n = 0;
const ok = async (name: string, f: () => Promise<void>) => { await f(); n++; console.log("ok -", name); };

await ok("happy path: same code on both screens, the phone opens exactly what the Mac sent, once", async () => {
  const relay = new Relay();
  const mac = await P.newOffer();
  relay.offer(mac.offer.id);
  // The QR: what the phone reads.
  const q = new URLSearchParams(`link=1&u=abcdefghijklmnopqrst&k=x${P.offerPart(mac.offer)}`);
  const seen = P.readOffer(q)!;
  assert.deepEqual(seen, mac.offer);
  const phone = await P.newPhoneKey();
  assert.ok(relay.claim(seen.id, phone.pub));
  // The Mac reads the phone's key, then reveals its nonce.
  const r = relay.rows.get(mac.offer.id)!;
  r.reveal = mac.nonce;
  const got = relay.poll(seen.id, phone.pub)!;
  assert.equal(got.sealed, null, "nothing to open before Allow");
  assert.ok(await P.revealOk(seen, got.reveal!));
  const onMac = await P.linkCode(mac.offer, r.phone!, mac.nonce);
  const onPhone = await P.linkCode(seen, phone.pub, got.reveal!);
  assert.match(onMac, /^\d{3} \d{3}$/);
  assert.equal(onMac, onPhone, "both screens show the same code");
  // Allow.
  r.sealed = await P.sealForPhone(mac, r.phone!, PAY());
  assert.ok(!r.sealed.includes(PAY().a) && !r.sealed.includes(PAY().k), "the relay sees ciphertext only");
  const last = relay.poll(seen.id, phone.pub)!;
  assert.deepEqual(await P.openOnPhone(phone, seen, last.reveal!, last.sealed!), PAY());
  assert.equal(relay.poll(seen.id, phone.pub), null, "read once: the offer is gone");
});

await ok("single use: a second claim (a photo of the QR, or a replay) is refused", async () => {
  const relay = new Relay();
  const mac = await P.newOffer();
  relay.offer(mac.offer.id);
  const a = await P.newPhoneKey(), b = await P.newPhoneKey();
  assert.ok(relay.claim(mac.offer.id, a.pub));
  assert.equal(relay.claim(mac.offer.id, b.pub), false, "a second phone cannot claim it");
  assert.equal(relay.claim(mac.offer.id, a.pub), false, "nor the same one again");
  assert.equal(relay.poll(mac.offer.id, b.pub), null, "and the other key cannot read anything");
});

await ok("expiry: an offer cannot be claimed after 60 seconds, and a claimed one closes after 3 minutes", async () => {
  const relay = new Relay();
  const mac = await P.newOffer();
  relay.offer(mac.offer.id);
  relay.now += P.OFFER_MS;
  assert.equal(relay.claim(mac.offer.id, (await P.newPhoneKey()).pub), false);
  const m2 = await P.newOffer();
  relay.offer(m2.offer.id);
  const ph = await P.newPhoneKey();
  assert.ok(relay.claim(m2.offer.id, ph.pub));
  relay.now += P.ALLOW_MS + 1;
  assert.equal(relay.poll(m2.offer.id, ph.pub), null, "too late to Allow");
});

await ok("Allow needed: the phone gets nothing to open until the Mac seals it, and only the Mac can", async () => {
  const mac = await P.newOffer();
  const phone = await P.newPhoneKey();
  // Without the Mac's private key nobody can make a box the phone accepts: a box from a stranger with the same offer fails.
  const stranger = await P.newOffer();
  const fake: P.MacSide = { offer: mac.offer, priv: stranger.priv, nonce: mac.nonce };
  const forged = await P.sealForPhone(fake, phone.pub, PAY());
  await assert.rejects(P.openOnPhone(phone, mac.offer, mac.nonce, forged), "a box not from the Mac in the QR is refused");
});

await ok("wrong code: a key swapped by the relay shows a different code on the Mac, and its box is useless", async () => {
  const mac = await P.newOffer();
  const phone = await P.newPhoneKey();
  const swapped = await P.newPhoneKey();   // what a relay in the middle hands the Mac instead of the phone's key
  const onMac = await P.linkCode(mac.offer, swapped.pub, mac.nonce);
  const onPhone = await P.linkCode(mac.offer, phone.pub, mac.nonce);
  assert.notEqual(onMac, onPhone, "the codes differ: the person presses Not my phone");
  // If the person pressed Allow anyway, the box is for the swapped key: the real phone cannot open it, and the
  // swapped key can (that is why Allow is only for matching codes; the panel says so).
  const box = await P.sealForPhone(mac, swapped.pub, PAY());
  await assert.rejects(P.openOnPhone(phone, mac.offer, mac.nonce, box));
  // Odds of a match by chance: one in a million per offer. The nonce is revealed only after the key is fixed and the
  // phone checks it against the QR's commitment, so the swapped key cannot be searched for a match:
  const other = "AAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(await P.revealOk(mac.offer, other), false, "a different nonce does not match the QR's commitment");
  await assert.rejects(P.openOnPhone(phone, mac.offer, other, box));
});

await ok("replay: a box from an earlier pairing does not open in a new one", async () => {
  const m1 = await P.newOffer(), m2 = await P.newOffer();
  const phone = await P.newPhoneKey();
  const old = await P.sealForPhone(m1, phone.pub, PAY());
  await assert.rejects(P.openOnPhone(phone, m2.offer, m2.nonce, old), "bound to its own offer and nonce");
  const ph2 = await P.newPhoneKey();
  await assert.rejects(P.openOnPhone(ph2, m1.offer, m1.nonce, old), "and to its own phone key");
  // Tampered box.
  const good = await P.sealForPhone(m1, phone.pub, PAY());
  const bad = good.slice(0, -2) + (good.endsWith("A") ? "BB" : "AA");
  await assert.rejects(P.openOnPhone(phone, m1.offer, m1.nonce, bad));
});

await ok("the QR part and the payload are checked field by field", async () => {
  const m = await P.newOffer();
  assert.match(P.offerPart(m.offer), /^&o=[A-Za-z0-9_-]{22}&m=[A-Za-z0-9_-]{87}&c=[A-Za-z0-9_-]{22}$/);
  assert.equal(P.readOffer(new URLSearchParams("o=short&m=x&c=y")), null);
  assert.equal(P.readOffer(new URLSearchParams("")), null, "an older code has no offer: the phone links the project only");
  assert.equal(P.cleanPayload({ ...PAY(), a: "x" }), null);
  assert.equal(P.cleanPayload({ ...PAY(), d: "not-a-uuid" }), null);
  assert.equal(P.cleanPayload({ ...PAY(), v: 2 }), null);
  assert.equal(P.cleanPayload({ ...PAY(), u: "a\nb" }), null);
  assert.deepEqual(P.cleanPayload({ ...PAY(), extra: "dropped" }), PAY());
  await assert.rejects(P.sealForPhone(m, "nope", PAY()));
});

await ok("migration 029 says the same: claim once, within the minute, one read, nothing secret, rate limited hints", async () => {
  const sql = readFileSync(new URL("../supabase/migrations/029_phone_signin.sql", import.meta.url), "utf8");
  assert.match(sql, /where id = p_id and phone_pub is null and expires_at > now\(\)/, "claim once, before it runs out");
  assert.match(sql, /if r\.sealed is not null then delete from public\.ps_link_offers where id = p_id/, "read once");
  assert.match(sql, /r\.claimed_at < now\(\) - interval '3 minutes'/, "Allow window");
  assert.match(sql, /expires_at <= now\(\) \+ interval '2 minutes'/, "a Mac cannot make a long lived offer");
  assert.match(sql, /where id = p_id and phone_pub = p_pub/, "only the phone that claimed it reads it");
  assert.match(sql, /if n >= 30 then raise exception/, "hint lookups are rate limited");
  assert.match(sql, /revoke all on public\.ps_account_hints from anon, authenticated/, "nobody reads the hints table directly");
  assert.ok(!/'public'/.test(sql), "fits a project shared with another app (ps-mac ProjectEngine.forSchema)");
  assert.ok(!/create\s+trigger[^;]*\bon\s+auth\./i.test(sql));
  // Offer life on the page matches the database.
  assert.equal(P.OFFER_MS, 60_000);
  assert.equal(P.ALLOW_MS, 3 * 60_000);
});

console.log(`phonepair: ${n} passed`);
