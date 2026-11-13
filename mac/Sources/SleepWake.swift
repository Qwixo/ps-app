// Sleep mode's wake up on a Mac (V1.43; web src/core/sleepwake.ts has the same rules and numbers).
// The developer, 8 Nov 2026: a "Wake me up in" timer with suggested sleep cycles, and creative wake up options (red or coloured
// light, a really loud sound, the screen going white and flashing). "Be creative and come up with a few different
// examples." Also more fonts and letter styles: the clock loads the very same font files the web page bundles (in
// the web folder PS already has), so the Mac clock looks like the preview. Nothing is downloaded.
// Safety, always: Esc leaves (and locks PS), Stop is big and needs no Touch ID, Strobe flash only rings once switched
// on behind its warning (the page sends it) and never flashes faster than 3 times a second, and Loud and Bright white
// put the volume and the brightness back the moment the alarm stops.
import Cocoa
import CoreText

/// The pure rules (no AppKit window, no clock of its own): the same as core/sleepwake.ts.
enum WakeRules {
  static let styles = ["chime", "sunrise", "alert", "wave", "white", "strobe", "light", "loud"]
  /// How each style sounds: none, a soft chime or an alarm; how loud it starts and how long it takes to be full.
  struct Spec { let sound: String; let start: Double; let rise: Double; let loud: Bool; let bright: Bool }
  static func spec(_ s: String) -> Spec {
    // V1.44: every style starts at half or more and is full within 30 s (V1.43 started at 12 to 35% and took up to 2
    // minutes, so a friend found every style but Loud "super quiet"). Loud alone ignores the alarm loudness.
    switch s {
    case "sunrise": return Spec(sound: "soft", start: 0.5, rise: 30_000, loud: false, bright: false)
    case "alert": return Spec(sound: "alarm", start: 0.7, rise: 10_000, loud: false, bright: false)
    case "white", "strobe": return Spec(sound: "alarm", start: 0.8, rise: 5_000, loud: false, bright: true)
    case "light": return Spec(sound: "none", start: 0, rise: 0, loud: false, bright: false)
    case "loud": return Spec(sound: "alarm", start: 1, rise: 0, loud: true, bright: false)
    default: return Spec(sound: "soft", start: 0.5, rise: 20_000, loud: false, bright: false)   // chime, wave
    }
  }
  /// The style that really rings: Strobe flash only once switched on (else Bright white, never a flash).
  static func style(_ s: String?, strobe: Bool) -> String {
    let v = styles.contains(s ?? "") ? s! : "chime"
    return v == "strobe" && !strobe ? "white" : v
  }
  /// How loud the alarm is `ms` after it started: it rises unless Loud, Silent light is silent.
  static func volume(_ style: String, _ ms: Double) -> Double {
    let s = spec(style)
    if s.sound == "none" { return 0 }
    if s.rise <= 0 { return 1 }
    return min(1, max(s.start, s.start + (1 - s.start) * max(0, ms) / s.rise))
  }
  static let strobeHz = 2.0, strobeMaxHz = 3.0
  static let pulseMs = 2000.0, waveMs = 6000.0, breatheMs = 4000.0   // no pulse faster than one every 2 seconds
  typealias RGB = (r: Double, g: Double, b: Double)
  static let warm: RGB = (255, 238, 212)
  static let ramp: [(Double, RGB)] = [(0, (36, 2, 0)), (0.3, (120, 14, 4)), (0.6, (230, 92, 30)), (0.85, (255, 182, 110)), (1, warm)]
  static func mix(_ a: RGB, _ b: RGB, _ k: Double) -> RGB { ((a.r + (b.r - a.r) * k).rounded(), (a.g + (b.g - a.g) * k).rounded(), (a.b + (b.b - a.b) * k).rounded()) }
  static func sunrise(_ p: Double) -> (rgb: RGB, a: Double) {
    let q = max(0, min(1, p))
    var i = 0
    while i < ramp.count - 2 && q > ramp[i + 1].0 { i += 1 }
    let (p0, c0) = ramp[i], (p1, c1) = ramp[i + 1]
    return (mix(c0, c1, p1 > p0 ? (q - p0) / (p1 - p0) : 1), 0.25 + 0.75 * q)
  }
  static func wave01(_ t: Double, _ period: Double) -> Double { 0.5 - 0.5 * cos(2 * Double.pi * t / period) }
  /// Is the strobe white `t` ms into the ring (half a period on, half off, never over 3 a second)?
  static func strobeOn(_ t: Double, hz: Double = strobeHz) -> Bool { Int(floor(max(0, t) * 2 * min(hz, strobeMaxHz) / 1000)) % 2 == 0 }
  /// The light over the screen `t` ms after the alarm time (negative: before it; only Sunrise lights up then).
  /// Nil: no light. `calm` (Reduce motion is on): no pulse, no wave, no flashes, a steady light instead.
  static func light(_ style: String, _ t: Double, dawnMs: Double, wave: RGB, ink: RGB, calm: Bool = false) -> (rgb: RGB, a: Double)? {
    if t < 0 { return style == "sunrise" && dawnMs > 0 && -t <= dawnMs ? sunrise(1 + t / dawnMs) : nil }
    switch style {
    case "sunrise": return (warm, 1)
    case "alert": return ((255, 26, 16), calm ? 0.8 : 0.25 + 0.75 * wave01(t, pulseMs))
    case "wave": return (wave, calm ? 0.8 : 0.3 + 0.7 * wave01(t, waveMs))
    case "white": return ((255, 255, 255), 1)
    case "strobe": return calm || strobeOn(t) ? ((255, 255, 255), 1) : ((0, 0, 0), 1)
    case "light": return (mix(ink, warm, 0.35), calm ? 0.6 : 0.35 + 0.5 * wave01(t, breatheMs))
    default: return nil
    }
  }
  /// Dark words on a bright light (Stop on Bright white stays readable).
  static func darkOn(_ l: (rgb: RGB, a: Double)?) -> Bool {
    guard let l else { return false }
    return (0.2126 * l.rgb.r + 0.7152 * l.rgb.g + 0.0722 * l.rgb.b) * l.a > 140
  }
  static func rgb(_ hex: String) -> RGB {
    let n = Int(hex.dropFirst(), radix: 16) ?? 0xe7a35e
    return (Double((n >> 16) & 255), Double((n >> 8) & 255), Double(n & 255))
  }

