// One update always installs the NEWEST release, never one in between (V1.51, the developer, 12 Nov 2026: "when you're
// updating, for some reason it updates you to 1.49 and then you have to update again to 1.5").
// The cause: Update now installed the update the last look had found. PS looked 45 s after launch, every 30 minutes
// (since V1.54 every 5, see UpdateCadence) and a minute after a wake, so a Mac that saw V1.49 at 20:55 and was clicked at 21:15 installed V1.49 although
// V1.50 had been live since 21:10; the next look then offered V1.50. Now the click reads the note fresh (no ETag,
// no cache, Updater.freshLook), installs what that note names, and these rules refuse a package older than it.
// Plain rules only, unit tested by tests/update-latest-test.swift.
import Foundation

enum UpdateLatest {
  /// How new a plan is: its app build (0 for web only), then its web build time (ISO 8601, so text order is time order).
  static func rank(_ p: UpdatePlan) -> (Int, String) {
    switch p {
    case .none: return (0, "")
    case .web(let w): return (0, w.built)
    case .app(let a, let w): return (a.build, w.built)
    }
  }
  /// `a` is a newer release than `b`.
  static func newer(_ a: UpdatePlan, than b: UpdatePlan) -> Bool { rank(a) > rank(b) }

  /// What the click installs: the fresh note's plan (the channel is the truth, even when it says "nothing"). Only when
  /// the fresh look failed (offline, the channel not answering) the one on the card goes in: it is the newest PS could
  /// see, and its files were already checked here.
  static func choose(card: UpdatePlan, fresh: UpdatePlan?) -> UpdatePlan { fresh ?? card }

  /// Refuses an update older than the newest release known (nil = fine). `newest` is the plan the freshest note gives.
  static func staleProblem(installing: UpdatePlan, newest: UpdatePlan) -> String? {
    guard installing != .none, newer(newest, than: installing) else { return nil }
    return "the download (\(label(installing))) is older than the newest release (\(label(newest)))"
  }

  /// The unpacked package against the newest note: an app's own build number must not be older than the note's,
  /// and the newest version the package carries (the app's "1.50" or its web files' ps-version.json) must not be
  /// older than the note's "V1.50". nil = fine.
  static func packageProblem(appBuild: Int?, appVersion: String?, webVersion: String?, newest: UpdateManifest, plan: UpdatePlan) -> String? {
    if case .app = plan, let want = newest.app?.build {
      guard let b = appBuild else { return "the new app has no build number" }
      if b < want { return "the new app is build \(b), older than the newest release's \(want)" }
    }
    if let v = newest.version {
      let want = PSVersion.hundredths(String(v.dropFirst()))
      // A package that names no version at all (older web builds) is pinned by its build and signed hash alone.
      let got = [appVersion, webVersion].compactMap { $0 }.map(PSVersion.hundredths).max() ?? 0
      if want > 0, got > 0, got < want { return "the download is V\(dotted(got)), older than the newest release \(v)" }
    }
    return nil
  }

  /// A failure that means "fetch the newest again and retry once", not "this update is broken".
  static let staleMark = "older than the newest release"
  static func isStale(_ why: String) -> Bool { why.contains(staleMark) }

  static func label(_ p: UpdatePlan) -> String {
    switch p { case .none: return "nothing"; case .web(let w): return "web \(w.built)"; case .app(let a, _): return "build \(a.build)" }
  }
  /// 150 as "1.50".
  static func dotted(_ h: Int) -> String { "\(h / 100).\(String(format: "%02d", h % 100))" }
}

/// How often PS looks for an update by itself (V1.54, the developer, 12 Nov 2026: "can you not change it to every five minutes
/// the update instead of every 30 minutes?"). 45 s after launch, then every 5 minutes from the end of the last look,
/// and a minute after a wake (Updater.start). A look that could not reach the channel doubles the wait: 5, 10, 20,
/// then 30 minutes at most; the next look that works goes back to 5. Plain rules, unit tested by tests/update-cadence-test.swift.
final class UpdateCadence {
  static let first: TimeInterval = 45
  static let every: TimeInterval = 5 * 60
  static let longest: TimeInterval = 30 * 60
  private let lock = NSLock()
  private var failsRow = 0, active = 0, everyMin = 5
  private var endedAt: Date?

  /// Settings, "Check for updates every" (V1.54, web core/updateevery.ts): 5, 10, 15 or 30 minutes, or Off (0,
  /// open source build: no automatic looks at all, only Check now), anything else is 5.
  static let choices = [5, 10, 15, 30]
  static let off = 0
  static func clean(_ minutes: Int) -> Int { minutes == off ? off : choices.contains(minutes) ? minutes : 5 }
  /// The stored choice (UserDefaults update.everyMin): nothing stored yet is 5, a stored 0 is Off.
  static func stored(_ v: Any?) -> Int { (v as? Int).map(clean) ?? 5 }
  /// Off: no look by itself (no timer, none after a wake); a look the developer asks for still runs.
  var isOff: Bool { lock.lock(); defer { lock.unlock() }; return everyMin == UpdateCadence.off }
  /// Takes the choice from the Tab list page, at once (the shell re-arms its timer: Updater.setEvery). Returns what it uses.
  @discardableResult func setEvery(_ minutes: Int) -> Int {
    lock.lock(); defer { lock.unlock() }
    everyMin = UpdateCadence.clean(minutes)
    return everyMin
  }
  var every: Int { lock.lock(); defer { lock.unlock() }; return everyMin }
  /// How long ago the last look ended (nil: none has yet, so the first one is still the launch timer's).
  var sinceLastEnd: TimeInterval? { lock.lock(); defer { lock.unlock() }; return endedAt.map { Date().timeIntervalSince($0) } }

  /// Looks in a row that could not reach the channel (a note that said "nothing new" is not a failure).
  var fails: Int { lock.lock(); defer { lock.unlock() }; return failsRow }
  /// A look is running right now.
  var running: Bool { lock.lock(); defer { lock.unlock() }; return active > 0 }

  /// The wait before the next look after `fails` failures in a row: the chosen minutes, or the back off 5, 10, 20, 30
  /// minutes (never more) when that is longer.
  static func delay(everyMin: Int, fails: Int) -> TimeInterval {
    let m = clean(everyMin), base = TimeInterval(m == off ? 5 : m) * 60   // Off never arms a timer (Updater), 5 only as a safe number
    if fails <= 0 { return base }
    return max(base, min(longest, every * pow(2, Double(min(fails, 6)))))
  }
  static func delay(fails: Int) -> TimeInterval { delay(everyMin: 5, fails: fails) }
  var delay: TimeInterval { lock.lock(); defer { lock.unlock() }; return UpdateCadence.delay(everyMin: everyMin, fails: failsRow) }

  /// A look wants to start (called where the look is asked for, before it is queued): false means skip it, because an
  /// automatic look never piles up behind one that is still running. A look the developer asked for always runs.
  func begin(manual: Bool) -> Bool {
    lock.lock(); defer { lock.unlock() }
    if active > 0 && !manual { return false }
    active += 1
    return true
  }
  /// A look that began ended; `failed` = it could not reach the channel.
  func end(failed: Bool) {
    lock.lock(); defer { lock.unlock() }
    active = max(0, active - 1)
    endedAt = Date()
    failsRow = failed ? failsRow + 1 : 0
  }
}
