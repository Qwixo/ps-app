// Voice capture (PS 1.65), the real world: the microphone (AVAudioEngine), Apple's speech recognition ON THIS MAC ONLY
// (requiresOnDeviceRecognition: nothing is sent to Apple's servers; where this Mac cannot recognise the language on device,
// it says so and does not listen), the two permissions (asked only on the first click of the microphone button), the
// 1Password and Signal rule (never listens while one is in front, stops at once if one comes to the front), Apple's on
// device model to split the words into tasks (the Settings assistant's own provider, AssistProviders.swift), and the bridge
// to the page (window.__psVoice). The rules are in VoiceCaptureCore.swift (tests/voice-test.sh, fakes only).
//
// Nothing here runs on the main thread except taking a message from the page and the one call that opens System Settings.
// The sound is never saved, the words are never logged, and a test copy (PS_SELFTEST) never touches the microphone.
import AVFoundation
import Cocoa
import Speech
import WebKit

/// The real recogniser: the microphone into Apple's speech recognition, on this Mac only.
final class AppleSpeech: VoiceRecognizer {
  private let engine = AVAudioEngine()
  private let recognizer: SFSpeechRecognizer
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var tapped = false
  enum Failure: Error { case noMicrophone, notOnDevice }

  init(_ recognizer: SFSpeechRecognizer, callbacks: OperationQueue) {
    self.recognizer = recognizer
    recognizer.queue = callbacks   // its answers come off the main thread
  }

  func start(text: @escaping (String, Bool) -> Void, level: @escaping (Float) -> Void, failed: @escaping () -> Void) throws {
    guard recognizer.supportsOnDeviceRecognition else { throw Failure.notOnDevice }
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.requiresOnDeviceRecognition = true      // the golden privacy line: never Apple's servers
    req.shouldReportPartialResults = true
    req.addsPunctuation = true                  // full stops and commas help the split
    req.taskHint = .dictation
    let input = engine.inputNode
    let fmt = input.outputFormat(forBus: 0)
    guard fmt.sampleRate > 0, fmt.channelCount > 0 else { throw Failure.noMicrophone }
    input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buf, _ in
      req.append(buf)
      if let ch = buf.floatChannelData, buf.frameLength > 0 {
        level(VoiceLevel.level(rms: VoiceLevel.rms(UnsafeBufferPointer(start: ch[0], count: Int(buf.frameLength)))))
      }
    }
    tapped = true
    engine.prepare()
    do { try engine.start() } catch { stopMicrophone(); throw error }
    request = req
    task = recognizer.recognitionTask(with: req) { res, err in
      if let res { text(res.bestTranscription.formattedString, res.isFinal) }
      if err != nil, res?.isFinal != true { failed() }
    }
  }
  func finish() { stopMicrophone(); request?.endAudio() }
  func cancel() { stopMicrophone(); task?.cancel(); task = nil; request = nil }
  private func stopMicrophone() {
    if tapped { engine.inputNode.removeTap(onBus: 0); tapped = false }
    if engine.isRunning { engine.stop() }
  }
}

/// No recogniser for this Mac's language at all: starting fails, so the page says it stopped.
final class NoSpeech: VoiceRecognizer {
  func start(text: @escaping (String, Bool) -> Void, level: @escaping (Float) -> Void, failed: @escaping () -> Void) throws { throw AppleSpeech.Failure.notOnDevice }
  func finish() {}
  func cancel() {}
}

final class VoiceCapture {
  static let shared = VoiceCapture()
  static let feature = "voice-capture"
  private let test = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  private let queue = DispatchQueue(label: "ps.voice", qos: .userInitiated)
  private lazy var callbacks: OperationQueue = { let q = OperationQueue(); q.underlyingQueue = queue; q.maxConcurrentOperationCount = 1; return q }()
  private weak var page: WKWebView?
  private var frontWatch: NSObjectProtocol?
  private lazy var core: VoiceSessionCore = {
    let c = VoiceSessionCore(
      make: { [unowned self] () -> VoiceRecognizer in
        if let r = SFSpeechRecognizer() { return AppleSpeech(r, callbacks: self.callbacks) }
        return NoSpeech()
      },
      send: { [weak self] m in self?.send(m) },
      now: { ProcessInfo.processInfo.systemUptime },
      after: { [weak self] s, f in self?.queue.asyncAfter(deadline: .now() + s, execute: f) },
      hop: { [weak self] f in self?.queue.async(execute: f) })
    c.onListening = { [weak self] on in self?.watchFront(on) }
    return c
  }()