  // ---------- "Wake me up in" ----------
  static let wakeInMin = 5, wakeInMax = 16 * 60
  static func okWakeIn(_ m: Int) -> Int? { m >= wakeInMin && m <= wakeInMax ? m : nil }
  /// When "Wake me up in `mins`" rings from `now`, on a whole minute (the page does the same).
  static func wakeInAt(_ now: Double, _ mins: Int) -> Double { ((now + Double(mins) * 60_000) / 60_000).rounded() * 60_000 }
  /// "20 min", "1 h 45", "7 h".
  static func durText(_ mins: Int) -> String {
    let m = max(0, mins), h = m / 60, r = m % 60
    return h == 0 ? "\(r) min" : r == 0 ? "\(h) h" : "\(h) h \(String(format: "%02d", r))"
  }
  /// "Wakes you in 6 h 12" (the countdown under the clock).
  static func countdown(_ at: Double, _ now: Double) -> String {
    let m = Int(ceil((at - now) / 60_000))
    return m <= 0 ? "Waking you now" : "Wakes you in \(durText(m))"
  }
  /// The suggestions if the page sent none (the research list, the same as core/sleepwake.ts SLEEP_CYCLES): naps of
  /// 10, 20 and 90 minutes plus 5 to fall asleep, sleeps of 4 h 30, 6 h, 7 h 30 and 9 h plus 15.
  static let fallbackChoices: [(name: String, mins: Int, sleep: Int)] =
    ([10, 20, 90].map { ("Nap", $0 + 5, $0) }) + ([270, 360, 450, 540].map { m in (m <= 360 ? "Short sleep" : "\(m / 90) sleep loops", m + 15, m) })
}

