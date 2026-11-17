// Audio priority (PS 1.65, the developer's friend, 17 Nov 2026): "We want to select the ORDER in which we want to use the
// microphones, and same for speakers. These settings get saved and remain like that forever."
//
// The pure part, no Core Audio and no clock of its own, so tests/audiopriority-test.swift checks every rule:
// - Two ordered lists, Speakers and Microphones, of every device this Mac has ever seen, kept by Core Audio's stable
//   device id (its UID), never by name. A device that is both (AirPods, a USB headset) is in both lists.
// - A device seen for the first time goes into a sensible place (placement below), then the person's order rules.
// - The highest connected device in each list is the one PS makes the Mac's default, each list on its own.
// - THE MANUAL CHANGE RULE (decide below): a default the person picks in macOS (the sound menu, System Settings, an
//   app) is never fought. PS does nothing at all for 60 seconds after such a pick, and after that it only moves away
//   from it when a device ranked ABOVE the pick connects. When the picked device goes away, the order rules again.
//   A change counts as the person's when PS did not make it and no device connected or went away in the same moment
//   (macOS moving the sound onto headphones that just connected, or off a device that just left, is not a pick).
// - Calls: while an app is using the microphone, PS waits and switches when it is done, unless the person asks in
//   PS (a new order, or a click on a device). An app that keeps the microphone open for more than 3 hours is not a call.
// - A virtual or combined device the person made the default (BlackHole, a Multi-Output device) is always left alone.
import Foundation

enum APSide: String, CaseIterable { case speakers, mics }

/// What kind of device, from Core Audio's transport type. Decides where a first seen device goes and its icon.
enum APKind: String, Codable, CaseIterable {
  case builtIn, jack, bluetooth, usb, display, airplay, phone, other
}

/// One device as Core Audio reports it right now (real devices only: no virtual or combined ones).
struct APDevice: Equatable {
  let uid: String
  let name: String
  let kind: APKind
  let alive: Bool
}

/// One remembered device in a list.
struct APEntry: Codable, Equatable {
  var uid: String
  var name: String
  var kind: APKind
  /// When it was last connected, seconds since 1970 (0: not seen yet, for example moved over from Headphones mode).
  var seen: Double
  init(uid: String, name: String, kind: APKind, seen: Double) { self.uid = uid; self.name = name; self.kind = kind; self.seen = seen }
  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    uid = try c.decode(String.self, forKey: .uid)
    name = (try? c.decode(String.self, forKey: .name)) ?? ""
    kind = (try? c.decode(APKind.self, forKey: .kind)) ?? .other        // a kind a newer PS added reads as other
    seen = (try? c.decode(Double.self, forKey: .seen)) ?? 0
  }
}

/// Both lists, saved on this Mac (UserDefaults "audio.priority"), so they survive every update.
struct APLists: Codable, Equatable {
  var speakers: [APEntry] = []
  var mics: [APEntry] = []
  init() {}
  init(speakers: [APEntry], mics: [APEntry]) { self.speakers = speakers; self.mics = mics }
  /// Tolerant: a bad entry is dropped, never the whole list; repeats keep the first; the cap holds.
  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    func list(_ k: CodingKeys) -> [APEntry] {
      guard var u = try? c.nestedUnkeyedContainer(forKey: k) else { return [] }
      var out: [APEntry] = []
      while !u.isAtEnd {
        if let e = try? u.decode(APEntry.self), APCore.okUID(e.uid), !out.contains(where: { $0.uid == e.uid }) { out.append(e) }
        else { _ = try? u.decode(Skip.self) }
      }
      return Array(out.prefix(APCore.cap))
    }
    speakers = list(.speakers); mics = list(.mics)
  }
  private struct Skip: Decodable {}
  subscript(side: APSide) -> [APEntry] {
    get { side == .speakers ? speakers : mics }
    set { if side == .speakers { speakers = newValue } else { mics = newValue } }
  }
}

/// The person's own pick of a default (in macOS, or a click on a device in PS), per list.
struct APHold: Equatable { var uid: String; var at: Double }

/// Why PS looks again.
enum APWhy: Equatable { case launch, wake, devices, order, callEnded }

