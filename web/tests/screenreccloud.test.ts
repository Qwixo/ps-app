// Run: node --experimental-strip-types tests/screenreccloud.test.ts
// Screen recorder, the cloud and the recordings list as the page sees them (PS 1.60, pull request 12c: core/recordings.ts, the recstore
// bridge, the Soundboard tab, the client page, the Settings part, the vault kind). The Mac's rules (the upload queue and its waiting rules,
// resume and back off, never deleting before a checked upload, keep the last X days, the three hash functions, seal and open, the player's
// numbers, delete asks first) are tested in mac/tests/screenrec-cloud-test.sh with a fake cloud server. Nothing here uploads or plays.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../src/core/recordings.ts";
import { FREE_DOMAINS } from "../src/core/mail.ts";
import { meetingMessage, liveMeeting } from "../src/core/screenrecmeet.ts";

let n = 0;
const t = (name: string, f: () => void) => { f(); n++; console.log("ok -", name); };
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIN = 60_000, T0 = Date.parse("2026-11-14T10:00:00Z");
const row = (o: Record<string, unknown> = {}) => R.cleanRow({ id: "a", title: "Call with Sam", startedAt: T0, duration: 1800, mac: true, attendees: ["sam@client.example.com"], ...o })!;
const item = (o: Record<string, unknown> = {}, thisMac = true): R.RecItem => ({ row: row(o), thisMac });
const GD = { provider: "googleDrive", encrypted: false, verified: true, openUrl: "https://drive.example.com/file/1" };

t("a row is cleaned: bad links, pictures, addresses and states are dropped", () => {
  const r = R.cleanRow({ id: "x", title: "  A   B ", startedAt: T0, duration: -5, attendees: ["ok@example.com", "nope", 5], thumb: "javascript:alert(1)", mac: true,
    cloud: { provider: "dropbox", openUrl: "http://insecure.example.com", verified: true, encrypted: false }, upload: { state: "bogus", fraction: 9 } })!;
  assert.equal(r.title, "A B"); assert.equal(r.duration, 0); assert.deepEqual(r.attendees, ["ok@example.com"]);
  assert.equal(r.thumb, null); assert.equal(r.cloud?.openUrl, null); assert.equal(r.upload, null);
  assert.equal(R.cleanRow({ title: "no id" }), null); assert.equal(R.cleanRow(null), null);
  assert.equal(R.cleanRow({ id: "y", cloud: { provider: "none" } })?.cloud, null);
  assert.equal(R.cleanRow({ id: "y", upload: { state: "uploading", fraction: 9 } })?.upload?.fraction, 1);
});
t("the Mac's list message is checked", () => {
  assert.equal(R.cleanLib({ type: "other" }), null);
  const l = R.cleanLib({ type: "screenrecLib", device: "dev1", items: [{ id: "a", title: "A" }, { nothing: 1 }] })!;
  assert.equal(l.rows.length, 1); assert.equal(l.rows[0].device, "dev1");
});
t("newest first, then by title", () => {
  const rows = [row({ id: "1", startedAt: T0 }), row({ id: "2", startedAt: T0 + MIN }), row({ id: "3", startedAt: T0, title: "Alpha" })];
  assert.deepEqual(R.sortRows(rows).map((r) => r.id), ["2", "3", "1"]);
});
t("this Mac's list wins, other devices' rows are added, all newest first", () => {
  const mac = [row({ id: "a", startedAt: T0 }), row({ id: "b", startedAt: T0 + 5 * MIN })];
  const vault = [row({ id: "a", title: "OLD", startedAt: T0 }), row({ id: "c", startedAt: T0 + 9 * MIN, mac: true })];
  const m = R.mergeRows(mac, vault);
  assert.deepEqual(m.map((i) => i.row.id), ["c", "b", "a"]); assert.equal(m.find((i) => i.row.id === "a")!.row.title, "Call with Sam");
  assert.deepEqual(m.map((i) => i.thisMac), [false, true, true]);
  assert.equal(R.mergeRows(null, vault).length, 2);
});
t("where it is: This Mac, cloud, or both", () => {
  assert.equal(R.whereText(item()), "This Mac");
  assert.equal(R.whereText(item({ cloud: GD })), "This Mac and Cloud (Google Drive)");
  assert.equal(R.whereText(item({ mac: false, cloud: GD })), "Cloud (Google Drive)");
  assert.equal(R.whereText(item({}, false)), "Your Mac");
  assert.equal(R.whereText(item({ mac: false, cloud: { ...GD, provider: "folder" } })), "Cloud (folder)");
  assert.equal(R.whereText(item({ mac: false })), "Not on this Mac");
});
t("length and date words", () => {
  assert.equal(R.lengthText(45), "45 s"); assert.equal(R.lengthText(1800), "30 min"); assert.equal(R.lengthText(3900), "1 h 5 min"); assert.equal(R.lengthText(-3), "0 s");
  assert.match(R.dateText(T0, "UTC"), /14 Nov 2026/);
});