/// The clock's fonts (V1.43): the twelve the page offers. Most come from the web folder PS already has (the same
/// files the page bundles, found by name), the rest are the Mac's own. A file that is missing falls back to the
/// nearest system font, never to nothing.
enum SleepFonts {
  static let all = ["thin", "bold", "rounded", "clean", "mono", "type", "serif", "digital", "pixel", "hand", "marker", "chalk"]
  /// The bundled file (its name before the build's hash) and the font's own weight and letter spacing (em), the same
  /// as views/sleepmode.css.
  static let files: [String: (file: String, weight: Int, spacing: Double)] = [
    "clean": ("AtkinsonHyperlegibleNext-Variable", 300, -0.02), "mono": ("JetBrainsMono-Variable", 300, -0.04),
    "type": ("IBMPlexMono-Regular", 400, -0.02), "serif": ("SourceSerif4-Variable", 400, -0.02),
    "digital": ("Silkscreen-Regular", 400, 0.02), "pixel": ("PixelifySans-Variable", 400, 0),
    "hand": ("Caveat-Variable", 500, 0), "marker": ("PatrickHand-Regular", 400, 0), "chalk": ("GochiHand-Regular", 400, 0.01),
  ]
  static func baseSpacing(_ id: String) -> Double {
    switch id { case "bold": return -0.045; case "thin", "rounded": return -0.03; default: return files[id]?.spacing ?? -0.03 }
  }
  static func baseWeight(_ id: String) -> Int {
    switch id { case "bold": return 800; case "rounded": return 500; case "thin": return 200; default: return files[id]?.weight ?? 400 }
  }
  static func nsWeight(_ w: Int) -> NSFont.Weight {
    switch w { case ...150: return .ultraLight; case ...250: return .thin; case ...350: return .light; case ...450: return .regular
    case ...550: return .medium; case ...650: return .semibold; case ...750: return .bold; case ...850: return .heavy; default: return .black }
  }
  private static var cache: [String: [CTFontDescriptor]] = [:]
  /// The descriptors in a bundled file, looked up once (by its name, any build hash after it).
  static func descriptors(_ name: String, in dir: URL?) -> [CTFontDescriptor] {
    if let c = cache[name] { return c }
    var out: [CTFontDescriptor] = []
    if let dir, let list = try? FileManager.default.contentsOfDirectory(atPath: dir.path),
       let f = list.sorted().first(where: { ($0.hasPrefix(name + "-") || $0.hasPrefix(name + ".")) && ($0.hasSuffix(".woff2") || $0.hasSuffix(".ttf")) }),
       let data = FileManager.default.contents(atPath: dir.appendingPathComponent(f).path) {
      out = (CTFontManagerCreateFontDescriptorsFromData(data as CFData) as? [CTFontDescriptor]) ?? []
    }
    cache[name] = out
    return out
  }
  /// The clock's font at `size`, in `weight` (0: the font's own).
  static func font(_ id: String, size: CGFloat, weight: Int, dir: URL?) -> NSFont {
    let w = weight > 0 ? weight : baseWeight(id)
    func design(_ d: NSFontDescriptor.SystemDesign) -> NSFont {
      let b = NSFont.systemFont(ofSize: size, weight: nsWeight(w))
      return b.fontDescriptor.withDesign(d).flatMap { NSFont(descriptor: $0, size: size) } ?? b
    }
    switch id {
    case "rounded": return design(.rounded)
    case "thin", "bold": return NSFont.monospacedDigitSystemFont(ofSize: size, weight: nsWeight(w))
    default: break
    }
    guard let f = files[id], let d = descriptors(f.file, in: dir).first else {
      // The nearest Mac font when the file is missing.
      let fallback: NSFont? = ["serif": design(.serif), "mono": NSFont.monospacedSystemFont(ofSize: size, weight: nsWeight(w)),
                               "type": NSFont(name: "AmericanTypewriter", size: size), "hand": NSFont(name: "BradleyHandITCTT-Bold", size: size),
                               "marker": NSFont(name: "ChalkboardSE-Regular", size: size), "chalk": NSFont(name: "ChalkboardSE-Regular", size: size)][id] ?? nil
      return fallback ?? NSFont.monospacedDigitSystemFont(ofSize: size, weight: nsWeight(w))
    }
    var font = CTFontCreateWithFontDescriptor(d, size, nil)
    // A variable font takes the weight on its own axis; a fixed one keeps its weight (the page shows the same).
    let wght: UInt32 = 0x77676874
    if let axes = CTFontCopyVariationAxes(font) as? [[String: Any]],
       axes.contains(where: { ($0[kCTFontVariationAxisIdentifierKey as String] as? NSNumber)?.uint32Value == wght }) {
      let attrs = [kCTFontVariationAttribute: [NSNumber(value: wght): NSNumber(value: w)]] as CFDictionary
      font = CTFontCreateCopyWithAttributes(font, size, nil, CTFontDescriptorCreateWithAttributes(attrs))
    }
    return font as NSFont
  }
}

