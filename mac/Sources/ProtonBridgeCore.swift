// Proton Mail through Proton Mail Bridge (PS 1.65), the parts with no AppKit, no Keychain and no sockets, so
// tests/proton-bridge-test.sh runs them with canned answers and a scripted fake connection. Nothing here contacts anything.
//
// Proton Mail Bridge is Proton's own Mac app. It runs a mail server ON THIS MAC (IMAP 127.0.0.1:1143, SMTP 127.0.0.1:1025,
// STARTTLS with its own self signed certificate) and has its own Bridge password (not the Proton login password).
// What this file guarantees:
//  - Only a loopback address is ever used (ProtonGuard). Anything else is refused before a socket is made.
//  - The Bridge certificate is pinned on the first link (its SHA-256 fingerprint) and checked BEFORE the password is sent.
//    A changed certificate stops everything and says so (ProtonError.certChanged).
//  - Reading never changes the mailbox: EXAMINE (read only) and BODY.PEEK, so nothing is marked read.
//  - Sending exists only as a function the Mac calls after the person's own click on Send (ProtonSmtp.send). It never retries.
import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

// MARK: - the loopback guard

enum ProtonGuard {
  /// The literal loopback address to connect to, or nil when the text is not clearly this Mac. No name lookup ever happens:
  /// "localhost" becomes 127.0.0.1 here, any other name, a number in another spelling (0x7f.1, 2130706433) or a longer
  /// address that only starts with 127 (127.0.0.1.example.com) is refused.
  static func loopback(_ raw: String) -> String? {
    let t = raw.trimmingCharacters(in: .whitespaces).lowercased()
    if t == "localhost" || t == "localhost." { return "127.0.0.1" }
    if t == "::1" || t == "[::1]" { return "::1" }
    let parts = t.split(separator: ".", omittingEmptySubsequences: false)
    guard parts.count == 4 else { return nil }
    var n: [Int] = []
    for p in parts {
      guard !p.isEmpty, p.count <= 3, p.allSatisfy({ $0 >= "0" && $0 <= "9" }), !(p.count > 1 && p.first == "0"), let v = Int(p), v <= 255 else { return nil }
      n.append(v)
    }
    return n[0] == 127 ? n.map(String.init).joined(separator: ".") : nil
  }
  static func validPort(_ p: Int) -> Bool { p >= 1 && p <= 65535 }
}

// MARK: - what is kept (in the Keychain only)

struct ProtonConfig: Codable, Equatable {
  var host: String            // a loopback literal
  var port: Int               // IMAP, 1143 by default
  var smtpPort: Int = 1025
  var user: String            // the address Bridge shows as its username
  var password: String        // the Bridge password, never anywhere else
  var fingerprint: String?    // SHA-256 of Bridge's certificate, pinned on the first link

  /// Checks what the page and the password window handed over. Nil when anything is off.
  static func make(host: String, port: Any?, user: String, password: String, smtpPort: Int = 1025) -> ProtonConfig? {
    guard let h = ProtonGuard.loopback(host) else { return nil }
    let p: Int
    if let n = port as? Int { p = n } else if let s = port as? String, let n = Int(s.trimmingCharacters(in: .whitespaces)) { p = n } else if let d = port as? Double, d == d.rounded() { p = Int(d) } else { return nil }
    let u = user.trimmingCharacters(in: .whitespacesAndNewlines)
    guard ProtonGuard.validPort(p), ProtonGuard.validPort(smtpPort), ProtonText.validEmail(u), !password.isEmpty, password.count <= 200,
          !password.unicodeScalars.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" }) else { return nil }
    return ProtonConfig(host: h, port: p, smtpPort: smtpPort, user: u.lowercased(), password: password, fingerprint: nil)
  }
}

// MARK: - errors, in the words the page shows

enum ProtonError: Error, Equatable {
  case notLoopback
  case bridgeDown            // nothing answers on that address and port (Bridge is not running)
  case badPassword           // Bridge said no to the username or password
  case certChanged           // Bridge's certificate is not the one pinned at the first link
  case protocolError(String)
  case timeout