  /// From main.swift's message switch (main thread). True when the message was voice capture's.
  @discardableResult func handle(_ type: String, _ msg: [String: Any], from web: WKWebView?) -> Bool {
    guard type.hasPrefix("voice:") else { return false }
    if let web { page = web }
    // Read on the main thread, where they are kept, then handed to the voice queue.
    let on = Features.on(Self.feature), front = Protected.front
    switch type {
    case "voice:status": queue.async { [self] in sendStatus(on) }
    case "voice:ask": if on && !test { ask() }
    case "voice:start":
      queue.async { [self] in
        let (mic, speech) = Self.auth()
        let perm = VoiceRules.perm(mic: mic, speech: speech)
        let block = VoiceRules.block(featureOn: on, perm: perm, onDevice: perm == .ready && Self.onDevice(), protectedFront: front, test: test)
        if block == nil { psLog("PS voice capture: listening") }   // never the words
        core.start(block: block)
      }
    case "voice:stop": queue.async { [self] in core.stop() }
    case "voice:cancel": queue.async { [self] in core.cancel() }
    case "voice:split":
      guard let id = msg["id"] as? String, let text = msg["text"] as? String else { return true }
      let model: ((String, String, AssistCancel) throws -> String)? = on && !test ? { i, p, c in try AssistAppleProvider.respond(instructions: i, prompt: p, cancel: c) } : nil
      queue.async {
        VoiceSplit.run(text: text, model: AssistAppleProvider.whyNot() == nil ? model : nil) { [weak self] out in
          self?.send(["type": "voice:tasks", "id": String(id.prefix(64)), "tasks": out ?? NSNull()])
        }
      }
    case "voice:settings":
      let (mic, speech) = Self.auth()
      if !test, let u = URL(string: VoiceRules.settingsPane(mic: mic, speech: speech)) { NSWorkspace.shared.open(u) }
    default: return false
    }
    return true
  }

  // MARK: permissions and on device speech

  private static func auth() -> (VoiceAuth, VoiceAuth) {
    let mic: VoiceAuth
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: mic = .authorized
    case .denied: mic = .denied
    case .restricted: mic = .restricted
    default: mic = .notDetermined
    }
    let speech: VoiceAuth
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: speech = .authorized
    case .denied: speech = .denied
    case .restricted: speech = .restricted
    default: speech = .notDetermined
    }
    return (mic, speech)
  }
  private static func onDevice() -> Bool { SFSpeechRecognizer()?.supportsOnDeviceRecognition ?? false }
  private static func language() -> String {
    let id = SFSpeechRecognizer()?.locale.identifier ?? Locale.current.identifier
    return Locale(identifier: "en").localizedString(forIdentifier: id) ?? id
  }

  private func sendStatus(_ on: Bool) {
    let (mic, speech) = Self.auth()
    let perm = VoiceRules.perm(mic: mic, speech: speech)
    send(["type": "voice:status", "supported": on && !test, "perm": perm.rawValue, "onDevice": Self.onDevice(), "lang": Self.language()])
  }

  /// The first click: macOS asks for the microphone, then for speech recognition (each only if never asked). The page shows
  /// the one plain line why while it does.
  private func ask() {
    psLog("PS voice capture: asking for the microphone and speech recognition")
    let after = { [weak self] in
      self?.queue.async {
        let (mic, speech) = Self.auth()
        let perm = VoiceRules.perm(mic: mic, speech: speech)
        self?.send(["type": "voice:perm", "perm": perm.rawValue, "onDevice": Self.onDevice()])
      }
    }
    let speechThen = {
      if SFSpeechRecognizer.authorizationStatus() == .notDetermined { SFSpeechRecognizer.requestAuthorization { _ in after() } } else { after() }
    }
    if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
      AVCaptureDevice.requestAccess(for: .audio) { ok in if ok { speechThen() } else { after() } }
    } else { speechThen() }
  }

  // MARK: 1Password and Signal: watched only while listening

  private func watchFront(_ on: Bool) {
    if let w = frontWatch { NSWorkspace.shared.notificationCenter.removeObserver(w); frontWatch = nil }
    guard on else { return }
    frontWatch = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: callbacks) { [weak self] n in
      // Only whether the app now in front IS one of them (Protected.swift): never its name, window or anything else.
      if Protected.matches(n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication) {
        psLog("PS voice capture: stopped, a protected app came to the front")
        self?.core.protectedFront()
      }
    }
  }

  // MARK: to the page

  private func send(_ m: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: m), var s = String(data: d, encoding: .utf8) else { return }
    s = s.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    let js = "window.__psVoice && window.__psVoice(\(s))"
    DispatchQueue.main.async { [weak self] in self?.page?.evaluateJavaScript(js, completionHandler: nil) }
  }
}
