// Offline test for Sources/ProtonBridgeCore.swift (Proton Mail through Bridge, PS 1.65). FICTIONAL people and addresses only.
// The only connection is FakeBridge: it answers from a script, records what it was sent and never opens a socket.
//   bash tests/proton-bridge-test.sh
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }

/// A scripted server. `respond` gets every line the client sends (without CRLF) and returns the bytes to answer with.
final class FakeBridge: ProtonTransport {
  var inbox = Data()
  var sent: [String] = []
  var tls = false, closed = false
  var fingerprint: String? = "aa11"
  var respond: (String, FakeBridge) -> String
  var dead = false
  init(greeting: String, respond: @escaping (String, FakeBridge) -> String) { self.respond = respond; inbox.append(Data(greeting.utf8)) }
  func send(_ data: Data) throws {
    if dead { throw ProtonError.bridgeDown }
    for l in String(decoding: data, as: UTF8.self).components(separatedBy: "\r\n") where !l.isEmpty { sent.append(l); inbox.append(Data(respond(l, self).utf8)) }
  }
  func readLine() throws -> String {
    guard let r = inbox.range(of: Data("\r\n".utf8)) else { throw ProtonError.timeout }
    let s = String(decoding: inbox[inbox.startIndex..<r.lowerBound], as: UTF8.self)
    inbox.removeSubrange(inbox.startIndex..<r.upperBound)
    return s
  }
  func readBytes(_ n: Int) throws -> Data {
    guard inbox.count >= n else { throw ProtonError.timeout }
    let d = Data(inbox.prefix(n)); inbox.removeFirst(n); return d
  }
  func startTLS() throws { tls = true }
  func peerFingerprint() -> String? { tls ? fingerprint : nil }
  func close() { closed = true }
}

// ---------- the loopback guard ----------
check("guard 127.0.0.1", ProtonGuard.loopback("127.0.0.1") == "127.0.0.1")
check("guard localhost", ProtonGuard.loopback(" LocalHost ") == "127.0.0.1")
check("guard 127.1.2.3", ProtonGuard.loopback("127.1.2.3") == "127.1.2.3")
check("guard ::1", ProtonGuard.loopback("::1") == "::1" && ProtonGuard.loopback("[::1]") == "::1")
for bad in ["192.168.1.5", "10.0.0.1", "8.8.8.8", "imap.example.com", "127.0.0.1.example.com", "example.com", "0x7f.0.0.1", "2130706433", "127.0.0", "127.0.0.1.1",
            "127.0.0.256", "0127.0.0.1", "127.0.0.01", "", " ", "0.0.0.0", "::", "::2", "[::1]:25", "127.0.0.1:1143", "127.0.0.1/", "localhost.example.com", "127.0.0.1 evil"] {
  check("guard refuses \(bad)", ProtonGuard.loopback(bad) == nil)
}
check("port ok", ProtonGuard.validPort(1143) && ProtonGuard.validPort(1) && ProtonGuard.validPort(65535))
check("port bad", !ProtonGuard.validPort(0) && !ProtonGuard.validPort(70000) && !ProtonGuard.validPort(-1))

// ---------- the config ----------
let cfg = ProtonConfig.make(host: "127.0.0.1", port: 1143, user: "Jane@example.com", password: "bridge-pass")!
check("config lower cases the user", cfg.user == "jane@example.com" && cfg.port == 1143 && cfg.smtpPort == 1025 && cfg.fingerprint == nil)
check("config port as text", ProtonConfig.make(host: "localhost", port: " 1143 ", user: "a@example.com", password: "x")?.port == 1143)
check("config refuses a remote host", ProtonConfig.make(host: "mail.example.com", port: 1143, user: "a@example.com", password: "x") == nil)
check("config refuses a bad port", ProtonConfig.make(host: "127.0.0.1", port: 99999, user: "a@example.com", password: "x") == nil && ProtonConfig.make(host: "127.0.0.1", port: "abc", user: "a@example.com", password: "x") == nil)
check("config refuses a bad user", ProtonConfig.make(host: "127.0.0.1", port: 1143, user: "not an address", password: "x") == nil)
check("config refuses an empty or multi line password", ProtonConfig.make(host: "127.0.0.1", port: 1143, user: "a@example.com", password: "") == nil && ProtonConfig.make(host: "127.0.0.1", port: 1143, user: "a@example.com", password: "a\r\nb") == nil)

