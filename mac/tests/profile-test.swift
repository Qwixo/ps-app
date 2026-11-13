// Offline test for Sources/Profile.swift and Sources/Features.swift (V1.58, multiple developers): the profile file, the
// 1Password and Signal rule join (fails closed on the developer's account), the registry and Features.on's answers.
// No app, no self test: tests/profile-test.sh compiles these two files with this one.
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }
func psLog(_ s: String) {}
func json(_ s: String) -> Any { try! JSONSerialization.jsonObject(with: s.data(using: .utf8)!) }

let gsquadJSON = CommandLine.arguments.count > 1 ? try! String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8) : ""
let gsquad = Profile.from(json(gsquadJSON))
let red = Profile.from(json(#"{"schema":1,"name":"red","display":"Owner","channel":{"kind":"url","url":"https://example.com/x/ps-update.json"},"othersShared":"off","features":{},"rules":{"tabOverProtectedApps":false,"islandOverProtectedApps":false}}"#))

// MARK: the profile file
check("gsquad-file-reads", gsquad != nil && gsquad?.name == "gsquad" && gsquad?.channel == .gsquad && gsquad?.othersShared == true)
check("gsquad-rules-on", gsquad?.rule("tabOverProtectedApps") == true && gsquad?.rule("islandOverProtectedApps") == true)
check("red-reads", red?.name == "red" && red?.othersShared == false && red?.channel == .url("https://example.com/x/ps-update.json"))
check("red-rules-off", red?.rule("tabOverProtectedApps") == false && red?.rule("islandOverProtectedApps") == false)
check("unknown-rule-nil", gsquad?.rule("somethingElse") == nil)
check("bad-schema", Profile.from(json(#"{"schema":2,"name":"red","channel":{"kind":"local"},"othersShared":"off"}"#)) == nil)
check("bad-name", Profile.from(json(#"{"schema":1,"name":"The developer!","channel":{"kind":"local"},"othersShared":"off"}"#)) == nil)
check("bad-channel", Profile.from(json(#"{"schema":1,"name":"jan","channel":{"kind":"url","url":"http://x"},"othersShared":"off"}"#)) == nil)
check("bad-others", Profile.from(json(#"{"schema":1,"name":"jan","channel":{"kind":"local"},"othersShared":"yes"}"#)) == nil)
check("number-is-not-a-bool", Profile.from(json(#"{"schema":1,"name":"jan","channel":{"kind":"local"},"othersShared":"off","rules":{"tabOverProtectedApps":1},"features":{"x-y":0}}"#)).map { $0.rules.isEmpty && $0.features.isEmpty } == true)
check("display-falls-back", Profile.from(json(#"{"schema":1,"name":"jan","channel":{"kind":"local"},"othersShared":"off"}"#))?.display == "jan")
check("no-file-nil", Profile.load(URL(fileURLWithPath: "/nonexistent/profile.json")) == nil)
check("ids", Profile.isFeatureId("island-menu-strip") && !Profile.isFeatureId("Island") && !Profile.isFeatureId("a--b") && !Profile.isFeatureId("-a") && !Profile.isFeatureId("a-"))

// MARK: the 1Password and Signal rule join (both must allow it)
for (acct, label) in [(true, "public-account"), (false, "red-account")] {
  check("no-profile-is-per-account-\(label)", Profile.allows("tabOverProtectedApps", account: acct, profile: nil) == acct)
  check("gsquad-profile-\(label)", Profile.allows("tabOverProtectedApps", account: acct, profile: gsquad) == acct)
  check("red-profile-\(label)", Profile.allows("islandOverProtectedApps", account: acct, profile: red) == false)
}
check("fails-closed-gsquad-profile-on-red-account", !Profile.allows("tabOverProtectedApps", account: false, profile: gsquad))

// MARK: the registry
let reg = Features.registry(from: json(#"""
[{"schema":1,"features":[
  {"id":"campaigns","name":"x","owner":"core","scope":"shared","since":"1.55","parts":["web"],"default":"off"},
  {"id":"island-menu-strip","name":"x","owner":"red","scope":"shared","since":"1.58","parts":["mac"],"default":"on"},
  {"id":"jan-thing","name":"x","owner":"jan","scope":"shared","since":"1.59","parts":["mac"],"default":"on"},
  {"id":"jan-off","name":"x","owner":"jan","scope":"shared","since":"1.59","parts":["mac"],"default":"off"},
  {"id":"Bad","name":"x","owner":"jan","scope":"shared","since":"1.59","parts":["mac"],"default":"on"},
  {"id":"jan-thing","name":"again","owner":"red","scope":"shared","since":"1.59","parts":["mac"],"default":"off"}]},
 {"schema":1,"features":[{"id":"second-computer","name":"x","owner":"red","scope":"private","since":"1.57","parts":["mac"],"default":"on"}]},
 {"schema":9,"features":[{"id":"future","name":"x","owner":"red","scope":"shared","since":"1.60","parts":["mac"],"default":"on"}]}]
"""#))
check("registry-reads", reg.map(\.id) == ["campaigns", "island-menu-strip", "jan-thing", "jan-off", "second-computer"], "\(reg.map(\.id))")
check("registry-first-wins", reg.first { $0.id == "jan-thing" }?.owner == "jan")
check("registry-empty", Features.registry(from: nil).isEmpty && Features.registry(from: "nonsense").isEmpty)

// MARK: Features.on before the page says anything
func b(_ id: String, _ p: Profile?) -> Bool { Features.bundled(id, registry: reg, profile: p) }
check("core-default", !b("campaigns", gsquad) && !b("campaigns", red) && !b("campaigns", nil))
check("own-feature-on", b("island-menu-strip", red))
check("others-on-in-gsquad", b("island-menu-strip", gsquad) && b("jan-thing", gsquad))
check("others-default-off-stays-off-in-gsquad", !b("jan-off", gsquad))
check("others-off-for-red", !b("jan-thing", red))
check("no-profile-others-off", !b("jan-thing", nil) && !b("island-menu-strip", nil))
check("private-of-own", b("second-computer", red) && !b("second-computer", gsquad))
check("unknown-id-off", !b("nobody-knows", gsquad))
let redOn = Profile(name: "red", display: "Owner", channel: .local, othersShared: false, features: ["jan-thing": true], rules: [:])
check("profile-override", b("jan-thing", redOn))

// MARK: the page's answers win
check("told-wins", Features.decide("jan-thing", told: ["jan-thing": true], registry: reg, profile: red))
check("told-off-wins", !Features.decide("island-menu-strip", told: ["island-menu-strip": false], registry: reg, profile: red))
check("told-other-id-falls-back", Features.decide("island-menu-strip", told: ["jan-thing": true], registry: reg, profile: red))
check("clean", Features.clean(json(#"{"a-b":true,"Bad":true,"c":1,"d":false}"#)) == ["a-b": true, "d": false])
check("clean-not-a-dict", Features.clean(json(#"[1]"#)) == nil)
check("handle-other-type", !Features.handle("looks", [:]))

// BuildRules.fromProfile (protected-158's place, fed from the profile)
let pub = BuildRules.rules(red: false), redAcct = BuildRules.rules(red: true)
check("buildrules-no-profile-public", BuildRules.fromProfile(pub, profile: nil) == pub)
check("buildrules-no-profile-red", BuildRules.fromProfile(redAcct, profile: nil) == redAcct)
check("buildrules-gsquad-public-on", BuildRules.fromProfile(pub, profile: gsquad) == BuildRules.Rules(tabOverProtected: true, islandOverProtected: true))
check("buildrules-gsquad-on-red-account-off", BuildRules.fromProfile(redAcct, profile: gsquad) == BuildRules.Rules(tabOverProtected: false, islandOverProtected: false))
check("buildrules-red-profile-off", BuildRules.fromProfile(pub, profile: red) == BuildRules.Rules(tabOverProtected: false, islandOverProtected: false))

print("\(count - fails)/\(count) ok")
exit(fails == 0 ? 0 : 1)
