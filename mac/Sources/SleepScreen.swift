// Sleep mode on a Mac (V1.40; web src/core/sleepmode.ts has the rules, src/sleepmode/engine.ts the page side).
// The developer, 7 Nov 2026: a calm full screen with a big clock and "Asleep for X", alarms, a panel near the wake time with
// today's tasks and how many people in the G Squad are working, and Wake up back to the Tab list. On every Mac.
//
// What this window does:
//  - One borderless window over the whole display under the mouse (menu bar and Dock hidden), near black, warm and
//    dim, the clock drifting a few pixels every 90 s against burn in. PS comes to the front while it is up, the Dock
//    and menu bar hide and app switching is off, so the Mac shows only the clock.
//  - The Mac is kept awake with a power assertion (the display stays on, like a video player). Lid open only: a
//    closed lid still sleeps the Mac as always.
//  - Mains power only: on battery a warning line shows, and at 20 percent Sleep mode stops by itself (the window
//    goes, the assertion is let go, so the Mac can sleep). Pressed on battery at or below 20 percent it never opens.
//  - macOS lets no app draw over the lock screen, so the Mac stays unlocked while this is up, and auto reboot (BFU)
//    does not count down while it is unlocked. Safe defaults (the page sends them in the plan): the screen shows
//    counts only, never a task title, a client's name or a message, unless "Show full details" is switched on, and
//    leaving needs Touch ID or the Mac password (TouchLock.evaluate). Any key or click only brightens the controls.
//  - Alarms: the times come in the plan (ms). At one, a soft chime rings from PS itself (this Mac's volume) and
//    "Stop alarm" shows; it stops by itself after 10 minutes. It is PS's own window, so it rings through PS Do
//    Not Disturb. No Touch ID is needed to stop the sound, only to leave.
//  - Golden rule: never opens while 1Password or Signal is in front, and steps aside (orders out) at once if either
//    comes to the front; it comes back when they leave. It never reads anything about them.
//  - No invisible leftover window (ScreenGuard.swift): when it goes, the window is ordered out and released.
//  - V1.42 Customise (the developer, 8 Nov 2026: "I want everything to be very customisable on the sleep screen"): the plan's
//    `look` sets the clock size, font, 12 or 24 hour, seconds, colour, brightness, background, where it sits and
//    which pieces show. A stopwatch (Start, Pause, Reset) sits under the clock, kept as times. The pointer hides
//    after the chosen seconds still (NSCursor.setHiddenUntilMouseMoves) and comes back on any move, only while this
//    screen is up and in front. Customise on the clock asks like Wake up, then the sleep stays open and Customise
//    opens in the Tab list. Esc still always leaves (and locks PS).
//  - V1.43 (the developer, 8 Nov 2026: more fonts, a colour wheel, "Wake me up in", creative wake ups): twelve fonts (the same
//    files the page bundles), weight, letter spacing, the other words' own colour and a countdown; "Wake me up in"
//    on the clock (the sleep cycle suggestions or your own time, told to the page so every device rings it); and a
//    wake style per alarm (SleepWake.swift): Soft chime, Sunrise, Red alert, Colour wave, Bright white, Strobe flash,
//    Silent light, Loud. Stop is big and needs no Touch ID; Loud and Bright white put the volume and brightness back.
//  - V1.52 (the developer, 12 Nov 2026): a small AI Sentry mode button (SleepSentry.swift, through `guardian`) puts Sentry mode's
//    protection under this screen. While protected, Wake up, Customise, Settings, Esc and the page's stop all leave
//    through the real macOS lock screen (never Touch ID over an unlocked Mac), Sleep's 20 percent battery stop gives
//    way to Sentry's own, and the clock, alarms, Stop and the stopwatch stay exactly as they are.
// Nothing on the main thread blocks: the power source is read on a background queue, Touch ID waits on its own.
// Bridge (from the Tab list page or the main page):
//   sleep:start {plan}   opens it (or takes the newer plan if it is already up)
//   sleep:plan  {plan}   a fresher plan (tasks, squad, settings changed)
//   sleep:stop           closes it without asking (the page's own Wake up after Touch ID already passed here)
//   sleep:get            asks for the state
// The state goes to both pages: window.__psSleep({running, since, onBattery, pct, stopped?, woke?, refused?}).
// Test copies: no assertion, no presentation change, the window parked far off screen, a fake power source.
import Cocoa
import AVFoundation
import IOKit.pwr_mgt
import IOKit.ps
import LocalAuthentication

/// The plan from the page (core/sleepmode.ts SleepPlan), checked. Times are ms since 1970.
struct SleepPlanN {
  /// V1.43: `style` is how it wakes you, `from` when its light starts (Sunrise: before the alarm).
  struct Ring { let id: String; let at: Double; let label: String; var style = "chime"; var from: Double = 0
    /// V1.47: this alarm's own sound choice: "list" plays the day's playlist file, "style" the usual sound, "" (an
    /// older page, or a ring with no choice) the playlist when the plan has one.
    var sound = "" }
  /// V1.47: an alarm while Sleep mode is off ("Alarms ring even when Sleep mode is off"): the screen only rings, Stop
  /// closes it, nothing is logged.
  var alarmOnly = false
  var since: Double
  var rings: [Ring]
  var wake: Double?
  var panel: Double?
  var details: Bool
  var count: Int
  var titles: [String]
  var squad: Int?
  var words: [String: String]
  var look = Look()
  /// V1.43: Wake up and Customise ask for Touch ID or the password (default, as in 1.41); false leaves at once.
  var lock = true
  /// V1.43 wake styles: Colour wave's colour, the sunrise's minutes, Strobe flash switched on, the timer's style.
  var wave = "#4f7cff", sunrise = 20, strobe = false, timerStyle = "chime"
  /// V1.44: the alarm loudness (SleepSound.swift): this Mac's volume while an alarm rings (Loud: always 100%).
  var level = AlarmMath.levelDef
  /// V1.43 "Wake me up in": the suggestions (the page's one table) and the timer set for this sleep.
  var wakeIn: [(name: String, mins: Int, sleep: Int)] = WakeRules.fallbackChoices
  var timer: (at: Double, mins: Int)?
  /// V1.47: the alarm playlist (AlarmList.swift): each day's file, the ending and the fade. Nil: off (or an older page).
  var list: PlanListN?
  /// V1.52: the AI Sentry mode button's part of the plan, as the page sent it (SleepSentryN.parse reads it). Nil: an
  /// older page, or an alarm with Sleep mode off.
  var sentry: [String: Any]?
  /// PS 1.65 "Just tomorrow" (SleepOnceCore.swift): the line under the alarm and its words. Nil: the feature is off, or
  /// there is no alarm, or an alarm with Sleep mode off (only Stop shows there): nothing is drawn.
  var once: SleepOnce.Plan?

  /// V1.42 Customise (web core/sleepmode.ts PlanLook): how the screen looks, checked again here. An older
  /// page sends none: the V1.40 look.
  struct Look: Equatable {
    var size: Double = 100            // percent of the usual clock size
    var font = "thin"                 // SleepFonts.all (V1.43: twelve)
    var weight = 0                    // V1.43: 0 the font's own, else 100 to 900
    var spacing: Double = 0           // V1.43: letter spacing added to the font's own, hundredths of the size
    var text = "#e7a35e"              // V1.43: the other words' colour
    var h12 = false, secs = false
    var ink = "#e7a35e"               // the clock colour
    var bright: Double = 0.78         // the clock's brightness, 0.1 to 1
    var bg = "#050302"                // the background
    var pos = "center"                // top, center, bottom
    var show: [String: Bool] = [:]    // asleep, alarm, date, count, panel, tasks, squad
    var watch = "small"               // the stopwatch: off, small, big
    var pointer = 3                   // the pointer hides after this many seconds still (0: never)
    // V1.43 the analogue face: digital or analogue, its marks, the second hand, its own colours, the small time under it
    var face = "digital", dial = "ticks", hand = "sweep"
    var faceInk = "#e7a35e", handInk = "#e7a35e", tickInk = "#e7a35e"
    var digi = true
    /// V1.52: where the AI Sentry mode button sits (SleepSentryRules.spots), or "hidden".
    var sentry = "left"
    func shows(_ k: String) -> Bool { show[k] ?? (k != "date" && k != "count") }
    static func parse(_ any: Any?) -> Look {
      var l = Look()
      guard let d = any as? [String: Any] else { return l }
      let hex = { (v: Any?) -> String? in (v as? String).flatMap { $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil ? $0.lowercased() : nil } }
      if let n = (d["size"] as? NSNumber)?.doubleValue, n.isFinite { l.size = max(40, min(300, n)) }
      if let f = d["font"] as? String, SleepFonts.all.contains(f) { l.font = f }
      if let w = (d["weight"] as? NSNumber)?.intValue, w >= 100, w <= 900 { l.weight = (w / 100) * 100 }
      if let n = (d["spacing"] as? NSNumber)?.doubleValue, n.isFinite { l.spacing = max(-10, min(40, n.rounded())) }
      if let b = d["h12"] as? Bool { l.h12 = b }
      if let b = d["secs"] as? Bool { l.secs = b }
      if let h = hex(d["ink"]) { l.ink = h }
      l.text = hex(d["text"]) ?? l.ink
      if let f = d["face"] as? String, ["digital", "analogue"].contains(f) { l.face = f }
      if let f = d["dial"] as? String, ["ticks", "numbers", "roman"].contains(f) { l.dial = f }
      if let f = d["hand"] as? String, ["sweep", "tick", "none"].contains(f) { l.hand = f }
      l.faceInk = hex(d["faceInk"]) ?? l.ink; l.handInk = hex(d["handInk"]) ?? l.ink; l.tickInk = hex(d["tickInk"]) ?? l.ink
      if let b = d["digi"] as? Bool { l.digi = b }
      if let n = (d["bright"] as? NSNumber)?.doubleValue, n.isFinite { l.bright = max(0.1, min(1, n)) }
      if let h = hex(d["bg"]) { l.bg = h }
      if let p = d["pos"] as? String, ["top", "center", "bottom"].contains(p) { l.pos = p }
      for (k, v) in (d["show"] as? [String: Any]) ?? [:] where ["asleep", "alarm", "date", "count", "panel", "tasks", "squad"].contains(k) { if let b = v as? Bool { l.show[k] = b } }
      if let w = d["watch"] as? String, ["off", "small", "big"].contains(w) { l.watch = w }
      if let n = (d["pointer"] as? NSNumber)?.intValue { l.pointer = max(0, min(60, n)) }
      if let s = d["sentry"] as? String, ["left", "right", "bottomLeft", "bottomRight", "hidden"].contains(s) { l.sentry = s }
      return l
    }
  }

  static func parse(_ any: Any?) -> SleepPlanN? {
    guard let d = any as? [String: Any], let since = (d["since"] as? NSNumber)?.doubleValue, since > 0 else { return nil }
    let st = d["styles"] as? [String: Any]
    let strobe = st?["strobe"] as? Bool ?? false
    let rings: [Ring] = ((d["rings"] as? [[String: Any]]) ?? []).prefix(6).compactMap { r in
      guard let id = r["id"] as? String, let at = (r["at"] as? NSNumber)?.doubleValue, at > 0 else { return nil }
      let from = (r["from"] as? NSNumber)?.doubleValue ?? at
      // Only Sunrise lights up before its alarm, and never more than 30 minutes before, whatever came in.
      let style = WakeRules.style(r["style"] as? String, strobe: strobe)
      let sound = r["sound"] as? String ?? ""
      return Ring(id: String(id.prefix(24)), at: at, label: String((r["label"] as? String ?? "").prefix(5)),
                  style: style, from: style == "sunrise" ? min(at, max(at - 30 * 60_000, from)) : at, sound: SleepRules.okSound(sound) ? sound : "")
    }
    let t = d["tasks"] as? [String: Any]
    let details = d["details"] as? Bool ?? false
    // Counts only unless the person switched full details on: titles are dropped here too, whatever the page sent.
    let titles = details ? ((t?["titles"] as? [String]) ?? []).prefix(6).map { String($0.prefix(90)) } : []
    var words: [String: String] = [:]
    for (k, v) in (d["words"] as? [String: Any]) ?? [:] { if let s = v as? String { words[k] = String(s.prefix(200)) } }
    return SleepPlanN(since: since, rings: rings.sorted { $0.at < $1.at },
                      wake: (d["wake"] as? NSNumber)?.doubleValue, panel: (d["panel"] as? NSNumber)?.doubleValue,
                      details: details, count: max(0, (t?["count"] as? NSNumber)?.intValue ?? 0), titles: titles,
                      squad: (d["squad"] as? NSNumber).map { max(0, $0.intValue) }, words: words, look: Look.parse(d["look"]), lock: d["lock"] as? Bool ?? true)
    .with(styles: st, wakeIn: d["wakeIn"], timer: d["timer"]).with(list: d["list"]).with(alarmOnly: d["alarmOnly"] as? Bool ?? false).with(sentry: d["sentry"]).with(once: d["once"])
  }
  func with(once: Any?) -> SleepPlanN { var p = self; p.once = alarmOnly ? nil : SleepOnce.parse(once); return p }
  func with(sentry: Any?) -> SleepPlanN { var p = self; p.sentry = alarmOnly ? nil : sentry as? [String: Any]; return p }
  func with(alarmOnly: Bool) -> SleepPlanN { var p = self; p.alarmOnly = alarmOnly; return p }
  /// V1.47: the playlist from the plan, checked.
  func with(list: Any?) -> SleepPlanN { var p = self; p.list = PlanListN.parse(list); return p }
  /// V1.43: the wake styles' settings, the "Wake me up in" suggestions and the timer, checked.
  func with(styles st: [String: Any]?, wakeIn: Any?, timer: Any?) -> SleepPlanN {
    var p = self
    if let w = st?["wave"] as? String, w.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil { p.wave = w.lowercased() }
    if let m = (st?["sunrise"] as? NSNumber)?.intValue, [10, 20, 30].contains(m) { p.sunrise = m }
    p.strobe = st?["strobe"] as? Bool ?? false
    p.timerStyle = WakeRules.style(st?["timer"] as? String, strobe: p.strobe)
    p.level = AlarmMath.okLevel((st?["level"] as? NSNumber)?.doubleValue)
    let list = ((wakeIn as? [[String: Any]]) ?? []).prefix(10).compactMap { c -> (name: String, mins: Int, sleep: Int)? in
      guard let n = c["name"] as? String, let m = (c["mins"] as? NSNumber)?.intValue, WakeRules.okWakeIn(m) != nil else { return nil }
      return (String(n.prefix(30)), m, (c["sleep"] as? NSNumber)?.intValue ?? m)
    }
    if !list.isEmpty { p.wakeIn = list }
    if let t = timer as? [String: Any], let at = (t["at"] as? NSNumber)?.doubleValue, let m = (t["mins"] as? NSNumber)?.intValue, at > since { p.timer = (at, m) }
    return p
  }
  func word(_ k: String, _ fallback: String) -> String { words[k].flatMap { $0.isEmpty ? nil : $0 } ?? fallback }
}

