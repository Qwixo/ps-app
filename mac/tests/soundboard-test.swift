// tests/soundboard-test.sh: Sources/SoundboardMath.swift, the Soundboard's pure rules (V1.47). Made up names, sizes
// and dates only: nothing is read, written or played.
import Foundation
setvbuf(stdout, nil, _IONBF, 0)
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }

// ---------- kinds, ids, names ----------
ok("kinds by extension, any case", SbMath.kind("Song.MP3") == "audio" && SbMath.kind("clip.mov") == "video" && SbMath.kind("x.webm") == "video"
   && SbMath.kind("notes.txt") == nil && SbMath.kind("opus") == "audio" && SbMath.kind("noext") == nil)
ok("content types from the contract", SbMath.contentType("mp3") == "audio/mpeg" && SbMath.contentType("M4A") == "audio/mp4" && SbMath.contentType("aif") == "audio/aiff"
   && SbMath.contentType("caf") == "audio/x-caf" && SbMath.contentType("mov") == "video/quicktime" && SbMath.contentType("mkv") == "video/x-matroska"
   && SbMath.contentType("3gp") == "video/3gpp" && SbMath.contentType("m4v") == "video/mp4" && SbMath.contentType("exe") == "application/octet-stream")
let ids = (0..<200).map { _ in SbMath.newId() }
ok("ids: 16 lowercase hex, random", ids.allSatisfy(SbMath.isId) && Set(ids).count == 200 && !SbMath.isId("ABCDEF0123456789") && !SbMath.isId("abc") && !SbMath.isId("g123456789abcdef"))
ok("display name: the file name without its extension", SbMath.displayName("Morning Horn.mp3") == "Morning Horn" && SbMath.displayName("a.b.wav") == "a.b")
ok("rename: 1 to 120 characters, trimmed, no control characters", SbMath.cleanName("  Wake up\u{7} ") == "Wake up" && SbMath.cleanName("   ") == nil
   && SbMath.cleanName(String(repeating: "x", count: 121)) == nil && SbMath.cleanName(String(repeating: "x", count: 120))?.count == 120 && SbMath.cleanName(nil) == nil)
ok("safe file names: no slash, colon or leading dot", SbMath.safeFileName("../a/b:c.mp3", fallback: "S") == "a b c.mp3" && SbMath.safeFileName("...", fallback: "Squad sound") == "Squad sound"
   && SbMath.safeFileName(".hidden.wav", fallback: "S") == "hidden.wav")
ok("paths: relative, no dot parts, at most 4 folders, known kind", SbMath.pathOk("a.mp3") && SbMath.pathOk("A/B/C/D/e.mp4") && !SbMath.pathOk("A/B/C/D/E/f.mp3")
   && !SbMath.pathOk("../x.mp3") && !SbMath.pathOk("/abs.mp3") && !SbMath.pathOk("a//b.mp3") && !SbMath.pathOk(".h/x.mp3") && !SbMath.pathOk("x.txt") && !SbMath.pathOk(""))
ok("folder of a path", SbMath.folder("x.mp3") == "" && SbMath.folder("Beats/Drums/k.wav") == "Beats/Drums")

// ---------- name clashes ----------
ok("a clash gets 2, then 3, before the extension, any case", SbMath.uniqueName("Song.mp3", taken: []) == "Song.mp3"
   && SbMath.uniqueName("Song.mp3", taken: ["song.MP3"]) == "Song 2.mp3" && SbMath.uniqueName("Song.mp3", taken: ["Song.mp3", "Song 2.mp3"]) == "Song 3.mp3"
   && SbMath.uniqueName("Folder", taken: ["Folder"]) == "Folder 2")

