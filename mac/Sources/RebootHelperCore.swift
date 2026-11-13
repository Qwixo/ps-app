// The restart helper after an update (V1.45): the rules, with no macOS calls, so tests/reboot-helper-state-test.swift
// can run them offline. AutoReboot.swift asks macOS, keeps the memory and shows the card.
//
// Why it is needed: PS has no Apple team, so macOS ties its yes for the helper to the helper's exact cdhash.
// tools/helper-pin.sh keeps the helper byte for byte between releases, so this should be rare now; but when the
// helper's code really changes, macOS switches it off on every Mac and says only "requires approval". Then PS
// knows the helper was on before (the memory below), says plainly that macOS switched it off after the update,
// offers one button to the right System Settings page, and sends the developer's saved timer settings again by itself as
// soon as it is on.
import Foundation

/// What PS remembers about the helper (UserDefaults, never in a test copy): it ran here once, and in which build.
struct HelperMemory: Equatable {
  var wasOn: Bool
  var onBuild: String
}

/// Why the helper is not running although it was on before.
enum HelperOffBy: String {
  /// It ran in an older build of PS: the update switched it off (macOS asks for the yes again).
  case update
  /// It ran in this very build: someone switched PS off in System Settings.
  case settings
}

enum RebootHelperCore {
  /// The helper ran here (macOS says on AND it answered): remember this build. Nothing else changes the memory: a
  /// "not set up" seen for a moment around an update must not wipe it. Only Remove clears it (AutoReboot.remove).
  static func remember(state: String, answered: Bool, memory m: HelperMemory, build: String) -> HelperMemory {
    state == "on" && answered ? HelperMemory(wasOn: true, onBuild: build) : m
  }

  /// A PS from before V1.45 kept no memory. The developer's own settings exist only once the helper was on (the controls show
  /// only then), so they stand in for "it was on" with an unknown build: an update.
  static func migrate(stored: HelperMemory?, hasSettings: Bool) -> HelperMemory {
    stored ?? HelperMemory(wasOn: hasSettings, onBuild: "")
  }

  /// nil while it is on, never set up, or simply still waiting for the first yes.
  static func offBy(state: String, memory m: HelperMemory, build: String) -> HelperOffBy? {
    guard state == "approve", m.wasOn else { return nil }
    return m.onBuild == build ? .settings : .update
  }

  /// The card comes up once per PS run, only for an update, and not when the developer had auto reboot Off.
  static func showCard(offBy: HelperOffBy?, mode: String, toldThisRun: Bool) -> Bool {
    offBy == .update && mode != "off" && !toldThisRun
  }

  /// It just came back on (after the card, Set up, or the developer switching it on by himself): send the settings again.
  static func cameBack(previous: String?, now: String) -> Bool {
    now == "on" && previous != nil && previous != "on"
  }

  /// How often PS looks: every 3 s while it waits for the developer in System Settings (one cheap call off the main thread),
  /// else once a minute.
  static func pollSeconds(state: String) -> TimeInterval { state == "approve" ? 3 : 60 }

  /// The card, in plain words. `app` is what PS is called on this Mac (it can be renamed).
  static func cardTitle(app: String) -> String { "macOS switched off the restart helper after the update" }
  static func cardSub(app: String) -> String {
    "Find \(app) under Allow in the Background and switch it on. If it already looks on, switch it off and then on again. Auto reboot then carries on with your settings by itself."
  }
  static let cardButton = "Open System Settings"
  static let cardId = "rh:off"
}
