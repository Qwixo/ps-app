// Screen recorder, the real capture (PS 1.60, pull request 12a). The rules and the state are in ScreenRecCore.swift (tested
// without recording); this file only plugs real macOS into its two protocols.
//
// OFF by default. While the person has not said yes (Settings, Screen recording, or the setup menu), nothing in here runs:
// ScreenRec.shared.handle() answers "off" before it reaches any capture or permission call, and start() below is never
// reached. No macOS permission is asked until the person presses the button that explains it first.
//
// Engine (decided in briefs/pr12-research.md): ScreenCaptureKit for the picture and the computer sound, an AVAssetWriter on
// every macOS version, writing a FRAGMENTED movie (movieFragmentInterval, plus initialMovieFragmentInterval on macOS 14 and
// later) so a crash or a power cut keeps everything recorded so far. Two separate sound tracks: the first is "Me" (the mic),
// the second "Them" (the computer sound). The mic comes from the same stream on macOS 15 and later (captureMicrophone) and
// from an AVCaptureSession below that, and always from an AVCaptureSession when only the mic is wanted (no screen permission
// is needed then). Every newer API sits behind #available because PS runs on macOS 13. Public Apple APIs only.
// PS itself (its sound and its windows) is always left out, together with the apps the person ticked.
//
// Nothing here records on its own, and nothing is sent anywhere. Files go to the chosen folder, or the default one
// (~/Movies/PS Recordings) when the chosen one is missing or nearly full.
import Foundation
import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

let SR_FEATURE = "screen-recording"

// ---------- real macOS permissions ----------
final class SRRealPermissions: SRPermissionsAPI {
  func screen() -> SRPerm { CGPreflightScreenCaptureAccess() ? .granted : .unknown }
  func mic() -> SRPerm {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return .granted
    case .denied, .restricted: return .denied
    default: return .unknown
    }
  }
  func requestScreen() { _ = CGRequestScreenCaptureAccess() }
  func requestMic(_ done: @escaping (Bool) -> Void) { AVCaptureDevice.requestAccess(for: .audio) { ok in DispatchQueue.main.async { done(ok) } } }
}

// ---------- real capture ----------
final class SRRealCapture: NSObject, SRCaptureAPI, SRAdjustableCapture, SCStreamOutput, SCStreamDelegate, AVCaptureAudioDataOutputSampleBufferDelegate {
  /// Where this recording's file goes (the chosen folder's access is already open), and what to do when macOS or an error ends it.
  var folderURL: (Bool) -> URL = { _ in FileManager.default.temporaryDirectory }
  var onEnded: ((String?) -> Void)?

  private let work = DispatchQueue(label: "ps.screenrec.work")     // every append and every state change, one at a time
  private var stream: SCStream?
  private var micSession: AVCaptureSession?
  private var writer: AVAssetWriter?
  private var video: AVAssetWriterInput?
  private var me: AVAssetWriterInput?
  private var them: AVAssetWriterInput?
  private var plan: SRPlan?
  private let appender = SRAppender()          // the sample times and the failure rule (tested with a fake writer)
  private let finisher = SRFinisher()          // a second finish waits for the first; an old one never clears a newer recording
  private var generation = 0
  private var streamConfig: SCStreamConfiguration?

  // ----- start -----
  func start(_ plan: SRPlan, done: @escaping (Error?) -> Void) {
    work.async {
      self.gapLock.lock(); self.gaps = SRFrameGaps(); self.gapLock.unlock(); self.currentFps = nil
      self.appender.reset(); self.generation = self.finisher.begin()
      self.appender.onFail = { [weak self] m in self?.writerDidFail(m) }
      self.plan = plan
      do { try self.makeWriter(plan) } catch { DispatchQueue.main.async { done(error) }; return }
      let needScreen = SRNeeds.screen(SRSettings.forPlan(plan))
      let micFromStream: Bool = { if #available(macOS 15.0, *) { return plan.micOn && needScreen } else { return false } }()
      if plan.micOn && !micFromStream { if let e = self.startMicSession(plan) { self.discardWriter(); DispatchQueue.main.async { done(e) }; return } }
      guard needScreen else { DispatchQueue.main.async { done(nil) }; return }
      SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, err in
        self.work.async {
          guard let content, err == nil else { self.abortStart(err ?? SRError.msg("PS could not list the screens. Is screen recording allowed in System Settings?"), done); return }
          do { try self.startStream(plan, content: content, micFromStream: micFromStream) } catch { self.abortStart(error, done); return }
          self.stream?.startCapture { e in
            if let e { self.work.async { self.abortStart(e, done) } } else { DispatchQueue.main.async { done(nil) } }
          }
        }
      }
    }
  }

  private func abortStart(_ e: Error, _ done: @escaping (Error?) -> Void) {
    let m = micSession; micSession = nil; stream = nil
    if let m { DispatchQueue.global(qos: .userInitiated).async { m.stopRunning() } }
    discardWriter()
    DispatchQueue.main.async { done(e) }
  }
  private func discardWriter() {
    if let w = writer, w.status == .writing || w.status == .unknown { w.cancelWriting() }
    if let u = writer?.outputURL { try? FileManager.default.removeItem(at: u) }
    writer = nil; video = nil; me = nil; them = nil
  }