// ---------- the index ----------
let raw: [String: Any] = ["v": 1, "items": [
  ["id": "0123456789abcdef", "path": "a.mp3", "name": "Alpha", "added": 5],
  ["id": "0123456789abcdef", "path": "b.mp3", "name": "dup id"],
  ["id": "1123456789abcdef", "path": "A.MP3", "name": "dup path"],
  ["id": "2123456789abcdef", "path": "../evil.mp3"],
  ["id": "BAD", "path": "c.mp3"],
  ["id": "3123456789abcdef", "path": "Beats/k.wav", "name": "  "],
]]
let idx = SbMath.items(raw, inDefault: true)
ok("index: bad ids, bad paths and repeats left out; a blank name falls back to the file's", idx.map(\.id) == ["0123456789abcdef", "3123456789abcdef"]
   && idx[0].name == "Alpha" && idx[0].added == 5 && idx[1].name == "k")
let back = SbMath.items(SbMath.indexJSON(idx), inDefault: false)
ok("index: written and read back the same (own kept)", back == idx && idx.allSatisfy(\.own))
var seq = 0
let fake = { () -> String in seq += 1; return String(format: "f%015x", seq) }
let m = SbMath.merge(idx, files: ["Beats/k.wav", "new.m4a", "notes.txt", "Beats/k.wav"], now: 99, newId: fake)
ok("merge: a gone file is dropped, an unknown one added with a fresh id, others kept", m.changed && m.items.map(\.path) == ["Beats/k.wav", "new.m4a"]
   && m.items[1].id == "f000000000000001" && m.items[1].name == "new" && m.items[1].added == 99 && m.items[0].id == "3123456789abcdef")
ok("merge: nothing new, nothing changed", !SbMath.merge(m.items, files: ["new.m4a", "Beats/k.wav"], now: 1).changed)

// ---------- own and adopted (PS only ever deletes files PS put there) ----------
ok("merge: a file PS did not put there is adopted (own false); PS's entries stay own", !m.items[1].own && m.items[0].own)
let oldRaw: [String: Any] = ["v": 1, "items": [["id": "4123456789abcdef", "path": "old.mp3"], ["id": "5123456789abcdef", "path": "mine.mp3", "own": true],
                                               ["id": "6123456789abcdef", "path": "theirs.mp3", "own": false]]]
let inDef = SbMath.items(oldRaw, inDefault: true), elsewhere = SbMath.items(oldRaw, inDefault: false)
ok("old entries without own: PS's in the default folder, adopted anywhere else; a written own is kept",
   inDef.map(\.own) == [true, true, false] && elsewhere.map(\.own) == [false, true, false])
ok("remove: PS's own file is deleted, an adopted one only leaves the list (ignored)",
   SbMath.removal(inDef[1]) == (true, nil) && SbMath.removal(inDef[2]) == (false, "theirs.mp3"))
let ig = SbMath.merge([inDef[1]], files: ["mine.mp3", "theirs.mp3", "song.mp3"], ignored: ["theirs.mp3", "gone.mp3"], now: 5, newId: fake)
ok("ignored: not added back by the next look; an ignored path whose file is gone is forgotten",
   ig.items.map(\.path) == ["mine.mp3", "song.mp3"] && ig.ignored == ["theirs.mp3"] && ig.changed)
let igJson = SbMath.indexJSON(ig.items, ignored: ig.ignored)
ok("ignored: written in the index and read back", SbMath.ignored(igJson) == ["theirs.mp3"] && (igJson["ignored"] as? [String]) == ["theirs.mp3"]
   && SbMath.ignored(["ignored": ["../x.mp3", "a.mp3", "a.mp3"]]) == ["a.mp3"])
let theirs = [SbMath.Item(id: "aaaaaaaaaaaaaaaa", path: "x.mp3", name: "x", added: 1, own: false)]
let ours = [SbMath.Item(id: "aaaaaaaaaaaaaaaa", path: "x 2.mp3", name: "x", added: 2, own: false), SbMath.Item(id: "bbbbbbbbbbbbbbbb", path: "y.mp3", name: "y", added: 3, own: true)]
seq = 0
let both = SbMath.mergeIndexes(theirs: theirs, ours: ours, newId: fake)
ok("two indexes into one: both sets, an id clash gets a fresh id", both.map(\.path) == ["x.mp3", "x 2.mp3", "y.mp3"] && both[1].id == "f000000000000001" && both[2].id == "bbbbbbbbbbbbbbbb")
ok("move: every copy PS made is PS's own in the new folder; what was there keeps its own", both.map(\.own) == [false, true, true])
let moving = [SbMath.Item(id: "aaaaaaaaaaaaaaaa", path: "a.mp3", name: "a", added: 1, own: true), SbMath.Item(id: "bbbbbbbbbbbbbbbb", path: "My Song.mp3", name: "s", added: 1, own: false),
              SbMath.Item(id: "cccccccccccccccc", path: "c.mp3", name: "c", added: 1, own: true)]
