// The island as a live guide through first time setup (V1.58, the developer 13 Nov 2026: "I want the dynamic island to be there
// as a guide through the setup ... it will do fancy animations, like bleep and bloop, to get your attention ... and
// whenever you do something right it will give you a little green tick and a little chime").
//
// The rules, pure Foundation (no windows, no sounds, no clock of its own), so tests/setup-island-test.swift runs them on
// any Mac. SetupIsland.swift is the part on screen: it feeds these the facts it sees and plays what they say.
//
//  - Which step is now: the first step, in order, that can be done now and is not done or skipped.
//  - Done detection: a step whose fact turns true while its hint shows gets a green tick and a chime. A step that was
//    already done when it came up (Accessibility already on) is passed quietly: no praise for nothing.
//  - Attention: a blip once when a step starts; again only after a pause with nothing happening, a few times at most.
//  - Skip moves on, Esc hides the hint until the next step, Close ends the guide for good. The island switched off
//    stops it at once. None of this ever blocks setup: the setup screens work exactly as before without it.
//  - Loading: whatever loads during setup or start up turns the island into a rounded square with a spinner and a
//    small label. It shows only when the load takes a moment, and then stays long enough to read.
import Foundation

enum SetupIslandStep: String, CaseIterable, Codable {
  // The install screen (PS opened from the DMG, Installer.swift).
  case install, accessibility, mixer, store, open
  // The installed app, first launch.
  case supabase, signIn, holdTab, setupMenu

  var inInstaller: Bool { [.install, .accessibility, .mixer, .store, .open].contains(self) }
  /// Optional steps are passed quietly when the person moves on without them.
  var optional: Bool { self == .mixer }
}

/// What the Mac app sees right now. Every field is a plain fact; the rules decide what it means.
struct SetupIslandFacts: Equatable {
  /// This run is the install screen.
  var installer = false
  /// The install screen's page: "welcome", "steps" (copying), "perms", "store", "done" (Open pressed). "" before it shows.
  var page = ""
  var ax = false
  var audio = false
  /// The "own Supabase" window is open, and it finished linking a project.
  var supabaseOpen = false
  var supabaseDone = false
  var signedIn = false
  /// The Tab list has been shown since this launch.
  var listShown = false
  /// The setup menu (web views/Welcome.tsx) is open now, and it was open and then closed.
  var menuOpen = false
  var menuClosed = false
  /// The island is switched off (Settings): no guide, no loading square.
  var islandOff = false
}

/// What is kept between the install screen and the installed app, and between launches (UserDefaults, one JSON).
struct SetupIslandSaved: Codable, Equatable {
  /// A first time setup is under way on this Mac (set by the install screen on a Mac that never had PS).
  var active = false
  /// The birth ("I'm here to help") has been shown.
  var born = false
  var finished = false
  /// Closed for good with its close button.
  var off = false
  var soundOff = false
  var done: [String] = []
  var skipped: [String] = []
  /// When this setup started (seconds since 1970). A setup left half done stops by itself after maxAge.
  var started: Double = 0

  func isDone(_ s: SetupIslandStep) -> Bool { done.contains(s.rawValue) }
  func isSkipped(_ s: SetupIslandStep) -> Bool { skipped.contains(s.rawValue) }
  func handled(_ s: SetupIslandStep) -> Bool { isDone(s) || isSkipped(s) }

  static func decode(_ d: Data?) -> SetupIslandSaved {
    guard let d, let s = try? JSONDecoder().decode(SetupIslandSaved.self, from: d) else { return SetupIslandSaved() }
    return s
  }
  func encoded() -> Data? { try? JSONEncoder().encode(self) }
}

enum SetupIslandCore {
  /// A blip again only after this long with nothing happening (no click, no step done).
  static let nudgeAfter: TimeInterval = 30
  /// And at most this many times per step, so it never nags.
  static let maxNudges = 3
  /// After the Tab list first shows, how long to wait for the setup menu to open by itself before the final moment.
  static let menuGrace: TimeInterval = 8
  /// A setup left half done stops guiding after this long.
  static let maxAge: TimeInterval = 3 * 24 * 3600

