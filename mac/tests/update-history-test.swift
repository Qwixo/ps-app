// Offline test for the signed note's earlier-version notes (V1.52, the developer: updating across several versions must show
// what every skipped version changed). Notes are signed with a throwaway key made here. Nothing online, nothing installed.
// Run: bash tests/update-history-test.sh
import CryptoKit
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty ? "" : " (\(info))")"); if !ok { fails += 1 } }

let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("ps-update-history-\(UUID().uuidString)", isDirectory: true)
try! FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: tmp) }
setenv("PS_SELFTEST", tmp.path, 1)
let key = Curve25519.Signing.PrivateKey()
let pub = key.publicKey.rawRepresentation.base64EncodedString()

func note(_ extra: [String: Any]) -> UpdateManifest {
  var payload: [String: Any] = ["format": 1, "kind": "web", "made": "2026-11-12T10:00:00Z", "name": "V1.52", "keyword": "Newest",
    "notes": ["Newest change one.", "Newest change two."],
    "web": ["src": "s", "built": "2611121000", "file": "updates/PS-web-1.zip", "size": 10, "sha256": String(repeating: "a", count: 64)]]
  for (k, v) in extra { payload[k] = v }
  let signed = try! JSONSerialization.data(withJSONObject: payload)
  let raw = try! JSONSerialization.data(withJSONObject: ["signed": signed.base64EncodedString(), "sig": try! key.signature(for: signed).base64EncodedString()])
  return try! UpdateManifest.open(raw, publicKey: pub)
}
func block(_ v: String, _ kw: String, _ n: [Any]) -> [String: Any] { ["version": v, "keyword": kw, "notes": n] }

let all: [Any] = [block("1.49", "Order", ["Forty nine."]), block("1.51", "Healing", ["Fifty one a.", "Fifty one b."]), block("1.50", "Curiosity", ["Fifty."])]
let m = note(["history": all])

check("history-read-newest-first", m.history.map(\.version) == ["1.51", "1.50", "1.49"], "\(m.history.map(\.version))")
check("current-notes-kept-for-old-fields", m.notes == ["Newest change one.", "Newest change two."] && m.version == "V1.52")

// Installed 1.49, newest 1.52: 1.52, 1.51, 1.50, newest first, never 1.49 itself.
let c = m.catchUp(installed: "V1.49")
check("1.49-to-1.52-shows-1.50-to-1.52", c.map(\.version) == ["1.52", "1.51", "1.50"], "\(c.map(\.version))")
check("titles", c.first?.title == "V1.52 · Newest" && c.last?.title == "V1.50 · Curiosity")
check("one-step-update-shows-only-the-newest", m.catchUp(installed: "1.51").map(\.version) == ["1.52"])
check("installed-unknown-shows-only-the-newest", m.catchUp(installed: nil).map(\.version) == ["1.52"] && m.catchUp(installed: "junk").map(\.version) == ["1.52"])
check("already-newest-shows-the-newest-only", m.catchUp(installed: "V1.52").map(\.version) == ["1.52"])

// An unapproved newest version (no notes) is skipped; the earlier approved ones still show.
let n2 = note(["history": all, "notes": []])
check("unapproved-newest-skipped", n2.catchUp(installed: "V1.49").map(\.version) == ["1.51", "1.50"], "\(n2.catchUp(installed: "V1.49").map(\.version))")

// Bad blocks never show: a long dash, HTML, a non-string line, an empty list, a bad version, a duplicate.
let bad: [Any] = [
  block("1.48", "Ok", ["Fine."]),
  block("1.47", "Dash", ["A long dash \u{2014} here."]),
  block("1.46", "Html", ["<b>bold</b>"]),
  block("1.45", "Mixed", ["Fine.", 3]),
  block("1.44", "Empty", []),
  block("x.y", "Bad", ["Fine."]),
  block("1.48", "Dup", ["Other."]),
  block("1.43", "Long", [String(repeating: "x", count: 221)]),
  block("1.42", "Dash\u{2013}word", ["Fine."]),
]
let b = note(["history": bad])
check("bad-blocks-dropped-whole", b.history.map(\.version) == ["1.48"] && b.history.first?.notes == ["Fine."], "\(b.history.map(\.version))")

// Short blocks, capped counts.
let many: [Any] = (10...40).map { block("1.\($0)", "K", (1...8).map { "Line \($0)." }) }
let k = note(["history": many])
check("at-most-20-blocks-6-lines", k.history.count == 20 && k.history.allSatisfy { $0.notes.count == 6 } && k.history.first?.version == "1.40")

// An older note with no history at all still opens (old releases, web only releases before V1.52).
let o = note([:])
check("no-history-is-fine", o.history.isEmpty && o.catchUp(installed: "V1.49").map(\.version) == ["1.52"])
check("history-is-signed", {
  var payload: [String: Any] = ["format": 1, "kind": "web", "made": "x", "web": ["src": "s", "built": "b", "file": "updates/PS-web-1.zip", "size": 10, "sha256": String(repeating: "a", count: 64)], "history": all]
  payload["name"] = "V1.52"
  let signed = try! JSONSerialization.data(withJSONObject: payload)
  var other = payload; other["history"] = [block("1.50", "Fake", ["Changed after signing."])]
  let tampered = try! JSONSerialization.data(withJSONObject: other)
  let raw = try! JSONSerialization.data(withJSONObject: ["signed": tampered.base64EncodedString(), "sig": try! key.signature(for: signed).base64EncodedString()])
  return (try? UpdateManifest.open(raw, publicKey: pub)) == nil
}())

print(fails == 0 ? "update-history-test: all ok" : "update-history-test: \(fails) FAILED")
exit(fails == 0 ? 0 : 1)
