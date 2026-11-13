// The build as shipped (V1.28: RebootEngine.activeAllowed true): Active restarts once the Mac has been
// locked for the whole timer, Watch only never restarts. (V1.23 to V1.27 shipped Active as Watch only.)
// This test Mac never really goes down, so Active makes its 3 tries (3 min apart) and then gives up.
import Foundation
func run(_ mode: RebootMode) -> (restarts: [Double], woulds: Int) {
  var a: [RebootAction] = []
  let e = RebootEngine(config: RebootConfig(mode: mode, minutes: 60), loaded: nil, boot: "b", now: 4000, wall: 1_793_000_000, log: &a)
  _ = e.step(.start, session: .unlocked, now: 4000, wall: 1_793_000_000)
  var restarts: [Double] = [], woulds = 0
  var t = 4002.0
  while t < 4000 + 10 * 3600 {
    for x in e.step(.tick, session: .locked, now: t, wall: 1_793_000_000 + t - 4000) {
      if case .restart = x { restarts.append(t) }
      if case .record(let h) = x, h.kind == "would" { woulds += 1 }
    }
    t += 30
  }
  return (restarts, woulds)
}
let active = run(.active), watch = run(.watch)
let first = active.restarts.first.map { $0 - 4000 } ?? -1
let ok = RebootEngine.activeAllowed && active.restarts.count == 3 && first >= 3600 && first <= 3600 + 31 && active.woulds == 0
  && watch.restarts.isEmpty && watch.woulds == 1
print(ok ? "SHIPPED BUILD: Active restarts after 1 h locked (3 tries on this test Mac), Watch only never does (1 would have)"
         : "SHIPPED BUILD: FAIL allowed=\(RebootEngine.activeAllowed) active=\(active) first=\(first) watch=\(watch)")
exit(ok ? 0 : 1)
