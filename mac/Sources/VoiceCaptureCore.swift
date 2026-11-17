// Voice capture (PS 1.65), the rules: the permission states, when it may listen, the level meter, the session (start, stop,
// the two minute limit, 1Password or Signal coming to the front) and the split asked of Apple's on device model. Pure: no
// microphone, no speech framework, no window, no clock of its own, so tests/voice-test.sh runs it with a fake recogniser and a
// fake model. The real microphone, Apple's speech recognition and the bridge to the page are in VoiceCapture.swift; the page's
// half (the review list, the plain split, the dates) is web src/core/voicecapture.ts.
//
// Privacy: speech is recognised on this Mac only (requiresOnDeviceRecognition), the sound is never saved, the words go only to
// the page and to Apple's on device model, and nothing about them is ever logged.
import Foundation

// MARK: - permissions

/// One permission as macOS reports it (the microphone, or speech recognition).
enum VoiceAuth { case notDetermined, denied, restricted, authorized }

/// Both together, as the page shows them: "ready" both allowed, "ask" one never asked, "denied" one said no, "restricted"
/// this Mac does not allow it (a management profile, parental controls).
enum VoicePerm: String { case ready, ask, denied, restricted }

/// Why it will not listen now (sent to the page as voice:blocked).
enum VoiceBlock: String { case off, protected = "protected", onDevice, perm }

enum VoiceRules {
  /// The longest a recording runs before it stops by itself.
  static let maxSeconds: TimeInterval = 120
  /// After Stop, how long the recogniser may take for its last words before the words so far are used.
  static let finishGrace: TimeInterval = 2.5
  /// The level meter is sent at most this often (about 15 times a second: calm, and cheap for the page).
  static let levelEvery: TimeInterval = 1.0 / 15
  /// How long Apple's on device model may take to split (the page waits a little longer, web SPLIT_WAIT_MS).
  static let splitBudget: TimeInterval = 12

  static func perm(mic: VoiceAuth, speech: VoiceAuth) -> VoicePerm {
    if mic == .restricted || speech == .restricted { return .restricted }
    if mic == .denied || speech == .denied { return .denied }
    if mic == .notDetermined || speech == .notDetermined { return .ask }
    return .ready
  }

  /// nil: it may listen. The 1Password and Signal rule comes first, then the switch, then the permissions, then on device speech.
  /// A test copy (PS_SELFTEST) never listens.
  static func block(featureOn: Bool, perm: VoicePerm, onDevice: Bool, protectedFront: Bool, test: Bool) -> VoiceBlock? {
    if protectedFront { return .protected }
    if !featureOn || test { return .off }
    if perm != .ready { return .perm }
    if !onDevice { return .onDevice }
    return nil
  }

  /// Which System Settings page the button opens: the first of the two that is not allowed.
  static func settingsPane(mic: VoiceAuth, speech: VoiceAuth) -> String {
    let base = "x-apple.systempreferences:com.apple.preference.security?"
    return base + (mic != .authorized ? "Privacy_Microphone" : "Privacy_SpeechRecognition")
  }
}

// MARK: - the level meter

enum VoiceLevel {
  /// Root mean square of one buffer of samples (-1...1).
  static func rms(_ s: UnsafeBufferPointer<Float>) -> Float {
    guard !s.isEmpty else { return 0 }
    var sum: Float = 0
    for x in s where x.isFinite { sum += x * x }
    return (sum / Float(s.count)).squareRoot()
  }
  /// 0...1 for the meter: -55 dB (a quiet room) is 0, -12 dB (speaking up close) is 1.
  static func level(rms: Float) -> Float {
    guard rms.isFinite, rms > 0 else { return 0 }
    let db = 20 * log10(rms)
    return min(1, max(0, (db + 55) / 43))
  }
  /// Calm: rises quickly, falls slowly.
  static func smooth(_ prev: Float, _ new: Float) -> Float {
    let k: Float = new > prev ? 0.5 : 0.12
    return prev + (new - prev) * k
  }
}

// MARK: - the session

/// The microphone and the recogniser. The real one is AppleSpeech in VoiceCapture.swift; tests use a fake.
protocol VoiceRecognizer: AnyObject {
  /// Starts listening. `text` (words so far, isFinal), `level` (0...1 raw) and `failed` may be called on any thread.
  func start(text: @escaping (String, Bool) -> Void, level: @escaping (Float) -> Void, failed: @escaping () -> Void) throws
  /// The microphone stops at once; the recogniser gives its last words through `text` with isFinal.
  func finish()
  /// The microphone stops at once and nothing more comes.
  func cancel()
}

/// One recording at a time. Every method runs on the one serial queue the owner gives it (never the main thread), and so do
/// the recogniser's callbacks, through `hop`. `send` takes the messages for the page.
final class VoiceSessionCore {
  enum State: Equatable { case idle, recording, finishing }
  private(set) var state: State = .idle
  private(set) var words = ""
  private var rec: VoiceRecognizer?
  private var gen = 0
  private var level: Float = 0
  private var levelAt: TimeInterval = -1
  private let make: () -> VoiceRecognizer
  private let send: ([String: Any]) -> Void
  private let now: () -> TimeInterval
  private let after: (TimeInterval, @escaping () -> Void) -> Void
  private let hop: (@escaping () -> Void) -> Void
  /// Told when listening starts and ends, to watch the app in front only while it listens.
  var onListening: ((Bool) -> Void)?

  init(make: @escaping () -> VoiceRecognizer, send: @escaping ([String: Any]) -> Void, now: @escaping () -> TimeInterval,
       after: @escaping (TimeInterval, @escaping () -> Void) -> Void, hop: @escaping (@escaping () -> Void) -> Void) {
    self.make = make; self.send = send; self.now = now; self.after = after; self.hop = hop
  }

