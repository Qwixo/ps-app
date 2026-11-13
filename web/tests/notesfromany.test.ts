// Run: node --experimental-strip-types tests/notesfromany.test.ts
// V1.53 (the developer: "if you update to 1.53 the user will see a long list of changes from whatever version they updated from,
// even if 1.48 for example didn't support this"): which versions show after an update from ANY older version, on a Mac,
// the website, the iPhone web app and the phone, from the state each old version left behind.
//   Mac, website, iPhone web app: V1.36 to V1.52 kept localStorage "ps.whatsNewSeen" and the synced setting
//   whatsNewSeen (core/whatsnew.ts, views/WhatsNew.tsx). Before V1.36 nothing. The phone never had the panel, so it kept
//   nothing. The device marker "ps.deviceRan" (written by V1.53's first unlock) says whether the device ran PS before.
// The history here is the REAL approved notes (ps-public-approvals.json, read only) run through the real gate, plus one
// made up block for 1.53 itself, so the table below is what the build will really list.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as W from "../src/core/whatsnew.ts";
import * as H from "../src/core/notehistory.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const root = (f: string) => new URL("../" + f, import.meta.url);
const gate = JSON.parse(execFileSync(process.execPath, [root("scripts/ps-public.mjs").pathname, "history-json"], { encoding: "utf8" })) as H.NoteBlock[];
const approvals = JSON.parse(readFileSync(root("ps-public-approvals.json"), "utf8")) as Record<string, { notes: string[] }>;
const names = (JSON.parse(readFileSync(root("ps-version.json"), "utf8")) as { names: Record<string, string> }).names;
const CUR = "1.53";
// ps-version.json says 1.52 until the manager bumps it; the gate's history then holds 1.51 and older. Put 1.52 in the
// way the build will have it (a fixture for the running version's own block, never shipped).
const own: H.NoteBlock = { version: CUR, keyword: "Fixture", notes: ["Made up point for the version being updated to."] };
const hist = [...gate, ...(gate.some((b) => b.version === "1.52") ? [] : [{ version: "1.52", keyword: names["1.52"] || "", notes: approvals["1.52"].notes }])];
const ALL = [own, ...hist];

type State = { local?: string | null; synced?: string | null; ran?: boolean; older?: boolean };
/** What a device with this stored state shows when it first runs 1.53 (the same two calls the panel makes). */
function show(s: State, hasNotes = true) {
  const plan = W.whatsNewPlan({ version: CUR, hasNotes, localSeen: s.local ?? null, syncedSeen: s.synced ?? undefined, accountOlder: s.older ?? false, deviceRan: s.ran });
  return { step: plan.step, versions: plan.step === "show" ? H.blocksFor(ALL, plan, CUR).map((b) => b.version) : [] };
}
const range = (from: string, to: string, skip: string[] = ["1.45"]) => {
  const out: string[] = [];
  for (let m = Number(to.slice(2)); m >= Number(from.slice(2)); m--) { const v = `1.${m}`; if (!skip.includes(v)) out.push(v); }
  return out;
};

// ---------- the history reaches back far enough, with the developer's words as stored ----------
ok("the history holds every approved version from 1.36, in the developer's exact words, newest first, 20 at most", () => {
  const want = Object.keys(approvals).filter((v) => v !== "1.53" && v !== "1.52" ? true : true).sort((a, b) => H.cmp(b, a));
  const have = gate.map((b) => b.version);
  for (const v of want.filter((v) => H.cmp(v, "1.52") < 0)) assert.ok(have.includes(v), `${v} is in the history`);
  assert.ok(have.includes("1.36"), "1.36 is reachable");
  assert.ok(!have.includes("1.45"), "1.45 had no approved notes, so it is skipped, never invented");
  assert.ok(gate.length <= H.MAX_BLOCKS);
  for (const b of gate) assert.deepEqual(b.notes, approvals[b.version].notes, `${b.version} words are exactly the approved ones`);
  assert.deepEqual(have, [...have].sort((a, b) => H.cmp(b, a)));
  assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(gate)));
});

ok("a renamed version shows its present name (1.43 is Mystery, not the word typed when it was approved)", () => {
  assert.equal(gate.find((b) => b.version === "1.43")?.keyword, names["1.43"]);
  assert.equal(names["1.43"], "Mystery");
});