/// What PS does for one list.
enum APDecision: Equatable {
  case stay(String)        // why nothing happens, in plain words for the log
  case wait                // a call is on: switch when it ends
  case set(String)         // make this device the default
}

/// Who changed the Mac's default.
enum APWho: Equatable { case ps, system, person }

enum APCore {
  static let cap = 40                    // devices per list; the oldest not connected go first beyond it
  static let sameMinute: Double = 60     // never fight a pick the person made this long ago or less
  static let longCall: Double = 3 * 3600 // a microphone open longer than this is an app that always listens, not a call

  static func okUID(_ u: String) -> Bool { !u.isEmpty && u.count <= 300 }

  /// Where a device seen for the first time goes. Higher goes higher. Speakers: headphones and speakers you plug in
  /// beat a display's speakers, which beat the Mac's own; AirPlay (a TV, a speaker in another room) goes last.
  /// Microphones: a USB or jack microphone beats the display's, which beats the Mac's own; Bluetooth microphones
  /// (AirPods) go below the Mac's own, because using them turns the headphones' sound into phone call quality; an
  /// iPhone's microphone goes last.
  static func placementScore(_ k: APKind, _ side: APSide) -> Int {
    switch side {
    case .speakers:
      switch k { case .bluetooth, .jack: return 50; case .usb: return 40; case .display: return 20; case .other: return 15; case .builtIn: return 10; case .airplay: return 5; case .phone: return 0 }
    case .mics:
      switch k { case .usb: return 50; case .jack: return 40; case .display: return 35; case .builtIn: return 30; case .other: return 20; case .bluetooth: return 10; case .phone: return 5; case .airplay: return 0 }
    }
  }

  /// Put a first seen device into a list: just above the first remembered device with a lower placement score, so
  /// the person's own order is kept and new headphones land above the Mac's speakers (as macOS itself would switch).
  static func insert(_ e: APEntry, into list: [APEntry], side: APSide) -> [APEntry] {
    var l = list
    let s = placementScore(e.kind, side)
    let i = l.firstIndex { placementScore($0.kind, side) < s } ?? l.count
    l.insert(e, at: i)
    return l
  }

  /// The list after Core Audio reported these devices: known ones get their newest name and kind (and seen time when
  /// connected), a device whose id changed (the same USB microphone in another port) takes its old place, new ones
  /// are placed. 1Password and Signal never get in (`protected`).
  static func merge(_ list: [APEntry], _ devs: [APDevice], side: APSide, now: Double, protected: (String) -> Bool) -> [APEntry] {
    var l = list.filter { !protected($0.name) && !protected($0.uid) }
    let present = Set(devs.map(\.uid))
    for d in devs where okUID(d.uid) && !protected(d.name) && !protected(d.uid) {
      if let i = l.firstIndex(where: { $0.uid == d.uid }) {
        if !d.name.isEmpty { l[i].name = String(d.name.prefix(100)) }
        if d.kind != .other || l[i].kind == .other { l[i].kind = d.kind }
        if d.alive { l[i].seen = now }
        continue
      }
      // Same name and kind, not connected now, and the only such one: the same device with a new id.
      let same = l.indices.filter { l[$0].kind == d.kind && !present.contains(l[$0].uid) && !d.name.isEmpty && l[$0].name.caseInsensitiveCompare(d.name) == .orderedSame }
      if same.count == 1, !devs.contains(where: { $0.uid != d.uid && $0.name.caseInsensitiveCompare(d.name) == .orderedSame }) {
        let i = same[0]
        l[i].uid = d.uid; l[i].name = String(d.name.prefix(100)); if d.alive { l[i].seen = now }
        continue
      }
      l = insert(APEntry(uid: d.uid, name: String(d.name.prefix(100)), kind: d.kind, seen: d.alive ? now : 0), into: l, side: side)
    }
    // Over the cap: the ones not connected that were seen longest ago go first.
    while l.count > cap {
      guard let i = l.indices.filter({ !present.contains(l[$0].uid) }).min(by: { l[$0].seen < l[$1].seen }) else { break }
      l.remove(at: i)
    }
    return l
  }