ok("move: only PS's own copies leave the old folder, and only ones that were copied; adopted files stay",
   SbMath.oldToDelete(moving, copied: ["a.mp3", "My Song.mp3"]) == ["a.mp3"])

// ---------- moving the storage ----------
let mp = SbMath.movePlan(["a.mp3", "Beats/k.wav", "Beats/K 2.wav", "b.mp3"], existing: ["A.mp3", "beats/k.wav"])
ok("move plan: same relative paths, a clash in the new folder renamed", mp.map(\.to) == ["a 2.mp3", "Beats/k 2.wav", "Beats/K 2 2.wav", "b.mp3"] && mp.map(\.from) == ["a.mp3", "Beats/k.wav", "Beats/K 2.wav", "b.mp3"])
ok("move: never into itself or below it", !SbMath.moveOk(from: "/U/m/PS Soundboard", to: "/U/m/PS Soundboard") && !SbMath.moveOk(from: "/U/m/PS Soundboard", to: "/U/m/PS Soundboard/Sub")
   && SbMath.moveOk(from: "/U/m/PS Soundboard", to: "/U/m/PS Soundboard 2") && SbMath.moveOk(from: "/U/m/PS Soundboard", to: "/Volumes/Drive/Sounds"))
ok("labels: short, never the user's name", SbMath.label("/Users/someone/Music/PS Soundboard", home: "/Users/someone") == "Music > PS Soundboard"
   && SbMath.label("/Volumes/Drive/Sounds", home: "/Users/someone") == "Drive > Sounds"
   && SbMath.label("/Users/other/Music/x", home: "/Users/someone") == "Music > x"
   && SbMath.label("/Users/someone/a/b/c/d/e", home: "/Users/someone/") == "c > d > e"
   && !SbMath.label("/Users/someone/Music", home: "/Users/someone").contains("someone"))

// ---------- byte ranges ----------
func rg(_ h: String?, _ size: Int64, cap: Int64 = 1000) -> String { SbMath.range(h, size: size, cap: cap).map { "\($0.start)-\($0.end)\($0.partial ? "p" : "")" } ?? "416" }
ok("ranges: none is the whole file", rg(nil, 500) == "0-499" && rg("items=0-3", 500) == "0-499")
ok("ranges: from-to, open end, suffix", rg("bytes=0-1", 500) == "0-1p" && rg("bytes=100-", 500) == "100-499p" && rg("bytes=-100", 500) == "400-499p" && rg("bytes=490-900", 500) == "490-499p")
ok("ranges: past the end or backwards is 416", rg("bytes=500-", 500) == "416" && rg("bytes=9-3", 500) == "416" && rg(nil, 0) == "416")
ok("ranges: a big file in pieces (cap), partial when cut", rg(nil, 5000, cap: 1000) == "0-999p" && rg("bytes=4500-", 5000, cap: 1000) == "4500-4999p" && rg("bytes=0-", 1000, cap: 1000) == "0-999p")