  /// The page asked to listen. `block` from VoiceRules.block.
  func start(block: VoiceBlock?) {
    if let block { send(["type": "voice:blocked", "why": block.rawValue]); return }
    // Already listening (the page was reloaded or a second window asked): the one recording goes on and the page is told,
    // so it never waits on "starting" for ever. While the last words are awaited the stop that follows tells it.
    if state == .recording { send(["type": "voice:started"]); return }
    if state != .idle { return }
    gen += 1
    let g = gen
    let r = make()
    words = ""; level = 0; levelAt = -1
    do {
      try r.start(text: { [weak self] t, fin in self?.hop { self?.heard(t, final: fin, g) } },
                  level: { [weak self] v in self?.hop { self?.levelIn(v, g) } },
                  failed: { [weak self] in self?.hop { self?.failedIn(g) } })
    } catch {
      r.cancel()
      send(["type": "voice:stopped", "reason": "error", "text": ""])
      return
    }
    rec = r
    state = .recording
    onListening?(true)
    send(["type": "voice:started"])
    after(VoiceRules.maxSeconds) { [weak self] in self?.hop { self?.limit(g) } }
  }

  /// Stop (the page's Stop, a let go after a hold): the last words are waited for, a little.
  func stop() {
    guard state == .recording, let r = rec else { return }
    state = .finishing
    onListening?(false)
    r.finish()
    let g = gen
    after(VoiceRules.finishGrace) { [weak self] in self?.hop { self?.end("user", g) } }
  }

  /// Esc, the window closed: stop at once, keep nothing.
  func cancel() {
    guard state != .idle else { return }
    rec?.cancel()
    finishUp()
    words = ""
    send(["type": "voice:stopped", "reason": "cancel", "text": ""])
  }

  /// 1Password or Signal came to the front: the microphone stops at once; the words heard before it are kept.
  func protectedFront() {
    guard state != .idle else { return }
    rec?.cancel()
    let w = words
    finishUp()
    send(["type": "voice:stopped", "reason": "protected", "text": w])
  }

  // MARK: from the recogniser (on the queue)

  private func heard(_ t: String, final: Bool, _ g: Int) {
    guard g == gen, state != .idle else { return }
    words = String(t.prefix(4000))
    if state == .recording { send(["type": "voice:partial", "text": words]) }
    if final { end("user", g) }
  }
  private func levelIn(_ v: Float, _ g: Int) {
    guard g == gen, state == .recording else { return }
    level = VoiceLevel.smooth(level, v)
    let t = now()
    if levelAt >= 0 && t - levelAt < VoiceRules.levelEvery { return }
    levelAt = t
    send(["type": "voice:level", "v": Double((level * 100).rounded() / 100)])
  }
  private func failedIn(_ g: Int) {
    guard g == gen, state != .idle else { return }
    // After Stop a recogniser often ends with an error ("no speech"): the words so far are the answer.
    end(state == .finishing || !words.isEmpty ? "user" : "error", g)
  }
  private func limit(_ g: Int) {
    guard g == gen, state == .recording, let r = rec else { return }
    state = .finishing
    onListening?(false)
    r.finish()
    after(VoiceRules.finishGrace) { [weak self] in self?.hop { self?.end("limit", g) } }
    // The limit is said even when the last words come in time.
    limitHit = g
  }
  private var limitHit = -1

  private func end(_ reason: String, _ g: Int) {
    guard g == gen, state != .idle else { return }
    rec?.cancel()
    let w = words
    let why = limitHit == g ? "limit" : reason
    finishUp()
    send(["type": "voice:stopped", "reason": why, "text": w])
  }
  private func finishUp() {
    let was = state
    state = .idle
    rec = nil
    gen += 1   // anything late from this recording is dropped
    if was == .recording { onListening?(false) }
  }
}

// MARK: - the split by Apple's on device model

enum VoiceSplit {
  /// The same rules as web src/core/voicecapture.ts SPLIT_RULES (the web test checks every line is here).
  static let rules: [String] = [
    "Split what the person said into separate to do tasks.",
    "Use the person's own words. Do not add anything they did not say.",
    "Keep every word about dates, times and repeats exactly as said, in the task it belongs to.",
    "Drop filler like um, okay, I need to, remind me to.",
    "Answer only with JSON: {\"tasks\": [\"first task\", \"second task\"]}",
  ]
  static var instructions: String { rules.joined(separator: "\n") }

  /// What is sent: the words only, at most 4000 characters, no control characters.
  static func clean(_ text: String) -> String {
    let t = String(text.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) || $0 == "\n" }.prefix(4000))
    return t.trimmingCharacters(in: .whitespacesAndNewlines)
  }
  static func prompt(_ text: String) -> String { "What the person said:\n" + clean(text) }

  /// Asks `model` (instructions, prompt, cancel) once, off the calling thread, and calls `done` ONCE with the model's text
  /// (the page checks it, web checkModelTasks) or nil: no model, an empty request, a failure, or out of time.
  static func run(text: String, model: ((String, String, AssistCancel) throws -> String)?, timeout: TimeInterval = VoiceRules.splitBudget,
                  done: @escaping (String?) -> Void) {
    let words = clean(text)
    guard let model, !words.isEmpty else { done(nil); return }
    let lock = NSLock()
    var finished = false
    let cancel = AssistCancel()
    func finish(_ s: String?) {
      lock.lock(); if finished { lock.unlock(); return }; finished = true; lock.unlock()
      cancel.cancel()
      done(s.map { String($0.prefix(20000)) })
    }
    DispatchQueue(label: "ps.voice.split", qos: .userInitiated).async {
      let out = try? model(instructions, prompt(words), cancel)
      finish(out)
    }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout) { finish(nil) }
  }
}