/// The pure rules the window follows (no AppKit, no clock of its own).
enum SleepRules {
  static let stopPct = 20                 // Sleep mode stops at this battery percent (on battery)
  static let ringFor: Double = 10 * 60_000
  static let ringGrace: Double = 5 * 60_000
  static let drift: Double = 6, driftEvery: Double = 90_000
  static func ringDue(_ p: SleepPlanN, now: Double, done: Set<String>) -> SleepPlanN.Ring? {
    p.rings.first { !done.contains("\($0.id)@\(Int64($0.at))") && now >= $0.at && now < $0.at + ringGrace }
  }
  static func key(_ r: SleepPlanN.Ring) -> String { "\(r.id)@\(Int64(r.at))" }
  static func driftAt(_ now: Double) -> CGPoint {
    let k = floor(now / driftEvery)
    return CGPoint(x: (drift * sin(k * 0.71)).rounded(), y: (drift * cos(k * 0.53)).rounded())
  }
  /// "Asleep for 7 h 05" (the same words as the page).
  static func asleepFor(since: Double, now: Double) -> String {
    let m = Int(floor((now - since) / 60_000))
    if m < 1 { return "Asleep for a moment" }
    let h = m / 60, mi = m % 60
    return h > 0 ? (mi > 0 ? "Asleep for \(h) h \(String(format: "%02d", mi))" : "Asleep for \(h) h") : "Asleep for \(mi) min"
  }
  /// After Wake up's Touch ID or password (V1.41): "passed" leaves, "again" keeps the clock with Wake up ready for
  /// another try (the person cancelled or got the password wrong), "letGo" leaves anyway: this Mac cannot ask at all
  /// (no password, no way to show the prompt), so Sleep mode must never trap anyone. The Mac is unlocked underneath
  /// either way. Codes, not words: the words are in the Mac's own language.
  static func authOutcome(ok: Bool, code: Int?) -> String {
    if ok { return "passed" }
    guard let code, let e = LAError.Code(rawValue: code) else { return "letGo" }
    switch e {
    case .userCancel, .authenticationFailed, .userFallback: return "again"   // a system or app cancel can repeat forever: let go
    default: return "letGo"
    }
  }
  /// V1.42: the clock's words, "07:05" or "7:05" with "PM", seconds when on (the same as core/sleepmode.ts clockText).
  static func clockText(hour h: Int, minute m: Int, second sec: Int, h12: Bool, secs: Bool) -> (time: String, ampm: String?) {
    let hh = h12 ? String(h % 12 == 0 ? 12 : h % 12) : String(format: "%02d", h)
    return ("\(hh):\(String(format: "%02d", m))\(secs ? String(format: ":%02d", sec) : "")", h12 ? (h < 12 ? "AM" : "PM") : nil)
  }
  /// The clock's point size: the usual size times the chosen percent, never wider than the screen.
  /// PS 1.65 (the developer's friend, 17 Nov 2026, a 15 inch MacBook Air): the AI Sentry mode button sits at the left or right edge,
  /// half way up, where a big clock reaches. Its room (margin, button, a gap) is kept free on BOTH sides, so the clock stays
  /// centred and never touches it, whatever the screen or the size slider. `sides` is that room, 0 with no button.
  static let sentrySide: Double = 28 + 210 + 24
  /// The clock's text as the label shows it. PS 1.65: an attributed string with no paragraph style loses the label's centring (the
  /// clock sat at the left edge on a wide screen: measured on a 1710 point wide screen, the digits started at the left), so the
  /// centring is carried by the string itself.
  static func clockString(time: String, ampm: String?, font f: NSFont, ink: NSColor, kern: CGFloat) -> NSAttributedString {
    let t = NSMutableAttributedString(string: time, attributes: [.font: f, .foregroundColor: ink, .kern: kern])
    if let ap = ampm {
      t.append(NSAttributedString(string: " " + ap, attributes: [.font: NSFont.systemFont(ofSize: f.pointSize * 0.26, weight: .semibold), .foregroundColor: ink, .baselineOffset: f.pointSize * 0.5]))
    }
    let para = NSMutableParagraphStyle(); para.alignment = .center; para.lineBreakMode = .byClipping
    t.addAttribute(.paragraphStyle, value: para, range: NSRange(location: 0, length: t.length))
    return t
  }
  /// The widest the clock or face may be: nearly the screen, less the button's room on both sides (never under 40% of the screen).
  static func roomWidth(_ W: Double, sides: Double, share: Double) -> Double { max(W * 0.4, min(W * share, W - 2 * sides)) }
  static func clockPoints(width W: Double, size: Double, chars: Int, spacing: Double = 0, sides: Double = 0) -> Double {
    let usual = max(84, min(240, W * 0.17))
    return max(24, min(usual * size / 100, roomWidth(W, sides: sides, share: 0.94) / (Double(max(4, chars)) * (0.6 + max(0, spacing / 100)))))
  }
  /// V1.47: when the next alarm with Sleep mode off needs the screen: its sunrise's start, or its time (one missed by
  /// up to ringGrace still counts). Nil: none to come.
  static func nextAlarm(_ p: SleepPlanN, now: Double, fired: Set<String>) -> Double? {
    p.rings.filter { !fired.contains(key($0)) && $0.at + ringGrace > now }.map { $0.from < $0.at && $0.from > now ? $0.from : $0.at }.min()
  }
  /// V1.47: a ring's own sound (web core/sleepmode.ts AlarmSound), checked: "", builtin, own, list, the
  /// playlist chat's style, or t:<16 hex> (one library file).
  static func okSound(_ s: String) -> Bool { ["", "builtin", "own", "list", "style"].contains(s) || (s.hasPrefix("t:") && ListMath.okId(String(s.dropFirst(2)))) }
  /// V1.47 (the developer's friend: "The custom default should just play on a loop forever until the user turns it off"): what a
  /// ring plays (the same as core/sleepmode.ts ringPlay). A custom sound that loops rings until Stop (len infinity);
  /// the built in one stops after ringFor; "Play the whole file" when it ends.
  struct Play: Equatable { let kind: String; var id: String? = nil; var loop = true; var fade = 0; let len: Double }
  static func ringPlay(sound s: String, list: PlanListN?, day: String, haveOwn: Bool) -> Play {
    let usual = haveOwn ? Play(kind: "own", len: .infinity) : Play(kind: "builtin", len: ringFor)
    if s == "builtin" { return Play(kind: "builtin", len: ringFor) }
    if s == "style" || s == "own" { return usual }
    if s.hasPrefix("t:") { return Play(kind: "track", id: String(s.dropFirst(2)), loop: true, fade: list?.fade ?? 0, len: .infinity) }
    if s == "list" || (s.isEmpty && (list?.on ?? false)), let l = list, let e = l.days[day] {
      return Play(kind: "track", id: e.id, loop: l.end != "whole", fade: l.fade, len: l.end == "whole" ? ListMath.ringFor(end: "whole", secs: e.secs) : .infinity)
    }
    return usual
  }
  /// V1.43: the analogue face's size: the usual size times the slider, never over 92% of the width or 64% of the height.
  static func dialPoints(width W: Double, height H: Double, size: Double, sides: Double = 0) -> Double {
    let usual = max(200, min(480, min(W, H) * 0.44))
    return max(80, min(usual * size / 100, roomWidth(W, sides: sides, share: 0.92), H * 0.64))
  }
  /// V1.43: the hands' angles in degrees clockwise from 12 (the same as core/sleepmode.ts handAngles).
  static func handAngles(hour h: Int, minute m: Int, second s: Int, ms: Int, sweep: Bool) -> (hour: Double, minute: Double, second: Double) {
    let sec = Double(s) + (sweep ? Double(ms) / 1000 : 0), mins = Double(m) + Double(s) / 60
    return ((Double(h % 12) + mins / 60) * 30, mins * 6, sec * 6)
  }
  /// V1.43: the face's labels: none for ticks, 12 then 1 to 11, or XII then I to XI.
  static func dialLabels(_ dial: String) -> [String] {
    switch dial {
    case "numbers": return ["12"] + (1...11).map(String.init)
    case "roman": return ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
    default: return []
    }
  }
  /// V1.43: the ring whose light is up before its alarm (Sunrise), not answered yet.
  static func dawnDue(_ p: SleepPlanN, now: Double, done: Set<String>) -> SleepPlanN.Ring? {
    p.rings.first { !done.contains(key($0)) && $0.from < $0.at && now >= $0.from && now < $0.at }
  }
  /// The stopwatch: kept as times, so it stays right however few ticks the screen draws.
  struct Watch: Equatable {
    var run = false, from: Double? = nil, acc: Double = 0
    func ms(_ now: Double) -> Double { max(0, acc + (run ? now - (from ?? now) : 0)) }
    func toggled(_ now: Double) -> Watch { run ? Watch(run: false, from: nil, acc: ms(now)) : Watch(run: true, from: now, acc: acc) }
  }
  /// "0:07", "12:34", "1:02:03".
  static func watchText(_ ms: Double) -> String {
    let t = Int(ms / 1000), h = t / 3600, m = (t % 3600) / 60, s = t % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
  }
  /// The pointer hides after `secs` still (0: never).
  static func pointerHides(secs: Int, stillFor ms: Double) -> Bool { secs > 0 && ms >= Double(secs) * 1000 }
  /// On battery at or below 20 percent: stop (or never start).
  static func batteryStops(onBattery: Bool, pct: Int?) -> Bool { onBattery && (pct ?? 100) <= stopPct }
}

