import AppKit

// Low power mode, the Mac's live copy (PS 1.65, feature "low-power"). The page decides (web/src/core/lowpower.ts) and
// sends its answer; LowPowerCore.swift checks it. This file:
//  - keeps the answer and tells each Mac feed when it changes (onChange), on the main thread;
//  - runs timers that really stop while their feed is asleep (every), with one catch up call on wake, staggered
//    1.5 s apart so the Mac never does every request at once;
//  - watches macOS Low Power Mode (ProcessInfo.isLowPowerModeEnabled and its change notice) and tells the page,
//    which turns Low power mode on by itself when "Turn on with the Mac's Low Power Mode" is on.
// Never reads anything about other apps. Nothing here blocks the main thread.
final class LowPower {
  static let shared = LowPower()
  private let lock = NSLock()
  private var current = LowPowerState()
  /// Read from any queue (the network monitor and the updater ask from their own): behind a lock.
  var state: LowPowerState { lock.lock(); defer { lock.unlock() }; return current }
  private var listeners: [(LowPowerState) -> Void] = []
  private var send: ((String) -> Void)?

  private final class Every { let id: String; let every: TimeInterval; let fn: () -> Void; let catchUp: Bool; var timer: Timer?
    init(_ id: String, _ every: TimeInterval, _ catchUp: Bool, _ fn: @escaping () -> Void) { self.id = id; self.every = every; self.catchUp = catchUp; self.fn = fn } }
  private var everys: [Every] = []
  private var hooks: [String: (id: String, fn: () -> Void)] = [:]
  /// One catch up on wake for a feed that is not a timer (a socket, a one shot check): staggered with the others.
  /// One per feed (or per `key`): asking again replaces it, so a feed that asks on every skipped run is still called once.
  func onWake(_ id: String, key: String? = nil, _ fn: @escaping () -> Void) {
    let k = key ?? id
    if Thread.isMainThread { hooks[k] = (id, fn) } else { DispatchQueue.main.async { [weak self] in self?.hooks[k] = (id, fn) } }
  }
  private var catchUp: [DispatchWorkItem] = []
  /// Uptime second the last waiting catch up runs at (nil: none waiting).
  private var lastSlot: TimeInterval?

  /// Is this feed asleep right now? Main thread or any thread (a plain read of a value type).
  func asleep(_ id: String) -> Bool { Features.on("low-power") && state.asleep(id) }
  var on: Bool { Features.on("low-power") && state.on }

  /// A feed's own start or stop (main thread). Called at once with the state now.
  func onChange(_ fn: @escaping (LowPowerState) -> Void) { listeners.append(fn); fn(state) }

  /// A repeating timer on the main run loop that does not exist while its feed is asleep.
  @discardableResult func every(_ id: String, _ seconds: TimeInterval, catchUp: Bool = true, tolerance: TimeInterval? = nil, _ fn: @escaping () -> Void) -> AnyObject {
    let e = Every(id, seconds, catchUp, fn)
    everys.append(e)
    arm(e, tolerance: tolerance)
    return e
  }
  private func arm(_ e: Every, tolerance: TimeInterval? = nil) {
    if asleep(e.id) { e.timer?.invalidate(); e.timer = nil; return }
    guard e.timer == nil else { return }
    let t = Timer(timeInterval: e.every, repeats: true) { [weak self] _ in if self?.asleep(e.id) != true { e.fn() } }
    t.tolerance = tolerance ?? max(0.1, e.every * 0.1)
    RunLoop.main.add(t, forMode: .common)
    e.timer = t
  }

  /// The page's answer ({type:"lowpower"}, main.swift).
  func fromPage(_ d: [String: Any]) {
    let next = LowPowerState.from(d)
    guard next != state else { return }
    let before = state
    lock.lock(); current = next; lock.unlock()
    psLog("PS low power: \(next.on ? "on (\(next.why)), \(next.asleep.count) asleep" : "off")")
    // Before 17 Nov (quality pass): every new answer cancelled the catch ups still waiting, so a second answer inside the stagger
    // (a feed registering, the alarms switch) lost the wake's catch ups for good. Now only falling asleep again drops them.
    let up = ProcessInfo.processInfo.systemUptime
    if LowPowerState.dropsCatchUps(before: before, next: next) { for w in catchUp { w.cancel() }; catchUp = []; lastSlot = nil }
    if let l = lastSlot, l < up { lastSlot = nil; catchUp = [] }   // every one waiting has had its turn (each checks asleep itself)
    func queue(_ run: @escaping () -> Void) {
      let at = LowPowerState.nextSlot(now: up, last: lastSlot)
      lastSlot = at
      let w = DispatchWorkItem(block: run)
      catchUp.append(w)
      DispatchQueue.main.asyncAfter(deadline: .now() + (at - up), execute: w)
    }
    for e in everys {
      let wasAsleep = Features.on("low-power") && before.asleep(e.id)
      arm(e)
      if wasAsleep && !asleep(e.id) && e.catchUp { queue { [weak self] in if self?.asleep(e.id) != true { e.fn() } } }
    }
    for h in hooks.values where Features.on("low-power") && before.asleep(h.id) && !asleep(h.id) {
      queue { [weak self] in if self?.asleep(h.id) != true { h.fn() } }
    }
    for l in listeners { l(next) }
  }

  /// Start watching macOS Low Power Mode; `post` sends JSON to the main page.
  func start(_ post: @escaping (String) -> Void) {
    send = post
    NotificationCenter.default.addObserver(forName: Notification.Name.NSProcessInfoPowerStateDidChange, object: nil, queue: .main) { [weak self] _ in self?.tellOs() }
  }
  /// The page asks ({type:"lowpower:get"}) and every change of the Mac's own mode.
  func tellOs() {
    let on = ProcessInfo.processInfo.isLowPowerModeEnabled
    send?(#"{"type":"lowpowerOs","on":\#(on)}"#)
  }
}