  /// A short code the page turns into words (web core/protonmail.ts PROTON_WORDS). Never carries a password or an address.
  var code: String {
    switch self {
    case .notLoopback: return "notLoopback"
    case .bridgeDown: return "bridgeDown"
    case .badPassword: return "badPassword"
    case .certChanged: return "certChanged"
    case .protocolError: return "protocol"
    case .timeout: return "timeout"
    }
  }
}

enum ProtonPin {
  enum Decision: Equatable { case pin, ok, changed }
  /// First link: pin what was seen. After that: the same, or changed.
  static func decide(stored: String?, seen: String) -> Decision {
    guard let s = stored, !s.isEmpty else { return .pin }
    return s.lowercased() == seen.lowercased() ? .ok : .changed
  }
  /// The fingerprint of a certificate's DER bytes: lower case hex, SHA-256.
  static func fingerprint(_ der: Data) -> String {
    #if canImport(CryptoKit)
    return SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    #else
    return ""
    #endif
  }
}

// MARK: - the connection, as the logic sees it

/// One mail connection. The real one (ProtonBridge.swift) is a loopback socket with STARTTLS; tests script a fake.
protocol ProtonTransport: AnyObject {
  func send(_ data: Data) throws
  /// One line without its CRLF. Throws .timeout or .bridgeDown.
  func readLine() throws -> String
  func readBytes(_ n: Int) throws -> Data
  /// Starts TLS on this connection (after STARTTLS was accepted).
  func startTLS() throws
  /// SHA-256 of the certificate Bridge presented, after startTLS.
  func peerFingerprint() -> String?
  func close()
}

// MARK: - small text helpers

enum ProtonText {
  static func validEmail(_ s: String) -> Bool {
    s.count <= 254 && s.range(of: #"^[^\s@<>()\",;:\\]+@[^\s@<>()\",;:\\]+\.[^\s@<>()\",;:\\]+$"#, options: .regularExpression) != nil
  }
  /// One line: no line breaks, no tabs, trimmed (a header can never be split into two).
  static func oneLine(_ s: String) -> String {
    s.replacingOccurrences(of: "[\\r\\n\\t]+", with: " ", options: .regularExpression).replacingOccurrences(of: "\u{0}", with: "").trimmingCharacters(in: .whitespaces)
  }
  /// An IMAP quoted string: backslash and quote escaped. Line breaks make it invalid (nil).
  static func imapQuote(_ s: String) -> String? {
    if s.unicodeScalars.contains(where: { $0 == "\r" || $0 == "\n" || $0 == "\0" }) { return nil }
    return "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
  }
  static func collapse(_ s: String) -> String {
    s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
  }

  // RFC 2047 words: =?utf-8?B?...?= and =?utf-8?Q?...?=
  static func decodeWords(_ s: String) -> String {
    guard s.contains("=?") else { return s }
    guard let re = try? NSRegularExpression(pattern: #"=\?([A-Za-z0-9_\-]+)\?([BbQq])\?([^?]*)\?="#) else { return s }
    let ns = s as NSString
    var out = "", last = 0, prevWasWord = false
    for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
      let between = ns.substring(with: NSRange(location: last, length: m.range.location - last))
      // White space between two encoded words is not shown (RFC 2047 6.2).
      if !(prevWasWord && between.trimmingCharacters(in: .whitespaces).isEmpty) { out += between }
      let cs = ns.substring(with: m.range(at: 1)).lowercased(), enc = ns.substring(with: m.range(at: 2)).lowercased(), body = ns.substring(with: m.range(at: 3))
      var data: Data?
      if enc == "b" { data = Data(base64Encoded: body.padding(toLength: (body.count + 3) / 4 * 4, withPad: "=", startingAt: 0)) }
      else { data = qpData(body.replacingOccurrences(of: "_", with: " "), header: true) }
      out += data.map { decode($0, charset: cs) } ?? ns.substring(with: m.range)
      last = m.range.location + m.range.length
      prevWasWord = true
    }
    out += ns.substring(from: last)
    return out
  }
  static func decode(_ d: Data, charset: String) -> String {
    let c = charset.lowercased()
    if c == "iso-8859-1" || c == "latin1" || c == "us-ascii" && String(data: d, encoding: .utf8) == nil { return String(data: d, encoding: .isoLatin1) ?? "" }
    if c == "windows-1252" || c == "cp1252" { return String(data: d, encoding: .windowsCP1252) ?? String(decoding: d, as: UTF8.self) }
    if c == "iso-8859-2" { return String(data: d, encoding: .isoLatin2) ?? String(decoding: d, as: UTF8.self) }
    return String(decoding: d, as: UTF8.self)
  }
  /// Quoted printable to bytes. `header`: "_" was already turned into a space by the caller.
  static func qpData(_ s: String, header: Bool = false) -> Data {
    var out = Data(), b = Array(s.utf8), i = 0
    func hex(_ c: UInt8) -> UInt8? { switch c { case 48...57: return c - 48; case 65...70: return c - 55; case 97...102: return c - 87; default: return nil } }
    while i < b.count {
      if b[i] == 61 {   // =
        if i + 1 < b.count, b[i + 1] == 13 || b[i + 1] == 10 { i += 2; if i < b.count, b[i - 1] == 13, b[i] == 10 { i += 1 }; continue }   // soft line break
        if i + 2 < b.count, let h = hex(b[i + 1]), let l = hex(b[i + 2]) { out.append(h << 4 | l); i += 3; continue }
      }
      out.append(b[i]); i += 1
    }
    return out
  }
}

// MARK: - one email as the panel shows it

struct ProtonRow: Equatable {
  var key: String          // stable id of this email on this Mac (a hash of its Message-ID, else uid), at most 24 characters
  var uid: Int
  var from: String         // the address
  var fromName: String?
  var subject: String
  var snippet: String
  var date: String         // ISO 8601, UTC
  var msgId: String?       // for the reply's In-Reply-To
  var refs: String?        // its References header, for the reply

