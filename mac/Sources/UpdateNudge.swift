import Foundation

// The update pop-up's rules (V1.40, the developer 7 Nov 2026: "make sure it actually pops up for him, saying hey, update's
// available, so you don't have to go into the settings to look for it"). Pure, so tests/update-nudge-test.swift
// runs it with no app around it; Updater.swift shows the card.
//  - A new update (a build or web files PS has not offered on this Mac before) pops up by itself once, signed in
//    or not. It names the version and shows the approved notes, with Update now and Later.
//  - Later: quiet for a day (the gear's dot stays), then it pops up one more time. Later again, and only the
//    gear's dot is left for that update (no nagging, as the card's Later since V1.33). Update now ends it.
//  - It waits while Do Not Disturb is on, while 1Password or Signal is in front and while an install runs, and
//    pops up as soon as that ends. Kept in PS's update folder, so a restart does not show it again.
//  - PS > Check for Updates is the developer asking: that card always shows and is not counted here.
struct UpdateNudge: Codable, Equatable {
  var key = ""              // the update it is about ("a2611071200" for a build, "w<built>" for web files)
  var shown = 0             // how often it popped up by itself for `key`
  var laterUntil = 0.0      // Later: quiet until then (seconds since 1970); 0 = Later not clicked
  var answered = false      // Update now, or Later on the last pop-up: never by itself again for `key`

  /// Later is for a day.
  static let snooze: TimeInterval = 24 * 3600
  /// The first pop-up and one more after Later.
  static let maxShows = 2

  enum Step: Equatable { case show, wait(String), quiet(String) }

  /// What to do for update `k` now.
  func step(key k: String, now: Date, dnd: Bool, protectedFront: Bool, busy: Bool) -> Step {
    if k.isEmpty { return .quiet("no update") }
    if k == key {
      if answered { return .quiet("answered") }
      if shown >= UpdateNudge.maxShows { return .quiet("shown \(shown) times") }
      if laterUntil == 0, shown > 0 { return .quiet("already shown") }
      if laterUntil > 0, now.timeIntervalSince1970 < laterUntil { return .quiet("Later, until \(Int(laterUntil))") }
    }
    if busy { return .wait("an install is running") }
    if protectedFront { return .wait("1Password or Signal is in front") }
    if dnd { return .wait("Do Not Disturb is on") }
    return .show
  }

  /// It popped up for `k` (a newer update starts its own count).
  mutating func didShow(key k: String) {
    if k != key { self = UpdateNudge(key: k) }
    shown += 1
  }
  /// Later on the pop-up: a day of quiet, or for good after the last one.
  mutating func later(now: Date) {
    laterUntil = now.timeIntervalSince1970 + UpdateNudge.snooze
    if shown >= UpdateNudge.maxShows { answered = true }
  }
  /// Update now (on the card or in the gear menu) for `k`.
  mutating func updateNow(key k: String) {
    if k != key { self = UpdateNudge(key: k) }
    answered = true
  }

  static func load(_ url: URL) -> UpdateNudge {
    guard let d = FileManager.default.contents(atPath: url.path), let n = try? JSONDecoder().decode(UpdateNudge.self, from: d) else { return UpdateNudge() }
    return n
  }
  func save(_ url: URL) {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let d = try? JSONEncoder().encode(self) { try? d.write(to: url, options: .atomic) }
  }
}

/// After an update, the first launch offers the new setup menu (G Squad, V1.40): "See what's new and set it up".
/// The Tab list page tells PS its setup menu exists and its generation ({type:"setup:can", gen}, web
/// src/setuphook.ts); PS offers each generation once on this Mac, and only after an update (a fresh install shows
/// the menu by itself). Pure, like UpdateNudge.
struct SetupOffer: Codable, Equatable {
  var offered = 0           // the newest setup generation already offered on this Mac

  /// Offer now? `updated`: this run follows an update (an app swap, or web files put in this session).
  func step(gen: Int, updated: Bool, signedIn: Bool, dnd: Bool, protectedFront: Bool, busy: Bool) -> UpdateNudge.Step {
    if gen <= 0 { return .quiet("no setup menu") }
    if !updated { return .quiet("not after an update") }
    if gen <= offered { return .quiet("generation \(gen) offered before") }
    if !signedIn { return .wait("signed out") }
    if busy { return .wait("an install is running") }
    if protectedFront { return .wait("1Password or Signal is in front") }
    if dnd { return .wait("Do Not Disturb is on") }
    return .show
  }
  mutating func didOffer(_ gen: Int) { offered = max(offered, gen) }

  static func load(_ url: URL) -> SetupOffer {
    guard let d = FileManager.default.contents(atPath: url.path), let n = try? JSONDecoder().decode(SetupOffer.self, from: d) else { return SetupOffer() }
    return n
  }
  func save(_ url: URL) {
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if let d = try? JSONEncoder().encode(self) { try? d.write(to: url, options: .atomic) }
  }
}