/// Everything the window asks of the system, so a test copy can swap it.
struct SleepSystem {
  var holdAwake: () -> IOPMAssertionID?
  var releaseAwake: (IOPMAssertionID) -> Void
  /// Read on a background queue only.
  var power: () -> (onBattery: Bool, pct: Int?)
  /// Touch ID or the Mac password. done(ok, why, code): code is the LAError code (nil when passed or unknown).
  var auth: (_ reason: String, _ done: @escaping (Bool, String, Int?) -> Void) -> Void
  var protectedFront: () -> Bool
  var mouseScreen: () -> NSScreen?
  var kiosk: (Bool) -> Void
  /// V1.43: the clock's bundled fonts (the web folder), and Loud's and Bright white's hold on the volume and the
  /// brightness (SleepHardware.swift; stand ins in the unit test). Volume and brightness are only ever touched on the
  /// background queue.
  var fontDir: () -> URL? = { SleepHW.fontDir() }
  var reduceMotion: () -> Bool = { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
  var volumeGet: () -> (volume: Float, muted: Bool)? = { SleepHW.volume() }
  var volumeSet: (Float, Bool) -> Void = { SleepHW.setVolume($0, muted: $1) }
  var brightGet: (CGDirectDisplayID) -> Float? = { SleepHW.brightness($0) }
  var brightSet: (CGDirectDisplayID, Float) -> Void = { SleepHW.setBrightness($0, $1) }

  static let real = SleepSystem(
    holdAwake: {
      var id: IOPMAssertionID = 0
      let ok = IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleDisplaySleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                           "PS Sleep mode is on (a bedside clock)" as CFString, &id)
      return ok == kIOReturnSuccess ? id : nil
    },
    releaseAwake: { IOPMAssertionRelease($0) },
    power: {
      guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
            let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return (false, nil) }
      for ps in list {
        guard let d = IOPSGetPowerSourceDescription(info, ps)?.takeUnretainedValue() as? [String: Any],
              (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType else { continue }
        let on = (d[kIOPSPowerSourceStateKey] as? String) == kIOPSBatteryPowerValue
        let cur = (d[kIOPSCurrentCapacityKey] as? Int) ?? 0, max = (d[kIOPSMaxCapacityKey] as? Int) ?? 100
        return (on, max > 0 ? Int((Double(cur) / Double(max) * 100).rounded()) : nil)
      }
      return (false, nil)   // a Mac without a battery: always on mains
    },
    auth: { reason, done in
      // Its own context, kept alive until the answer (a released context can cancel the prompt or never answer).
      let c = LAContext()
      c.localizedCancelTitle = "Not now"
      var e: NSError?
      guard c.canEvaluatePolicy(.deviceOwnerAuthentication, error: &e) else { done(false, e?.localizedDescription ?? "cannot ask", e?.code ?? LAError.passcodeNotSet.rawValue); return }
      c.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
        withExtendedLifetime(c) { done(ok, err?.localizedDescription ?? "", (err as NSError?)?.code) }
      }
    },
    protectedFront: { Protected.front || Protected.matches(NSWorkspace.shared.frontmostApplication?.bundleIdentifier) },
    mouseScreen: {
      let p = NSEvent.mouseLocation
      return NSScreen.screens.first { NSMouseInRect(p, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens.first
    },
    kiosk: { on in
      if on {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.presentationOptions = [.hideDock, .hideMenuBar, .disableProcessSwitching, .disableHideApplication]
      } else { NSApp.presentationOptions = [] }
    })

  static let test = SleepSystem(
    holdAwake: { nil }, releaseAwake: { _ in },
    power: {
      let e = ProcessInfo.processInfo.environment["PS_SELFTEST_POWER"] ?? "mains"   // mains, battery50, battery15
      return e.hasPrefix("battery") ? (true, Int(e.dropFirst(7)) ?? 50) : (false, nil)
    },
    auth: { reason, done in TouchLock.evaluate(reason) { ok, why in done(ok, why, ok ? nil : LAError.userCancel.rawValue) } },   // TouchLock fakes it in a test copy (PS_SELFTEST_TOUCHID)
    protectedFront: { false },
    mouseScreen: { NSScreen.main ?? NSScreen.screens.first },
    // A test copy never touches the real volume or brightness.
    kiosk: { _ in }, fontDir: { nil }, reduceMotion: { false }, volumeGet: { nil }, volumeSet: { _, _ in }, brightGet: { _ in nil }, brightSet: { _, _ in })
}

/// Takes every key and click: nothing reaches an app behind. They only brighten the controls.
final class SleepView: NSView {
  var onPoke: (() -> Void)?
  /// V1.41: Esc always leaves (SleepScreen.escape), with no Touch ID.
  var onEsc: (() -> Void)?
  /// PS 1.65: true while the "Just tomorrow" time field has the keyboard: its digits and arrows reach it (Esc never does).
  var typing: (() -> Bool)?
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func keyDown(with e: NSEvent) { if e.keyCode == 53 { onEsc?() } else { onPoke?() } }
  override func performKeyEquivalent(with e: NSEvent) -> Bool {
    if e.type == .keyDown, e.keyCode != 53, !e.modifierFlags.contains(.command), typing?() == true { onPoke?(); return false }
    if e.type == .keyDown { if e.keyCode == 53 { onEsc?() } else { onPoke?() } }; return true
  }   // Cmd Q and every shortcut: swallowed
  override func cancelOperation(_ sender: Any?) { onEsc?() }
  override func mouseDown(with e: NSEvent) { onPoke?() }
  override func rightMouseDown(with e: NSEvent) { onPoke?() }
  override func scrollWheel(with e: NSEvent) {}
}
final class SleepWindow: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}
/// A flat rounded button drawn in the sleep screen's own warm colours.
final class SleepButton: NSButton {
  var fill = NSColor.clear, ink = NSColor.white, edge = NSColor.clear
  convenience init(_ title: String, target: AnyObject, action: Selector) {
    self.init(frame: .zero)
    self.title = title; self.target = target; self.action = action
    isBordered = false; bezelStyle = .regularSquare; wantsLayer = true; focusRingType = .none
    font = NSFont.systemFont(ofSize: 18, weight: .bold)
  }
  override func updateLayer() {
    layer?.cornerRadius = bounds.height / 2
    layer?.backgroundColor = fill.cgColor
    layer?.borderColor = edge.cgColor; layer?.borderWidth = 1
    attributedTitle = NSAttributedString(string: title, attributes: [.foregroundColor: ink, .font: font ?? NSFont.systemFont(ofSize: 18)])
  }
  override var wantsUpdateLayer: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }   // the first click presses it, even if the window lost key
  override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }
}

/// V1.52: the AI Sentry mode button and Sentry mode's protection under this screen (SleepSentry.swift). A protocol so
/// this file stays on its own (tests/sleepscreen-test.sh builds it without Sentry mode).
protocol SleepGuard: AnyObject {
  /// Sentry mode protects this screen right now (engaged under it, not ended).
  var isOn: Bool { get }
  /// Engaging right now (the power is being read): Wake up waits that moment out, Esc never does.
  var isBusy: Bool { get }
  /// The screen was built (or rebuilt): add the button to it.
  func attach(to v: NSView, plan: SleepPlanN)
  /// Every redraw: the plan, whether the controls are lit, the words' colour at full strength, the drift.
  func draw(plan: SleepPlanN, lit: Bool, ink: NSColor, drift: CGPoint)
  /// The screen is going.
  func detach()
  /// Esc: true when it took it (its panel closed, or the lock screen opens).
  func escape() -> Bool
  /// Leave through the real lock screen (wake, customise, settings, esc, page).
  func leave(_ why: String)
  /// The battery line and the hint while protected (nil: Sleep mode's own).
  func lines(onBattery: Bool) -> (battery: String, hint: String)?
  /// PS 1.65: the room (points, each side) the button needs at the edges, 0 when it is hidden or not there (SleepRules.sentrySide).
  func sideReserve(plan: SleepPlanN) -> Double
}

final class SleepScreen: NSObject {
  static let shared = SleepScreen()
  /// V1.52: set by main.swift (SleepSentry.shared).
  weak var guardian: SleepGuard?
  private var guardClosing = false
  private var protected: Bool { guardian?.isOn == true }
  var sys: SleepSystem = UpdatePaths.test ? .test : .real
  /// Set by main.swift: hands a JS line to both pages. Main thread.
  var deliver: ((String) -> Void)?
  /// Set by main.swift: Wake up passed Touch ID, show the Tab list (pinned) for the sleep to confirm.
  var onWoke: (() -> Void)?
  /// Set by main.swift: the Tab list goes away when Sleep mode opens.
  var onOpen: (() -> Void)?
  /// Set by main.swift: Esc left Sleep mode, so PS locks (the padlock's lock: Touch ID or the password opens it again).
  var onEscaped: (() -> Void)?

  // Warm, dim colours (the same as the web screen, core/sleepmode.ts look): never a bright light in a bedroom.
  static let night = NSColor(srgbRed: 5 / 255, green: 3 / 255, blue: 2 / 255, alpha: 1)
  static func amber(_ a: CGFloat) -> NSColor { NSColor(srgbRed: 231 / 255, green: 163 / 255, blue: 94 / 255, alpha: a) }
  static func glow(_ a: CGFloat) -> NSColor { NSColor(srgbRed: 1, green: 190 / 255, blue: 120 / 255, alpha: a) }

  private(set) var window: SleepWindow?
  private(set) var plan: SleepPlanN?
  private(set) var isUp = false
  private var stepAside = false
  private var assertion: IOPMAssertionID?
  private var tick: Timer?
  private var powerTick = 0
  private var onBattery = false, pct: Int?
  private var done = Set<String>()
  private var ring: (key: String, start: Double)?
  private var ringStyle = "chime"
  private var peekUntil: Double = 0
  private var observers: [(NotificationCenter, NSObjectProtocol)] = []
  private var player: AVAudioPlayer?
  /// V1.47: this ring's length (a playlist's whole file rings until it ends), its fade in, and whether it plays once.
  private var ringLen = SleepRules.ringFor, ringFade = 0, ringOnce = false
  private var asking = false
  private let q = DispatchQueue(label: "ps.sleep.power", qos: .utility)
  private let test = UpdatePaths.test