  /// What goes to the page (checked again there, web core/protonmail.ts cleanProtonRows).
  var json: [String: Any] {
    var o: [String: Any] = ["key": key, "from": from, "subject": subject, "snippet": snippet, "date": date]
    if let fromName { o["fromName"] = fromName }
    return o
  }
}

// MARK: - parsing

enum ProtonParse {
  /// "Alex Morgan <alex@example.com>" or a bare address.
  static func address(_ header: String) -> (name: String?, email: String?) {
    let h = ProtonText.decodeWords(ProtonText.oneLine(header))
    if let re = try? NSRegularExpression(pattern: #"^\s*(?:"?([^"<]*?)"?\s*)?<\s*([^<>\s]+@[^<>\s]+)\s*>"#), let m = re.firstMatch(in: h, range: NSRange(location: 0, length: (h as NSString).length)) {
      let ns = h as NSString
      let name = m.range(at: 1).location != NSNotFound ? ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces) : ""
      return (name.isEmpty ? nil : name, ns.substring(with: m.range(at: 2)).lowercased())
    }
    if let r = h.range(of: #"[^\s<>",;]+@[^\s<>",;]+"#, options: .regularExpression) { return (nil, String(h[r]).lowercased()) }
    return (nil, nil)
  }

  /// Headers as a lower case name to value map (folded lines joined). A repeated name keeps the first.
  static func headers(_ text: String) -> [String: String] {
    var out: [String: String] = [:], cur: String?, val = ""
    func flush() { if let c = cur, out[c] == nil { out[c] = ProtonText.collapse(val) }; cur = nil; val = "" }
    for raw in text.components(separatedBy: "\n") {
      let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
      if line.isEmpty { break }
      if line.first == " " || line.first == "\t" { val += " " + line; continue }
      flush()
      if let i = line.firstIndex(of: ":") { cur = String(line[..<i]).lowercased(); val = String(line[line.index(after: i)...]) }
    }
    flush()
    return out
  }

