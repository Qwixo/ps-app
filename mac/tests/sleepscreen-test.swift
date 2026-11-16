// Sleep mode's screen rules on a Mac (Sources/SleepScreen.swift SleepRules and SleepPlanN.Look), V1.42 Customise.
// Run: tests/sleepscreen-test.sh. Pure rules only: no window, no Touch ID, no power assertion. FICTIONAL values.
import Foundation
import LocalAuthentication
import CryptoKit
import AppKit

var n = 0
func ok(_ name: String, _ f: () -> Bool) { if f() { n += 1; print("ok - \(name)") } else { print("FAIL - \(name)"); exit(1) } }

ok("the clock: 24 hour, 12 hour with AM and PM, seconds") {
  SleepRules.clockText(hour: 19, minute: 5, second: 9, h12: false, secs: false) == ("19:05", nil)
  && SleepRules.clockText(hour: 19, minute: 5, second: 9, h12: true, secs: false) == ("7:05", "PM")
  && SleepRules.clockText(hour: 19, minute: 5, second: 9, h12: false, secs: true) == ("19:05:09", nil)
  && SleepRules.clockText(hour: 0, minute: 30, second: 0, h12: true, secs: false) == ("12:30", "AM")
  && SleepRules.clockText(hour: 0, minute: 30, second: 0, h12: false, secs: false) == ("00:30", nil)
}
ok("the clock size follows the slider and never runs off the screen") {
  let usual = SleepRules.clockPoints(width: 1440, size: 100, chars: 5)
  let small = SleepRules.clockPoints(width: 1440, size: 50, chars: 5)
  let huge = SleepRules.clockPoints(width: 1440, size: 300, chars: 5)
  let secs = SleepRules.clockPoints(width: 1440, size: 300, chars: 8)
  return usual == 240 && small == 120 && huge <= 1440 * 0.94 / (5 * 0.6) && huge > usual && secs < huge
}
ok("the stopwatch keeps time from timestamps, pauses, starts again") {
  var w = SleepRules.Watch()
  w = w.toggled(1000)
  let a = w.ms(61_000)                       // a minute, however few ticks the screen drew
  w = w.toggled(61_000)
  let b = w.ms(999_000)                      // paused: frozen
  w = w.toggled(100_000)
  return a == 60_000 && b == 60_000 && w.ms(105_500) == 65_500 && SleepRules.Watch().ms(5000) == 0
}
ok("the stopwatch words") {
  SleepRules.watchText(7_000) == "0:07" && SleepRules.watchText(754_000) == "12:34" && SleepRules.watchText(3_723_000) == "1:02:03"
}
ok("the pointer hides after the chosen seconds, never with 0") {
  !SleepRules.pointerHides(secs: 3, stillFor: 2_999) && SleepRules.pointerHides(secs: 3, stillFor: 3_000)
  && !SleepRules.pointerHides(secs: 0, stillFor: 9_999_999)
}
ok("the look from the page is checked: junk dropped, numbers in range, the V1.40 look when there is none") {
  let none = SleepPlanN.Look.parse(nil)
  let l = SleepPlanN.Look.parse(["size": 9999, "font": "comic", "h12": true, "ink": "red", "bright": 0.01, "bg": "#1A2B3C", "pos": "top",
                                 "show": ["date": true, "squad": false, "evil": true], "watch": "big", "pointer": -3] as [String: Any])
  return none == SleepPlanN.Look() && !none.shows("date") && none.shows("asleep")
    && l.size == 300 && l.font == "thin" && l.h12 && l.ink == "#e7a35e" && l.bright == 0.1 && l.bg == "#1a2b3c" && l.pos == "top"
    && l.shows("date") && !l.shows("squad") && l.show["evil"] == nil && l.watch == "big" && l.pointer == 0
}
ok("the plan carries the look") {
  let p = SleepPlanN.parse(["since": 1000, "look": ["font": "serif", "watch": "off"]] as [String: Any])
  return p?.look.font == "serif" && p?.look.watch == "off" && SleepPlanN.parse(["since": 1000] as [String: Any])?.look == SleepPlanN.Look()
}
ok("Wake up: a cancel or a wrong password keeps the clock, anything else lets go (never a trap)") {
  SleepRules.authOutcome(ok: true, code: nil) == "passed"
  && SleepRules.authOutcome(ok: false, code: LAError.userCancel.rawValue) == "again"
  && SleepRules.authOutcome(ok: false, code: LAError.authenticationFailed.rawValue) == "again"
  && SleepRules.authOutcome(ok: false, code: LAError.systemCancel.rawValue) == "letGo"
  && SleepRules.authOutcome(ok: false, code: LAError.passcodeNotSet.rawValue) == "letGo"
  && SleepRules.authOutcome(ok: false, code: nil) == "letGo"
}
ok("Touch ID to leave: on unless the page switched it off (an older page: on)") {
  SleepPlanN.parse(["since": 1000] as [String: Any])?.lock == true
  && SleepPlanN.parse(["since": 1000, "lock": false] as [String: Any])?.lock == false
  && SleepPlanN.parse(["since": 1000, "lock": "no"] as [String: Any])?.lock == true
}