  /// Should the install screen start a guided setup? Only on a Mac that never had PS (nothing in Applications and no
  /// answer to where the list lives), never in a test copy, never when the island was switched off before.
  static func shouldStart(psAlreadyInstalled: Bool, neverChoseStore: Bool, test: Bool, islandOff: Bool) -> Bool {
    !psAlreadyInstalled && neverChoseStore && !test && !islandOff
  }

  // MARK: - the steps

  /// The step can be worked on now (its screen is up).
  static func available(_ s: SetupIslandStep, _ f: SetupIslandFacts, _ saved: SetupIslandSaved) -> Bool {
    let laterPages = ["perms", "store", "done"]
    switch s {
    case .install: return f.installer && f.page == "welcome"
    case .accessibility, .mixer, .open: return f.installer && laterPages.contains(f.page)
    case .store: return f.installer && (f.page == "store" || (f.page == "done" && saved.isDone(.store)))
    case .supabase: return !f.installer && f.supabaseOpen && !f.signedIn
    case .signIn: return !f.installer
    case .holdTab: return !f.installer && (f.signedIn || saved.isSkipped(.signIn))
    case .setupMenu: return !f.installer && f.menuOpen
    }
  }

  enum Outcome: Equatable { case pending, done, passed }

  /// Done right (a tick if its hint showed), passed (moved on without it, no tick), or still to do.
  static func outcome(_ s: SetupIslandStep, _ f: SetupIslandFacts) -> Outcome {
    switch s {
    case .install: return f.installer && !["", "welcome"].contains(f.page) ? .done : .pending
    case .accessibility: return f.ax ? .done : .pending
    case .mixer: return f.audio ? .done : (f.page == "store" || f.page == "done") ? .passed : .pending
    case .store: return f.page == "done" ? .done : .pending
    case .open: return f.page == "done" ? .done : .pending
    case .supabase: return f.supabaseDone ? .done : .pending
    case .signIn: return f.signedIn ? .done : .pending
    case .holdTab: return f.listShown ? .done : .pending
    case .setupMenu: return f.menuClosed && !f.menuOpen ? .done : .pending
    }
  }

  /// The step whose hint shows now, or nil (nothing to do on this screen, or everything done).
  static func current(_ f: SetupIslandFacts, _ saved: SetupIslandSaved) -> SetupIslandStep? {
    SetupIslandStep.allCases.first { s in
      available(s, f, saved) && !saved.handled(s) && outcome(s, f) == .pending
    }
  }

  // MARK: - the words (plain, no dashes; {app} is the app's name on this Mac)

  struct Hint: Equatable { let title: String; let sub: String }

  static let birthWords = "I'm here to help"
  static let finaleWords = Hint(title: "You are all set", sub: "Hold Tab any time to see your list.")

  /// `axPane` and `audioPane`: the System Settings names this macOS uses (Installer.axPane, Installer.audioPane).
  static func hint(_ s: SetupIslandStep, app: String, axPane: String, audioPane: String) -> Hint {
    let h: Hint
    switch s {
    case .install: h = Hint(title: "Pick a name, then press Install", sub: "{app} is fine as it is.")
    case .accessibility: h = Hint(title: "Allow {app} in System Settings", sub: "Privacy and Security, \(axPane). Switch it on.")
    case .mixer: h = Hint(title: "Want the volume mixer?", sub: "Optional. Allow it in System Settings, or press Open.")
    case .store: h = Hint(title: "Where should your list live?", sub: "Pick one, then press Open. You can change it later.")
    case .open: h = Hint(title: "Press Open", sub: "{app} is ready to start.")
    case .supabase: h = Hint(title: "Connect your own Supabase", sub: "Follow the steps in this window.")
    case .signIn: h = Hint(title: "Sign in or create an account", sub: "Or press Start now to keep your list on this Mac.")
    case .holdTab: h = Hint(title: "Hold Tab to see your list", sub: "In any app. Let go and it goes away.")
    case .setupMenu: h = Hint(title: "A quick setup", sub: "Pick what you like, then press Create.")
    }
    return Hint(title: fill(h.title, app), sub: fill(h.sub, app))
  }
  /// The few words beside the green tick.
  static func praise(_ s: SetupIslandStep) -> String {
    switch s {
    case .install: return "Installing"
    case .accessibility: return "Tab is ready"
    case .mixer: return "Mixer on"
    case .store: return "Saved"
    case .open: return "Here we go"
    case .supabase: return "Supabase connected"
    case .signIn: return "You are in"
    case .holdTab: return "That is your list"
    case .setupMenu: return "Setup saved"
    }
  }
  static func fill(_ s: String, _ app: String) -> String { s.replacingOccurrences(of: "{app}", with: app) }

