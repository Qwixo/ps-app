// Run: bash tests/headphones-test.sh
import CoreAudio
import Foundation

var n = 0, bad = 0
func check(_ name: String, _ ok: Bool) { n += 1; if ok { print("ok -", name) } else { bad += 1; print("FAIL -", name) } }
func wait(_ t: Double) { Thread.sleep(forTimeInterval: t) }

let BT = kAudioDeviceTransportTypeBluetooth, BUILT = kAudioDeviceTransportTypeBuiltIn, USB = kAudioDeviceTransportTypeUSB
let speakers = HPDev(uid: "BuiltInSpeakerDevice", name: "MacBook Air Speakers", alive: true, transport: BUILT)
let jack = HPDev(uid: "BuiltInHeadphoneOutputDevice", name: "External Headphones", alive: true, transport: BUILT)
let pods = HPDev(uid: "A0-B1:output", name: "Sam’s AirPods Max", alive: true, transport: BT)
let sony = HPDev(uid: "C0-D1:output", name: "WH-1000XM5", alive: true, transport: BT)
let monitor = HPDev(uid: "usb-monitor", name: "Studio Display Speakers", alive: true, transport: USB)
let builtMic = HPDev(uid: "BuiltInMicrophoneDevice", name: "MacBook Air Microphone", alive: true, transport: BUILT)
let usbMic = HPDev(uid: "usbMic", name: "USB Mic", alive: true, transport: USB)
let podsMic = HPDev(uid: "A0-B1:input", name: "Sam’s AirPods Max", alive: true, transport: BT)
let ref = { (d: HPDev) in HPRef(uid: d.uid, name: d.name) }

// ---------- the pure part ----------
var p = HPPrefs()
check("speakers with an empty list: the built in speakers, never the headphone jack",
      HPLogic.target(.speakers, p, outs: [jack, pods, speakers], ins: []).out == speakers)
check("headphones with an empty list: the first headphones connected",
      HPLogic.target(.headphones, p, outs: [speakers, monitor, pods], ins: []).out == pods)
check("the headphone jack counts as headphones", HPLogic.target(.headphones, p, outs: [speakers, jack], ins: []).out == jack)
check("headphones with none connected: nothing to switch to", HPLogic.target(.headphones, p, outs: [speakers, monitor], ins: []).out == nil)
check("an empty microphone list leaves the microphone alone", HPLogic.target(.headphones, p, outs: [pods], ins: [usbMic, podsMic]).mic == nil)
p.hpOut = [ref(sony), ref(pods)]; p.hpMic = [ref(usbMic), ref(builtMic)]; p.spkOut = [ref(monitor)]
check("fallback order: first choice when connected", HPLogic.target(.headphones, p, outs: [speakers, pods, sony], ins: []).out == sony)
check("fallback order: the second when the first is missing", HPLogic.target(.headphones, p, outs: [speakers, pods], ins: []).out == pods)
let sonyAsleep = HPDev(uid: sony.uid, name: sony.name, alive: false, transport: BT)
check("a listed device that is asleep is skipped", HPLogic.target(.headphones, p, outs: [sonyAsleep, pods], ins: []).out == pods)
check("microphone fallback order", HPLogic.target(.headphones, p, outs: [pods], ins: [builtMic, podsMic]).mic == builtMic)
let podsOtherMac = HPDev(uid: "other-uid", name: "Sam’s AirPods Max", alive: true, transport: BT)
check("matched by name when the id differs (another Mac)", HPLogic.target(.headphones, p, outs: [podsOtherMac], ins: []).out == podsOtherMac)
check("speakers list missing: falls back to the built in speakers", HPLogic.target(.speakers, p, outs: [speakers, pods], ins: []).out == speakers)
check("a listed device not in the Headphones list is not headphones", !HPLogic.isHeadphones(jack, p))
p.auto = true
check("auto: listed headphones connect, go to Headphones", HPLogic.autoStep(p, mode: .speakers, before: [], now: [speakers, pods]) == .headphones)
check("auto: unlisted headphones connect, nothing", HPLogic.autoStep(p, mode: .speakers, before: [], now: [speakers, jack]) == nil)
check("auto: the last headphones go, back to Speakers", HPLogic.autoStep(p, mode: .headphones, before: [pods.uid], now: [speakers]) == .speakers)
check("auto: in Speakers already, a disconnect does nothing", HPLogic.autoStep(p, mode: .speakers, before: [pods.uid], now: [speakers]) == nil)
check("auto: one of two headphones goes, stays", HPLogic.autoStep(p, mode: .headphones, before: [pods.uid, sony.uid], now: [speakers, sony]) == nil)
p.auto = false
check("auto off: nothing ever", HPLogic.autoStep(p, mode: .speakers, before: [], now: [pods]) == nil)
let j = HPPrefs.from(["auto": true, "hpOut": [["uid": "a", "name": "A"], ["uid": "", "name": "x"], ["name": "no uid"], ["uid": String(repeating: "z", count: 300)]],
                      "spkMic": (0..<20).map { ["uid": "m\($0)", "name": "M"] }, "junk": 1])