// ---------- the table: each old version's stored state, what 1.53 lists ----------
ok("from 1.36 (Mac, website, iPhone web app: it recorded 1.36): everything after it", () => {
  assert.deepEqual(show({ local: "1.36", synced: "1.36", ran: true }), { step: "show", versions: range("1.37", "1.53") });
  assert.ok(show({ local: "1.36", synced: "1.36", ran: true }).versions.length >= 15);
});
ok("from 1.44: 1.46 to 1.53, 1.45 (no public notes) is skipped", () => {
  const r = show({ local: "1.44", synced: "1.44", ran: true });
  assert.deepEqual(r.versions, range("1.46", "1.53"));
  assert.ok(!r.versions.includes("1.45"));
});
ok("from 1.48: 1.49 to 1.53", () => assert.deepEqual(show({ local: "1.48", synced: "1.48", ran: true }).versions, range("1.49", "1.53")));
ok("from 1.49: 1.50 to 1.53", () => assert.deepEqual(show({ local: "1.49", synced: "1.49", ran: true }).versions, range("1.50", "1.53")));
ok("from 1.51: 1.52 and 1.53", () => assert.deepEqual(show({ local: "1.51", synced: "1.51", ran: true }).versions, ["1.53", "1.52"]));
ok("from 1.52 (it supported catch up): only 1.53", () => assert.deepEqual(show({ local: "1.52", synced: "1.52", ran: true }).versions, ["1.53"]));
ok("up to date (1.53 already handled here): nothing", () => assert.equal(show({ local: "1.53", synced: "1.53", ran: true }).step, "quiet"));

ok("a brand new install shows nothing old, even on an account that ran older versions elsewhere", () => {
  assert.deepEqual(show({ ran: false }), { step: "record", versions: [] });
  assert.deepEqual(show({ ran: false, synced: "1.52", older: true }), { step: "record", versions: [] });
});

ok("a device that ran PS before but kept no record (before 1.36, the phone, cleared storage): the last five", () => {
  const five = ["1.53", "1.52", "1.51", "1.50", "1.49"];
  assert.deepEqual(show({ ran: true }).versions, five);
  assert.deepEqual(show({ ran: true, synced: "1.52" }).versions, five);          // another device is on 1.52: this one still lists them
  assert.deepEqual(show({ ran: true, synced: "1.53" }).versions, five);          // another device already updated to 1.53: this one never showed any
});
ok("with an older synced record the list reaches back to it when that is further than five", () => {
  assert.deepEqual(show({ ran: true, synced: "1.45" }).versions, range("1.46", "1.53"));
  assert.deepEqual(show({ ran: true, synced: "1.50" }).versions, ["1.53", "1.52", "1.51", "1.50", "1.49"]);
});
ok("the phone: updated from any older version it lists the last five, once; its new install lists nothing", () => {
  assert.equal(show({ ran: true }).versions.length, 5);
  assert.equal(show({ ran: false, synced: "1.52" }).step, "record");
});
ok("storage that cannot say (no marker): the account's older data stands in", () => {
  assert.deepEqual(show({ older: true }).versions, ["1.53", "1.52", "1.51", "1.50", "1.49"]);
  assert.equal(show({ older: false }).step, "record");
});

ok("a version seen on another device is not repeated where this device has its own record", () => {
  assert.equal(show({ local: "1.48", synced: "1.53", ran: true }).step, "quiet");
  assert.deepEqual(show({ local: "1.48", synced: "1.51", ran: true }).versions, ["1.53", "1.52"]);
});
ok("an older build than the record never shows again, and no approved notes only records", () => {
  assert.equal(W.whatsNewPlan({ version: "1.50", hasNotes: true, localSeen: "1.52", accountOlder: true, deviceRan: true }).step, "quiet");
  assert.equal(show({ ran: true }, false).step, "record");
  assert.equal(show({ local: "1.48", ran: true }, false).step, "record");
});

ok("unknown start with the real history never lists a version without approved words, and every block is a real one", () => {
  for (const s of [{ ran: true }, { local: "1.40", ran: true }, { local: "1.36", ran: true }]) {
    const blocks = H.blocksFor(ALL, W.whatsNewPlan({ version: CUR, hasNotes: true, localSeen: s.local ?? null, accountOlder: false, deviceRan: true }), CUR);
    for (const b of blocks) assert.ok(b.version === CUR || approvals[b.version], b.version);
  }
});

// ---------- the device marker ----------
ok("the device marker is written once, by the first unlock, and never changed afterwards", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  assert.equal(W.deviceRan(store), undefined);
  W.noteDevice(true, store);
  assert.equal(W.deviceRan(store), true);
  W.noteDevice(false, store);                 // a later unlock (the copy exists now) must not turn an old device into a new one
  assert.equal(W.deviceRan(store), true);
  const fresh = new Map<string, string>();
  const s2 = { getItem: (k: string) => fresh.get(k) ?? null, setItem: (k: string, v: string) => { fresh.set(k, v); } };
  W.noteDevice(false, s2);
  W.noteDevice(true, s2);                     // a new device stays new: it records 1.53 and never lists old notes
  assert.equal(W.deviceRan(s2), false);
  const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => W.noteDevice(true, bad));
  assert.equal(W.deviceRan(bad), undefined);
  for (const junk of ["", "2", "true", "yes"]) assert.equal(W.deviceRan({ getItem: () => junk }), undefined);
});

console.log(`\n${n} passed`);