// ---------- the pin ----------
check("pin first time", ProtonPin.decide(stored: nil, seen: "AA11") == .pin && ProtonPin.decide(stored: "", seen: "aa11") == .pin)
check("pin same", ProtonPin.decide(stored: "aa11", seen: "AA11") == .ok)
check("pin changed", ProtonPin.decide(stored: "aa11", seen: "bb22") == .changed)
check("fingerprint is sha256 hex", ProtonPin.fingerprint(Data("abc".utf8)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

// ---------- text helpers ----------
check("decode B word", ProtonText.decodeWords("=?UTF-8?B?SGVsbG8gd29ybGQ=?=") == "Hello world")
check("decode Q word", ProtonText.decodeWords("=?utf-8?Q?Caf=C3=A9_menu?=") == "Café menu")
check("decode latin1 Q", ProtonText.decodeWords("=?iso-8859-1?Q?Andr=E9?=") == "André")
check("two words join", ProtonText.decodeWords("=?utf-8?Q?Hel?= =?utf-8?Q?lo?=") == "Hello")
check("plain stays", ProtonText.decodeWords("Quarterly plan") == "Quarterly plan")
check("quote escapes", ProtonText.imapQuote("a\"b\\c") == "\"a\\\"b\\\\c\"" && ProtonText.imapQuote("a\r\nb") == nil)
check("oneLine", ProtonText.oneLine("a\r\nb\tc") == "a b c")
check("qp", String(decoding: ProtonText.qpData("Caf=C3=A9 =\r\nok"), as: UTF8.self) == "Café ok")
let a1 = ProtonParse.address("\"Morgan, Alex\" <Alex.Morgan@Client.example>")
check("address with name", a1.name == "Morgan, Alex" && a1.email == "alex.morgan@client.example")
check("address bare", ProtonParse.address("sam@client.example").email == "sam@client.example" && ProtonParse.address("sam@client.example").name == nil)
check("address encoded name", ProtonParse.address("=?UTF-8?Q?Ren=C3=A9e?= <renee@client.example>").name == "Renée")
check("address none", ProtonParse.address("nobody").email == nil)
check("date", ProtonParse.date("Tue, 3 Nov 2026 09:15:00 +0100") == "2026-11-03T08:15:00Z")
check("date with comment", ProtonParse.date("Tue, 3 Nov 2026 09:15:00 +0000 (UTC)") == "2026-11-03T09:15:00Z")
check("date bad", ProtonParse.date("last tuesday") == nil)
let hh = ProtonParse.headers("Subject: A long\r\n subject line\r\nFrom: x@example.com\r\nSubject: second\r\n\r\nBody: not a header\r\n")
check("headers unfold and keep first", hh["subject"] == "A long subject line" && hh["from"] == "x@example.com" && hh["body"] == nil)
check("key from message id", ProtonParse.key(msgId: "<ID1@client.example>", uid: 5) == ProtonParse.key(msgId: "id1@client.example", uid: 9) && ProtonParse.key(msgId: nil, uid: 5) == "u5")
check("key short", ProtonParse.key(msgId: "x@y.example", uid: 1).count <= 24)

// ---------- snippets ----------
check("snippet plain", ProtonParse.snippet(headers: [:], body: Data("Hi there,\r\nCan we move the call?\r\n> old quote\r\n-- \r\nSig".utf8)) == "Hi there, Can we move the call?")
check("snippet qp utf8", ProtonParse.snippet(headers: ["content-transfer-encoding": "quoted-printable"], body: Data("Caf=C3=A9 is =\r\nopen".utf8)) == "Café is open")
check("snippet base64", ProtonParse.snippet(headers: ["content-transfer-encoding": "base64"], body: Data("SGVsbG8gZnJvbSBQcm90b24=\r\n".utf8)) == "Hello from Proton")
let multi = "--b1\r\nContent-Type: text/html\r\n\r\n<p>html version</p>\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nThe plain words.\r\n--b1--\r\n"
check("snippet multipart prefers text/plain", ProtonParse.snippet(headers: ["content-type": "multipart/alternative; boundary=\"b1\""], body: Data(multi.utf8)) == "The plain words.")
let multiHtml = "--B\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<style>p{}</style><p>Only <b>html</b> here</p>\r\n--B--\r\n"
check("snippet html only", ProtonParse.snippet(headers: ["content-type": "multipart/alternative; boundary=B"], body: Data(multiHtml.utf8)) == "Only html here")
check("snippet cut", ProtonParse.snippet(headers: [:], body: Data(String(repeating: "word ", count: 200).utf8), max: 50).hasSuffix("..."))
check("snippet empty on junk multipart", ProtonParse.snippet(headers: ["content-type": "multipart/mixed; boundary=zz"], body: Data("nothing".utf8)) == "")

// ---------- a whole check, with canned IMAP answers ----------
func lit(_ s: String) -> String { "{\(s.utf8.count)}\r\n\(s)" }
let h1 = "From: \"Alex Morgan\" <alex@client.example>\r\nSubject: =?UTF-8?Q?Caf=C3=A9_plan?=\r\nDate: Tue, 3 Nov 2026 09:15:00 +0100\r\nMessage-ID: <m1@client.example>\r\n\r\n"
let h2 = "From: sam@other.example\r\nSubject: Hello\r\nDate: Wed, 4 Nov 2026 10:00:00 +0000\r\nMessage-ID: <m2@other.example>\r\n\r\n"
func imapServer(password: String = "bridge-pass", unseen: String = "4 9", fingerprint: String = "aa11") -> FakeBridge {
  let b = FakeBridge(greeting: "* OK IMAP4rev1 Proton Mail Bridge ready\r\n") { line, me in
    let tag = String(line.split(separator: " ").first ?? "a")
    let cmd = line.dropFirst(tag.count + 1)
    if cmd == "STARTTLS" { return "\(tag) OK Begin TLS\r\n" }
    if cmd.hasPrefix("LOGIN ") { return cmd == "LOGIN \"jane@example.com\" \"\(password)\"" ? "\(tag) OK logged in\r\n" : "\(tag) NO Login failed\r\n" }
    if cmd == "EXAMINE INBOX" { return "* 12 EXISTS\r\n\(tag) OK [READ-ONLY] done\r\n" }
    if cmd == "UID SEARCH UNSEEN" { return "* SEARCH \(unseen)\r\n\(tag) OK done\r\n" }
    if cmd.hasPrefix("UID FETCH") {
      return "* 3 FETCH (UID 4 BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] \(lit(h1)) BODY[TEXT]<0> \(lit("Can we talk about the plan?\r\n")))\r\n"
        + "* 8 FETCH (UID 9 BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] \(lit(h2)) BODY[TEXT]<0> \(lit("* OK this body looks like a protocol line\r\nBye")))\r\n\(tag) OK done\r\n"
    }
    if cmd == "LOGOUT" { return "* BYE\r\n\(tag) OK bye\r\n" }
    return "\(tag) BAD unknown\r\n"
  }
  b.fingerprint = fingerprint
  return b
}
do {
  let b = imapServer()
  let r = try ProtonImap.unread(b, config: cfg)
  check("imap two rows, newest first", r.rows.count == 2 && r.rows[0].from == "sam@other.example" && r.rows[1].from == "alex@client.example")
  check("imap subject decoded", r.rows[1].subject == "Café plan" && r.rows[1].fromName == "Alex Morgan")
  check("imap date", r.rows[1].date == "2026-11-03T08:15:00Z")
  check("imap snippet", r.rows[1].snippet == "Can we talk about the plan?")
  check("imap literal that looks like a line is body", r.rows[0].snippet.hasPrefix("* OK this body"))
  check("imap pins on first link", r.pinned == "aa11")
  check("imap TLS before login", b.sent.firstIndex(where: { $0.contains("STARTTLS") })! < b.sent.firstIndex(where: { $0.contains("LOGIN") })!)
  check("imap read only", b.sent.contains(where: { $0.hasSuffix("EXAMINE INBOX") }) && !b.sent.contains(where: { $0.contains("SELECT") || $0.contains("STORE") || $0.contains("EXPUNGE") }))
  check("imap peek only", b.sent.contains(where: { $0.contains("BODY.PEEK[TEXT]") }) && !b.sent.contains(where: { $0.contains(" BODY[") }))
  check("imap closed", b.closed)
  check("imap row key and uid", r.rows[1].uid == 4 && r.rows[1].key == ProtonParse.key(msgId: "m1@client.example", uid: 4) && r.rows[1].msgId == "m1@client.example")
  check("row json has no uid or ids", r.rows[1].json["uid"] == nil && r.rows[1].json["msgId"] == nil && r.rows[1].json["key"] != nil)
} catch { check("imap happy path", false, "\(error)") }
do {
  var pinned = cfg; pinned.fingerprint = "aa11"
  let r = try ProtonImap.unread(imapServer(), config: pinned)
  check("imap pinned and same: no new pin", r.pinned == nil && r.rows.count == 2)
} catch { check("imap pinned ok", false, "\(error)") }
do {
  var pinned = cfg; pinned.fingerprint = "aa11"
  let b = imapServer(fingerprint: "ffff")
  _ = try ProtonImap.unread(b, config: pinned)
  check("imap changed cert throws", false)
} catch let e as ProtonError {
  check("imap changed cert throws", e == .certChanged)
} catch { check("imap changed cert throws", false) }
do {
  var pinned = cfg; pinned.fingerprint = "aa11"
  let b = imapServer(fingerprint: "ffff")
  _ = try? ProtonImap.unread(b, config: pinned)
  check("changed cert: the password never left", !b.sent.contains(where: { $0.contains("LOGIN") || $0.contains("bridge-pass") }))
}
do {
  _ = try ProtonImap.unread(imapServer(password: "other"), config: cfg)
  check("wrong password throws", false)
} catch let e as ProtonError { check("wrong password throws", e == .badPassword && e.code == "badPassword") } catch { check("wrong password throws", false) }
do {
  let b = imapServer(unseen: "")
  let r = try ProtonImap.unread(b, config: cfg)
  check("no unread: no fetch", r.rows.isEmpty && !b.sent.contains(where: { $0.contains("UID FETCH") }))
} catch { check("no unread", false, "\(error)") }
do {
  let b = imapServer(unseen: (1...80).map(String.init).joined(separator: " "))
  _ = try? ProtonImap.unread(b, config: cfg, limit: 10)
  let fetch = b.sent.first(where: { $0.contains("UID FETCH") }) ?? ""
  check("limit keeps the newest 10", fetch.contains("UID FETCH 71,72,73,74,75,76,77,78,79,80 "))
}
do {
  let b = FakeBridge(greeting: "") { _, _ in "" }
  _ = try ProtonImap.unread(b, config: cfg)
  check("silent bridge times out", false)
} catch let e as ProtonError { check("silent bridge times out", e == .timeout && e.code == "timeout") } catch { check("silent bridge times out", false) }
do {
  let b = FakeBridge(greeting: "garbage\r\n") { _, _ in "" }
  _ = try ProtonImap.unread(b, config: cfg)
  check("bad greeting", false)
} catch let e as ProtonError { check("bad greeting", e.code == "protocol") } catch { check("bad greeting", false) }
do {
  var remote = cfg; remote.host = "mail.example.com"
  let b = imapServer()
  _ = try ProtonImap.unread(b, config: remote)
  check("remote host refused", false)
} catch let e as ProtonError { check("remote host refused", e == .notLoopback) } catch { check("remote host refused", false) }
do {
  var remote = cfg; remote.host = "10.0.0.5"
  let b = imapServer()
  _ = try? ProtonImap.unread(b, config: remote)
  check("remote host: nothing was sent", b.sent.isEmpty)
}
do {
  var nasty = cfg; nasty.password = "pa\"ss\\word"
  let b = imapServer(password: "pa\\\"ss\\\\word")
  let r = try ProtonImap.unread(b, config: nasty)
  check("password with quote and backslash is escaped", r.rows.count == 2)
} catch { check("escaped password", false, "\(error)") }

// ---------- the FETCH parser on its own ----------
let raw = "* 1 FETCH (UID 7 BODY[HEADER.FIELDS (FROM)] \(lit("From: a@client.example\r\n\r\n")) BODY[TEXT]<0> NIL)\r\n* 2 FETCH (UID 8 FLAGS (\\Seen) BODY[HEADER.FIELDS (FROM)] \"From: b@client.example\\r\\n\")\r\nA9 OK done\r\n"
let fs = ProtonParse.fetches(Data(raw.utf8))
check("fetch parser reads uid and header", fs.count == 2 && fs[0].uid == 7 && fs[0].header.contains("a@client.example") && fs[1].uid == 8)
check("fetch parser ignores junk", ProtonParse.fetches(Data("hello\r\n* OK x\r\nA1 OK\r\n".utf8)).isEmpty)
check("fetch parser survives a cut literal", ProtonParse.fetches(Data("* 1 FETCH (UID 3 BODY[TEXT]<0> {500}\r\nshort".utf8)).count == 1)
check("row needs a valid sender", ProtonParse.row(ProtonParse.Fetched(uid: 1, header: "Subject: x\r\n\r\n", body: Data())) == nil)
check("row without subject", ProtonParse.row(ProtonParse.Fetched(uid: 1, header: "From: a@client.example\r\n\r\n", body: Data()))?.subject == "(no subject)")
check("search uids", ProtonParse.searchUids(["* SEARCH 3 1 2", "* 5 EXISTS"]) == [3, 1, 2])

// ---------- SMTP: the reply ----------
let rep = ProtonReply.from(["to": "Alex@Client.example", "subject": "Café plan\r\nBcc: spy@example.com", "text": "Yes, Tuesday works.\n.\nBye", "inReplyTo": "<m1@client.example>", "references": "<m0@client.example>"])!
check("reply cleans", rep.to == "alex@client.example" && !rep.subject.contains("\n") && rep.inReplyTo == "m1@client.example")
check("reply subject Re:", rep.replySubject.hasPrefix("Re: ") && ProtonReply.from(["to": "a@client.example", "subject": "Re: x", "text": "t"])!.replySubject == "Re: x")
check("reply refuses bad input", ProtonReply.from(["to": "nope", "text": "t"]) == nil && ProtonReply.from(["to": "a@client.example", "text": "  "]) == nil && ProtonReply.from(["to": "a@client.example, b@client.example", "text": "t"]) == nil)
let msg = rep.message(from: "jane@example.com", date: Date(timeIntervalSince1970: 1_794_000_000), id: "id1")
check("message headers", msg.contains("From: jane@example.com\r\n") && msg.contains("To: alex@client.example\r\n") && msg.contains("In-Reply-To: <m1@client.example>\r\n") && msg.contains("References: <m0@client.example> <m1@client.example>"))
check("message no injected header", !msg.contains("\r\nBcc:") && msg.contains("Subject: =?UTF-8?B?"))
check("message body is base64 of the text", {
  let parts = msg.components(separatedBy: "\r\n\r\n"); guard parts.count >= 2 else { return false }
  let b64 = parts[1].replacingOccurrences(of: "\r\n", with: "")
  return String(decoding: Data(base64Encoded: b64) ?? Data(), as: UTF8.self) == "Yes, Tuesday works.\n.\nBye"
}())
func smtpServer(authCode: Int = 235, rcpt: Int = 250, fingerprint: String = "aa11") -> FakeBridge {
  var inData = false
  let b = FakeBridge(greeting: "220 127.0.0.1 ESMTP Bridge\r\n") { line, me in
    if inData { if line == "." { inData = false; return "250 queued\r\n" }; return "" }
    if line.hasPrefix("EHLO") { return "250-127.0.0.1\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n" }
    if line == "STARTTLS" { return "220 go\r\n" }
    if line.hasPrefix("AUTH PLAIN") { return authCode == 235 ? "235 ok\r\n" : "\(authCode) no\r\n" }
    if line.hasPrefix("MAIL FROM") { return "250 ok\r\n" }
    if line.hasPrefix("RCPT TO") { return "\(rcpt) ok\r\n" }
    if line == "DATA" { inData = true; return "354 go\r\n" }
    if line == "QUIT" { return "221 bye\r\n" }
    return "500 what\r\n"
  }
  b.fingerprint = fingerprint
  return b
}
do {
  let b = smtpServer()
  let id = try ProtonSmtp.send(b, config: cfg, reply: rep, id: "id1")
  check("smtp sends", id == "id1" && b.closed)
  check("smtp order", b.sent.firstIndex(of: "STARTTLS")! < b.sent.firstIndex(where: { $0.hasPrefix("AUTH PLAIN") })! && b.sent.contains("RCPT TO:<alex@client.example>") && b.sent.contains("MAIL FROM:<jane@example.com>"))
  check("smtp ends with one lone dot", b.sent.filter { $0 == "." }.count == 1)
  check("smtp auth is plain base64", b.sent.contains("AUTH PLAIN " + Data("\0jane@example.com\0bridge-pass".utf8).base64EncodedString()))
} catch { check("smtp sends", false, "\(error)") }
do { _ = try ProtonSmtp.send(smtpServer(authCode: 535), config: cfg, reply: rep); check("smtp wrong password", false) } catch let e as ProtonError { check("smtp wrong password", e == .badPassword) } catch { check("smtp wrong password", false) }
do { _ = try ProtonSmtp.send(smtpServer(rcpt: 550), config: cfg, reply: rep); check("smtp refused recipient", false) } catch let e as ProtonError { check("smtp refused recipient", e.code == "protocol") } catch { check("smtp refused recipient", false) }
do {
  var pinned = cfg; pinned.fingerprint = "aa11"
  let b = smtpServer(fingerprint: "ffff")
  _ = try ProtonSmtp.send(b, config: pinned, reply: rep)
  check("smtp changed cert", false)
} catch let e as ProtonError { check("smtp changed cert throws", e == .certChanged) } catch { check("smtp changed cert", false) }
do {
  var remote = cfg; remote.host = "smtp.example.com"
  let b = smtpServer()
  _ = try? ProtonSmtp.send(b, config: remote, reply: rep)
  check("smtp remote host: nothing sent", b.sent.isEmpty)
}
do {
  let b = smtpServer(); b.dead = true
  _ = try ProtonSmtp.send(b, config: cfg, reply: rep)
  check("smtp bridge down", false)
} catch let e as ProtonError { check("smtp bridge down", e == .bridgeDown || e == .timeout) } catch { check("smtp bridge down", false) }

check("dot stuffing", ProtonSmtp.stuff("a\r\n.b\r\n.\r\nc") == "a\r\n..b\r\n..\r\nc" && ProtonSmtp.stuff(".x") == "..x")

// ---------- Done list and schedule ----------
var dis = ProtonDismissed()
dis.add("h1"); dis.add("h1"); dis.add(String(repeating: "x", count: 60))
check("dismissed dedupes and refuses long keys", dis.keys == ["h1"])
for i in 0..<600 { dis.add("k\(i)") }
check("dismissed is capped, keeps newest", dis.keys.count == ProtonDismissed.cap && dis.keys.last == "k599")
let some = [ProtonRow(key: "h1", uid: 1, from: "a@client.example", fromName: nil, subject: "s", snippet: "", date: "2026-11-03T08:15:00Z", msgId: nil, refs: nil)]
check("filter drops dismissed", ProtonDismissed(keys: ["h1"]).filter(some).isEmpty && ProtonDismissed().filter(some).count == 1)
check("schedule: a minute when well", ProtonSchedule.next(after: nil, failures: 0) == 60)
check("schedule: backs off when Bridge is down", ProtonSchedule.next(after: .bridgeDown, failures: 1) == 120 && ProtonSchedule.next(after: .timeout, failures: 9) == 600)
check("schedule: stops for password and cert", ProtonSchedule.next(after: .badPassword, failures: 1) == 0 && ProtonSchedule.next(after: .certChanged, failures: 1) == 0)

print("\(count - fails)/\(count) passed")
exit(fails == 0 ? 0 : 1)