// ---------- timed plays ----------
var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Dubai")!
let iso = ISO8601DateFormatter()
func tb(_ s: String) -> Date { iso.date(from: s + ":00+04:00")! }
let pl = SbMath.plan([
  ["id": "w", "media": "0123456789abcdef", "name": "Horn", "at": "07:07", "days": [1, 2, 3, 4, 5, 5, 9], "vol": 3, "loop": true],
  ["id": "w", "media": "0123456789abcdef", "at": "08:00", "days": [0]],
  ["id": "bad", "media": "nope", "at": "07:00", "days": [1]],
  ["id": "t", "media": "1123456789abcdef", "at": "24:00", "days": [1]],
  ["id": "s", "media": "1123456789abcdef", "at": "23:59", "days": [6], "vol": 0.01],
])
ok("plan: checked, a repeat id and bad media or times left out, days and level kept in range", pl.map(\.id) == ["w", "s"] && pl[0].days == [1, 2, 3, 4, 5] && pl[0].vol == 1
   && pl[0].loop && pl[0].name == "Horn" && pl[1].vol == 0.1 && !pl[1].loop && pl[1].name == "Sound" && pl[0].hour == 7 && pl[0].minute == 7)
// 2026-11-10 is a Tuesday.
ok("next due: today if still ahead, else the next day picked", SbMath.nextDue(pl[0], after: tb("2026-11-10T06:00"), cal: cal) == tb("2026-11-10T07:07")
   && SbMath.nextDue(pl[0], after: tb("2026-11-10T07:07"), cal: cal) == tb("2026-11-11T07:07")
   && SbMath.nextDue(pl[0], after: tb("2026-11-13T08:00"), cal: cal) == tb("2026-11-16T07:07"))
ok("next due: Saturday only, from a Sunday", SbMath.nextDue(pl[1], after: tb("2026-11-15T00:00"), cal: cal) == tb("2026-11-21T23:59"))
var none = pl[0]; none.days = []
ok("no days: never", SbMath.nextDue(none, after: tb("2026-11-10T06:00"), cal: cal) == nil && SbMath.nextWake([none], after: tb("2026-11-10T06:00"), cal: cal) == nil)
var ny = Calendar(identifier: .gregorian); ny.timeZone = TimeZone(identifier: "America/New_York")!
var early = pl[0]; early.hour = 1; early.minute = 30; early.days = [0]
let dst = SbMath.nextDue(early, after: iso.date(from: "2026-11-01T00:00:00-04:00")!, cal: ny)!
ok("local time across daylight saving: 01:30 New York on the 1 Nov change is the first 01:30", iso.string(from: dst) == "2026-11-01T05:30:00Z")
var spring = early; spring.hour = 2; spring.days = [0]
let sp = SbMath.nextDue(spring, after: iso.date(from: "2026-03-08T00:00:00-05:00")!, cal: ny)!
ok("a time that does not exist (clocks forward) rings at the next valid moment that day", iso.string(from: sp).hasPrefix("2026-03-08T07:"))
ok("due: rings once when the time passes, not again", SbMath.due(pl, since: tb("2026-11-10T07:06"), now: tb("2026-11-10T07:07"), cal: cal)?.0.id == "w"
   && SbMath.due(pl, since: tb("2026-11-10T07:07"), now: tb("2026-11-10T07:08"), cal: cal) == nil)
ok("due: a wake 90 s late still rings, 5 minutes late does not", SbMath.due(pl, since: tb("2026-11-10T05:00"), now: tb("2026-11-10T07:08").addingTimeInterval(30), cal: cal)?.0.id == "w"
   && SbMath.due(pl, since: tb("2026-11-10T05:00"), now: tb("2026-11-10T07:12"), cal: cal) == nil)
ok("due: after days asleep, only today's time counts (no catch up)", SbMath.due(pl, since: tb("2026-11-01T05:00"), now: tb("2026-11-10T07:07").addingTimeInterval(20), cal: cal)?.1 == tb("2026-11-10T07:07"))
ok("due: the clock went back, nothing rings", SbMath.due(pl, since: tb("2026-11-10T09:00"), now: tb("2026-11-10T07:07"), cal: cal) == nil)
ok("next wake: the earliest due time of all", SbMath.nextWake(pl, after: tb("2026-11-14T12:00"), cal: cal) == tb("2026-11-14T23:59")
   && SbMath.nextWake(pl, after: tb("2026-11-15T00:00"), cal: cal) == tb("2026-11-16T07:07"))
ok("plan json round trip", SbMath.plan(pl.map(\.json)) == pl)

print("\n\(n - bad) of \(n) passed")
if bad > 0 { exit(1) }