  /// RFC 5322 date to ISO 8601 UTC ("Tue, 3 Nov 2026 09:15:00 +0100"). Nil when it cannot be read.
  static func date(_ s: String) -> String? {
    var t = s.replacingOccurrences(of: #"\s*\([^)]*\)\s*$"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    if let r = t.range(of: #"^[A-Za-z]{3},\s*"#, options: .regularExpression) { t.removeSubrange(r) }
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    for fmt in ["d MMM yyyy HH:mm:ss Z", "d MMM yyyy HH:mm Z", "d MMM yyyy HH:mm:ss zzz", "d MMM yy HH:mm:ss Z"] {
      f.dateFormat = fmt
      if let d = f.date(from: t) {
        let o = ISO8601DateFormatter(); o.formatOptions = [.withInternetDateTime]
        return o.string(from: d)
      }
    }
    return nil
  }

  /// The readable start of an email body: text/plain (decoded) of a simple message or the first text/plain part, tags
  /// stripped from html as a last resort, quoted lines and signature cut, at most `max` characters.
  static func snippet(headers h: [String: String], body raw: Data, max: Int = 300) -> String {
    let ctype = (h["content-type"] ?? "text/plain").lowercased()
    let text = String(decoding: raw, as: UTF8.self)
    var part = text, enc = (h["content-transfer-encoding"] ?? "").lowercased(), type = ctype
    if ctype.hasPrefix("multipart/"), let b = ctype.range(of: #"boundary="?([^";\s]+)"?"#, options: .regularExpression) {
      let boundary = String(ctype[b]).replacingOccurrences(of: "boundary=", with: "").replacingOccurrences(of: "\"", with: "")
      // The boundary was lower cased with the header: find it in the body case insensitively.
      let marker = "--" + boundary
      var best: (type: String, enc: String, body: String)?
      var segs: [[String]] = []
      for line in text.components(separatedBy: "\n") {
        let l = line.hasSuffix("\r") ? String(line.dropLast()) : line
        if l.lowercased().hasPrefix(marker) { segs.append([]) } else if !segs.isEmpty { segs[segs.count - 1].append(l) }
      }
      for seg in segs {
        let joined = seg.joined(separator: "\n")
        guard let split = joined.range(of: "\n\n") ?? (joined.hasPrefix("\n") ? joined.startIndex..<joined.index(after: joined.startIndex) : nil) else { continue }
        let ph = headers(String(joined[..<split.lowerBound]) + "\n")
        let pt = (ph["content-type"] ?? "text/plain").lowercased()
        let pb = String(joined[split.upperBound...])
        if pt.hasPrefix("text/plain") { best = (pt, (ph["content-transfer-encoding"] ?? "").lowercased(), pb); break }
        if pt.hasPrefix("text/html"), best == nil { best = (pt, (ph["content-transfer-encoding"] ?? "").lowercased(), pb) }
      }
      guard let b2 = best else { return "" }
      part = b2.body; enc = b2.enc; type = b2.type
    }
    var data = Data(part.utf8)
    if enc == "base64" { data = Data(base64Encoded: part.filter { !$0.isWhitespace }.padding(toLength: ((part.filter { !$0.isWhitespace }.count + 3) / 4) * 4, withPad: "=", startingAt: 0)) ?? data }
    else if enc == "quoted-printable" { data = ProtonText.qpData(part) }
    var charset = "utf-8"
    if let r = type.range(of: #"charset="?([A-Za-z0-9_\-]+)"?"#, options: .regularExpression) { charset = String(type[r]).replacingOccurrences(of: "charset=", with: "").replacingOccurrences(of: "\"", with: "") }
    var s = ProtonText.decode(data, charset: charset)
    if type.hasPrefix("text/html") {
      s = s.replacingOccurrences(of: "<(style|script)[^>]*>[\\s\\S]*?</\\1>", with: " ", options: [.regularExpression, .caseInsensitive])
        .replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        .replacingOccurrences(of: "&nbsp;", with: " ").replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&lt;", with: "<").replacingOccurrences(of: "&gt;", with: ">")
    }
    // Quoted lines (> ...) and everything after a signature mark or an "On ... wrote:" line.
    var keep: [String] = []
    for line in s.components(separatedBy: "\n") {
      let l = line.trimmingCharacters(in: .whitespacesAndNewlines)
      if l == "--" || l == "-- " || l.range(of: #"^On .{5,120} wrote:$"#, options: .regularExpression) != nil { break }
      if l.hasPrefix(">") { continue }
      keep.append(l)
    }
    let out = ProtonText.collapse(keep.joined(separator: " "))
    return out.count <= max ? out : String(out.prefix(max)).trimmingCharacters(in: .whitespaces) + "..."
  }

  /// A short stable key for one email: its Message-ID hashed, else the uid.
  static func key(msgId: String?, uid: Int) -> String {
    let base = (msgId ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "<> ")).lowercased()
    if base.isEmpty { return "u\(uid)" }
    #if canImport(CryptoKit)
    return "h" + SHA256.hash(data: Data(base.utf8)).prefix(10).map { String(format: "%02x", $0) }.joined()
    #else
    return "u\(uid)"
    #endif
  }

  // ---- the IMAP FETCH answer ----

  struct Fetched { var uid: Int; var header: String; var body: Data }

  /// Reads "* n FETCH (UID 7 BODY[HEADER.FIELDS (...)] {120}\r\n...120 bytes... BODY[TEXT]<0> {88}\r\n...)" answers out of the raw
  /// bytes the server sent. Literals are read by their size, so a body that looks like a protocol line cannot confuse it.
  static func fetches(_ raw: Data) -> [Fetched] {
    let b = [UInt8](raw)
    var i = 0, out: [Fetched] = []
    func skipSpace() { while i < b.count, b[i] == 32 { i += 1 } }
    func lineEnd() -> Int { var j = i; while j < b.count, b[j] != 10 { j += 1 }; return j }
    while i < b.count {
      // Find the next untagged FETCH line start.
      guard b[i] == 42 else { i = lineEnd() + 1; continue }   // *
      let eol = lineEnd()
      let head = String(decoding: b[i..<min(eol, b.count)], as: UTF8.self)
      guard head.range(of: #"^\* \d+ FETCH \("#, options: .regularExpression) != nil, let open = head.firstIndex(of: "(") else { i = eol + 1; continue }
      i += head.distance(from: head.startIndex, to: open) + 1
      var f = Fetched(uid: 0, header: "", body: Data())
      var depth = 1
      while i < b.count, depth > 0 {
        skipSpace()
        if i >= b.count { break }
        let c = b[i]
        if c == 13 || c == 10 { i += 1; continue }
        if c == 41 { depth -= 1; i += 1; continue }
        if c == 40 { depth += 1; i += 1; continue }
        // a key: letters, digits, dots, brackets (with spaces and parens inside), "<0>"
        var j = i
        while j < b.count, b[j] != 32, b[j] != 13, b[j] != 10, b[j] != 41, b[j] != 40 {
          if b[j] == 91 { while j < b.count, b[j] != 93 { j += 1 } }   // [ ... ]
          j += 1
        }
        var key = String(decoding: b[i..<min(j, b.count)], as: UTF8.self).uppercased()
        i = j
        // a "<0>" origin may follow the bracket key
        if key.hasSuffix("]"), i < b.count, b[i] == 60 { var k = i; while k < b.count, b[k] != 62 { k += 1 }; i = min(k + 1, b.count) }
        skipSpace()
        if key.hasPrefix("UID") && !key.contains("[") {
          var k = i; while k < b.count, b[k] >= 48, b[k] <= 57 { k += 1 }
          f.uid = Int(String(decoding: b[i..<k], as: UTF8.self)) ?? 0; i = k; continue
        }
        // a value: literal {n}, quoted string, NIL, or a number/atom
        if i < b.count, b[i] == 123 {
          var k = i + 1; while k < b.count, b[k] != 125 { k += 1 }
          let n = Int(String(decoding: b[(i + 1)..<min(k, b.count)], as: UTF8.self)) ?? 0
          i = k + 1
          if i < b.count, b[i] == 13 { i += 1 }
          if i < b.count, b[i] == 10 { i += 1 }
          let end = min(i + max(0, n), b.count)
          let chunk = Data(b[i..<end]); i = end
          if key.hasPrefix("BODY[HEADER") || key.hasPrefix("BODY.PEEK[HEADER") { f.header = String(decoding: chunk, as: UTF8.self) }
          else if key.hasPrefix("BODY[TEXT") || key.hasPrefix("BODY.PEEK[TEXT") { f.body = chunk }
        } else if i < b.count, b[i] == 34 {
          var k = i + 1; while k < b.count, b[k] != 34 { if b[k] == 92 { k += 1 }; k += 1 }
          let chunk = Data(b[(i + 1)..<min(k, b.count)]); i = min(k + 1, b.count)
          if key.hasPrefix("BODY[HEADER") { f.header = String(decoding: chunk, as: UTF8.self) } else if key.hasPrefix("BODY[TEXT") { f.body = chunk }
        } else {
          var k = i; while k < b.count, b[k] != 32, b[k] != 13, b[k] != 10, b[k] != 41 { k += 1 }
          i = k
        }
        key = ""
      }
      if f.uid > 0 { out.append(f) }
    }
    return out
  }

  /// The UIDs in a "* SEARCH 4 9 12" answer.
  static func searchUids(_ lines: [String]) -> [Int] {
    var out: [Int] = []
    for l in lines where l.hasPrefix("* SEARCH") { out += l.dropFirst(8).split(separator: " ").compactMap { Int($0) } }
    return out
  }

  static func row(_ f: Fetched, now: Date = Date()) -> ProtonRow? {
    let h = headers(f.header)
    let from = address(h["from"] ?? "")
    guard let email = from.email, ProtonText.validEmail(email) else { return nil }
    let msgId = h["message-id"].map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "<> ")) }.flatMap { $0.isEmpty ? nil : $0 }
    let iso = h["date"].flatMap { date($0) } ?? ISO8601DateFormatter().string(from: now)
    let subj = ProtonText.collapse(ProtonText.decodeWords(h["subject"] ?? ""))
    return ProtonRow(key: key(msgId: msgId, uid: f.uid), uid: f.uid, from: email, fromName: from.name.map { ProtonText.collapse($0) }.flatMap { $0.isEmpty ? nil : String($0.prefix(120)) },
                     subject: String((subj.isEmpty ? "(no subject)" : subj).prefix(300)), snippet: snippet(headers: h, body: f.body),
                     date: iso, msgId: msgId, refs: h["references"])
  }
}

// MARK: - IMAP: read the unread mail

enum ProtonImap {
  struct Result { var rows: [ProtonRow]; var pinned: String? }   // pinned: a fingerprint to store (first link only)