const FREE = "gmail" + ".example.net";   // a stand in: the real shared provider domains are matched by name in core/mail.ts
const clients = [
  { id: "c1", data: { name: "Acme", email: "boss@acme.example.com", matchAddrs: [], archived: false } },
  { id: "c2", data: { name: "Beta", email: "x@beta.example.com", matchAddrs: ["@sub.beta.example.com", "pa@" + FREE], archived: false } },
  { id: "c3", data: { name: "Old", email: "boss@acme.example.com", matchAddrs: [], archived: true } },
];
t("the client is matched from the attendees with the same matcher as Gmail replies", () => {
  assert.equal(R.matchClient(["boss@acme.example.com"], clients), "c1");
  assert.equal(R.matchClient(["someone@acme.example.com"], clients), "c1");          // the company's domain
  assert.equal(R.matchClient(["pa@" + FREE], clients), "c2");                      // an extra address
  assert.equal(R.matchClient(["any@" + FREE], clients), null);                     // nobody listed that domain
  assert.equal(R.matchClient(["a@acme.example.com", "b@beta.example.com", "c@beta.example.com"], clients), "c2");   // the most people wins
  assert.equal(R.matchClient(["a@acme.example.com", "b@beta.example.com"], clients), "c1");                          // a tie: the first seen
  const shared = [...FREE_DOMAINS][0];                                                                    // a shared provider is never a company
  assert.equal(R.matchClient(["other@" + shared], [{ id: "c9", data: { name: "Solo", email: "boss@" + shared, matchAddrs: [], archived: false } }]), null);
  assert.equal(R.matchClient([], clients), null); assert.equal(R.matchClient(["a@acme.example.com"], []), null);
});
t("a client's page lists only their recordings", () => {
  const items = [item({ id: "1", attendees: ["a@acme.example.com"] }), item({ id: "2", attendees: ["b@beta.example.com"] }), item({ id: "3", attendees: [] })];
  assert.deepEqual(R.forClient(items, "c1", clients).map((i) => i.row.id), ["1"]);
  assert.deepEqual(R.forClient(items, "c2", clients).map((i) => i.row.id), ["2"]);
});

t("Play: on the Mac PS plays it; elsewhere only an unsealed cloud copy with a link opens", () => {
  assert.deepEqual(R.playAction(item(), "mac"), { kind: "play", label: "Play" });
  assert.deepEqual(R.playAction(item({ mac: false, cloud: GD }), "mac"), { kind: "play", label: "Play" });      // streamed or downloaded by the Mac
  assert.deepEqual(R.playAction(item({ cloud: GD }), "phone"), { kind: "open", label: "Open in Google Drive", url: GD.openUrl });
  assert.deepEqual(R.playAction(item({ cloud: { ...GD, provider: "dropbox" } }), "web"), { kind: "open", label: "Open in Dropbox", url: GD.openUrl });
  assert.equal(R.playAction(item({ cloud: { ...GD, encrypted: true } }), "phone").kind, "macOnly");              // sealed: only PS on the Mac
  assert.equal(R.playAction(item({ cloud: { ...GD, provider: "iCloud" } }), "web").kind, "macOnly");
  assert.equal(R.playAction(item({ cloud: { ...GD, provider: "folder" } }), "phone").kind, "macOnly");
  assert.equal(R.playAction(item({ cloud: { ...GD, openUrl: null } }), "phone").kind, "macOnly");
  assert.equal(R.playAction(item(), "phone").label, "Play on your Mac");
  assert.equal(R.playAction(item({ mac: false, cloud: GD }, false), "mac").kind, "open");                        // another Mac's row: this Mac has no login for it
  assert.equal(R.playAction(item({}, false), "mac").kind, "macOnly");
});