/// V1.43 (the developer: "the option to have a clock face as well"): the analogue face, drawn here (no image files). Ticks,
/// numbers or roman numerals; smooth hour and minute hands; a second hand that sweeps (SleepScreen redraws it 30
/// times a second), ticks, or is left out; face, hands and ticks in their own colours with a soft glow.
final class SleepDial: NSView {
  var look = SleepPlanN.Look()
  var dark = false, ringing = false, calm = false
  var fontFor: (CGFloat) -> NSFont = { NSFont.systemFont(ofSize: $0) }
  override var isFlipped: Bool { false }
  override func draw(_ dirty: NSRect) {
    let b = bounds, D = min(b.width, b.height), r = D / 2, c = NSPoint(x: b.midX, y: b.midY)
    let L = look, a = CGFloat(L.bright)
    let darkInk = NSColor(srgbRed: 26 / 255, green: 15 / 255, blue: 6 / 255, alpha: 1)
    func col(_ hex: String, _ k: CGFloat) -> NSColor { dark ? darkInk.withAlphaComponent(max(0.5, min(1, k))) : SleepScreen.color(hex, min(1, a * k)) }
    let glowInk = SleepScreen.color(L.faceInk, a * 0.45)
    let u = r / 100   // the page's dial is drawn in a 200 by 200 box: the same numbers here
    func pt(_ deg: Double, _ rad: CGFloat) -> NSPoint { let t = CGFloat((90 - deg) * Double.pi / 180); return NSPoint(x: c.x + rad * cos(t), y: c.y + rad * sin(t)) }
    NSGraphicsContext.saveGraphicsState()
    let glow = NSShadow(); glow.shadowColor = dark ? .clear : glowInk; glow.shadowBlurRadius = 10 * u * a; glow.set()
    let faceP = NSBezierPath(ovalIn: NSRect(x: c.x - 97 * u, y: c.y - 97 * u, width: 194 * u, height: 194 * u))
    SleepScreen.color(L.faceInk, 0.045).setFill(); faceP.fill()
    col(L.faceInk, 0.5).setStroke(); faceP.lineWidth = 1.4 * u; faceP.stroke()
    let labels = SleepRules.dialLabels(L.dial)
    for i in 0..<60 {
      let major = i % 5 == 0, deg = Double(i * 6)
      if !labels.isEmpty {
        if major {
          let s = labels[i / 5] as NSString
          let f = fontFor((L.dial == "roman" ? 12.5 : 15) * u)
          let attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: col(L.tickInk, 0.95)]
          let sz = s.size(withAttributes: attrs), p = pt(deg, 72 * u)
          s.draw(at: NSPoint(x: p.x - sz.width / 2, y: p.y - sz.height / 2), withAttributes: attrs)
        } else {
          let p = pt(deg, 90 * u)
          col(L.tickInk, 0.55).setFill(); NSBezierPath(ovalIn: NSRect(x: p.x - 0.9 * u, y: p.y - 0.9 * u, width: 1.8 * u, height: 1.8 * u)).fill()
        }
        continue
      }
      let line = NSBezierPath(); line.move(to: pt(deg, 92 * u)); line.line(to: pt(deg, (major ? 79 : 87) * u))
      line.lineWidth = (major ? 2.6 : 1) * u; line.lineCapStyle = .round
      col(L.tickInk, major ? 0.95 : 0.5).setStroke(); line.stroke()
    }
    let now = Date(), cal = Calendar.current
    let ms = Int((now.timeIntervalSince1970 * 1000).truncatingRemainder(dividingBy: 1000))
    let ang = SleepRules.handAngles(hour: cal.component(.hour, from: now), minute: cal.component(.minute, from: now), second: cal.component(.second, from: now), ms: ms, sweep: L.hand == "sweep" && !calm)
    let handCol = ringing && !dark ? SleepScreen.glow(0.96) : col(L.handInk, 1)
    func hand(_ deg: Double, back: CGFloat, len: CGFloat, w: CGFloat, _ color: NSColor) {
      let p = NSBezierPath(); p.move(to: pt(deg + 180, back * u)); p.line(to: pt(deg, len * u)); p.lineWidth = w * u; p.lineCapStyle = .round
      color.setStroke(); p.stroke()
    }
    hand(ang.hour, back: 8, len: 48, w: 6, handCol)
    hand(ang.minute, back: 10, len: 74, w: 3.6, handCol)
    if L.hand != "none" { hand(ang.second, back: 14, len: 84, w: 1.3, ringing && !dark ? SleepScreen.glow(0.8) : col(L.handInk, 0.8)) }
    handCol.setFill(); NSBezierPath(ovalIn: NSRect(x: c.x - 3.6 * u, y: c.y - 3.6 * u, width: 7.2 * u, height: 7.2 * u)).fill()
    NSGraphicsContext.restoreGraphicsState()
  }
}