  /// Everything one check does, in order: greeting, STARTTLS, the certificate check, LOGIN, EXAMINE INBOX (read only), the newest
  /// unread, their headers and the start of their text (BODY.PEEK: nothing is marked read), LOGOUT.
  static func unread(_ t: ProtonTransport, config c: ProtonConfig, limit: Int = 30) throws -> Result {
    defer { t.close() }
    guard ProtonGuard.loopback(c.host) != nil else { throw ProtonError.notLoopback }
    var n = 0
    func command(_ text: String) throws -> (lines: [String], raw: Data, status: String) {
      n += 1
      let tag = "a\(n)"
      try t.send(Data("\(tag) \(text)\r\n".utf8))
      var lines: [String] = [], raw = Data()
      while true {
        var line = try t.readLine()
        raw.append(Data((line + "\r\n").utf8))
        // A literal: {n} at the end of a line, then n bytes, then the rest of the line.
        while let r = line.range(of: #"\{(\d+)\}$"#, options: .regularExpression), let size = Int(line[r].dropFirst().dropLast()), size <= 4_000_000 {
          raw.append(try t.readBytes(size))
          line = try t.readLine()
          raw.append(Data((line + "\r\n").utf8))
        }
        if line.hasPrefix(tag + " ") { return (lines, raw, String(line.dropFirst(tag.count + 1))) }
        lines.append(line)
      }
    }
    let greeting = try t.readLine()
    guard greeting.hasPrefix("* OK") || greeting.hasPrefix("* PREAUTH") else { throw ProtonError.protocolError("greeting") }
    let st = try command("STARTTLS")
    guard st.status.hasPrefix("OK") else { throw ProtonError.protocolError("starttls") }
    try t.startTLS()
    // A harmless first command finishes the TLS handshake (nothing secret in it); only then is the certificate known.
    _ = try command("CAPABILITY")
    guard let seen = t.peerFingerprint() else { throw ProtonError.certChanged }
    var pinned: String?
    switch ProtonPin.decide(stored: c.fingerprint, seen: seen) {
    case .changed: throw ProtonError.certChanged        // before any password leaves
    case .pin: pinned = seen
    case .ok: break
    }
    guard let u = ProtonText.imapQuote(c.user), let p = ProtonText.imapQuote(c.password) else { throw ProtonError.badPassword }
    let login = try command("LOGIN \(u) \(p)")
    guard login.status.hasPrefix("OK") else { throw ProtonError.badPassword }
    let ex = try command("EXAMINE INBOX")
    guard ex.status.hasPrefix("OK") else { throw ProtonError.protocolError("inbox") }
    let se = try command("UID SEARCH UNSEEN")
    guard se.status.hasPrefix("OK") else { throw ProtonError.protocolError("search") }
    let uids = Array(ProtonParse.searchUids(se.lines).sorted().suffix(max(1, min(limit, 100))))
    var rows: [ProtonRow] = []
    if !uids.isEmpty {
      let set = uids.map(String.init).joined(separator: ",")
      let f = try command("UID FETCH \(set) (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID REFERENCES CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.4000>)")
      guard f.status.hasPrefix("OK") else { throw ProtonError.protocolError("fetch") }
      rows = ProtonParse.fetches(f.raw).compactMap { ProtonParse.row($0) }
    }
    _ = try? command("LOGOUT")
    return Result(rows: rows.sorted { $0.date > $1.date }, pinned: pinned)
  }
}

// MARK: - SMTP: one reply, only after the person's own click

struct ProtonReply: Equatable {
  var to: String
  var subject: String
  var text: String
  var inReplyTo: String?
  var references: String?