  /// Loading labels (the small text at the top of the loading square).
  enum Load: String { case install, page, database, supabase }
  static func loadLabel(_ l: Load, app: String) -> String {
    switch l {
    case .install: return "Installing \(app)"
    case .page: return "Starting \(app)"
    case .database: return "Loading database"
    case .supabase: return "Setting up Supabase"
    }
  }
}

// MARK: - the guide

/// The guide's state. `update` is called with the facts whenever one changes and once a second while a hint shows;
/// it returns what the island should do, in order.
struct SetupIslandGuide {
  enum Effect: Equatable {
    case birth                      // out of the setup screen: big, green tick, "I'm here to help", up to the top
    case hint(SetupIslandStep)      // the hint for a step that just started (with a bounce and a blip)
    case tick(SetupIslandStep)      // done right: green tick and chime
    case nudge                      // nothing happened for a while: a wiggle and a soft blip
    case hideHint                   // nothing to do on this screen (Esc, or a page with no step)
    case finale                     // everything done: the happy moment, then the island's normal look
    case stop                       // the guide ends now (closed, island off, too old)
  }

  var saved: SetupIslandSaved
  private(set) var current: SetupIslandStep?
  /// The last time something happened (a click, a step done, a nudge): the pause before a nudge counts from here.
  private(set) var lastPoke = Date.distantPast
  private(set) var nudges = 0
  /// Esc: this step's hint stays hidden until the next step.
  private(set) var quiet = false
  /// Hidden because the island is off right now (it may come back on).
  private(set) var hidden = false
  /// When the Tab list first showed (the setup menu may open by itself in the next few seconds).
  private(set) var menuWaitFrom: Date?

  init(saved: SetupIslandSaved) { self.saved = saved }

  var running: Bool { saved.active && !saved.finished && !saved.off }

  /// A new guided setup (the install screen on a fresh Mac). Keeps the sound choice.
  static func begin(now: Date, soundOff: Bool) -> SetupIslandGuide {
    var s = SetupIslandSaved()
    s.active = true; s.started = now.timeIntervalSince1970; s.soundOff = soundOff
    return SetupIslandGuide(saved: s)
  }