// ---------- V1.43: fonts, colours, "Wake me up in", wake styles (the same numbers as core/sleepwake.ts) ----------
ok("the look (V1.43): twelve fonts, weight, spacing, the other words' colour, the countdown off by default") {
  let l = SleepPlanN.Look.parse(["font": "hand", "weight": 650, "spacing": 99, "ink": "#A1B2C3", "text": "#f08cb6", "show": ["count": true]])
  let bad = SleepPlanN.Look.parse(["font": "comic", "weight": 50, "spacing": "x", "ink": "#a1b2c3", "text": "red"])
  return SleepFonts.all.count == 12 && l.font == "hand" && l.weight == 600 && l.spacing == 40 && l.text == "#f08cb6" && l.shows("count")
    && bad.font == "thin" && bad.weight == 0 && bad.spacing == 0 && bad.text == "#a1b2c3" && !bad.shows("count") && bad.shows("asleep")
}
ok("fonts: every one gives a usable font even with no font files (the Mac's nearest one)") {
  SleepFonts.all.allSatisfy { SleepFonts.font($0, size: 120, weight: 0, dir: nil).pointSize == 120 }
  && SleepFonts.font("thin", size: 80, weight: 900, dir: nil).pointSize == 80
}
ok("letter spacing makes the clock smaller so it still fits") {
  SleepRules.clockPoints(width: 1440, size: 300, chars: 5, spacing: 30) < SleepRules.clockPoints(width: 1440, size: 300, chars: 5)
}
ok("wake styles: Strobe flash rings as Bright white until it is switched on; junk is a soft chime") {
  WakeRules.style("strobe", strobe: false) == "white" && WakeRules.style("strobe", strobe: true) == "strobe"
  && WakeRules.style("disco", strobe: true) == "chime" && WakeRules.style(nil, strobe: false) == "chime"
}
ok("wake styles: sounds rise unless Loud, Silent light is silent, only Loud touches the volume") {
  WakeRules.volume("chime", 0) == 0.5 && abs(WakeRules.volume("chime", 10_000) - 0.75) < 1e-9 && WakeRules.volume("chime", 600_000) == 1
  && WakeRules.styles.filter { $0 != "light" }.allSatisfy { WakeRules.volume($0, 0) >= 0.5 && WakeRules.volume($0, 30_000) == 1 }
  && WakeRules.volume("loud", 0) == 1 && WakeRules.volume("light", 60_000) == 0
  && WakeRules.styles.filter { WakeRules.spec($0).loud } == ["loud"]
  && WakeRules.styles.filter { WakeRules.spec($0).bright } == ["white", "strobe"]
}
ok("wake styles: the sunrise warms up before the alarm, red pulses, white is white") {
  let o = (dawnMs: 20 * 60_000.0, wave: (10.0, 20.0, 250.0), ink: (231.0, 163.0, 94.0))
  let s0 = WakeRules.light("sunrise", -o.dawnMs, dawnMs: o.dawnMs, wave: o.wave, ink: o.ink)!, s1 = WakeRules.light("sunrise", 0, dawnMs: o.dawnMs, wave: o.wave, ink: o.ink)!
  let a1 = WakeRules.light("alert", WakeRules.pulseMs / 2, dawnMs: o.dawnMs, wave: o.wave, ink: o.ink)!
  return s0.rgb.r < 60 && s0.a < 0.3 && s1.a == 1 && s1.rgb.b > 200
    && WakeRules.light("sunrise", -o.dawnMs - 1, dawnMs: o.dawnMs, wave: o.wave, ink: o.ink) == nil
    && WakeRules.light("alert", -1, dawnMs: o.dawnMs, wave: o.wave, ink: o.ink) == nil
    && WakeRules.light("chime", 5, dawnMs: o.dawnMs, wave: o.wave, ink: o.ink) == nil
    && a1.a == 1 && a1.rgb.r == 255 && WakeRules.light("white", 9, dawnMs: 0, wave: o.wave, ink: o.ink)!.rgb == (255, 255, 255)
    && WakeRules.darkOn(WakeRules.light("white", 9, dawnMs: 0, wave: o.wave, ink: o.ink)) && !WakeRules.darkOn(s0)
}
ok("strobe: never over 3 flashes a second, even if asked for more; steady with Reduce motion") {
  func flashes(_ hz: Double) -> Int { var n = 0, prev = WakeRules.strobeOn(0, hz: hz); for t in 1...10_000 { let on = WakeRules.strobeOn(Double(t), hz: hz); if on && !prev { n += 1 }; prev = on }; return n }
  let calm = (0..<40).allSatisfy { WakeRules.light("strobe", Double($0) * 100, dawnMs: 0, wave: (0, 0, 0), ink: (0, 0, 0), calm: true)!.rgb == (255, 255, 255) }
  return flashes(WakeRules.strobeHz) == 20 && flashes(50) <= 30 && calm
}
ok("Wake me up in: on a whole minute, the words, the countdown, the suggestions an older page leaves out") {
  let now = 1_794_000_091_000.0   // 31 s past a minute
  return WakeRules.wakeInAt(now, 20) == 1_794_001_320_000 && WakeRules.okWakeIn(4) == nil && WakeRules.okWakeIn(960) == 960 && WakeRules.okWakeIn(961) == nil
    && WakeRules.durText(20) == "20 min" && WakeRules.durText(105) == "1 h 45" && WakeRules.durText(420) == "7 h"
    && WakeRules.countdown(now + 372 * 60_000, now) == "Wakes you in 6 h 12" && WakeRules.countdown(now - 1, now) == "Waking you now"
    && WakeRules.fallbackChoices.map { $0.mins } == [15, 25, 95, 285, 375, 465, 555]
    && WakeRules.fallbackChoices.map { $0.sleep } == [10, 20, 90, 270, 360, 450, 540]
    && WakeRules.fallbackChoices.map { $0.name } == ["Nap", "Nap", "Nap", "Short sleep", "Short sleep", "5 sleep loops", "6 sleep loops"]
}
ok("the plan (V1.43): each ring's style and light, the styles' settings, the suggestions, the timer, all checked") {
  let p = SleepPlanN.parse(["since": 1000, "rings": [
      ["id": "a", "at": 9_000_000, "label": "07:30", "style": "sunrise", "from": 9_000_000 - 20 * 60_000],
      ["id": "b", "at": 9_600_000, "label": "07:40", "style": "strobe", "from": 1],
      ["id": "timer", "at": 8_000_000, "label": "07:13", "style": "loud"]],
    "styles": ["wave": "#00FF00", "sunrise": 30, "strobe": false, "timer": "alert"],
    "wakeIn": [["name": "Power nap", "mins": 20, "sleep": 20], ["name": "evil", "mins": 99999]],
    "timer": ["at": 8_000_000, "mins": 105]] as [String: Any])!
  let r = Dictionary(uniqueKeysWithValues: p.rings.map { ($0.id, $0) })
  return p.rings.map { $0.id } == ["timer", "a", "b"] && r["a"]!.style == "sunrise" && r["a"]!.from == 9_000_000 - 20 * 60_000
    && r["b"]!.style == "white" && r["b"]!.from == 9_600_000 && r["timer"]!.style == "loud" && r["timer"]!.from == 8_000_000
    && p.wave == "#00ff00" && p.sunrise == 30 && !p.strobe && p.timerStyle == "alert"
    && p.wakeIn.count == 1 && p.timer?.mins == 105
    && SleepRules.dawnDue(p, now: 9_000_000 - 60_000, done: [])?.id == "a" && SleepRules.dawnDue(p, now: 9_000_000, done: []) == nil
}
ok("an older page's plan still works: no styles, no timer, the fallback suggestions") {
  let p = SleepPlanN.parse(["since": 1000, "rings": [["id": "a", "at": 5000, "label": "07:00"]]] as [String: Any])!
  return p.rings[0].style == "chime" && p.rings[0].from == 5000 && p.timer == nil && p.wakeIn.count == 7 && p.wave == "#4f7cff"
}
ok("a test copy never touches the real volume or brightness") {
  SleepSystem.test.volumeGet() == nil && SleepSystem.test.brightGet(1) == nil
}
ok("the analogue face (V1.43): parsed and checked, sized by the slider, the hands' angles, the labels") {
  let l = SleepPlanN.Look.parse(["face": "analogue", "dial": "roman", "hand": "none", "ink": "#112233", "handInk": "#FF0000", "digi": false])
  let bad = SleepPlanN.Look.parse(["face": "sundial", "dial": "hex", "hand": "fast", "ink": "#112233"])
  let a = SleepRules.handAngles(hour: 15, minute: 30, second: 15, ms: 500, sweep: true), t = SleepRules.handAngles(hour: 15, minute: 30, second: 15, ms: 500, sweep: false)
  return l.face == "analogue" && l.dial == "roman" && l.hand == "none" && !l.digi && l.handInk == "#ff0000" && l.faceInk == "#112233" && l.tickInk == "#112233"
    && bad.face == "digital" && bad.dial == "ticks" && bad.hand == "sweep" && bad.digi
    && a.minute == 30.25 * 6 && a.hour == (3 + 30.25 / 60) * 30 && a.second == 15.5 * 6 && t.second == 90
    && SleepRules.dialLabels("numbers").first == "12" && SleepRules.dialLabels("roman")[9] == "IX" && SleepRules.dialLabels("ticks").isEmpty
    && SleepRules.dialPoints(width: 1440, height: 900, size: 100) == 396 && SleepRules.dialPoints(width: 1440, height: 900, size: 300) == 576
    && SleepRules.dialPoints(width: 1440, height: 900, size: 50) == 198
}
// ---------- V1.44 the alarm's sound (Sources/SleepSound.swift): nothing is played, the volume is never touched ----------
func sine(_ f: Double, _ amp: Double, _ secs: Double, rate: Double = 8000) -> [Float] { (0..<Int(secs * rate)).map { Float(amp * sin(2 * .pi * f * Double($0) / rate)) } }
ok("V1.44 loudness: the loudest 400 ms, quiet and loud sounds to one level, never past 1, silence stays silent") {
  let s = sine(440, 0.5, 2)
  let rms = AlarmMath.loudest(s, rate: 8000)
  let levels = [0.02, 0.1, 0.3, 0.9].map { AlarmMath.toDb(AlarmMath.loudest(AlarmMath.normalise(sine(440, $0, 1), rate: 8000), rate: 8000)) }
  let peaks = [0.02, 0.9].map { AlarmMath.peak(AlarmMath.normalise(sine(440, $0, 1), rate: 8000)) }
  return abs(rms - 0.5 / 2.squareRoot()) < 0.003 && levels.allSatisfy { abs($0 - AlarmMath.targetDb) < 0.3 } && peaks.allSatisfy { $0 <= 1 }
    && AlarmMath.peak(AlarmMath.normalise([Float](repeating: 0, count: 800), rate: 8000)) == 0
    && AlarmMath.soften(0.5) == 0.5 && AlarmMath.soften(5) <= 1 && AlarmMath.soften(-5) == -AlarmMath.soften(5)
}
ok("V1.44 the built in sounds: V1.43 chime -18.7 dB and alarm -19.6 dB, both now -12 dB, the same as the page") {
  let rawSoft = AlarmMath.toDb(AlarmMath.loudest(AlarmMath.render(AlarmMath.soft.tones, loop: AlarmMath.soft.loop), rate: AlarmMath.rate))
  let rawAlarm = AlarmMath.toDb(AlarmMath.loudest(AlarmMath.render(AlarmMath.alarm.tones, loop: AlarmMath.alarm.loop), rate: AlarmMath.rate))
  let soft = AlarmMath.builtIn("soft"), alarm = AlarmMath.builtIn("alarm")
  let a = AlarmMath.toDb(AlarmMath.loudest(soft, rate: AlarmMath.rate)), b = AlarmMath.toDb(AlarmMath.loudest(alarm, rate: AlarmMath.rate))
  print(String(format: "    soft %.1f -> %.1f dB, alarm %.1f -> %.1f dB", rawSoft, a, rawAlarm, b))
  return abs(rawSoft + 18.7) < 0.2 && abs(rawAlarm + 19.6) < 0.2 && abs(a + 12) < 0.3 && abs(b + 12) < 0.3 && AlarmMath.peak(soft) <= 1 && AlarmMath.peak(alarm) <= 1
    && soft.count == Int(2.6 * 44100) && AlarmMath.wav(soft, rate: 44100).count == 44 + soft.count * 2
}
ok("V1.44 own sound checks: the first bytes decide, the size cap, the name") {
  func b(_ s: String) -> [UInt8] { Array(s.utf8) + [UInt8](repeating: 0, count: 16) }
  return AlarmMath.sniff(b("RIFF\0\0\0\0WAVE")) == "wav" && AlarmMath.sniff(b("FORM\0\0\0\0AIFF")) == "aiff" && AlarmMath.sniff(b("\0\0\0 ftypM4A ")) == "m4a"
    && AlarmMath.sniff(b("ID3")) == "mp3" && AlarmMath.sniff([0xff, 0xfb] + [UInt8](repeating: 0, count: 14)) == "mp3" && AlarmMath.sniff(b("%PDF-1.7")) == nil
    && AlarmMath.check(name: "YOU ARE BROKE.mp3", size: 100_000, head: b("ID3")) == nil
    && AlarmMath.check(name: "x.flac", size: 10, head: b("RIFF\0\0\0\0WAVE")) != nil
    && AlarmMath.check(name: "x.mp3", size: 21 * 1024 * 1024, head: b("ID3")) != nil
    && AlarmMath.check(name: "evil.mp3", size: 1000, head: b("%PDF-1.7")) != nil
    && AlarmMath.ownName("YOU_ARE_BROKE.mp3") == "YOU ARE BROKE" && AlarmMath.ownName(".mp3") == "Your sound"
}
ok("V1.44 alarm loudness: 10% to 100% in 5% steps, Loud always 100%, the plan carries it") {
  let p = SleepPlanN.parse(["since": 1_000_000, "rings": [], "styles": ["level": 0.42]])
  let q = SleepPlanN.parse(["since": 1_000_000, "rings": []])
  return AlarmMath.okLevel(nil) == 0.8 && AlarmMath.okLevel(0) == 0.1 && AlarmMath.okLevel(7) == 1 && AlarmMath.okLevel(0.63) == 0.65
    && AlarmMath.ringLevel(loud: true, level: 0.3) == 1 && AlarmMath.ringLevel(loud: false, level: 0.3) == 0.3
    && p?.level == 0.4 && q?.level == 0.8
}
ok("V1.44 own sound: a picked wav is read, trimmed, brought to the level and kept (a test copy's own folder)") {
  let snd = SleepSound.shared
  try? FileManager.default.removeItem(at: snd.dir)
  // A quiet 2 second tone with a second of silence before it, written as a wav file here.
  let rate = 8000.0
  let x = [Float](repeating: 0, count: 8000) + sine(300, 0.05, 2, rate: rate)
  let src = FileManager.default.temporaryDirectory.appendingPathComponent("ps-test-YOU_ARE_BROKE.wav")
  try? AlarmMath.wav(x, rate: 8000).write(to: src)
  var why: String?? = .none
  snd.importFile(src) { why = .some($0) }
  let until = Date().addingTimeInterval(10)
  while why == nil && Date() < until { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
  let own = snd.own()
  let kept = (try? Data(contentsOf: snd.ownFile)) ?? Data()
  // Back to samples: 16 bit after the 44 byte header.
  let back: [Float] = kept.count > 44 ? stride(from: 44, to: kept.count - 1, by: 2).map { Float(Int16(bitPattern: UInt16(kept[$0]) | UInt16(kept[$0 + 1]) << 8)) / 32767 } : []
  let level = AlarmMath.toDb(AlarmMath.loudest(back, rate: rate))
  let ringsIt = snd.ringData("soft") == kept
  try? FileManager.default.removeItem(at: src)
  _ = snd.handle("sleep:sound:remove", [:])
  return why == .some(nil) && own?.name == "ps-test-YOU ARE BROKE" && abs((own?.secs ?? 0) - 2) < 0.05 && abs(level + 12) < 0.3 && ringsIt
    && snd.own() == nil && snd.ringData("soft").count == 44 + Int(2.6 * 44100) * 2
}
ok("V1.44 own sound: a file that is not sound is refused with a plain sentence, nothing kept") {
  let snd = SleepSound.shared
  let src = FileManager.default.temporaryDirectory.appendingPathComponent("ps-test-notes.mp3")
  try? Data("%PDF-1.7 not a sound file at all".utf8).write(to: src)
  var why: String?? = .none
  snd.importFile(src) { why = .some($0) }
  let until = Date().addingTimeInterval(10)
  while why == nil && Date() < until { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
  try? FileManager.default.removeItem(at: src)
  return (why ?? nil)?.contains("does not look like a sound file") == true && snd.own() == nil
}
ok("V1.44 Test in a test copy: says it plays, never plays or touches the volume, Stop and the time limit end it") {
  let snd = SleepSound.shared
  var lines: [String] = []
  snd.deliver = { lines.append($0) }
  var vol: [String] = []
  snd.volumeSet = { v, m in vol.append("\(v) \(m)") }
  _ = snd.handle("sleep:test", ["style": "chime", "level": 0.5, "ms": 1000])
  let on = snd.testing
  _ = snd.handle("sleep:testStop", [:])
  let off = !snd.testing
  _ = snd.handle("sleep:test", ["style": "light", "level": 0.5])     // light only: nothing to test
  let light = !snd.testing
  _ = snd.handle("sleep:test", ["style": "loud", "level": 0.2, "ms": 1000])
  let until = Date().addingTimeInterval(3)
  while snd.testing && Date() < until { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
  return on && off && light && !snd.testing && vol.isEmpty && lines.contains { $0.contains("\"testing\":true") } && lines.last?.contains("\"testing\":false") == true
}

// V1.47 alarm playlists (Sources/AlarmList.swift; the page's rules are in web core/alarmlist.ts).
ok("V1.47 playlist rules: the day key, the ring length, the fade, the checks (the page's numbers)") {
  var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Asia/Dubai")!
  let ms = 1_794_340_800_000.0   // 2026-11-10T20:00:00Z, 00:00 on 11 Nov in the developer's city
  let head = Array("ID3".utf8) + [UInt8](repeating: 0, count: 13)
  return ListMath.day(ms, tz: TimeZone(identifier: "Asia/Dubai")!) == "2026-11-11" && ListMath.day(ms, tz: TimeZone(identifier: "UTC")!) == "2026-11-10"
    && ListMath.ringFor(end: "loop", secs: 3600) == 600_000 && ListMath.ringFor(end: "whole", secs: 60) == 600_000
    && ListMath.ringFor(end: "whole", secs: 1800) == 1_803_000 && ListMath.ringFor(end: "whole", secs: 5 * 3600) == 3 * 3600_000
    && ListMath.fadeAt(0, fade: 0) == 1 && ListMath.fadeAt(0, fade: 30) == 0.05 && abs(ListMath.fadeAt(15_000, fade: 30) - 0.525) < 1e-9 && ListMath.fadeAt(40_000, fade: 30) == 1
    && ListMath.check(name: "a.aac", size: 10, head: [0xff, 0xf1] + [UInt8](repeating: 0, count: 14)) == nil
    && ListMath.check(name: "Les Brown.mp3", size: 10, head: Array("%PDF-1.7 hello!!".utf8))?.hasPrefix("Les Brown does not look like a sound file") == true
    && ListMath.check(name: "a.txt", size: 10, head: head) != nil
    && ListMath.check(name: "big.mp3", size: 101 * 1024 * 1024, head: head)?.contains("over 100 MB") == true
    && ListMath.name("Les_Brown - It's Possible.m4a") == "Les Brown - It's Possible"
}
ok("V1.47 the plan's playlist is checked: odd ids dropped, the day's file found on this Mac's clock") {
  let today = ListMath.day(Date().timeIntervalSince1970 * 1000)
  let p = PlanListN.parse(["end": "whole", "fade": 30, "days": [today: ["id": "00000000000000aa", "name": "Talk", "secs": 600, "n": 1, "of": 3], "2001-01-01": ["id": "nothex"]]])
  let bad = PlanListN.parse(["end": "x", "fade": 7, "days": [:]])
  let plan = SleepPlanN.parse(["since": 1_000.0, "rings": [["id": "a", "at": 2_000.0, "label": "07:00", "sound": "style"], ["id": "b", "at": 3_000.0, "label": "07:30", "sound": "list"], ["id": "c", "at": 4_000.0, "label": "08:00", "sound": "odd"]],
                                "list": ["end": "loop", "days": [today: ["id": "00000000000000bb", "name": "B", "secs": 1]]]])
  return p?.end == "whole" && p?.fade == 30 && p?.days.count == 1 && p?.entry(Date().timeIntervalSince1970 * 1000)?.id == "00000000000000aa"
    && bad?.end == "loop" && bad?.fade == 0 && PlanListN.parse(nil) == nil
    && plan?.list?.entry(Date().timeIntervalSince1970 * 1000)?.name == "B" && SleepPlanN.parse(["since": 1_000.0, "rings": []])?.list == nil
    && plan?.rings.map(\.sound) == ["style", "list", ""]
}
ok("V1.47 adding files (a test copy folder): copied as they are, id from the SHA-256, a non sound file refused, removed") {
  let st = AlarmListStore.shared
  try? FileManager.default.removeItem(at: st.dir)
  var lines: [String] = []
  SleepSound.shared.deliver = { lines.append($0) }
  let tmp = FileManager.default.temporaryDirectory
  let wav = tmp.appendingPathComponent("ps-test-Les_Brown.wav"), pdf = tmp.appendingPathComponent("ps-test-notes.mp3")
  let x = (0..<8000).map { Float(0.3 * sin(2 * Double.pi * 440 * Double($0) / 8000)) }
  try? AlarmMath.wav(x, rate: 8000).write(to: wav)
  try? Data("%PDF-1.7 not a sound file at all".utf8).write(to: pdf)
  var got: ([[String: Any]], [String])?
  st.add([wav, pdf]) { got = ($0, $1) }
  let until = Date().addingTimeInterval(10)
  while got == nil && Date() < until { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
  let want = ListMath.id(of: wav) ?? "?"
  let shaOk = SHA256.hash(data: (try? Data(contentsOf: wav)) ?? Data()).prefix(8).map { String(format: "%02x", $0) }.joined() == want
  let t = got?.0.first
  let kept = st.listFile(want)
  let same = kept.flatMap { try? Data(contentsOf: $0) } == (try? Data(contentsOf: wav))
  let refused = got?.1.first?.contains("does not look like a sound file") == true
  _ = st.handle("sleep:list:remove", ["id": want])
  let until2 = Date().addingTimeInterval(5)
  while st.listFile(want) != nil && Date() < until2 { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
  try? FileManager.default.removeItem(at: wav); try? FileManager.default.removeItem(at: pdf)
  return shaOk && t?["id"] as? String == want && t?["name"] as? String == "ps-test-Les Brown" && (t?["secs"] as? Double ?? 0) >= 1
    && kept?.lastPathComponent == "\(want).wav" && same && refused && st.listFile(want) == nil && st.have().isEmpty
    && lines.contains { $0.contains("__psAlarmList") && $0.contains("\"added\"") }
}
ok("V1.47 pieces from the page: in order, under the caps, the SHA-256 checked, then read back") {
  let st = AlarmListStore.shared
  try? FileManager.default.removeItem(at: st.dir)
  var lines: [String] = []
  SleepSound.shared.deliver = { lines.append($0) }
  let x = (0..<20000).map { Float(0.3 * sin(2 * Double.pi * 440 * Double($0) / 8000)) }
  let wav = AlarmMath.wav(x, rate: 8000)
  let id = SHA256.hash(data: wav).prefix(8).map { String(format: "%02x", $0) }.joined()
  let a = wav.prefix(30000), b = wav.dropFirst(30000)
  _ = st.handle("sleep:list:put", ["id": id, "ext": "wav", "i": 0, "n": 2, "b64": Data(a).base64EncodedString()])
  _ = st.handle("sleep:list:put", ["id": id, "ext": "wav", "i": 1, "n": 2, "b64": Data(b).base64EncodedString()])
  // A file whose bytes do not match its id is refused.
  _ = st.handle("sleep:list:put", ["id": "00000000000000ff", "ext": "wav", "i": 0, "n": 1, "b64": Data(a).base64EncodedString()])
  _ = st.handle("sleep:list:read", ["id": id, "off": 0, "len": 1 << 20])
  let until = Date().addingTimeInterval(10)
  while !lines.contains(where: { $0.contains("chunk") }) && Date() < until { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
  let kept = st.listFile(id).flatMap { try? Data(contentsOf: $0) } == wav
  let chunk = lines.first { $0.contains("\"chunk\"") } ?? ""
  let ok = kept && lines.contains { $0.contains("\"saved\":\"\(id)\"") } && lines.contains { $0.contains("\"failed\":\"00000000000000ff\"") }
    && st.listFile("00000000000000ff") == nil && chunk.contains("\"size\":\(wav.count)") && chunk.contains(String(wav.base64EncodedString().prefix(40)))
    && !ListMath.pieceOk(id: id, ext: "wav", i: 2, n: 3, expect: 1, size: 10, got: 10) && !ListMath.pieceOk(id: "../../x", ext: "wav", i: 0, n: 1, expect: 0, size: 0, got: 1)
    && !ListMath.pieceOk(id: id, ext: "exe", i: 0, n: 1, expect: 0, size: 0, got: 1) && ListMath.sniff(Array("fLaC".utf8) + [UInt8](repeating: 0, count: 12))
  try? FileManager.default.removeItem(at: st.dir)
  return ok
}

// ---------- V1.47: a sound per alarm, custom sounds loop until Stop, alarms with Sleep mode off ----------
ok("each ring's own sound is checked; what it plays; custom loops ring until Stop") {
  var l = PlanListN(); l.days = ["2026-11-11": .init(id: "aaaaaaaaaaaaaaaa", name: "Talk", secs: 600, n: 1, of: 2)]; l.fade = 10
  let d = "2026-11-11"
  let a = SleepRules.ringPlay(sound: "", list: nil, day: d, haveOwn: false), b = SleepRules.ringPlay(sound: "", list: nil, day: d, haveOwn: true)
  let c = SleepRules.ringPlay(sound: "builtin", list: l, day: d, haveOwn: true), e = SleepRules.ringPlay(sound: "", list: l, day: d, haveOwn: false)
  let f = SleepRules.ringPlay(sound: "t:bbbbbbbbbbbbbbbb", list: nil, day: d, haveOwn: false)
  var off = l; off.on = false
  let g = SleepRules.ringPlay(sound: "", list: off, day: d, haveOwn: false), h = SleepRules.ringPlay(sound: "list", list: off, day: d, haveOwn: false)
  var whole = l; whole.end = "whole"
  let i = SleepRules.ringPlay(sound: "list", list: whole, day: d, haveOwn: false)
  return a.kind == "builtin" && a.len == SleepRules.ringFor && b.kind == "own" && b.len == .infinity
    && c.kind == "builtin" && e.kind == "track" && e.id == "aaaaaaaaaaaaaaaa" && e.loop && e.len == .infinity && e.fade == 10
    && f.kind == "track" && f.id == "bbbbbbbbbbbbbbbb" && f.len == .infinity
    && g.kind == "builtin" && h.kind == "track" && !i.loop && i.len.isFinite
    && SleepRules.okSound("own") && SleepRules.okSound("t:0123456789abcdef") && !SleepRules.okSound("t:zz") && !SleepRules.okSound("evil")
}
ok("alarms with Sleep mode off: the plan is marked, the next one (its sunrise first), never one already rung") {
  let p = SleepPlanN.parse(["since": 1000, "alarmOnly": true, "rings": [
    ["id": "a", "at": 9_000_000, "label": "07:30", "style": "sunrise", "from": 9_000_000 - 600_000, "sound": "own"],
    ["id": "b", "at": 9_600_000, "label": "07:40", "sound": "t:zz"]]] as [String: Any])!
  let k = SleepRules.key(p.rings[0])
  return p.alarmOnly && p.rings[0].sound == "own" && p.rings[1].sound == ""
    && SleepRules.nextAlarm(p, now: 1_000, fired: []) == 9_000_000 - 600_000
    && SleepRules.nextAlarm(p, now: 8_700_000, fired: []) == 9_000_000
    && SleepRules.nextAlarm(p, now: 8_700_000, fired: [k]) == 9_600_000
    && SleepRules.nextAlarm(p, now: 99_000_000, fired: []) == nil
    && SleepPlanN.parse(["since": 1000] as [String: Any])!.alarmOnly == false
}
ok("V1.52 the AI Sentry mode button's spot: left centre by default, only known spots, Hidden kept") {
  SleepPlanN.Look().sentry == "left" && SleepPlanN.Look.parse(["sentry": "bottomRight"]).sentry == "bottomRight"
    && SleepPlanN.Look.parse(["sentry": "hidden"]).sentry == "hidden" && SleepPlanN.Look.parse(["sentry": "middle"]).sentry == "left"
}
ok("V1.52 the plan's sentry part is kept for the button, never on an alarm with Sleep mode off") {
  let part: [String: Any] = ["plan": ["restartH": 8]]
  return SleepPlanN.parse(["since": 1000, "sentry": part] as [String: Any])?.sentry != nil
    && SleepPlanN.parse(["since": 1000, "sentry": part, "alarmOnly": true] as [String: Any])?.sentry == nil
    && SleepPlanN.parse(["since": 1000] as [String: Any])?.sentry == nil
}

// ---------- PS 1.65: the clock is centred on every screen and never touches the AI Sentry mode button ----------
_ = NSApplication.shared
/// The clock drawn the way the screen draws it (a centred label, the clock's own attributed string), and where its ink lies.
func clockInk(width W: Double, size: Double, sides: Double, time: String = "19:05", ampm: String? = nil, font: NSFont? = nil) -> (min: Double, max: Double, points: Double) {
  let pts = SleepRules.clockPoints(width: W, size: size, chars: time.count + (ampm == nil ? 0 : 2), sides: sides)
  let f = font ?? NSFont.monospacedDigitSystemFont(ofSize: CGFloat(pts), weight: .light)
  let l = NSTextField(labelWithString: "")
  l.alignment = .center; l.isSelectable = false; l.drawsBackground = false; l.isBordered = false; l.lineBreakMode = .byTruncatingTail
  l.frame = NSRect(x: 0, y: 0, width: W, height: pts * 1.25)
  l.attributedStringValue = SleepRules.clockString(time: time, ampm: ampm, font: f, ink: .white, kern: 0)
  let v = NSView(frame: l.frame); v.addSubview(l)
  let r = v.bitmapImageRepForCachingDisplay(in: v.bounds)!; v.cacheDisplay(in: v.bounds, to: r)
  var lo = Int.max, hi = -1
  for x in 0..<r.pixelsWide { for y in 0..<r.pixelsHigh where (r.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.3 { lo = min(lo, x); hi = max(hi, x) } }
  let k = Double(r.pixelsWide) / W
  return (Double(lo) / k, Double(hi) / k, pts)
}
for (W, name) in [(1710.0, "15 inch MacBook Air"), (1440.0, "13 inch"), (1512.0, "14 inch Pro"), (2560.0, "external"), (1280.0, "small")] {
  for size in [50.0, 100.0, 200.0, 300.0] {
    ok("\(name) \(Int(W)) wide, clock \(Int(size))%: centred, inside the screen, clear of the button's room") {
      let c = clockInk(width: W, size: size, sides: SleepRules.sentrySide)
      let mid = (c.min + c.max) / 2
      print("   ink \(Int(c.min))...\(Int(c.max)) at \(Int(c.points)) pt, middle \(Int(mid)) of \(Int(W / 2))")
      return abs(mid - W / 2) <= max(8, c.points * 0.06) && c.min >= SleepRules.sentrySide - 8 && c.max <= W - SleepRules.sentrySide + 8
    }
  }
}
ok("the old string (no paragraph style) really sat at the left, so the fix is the style") {
  let f = NSFont.monospacedDigitSystemFont(ofSize: 240, weight: .light)
  let l = NSTextField(labelWithString: ""); l.alignment = .center; l.isBordered = false; l.drawsBackground = false
  l.frame = NSRect(x: 0, y: 0, width: 1710, height: 300)
  l.attributedStringValue = NSAttributedString(string: "19:05", attributes: [.font: f, .foregroundColor: NSColor.white])
  let v = NSView(frame: l.frame); v.addSubview(l)
  let r = v.bitmapImageRepForCachingDisplay(in: v.bounds)!; v.cacheDisplay(in: v.bounds, to: r)
  var hi = -1
  for x in 0..<r.pixelsWide { for y in 0..<r.pixelsHigh where (r.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.3 { hi = max(hi, x) } }
  return Double(hi) / (Double(r.pixelsWide) / 1710) < 1000
}
ok("with AM or PM the clock is still centred as a whole") {
  let c = clockInk(width: 1710, size: 100, sides: SleepRules.sentrySide, time: "7:05", ampm: "PM")
  return abs((c.min + c.max) / 2 - 855) <= 40
}
ok("the button's room: kept on both sides, nothing with no button, the clock shrinks only when it would touch") {
  let W = 1710.0
  let with = SleepRules.clockPoints(width: W, size: 300, chars: 5, sides: SleepRules.sentrySide)
  let without = SleepRules.clockPoints(width: W, size: 300, chars: 5)
  return with < without && with * 5 * 0.6 <= W - 2 * SleepRules.sentrySide + 0.01
    && SleepRules.clockPoints(width: W, size: 100, chars: 5, sides: SleepRules.sentrySide) == SleepRules.clockPoints(width: W, size: 100, chars: 5)
}
ok("the analogue face keeps the room too") {
  let W = 1710.0, H = 1112.0
  return SleepRules.dialPoints(width: W, height: H, size: 300, sides: SleepRules.sentrySide) <= W - 2 * SleepRules.sentrySide
    && SleepRules.dialPoints(width: W, height: H, size: 100) == SleepRules.dialPoints(width: W, height: H, size: 100, sides: SleepRules.sentrySide)
}
print("\n\(n) passed")