  /// Checks what the page handed over after the person pressed Send. Nil when anything is off.
  static func from(_ o: [String: Any]) -> ProtonReply? {
    guard let to = (o["to"] as? String)?.trimmingCharacters(in: .whitespaces).lowercased(), ProtonText.validEmail(to),
          let text = o["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.count <= 60_000 else { return nil }
    let subj = ProtonText.oneLine((o["subject"] as? String) ?? "")
    func id(_ k: String) -> String? { (o[k] as? String).map { ProtonText.oneLine($0).trimmingCharacters(in: CharacterSet(charactersIn: "<> ")) }.flatMap { $0.isEmpty || $0.contains(" ") || $0.count > 200 ? nil : $0 } }
    return ProtonReply(to: to, subject: String(subj.prefix(300)), text: text, inReplyTo: id("inReplyTo"), references: (o["references"] as? String).map { ProtonText.oneLine($0) }.map { String($0.prefix(900)) })
  }
  var replySubject: String { subject.lowercased().hasPrefix("re:") ? subject : "Re: \(subject.isEmpty ? "(no subject)" : subject)" }

  /// The message as sent: headers (a non ASCII subject as an encoded word), a base64 UTF-8 body, lines of 76 characters.
  func message(from: String, date: Date = Date(), id: String) -> String {
    let df = DateFormatter(); df.locale = Locale(identifier: "en_US_POSIX"); df.dateFormat = "EEE, d MMM yyyy HH:mm:ss Z"
    func enc(_ s: String) -> String { s.utf8.allSatisfy({ $0 < 128 }) ? s : "=?UTF-8?B?" + Data(s.utf8).base64EncodedString() + "?=" }
    var h = ["From: \(from)", "To: \(to)", "Subject: \(enc(replySubject))", "Date: \(df.string(from: date))", "Message-ID: <\(id)@ps.local>", "MIME-Version: 1.0",
             "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"]
    if let r = inReplyTo { h.append("In-Reply-To: <\(r)>"); h.append("References: " + [references, "<\(r)>"].compactMap { $0 }.joined(separator: " ")) }
    let b64 = Data(text.utf8).base64EncodedString(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed])
    return h.joined(separator: "\r\n") + "\r\n\r\n" + b64 + "\r\n"
  }
}

enum ProtonSmtp {
  /// Dot stuffing: a line that starts with "." gets a second one, so the lone "." that ends the message stays unique.
  static func stuff(_ body: String) -> String {
    let b = body.hasPrefix(".") ? "." + body : body
    return b.replacingOccurrences(of: "\r\n.", with: "\r\n..")
  }
  /// Sends one reply through Bridge's SMTP on this Mac. Never retried here: a send that may have gone is for the person to check.
  static func send(_ t: ProtonTransport, config c: ProtonConfig, reply r: ProtonReply, id: String = UUID().uuidString.lowercased()) throws -> String? {
    defer { t.close() }
    guard ProtonGuard.loopback(c.host) != nil else { throw ProtonError.notLoopback }
    func answer() throws -> (code: Int, text: String) {   // a full (possibly multi line) answer
      var code = 0, text = ""
      while true {
        let l = try t.readLine()
        guard l.count >= 3, let n = Int(l.prefix(3)) else { throw ProtonError.protocolError("smtp") }
        code = n; text += l.dropFirst(4) + "\n"
        if l.count == 3 || l[l.index(l.startIndex, offsetBy: 3)] != "-" { return (code, text) }
      }
    }
    func say(_ s: String) throws { try t.send(Data((s + "\r\n").utf8)) }
    guard try answer().code == 220 else { throw ProtonError.protocolError("smtp greeting") }
    try say("EHLO ps.local"); guard try answer().code == 250 else { throw ProtonError.protocolError("ehlo") }
    try say("STARTTLS"); guard try answer().code == 220 else { throw ProtonError.protocolError("starttls") }
    try t.startTLS()
    try say("EHLO ps.local"); guard try answer().code == 250 else { throw ProtonError.protocolError("ehlo") }   // finishes the handshake, nothing secret in it
    guard let seen = t.peerFingerprint() else { throw ProtonError.certChanged }
    guard ProtonPin.decide(stored: c.fingerprint, seen: seen) != .changed else { throw ProtonError.certChanged }
    let auth = Data(("\0" + c.user + "\0" + c.password).utf8).base64EncodedString()
    try say("AUTH PLAIN " + auth)
    let a = try answer()
    guard a.code == 235 else { throw a.code == 535 || a.code == 534 || a.code == 454 ? ProtonError.badPassword : ProtonError.protocolError("auth") }
    try say("MAIL FROM:<\(c.user)>"); guard try answer().code == 250 else { throw ProtonError.protocolError("mail from") }
    try say("RCPT TO:<\(r.to)>"); let rc = try answer(); guard rc.code == 250 || rc.code == 251 else { throw ProtonError.protocolError("recipient") }
    try say("DATA"); guard try answer().code == 354 else { throw ProtonError.protocolError("data") }
    let body = r.message(from: c.user, id: id)
    // Dot stuffing: a line that starts with "." gets a second one.
    let stuffed = stuff(body)
    try t.send(Data((stuffed + (stuffed.hasSuffix("\r\n") ? "" : "\r\n") + ".\r\n").utf8))
    guard try answer().code == 250 else { throw ProtonError.protocolError("not accepted") }
    _ = try? say("QUIT")
    return id
  }
}

// MARK: - the person's "Done" list (a message's key, kept on this Mac only)

struct ProtonDismissed: Codable, Equatable {
  var keys: [String] = []
  static let cap = 500
  mutating func add(_ k: String) {
    guard k.count <= 40, !keys.contains(k) else { return }
    keys.append(k)
    if keys.count > Self.cap { keys.removeFirst(keys.count - Self.cap) }
  }
  func filter(_ rows: [ProtonRow]) -> [ProtonRow] { rows.filter { !keys.contains($0.key) } }
}

// MARK: - how often to look

enum ProtonSchedule {
  /// Seconds until the next check: a minute while all is well (the panel's own pace), longer while Bridge is down or the
  /// password or certificate is wrong (asking again every minute cannot fix those), and never while the page says stop.
  static func next(after failure: ProtonError?, failures: Int) -> TimeInterval {
    guard let f = failure else { return 60 }
    switch f {
    case .badPassword, .certChanged, .notLoopback: return 0   // 0: stop until the person acts
    default: return min(600, 60 * Double(1 << min(failures, 4)))
    }
  }
}