t("sync: only rows that are new or changed go to the vault, never the media, never progress", () => {
  const a = row({ id: "a", cloud: GD }), b = row({ id: "b" });
  const plan0 = R.syncPlan([], [a, b], "dev1");
  assert.deepEqual(plan0.put.map((d) => d.id), ["a", "b"]);
  const vault = plan0.put.map((d) => ({ id: "v-" + d.id, data: d }));
  assert.deepEqual(R.syncPlan(vault, [a, b], "dev1"), { put: [], remove: [] });                                           // nothing changed, nothing written
  const prog = row({ id: "a", cloud: GD, upload: { state: "uploading", fraction: 0.4 } });
  assert.deepEqual(R.syncPlan(vault, [prog, b], "dev1").put, []);                                                          // progress is never synced
  const renamed = row({ id: "b", title: "New name" });
  assert.deepEqual(R.syncPlan(vault, [a, renamed], "dev1").put.map((d) => d.id), ["b"]);                                  // only the changed row
  assert.ok(!("upload" in R.toDoc(prog)));
  const keys = Object.keys(R.toDoc(a)).sort();
  assert.deepEqual(keys, ["attendees", "audioOnly", "cloud", "device", "duration", "id", "lowered", "mac", "meeting", "size", "startedAt", "thumb", "title"]);   // no path, no token
});
t("sync: a Mac removes only its own rows that are gone, never another Mac's", () => {
  const mine = R.toDoc(row({ id: "m", device: "dev1" })), other = R.toDoc(row({ id: "o", device: "dev2" }));
  const vault = [{ id: "v1", data: mine }, { id: "v2", data: other }];
  assert.deepEqual(R.syncPlan(vault, [], "dev1").remove, ["m"]);
  assert.deepEqual(R.syncPlan(vault, [row({ id: "m", device: "dev1" })], "dev1").remove, []);
  assert.deepEqual(R.syncPlan(vault, [], null).remove, []);                                                                // no device id: removes nothing
});

t("delete asks first: the Mac's question is shown with real choices, Cancel first", () => {
  assert.equal(R.cleanAsk({ type: "screenrecAsk", id: "a" }), null);
  const a = R.cleanAsk({ type: "screenrecAsk", id: "a", question: "Delete \"X\" from this Mac only? The copy in Google Drive stays.", cloudQuestion: "Delete \"X\" from this Mac and from Google Drive? It cannot be brought back.", hasLocal: true, hasCloud: true, provider: "Google Drive" })!;
  const b = R.deleteButtons(a);
  assert.deepEqual(b.map((x) => x.id), ["cancel", "mac", "both"]);
  assert.equal(b[0].danger, undefined); assert.equal(b[1].also, false); assert.equal(b[2].also, true);
  assert.match(b[2].label, /Google Drive/);
  assert.match(R.deleteQuestion(a, false), /stays/); assert.match(R.deleteQuestion(a, true), /and from Google Drive/);
  assert.deepEqual(R.deleteButtons({ ...a, hasLocal: false }).map((x) => x.id), ["cancel", "cloud"]);
  assert.deepEqual(R.deleteButtons({ ...a, hasCloud: false }).map((x) => x.id), ["cancel", "mac"]);
  assert.deepEqual(R.deleteButtons({ ...a, hasCloud: false, hasLocal: false }).map((x) => x.id), ["cancel", "ok"]);
  const ui = read("../src/soundboard/Recordings.tsx");
  assert.match(ui, /recSend\("recDelete", \{ id: r\.id \}\)/);                                  // the first click only asks
  assert.match(ui, /confirm: true, alsoCloud: b\.also/);                                          // only a button in the dialog confirms
});
t("the cloud state message is checked", () => {
  assert.equal(R.cleanCloud({ type: "x" }), null);
  const c = R.cleanCloud({ type: "screenrecCloud", enabled: true, provider: "dropbox", keepDays: 9999, removeAfter: false, encrypt: true, logins: { dropbox: { clientSet: true, signedIn: false } }, queue: [{ id: "a", name: "N", state: "weird", fraction: 5 }] })!;
  assert.equal(c.provider, "dropbox"); assert.equal(c.keepDays, 365); assert.equal(c.removeAfter, false); assert.equal(c.encrypt, true);
  assert.equal(c.logins.dropbox.clientSet, true); assert.equal(c.logins.googleDrive.signedIn, false); assert.equal(c.queue[0].state, "waiting"); assert.equal(c.queue[0].fraction, 1);
  const d = R.cleanCloud({ type: "screenrecCloud", enabled: true })!;
  assert.equal(d.provider, "none"); assert.equal(d.removeAfter, true); assert.equal(d.encrypt, false); assert.equal(d.keepDays, 7);
  assert.equal(R.cleanCloud({ type: "screenrecCloud", enabled: false })!.enabled, false);
});

