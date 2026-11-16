// Run through tests/proton-transport-test.sh. The real connection code (ProtonLoopback.swift) against a fake server on loopback.
// usage: proton-transport-test imap|smtp PORT PORT_OF_NOTHING
import Foundation
var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }
let a = CommandLine.arguments
let mode = a[1], port = Int(a[2])!, deadPort = Int(a[3])!
let cfg = ProtonConfig.make(host: "127.0.0.1", port: port, user: "jane@example.com", password: "bridge-pass")!

if mode == "imap" {
  var pin: String?
  do {
    let r = try ProtonImap.unread(try LoopbackTransport(host: "127.0.0.1", port: port, timeout: 10), config: cfg)
    pin = r.pinned
    check("real transport: STARTTLS, login, read", r.rows.count == 1 && r.rows[0].from == "alex@client.example" && r.rows[0].subject == "Fake plan" && r.rows[0].snippet == "Can we talk about the plan?")
    check("real transport: certificate fingerprint pinned (64 hex)", (r.pinned ?? "").count == 64)
  } catch { check("real transport read", false, "\(error)") }
  do {
    var same = cfg; same.fingerprint = pin
    let r = try ProtonImap.unread(try LoopbackTransport(host: "127.0.0.1", port: port, timeout: 10), config: same)
    check("pinned and unchanged: reads, no new pin", r.rows.count == 1 && r.pinned == nil)
  } catch { check("pinned read", false, "\(error)") }
  do {
    var other = cfg; other.fingerprint = String(repeating: "0", count: 64)
    _ = try ProtonImap.unread(try LoopbackTransport(host: "127.0.0.1", port: port, timeout: 10), config: other)
    check("a different pinned certificate stops it", false)
  } catch let e as ProtonError { check("a different pinned certificate stops it", e == .certChanged) } catch { check("cert changed", false, "\(error)") }
  do {
    var bad = cfg; bad.password = "wrong"
    _ = try ProtonImap.unread(try LoopbackTransport(host: "127.0.0.1", port: port, timeout: 10), config: bad)
    check("wrong password", false)
  } catch let e as ProtonError { check("wrong password says so", e == .badPassword) } catch { check("wrong password", false, "\(error)") }
} else {
  do {
    let r = ProtonReply.from(["to": "alex@client.example", "subject": "Fake plan", "text": "Tuesday works.", "inReplyTo": "fake1@client.example"])!
    let id = try ProtonSmtp.send(try LoopbackTransport(host: "127.0.0.1", port: port, timeout: 10), config: cfg, reply: r, id: "t1")
    check("real transport: SMTP reply goes", id == "t1")
  } catch { check("smtp", false, "\(error)") }
}
do { _ = try LoopbackTransport(host: "127.0.0.1", port: deadPort, timeout: 5); check("closed port", false) }
catch let e as ProtonError { check("nothing listening: Bridge is not running", e == .bridgeDown, "\(e)") } catch { check("closed port", false) }
for h in ["192.168.1.10", "example.com", "8.8.8.8", "127.0.0.1.example.com"] {
  do { _ = try LoopbackTransport(host: h, port: port, timeout: 2); check("refuses \(h)", false) }
  catch let e as ProtonError { check("refuses \(h) before any socket", e == .notLoopback) } catch { check("refuses \(h)", false) }
}
print("\(count - fails)/\(count) passed")
exit(fails == 0 ? 0 : 1)