  private func makeWriter(_ p: SRPlan) throws {
    let dir = folderURL(p.folderIsDefault)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent(p.fileName)
    // The audio only file is an MPEG 4 container named .m4a: it takes two sound tracks and a fragmented layout, and plays everywhere.
    let w = try AVAssetWriter(outputURL: url, fileType: p.mode == .audioOnly ? .mp4 : .mov)
    w.movieFragmentInterval = CMTime(seconds: 10, preferredTimescale: 600)
    if #available(macOS 14.0, *) { w.initialMovieFragmentInterval = CMTime(seconds: 1, preferredTimescale: 600) }
    w.shouldOptimizeForNetworkUse = false
    if p.mode == .screenAndAudio {
      let comp: [String: Any] = [AVVideoAverageBitRateKey: p.videoBitrate, AVVideoExpectedSourceFrameRateKey: p.fps,
                                 AVVideoMaxKeyFrameIntervalDurationKey: 2, AVVideoAllowFrameReorderingKey: false]
      let v = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: p.codec == .hevc ? AVVideoCodecType.hevc : AVVideoCodecType.h264,
                                                                      AVVideoWidthKey: p.width, AVVideoHeightKey: p.height, AVVideoCompressionPropertiesKey: comp])
      v.expectsMediaDataInRealTime = true
      guard w.canAdd(v) else { throw SRError.msg("PS could not set up the picture.") }
      w.add(v); video = v
    }
    func audio(_ channels: Int) -> AVAssetWriterInput {
      let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000,
                                                                      AVNumberOfChannelsKey: channels, AVEncoderBitRateKey: p.audioBitrate * channels / (channels == 2 ? 2 : 1)])
      a.expectsMediaDataInRealTime = true
      return a
    }
    // Track order is part of the file's meaning: the first sound track is "Me", the second "Them".
    if p.micOn { let a = audio(1); guard w.canAdd(a) else { throw SRError.msg("PS could not set up the sound.") }; w.add(a); me = a }
    if p.computerSound { let a = audio(2); guard w.canAdd(a) else { throw SRError.msg("PS could not set up the sound.") }; w.add(a); them = a }
    guard w.startWriting() else { throw w.error ?? SRError.msg("PS could not start the file.") }
    writer = w
  }

  private func startMicSession(_ p: SRPlan) -> Error? {
    let dev = p.micUID.flatMap { AVCaptureDevice(uniqueID: $0) } ?? AVCaptureDevice.default(for: .audio)
    guard let dev, let input = try? AVCaptureDeviceInput(device: dev) else { return SRError.msg("PS could not open the microphone.") }
    let s = AVCaptureSession()
    let out = AVCaptureAudioDataOutput()
    out.setSampleBufferDelegate(self, queue: work)
    guard s.canAddInput(input), s.canAddOutput(out) else { return SRError.msg("PS could not open the microphone.") }
    s.addInput(input); s.addOutput(out)
    micSession = s
    DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
    return nil
  }

  private func startStream(_ p: SRPlan, content: SCShareableContent, micFromStream: Bool) throws {
    let own = Bundle.main.bundleIdentifier
    let leave = Set(p.excludedApps)
    // Rule 7, every build: 1Password and Signal are always left out of the picture AND the sound, whatever was ticked (SRProtect, by bundle id).
    let out = Set(SRProtect.excludedAppIDs(running: content.applications.map { $0.bundleIdentifier }, chosen: p.excludedApps, own: own))
    let apps = content.applications.filter { out.contains($0.bundleIdentifier) }
    let display = content.displays.first(where: { p.source.kind == "display" && $0.displayID == p.source.id }) ?? content.displays.first(where: { $0.displayID == CGMainDisplayID() }) ?? content.displays.first
    guard let display else { throw SRError.msg("PS could not find a screen to record.") }
    let cfg = SCStreamConfiguration()
    var filter: SCContentFilter
    if p.mode == .audioOnly {
      filter = SCContentFilter(display: display, excludingApplications: apps, exceptingWindows: [])
      cfg.width = 16; cfg.height = 16; cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)   // the picture is thrown away
    } else if p.source.kind == "window", let win = content.windows.first(where: { $0.windowID == p.source.id }), !SRProtect.mayRecordWindow(ownerBundle: win.owningApplication?.bundleIdentifier) {
      throw SRError.msg("PS cannot record that window. Choose another one.")   // 1Password, Signal or an owner PS cannot check: never recorded
    } else if p.source.kind == "window", let win = content.windows.first(where: { $0.windowID == p.source.id }), !leave.contains(win.owningApplication?.bundleIdentifier ?? "") {
      filter = SCContentFilter(desktopIndependentWindow: win)
      var w = Double(win.frame.width) * 2, h = Double(win.frame.height) * 2
      if h > Double(p.height) { let k = Double(p.height) / h; w *= k; h = Double(p.height) }
      cfg.width = SRMath.even(w); cfg.height = SRMath.even(h)
      cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(p.fps))
    } else {
      filter = SCContentFilter(display: display, excludingApplications: apps, exceptingWindows: [])
      cfg.width = p.width; cfg.height = p.height
      cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(p.fps))
    }
    cfg.queueDepth = 6
    cfg.showsCursor = true
    cfg.capturesAudio = p.computerSound
    if p.computerSound { cfg.excludesCurrentProcessAudio = true; cfg.sampleRate = 48_000; cfg.channelCount = 2 }
    if micFromStream, #available(macOS 15.0, *) { cfg.captureMicrophone = true; if let id = p.micUID { cfg.microphoneCaptureDeviceID = id } }
    streamConfig = cfg
    let s = SCStream(filter: filter, configuration: cfg, delegate: self)
    try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: work)
    if p.computerSound { try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: work) }
    if micFromStream, #available(macOS 15.0, *) { try s.addStreamOutput(self, type: .microphone, sampleHandlerQueue: work) }
    stream = s
  }

  // ----- 12b: the performance watch's two doors into the capture -----
  private let gapLock = NSLock()
  private var gaps = SRFrameGaps()
  private var currentFps: Int?
  /// The share of frames missed since the last look (read every few seconds by the watch, only while recording).
  func takeDropRatio() -> Double { gapLock.lock(); defer { gapLock.unlock() }; return gaps.ratioAndReset() }
  /// Only the frame rate can change while a file is open: its picture size and bitrate are fixed once the writer has started, so the
  /// resolution and quality steps are left out of the ladder (SRLadder skips what the capture cannot do).
  var canAdjust: SRAdjustable { SRAdjustable(fps: true, resolution: false, quality: false) }
  func adjust(_ step: SRStep) {
    guard case .fps(let f) = step else { return }
    work.async {
      guard let cfg = self.streamConfig, let s = self.stream, self.plan?.mode == .screenAndAudio else { return }
      cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(f))
      self.currentFps = f
      s.updateConfiguration(cfg) { _ in }
    }
  }

  // ----- samples (all on `work`) -----
  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard CMSampleBufferIsValid(sb), CMSampleBufferDataIsReady(sb) else { return }
    switch type {
    case .screen:
      guard let p = plan, p.mode == .screenAndAudio, let v = video else { return }
      // 12b: count gaps in the frames ourselves (SCStream has no dropped frame counter). Idle frames count as frames, so a still screen is not a drop.
      if !appender.isPaused { gapLock.lock(); gaps.note(at: CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb)), interval: 1.0 / Double(max(1, currentFps ?? p.fps))); gapLock.unlock() }
      // Only finished frames (idle and blank frames carry no picture).
      if let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
         let raw = arr.first?[.status] as? Int, SCFrameStatus(rawValue: raw) != .complete { return }
      if !v.isReadyForMoreMediaData { gapLock.lock(); gaps.notReady(); gapLock.unlock() }
      append(sb, to: v, track: .video, startsSession: true)
    case .audio:
      if let a = them { append(sb, to: a, track: .them, startsSession: plan?.mode == .audioOnly) }
    default:
      if #available(macOS 15.0, *), type == .microphone, let a = me { append(sb, to: a, track: .me, startsSession: plan?.mode == .audioOnly) }
    }
  }
  func captureOutput(_ output: AVCaptureOutput, didOutput sb: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard CMSampleBufferIsValid(sb), CMSampleBufferDataIsReady(sb), let a = me else { return }
    append(sb, to: a, track: .me, startsSession: plan?.mode == .audioOnly)
  }

  private func append(_ sb: CMSampleBuffer, to input: AVAssetWriterInput, track: SRTrack, startsSession: Bool) {
    guard let w = writer, w.status == .writing else { return }
    // The times (strictly increasing per track, through a pause) and the failure rule are SRAppender's, tested with a fake writer.
    appender.sample(track, pts: CMSampleBufferGetPresentationTimeStamp(sb), startsSession: startsSession,
                    open: { at in w.startSession(atSourceTime: at) },
                    write: { off in
      guard input.isReadyForMoreMediaData else { return .notReady }
      let out = off == .zero ? sb : (Self.retimed(sb, by: off) ?? sb)
      if input.append(out) { return .ok }
      return w.status == .failed ? .failed(w.error?.localizedDescription ?? "The file could not be written.") : .ok
    })
  }
  private static func retimed(_ sb: CMSampleBuffer, by off: CMTime) -> CMSampleBuffer? {
    var n: CMItemCount = 0
    CMSampleBufferGetSampleTimingInfoArray(sb, entryCount: 0, arrayToFill: nil, entriesNeededOut: &n)
    guard n > 0 else { return nil }
    var info = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: n)
    CMSampleBufferGetSampleTimingInfoArray(sb, entryCount: n, arrayToFill: &info, entriesNeededOut: &n)
    for i in 0..<info.count {
      info[i].presentationTimeStamp = CMTimeSubtract(info[i].presentationTimeStamp, off)
      if info[i].decodeTimeStamp.isValid { info[i].decodeTimeStamp = CMTimeSubtract(info[i].decodeTimeStamp, off) }
    }
    var out: CMSampleBuffer?
    CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: sb, sampleTimingEntryCount: n, sampleTimingArray: &info, sampleBufferOut: &out)
    return out
  }

  // ----- pause, resume, stop -----
  func pause() { work.async { self.gapLock.lock(); self.gaps.breakLine(); self.gapLock.unlock(); self.appender.pause() } }
  /// The gap while paused is cut out: the first sample after the resume lands one step after the last kept one (SRRetimer).
  func resume() { work.async { self.gapLock.lock(); self.gaps.breakLine(); self.gapLock.unlock(); self.appender.resume() } }

  /// Another microphone while recording: swap the session's input, or (macOS 15 and later, mic inside the stream) update the stream.
  func switchMic(_ uid: String?) {
    work.async {
      if let s = self.micSession {
        guard let dev = uid.flatMap({ AVCaptureDevice(uniqueID: $0) }) ?? AVCaptureDevice.default(for: .audio), let input = try? AVCaptureDeviceInput(device: dev) else { return }
        s.beginConfiguration()
        s.inputs.forEach { s.removeInput($0) }
        if s.canAddInput(input) { s.addInput(input) }
        s.commitConfiguration()
      } else if #available(macOS 15.0, *), let st = self.stream, let cfg = self.streamConfig {
        cfg.microphoneCaptureDeviceID = uid
        st.updateConfiguration(cfg) { _ in }
      }
    }
  }

  /// Stops the picture and the mic OFF the main thread (stopRunning blocks), then closes the file. Everything about `stream` and
  /// `micSession` is read and written on `work` only.
  func stop(done: @escaping () -> Void) {
    work.async { self.stopSources { self.finish(error: nil, then: done) } }
  }
  private func stopSources(_ then: @escaping () -> Void) {   // on `work`
    let s = stream, m = micSession
    stream = nil; micSession = nil
    DispatchQueue.global(qos: .userInitiated).async {
      let g = DispatchGroup()
      if let s { g.enter(); s.stopCapture { _ in g.leave() } }
      m?.stopRunning()
      g.notify(queue: self.work) { then() }
    }
  }
  /// On `work`. A second call waits for the first one's completion before it answers; an old file's end never touches a newer recording.
  private func finish(error: String?, then: (() -> Void)? = nil) {
    let g = generation
    let wait = then.map { c in { DispatchQueue.main.async { c() } } }
    guard finisher.request(then: wait) else { return }
    appender.end()
    guard let w = writer else { closed(g, error: error, url: nil); return }
    if w.status != .writing { closed(g, error: error ?? w.error?.localizedDescription, url: nil); return }
    [video, me, them].forEach { $0?.markAsFinished() }
    let url = w.outputURL
    w.finishWriting { [weak self] in
      let msg = error ?? (w.status == .failed ? (w.error?.localizedDescription ?? "The file could not be saved.") : nil)
      self?.work.async { self?.closed(g, error: msg, url: url) }
    }
  }
  private func closed(_ g: Int, error: String?, url: URL?) {
    let mine = finisher.isCurrent(g)
    if mine { writer = nil; video = nil; me = nil; them = nil }          // only the recording that just ended: a newer one keeps its writer
    let waiters = finisher.complete(g)
    DispatchQueue.main.async {
      if let url { self.lastFile = url }
      if mine { self.onEnded?(error) }
      waiters.forEach { $0() }
    }
  }
  /// The writer failed in the middle (the drive went away, the disk is full): stop picture and sound, close what was written, tell the app.
  private func writerDidFail(_ m: String) {   // on `work`
    stopSources { self.finish(error: nil) }
    DispatchQueue.main.async { self.onWriterFailed?(m) }
  }
  var onWriterFailed: ((String) -> Void)?
  private(set) var lastFile: URL?

  // ----- macOS ended the stream (the person used the system's own stop, or the screen went away) -----
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    work.async { self.stopSources { self.finish(error: nil) } }
    DispatchQueue.main.async { self.onStopped?() }
  }
  var onStopped: (() -> Void)?
}

