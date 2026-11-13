// Private mode, the pop ups with windows of their own (V1.57, PrivateCore.swift says what and why). Each asks
// `waits(key, show:)` where it would show its window; true means it stays out of sight and a pill is on the card stack
// instead. A click on the pill, or private mode going off, runs `show`. Each also says `gone(key)` when it goes for good,
// and registers with `watch` so that private mode coming on puts the ones already up behind pills too.
import Foundation

final class PrivateHold {
  static let shared = PrivateHold()
  private var s = PrivateHolds()
  private var again: [String: () -> Void] = [:]
  private var watchers: [() -> Void] = []
  var on: Bool { s.on }

  func watch(_ f: @escaping () -> Void) { watchers.append(f) }

  /// true: the pop up waits behind a pill and must not show its window now.
  func waits(_ key: String, show: @escaping () -> Void) -> Bool {
    let r = s.wants(key)
    guard r.wait else { return false }
    again[key] = show
    if r.newPill { Toast.shared.showPill(key) }
    return true
  }
  /// The pop up went for good: its pill goes too.
  func gone(_ key: String) {
    if s.gone(key) { again[key] = nil; Toast.shared.hideCard(PrivateCore.cardId(key)) }
  }
  /// Its pill was clicked (Toast.swift, a "pv:" card's action "show").
  func opened(_ key: String) {
    guard s.open(key) else { return }
    again.removeValue(forKey: key)?()
  }
  /// Private mode changed (Toast.meetPrivacy).
  func set(_ on: Bool) {
    guard on != s.on else { return }
    let out = s.set(on)
    if on { watchers.forEach { $0() }; return }
    for k in out { Toast.shared.hideCard(PrivateCore.cardId(k)); again.removeValue(forKey: k)?() }
    again = [:]
  }
}