  // the views
  private var face = NSView(), clock = NSTextField(labelWithString: ""), sub = NSTextField(labelWithString: ""), alarm = NSTextField(labelWithString: "")
  private var panel = NSView(), pTasks = NSTextField(labelWithString: ""), pList = NSTextField(labelWithString: ""), pSquad = NSTextField(labelWithString: ""), pWake = NSTextField(labelWithString: "")
  private var battery = NSTextField(labelWithString: ""), hint = NSTextField(labelWithString: "")
  private var wakeBtn: SleepButton?, stopBtn: SleepButton?
  // V1.42 Customise: the date, the stopwatch, the Customise button, the pointer
  private var dateL = NSTextField(labelWithString: ""), swL = NSTextField(labelWithString: "")
  private var swGo: SleepButton?, swReset: SleepButton?, custBtn: SleepButton?
  private var sw = SleepRules.Watch()
  // V1.43: the countdown, "Wake me up in", the wake styles' light and their hold on the volume and brightness
  private var countL = NSTextField(labelWithString: "")
  private var dialV = SleepDial()
  // V1.47: the gear, and the alarms that ring with Sleep mode off (their plan, the timer for the next one, the rung)
  private var gearBtn: SleepButton?
  // PS 1.65 "Just tomorrow": the line under the alarm, its row of pills, and the one Touch ID sheet at a time
  private var onceL = SleepButton(frame: .zero)
  private var onceBox: NSView?
  private var onceText: String?
  private var onceActs: [SleepOnce.Act?] = []   // a pill's choice by its tag (nil: open the time field)
  private var oncePicker: NSDatePicker?, oncePicking = false
  private var onceLatch = SleepOnce.Latch()
  private var onceTry = 0
  private var onceIdle: Timer?
  private var onceMon: Any?
  private var oncePlayer: AVAudioPlayer?
  private var alarmPlan: SleepPlanN?
  private var alarmTimer: Timer?
  private var alarmFired = Set<String>()
  private var dialTick: Timer?
  private var wiBtn: SleepButton?, wiPanel: NSView?, wiOwn = NSTextField(labelWithString: "")
  private var wiMins = 7 * 60 + 45   // 7 h 30 of sleep plus 15 to fall asleep
  private var lightV = NSView()
  private var lightTick: Timer?
  private var lightDark = false
  private var dawn: SleepPlanN.Ring?
  private var ringRing: SleepPlanN.Ring?
  private var savedVolume: (volume: Float, muted: Bool)?
  private var savedBright: (display: CGDirectDisplayID, level: Float)?
  private var laidFor = ""                  // the look and screen size the face was last laid out for
  private var faceBase: CGFloat = 0         // the face's y before the drift
  private var lastMove: Double = 0
  private var cursorHidden = false
  private var moveMon: Any?
  private static let dateFmt: DateFormatter = { let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate("EEEEdMMMM"); return f }()
  static func color(_ hex: String, _ a: CGFloat) -> NSColor {
    let n = Int(hex.dropFirst(), radix: 16) ?? 0xe7a35e
    return NSColor(srgbRed: CGFloat((n >> 16) & 255) / 255, green: CGFloat((n >> 8) & 255) / 255, blue: CGFloat(n & 255) / 255, alpha: a)
  }
  /// Milliseconds since the last key, click or move anywhere on this Mac (a cheap counter, never blocks).
  static func idleMs() -> Double {
    let s = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: UInt32.max)!)
    return s.isFinite && s >= 0 ? s * 1000 : 0
  }
  private static let clockFmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f }()

  // MARK: the bridge

  /// From main.swift's message switch. True when the message was Sleep mode's.
  @discardableResult func handle(_ type: String, _ msg: [String: Any]) -> Bool {
    guard type.hasPrefix("sleep:") else { return false }
    // V1.41 (the developer, 7 Nov 2026: "The wake up button doesn't work"): every sleep message is in ps.log, so the next time
    // the log says whether the page asked at all. Only the type and the state, never the plan's words.
    psLog("PS sleep: got \(type) (up=\(isUp ? 1 : 0), asking=\(asking ? 1 : 0))")
    switch type {
    case "sleep:start":
      guard let p = SleepPlanN.parse(msg["plan"]) else { psLog("PS sleep: start without a usable plan"); send(); return true }
      if isUp { plan = p; draw(); send(); return true }
      start(p)
    case "sleep:plan":
      if isUp, let p = SleepPlanN.parse(msg["plan"]) { plan = p; draw() }
    case "sleep:stop":
      // V1.52: while Sentry mode protects it, the page (a Wake up on another device) never leaves the Mac open.
      if protected { psLog("PS sleep: the page asked to stop while protected, the lock screen opens"); guardian?.leave("page") } else { close(why: "page") }
    case "sleep:get": send()
    // V1.43 breaks: "Go back to sleep?" needs the Tab list up (pinned, like after Wake up), and the page asks how long
    // the Mac has been idle to end an unanswered break at the last moment of activity.
    case "sleep:show": if !isUp { onWoke?() }
    // V1.47 "Alarms ring even when Sleep mode is off": the next alarms (nil: off); this Mac rings them on its own.
    case "sleep:alarms":
      alarmPlan = SleepPlanN.parse(msg["plan"]).map { var p = $0; p.alarmOnly = true; return p }
      psLog("PS sleep: alarms with Sleep mode off \(alarmPlan.map { "\($0.rings.count)" } ?? "off")")
      scheduleAlarm()
    // PS 1.65: the page (Settings) asks for Touch ID or the Mac password and gets authOk back.
    case "sleep:auth":
      guard let id = SleepOnce.okAuthId(msg["id"]) else { psLog("PS sleep: sleep:auth with a bad id"); return true }
      pageAuth(id: id, reason: SleepOnce.cleanReason((msg["reason"] as? String) ?? ""))
    case "sleep:idle":
      let idle = SleepScreen.idleMs()
      deliver?("window.__psSleep && window.__psSleep({\"idleMs\":\(Int64(idle))})")
    default: return false
    }
    return true
  }

  private func stateJSON(stopped: String? = nil, woke: Double? = nil, refused: String? = nil) -> String {
    var d: [String: Any] = ["running": isUp, "onBattery": onBattery]
    if plan?.alarmOnly == true { d["alarmOnly"] = true }   // V1.47: an alarm with Sleep mode off (the page logs nothing)
    d["since"] = isUp ? (plan?.since as Any) : NSNull()
    d["pct"] = pct.map { $0 as Any } ?? NSNull()
    if let stopped { d["stopped"] = stopped }
    if let woke { d["woke"] = Int64(woke) }
    if let refused { d["refused"] = refused }
    let data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(data: data, encoding: .utf8) ?? "{}"
  }
  private func send(stopped: String? = nil, woke: Double? = nil, refused: String? = nil) {
    deliver?("window.__psSleep && window.__psSleep(\(stateJSON(stopped: stopped, woke: woke, refused: refused)))")
  }

  // MARK: open and close

  private func start(_ p: SleepPlanN) {
    SleepSound.shared.stopTest()   // V1.44: a Test still playing stops (and gives the volume back) before the night starts
    dispatchPrecondition(condition: .onQueue(.main))
    if sys.protectedFront() { psLog("PS sleep: not opened, a protected app is in front"); send(refused: "protected"); return }
    let sys = self.sys
    q.async { [weak self] in
      let pw = sys.power()
      DispatchQueue.main.async {
        guard let self, !self.isUp else { return }
        self.onBattery = pw.onBattery; self.pct = pw.pct
        if SleepRules.batteryStops(onBattery: pw.onBattery, pct: pw.pct) {
          psLog("PS sleep: not opened, on battery at \(pw.pct ?? -1)%")
          self.send(refused: "battery"); return
        }
        if self.sys.protectedFront() { self.send(refused: "protected"); return }
        self.open(p)
      }
    }
  }

  private func open(_ p: SleepPlanN) {
    guard let screen = sys.mouseScreen() else { psLog("PS sleep: no screen"); send(); return }
    plan = p; done = []; ring = nil; dawn = nil; lightDark = false; peekUntil = Date().timeIntervalSince1970 * 1000 + 8000
    onOpen?()
    let frame = test ? NSRect(x: -20000, y: -20000, width: screen.frame.width, height: screen.frame.height) : screen.frame
    let w = SleepWindow(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    w.isReleasedWhenClosed = false
    w.isFloatingPanel = true
    w.becomesKeyOnlyIfNeeded = false
    w.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue)
    w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    w.hidesOnDeactivate = false; w.hasShadow = false; w.isOpaque = true; w.animationBehavior = .none
    w.backgroundColor = SleepScreen.night
    w.alphaValue = 0
    let v = SleepView(frame: NSRect(origin: .zero, size: frame.size))
    v.wantsLayer = true; v.layer?.backgroundColor = SleepScreen.night.cgColor; v.autoresizingMask = [.width, .height]
    v.onPoke = { [weak self] in self?.poke() }
    v.onEsc = { [weak self] in self?.escape() }
    w.contentView = v
    w.acceptsMouseMovedEvents = true
    laidFor = ""
    closeOnce(animated: false)
    v.typing = { [weak self] in
      guard let self, let b = self.onceBox, let r = self.window?.firstResponder as? NSView else { return false }
      return r.isDescendant(of: b)
    }
    build(in: v)
    window = w; isUp = true; stepAside = false
    guardian?.attach(to: v, plan: p)
    lastMove = Date().timeIntervalSince1970 * 1000
    // The pointer hides after the chosen seconds still and comes back the moment it moves (V1.42). Only while this
    // screen is up and in front: never anywhere else.
    if moveMon == nil {
      moveMon = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDown, .rightMouseDown, .leftMouseDragged, .scrollWheel]) { [weak self] e in
        self?.lastMove = Date().timeIntervalSince1970 * 1000; self?.cursorHidden = false; return e
      }
    }
    if !test { w.orderFrontRegardless(); w.makeKey(); w.makeFirstResponder(v) }
    sys.kiosk(true)
    NSAnimationContext.runAnimationGroup { $0.duration = 1.2; w.animator().alphaValue = 1 }
    if assertion == nil { assertion = sys.holdAwake() }
    watch()
    draw()
    tick = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.second() }
    psLog("PS sleep: on (\(p.rings.count) alarm\(p.rings.count == 1 ? "" : "s"), \(p.details ? "full details" : "counts only"), look \(p.look.font) \(Int(p.look.size))%, stopwatch \(p.look.watch), pointer \(p.look.pointer) s)")
    send()
  }

  /// Closes it. why: "wake" (Touch ID passed), "battery", "page", "sleep" (the Mac went to sleep is NOT a reason: it stays).
  func close(why: String, woke: Double? = nil) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard isUp, let w = window else { psLog("PS sleep: close (\(why)) with nothing up"); return }
    // V1.52: never closes over an unlocked Mac while Sentry mode protects it: the lock screen first (SleepSentry.swift
    // closes it once macOS says locked).
    if protected && !guardClosing { psLog("PS sleep: close (\(why)) while protected, the lock screen opens first"); guardian?.leave(why); return }
    isUp = false
    guardian?.detach()
    asking = false
    tick?.invalidate(); tick = nil
    stopRing()
    lightTick?.invalidate(); lightTick = nil
    dialTick?.invalidate(); dialTick = nil
    wiPanel?.removeFromSuperview(); wiPanel = nil
    closeOnce(animated: false)
    unwatch()
    showPointer()
    if let m = moveMon { NSEvent.removeMonitor(m); moveMon = nil }
    if let a = assertion { sys.releaseAwake(a); assertion = nil }
    sys.kiosk(false)
    psLog("PS sleep: off (\(why))")
    if why == "alarmStop" { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.scheduleAlarm() } }
    send(stopped: why == "page" ? nil : why, woke: woke)
    NSAnimationContext.runAnimationGroup({ $0.duration = 0.35; w.animator().alphaValue = 0 }, completionHandler: { [weak self] in
      if w.isKeyWindow { w.resignKey() }
      w.orderOut(nil)
      w.contentView = nil
      if self?.window === w { self?.window = nil }
    })
    // Wake up, and Customise (V1.42: the sleep stays open, Customise opens in the Tab list with "Back to sleep").
    if why == "wake" || why == "customise" || why == "settings" || why == "security" { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.onWoke?() } }
  }

  // MARK: Wake up (Touch ID or the Mac password) and Stop alarm

  /// How long Wake up waits for Touch ID or the password; with no answer by then Sleep mode ends anyway (a prompt that
  /// never answers must never leave anyone stuck, V1.41).
  static let authTimeout: TimeInterval = 60
  private var authTry = 0
  @objc private func wakeTapped() { ask("wake") }
  /// V1.42: Customise on the clock asks the same way as Wake up (it shows your list), then the sleep stays open and
  /// Customise opens in the Tab list.
  @objc private func custTapped() { ask("customise") }
  /// V1.47 (the developer's friend: "a settings gear icon in a corner"): Sleep settings, asked like Customise; the sleep stays
  /// open and Sleep settings open in the Tab list (with Back to sleep).
  @objc private func gearTapped() { ask("settings") }
  private func ask(_ why: String) {
    let name = why == "customise" ? "Customise" : why == "settings" ? "Settings" : "Wake up"
    let leave = { [weak self] in self?.close(why: why, woke: why == "wake" ? Date().timeIntervalSince1970 * 1000 : nil) }
    psLog("PS sleep: \(name) pressed (asking=\(asking ? 1 : 0))")
    guard isUp, !asking, !onceLatch.busy else { return }
    // V1.52: protected by Sentry mode: only the real lock screen (Touch ID or the password there ends both modes).
    if protected { stopRing(); guardian?.leave(why); return }
    if guardian?.isBusy == true { psLog("PS sleep: \(name) waits, Sentry mode is engaging"); return }
    // V1.43: "Ask for Touch ID to leave Sleep mode" switched off: leave at once (Esc still locks PS).
    if plan?.lock == false { psLog("PS sleep: \(name) without Touch ID (switched off)"); leave(); return }
    asking = true
    authTry += 1
    let me = authTry
    stopRing()                        // the alarm goes quiet while the system asks
    // The system's Touch ID or password prompt must be in front: the clock steps down from screen saver level and
    // the Dock and app switching come back while it asks (V1.41: the prompt could sit under the clock, unseen).
    behind(true)
    DispatchQueue.main.asyncAfter(deadline: .now() + SleepScreen.authTimeout) { [weak self] in
      guard let self, self.asking, self.authTry == me else { return }
      // No answer at all: leave rather than put the clock back over a prompt nobody can see (never a trap).
      psLog("PS sleep: \(name) got no answer from Touch ID in \(Int(SleepScreen.authTimeout)) s, leaving")
      self.asking = false
      leave()
    }
    sys.auth("leave Sleep mode") { [weak self] ok, _, code in
      DispatchQueue.main.async {
        guard let self else { return }
        let late = self.authTry != me || !self.asking
        self.asking = false
        let out = SleepRules.authOutcome(ok: ok, code: code)
        psLog("PS sleep: \(name) \(out) (code \(code.map(String.init) ?? "none"))\(late ? ", after the wait" : "")")
        if out != "again" { leave(); return }
        self.behind(false)
        self.poke()
      }
    }
  }
  /// While the system asks: the clock below its prompt (true), and back over everything after a failed try (false).
  private func behind(_ on: Bool) {
    guard isUp, let w = window, !stepAside else { return }
    // Out of the way entirely (not only lower): the prompt can never open under it or lose focus to it.
    if on { w.level = .normal; sys.kiosk(false); w.orderOut(nil); showPointer() }
    else {
      w.level = NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue)
      sys.kiosk(true)
      if !test { w.orderFrontRegardless(); w.makeKey() }
    }
  }
  @objc private func stopTapped() { stopRing(); poke() }
  @objc private func swGoTapped() {
    let now = Date().timeIntervalSince1970 * 1000
    sw = sw.toggled(now)
    psLog("PS sleep: stopwatch \(sw.run ? "started" : "paused") at \(SleepRules.watchText(sw.ms(now)))")
    draw()
  }
  @objc private func swResetTapped() { sw = SleepRules.Watch(); psLog("PS sleep: stopwatch reset"); draw() }
  private func showPointer() { if cursorHidden { NSCursor.setHiddenUntilMouseMoves(false); cursorHidden = false } }

  /// V1.41 (the developer, 8 Nov 2026: Esc must "always work to back you out of the PS app, no matter what"): Esc leaves at
  /// once and never waits for Touch ID, so a failed or stuck Wake up can never trap anyone here. To keep the Mac
  /// safe, leaving this way locks PS like the padlock (onEscaped), so the list asks for Touch ID or the password.
  /// No wake time is sent, so the page logs nothing for this sleep until it is confirmed.
  func escape() {
    dispatchPrecondition(condition: .onQueue(.main))
    guard isUp else { return }
    if plan?.alarmOnly == true { psLog("PS sleep: Esc, the alarm stops"); close(why: "alarmStop"); return }   // not Sleep mode: nothing to lock
    // V1.52: Esc closes the AI Sentry mode panel first; while protected, Esc locks the Mac (Sentry's Esc rule).
    if guardian?.escape() == true { return }
    psLog("PS sleep: Esc, leaving and locking PS")
    asking = false
    close(why: "esc")
    onEscaped?()
  }

  // MARK: alarms with Sleep mode off (V1.47; the developer's friend: "Have the alarm play even if I don't turn on Sleep mode")

  /// A timer for the next alarm (its sunrise first, when it has one). Only while Sleep mode is not up: Sleep mode
  /// rings its own. A test copy never schedules one.
  private func scheduleAlarm() {
    alarmTimer?.invalidate(); alarmTimer = nil
    guard !test, let p = alarmPlan else { return }
    let now = Date().timeIntervalSince1970 * 1000
    guard let next = SleepRules.nextAlarm(p, now: now, fired: alarmFired) else { return }
    alarmTimer = Timer.scheduledTimer(withTimeInterval: max(0.5, (next - now) / 1000), repeats: false) { [weak self] _ in self?.alarmFire() }
  }
  private func alarmFire() {
    guard let p = alarmPlan else { return }
    let now = Date().timeIntervalSince1970 * 1000
    if isUp { scheduleAlarm(); return }   // Sleep mode (or another alarm) is up: it rings its own
    let due = SleepRules.ringDue(p, now: now, done: alarmFired) ?? SleepRules.dawnDue(p, now: now, done: alarmFired)
    guard due != nil else { scheduleAlarm(); return }
    if sys.protectedFront() { psLog("PS sleep: an alarm with Sleep mode off waits, a protected app is in front"); alarmTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in self?.alarmFire() }; return }
    psLog("PS sleep: an alarm rings with Sleep mode off")
    var q = p; q.since = now - 60_000
    open(q)
  }

  // MARK: every second

  private func second() {
    guard isUp, let p = plan else { return }
    let now = Date().timeIntervalSince1970 * 1000
    if let r = ring, now >= r.start + ringLen { stopRing() }
    // V1.47: an alarm with Sleep mode off that has nothing left to ring or light (a missed one): the screen goes.
    if p.alarmOnly, ring == nil, dawn == nil, SleepRules.ringDue(p, now: now, done: done) == nil, SleepRules.dawnDue(p, now: now, done: done) == nil { close(why: "alarmStop"); return }
    // V1.47 "Play the whole file": when the file has played to its end, the alarm is over.
    if let r = ring, ringOnce, let pl = player, !pl.isPlaying, now - r.start > 2000 { psLog("PS sleep: the playlist file ended"); stopRing() }
    if ring == nil, let due = SleepRules.ringDue(p, now: now, done: done) {
      done.insert(SleepRules.key(due)); startRing(due, now: now)
    }
    // V1.43 Sunrise: the light comes up before the alarm.
    let dw = ring == nil ? SleepRules.dawnDue(p, now: now, done: done) : nil
    if dw?.id != dawn?.id || dw?.at != dawn?.at {
      dawn = dw
      if let dw { psLog("PS sleep: sunrise starts (\(dw.label))"); poke() }
      lightNow()
    }
    if let r = ring, let pl = player {
      let loud = WakeRules.spec(ringStyle).loud
      pl.volume = Float(WakeRules.volume(ringStyle, now - r.start) * (loud ? 1 : ListMath.fadeAt(now - r.start, fade: ringFade)))
    }
    powerTick += 1
    if powerTick % 60 == 0 { checkPower() }
    if !cursorHidden, !asking, !stepAside, !test, SleepRules.pointerHides(secs: p.look.pointer, stillFor: now - lastMove) {
      NSCursor.setHiddenUntilMouseMoves(true); cursorHidden = true
    }
    draw()
  }
  private func checkPower() {
    let sys = self.sys
    q.async { [weak self] in
      let pw = sys.power()
      DispatchQueue.main.async {
        guard let self, self.isUp else { return }
        let changed = self.onBattery != pw.onBattery || self.pct != pw.pct
        self.onBattery = pw.onBattery; self.pct = pw.pct
        // V1.52: while Sentry mode protects it, its own battery stop applies instead (Sentry.swift).
        if !self.protected, SleepRules.batteryStops(onBattery: pw.onBattery, pct: pw.pct) { self.close(why: "battery"); return }
        if changed { self.send(); self.draw() }
      }
    }
  }

  // MARK: the alarm (V1.43: the ring's wake style: its sound, rising unless Loud, and its light)

  private func startRing(_ r: SleepPlanN.Ring, now: Double) {
    ring = (SleepRules.key(r), now)
    ringRing = r
    ringStyle = r.style
    dawn = nil
    let spec = WakeRules.spec(r.style)
    psLog("PS sleep: alarm \(r.label) (\(r.style))")
    poke()
    lightNow()
    // V1.44: every style that makes a sound sets the Mac's volume to the alarm loudness (Loud: 100%) while it rings.
    if spec.sound != "none" { SleepSound.shared.stopTest(); holdVolume(Float(AlarmMath.ringLevel(loud: spec.loud, level: plan?.level ?? AlarmMath.levelDef))) }
    if spec.bright { holdBrightness() }
    guard !test, spec.sound != "none" else { return }
    // V1.47: this alarm's own sound (SleepRules.ringPlay): built in, your own, the day's playlist file or one library
    // file. A custom sound that loops rings until Stop; a file this Mac does not have rings your usual sound.
    ringLen = SleepRules.ringFor; ringFade = 0; ringOnce = false
    let pl = SleepRules.ringPlay(sound: r.sound, list: plan?.list, day: ListMath.day(now), haveOwn: SleepSound.shared.own() != nil)
    if pl.kind == "track", let id = pl.id, let f = AlarmListStore.shared.listFile(id), let p = try? AVAudioPlayer(contentsOf: f) {
      player = p
      p.numberOfLoops = pl.loop ? -1 : 0
      ringOnce = !pl.loop; ringFade = pl.fade
      ringLen = pl.loop ? .infinity : ListMath.ringFor(end: "whole", secs: p.duration > 0 ? p.duration : pl.len / 1000)
      p.volume = Float(WakeRules.volume(r.style, 0) * (spec.loud ? 1 : ListMath.fadeAt(0, fade: pl.fade)))
      psLog("PS sleep: a playlist file rings\(pl.loop ? ", looping until Stop" : ", the whole file")")
      p.play()
      return
    }
    // Your own sound (looping until Stop) or the built in one, both at the one level (SleepSound.swift).
    let own = pl.kind == "own" || (pl.kind == "track" && SleepSound.shared.own() != nil)
    if own { ringLen = .infinity }
    player = try? AVAudioPlayer(data: SleepSound.shared.ringData(spec.sound, own: own))
    player?.numberOfLoops = -1
    player?.volume = Float(WakeRules.volume(r.style, 0))
    psLog("PS sleep: \(own ? "your own sound rings until Stop" : "the built in sound rings")")
    player?.play()
  }
  /// Stop alarm (no Touch ID), the ring ending by itself, Wake up, Esc or closing: the sound, the light, and the
  /// volume and brightness Loud or Bright white changed, all back.
  private func stopRing() {
    if let d = dawn { done.insert(SleepRules.key(d)); if plan?.alarmOnly == true { alarmFired.insert(SleepRules.key(d)) }; dawn = nil }
    if let r = ringRing, plan?.alarmOnly == true { alarmFired.insert(SleepRules.key(r)) }
    ring = nil; ringRing = nil
    player?.stop(); player = nil
    giveBack()
    lightNow()
    draw()
    // V1.47: an alarm with Sleep mode off: once it stops (Stop, Esc, or by itself) the screen goes too.
    if isUp, plan?.alarmOnly == true { DispatchQueue.main.async { [weak self] in if self?.isUp == true, self?.ring == nil, self?.dawn == nil { self?.close(why: "alarmStop") } } }
  }
  /// The alarm loudness (V1.44; V1.43: Loud only, to full): this Mac's output volume to `to` (unmuted) for the alarm;
  /// the old level is kept to put back.
  private func holdVolume(_ to: Float) {
    q.async { [weak self] in
      guard let self else { return }
      let old = self.sys.volumeGet()
      DispatchQueue.main.async {
        guard self.ring != nil, self.savedVolume == nil, let old else { return }
        self.savedVolume = old
        psLog("PS sleep: volume to \(Int(to * 100))% for the alarm")
        self.q.async { self.sys.volumeSet(to, false) }
      }
    }
  }
  /// Bright white and Strobe flash: the display under the clock to full brightness; the old level is kept.
  private func holdBrightness() {
    guard let d = (window?.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value else { return }
    q.async { [weak self] in
      guard let self else { return }
      let old = self.sys.brightGet(d)
      DispatchQueue.main.async {
        guard self.ring != nil, self.savedBright == nil, let old else { return }
        self.savedBright = (d, old)
        self.q.async { self.sys.brightSet(d, 1) }
      }
    }
  }
  private func giveBack() {
    if let v = savedVolume { savedVolume = nil; psLog("PS sleep: volume back"); q.async { [sys] in sys.volumeSet(v.volume, v.muted) } }
    if let b = savedBright { savedBright = nil; q.async { [sys] in sys.brightSet(b.display, b.level) } }
  }
  /// The light over the screen: on (20 times a second) while a ring or a sunrise has one, off otherwise.
  private func lightNow() {
    let style = ring != nil ? ringStyle : dawn != nil ? "sunrise" : nil
    let has = style.map { $0 != "chime" && $0 != "loud" } ?? false
    if has, lightTick == nil {
      lightTick = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.lightFrame() }
    } else if !has { lightTick?.invalidate(); lightTick = nil }
    lightFrame()
  }
  private func lightFrame() {
    guard let p = plan else { return }
    let now = Date().timeIntervalSince1970 * 1000
    let at = ringRing?.at ?? dawn?.at ?? now
    let style = ring != nil ? ringStyle : dawn != nil ? "sunrise" : "chime"
    // A ring's light runs from when it started ringing (a late ring still starts at its beginning).
    let t = ring != nil ? now - (ring?.start ?? now) : now - at
    let l = (ring != nil || dawn != nil) ? WakeRules.light(style, t, dawnMs: Double(p.sunrise) * 60_000, wave: WakeRules.rgb(p.wave), ink: WakeRules.rgb(p.look.ink), calm: sys.reduceMotion()) : nil
    CATransaction.begin(); CATransaction.setDisableActions(true)
    if let l {
      lightV.layer?.backgroundColor = NSColor(srgbRed: l.rgb.r / 255, green: l.rgb.g / 255, blue: l.rgb.b / 255, alpha: 1).cgColor
      lightV.layer?.opacity = Float(l.a)
    } else { lightV.layer?.opacity = 0 }
    CATransaction.commit()
    let dark = WakeRules.darkOn(l)
    if dark != lightDark { lightDark = dark; draw() }
  }

  // MARK: "Wake me up in" (V1.43): the page's suggestions, or your own time; the page keeps it on the open sleep

  @objc private func wakeInTapped() {
    guard isUp else { return }
    if let wp = wiPanel { wp.removeFromSuperview(); wiPanel = nil; draw(); return }
    guard let v = window?.contentView, let p = plan else { return }
    poke()
    let now = Date().timeIntervalSince1970 * 1000
    let W = v.bounds.width, pw: CGFloat = min(640, W - 40)
    let ink = SleepScreen.color(p.look.text, 1)
    let box = NSView(frame: .zero)
    box.wantsLayer = true
    box.layer?.cornerRadius = 20; box.layer?.borderWidth = 1
    box.layer?.backgroundColor = SleepScreen.color(p.look.bg, 0.97).cgColor; box.layer?.borderColor = ink.withAlphaComponent(0.25).cgColor
    let title = NSTextField(labelWithString: p.word("wakeIn", "Wake me up in"))
    label(title, size: 20, weight: .bold); title.textColor = ink.withAlphaComponent(0.9); title.alignment = .left
    var buttons: [SleepButton] = []
    for (i, c) in p.wakeIn.enumerated() {
      let at = WakeRules.wakeInAt(now, c.mins)
      let b = SleepButton("\(WakeRules.durText(c.sleep))  \(c.name), rings at \(SleepScreen.clockFmt.string(from: Date(timeIntervalSince1970: at / 1000)))", target: self, action: #selector(wakeInPicked(_:)))
      b.tag = c.mins; b.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
      b.fill = ink.withAlphaComponent(p.timer?.mins == c.mins ? 0.2 : 0.07); b.edge = ink.withAlphaComponent(0.2); b.ink = ink.withAlphaComponent(0.92)
      _ = i; buttons.append(b)
    }
    let minus = SleepButton("-15 min", target: self, action: #selector(wakeInStep(_:))), plus = SleepButton("+15 min", target: self, action: #selector(wakeInStep(_:)))
    minus.tag = -15; plus.tag = 15
    let set = SleepButton(p.word("wakeInSet", "Set"), target: self, action: #selector(wakeInOwn)), clear = SleepButton(p.word("wakeInClear", "No timer"), target: self, action: #selector(wakeInClear))
    let back = SleepButton("Back", target: self, action: #selector(wakeInTapped))
    for b in [minus, plus, set, clear, back] { b.font = NSFont.systemFont(ofSize: 14, weight: .bold); b.fill = ink.withAlphaComponent(0.08); b.edge = ink.withAlphaComponent(0.22); b.ink = ink.withAlphaComponent(0.92) }
    label(wiOwn, size: 15, weight: .semibold); wiOwn.textColor = ink.withAlphaComponent(0.85); wiOwn.alignment = .left
    // From the bottom up: Back, your own time, the suggestions (two to a row), the title.
    var y: CGFloat = 16
    back.frame = NSRect(x: 16, y: y, width: pw - 32, height: 44); y += 56
    let ow = (pw - 32 - 3 * 8) / 4
    for (k, b) in [minus, plus, set, clear].enumerated() { b.frame = NSRect(x: 16 + CGFloat(k) * (ow + 8), y: y, width: ow, height: 36) }
    y += 44
    wiOwn.frame = NSRect(x: 18, y: y, width: pw - 36, height: 22); y += 30
    let cw = (pw - 32 - 8) / 2
    for (k, b) in buttons.enumerated().reversed() {
      let row = (buttons.count - 1 - k) / 2, col = k % 2
      _ = row
      b.frame = NSRect(x: 16 + CGFloat(col) * (cw + 8), y: y + CGFloat((buttons.count - 1) / 2 - k / 2) * 48, width: cw, height: 40)
    }
    y += CGFloat((buttons.count + 1) / 2) * 48 + 4
    title.frame = NSRect(x: 18, y: y, width: pw - 36, height: 28); y += 40
    box.frame = NSRect(x: (W - pw) / 2, y: max(20, (v.bounds.height - y) / 2), width: pw, height: y)
    for x in buttons + [minus, plus, set, clear, back] { box.addSubview(x) }
    box.addSubview(wiOwn); box.addSubview(title)
    v.addSubview(box)
    wiPanel = box
    wiMins = p.timer?.mins ?? wiMins
    wakeInOwnText()
    psLog("PS sleep: Wake me up in opened")
  }
  private func wakeInOwnText() {
    let at = WakeRules.wakeInAt(Date().timeIntervalSince1970 * 1000, wiMins)
    wiOwn.stringValue = "\(plan?.word("wakeInCustom", "Your own") ?? "Your own"): \(WakeRules.durText(wiMins)), rings at \(SleepScreen.clockFmt.string(from: Date(timeIntervalSince1970: at / 1000)))"
  }
  @objc private func wakeInStep(_ b: NSButton) { wiMins = max(WakeRules.wakeInMin, min(WakeRules.wakeInMax, wiMins + b.tag)); wakeInOwnText() }
  @objc private func wakeInPicked(_ b: NSButton) { setWakeIn(b.tag) }
  @objc private func wakeInOwn() { setWakeIn(wiMins) }
  @objc private func wakeInClear() { setWakeIn(0) }
  /// Rings here at once (this clock's own copy), and the page keeps it on the open sleep for every device.
  private func setWakeIn(_ mins: Int) {
    wiPanel?.removeFromSuperview(); wiPanel = nil
    guard var p = plan else { return }
    let now = Date().timeIntervalSince1970 * 1000
    p.rings.removeAll { $0.id == "timer" }
    if let m = WakeRules.okWakeIn(mins) {
      let at = WakeRules.wakeInAt(now, m)
      p.timer = (at, m)
      p.rings.append(SleepPlanN.Ring(id: "timer", at: at, label: SleepScreen.clockFmt.string(from: Date(timeIntervalSince1970: at / 1000)), style: p.timerStyle, from: p.timerStyle == "sunrise" ? max(p.since, at - Double(p.sunrise) * 60_000) : at))
      p.rings.sort { $0.at < $1.at }
    } else { p.timer = nil }
    plan = p
    psLog("PS sleep: Wake me up in \(mins > 0 ? "\(mins) min" : "off")")
    deliver?("window.__psSleep && window.__psSleep({\"wakeIn\":\(max(0, mins)),\"wakeFrom\":\(Int64(now))})")
    laidFor = ""
    draw()
  }

  // MARK: "Just tomorrow" (PS 1.65): one calm line under the alarm; a click opens thin pills. Every choice asks for
  // Touch ID or the Mac password first, and only a passed answer reaches the page (SleepOnce.gate). The words are all
  // the page's own (plan.once.words).

  /// The soft confirm: the island's chime tones (SetupIslandSound.chime), played quietly.
  static let onceChime: [Sfx.Tone] = [Sfx.Tone(f: 1046.5, to: nil, dur: 0.2, peak: 0.16, wave: 0, at: 0),
                                      Sfx.Tone(f: 1568, to: nil, dur: 0.5, peak: 0.14, wave: 0, at: 0.09),
                                      Sfx.Tone(f: 3136, to: nil, dur: 0.25, peak: 0.03, wave: 0, at: 0.09)]

  @objc private func onceTapped() {
    guard isUp, plan?.once != nil else { return }
    poke()
    if onceBox != nil { closeOnce(animated: true) } else { openOnce(picking: false) }
  }
  @objc private func oncePillTapped(_ b: NSButton) {
    guard b.tag >= 0, b.tag < onceActs.count else { return }
    poke(); armOnceIdle()
    if let act = onceActs[b.tag] { onceChoose(act) } else { openOnce(picking: true) }
  }
  @objc private func onceSaveTapped() {
    guard let dp = oncePicker else { return }
    let c = Calendar.current.dateComponents([.hour, .minute], from: dp.dateValue)
    poke(); armOnceIdle()
    onceChoose(.pick(SleepOnce.clock((c.hour ?? 0) * 60 + (c.minute ?? 0))))
  }
  @objc private func onceTimeChanged() { armOnceIdle() }

  private func onceChoose(_ act: SleepOnce.Act) {
    guard let o = plan?.once else { return }
    onceAuth(reason: SleepOnce.reason(for: act, words: o.words)) { [weak self] ok, _ in
      guard let self else { return }
      if let js = SleepOnce.gate(authPassed: ok, act) {
        psLog("PS sleep: Just tomorrow, a choice passed Touch ID")
        self.deliver?("window.__psSleep && window.__psSleep(\(js))")
        self.onceConfirm()
        self.closeOnce(animated: true)
      } else {
        psLog("PS sleep: Just tomorrow, not passed, nothing sent")
        if let b = self.onceBox, !self.sys.reduceMotion() {
          let k = CAKeyframeAnimation(keyPath: "transform.translation.x")
          k.values = [0, -7, 7, -5, 5, -2, 0]; k.duration = 0.34
          b.layer?.add(k, forKey: "shake")
        }
        self.armOnceIdle()
      }
    }
  }

  /// Touch ID or the Mac password, one sheet at a time (the pills and the page's sleep:auth share it), asked off the
  /// main thread. done(ok, none) comes back on the main thread: none is true when this Mac cannot ask at all. While the
  /// sheet is up the sleep screen steps back (as Wake up does) so the sheet is never under it. No answer in a minute: not passed.
  private func onceAuth(reason: String, _ done: @escaping (_ ok: Bool, _ none: Bool) -> Void) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard !asking, onceLatch.begin() else { psLog("PS sleep: a Touch ID request was refused, one is already open"); done(false, false); return }
    onceTry &+= 1
    let me = onceTry
    let hid = isUp && !stepAside && window != nil
    if hid { behind(true) }
    let finish: (Bool, Bool) -> Void = { [weak self] ok, none in
      guard let self, self.onceTry == me else { return }
      self.onceTry &+= 1
      self.onceLatch.end()
      if hid, self.isUp { self.behind(false) }
      done(ok, none)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + SleepScreen.authTimeout) { finish(false, false) }
    let auth = sys.auth, why = SleepOnce.cleanReason(reason)
    DispatchQueue.global(qos: .userInitiated).async {
      auth(why) { ok, _, code in
        let none = !ok && SleepRules.authOutcome(ok: ok, code: code) == "letGo"
        DispatchQueue.main.async { finish(ok, none) }
      }
    }
  }
  /// The page asked for Touch ID (Settings): the answer goes back with the same id.
  private func pageAuth(id: String, reason: String) {
    onceAuth(reason: reason) { [weak self] ok, none in
      if let js = SleepOnce.authReply(id: id, ok: ok, none: none) { self?.deliver?("window.__psSleep && window.__psSleep(\(js))") }
    }
  }
  private func onceConfirm() {
    guard !test, !DND.shared.mutes("sounds") else { return }
    if oncePlayer == nil { oncePlayer = try? AVAudioPlayer(data: Sfx.wav(SleepScreen.onceChime)); oncePlayer?.prepareToPlay() }
    oncePlayer?.volume = 0.25
    oncePlayer?.currentTime = 0
    oncePlayer?.play()
  }

  /// The row of thin pills (or, after "pick", the hour and minute field with Save) under the line.
  private func openOnce(picking: Bool) {
    guard isUp, let v = window?.contentView, let p = plan, let o = p.once, !onceL.isHidden else { return }
    let swap = onceBox != nil
    onceBox?.removeFromSuperview(); onceBox = nil; oncePicker = nil; onceActs = []
    oncePicking = picking
    let ink = { (a: CGFloat) in SleepScreen.color(p.look.text, a) }
    let box = NSView(frame: .zero)
    box.wantsLayer = true
    box.layer?.cornerRadius = 20; box.layer?.borderWidth = 1
    box.layer?.backgroundColor = SleepScreen.color(p.look.bg, 0.97).cgColor; box.layer?.borderColor = ink(0.22).cgColor
    box.toolTip = o.words.title.isEmpty ? nil : o.words.title
    let H: CGFloat = 40, ph: CGFloat = 26, gap: CGFloat = 6, pad: CGFloat = 8
    func pill(_ title: String, _ action: Selector, tag: Int = 0) -> SleepButton {
      let b = SleepButton(title, target: self, action: action)
      b.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
      b.fill = ink(0.07); b.edge = ink(0.22); b.ink = ink(0.92); b.tag = tag
      let w = (title as NSString).size(withAttributes: [.font: b.font as Any]).width + 26
      b.frame = NSRect(x: 0, y: (H - ph) / 2, width: ceil(w), height: ph)
      return b
    }
    var parts: [NSView] = []
    if picking {
      let dp = NSDatePicker(frame: NSRect(x: 0, y: (H - 24) / 2, width: 108, height: 24))
      dp.datePickerStyle = .textFieldAndStepper
      dp.datePickerElements = .hourMinute
      dp.datePickerMode = .single
      dp.isBezeled = false; dp.isBordered = false; dp.drawsBackground = false
      dp.font = NSFont.monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
      dp.textColor = ink(0.95)
      dp.appearance = NSAppearance(named: lightDark ? .aqua : .darkAqua)
      dp.calendar = Calendar.current; dp.timeZone = Calendar.current.timeZone
      let m = SleepOnce.minutes(SleepOnce.pickStart(usual: o.usual) ?? o.usual) ?? 9 * 60
      dp.dateValue = Calendar.current.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: Date()) ?? Date()
      dp.target = self; dp.action = #selector(onceTimeChanged)
      oncePicker = dp
      parts = [dp]
      if !o.words.save.isEmpty { parts.append(pill(o.words.save, #selector(onceSaveTapped))) }
    } else {
      var specs: [(String, SleepOnce.Act?)] = []
      if !o.words.skip.isEmpty { specs.append((o.words.skip, .skip)) }
      for m in o.words.mins { specs.append((m.label, .later(m.mins))) }
      if !o.words.pick.isEmpty { specs.append((o.words.pick, nil)) }
      if o.set, !o.words.undo.isEmpty { specs.append((o.words.undo, .undo)) }
      onceActs = specs.map { $0.1 }
      parts = specs.enumerated().map { pill($0.element.0, #selector(oncePillTapped(_:)), tag: $0.offset) }
    }
    var x = pad
    for part in parts { part.setFrameOrigin(NSPoint(x: x, y: part.frame.minY)); box.addSubview(part); x += part.frame.width + gap }
    box.setFrameSize(NSSize(width: min(v.bounds.width - 24, max(60, x - gap + pad)), height: H))
    v.addSubview(box)
    onceBox = box
    placeOnce()
    armOnceIdle()
    if onceMon == nil {
      // A click anywhere else closes it (the click itself still does what it always did).
      onceMon = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] e in
        guard let self, let b = self.onceBox, let cv = self.window?.contentView, e.window === self.window else { return e }
        let pt = cv.convert(e.locationInWindow, from: nil)
        if !b.frame.contains(pt) && !self.onceL.convert(self.onceL.bounds, to: cv).contains(pt) { self.closeOnce(animated: true) }
        return e
      }
    }
    springOnce(box, swap: swap)
  }
  private func placeOnce() {
    guard let box = onceBox, let v = window?.contentView, !onceL.isHidden else { return }
    let f = onceL.convert(onceL.bounds, to: v)
    var y = f.minY - box.frame.height - 8
    if y < 12 { y = f.maxY + 8 }
    let x = max(12, min(v.bounds.width - box.frame.width - 12, f.midX - box.frame.width / 2))
    box.setFrameOrigin(NSPoint(x: x, y: y))
  }
  /// Opens with a tiny squeeze, then springs open; with Reduce Motion only a short fade.
  private func springOnce(_ box: NSView, swap: Bool) {
    guard let l = box.layer else { return }
    let fade = CABasicAnimation(keyPath: "opacity"); fade.fromValue = swap ? 0.5 : 0; fade.toValue = 1
    if sys.reduceMotion() { fade.duration = 0.15; l.add(fade, forKey: "once"); return }
    fade.duration = 0.14
    let squeeze = CABasicAnimation(keyPath: "transform.scale"); squeeze.fromValue = swap ? 1.0 : 0.9; squeeze.toValue = 0.86; squeeze.duration = 0.07
    squeeze.timingFunction = CAMediaTimingFunction(name: .easeOut)
    let grow = CASpringAnimation(keyPath: "transform.scale"); grow.fromValue = 0.86; grow.toValue = 1
    grow.mass = 1; grow.stiffness = 240; grow.damping = 14; grow.initialVelocity = 0
    grow.beginTime = 0.07; grow.duration = grow.settlingDuration
    let g = CAAnimationGroup(); g.animations = [squeeze, grow, fade]; g.duration = 0.07 + grow.settlingDuration
    l.add(g, forKey: "once")
  }
  /// 20 seconds with no touch: it closes by itself (never while a sheet is open).
  private func armOnceIdle() {
    onceIdle?.invalidate()
    onceIdle = Timer.scheduledTimer(withTimeInterval: SleepOnce.idleSeconds, repeats: false) { [weak self] _ in
      guard let self else { return }
      if self.onceLatch.busy { self.armOnceIdle(); return }
      self.closeOnce(animated: true)
    }
  }
  private func closeOnce(animated: Bool) {
    onceIdle?.invalidate(); onceIdle = nil
    if let m = onceMon { NSEvent.removeMonitor(m); onceMon = nil }
    oncePicker = nil; oncePicking = false; onceActs = []
    guard let box = onceBox else { return }
    onceBox = nil
    // The keyboard goes back to the screen (never left in a field that is going away).
    if let w = window, let r = w.firstResponder as? NSView, r.isDescendant(of: box) { w.makeFirstResponder(w.contentView) }
    guard animated, let l = box.layer else { box.removeFromSuperview(); return }
    let calm = sys.reduceMotion()
    CATransaction.begin()
    CATransaction.setCompletionBlock { box.removeFromSuperview() }
    let f = CABasicAnimation(keyPath: "opacity"); f.fromValue = 1; f.toValue = 0; f.duration = calm ? 0.12 : 0.16
    l.opacity = 0
    l.add(f, forKey: "out")
    if !calm {
      let s = CABasicAnimation(keyPath: "transform.scale"); s.fromValue = 1; s.toValue = 0.92; s.duration = 0.16
      l.add(s, forKey: "outScale")
    }
    CATransaction.commit()
  }

  // MARK: drawing

  private func label(_ l: NSTextField, size: CGFloat, weight: NSFont.Weight, mono: Bool = false) {
    l.font = mono ? NSFont.monospacedDigitSystemFont(ofSize: size, weight: weight) : NSFont.systemFont(ofSize: size, weight: weight)
    l.alignment = .center; l.isSelectable = false; l.drawsBackground = false; l.isBordered = false
    l.lineBreakMode = .byTruncatingTail
  }
  private func build(in v: NSView) {
    let W = v.bounds.width
    face = NSView(frame: NSRect(x: 0, y: 0, width: W, height: 200))
    face.autoresizingMask = [.width]
    // V1.43: the wake styles' light, under everything else.
    lightV = NSView(frame: v.bounds); lightV.wantsLayer = true; lightV.autoresizingMask = [.width, .height]; lightV.layer?.opacity = 0
    v.addSubview(lightV)
    for l in [clock, dateL, sub, alarm, countL, swL] { label(l, size: 15, weight: .regular); l.autoresizingMask = [.width]; face.addSubview(l) }
    dialV = SleepDial(frame: .zero); dialV.isHidden = true; face.addSubview(dialV)
    // PS 1.65: "Just tomorrow", a calm line (plain text, no pill) that opens the row.
    onceL.title = ""; onceL.target = self; onceL.action = #selector(onceTapped)
    onceL.isBordered = false; onceL.bezelStyle = .regularSquare; onceL.wantsLayer = true; onceL.focusRingType = .none
    onceL.font = NSFont.systemFont(ofSize: 14, weight: .regular); onceL.isHidden = true
    face.addSubview(onceL)
    v.addSubview(face)

    let pw: CGFloat = min(480, W - 40)
    panel = NSView(frame: NSRect(x: (W - pw) / 2, y: 130, width: pw, height: 150))
    panel.wantsLayer = true
    panel.layer?.cornerRadius = 20
    panel.layer?.borderWidth = 1
    panel.autoresizingMask = [.minXMargin, .maxXMargin]
    panel.alphaValue = 0
    for (l, s, wgt) in [(pTasks, CGFloat(18), NSFont.Weight.bold), (pList, 14, .regular), (pSquad, 14, .medium), (pWake, 12, .regular)] {
      label(l, size: s, weight: wgt); l.alignment = .left; panel.addSubview(l)
    }
    pList.maximumNumberOfLines = 6; pList.lineBreakMode = .byWordWrapping
    v.addSubview(panel)

    let bw: CGFloat = min(460, W - 40)
    let wb = SleepButton("Wake up", target: self, action: #selector(wakeTapped))
    wb.frame = NSRect(x: (W - bw) / 2, y: 56, width: bw, height: 54); wb.autoresizingMask = [.minXMargin, .maxXMargin]
    // V1.43: Stop is big and obvious, and needs no Touch ID.
    let sbw: CGFloat = min(560, W - 40)
    let sb = SleepButton("Stop alarm", target: self, action: #selector(stopTapped))
    sb.frame = NSRect(x: (W - sbw) / 2, y: 120, width: sbw, height: 76); sb.autoresizingMask = [.minXMargin, .maxXMargin]
    sb.font = NSFont.systemFont(ofSize: 26, weight: .heavy)
    sb.isHidden = true
    v.addSubview(wb); v.addSubview(sb)
    wakeBtn = wb; stopBtn = sb
    // V1.42: the stopwatch's buttons (in the face) and Customise (top right, dim until the screen is touched).
    let go = SleepButton("Start", target: self, action: #selector(swGoTapped)), rs = SleepButton("Reset", target: self, action: #selector(swResetTapped))
    let cb = SleepButton("Customise", target: self, action: #selector(custTapped))
    for b in [go, rs, cb] { b.font = NSFont.systemFont(ofSize: 13, weight: .bold) }
    face.addSubview(go); face.addSubview(rs)
    cb.frame = NSRect(x: W - 150, y: v.bounds.height - 56, width: 126, height: 32); cb.autoresizingMask = [.minXMargin, .minYMargin]
    v.addSubview(cb)
    let wi = SleepButton("Wake me up in", target: self, action: #selector(wakeInTapped))
    wi.font = NSFont.systemFont(ofSize: 13, weight: .bold)
    wi.frame = NSRect(x: W - 150 - 232, y: v.bounds.height - 56, width: 222, height: 32); wi.autoresizingMask = [.minXMargin, .minYMargin]
    v.addSubview(wi)
    wiBtn = wi
    let gb = SleepButton("Settings", target: self, action: #selector(gearTapped))
    gb.font = NSFont.systemFont(ofSize: 13, weight: .bold)
    gb.frame = NSRect(x: 24, y: v.bounds.height - 56, width: 110, height: 32); gb.autoresizingMask = [.maxXMargin, .minYMargin]
    v.addSubview(gb)
    gearBtn = gb
    swGo = go; swReset = rs; custBtn = cb
    label(battery, size: 13, weight: .semibold); battery.frame = NSRect(x: 20, y: 30, width: W - 40, height: 18); battery.autoresizingMask = [.width]
    label(hint, size: 12, weight: .regular); hint.frame = NSRect(x: 20, y: 12, width: W - 40, height: 16); hint.autoresizingMask = [.width]
    v.addSubview(battery); v.addSubview(hint)
  }

  /// V1.42: lays the face out for the look (font, size, which pieces show, the stopwatch, where it sits). Only when the
  /// look, the screen size or the clock's width changes, so the second by second redraw stays cheap.
  private func layFace(_ L: SleepPlanN.Look, chars: Int, ringing: Bool, sides: Double, in v: NSView) {
    let W = v.bounds.width, H = v.bounds.height
    let key = "\(L.face)|\(L.digi)|\(L.font)|\(L.size)|\(L.weight)|\(L.spacing)|\(L.watch)|\(L.pos)|\(L.shows("date"))|\(L.shows("count"))|\(L.shows("asleep") || ringing)|\(L.shows("alarm"))|\(onceText ?? "")|\(chars)|\(Int(sides))|\(Int(W))x\(Int(H))"
    guard key != laidFor else { return }
    laidFor = key
    let big = CGFloat(SleepRules.clockPoints(width: W, size: L.size, chars: chars, spacing: L.spacing, sides: sides))
    clock.font = SleepFonts.font(L.font, size: big, weight: L.weight, dir: sys.fontDir())
    countL.font = NSFont.systemFont(ofSize: max(15, min(240, big) * 0.09), weight: .semibold)
    sub.font = NSFont.systemFont(ofSize: max(18, min(240, big) * 0.12), weight: .medium)
    alarm.font = NSFont.systemFont(ofSize: 15, weight: .regular)
    dateL.font = NSFont.systemFont(ofSize: max(15, min(240, big) * 0.1), weight: .semibold)
    let swBig = L.watch == "big"
    swL.font = NSFont.monospacedDigitSystemFont(ofSize: swBig ? max(44, min(130, W * 0.09)) : 22, weight: swBig ? .light : .medium)
    // From the bottom up: the stopwatch, the alarm line, "Asleep for", the date, the clock.
    var y: CGFloat = 6
    let bw: CGFloat = swBig ? 110 : 84, bh: CGFloat = swBig ? 40 : 30
    swL.isHidden = L.watch == "off"; swGo?.isHidden = swL.isHidden; swReset?.isHidden = swL.isHidden
    if L.watch == "small" {
      let tw: CGFloat = 110
      let x0 = (W - (tw + 12 + bw * 2 + 8)) / 2
      swL.frame = NSRect(x: x0, y: y, width: tw, height: bh); swL.alignment = .right
      swGo?.frame = NSRect(x: x0 + tw + 12, y: y, width: bw, height: bh); swReset?.frame = NSRect(x: x0 + tw + 20 + bw, y: y, width: bw, height: bh)
      y += bh + 10
    } else if swBig {
      swGo?.frame = NSRect(x: W / 2 - bw - 4, y: y, width: bw, height: bh); swReset?.frame = NSRect(x: W / 2 + 4, y: y, width: bw, height: bh)
      y += bh + 8
      let lh = swL.font!.pointSize * 1.2
      swL.frame = NSRect(x: 0, y: y, width: W, height: lh); swL.alignment = .center
      y += lh + 8
    }
    // PS 1.65: the "Just tomorrow" line sits right under the alarm line, as wide as its words (so only they are a click).
    let onceW = onceText.map { ceil(($0 as NSString).size(withAttributes: [.font: onceL.font as Any]).width) + 28 } ?? 0
    for (l, h, on) in [(countL as NSView, CGFloat(26), L.shows("count")), (onceL as NSView, CGFloat(22), onceText != nil), (alarm as NSView, CGFloat(22), L.shows("alarm")), (sub as NSView, CGFloat(36), L.shows("asleep") || ringing), (dateL as NSView, CGFloat(30), L.shows("date"))] {
      l.isHidden = !on
      if on { l.frame = l === onceL ? NSRect(x: (W - min(W, onceW)) / 2, y: y, width: min(W, onceW), height: h) : NSRect(x: 0, y: y, width: W, height: h); y += h + 4 }
    }
    if L.face == "analogue" {
      // V1.43: the face, sized by the same slider, never over 92% of the width or 64% of the height; the time small under it.
      let D = CGFloat(SleepRules.dialPoints(width: W, height: H, size: L.size, sides: sides))
      let small = max(22, min(56, D * 0.1))
      clock.font = SleepFonts.font(L.font, size: small, weight: L.weight, dir: sys.fontDir())
      clock.isHidden = !L.digi
      if L.digi { clock.frame = NSRect(x: 0, y: y, width: W, height: small * 1.3); y += small * 1.3 + 6 }
      dialV.isHidden = false
      dialV.fontFor = { [weak self] size in SleepFonts.font(L.font, size: size, weight: L.weight, dir: self?.sys.fontDir()) }
      dialV.frame = NSRect(x: (W - D) / 2, y: y, width: D, height: D)
      y += D + 8
    } else {
      dialV.isHidden = true; clock.isHidden = false
      let ch = big * 1.25
      clock.frame = NSRect(x: 0, y: y, width: W, height: ch)
      y += ch
    }
    // A sweeping second hand redraws 30 times a second (only the face); otherwise the face redraws with the clock.
    dialTick?.invalidate(); dialTick = nil
    if L.face == "analogue", L.hand == "sweep", !sys.reduceMotion(), !test {
      dialTick = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.dialV.needsDisplay = true }
    }
    face.setFrameSize(NSSize(width: W, height: y))
    switch L.pos {
    case "top": faceBase = max(130, H - y - H * 0.07)
    case "bottom": faceBase = 130 + (L.shows("panel") ? 20 : 0)
    default: faceBase = max(130, (H - y) / 2 + H * 0.04)
    }
    face.setFrameOrigin(NSPoint(x: 0, y: faceBase))
    window?.backgroundColor = SleepScreen.color(L.bg, 1)
    v.layer?.backgroundColor = SleepScreen.color(L.bg, 1).cgColor
    psLog("PS sleep: look laid out (\(L.font) \(L.weight == 0 ? "usual" : String(L.weight)) \(Int(L.size))%, spacing \(Int(L.spacing)), clock \(Int(big)) pt, \(L.pos), stopwatch \(L.watch))")
  }

  private func draw() {
    guard isUp, let p = plan, let v = window?.contentView else { return }
    let L = p.look
    let now = Date().timeIntervalSince1970 * 1000
    let ringing = ring != nil
    let peek = now < peekUntil
    let cal = Calendar.current, d = Date()
    let c = SleepRules.clockText(hour: cal.component(.hour, from: d), minute: cal.component(.minute, from: d), second: cal.component(.second, from: d), h12: L.h12, secs: L.secs)
    onceText = p.once.flatMap { L.shows("alarm") ? "\($0.line)  \u{203A}" : nil }
    layFace(L, chars: c.time.count + (c.ampm == nil ? 0 : 2), ringing: ringing, sides: guardian?.sideReserve(plan: p) ?? 0, in: v)
    // V1.43: the other words have their own colour; on a bright light (Bright white, a full sunrise) they turn dark.
    let darkInk = NSColor(srgbRed: 26 / 255, green: 15 / 255, blue: 6 / 255, alpha: 1)
    let ink = { (a: Double) in self.lightDark ? darkInk.withAlphaComponent(CGFloat(max(0.5, min(1, a)))) : SleepScreen.color(L.text, CGFloat(min(1, a))) }
    let b = L.bright
    let clockInk = lightDark ? darkInk : ringing ? SleepScreen.glow(0.96) : SleepScreen.color(L.ink, CGFloat(min(1, b)))
    let kern = (clock.font?.pointSize ?? 100) * CGFloat(SleepFonts.baseSpacing(L.font) + L.spacing / 100)
    let t = SleepRules.clockString(time: c.time, ampm: c.ampm, font: clock.font ?? NSFont.systemFont(ofSize: 100), ink: clockInk, kern: kern)
    let next = p.rings.first { $0.at > now }
    countL.stringValue = next.map { WakeRules.countdown($0.at, now) } ?? ""
    countL.textColor = ink(b * 0.577)
    clock.attributedStringValue = t
    if L.face == "analogue" {
      dialV.look = L; dialV.dark = lightDark; dialV.ringing = ringing; dialV.calm = sys.reduceMotion()
      dialV.needsDisplay = true
    }
    sub.stringValue = ringing ? p.word("ringing", "Good morning") : SleepRules.asleepFor(since: p.since, now: now)
    sub.textColor = ringing ? SleepScreen.glow(0.86) : ink(b * 0.744)
    alarm.stringValue = p.word("alarm", p.rings.isEmpty ? "No alarm, silent all night" : "Alarm \(p.rings[0].label)")
    alarm.textColor = ink(b * 0.46)
    // PS 1.65: the line is a little dimmer than the alarm line, and brightens with the controls (a key or a click).
    if let t = onceText {
      let a = ink(((ring != nil || peek || dawn != nil) ? 0.5 : 0.36) * b / 0.78)
      if onceL.title != t {
        if !onceL.title.isEmpty, let l = onceL.layer { let tr = CATransition(); tr.type = .fade; tr.duration = sys.reduceMotion() ? 0.12 : 0.35; l.add(tr, forKey: "onceFade") }
        onceL.title = t
      }
      onceL.fill = .clear; onceL.edge = .clear; onceL.ink = a; onceL.needsDisplay = true
    }
    onceL.isHidden = onceText == nil
    if onceText == nil, onceBox != nil { closeOnce(animated: false) }
    dateL.stringValue = SleepScreen.dateFmt.string(from: d)
    dateL.textColor = ink(b * 0.744)
    // The stopwatch.
    swL.stringValue = SleepRules.watchText(sw.ms(now)); swL.textColor = ink(L.watch == "big" ? b : b * 0.9)
    for (btn, title, on) in [(swGo, sw.run ? p.word("pause", "Pause") : p.word("start", "Start"), true), (swReset, p.word("reset", "Reset"), sw.run || sw.acc > 0)] {
      guard let btn else { continue }
      btn.title = title; btn.isEnabled = on
      btn.fill = ink(0.08); btn.edge = ink(0.22); btn.ink = ink(on ? b * 1.05 : b * 0.4); btn.needsDisplay = true
    }
    // The drift against burn in, a slow glide to the next spot.
    let dr = SleepRules.driftAt(now)
    let target = NSPoint(x: dr.x, y: faceBase + dr.y)
    if face.frame.origin != target { NSAnimationContext.runAnimationGroup { $0.duration = 6; face.animator().setFrameOrigin(target) } }
    // The panel near the wake time (or while ringing, or poked).
    let up = L.shows("panel") && (ringing || peek || (p.panel.map { now >= $0 } ?? false))
    pTasks.stringValue = L.shows("tasks") ? p.word("tasks", "\(p.count) tasks for today") : ""
    pList.stringValue = L.shows("tasks") && p.details ? p.titles.map { "\u{2022} \($0)" }.joined(separator: "\n") : ""
    pSquad.stringValue = L.shows("squad") ? (p.words["squad"] ?? "") : ""
    pWake.stringValue = p.wake.map { now < $0 ? "Wake time \(SleepScreen.clockFmt.string(from: Date(timeIntervalSince1970: $0 / 1000)))" : "" } ?? ""
    layoutPanel()
    panel.layer?.backgroundColor = ink(0.06).cgColor; panel.layer?.borderColor = ink(0.14).cgColor
    pTasks.textColor = ink(b * 1.03); pList.textColor = ink(b * 0.846); pSquad.textColor = ink(b * 0.9); pWake.textColor = ink(b * 0.577)
    let pa: CGFloat = up ? 1 : 0
    if panel.alphaValue != pa { NSAnimationContext.runAnimationGroup { $0.duration = 0.8; panel.animator().alphaValue = pa } }
    // Buttons: dim until poked or ringing, so the screen stays dark.
    let lit = ringing || peek || dawn != nil
    let wiTitle = p.timer.map { "\(p.word("wakeIn", "Wake me up in")): \(SleepScreen.clockFmt.string(from: Date(timeIntervalSince1970: $0.at / 1000)))" } ?? p.word("wakeIn", "Wake me up in")
    for (btn, word, fallback) in [(wakeBtn, "wakeUp", "Wake up"), (custBtn, "customise", "Customise"), (wiBtn, "", wiTitle), (gearBtn, "settings", "Settings")] {
      guard let btn else { continue }
      btn.isHidden = p.alarmOnly   // V1.47: an alarm with Sleep mode off has only Stop
      btn.title = word.isEmpty ? fallback : p.word(word, fallback)
      btn.fill = ink(lit ? 0.12 : 0.04); btn.edge = ink(lit ? 0.3 : 0.1); btn.ink = ink(lit ? 0.9 : (btn === custBtn || btn === wiBtn || btn === gearBtn ? 0.22 : 0.35))
      btn.needsDisplay = true
    }
    if let sb = stopBtn {
      sb.isHidden = !ringing && dawn == nil
      sb.title = p.word("stop", "Stop alarm")
      sb.fill = SleepScreen.glow(0.92); sb.edge = .clear; sb.ink = NSColor(srgbRed: 26 / 255, green: 15 / 255, blue: 6 / 255, alpha: 1)
      sb.needsDisplay = true
    }
    let gl = guardian?.lines(onBattery: onBattery)   // V1.52: Sentry mode's own words while it protects this screen
    battery.stringValue = gl?.battery ?? (onBattery ? p.word("battery", "On battery. Plug in to keep Sleep mode on all night. It stops at 20%.") : "")
    battery.textColor = SleepScreen.glow(0.7)
    hint.stringValue = lit && !p.alarmOnly ? (gl?.hint ?? p.word("locked", "Wake up asks for Touch ID or your Mac password.")) : ""
    hint.textColor = ink(b * 0.436)
    guardian?.draw(plan: p, lit: lit, ink: ink(1), drift: dr)
    placeOnce()
  }
  private func layoutPanel() {
    let pw = panel.frame.width
    var y: CGFloat = 14
    let lines = pList.stringValue.isEmpty ? 0 : pList.stringValue.split(separator: "\n").count
    let rows: [(NSTextField, CGFloat)] = [(pWake, pWake.stringValue.isEmpty ? 0 : 16), (pSquad, pSquad.stringValue.isEmpty ? 0 : 20), (pList, CGFloat(lines) * 19), (pTasks, pTasks.stringValue.isEmpty ? 0 : 24)]
    for (l, h) in rows {
      l.isHidden = h == 0
      if h > 0 { l.frame = NSRect(x: 18, y: y, width: pw - 36, height: h); y += h + 4 }
    }
    let H = y + 10
    let ringing = ring != nil
    let base: CGFloat = ringing ? 186 : 126
    if panel.frame.height != H || panel.frame.minY != base { panel.setFrameSize(NSSize(width: pw, height: H)); panel.setFrameOrigin(NSPoint(x: panel.frame.minX, y: base)) }
  }
  /// A key or a click: the controls and the panel brighten for 8 seconds. Nothing else.
  private func poke() {
    peekUntil = Date().timeIntervalSince1970 * 1000 + 8000
    draw()
  }

  // MARK: V1.52 for SleepSentry.swift (the AI Sentry mode button)

  /// The display this screen is on (Sentry covers only the others). Nil while nothing is up or in a test copy.
  var display: CGDirectDisplayID? {
    (window?.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
  }
  /// The screen goes for Sentry mode's reason (the Mac is locked, or Sentry mode ended). Never asks again.
  func closeFromGuard(_ why: String, woke: Double?) {
    guard isUp else { return }
    guardClosing = true
    close(why: why, woke: woke)
    guardClosing = false
  }
  /// Step aside for Sentry mode's Touch ID fallback sheet (true), or come back (false).
  func stepBehind(_ on: Bool) { behind(on) }
  /// Sentry's battery stop could not lock the Mac: let it sleep (macOS asks for the password when it wakes).
  func letSleep() { if let a = assertion { sys.releaseAwake(a); assertion = nil; psLog("PS sleep: keep awake let go (Sentry mode's battery stop)") } }
  /// Like Settings: Touch ID or the password (unless switched off), then the screen goes and the Tab list shows.
  func askFromGuard(_ why: String) { ask(why) }
  /// A tap on the button: the controls brighten like any other tap.
  func touched() { poke() }
  /// A redraw now (the button changed state).
  func redraw() { draw() }
  var lookNow: SleepPlanN.Look? { plan?.look }

  // MARK: what else happens while it is up

  private func watch() {
    guard observers.isEmpty else { return }
    let ws = NSWorkspace.shared.notificationCenter, nc = NotificationCenter.default
    let me = ProcessInfo.processInfo.processIdentifier
    observers.append((ws, ws.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] n in
      let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
      self?.appActivated(app?.bundleIdentifier, pid: app?.processIdentifier ?? 0, me: me)
    }))
    // The screens changed (a display unplugged): fit the window to the screen under the mouse again.
    observers.append((nc, nc.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self, let w = self.window, !self.test, let s = self.sys.mouseScreen() else { return }
      w.setFrame(s.frame, display: true)
    }))
    // Woke from sleep (lid opened): check the power at once.
    observers.append((ws, ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.checkPower() }))
  }
  private func unwatch() { for (c, o) in observers { c.removeObserver(o) }; observers = [] }

  /// Golden rule: 1Password or Signal in front, Sleep mode steps aside at once (ordered out, keyboard theirs); any
  /// other app coming forward (it should not, with app switching off) puts the clock back in front.
  func appActivated(_ bundleId: String?, pid: Int32, me: Int32 = ProcessInfo.processInfo.processIdentifier) {
    guard isUp, let w = window, pid != me else { return }
    if Protected.matches(bundleId) {
      stepAside = true
      sys.kiosk(false)
      w.orderOut(nil)
      psLog("PS sleep: stepped aside for a protected app")
    } else if stepAside {
      stepAside = false
      if !test { w.orderFrontRegardless(); w.makeKey() }
      sys.kiosk(true)
    }
  }
}