enum SRError: LocalizedError {
  case msg(String)
  var errorDescription: String? { if case .msg(let m) = self { return m }; return nil }
}
extension SRSettings {
  /// Just enough of a plan as settings, to ask SRNeeds the same question the controller asks.
  static func forPlan(_ p: SRPlan) -> SRSettings { var s = SRSettings(); s.mode = p.mode; s.computerSound = p.computerSound; s.micOn = p.micOn; return s }
}

// ---------- the recorder as the app uses it ----------
final class ScreenRec {
  static let shared = ScreenRec()
  /// A JSON line for both pages (window.__psScreenRec).
  var deliver: ((String) -> Void)?
  /// Private mode (PrivateHold.shared.on), read by 12b's island; the button's own signs are decided on the page.
  var privateOn: () -> Bool = { false }

  private let defaults = UserDefaults.standard
  private let key = "screenrec.settings", bookmarkKey = "screenrec.bookmark"
  private let capture = SRRealCapture()
  private(set) var controller: SRController!
  private var scoped: URL?
  private var started = false
  private var testTimer: Timer?

  static var defaultFolder: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Movies/PS Recordings", isDirectory: true) }

  /// Builds the controller. Reads only the saved choices: no capture object does anything, no permission is touched.
  func start() {
    guard !started else { return }
    started = true
    var s = SRSettings()
    if let d = defaults.data(forKey: key), let o = try? JSONDecoder().decode(SRSettings.self, from: d) { s = o }
    controller = SRController(settings: s, featureOn: { Features.on(SR_FEATURE) }, perms: SRRealPermissions(), capture: capture)
    controller.ownBundleID = Bundle.main.bundleIdentifier
    controller.screenInfo = { Self.screenSize() }
    controller.folders = { [weak self] in self?.folderStates() ?? (nil, SRFolderState(exists: true, writable: true, freeBytes: 0)) }
    controller.takenNames = { [weak self] in self?.namesTaken() ?? [] }
    controller.onChange = { [weak self] snap in
      if snap.state == .starting { self?.noteUsed(snap.fileName) }
      self?.push(); ScreenRecIsland.shared.recorderChanged()
    }
    ScreenRecIsland.shared.attach(controller: controller, capture: capture)   // 12b: builds the island side; starts no clock while the gate is closed
    ScreenRecIsland.shared.sync()
    capture.folderURL = { [weak self] useDefault in self?.openFolder(useDefault: useDefault) ?? ScreenRec.defaultFolder }
    capture.onEnded = { [weak self] msg in
      guard let self else { return }
      self.closeScope()
      if let msg, self.controller.snapshot.error == nil { self.controller.noteError(msg) }   // a failure the controller already said keeps its own words
      self.push()
    }
    capture.onStopped = { [weak self] in self?.controller.stop(); self?.push() }
    capture.onWriterFailed = { [weak self] m in self?.controller.writerFailed(m); self?.push() }
    // The feature switched off (Settings, From the squad) stops and saves a recording at once, and cancels a start or a count in.
    Features.onChange = { [weak self] in ScreenRecIsland.shared.gateChanged(); self?.push(); ScreenRecIsland.shared.sync() }
  }

