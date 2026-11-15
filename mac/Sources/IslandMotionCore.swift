// The timing of every island moment (PS 1.60, the developer 14 Nov 2026: "the island squeezes in a tiny bit, then bounces out
// into the card", "when dismissed it shrinks back in"). Pure numbers: no windows, no sounds, no clock. Island.swift
// plays the steps with SwiftUI springs, tests/island-motion-test.sh checks them. The reference is SetupIsland.swift:
// a tiny squeeze before anything grows, a spring that overshoots, things stay attached to the island.
//
// `swell` is the island's drawn size change (Island.swift scaleEffect): 0 is rest, 1 is the full "a card is coming
// out" swell, below 0 is a squeeze (narrower and shorter), always anchored at the top so it stays joined to the notch.
import Foundation

enum IslandMoment: String, CaseIterable {
  case cardOut        // a card comes out of the island (AI finished, reminder, update, notes, any card)
  case cardBack       // a card goes back into the island
  case updateDone     // an update finished installing
  case dbLoaded       // the database finished loading: a green tick
  case whatsNew       // the island says "What's new", then the panel comes out
  case welcomeBack    // the island shrinks a little, then grows into the Welcome back panel (PS 1.60, WelcomeBackCore.swift)
  case workoutDone    // "Workout complete": a squeeze and a big pop before the summary grows out (WorkoutSummaryCore.swift)
  case faceID         // Done on Welcome back: the Face ID style tick, a soft pop
}

struct IslandStep: Equatable {
  /// Seconds after the moment starts.
  let at: TimeInterval
  /// The swell to spring to.
  let to: Double
  /// SwiftUI spring(response:dampingFraction:).
  let response: Double
  let damping: Double
}

enum IslandMotionCore {
  /// How deep the first squeeze goes. Tiny on purpose: the island must look like it breathes in, not like it shrinks.
  static let squeeze = -0.4
  /// How long the squeeze is held before the card comes out.
  static let squeezeFor: TimeInterval = 0.09

  /// The steps of a moment. Reduce Motion: no steps at all (the card only fades, nothing moves).
  static func steps(_ m: IslandMoment, reduceMotion: Bool) -> [IslandStep] {
    if reduceMotion { return [] }
    switch m {
    case .cardOut, .whatsNew:
      // squeeze in, then bounce out past the full swell, then settle with a springy wobble
      return [IslandStep(at: 0, to: squeeze, response: 0.12, damping: 0.85),
              IslandStep(at: squeezeFor, to: 1.0, response: 0.24, damping: 0.52),
              IslandStep(at: squeezeFor + 0.2, to: 0, response: 0.46, damping: 0.5)]
    case .cardBack:
      // the card is gulped back: a soft bulge, then settle
      return [IslandStep(at: 0, to: 0.45, response: 0.2, damping: 0.7),
              IslandStep(at: 0.12, to: 0, response: 0.46, damping: 0.5)]
    case .updateDone:
      // its own short moment: squeeze, a pop, a second smaller pop, rest
      return [IslandStep(at: 0, to: squeeze, response: 0.12, damping: 0.85),
              IslandStep(at: squeezeFor, to: 1.1, response: 0.22, damping: 0.5),
              IslandStep(at: squeezeFor + 0.24, to: 0.35, response: 0.2, damping: 0.6),
              IslandStep(at: squeezeFor + 0.46, to: 0, response: 0.46, damping: 0.5)]
    case .welcomeBack:
      // it shrinks a little (deeper than a card's squeeze, held a breath), then grows with a springy overshoot
      return [IslandStep(at: 0, to: -0.7, response: 0.16, damping: 0.85),
              IslandStep(at: 0.16, to: 1.0, response: 0.3, damping: 0.58),
              IslandStep(at: 0.42, to: 0, response: 0.5, damping: 0.55)]
    case .workoutDone:
      return [IslandStep(at: 0, to: squeeze, response: 0.12, damping: 0.85),
              IslandStep(at: squeezeFor, to: 1.15, response: 0.22, damping: 0.5),
              IslandStep(at: squeezeFor + 0.26, to: 0.3, response: 0.2, damping: 0.6),
              IslandStep(at: squeezeFor + 0.48, to: 0, response: 0.46, damping: 0.5)]
    case .faceID:
      return [IslandStep(at: 0, to: 0.6, response: 0.2, damping: 0.5),
              IslandStep(at: 0.18, to: 0, response: 0.46, damping: 0.5)]
    case .dbLoaded:
      return [IslandStep(at: 0, to: squeeze * 0.5, response: 0.12, damping: 0.85),
              IslandStep(at: 0.07, to: 0.6, response: 0.22, damping: 0.5),
              IslandStep(at: 0.28, to: 0, response: 0.44, damping: 0.5)]
    }
  }

  /// When the whole moment is over (the last step plus its spring settling).
  static func length(_ m: IslandMoment, reduceMotion: Bool) -> TimeInterval {
    guard let last = steps(m, reduceMotion: reduceMotion).last else { return 0.2 }
    return last.at + last.response * 2
  }

  /// The delay before the card itself starts to move, so it comes out as the island bounces and not before the squeeze.
  static func cardDelay(reduceMotion: Bool) -> TimeInterval { reduceMotion ? 0 : squeezeFor }

  /// A chime at the big moments only. Cards coming out and going back make no chime of their own (their own sounds
  /// stay as they are). The sound switch (Settings, Dynamic Island) and Do Not Disturb silence it.
  static func chimes(_ m: IslandMoment, soundOn: Bool, dndMutesSounds: Bool) -> Bool {
    guard soundOn, !dndMutesSounds else { return false }
    switch m {
    case .updateDone, .dbLoaded, .whatsNew, .workoutDone, .faceID: return true
    case .cardOut, .cardBack, .welcomeBack: return false
    }
  }

  /// The words of the moments the island says by itself (plain, no dashes).
  static let dbLoadedWords = "Database loaded"
  static let whatsNewWords = "What's new"
  static func updatedWords(version: String?) -> String {
    let v = (version ?? "").trimmingCharacters(in: .whitespaces)
    return v.isEmpty ? "Updated" : "Updated to \(v)"
  }

  /// The database tick shows only when the loading square really showed (a quick load stays quiet: no praise for nothing),
  /// and only when the island is on and the moments feature is on.
  static func showDbLoaded(loadingWasShown: Bool, islandOff: Bool, featureOn: Bool) -> Bool {
    loadingWasShown && !islandOff && featureOn
  }

  /// How long the island says "What's new" before the panel starts to come out of it.
  static let whatsNewLead: TimeInterval = 0.85

  /// How long the tick shows before the island is itself again.
  static let tickHold: TimeInterval = 1.6

  /// Shrink back into the island: how long the card takes to go, and how far up (a fraction of its height) it slides.
  static func backDuration(reduceMotion: Bool) -> TimeInterval { reduceMotion ? 0.15 : 0.3 }
  static let backTuck = 0.5
}
