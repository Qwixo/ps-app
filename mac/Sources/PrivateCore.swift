// Private mode for every pop up on the Mac (V1.57). A friend of the developer's (on V1.56): "In private mode, PS still shows the
// full cards with their sounds, covering the screen and showing what Claude finished." Private mode is settings.
// privateMode (the mask on the Tab list's Meetings panel, or Yes to "Start private mode?"), sent here by the main page
// ({type:"meetPrivacy"}, web src/meetwatch.ts). While it is on:
// - every card on the card stacks (Toast.swift: AI chats finished, mail, leads, meetings, the gym card, network, the
//   rest) is a small pill that says only "New notification" and "Private mode is on"; a click shows the real card;
// - every pop up with a window of its own (reminders, the update card, the restart helper card, meeting notes) waits
//   behind such a pill (PrivateHold.swift): a click on the pill, or private mode going off, brings it out;
// - no card makes a sound (Toast.chimeOther, the page's card sounds marked card:true, a reminder's own sound, the AFK
//   stretch card's sound).
// Not touched: alarms (Sleep mode alarms, Soundboard timed plays), the phone and its gym ring, the island itself.
// Foundation only: tests/private-test.sh builds this file on its own.
import Foundation

enum PrivateCore {
  /// The only words a pill ever shows.
  static let title = "New notification"
  static let sub = "Private mode is on"
  /// The card id of the pill a waiting pop up shows ("pv:" and the pop up's key, e.g. "pv:rem:abc").
  static func cardId(_ key: String) -> String { String(("pv:" + key).prefix(40)) }
  static func key(ofCard id: String) -> String? { id.hasPrefix("pv:") && id.count > 3 ? String(id.dropFirst(3)) : nil }
  /// A card's sound plays only while private mode is off. Alarms never ask.
  static func cardSound(privateOn: Bool) -> Bool { !privateOn }
}

/// Which pop ups with windows of their own are waiting behind a pill. Pure state; PrivateHold runs it.
struct PrivateHolds: Equatable {
  private(set) var on = false
  /// Waiting behind a pill, oldest first.
  private(set) var waiting: [String] = []
  /// Clicked out while private mode is on: shows as itself until it goes or private mode ends.
  private(set) var out: Set<String> = []

  /// The pop up wants to show. true: it waits behind a pill (a new pill when it was not waiting yet); false: it shows.
  mutating func wants(_ key: String) -> (wait: Bool, newPill: Bool) {
    guard on, !out.contains(key) else { return (false, false) }
    if waiting.contains(key) { return (true, false) }
    waiting.append(key)
    return (true, true)
  }
  /// Its pill was clicked. true: it was waiting, so it shows now.
  mutating func open(_ key: String) -> Bool {
    guard let i = waiting.firstIndex(of: key) else { return false }
    waiting.remove(at: i)
    out.insert(key)
    return true
  }
  /// The pop up went (answered, no longer due). true: it was waiting, so its pill goes too.
  mutating func gone(_ key: String) -> Bool {
    out.remove(key)
    guard let i = waiting.firstIndex(of: key) else { return false }
    waiting.remove(at: i)
    return true
  }
  /// Private mode on or off. Off: every waiting pop up comes out (returned, oldest first). On: nothing waits yet; the
  /// pop ups already up are asked again and go behind pills then.
  mutating func set(_ v: Bool) -> [String] {
    guard v != on else { return [] }
    on = v
    out = []
    if v { return [] }
    defer { waiting = [] }
    return waiting
  }
}