  mutating func update(_ f: SetupIslandFacts, now: Date) -> [Effect] {
    guard running else { return [] }
    if saved.started > 0, now.timeIntervalSince1970 - saved.started > SetupIslandCore.maxAge {
      saved.finished = true; current = nil
      return [.stop]
    }
    if f.islandOff {
      if hidden { return [] }
      hidden = true; current = nil
      return [.stop]
    }
    var out: [Effect] = []
    if hidden { hidden = false; current = nil }   // the island came back on: the hint shows again
    if !saved.born { saved.born = true; out.append(.birth) }

    // Done detection: every step whose screen is up (or whose hint shows).
    for s in SetupIslandStep.allCases where !saved.handled(s) && (s == current || SetupIslandCore.available(s, f, saved) || s == .install) {
      switch SetupIslandCore.outcome(s, f) {
      case .pending: continue
      case .done:
        saved.done.append(s.rawValue)
        if s == current { out.append(.tick(s)); lastPoke = now }
        if s == .holdTab { menuWaitFrom = now }
      case .passed:
        saved.skipped.append(s.rawValue)
      }
    }

    // The final moment: signed in (or skipped), the list seen (or skipped), no setup menu open, and the menu either
    // done or not coming.
    if !f.installer && saved.handled(.signIn) && saved.handled(.holdTab) && !f.menuOpen {
      let menuOver = saved.handled(.setupMenu) || now.timeIntervalSince(menuWaitFrom ?? .distantPast) >= SetupIslandCore.menuGrace
      if menuOver {
        saved.finished = true; current = nil
        out.append(.finale)
        return out
      }
    }

    let next = SetupIslandCore.current(f, saved)
    if next != current {
      let had = current != nil
      current = next; quiet = false; nudges = 0; lastPoke = now
      if let next { out.append(.hint(next)) } else if had { out.append(.hideHint) }
      return out
    }
    if current != nil, !quiet, nudges < SetupIslandCore.maxNudges, now.timeIntervalSince(lastPoke) >= SetupIslandCore.nudgeAfter {
      nudges += 1; lastPoke = now
      out.append(.nudge)
    }
    return out
  }

  /// The person did something (a click, typing on a setup screen): the pause before a nudge starts again.
  mutating func activity(now: Date) { lastPoke = now }

  /// Esc: hide this hint. The next step shows its hint as usual.
  mutating func escape() -> [Effect] {
    guard running, current != nil, !quiet else { return [] }
    quiet = true
    return [.hideHint]
  }

  /// Skip: leave this step as it is and go on. Setup itself is not changed.
  mutating func skip(_ f: SetupIslandFacts, now: Date) -> [Effect] {
    guard running, let c = current else { return [] }
    saved.skipped.append(c.rawValue)
    return update(f, now: now)
  }

  /// Close: the guide ends for good on this Mac. Setup goes on exactly as before.
  mutating func close() -> [Effect] {
    guard running else { return [] }
    saved.off = true; current = nil
    return [.stop]
  }
}

// MARK: - loading

/// What loads right now. A load shows only after `showAfter` (no flash for quick ones), and once shown stays at least
/// `minShow` so it can be read; then the island morphs back.
struct SetupIslandLoading {
  static let showAfter: TimeInterval = 0.45
  static let minShow: TimeInterval = 0.8
  /// A load nobody ended stops showing after this long (the island never stays stuck as a spinner).
  static let maxShow: TimeInterval = 45

  struct Job: Equatable { let id: String; let label: String; let since: Date }
  private(set) var jobs: [Job] = []
  /// Something is loading (shown or not yet).
  var pending: Bool { !jobs.isEmpty }
  private(set) var shownAt: Date?
  private(set) var shownLabel: String?

  mutating func begin(_ id: String, _ label: String, now: Date) {
    jobs.removeAll { $0.id == id }
    jobs.append(Job(id: id, label: label, since: now))
  }
  mutating func end(_ id: String) { jobs.removeAll { $0.id == id } }

  /// What to show now (nil: the island's own look), and when to look again (nil: nothing will change by itself).
  mutating func state(now: Date) -> (label: String?, recheck: TimeInterval?) {
    jobs.removeAll { now.timeIntervalSince($0.since) > SetupIslandLoading.maxShow }
    if let newest = jobs.last, let oldest = jobs.first {
      let age = now.timeIntervalSince(oldest.since)
      if shownAt != nil || age >= SetupIslandLoading.showAfter {
        if shownAt == nil { shownAt = now }
        shownLabel = newest.label
        return (newest.label, SetupIslandLoading.maxShow - now.timeIntervalSince(oldest.since) + 0.05)
      }
      return (nil, SetupIslandLoading.showAfter - age + 0.01)
    }
    if let at = shownAt {
      let left = SetupIslandLoading.minShow - now.timeIntervalSince(at)
      if left > 0 { return (shownLabel, left + 0.01) }
      shownAt = nil; shownLabel = nil
    }
    return (nil, nil)
  }
}
