// The fresh restart helper check before Sentry mode engages (V1.54, helper-check-154). The pure rules, with no macOS
// calls, so tests/helper-check-test.sh runs them while the developer uses the Mac. AutoReboot.check asks macOS and the helper.
//
// Why (the developer, 12 Nov 2026, V1.53): "despite just allowing the restart helper in settings, when I went into Sentry mode,
// it popped up saying I have no restart helper enabled, then went to PS app settings and it was active.. Then went back
// to the Sentry and it suddenly worked again??" The AI button read what PS remembered, not the helper at that moment:
// a miss from while it was switched off ("The restart helper is not switched on") stayed after it came back on, until
// the next once a minute ask, or until Security opened (its card asks fresh, which is why opening it "fixed" it).
// Now pressing the button asks macOS and the helper fresh, and tries again for a few seconds before saying off.
import Foundation

enum HelperCheckCore {
  /// macOS says on but the helper has not answered yet: launchd may still be starting it. Seconds the check keeps trying.
  static let onWait: Double = 6
  /// macOS says waiting for the yes (or not set up although it ran here before): it may be catching up with a switch on.
  static let offWait: Double = 3
  /// Seconds between tries.
  static let every: Double = 0.75
  /// Seconds one try waits for the helper's answer.
  static let answerWait: Double = 1.5
  /// The page's own limit for the whole check (core/sentry.ts HELPER_CHECK.waitS): more than the longest check here.
  static let pageWait: Double = 10

  enum Next: Equatable { case done, again }
  /// After one try. state: macOS's fresh answer ("on", "approve", "off", "missing", "test"); answered: the helper itself
  /// answered this try (only asked while macOS says on); ranBefore: it ran on this Mac before; elapsed: seconds since
  /// the check began.
  static func next(state: String, answered: Bool, ranBefore: Bool, elapsed: Double) -> Next {
    if state == "on" { return answered || elapsed + every > onWait ? .done : .again }
    if state == "approve" || (state == "off" && ranBefore) { return elapsed + every > offWait ? .done : .again }
    return .done   // never set up, not in this build, a test copy: nothing to wait for
  }

  /// What the check says at the end, in the page's own words (core/sentry.ts HelperGap; nil: the helper is fine).
  /// It never says off while macOS lists the helper as on: then it is "not answering" at worst.
  static func gap(state: String, answered: Bool, old: Bool) -> String? {
    switch state {
    case "on": return answered ? (old ? "older" : nil) : "notAnswering"
    case "approve": return "needsOk"
    case "off": return "notSetUp"
    case "missing": return "missing"
    default: return nil   // "test"
    }
  }

  /// The miss PS records when it cannot even ask, because macOS does not list the helper as on.
  static let notOnError = "The restart helper is not switched on"
  /// That miss is about macOS's switch, not the helper: once macOS says on again it no longer holds, so it must never
  /// make the page say "not answering" (the V1.53 bug). Any other miss stays until the helper answers.
  static func errorAfter(state: String, error: String?) -> String? { state == "on" && error == notOnError ? nil : error }
}