check("prefs from the page: bad entries dropped, 8 at most", j.auto && j.hpOut == [HPRef(uid: "a", name: "A")] && j.spkMic.count == 8)

// ---------- the switch on fake devices ----------
let hm = HeadphonesMode.shared, f = FakeHP()
var cards: [String] = []
let cl = NSLock()
hm.announce = { m, ok in cl.lock(); cards.append("\(m.rawValue)\(ok ? "" : "!")"); cl.unlock() }
hm.settle = 0.1; hm.verifyDelays = [0.05, 0.1, 0.15]; hm.micGuard = 1
var pushed = ""
hm.deliver = { pushed = $0 }
f.outs = [speakers]; f.ins = [builtMic, usbMic]; f.out = speakers.uid; f.mic = usbMic.uid
hm.start(testDir: "/tmp/hp-test", backend: f); hm.syncForTest()
func pump(_ t: Double = 0.5) { let end = Date().addingTimeInterval(t); while Date() < end { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) } }
func prefs(_ q: HPPrefs) {
  func l(_ r: [HPRef]) -> [[String: Any]] { r.map { ["uid": $0.uid, "name": $0.name] } }
  hm.handle(["op": "prefs", "prefs": ["auto": q.auto, "spkOut": l(q.spkOut), "spkMic": l(q.spkMic), "hpOut": l(q.hpOut), "hpMic": l(q.hpMic)]]); hm.syncForTest()
}
pump(0.2)
check("the state reaches the page", pushed.contains("\"type\":\"hpmode\"") && pushed.contains("MacBook Air Speakers"))
hm.handle(["op": "mode", "mode": "headphones"]); hm.syncForTest(); pump(0.3)
check("Headphones with none connected: says so, the sound stays", f.out == speakers.uid && hm.modeNow == .speakers && hm.noteNow.contains("No headphones"))
// 1Password and Signal devices are never listed (the real backend drops them; the logic never needs them).
check("the stand in drops 1Password and Signal names", Protected.matches("Signal audio") && Protected.matches("1Password"))

var q2 = HPPrefs(); q2.hpMic = [ref(podsMic)]; q2.spkMic = [ref(usbMic)]
prefs(q2)
f.outs = [speakers, pods]; f.ins = [builtMic, usbMic, podsMic]; f.changed(); hm.syncForTest(); pump(0.4)
check("auto off by default: a connect does not switch", f.out == speakers.uid && cards.isEmpty)
hm.handle(["op": "mode", "mode": "headphones"]); hm.syncForTest(); pump(0.4)
check("the switch: output and microphone move to the headphones", f.out == pods.uid && f.mic == podsMic.uid && hm.modeNow == .headphones)
check("the microphone it set is told to AutoRoute first", AutoRoute.shared.owned.last == podsMic.uid)
check("a manual switch shows no card", cards.isEmpty)
hm.handle(["op": "mode", "mode": "speakers"]); hm.syncForTest(); pump(0.4)
check("back to Speakers: built in speakers and the USB mic", f.out == speakers.uid && f.mic == usbMic.uid && hm.modeNow == .speakers)

