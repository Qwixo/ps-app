import Foundation

// PS Do Not Disturb, the native half (the developer, 30 Oct 2026). The web page decides (web
// src/core/dnd.ts) and says what is muted right now as {type:"dnd", state:{on, until, mute}}
// (src/dnd.ts, main window only). This side holds what the Mac raises by itself: the pop-up cards
// (Toast.swift keeps a muted card and shows it when DND ends), card sounds (Sfx.swift), the 2 am follow
// up check (Reminders.swift) and the island's pop (Island.swift lights up instead). PS only: it never
// reads or changes macOS Focus or any system setting. VPN and leak alarms always come through.
// The last state is kept in defaults ("dnd.state", just on, until and which kinds), so a restart before
// the vault opens stays quiet; a self test copy never reads or writes it.
final class DND {
  static let shared = DND()
  private let lock = NSLock()
  private var on = false
  private var until: Date?
  private var mute: [String: Bool] = [:]
  private var endTimer: Timer?
  private let test = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  /// Called on the main thread whenever what is muted changes (on, off, a toggle, the end time passing).
  var onChange: [() -> Void] = []

  private init() {
    if !test, let d = UserDefaults.standard.dictionary(forKey: "dnd.state") { apply(d, save: false) }
  }

  /// Is it on right now (and its end time, if any, still ahead)?
  var active: Bool { lock.lock(); defer { lock.unlock() }; return activeLocked }
  private var activeLocked: Bool { on && (until.map { $0 > Date() } ?? true) }

  /// Is this distraction muted right now? Kinds as in src/core/dnd.ts: chats, mail, leads, meetings,
  /// gsquad (V1.43, used by the page only), island, sounds, vault, system, followup, phone.
  func mutes(_ kind: String) -> Bool { lock.lock(); defer { lock.unlock() }; return activeLocked && mute[kind] == true }

  /// Which kind a pop-up card is (the same rules as cardKind in src/core/dnd.ts). nil: never muted.
  static func kind(id: String, tone: String?) -> String? {
    if id.hasPrefix("m:") { return "mail" }
    if id.hasPrefix("c:") { return "chats" }
    if id.hasPrefix("n:") { return "leads" }
    if id == "private-ask" || tone == "notes" || id == "net-vpn" || id.hasPrefix("nl:") { return nil }
    if id.hasPrefix("eod") || id.hasPrefix("ar:") || id.hasPrefix("hp:") || id.hasPrefix("net-") { return "system" }
    if id.count > 2, id.hasPrefix("m"), ["a:", "b:", "d:", "m:", "s:"].contains(String(id.dropFirst().prefix(2))) { return "meetings" }
    return nil
  }

  /// The card sounds Do Not Disturb mutes (never the Tab list's own hover and click sounds).
  /// The note- ones are the notification sounds the developer can pick per kind (V1.36, Sfx.swift, src/core/notelook.ts).
  static let cardSounds: Set<String> = ["chime", "meet-booked", "meet-alert", "meet-soon", "note-harp", "note-ding", "note-marimba", "note-drop", "note-twinkle"]

  /// From the main window page (main thread).
  func fromPage(_ d: [String: Any]) { apply(d, save: !test) }

  /// Self test only: set a state straight away.
  func testSet(on: Bool, until: Date? = nil, mute: [String: Bool]) {
    var d: [String: Any] = ["on": on, "mute": mute]
    if let until { d["until"] = until.timeIntervalSince1970 * 1000 }
    apply(d, save: false)
  }

  private func apply(_ d: [String: Any], save: Bool) {
    let newOn = (d["on"] as? Bool) == true
    let ms = (d["until"] as? Double) ?? Double((d["until"] as? Int) ?? 0)
    let newUntil = ms > 0 ? Date(timeIntervalSince1970: ms / 1000) : nil
    var newMute: [String: Bool] = [:]
    for (k, v) in (d["mute"] as? [String: Any]) ?? [:] where k.count <= 16 { newMute[k] = (v as? Bool) == true }
    lock.lock()
    let changed = newOn != on || newUntil != until || newMute != mute
    on = newOn; until = newUntil; mute = newMute
    lock.unlock()
    if save { UserDefaults.standard.set(["on": newOn, "until": ms, "mute": newMute], forKey: "dnd.state") }
    endTimer?.invalidate(); endTimer = nil
    if let u = newUntil, newOn, u > Date() {
      let t = Timer(fire: u.addingTimeInterval(0.2), interval: 0, repeats: false) { [weak self] _ in self?.fire() }
      RunLoop.main.add(t, forMode: .common)
      endTimer = t
    }
    if changed { psLog("PS dnd: \(active ? "on" : "off")\(newUntil != nil && newOn ? " with an end time" : "")"); fire() }
  }
  private func fire() { onChange.forEach { $0() } }
}
