// Public PS: the version and patch notes the download pages read, and the developer's approval of the words.
// Patch notes are public copy (Rule Zero): they go out only after the developer said yes in chat to the EXACT
// words. The words live in ps-notes.json, per version, either English only or both languages:
//   {"1.11": ["one sentence", "another"]}   or   {"1.11": {"en": ["..."], "ru": ["..."]}}
// The developer's yes is recorded in ps-public-approvals.json as a code (SHA-256) of exactly those words, both
// languages together. Change one character in either and the approval no longer counts.
//
//   node scripts/ps-public.mjs show              the current version's notes, exactly, and their code
//   node scripts/ps-public.mjs approve <code>    ONLY after the developer said yes to those exact words in chat
//   node scripts/ps-public.mjs approved          exit 0 when the current notes are approved
//   node scripts/ps-public.mjs notes-text        the approved English notes as plain lines (else nothing)
//   node scripts/ps-public.mjs whatsnew          the What's new panel's JSON for the current version (V1.36):
//        {"format":1,"version","keyword","notes":[...],"code"}, notes and code empty unless the developer approved
//        exactly these words. vite.config.ts bundles it into every build (website, PS, phone), so the
//        panel can only ever show approved words and needs no network.
//   node scripts/ps-public.mjs history-json     the approved notes of the earlier versions (V1.52, last 20, newest first) as
//        [{"version","keyword","notes":[...]}]: the Mac's signed note and the phone's version.json carry them so an update
//        across several versions shows what every skipped version changed. Only words the developer approved (never private notes).
//   node scripts/ps-public.mjs stage <ps-release> [gos-release]
//        writes <ps-release>/release.json for the download pages (cincee.com/client/ps/release.json).
//        Not approved: the version and downloads are there, the notes are empty. Never anything else.
//
// release.json (agreed with ps-landing, 27 Oct 2026; every key after notes is optional):
// { format: 1, version, name, keyword, released, notes: [strings], notes_ru?: [strings],
//   mac?: { url, size, sha256, minMacOS }, gos?: { url, size, sha256, minAndroid },
//   history?: [{ version, name, keyword, released, notes, notes_ru? }] (approved ones, newest first, up to 20) }
// Old pages and builds read only the keys they know (version, notes, ...), so history never breaks them.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const notesFile = join(root, "ps-notes.json"), okFile = join(root, "ps-public-approvals.json");
const read = (f, d) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };
const versions = read(join(root, "ps-version.json"), {});
const version = versions.version;
const kw = (versions.names || {})[version] || "";

/** The words, cleaned the one way they will be shown: plain strings, trimmed. */
function clean(n) { return Array.isArray(n) ? n.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()) : []; }
function notes() {
  const n = (read(notesFile, {}) || {})[version];
  return Array.isArray(n) ? { en: clean(n), ru: [] } : { en: clean(n?.en), ru: clean(n?.ru) };
}
const code = (n) => createHash("sha256").update(JSON.stringify({ version, notes: n.en, ru: n.ru })).digest("hex").slice(0, 12);
function approved() {
  const n = notes();
  if (!n.en.length) return false;
  return read(okFile, {})[version]?.code === code(n);
}
/** The developer bans long dashes; the pages show text, never HTML. */
function bad(n) {
  return [...n.en, ...n.ru].flatMap((s) => [/[–—]/.test(s) ? `a long dash in: ${s}` : null, /[<>]/.test(s) ? `HTML in: ${s}` : null]).filter(Boolean);
}

/** Earlier versions' approved notes (V1.52): only what the developer approved word for word (ps-public-approvals.json keeps the
 *  words), checked again like the current notes (no long dashes, no HTML, plain strings), older than the current
 *  version only, newest first, at most 20. The developer's private notes live in their own file, which this script never reads (tests/privatenotes.test.ts); the
 *  approvals file holds only what the developer approved as public words. */
const HISTORY_MAX = 20;   // 1.36 to 1.52 is 16 approved versions, so 20 still reaches V1.36 (the first with approved notes) until about V1.57
/** A version's name as it is now: ps-version.json names win over the keyword typed at approval time (V1.43 was approved
 *  as "Truth" and renamed "Mystery"). Only the name, never the approved words. */
const kwOf = (p) => (versions.names || {})[p.v] || p.a.keyword || "";
function past() {
  const num = (v) => { const [a, b] = String(v).split(".").map(Number); return a * 1000 + b; };
  return Object.entries(read(okFile, {}))
    .filter(([v, a]) => /^\d{1,3}\.\d{1,3}$/.test(v) && v !== version && (!version || num(v) < num(version)) && a && Array.isArray(a.notes) && a.notes.length)
    .map(([v, a]) => ({ v, a, en: clean(a.notes), ru: clean(a.notes_ru) }))
    .filter((p) => p.en.length === p.a.notes.length && !bad({ en: p.en, ru: p.ru }).length)
    .sort((x, y) => num(y.v) - num(x.v)).slice(0, HISTORY_MAX);
}