  // ----- folders -----
  private func resolvedCustom() -> URL? {
    guard let data = defaults.data(forKey: bookmarkKey) else { return nil }
    var stale = false
    guard let u = try? URL(resolvingBookmarkData: data, options: [.withSecurityScope, .withoutMounting], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }   // never tries to mount a missing network drive
    if stale, let fresh = try? u.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) { defaults.set(fresh, forKey: bookmarkKey) }
    return u
  }
  private static func state(of u: URL) -> SRFolderState {
    var isDir: ObjCBool = false
    let exists = FileManager.default.fileExists(atPath: u.path, isDirectory: &isDir) && isDir.boolValue
    // A volume that does not report the important usage figure (a network drive) falls back to the plain one; unknown is unknown, never zero.
    let rv = try? u.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey])
    let free: Int64 = rv?.volumeAvailableCapacityForImportantUsage ?? rv?.volumeAvailableCapacity.map { Int64($0) } ?? Int64.max
    return SRFolderState(exists: exists, writable: exists && FileManager.default.isWritableFile(atPath: u.path), freeBytes: free)
  }
  // The folder and disk reads (bookmark, security scope, free space, a directory listing of maybe a slow drive) never run on the main
  // thread: a utility queue fills a small cache, and everything that needs an answer on the main thread reads the cache.
  private let diskQueue = DispatchQueue(label: "ps.screenrec.disk", qos: .utility)
  private let cacheLock = NSLock()
  private var cache: (states: (custom: SRFolderState?, fallback: SRFolderState), names: Set<String>, at: Date)?
  private var refreshing = false
  private var usedNames = Set<String>()
  private func cached() -> (states: (custom: SRFolderState?, fallback: SRFolderState), names: Set<String>, at: Date)? { cacheLock.lock(); defer { cacheLock.unlock() }; return cache }
  /// Looks again off the main thread; `then` (main) when it is fresh.
  func refreshFolders(then: (() -> Void)? = nil) {
    cacheLock.lock(); let busy = refreshing; refreshing = true; cacheLock.unlock()
    if busy { return }
    diskQueue.async { [weak self] in
      guard let self else { return }
      let st = self.folderStatesNow(), nm = self.namesTakenNow()
      self.cacheLock.lock(); self.cache = (st, nm, Date()); self.refreshing = false; self.cacheLock.unlock()
      DispatchQueue.main.async { then?(); self.push() }
    }
  }
  /// The last read (at most half a minute old while the gate is open, refreshed on every state push), or a quick read when there is none yet.
  private func folderStates() -> (custom: SRFolderState?, fallback: SRFolderState) {
    if let c = cached() { if Date().timeIntervalSince(c.at) > 20 { refreshFolders() }; return c.states }
    refreshFolders()
    return (nil, SRFolderState(exists: true, writable: true, freeBytes: Int64.max))   // unknown until the first read comes back: never "no room"
  }
  private func folderStatesNow() -> (custom: SRFolderState?, fallback: SRFolderState) {
    let def = Self.defaultFolder
    // The default folder may not exist yet: measure the Movies folder's volume, it is made when the recording starts.
    var fb = Self.state(of: def)
    if !fb.exists { let m = Self.state(of: def.deletingLastPathComponent()); fb = SRFolderState(exists: true, writable: m.writable, freeBytes: m.freeBytes) }
    guard let c = resolvedCustom() else { return (nil, fb) }
    let opened = c.startAccessingSecurityScopedResource()
    defer { if opened { c.stopAccessingSecurityScopedResource() } }
    return (Self.state(of: c), fb)
  }
  private func openFolder(useDefault: Bool) -> URL {
    closeScope()
    if !useDefault, let c = resolvedCustom() { if c.startAccessingSecurityScopedResource() { scoped = c }; return c }
    return Self.defaultFolder
  }
  private func closeScope() { scoped?.stopAccessingSecurityScopedResource(); scoped = nil }
  private func namesTaken() -> Set<String> {
    cacheLock.lock(); defer { cacheLock.unlock() }
    return (cache?.names ?? []).union(usedNames)
  }
  private func noteUsed(_ name: String?) { guard let name else { return }; cacheLock.lock(); usedNames.insert(name); cacheLock.unlock() }
  private func namesTakenNow() -> Set<String> {
    let c = resolvedCustom()
    let opened = c?.startAccessingSecurityScopedResource() ?? false
    defer { if opened { c?.stopAccessingSecurityScopedResource() } }
    var all = Set((try? FileManager.default.contentsOfDirectory(atPath: Self.defaultFolder.path)) ?? [])
    if let c { all.formUnion((try? FileManager.default.contentsOfDirectory(atPath: c.path)) ?? []) }
    return all
  }
  private func chooseFolder() {
    let p = NSOpenPanel()
    p.canChooseFiles = false; p.canChooseDirectories = true; p.canCreateDirectories = true; p.allowsMultipleSelection = false
    p.prompt = "Choose folder"; p.message = "Where should PS save your recordings?"
    NSApp.activate(ignoringOtherApps: true)
    guard p.runModal() == .OK, let u = p.url, let data = try? u.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) else { return }
    defaults.set(data, forKey: bookmarkKey)
    var s = controller.settings; s.folderName = u.lastPathComponent; save(s)
  }
  private func resetFolder() { defaults.removeObject(forKey: bookmarkKey); var s = controller.settings; s.folderName = nil; save(s) }

  static func screenInfoNow() -> SRScreenInfo { screenSize() }
  /// 12b: free bytes on the volume the recording goes to (the chosen folder, or the default one when it fell back).
  /// Read on a utility queue (never the main thread): the answer comes back on `then`, on main.
  func freeBytesAsync(_ then: @escaping (Int64) -> Void) {
    diskQueue.async { [weak self] in
      guard let self else { return }
      let f = self.folderStatesNow()
      let v = self.controller.snapshot.folderNote == nil ? (f.custom?.freeBytes ?? f.fallback.freeBytes) : f.fallback.freeBytes
      DispatchQueue.main.async { then(v) }
    }
  }
  /// 12b: "Play" on the Saved card opens the last file in the Mac's own player until PS's own player (part 7) takes over.
  func playLast() { ScreenRecCloud.shared.playLast() }
  /// The app is quitting or restarting: finish a recording's file first. True when it has to wait (`done` runs once the file is closed).
  func finishForQuit(_ done: @escaping () -> Void) -> Bool {
    guard started, let c = controller else { return false }
    return c.finishForQuit(done)
  }
  /// 12c: the last finished file.
  var lastFileURL: URL? { capture.lastFile }
  /// 12b: "Switch mic" on the controls card goes to the next microphone (the Mac's own first), remembered like the picker's choice.
  func cycleMic() {
    let ids: [String?] = [nil] + Mic.inputs().map { Optional($0.uid) }
    let cur = ids.firstIndex(where: { $0 == controller.settings.micUID }) ?? 0
    let next = ids[(cur + 1) % ids.count]
    controller.switchMic(next); save(controller.settings)
  }

  private static func screenSize() -> SRScreenInfo {
    guard let s = NSScreen.main else { return SRScreenInfo(width: 1920, height: 1080) }
    let k = s.backingScaleFactor
    return SRScreenInfo(width: Int(s.frame.width * k), height: Int(s.frame.height * k))
  }

  private func save(_ s: SRSettings) {
    controller.update(s)
    if let d = try? JSONEncoder().encode(controller.settings) { defaults.set(d, forKey: key) }
    push()
    ScreenRecIsland.shared.sync()
  }

  // ----- the page's messages -----
  /// {type: "screenrec", op: ...}. Every op that does anything checks the gate first (the controller does), except "get",
  /// "optin" and the settings, which only read or change what is saved.
  func handle(_ m: [String: Any]) {
    start()
    let op = m["op"] as? String ?? "get"
    let f = m["patch"] as? [String: Any] ?? [:]
    if op.hasPrefix("cloud") || op.hasPrefix("rec") { ScreenRecCloud.shared.handle(op, m); return }   // 12c: the cloud, the recordings list and the player
    switch op {
    case "optin":
      controller.setEnabled(m["on"] as? Bool == true)
      if let d = try? JSONEncoder().encode(controller.settings) { defaults.set(d, forKey: key) }
      ScreenRecIsland.shared.gateChanged()   // a No stops and saves a recording, cancels a start and a count in, at once
    case "set": save(Self.patched(controller.settings, f))
    case "preset": if let p = SRPreset(rawValue: m["id"] as? String ?? "") { save(SRPresets.apply(p, to: controller.settings)) }
    case "leaveOut": if let id = m["id"] as? String { var s = controller.settings; s.leftOut = SRLeaveOut.toggle(s.leftOut, id: id); save(s) }
    case "chooseFolder": chooseFolder(); refreshFolders()
    case "resetFolder": resetFolder(); refreshFolders()
    case "showFolder": NSWorkspace.shared.open(resolvedCustom().flatMap { Self.state(of: $0).exists ? $0 : nil } ?? Self.defaultFolder)
    case "askScreen": _ = controller.askScreen()
    case "askMic": _ = controller.askMic { [weak self] _ in self?.push() }
    case "privacy": Self.openPrivacy(m["pane"] as? String ?? "screen")
    case "start": _ = controller.start(meeting: (m["meeting"] as? String).flatMap { $0.isEmpty ? nil : $0 })
    case "pause": controller.pause()
    case "resume": controller.resume()
    case "stop": controller.stop()
    case "switchMic": let u = (m["uid"] as? String).flatMap { $0.isEmpty ? nil : String($0.prefix(200)) }; controller.switchMic(u); save(controller.settings)
    case "test": runTest()
    case "list": if controller.gateOpen { sendList() }
    case "meeting": ScreenRecIsland.shared.pageMeeting(m)   // 12b: a meeting is on in the Meetings panel (src/meetwatch.ts)
    case "reveal": if let u = capture.lastFile { NSWorkspace.shared.activateFileViewerSelecting([u]) }
    default: break
    }
    push()
  }

  /// Only the fields the page may change, each checked.
  static func patched(_ s: SRSettings, _ f: [String: Any]) -> SRSettings {
    var o = s
    if let v = f["mode"] as? String, let x = SRMode(rawValue: v) { o.mode = x }
    if let v = f["resolution"] as? String, let x = SRResolution(rawValue: v) { o.resolution = x }
    if let v = f["fps"] as? Int, SR_FPS.contains(v) { o.fps = v }
    if let v = f["quality"] as? String, let x = SRQuality(rawValue: v) { o.quality = x }
    if let v = f["codec"] as? String, let x = SRCodec(rawValue: v) { o.codec = x }
    if let v = f["audioQuality"] as? String, let x = SRAudioQuality(rawValue: v) { o.audioQuality = x }
    if let v = f["micOn"] as? Bool { o.micOn = v }
    if f.keys.contains("micUID") { o.micUID = (f["micUID"] as? String).flatMap { $0.isEmpty ? nil : String($0.prefix(200)) } }
    if let v = f["computerSound"] as? Bool { o.computerSound = v }
    if let v = f["remind"] as? Bool { o.remind = v }
    if let v = f["sounds"] as? Bool { o.sounds = v }
    if let v = f["askMeetings"] as? Bool { o.askMeetings = v }
    if let v = f["perfWatch"] as? Bool { o.perfWatch = v }
    if let v = f["picked"] as? Bool { o.picked = v }
    if let k = f["sourceKind"] as? String, ["main", "display", "window"].contains(k) { o.source = SRSource(kind: k, id: UInt32(truncatingIfNeeded: f["sourceId"] as? Int ?? 0)) }
    if f.keys.contains("resolution") || f.keys.contains("fps") || f.keys.contains("quality") || f.keys.contains("codec") || f.keys.contains("audioQuality") { o = SRPresets.touched(o) }
    return o
  }

  static func openPrivacy(_ pane: String) {
    let tail = pane == "mic" ? "Privacy_Microphone" : "Privacy_ScreenCapture"
    if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(tail)") { NSWorkspace.shared.open(u) }
  }

  /// "Test recording": five seconds, then it shows the file in Finder. Only through the same gate and the same start.
  private func runTest() {
    guard controller.start(meeting: "Test recording") == nil else { return }   // a refusal is already in snapshot.error, the button shows it
    testTimer?.invalidate()
    let mine = controller.snapshot.fileName
    testTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
      // Only the test recording: if it was stopped early and a real one began, that one is left alone.
      guard let self, self.controller.snapshot.isRecording, self.controller.snapshot.fileName == mine else { return }
      self.controller.stop()
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { if let u = self.capture.lastFile { NSWorkspace.shared.activateFileViewerSelecting([u]) } }
    }
  }

  // ----- state out -----
  private func perms() -> [String: String] {
    guard controller.gateOpen else { return ["screen": "unknown", "mic": "unknown"] }   // never even read macOS while it is off
    let p = SRRealPermissions()
    return ["screen": p.screen().rawValue, "mic": p.mic().rawValue]
  }
  func stateJSON() -> String {
    let s = controller.settings, snap = controller.snapshot
    let scr = Self.screenSize()
    let ms: (Date?) -> Any = { $0.map { Int($0.timeIntervalSince1970 * 1000) } ?? NSNull() }
    var folder: [String: Any] = ["isDefault": s.folderName == nil, "name": s.folderName ?? "PS Recordings"]
    if controller.gateOpen { let f = folderStates(); folder["missing"] = f.custom.map { !$0.exists } ?? false }
    let st: [String: Any] = [
      "type": "screenrec", "featureOn": Features.on(SR_FEATURE), "enabled": controller.gateOpen,
      "state": snap.state.rawValue, "startedAt": ms(snap.startedAt), "pausedAt": ms(snap.pausedAt), "pausedTotal": Int(snap.pausedTotal * 1000),
      "fileName": snap.fileName ?? NSNull(), "folderNote": snap.folderNote ?? NSNull(), "error": snap.error ?? NSNull(), "lowered": snap.lowered,
      "perms": perms(), "folder": folder, "mics": Mic.inputs().map { ["uid": $0.uid, "name": $0.name] },
      "screen": ["w": scr.width, "h": scr.height],
      "resolutions": SRMath.available(screenW: scr.width, screenH: scr.height).map { $0.rawValue },
      "space": SRMath.spaceWords(SRMath.bytesPerHour(s, screenW: scr.width, screenH: scr.height)),
      "tracks": SRMath.tracks(s), "needsScreen": SRNeeds.screen(s), "problem": SRNeeds.problem(s) ?? NSNull(),
      "micViaStream": { if #available(macOS 15.0, *) { return true } else { return false } }(),
      "settings": (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(s))) ?? [:],
    ]
    return (try? JSONSerialization.data(withJSONObject: st)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
  }
  func push() { deliver?(stateJSON()) }

  /// The picker's lists: screens with a small picture each (macOS 14 and later), windows with their app icons (a meeting
  /// window first), and the running apps to leave out. Only called after the person said yes and macOS allowed the screen.
  private func sendList() {
    guard CGPreflightScreenCaptureAccess() else { return }
    SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { [weak self] content, _ in
      guard let self, let content else { return }
      // Rule 7: 1Password and Signal are dropped by bundle id BEFORE any title, name or icon is read, and their windows are left out of the
      // thumbnails. They never appear in the window list, the leave out list or a picture sent to the page.
      let allowedWindows = SRProtect.visible(content.windows, bundle: { $0.owningApplication?.bundleIdentifier })
      let blockedApps = content.applications.filter { !SRProtect.allowed(bundle: $0.bundleIdentifier) }
      let displays = content.displays
      // AppKit (icons, screen names, the running apps) only on the main thread.
      DispatchQueue.main.async {
        let own = Bundle.main.bundleIdentifier
        func icon(_ pid: pid_t) -> String? { NSRunningApplication(processIdentifier: pid)?.icon.flatMap { Self.png($0, 32) } }
        var wins: [[String: Any]] = []
        for w in allowedWindows where w.isOnScreen && w.windowLayer == 0 && w.frame.width > 120 && w.frame.height > 80 {
          guard let app = w.owningApplication, app.bundleIdentifier != own else { continue }
          let title = SRProtect.title(bundle: app.bundleIdentifier, read: { w.title }) ?? ""
          guard title.count > 0 else { continue }
          let meeting = ["us.zoom.xos", "com.microsoft.teams2", "com.microsoft.teams", "com.apple.FaceTime"].contains(app.bundleIdentifier) || title.contains("Meet - ")
          wins.append(["id": Int(w.windowID), "title": String(title.prefix(80)), "app": app.applicationName, "icon": icon(app.processID) ?? NSNull(), "suggested": meeting])
        }
        wins.sort { ($0["suggested"] as? Bool ?? false) && !($1["suggested"] as? Bool ?? false) }
        var apps: [[String: Any]] = []
        for a in NSWorkspace.shared.runningApplications {
          guard let id = a.bundleIdentifier, SRProtect.allowed(bundle: id), id != own, a.activationPolicy == .regular else { continue }   // the name and the icon are read only after this
          apps.append(["id": id, "name": a.localizedName ?? id, "icon": a.icon.flatMap { Self.png($0, 32) } ?? NSNull()])
        }
        apps.sort { ($0["name"] as? String ?? "").localizedCaseInsensitiveCompare($1["name"] as? String ?? "") == .orderedAscending }
        var out: [[String: Any]] = displays.map { d in
          let name = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == d.displayID })?.localizedName ?? "Screen"
          return ["id": Int(d.displayID), "name": name, "w": d.width, "h": d.height, "thumb": NSNull()]
        }
        let finish: () -> Void = {
          let o: [String: Any] = ["type": "screenrecList", "displays": out, "windows": Array(wins.prefix(40)), "apps": Array(apps.prefix(80))]
          if let d = try? JSONSerialization.data(withJSONObject: o), let j = String(data: d, encoding: .utf8) { self.deliver?(j) }
        }
        guard #available(macOS 14.0, *), !displays.isEmpty else { finish(); return }
        // Several screens answer at once on different queues: one locked box collects them, and the page list is built back on main.
        let box = SRThumbBox(count: displays.count), group = DispatchGroup()
        for (i, d) in displays.enumerated() {
          group.enter()
          let c = SCStreamConfiguration(); c.width = 320; c.height = max(2, 320 * d.height / max(1, d.width)); c.showsCursor = false
          SCScreenshotManager.captureImage(contentFilter: SCContentFilter(display: d, excludingApplications: blockedApps, exceptingWindows: []), configuration: c) { img, _ in
            if let img { let rep = NSBitmapImageRep(cgImage: img); if let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6]) { box.set(i, "data:image/jpeg;base64," + jpg.base64EncodedString()) } }
            group.leave()
          }
        }
        group.notify(queue: .main) {
          for (i, t) in box.all().enumerated() where out.indices.contains(i) { out[i]["thumb"] = t ?? NSNull() }
          finish()
        }
      }
    }
  }
  private static func png(_ img: NSImage, _ px: Int) -> String? {
    let s = NSSize(width: px, height: px)
    let small = NSImage(size: s); small.lockFocus(); img.draw(in: NSRect(origin: .zero, size: s)); small.unlockFocus()
    guard let t = small.tiffRepresentation, let r = NSBitmapImageRep(data: t), let d = r.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64," + d.base64EncodedString()
  }
}