  /// The person's new order from the page: the ids it names first (known ones only, each once), then any it did not
  /// name in their old order (a device that arrived while they were dragging is never lost).
  static func reorder(_ list: [APEntry], _ order: [String]) -> [APEntry] {
    var out: [APEntry] = []
    for u in order { if let e = list.first(where: { $0.uid == u }), !out.contains(where: { $0.uid == u }) { out.append(e) } }
    for e in list where !out.contains(where: { $0.uid == e.uid }) { out.append(e) }
    return out
  }

  /// Forget a remembered device. A connected one cannot be forgotten (it would come straight back).
  static func forget(_ list: [APEntry], _ uid: String, connected: Set<String>) -> [APEntry] {
    connected.contains(uid) ? list : list.filter { $0.uid != uid }
  }

  /// The highest device in the list that is connected and awake.
  static func top(_ list: [APEntry], alive: Set<String>) -> String? { list.first { alive.contains($0.uid) }?.uid }

  /// Who made a change of the Mac's default (`now` against what PS asked for and what happened in the same moment).
  /// ps: PS asked for exactly this a moment ago. system: devices came or went in the same moment (macOS moving the
  /// sound onto headphones that just connected, or off a device that went away). person: anything else.
  static func who(newDefault: String?, expected: (uid: String, until: Double)?, devicesChanged: Bool, previousGone: Bool, now: Double) -> APWho {
    if let e = expected, e.uid == newDefault, now <= e.until { return .ps }
    if devicesChanged || previousGone { return .system }
    return .person
  }

  /// What PS does for one list. `current`: the Mac's default now; `foreign`: it is a virtual or combined device (or one
  /// this list does not know); `newly`: devices that connected since PS last looked; `inCall`: an app uses the microphone.
  static func decide(_ list: [APEntry], alive: Set<String>, current: String?, foreign: Bool, hold: APHold?, newly: Set<String>,
                     why: APWhy, inCall: Bool, now: Double) -> APDecision {
    guard let target = top(list, alive: alive) else { return .stay("no device in the list is connected") }
    if target == current { return .stay("already the top connected device") }
    if foreign && current != nil { return .stay("your own virtual or combined device is the default") }
    var want = target
    if let h = hold, alive.contains(h.uid), why != .order {
      if now - h.at < sameMinute { return .stay("you picked it in the last minute") }
      // Only a device that just connected and ranks above the person's pick takes over.
      guard let hi = list.firstIndex(where: { $0.uid == h.uid }) else { return .stay("you picked it") }
      guard let n = list.prefix(hi).first(where: { newly.contains($0.uid) && alive.contains($0.uid) }) else { return .stay("you picked it") }
      want = n.uid
      if want == current { return .stay("already the device that just connected") }
    }
    if inCall && why != .order { return .wait }
    return .set(want)
  }

  /// Is the microphone in use a call? Yes, unless it has been open for more than 3 hours (an app that always listens).
  static func isCall(micRunning: Bool, runningSince: Double?, now: Double) -> Bool {
    guard micRunning else { return false }
    guard let s = runningSince else { return true }
    return now - s < longCall
  }

  /// Moving over from Headphones mode (V1.40 to 1.64; Headphones.swift HPPrefs, kept on this Mac as "hpmode.prefs" and
  /// "hpmode.mode"). The lists it had become the start of the new order: with its auto switch on the headphones came
  /// first (that is what it did on connect); with it off, the mode that was on came first. The rest is placed as new.
  static func migrate(_ p: HPPrefs?, mode: String?) -> APLists {
    var l = APLists()
    guard let p else { return l }
    let hpFirst = p.auto || mode == "headphones"
    func add(_ refs: [HPRef], _ side: APSide, _ kind: APKind) {
      for r in refs where okUID(r.uid) && !l[side].contains(where: { $0.uid == r.uid }) {
        l[side].append(APEntry(uid: r.uid, name: String(r.name.prefix(100)), kind: kind, seen: 0))
      }
    }
    add(hpFirst ? p.hpOut : p.spkOut, .speakers, hpFirst ? .bluetooth : .other)
    add(hpFirst ? p.spkOut : p.hpOut, .speakers, hpFirst ? .other : .bluetooth)
    add(hpFirst ? p.hpMic : p.spkMic, .mics, .other)
    add(hpFirst ? p.spkMic : p.hpMic, .mics, .other)
    return l
  }
}