t("the meeting message carries the other people's addresses for matching", () => {
  const ev = { id: "e1", title: "Call", start: new Date(T0 - MIN).toISOString(), end: new Date(T0 + 29 * MIN).toISOString(), allDay: false, link: null,
    attendees: [{ email: "Me@Example.com", self: true }, { email: "Sam@Client.Example.com" }, { email: "nope" }] };
  assert.deepEqual(liveMeeting([ev as never], T0)?.attendees, ["sam@client.example.com"]);
  const m = meetingMessage({ st: { enabled: true, featureOn: true }, events: [ev as never], now: T0, privateAskPending: false })!;
  assert.deepEqual(m.attendees, ["sam@client.example.com"]);
  assert.equal(meetingMessage({ st: { enabled: false, featureOn: true }, events: [ev as never], now: T0, privateAskPending: false }), null);   // off: nothing is sent
});

t("every word is plain: no em or en dashes, links are https, the Google Testing note is there", () => {
  const all: string[] = [];
  const walk = (v: unknown) => { if (typeof v === "string") all.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(R.REC_WORDS); walk(R.CLOUD_WORDS); walk(R.UP_LABEL); walk(R.PROVIDER_LABEL);
  for (const s of all) assert.ok(!/[–—]/.test(s), s);
  for (const k of Object.keys(R.CLOUD_WORDS.help)) for (const h of R.CLOUD_WORDS.help[k]) if (h.href) assert.match(h.href, /^https:\/\//);
  assert.match(R.CLOUD_WORDS.testingNote, /Testing mode/); assert.match(R.CLOUD_WORDS.testingNote, /7 days/);
  assert.match(R.CLOUD_WORDS.encryptLine, /Off by default/);
  assert.match(R.CLOUD_WORDS.help.googleDrive.map((h) => h.text).join(" "), /drive\.file/);
});

t("wiring: the vault kind, the Soundboard tab, the client page, the Settings part, the bridge and the feature switch", () => {
  assert.match(read("../src/core/model.ts"), /"srec"/); assert.match(read("../src/core/vault.ts"), /"wachat", "srec"/);
  const sb = read("../src/soundboard/Soundboard.tsx");
  assert.match(sb, /Recordings<\/Chip>/); assert.match(sb, /RecordingsPanel/);
  assert.match(read("../src/views/ClientDetail.tsx"), /<ClientRecordings clientId=\{client\.id\} \/>/);
  assert.match(read("../src/views/ScreenRec.tsx"), /<CloudSettings \/>/);
  assert.match(read("../src/screenrec.ts"), /recMessage\(m\)/);
  const rec = read("../src/views/ClientRecordings.tsx"); assert.match(rec, /if \(!on\) return null/);
  const panel = read("../src/soundboard/Recordings.tsx");
  assert.match(panel, /feature\(SR_FEATURE\)/);                                                   // feature off: nothing shows
  assert.match(panel, /e\.key !== "Escape"/);                                                     // Esc closes the question and the rename box
  const store = read("../src/recstore.ts");
  assert.match(store, /if \(PS\) psPost/); assert.match(store, /vaultStore\.get\(\)\.status !== "unlocked"/);   // nothing sent outside PS, nothing synced while locked
  const css = read("../src/soundboard/recordings.css"); assert.ok(!/animation|transition/.test(css));            // nothing animates, so reduced motion has nothing to turn off
  const f = JSON.parse(read("../../features.json")).features.find((x: { id: string }) => x.id === "screen-recording");
  assert.equal(f.owner, "jan"); assert.equal(f.scope, "shared"); assert.equal(f.since, "1.60"); assert.match(f.gate, /12c/);
  assert.match(read("../src/core/settingsindex.ts"), /id: "screenrec-cloud"/);
});

console.log(`${n} pass`);