// Auto on: connect and disconnect.
q2.auto = true; prefs(q2)
f.outs = [speakers]; f.ins = [builtMic, usbMic]; f.changed(); hm.syncForTest(); pump(0.3)
f.outs = [speakers, pods]; f.ins = [builtMic, usbMic, podsMic]; f.changed(); hm.syncForTest(); pump(0.6)
check("auto on: headphones connect, Headphones mode", f.out == pods.uid && f.mic == podsMic.uid && hm.modeNow == .headphones && cards == ["headphones"])
// The person picks the speakers by hand: never fought.
_ = f.setOutput(speakers.uid); hm.syncForTest(); pump(0.4)
check("a hand pick afterwards is never fought", f.out == speakers.uid && cards.count == 1)
f.outs = [speakers]; f.ins = [builtMic, usbMic]; f.out = speakers.uid; f.mic = builtMic.uid; f.changed(); hm.syncForTest(); pump(0.6)
check("auto on: the last headphones go, back to Speakers", f.mic == usbMic.uid && hm.modeNow == .speakers && cards == ["headphones", "speakers"])

// macOS does not take the switch at first (a fresh Bluetooth device): retried, the card only once it took.
f.ignoreSets = 2
f.outs = [speakers, pods]; f.ins = [builtMic, usbMic, podsMic]; f.changed(); hm.syncForTest(); pump(0.9)
check("retried until macOS takes it", f.out == pods.uid && cards.count == 3 && cards.last == "headphones")
f.outs = [speakers]; f.ins = [builtMic, usbMic]; f.out = speakers.uid; f.mic = usbMic.uid; f.changed(); hm.syncForTest(); pump(0.6)
f.ignoreSets = 99
f.outs = [speakers, pods]; f.ins = [builtMic, usbMic, podsMic]; f.changed(); hm.syncForTest(); pump(1.0)
check("never taken: an honest card, the note says so", f.out == speakers.uid && cards.last == "headphones!" && hm.noteNow.contains("macOS kept"))
f.ignoreSets = 0

// macOS moving the microphone onto the headphones right after a switch is put back once.
f.outs = [speakers]; f.ins = [builtMic, usbMic]; f.out = speakers.uid; f.mic = usbMic.uid; f.changed(); hm.syncForTest(); pump(0.5)
var q3 = q2; q3.hpMic = [ref(usbMic)]; prefs(q3)
f.outs = [speakers, pods]; f.ins = [builtMic, usbMic, podsMic]; f.changed(); hm.syncForTest(); pump(0.6)
f.mic = podsMic.uid; f.changed(); hm.syncForTest(); pump(0.2)
let putBack = f.mic == usbMic.uid
f.mic = podsMic.uid; f.changed(); hm.syncForTest(); pump(0.2)
check("macOS's own mic move is put back once, then left", putBack && f.mic == podsMic.uid)

// The claim AutoRoute asks for.
check("claims: auto on, listed AirPods, with the mic list set", hm.claims(uid: pods.uid, name: pods.name) == (true, true))
var q4 = q3; q4.hpMic = []; prefs(q4)
check("claims: no Headphones mic list, AutoRoute keeps its mic fix", hm.claims(uid: pods.uid, name: pods.name) == (true, false))
q4.auto = false; prefs(q4)
check("claims: auto off, AutoRoute does everything as before", hm.claims(uid: pods.uid, name: pods.name) == (false, false))

print(bad == 0 ? "HEADPHONES TEST: \(n) of \(n) ok" : "HEADPHONES TEST: \(bad) FAIL of \(n)")
exit(bad == 0 ? 0 : 1)