const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const size = (f) => readFileSync(f).length;

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === "show") {
  const n = notes();
  if (!n.en.length) { console.log(`PS V${version}: no patch notes in ps-notes.json yet.`); process.exit(1); }
  console.log(`PS V${version}${kw ? " · " + kw : ""}: the exact patch notes that would go public\n(download pages, the phone and Mac update cards, and the What's new panel after an update)\n`);
  n.en.forEach((s) => console.log(`  - ${s}`));
  if (n.ru.length) { console.log("\n  Russian:"); n.ru.forEach((s) => console.log(`  - ${s}`)); }
  const b = bad(n);
  if (b.length) { console.log(`\nFix first: ${b.join("; ")}`); process.exit(1); }
  if (n.en.length < 3 || n.en.length > 6) console.log(`\nNote: the What's new panel in PS is made for 3 to 6 points (these are ${n.en.length}; it shows the first 6).`);
  console.log(`\nCode: ${code(n)}${approved() ? " (already approved)" : ""}`);
  console.log("Show the developer these exact words in chat. Only after his yes: node scripts/ps-public.mjs approve " + code(n));
} else if (cmd === "approve") {
  const n = notes();
  if (!n.en.length || a1 !== code(n) || bad(n).length) { console.error("That code is not the current notes' code (or they need fixing). Nothing recorded."); process.exit(1); }
  const ok = read(okFile, {});
  ok[version] = { code: a1, at: new Date().toISOString(), keyword: kw, notes: n.en, ...(n.ru.length ? { notes_ru: n.ru } : {}) };
  writeFileSync(okFile, JSON.stringify(ok, null, 1) + "\n");
  console.log(`Recorded: the developer approved the V${version} notes (${a1}).`);
} else if (cmd === "approved") {
  process.exit(approved() ? 0 : 1);
} else if (cmd === "notes-text") {
  if (approved()) process.stdout.write(notes().en.join("\n"));
} else if (cmd === "whatsnew") {
  // Fails closed: anything not approved, or anything the pages may not show, gives no notes at all.
  const ok = approved(), n = notes();
  const show = ok && !bad(n).length ? n.en : [];
  process.stdout.write(JSON.stringify({ format: 1, version: version || "", keyword: kw, notes: show, code: show.length ? code(n) : "",
    history: past().map((p) => ({ version: p.v, keyword: kwOf(p), notes: p.en })) }) + "\n");
} else if (cmd === "history-json") {
  process.stdout.write(JSON.stringify(past().map((p) => ({ version: p.v, keyword: kwOf(p), notes: p.en }))));
} else if (cmd === "stage") {
  const out = a1, gos = a2;
  if (!out || !existsSync(out)) { console.error("stage needs the ps-release folder"); process.exit(1); }
  const ok = approved(), n = notes();
  const r = { format: 1, version, name: `V${version}`, keyword: kw, released: new Date().toISOString(), notes: ok ? n.en : [] };
  if (ok && n.ru.length) r.notes_ru = n.ru;
  const dmg = join(out, "PS.dmg");
  // V1.51: the link names its version (?v=1.51). Netlify sends PS.dmg as no-cache, but Cloudflare in front of cincee.com
  // answers it with max-age=14400, so a browser that fetched the plain link in the last 4 hours could be handed the
  // previous release's DMG, which then has to update once more. A new address per release is never in any cache.
  // The pages that read release.json (ps-app-mac, PsDownloads.tsx) resolve it with new URL(), query and all.
  if (existsSync(dmg)) r.mac = { url: `/client/ps/PS.dmg?v=${encodeURIComponent(version || "")}`, size: size(dmg), sha256: sha(dmg), minMacOS: "13.0" };
  const gv = gos && read(join(gos, "version.json"), null);
  if (gv && gv.apk && existsSync(join(gos, gv.apk))) r.gos = { url: `/client/gos/${gv.apk}`, size: gv.size, sha256: gv.sha256, minAndroid: "13" };
  // Earlier releases: only the ones the developer approved, with the words he approved, newest first.
  const hist = past().map((p) => ({ version: p.v, name: `V${p.v}`, keyword: kwOf(p), released: p.a.at, notes: p.en, ...(p.ru.length ? { notes_ru: p.ru } : {}) }));
  if (hist.length) r.history = hist;
  writeFileSync(join(out, ".release.json.part"), JSON.stringify(r, null, 1) + "\n");
  renameSync(join(out, ".release.json.part"), join(out, "release.json"));
  console.log(`ps-public: release.json for V${version}${r.notes.length ? " with the developer's approved notes" : " with no notes (not approved yet)"}`);
} else {
  console.error("usage: ps-public.mjs show | approve <code> | approved | notes-text | whatsnew | history-json | stage <ps-release> [gos-release]");
  process.exit(2);
}
