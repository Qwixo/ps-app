import Foundation

// This build's profile (V1.58, multiple developers; design: ps-handover-notes/v158-multidev-design.md section 2).
// One small settings file per build, bundled by build.sh as PS.app/Contents/Resources/profile.json: core's
// profiles/gsquad.json for the G Squad build, a person's own profile.json in their layer (the developer's: web
// ps-layer/profile.json). It says whose build this is (name), which updates it follows (channel), whether other people's
// shared features start on (othersShared), per build feature overrides (features) and the rules that differ per person.
//
// No file (every build made the V1.57 way, a self test copy): `current` is nil and every rule keeps its per account
// answer (protected-158's BuildRules) exactly as in V1.57. Never a gsquad default.
// Plain values only, so tests/profile-test.swift checks it without the app.
struct Profile: Equatable {
  enum Channel: Equatable { case gsquad, local, url(String) }

  /// The rules that differ per person (the same names as the web's core/profile.ts RULES).
  static let ruleNames = ["tabOverProtectedApps", "islandOverProtectedApps"]

  /// "gsquad" for the shared build, else the person's private release name ("red", "jan").
  let name: String
  let display: String
  let channel: Channel
  /// Shared features made by OTHER people start on ("on" in gsquad, "off" in every person's own profile).
  let othersShared: Bool
  /// Overrides of the registry default for this build, by feature id.
  let features: [String: Bool]
  let rules: [String: Bool]

  /// What the profile says about a rule, or nil when it does not say.
  func rule(_ r: String) -> Bool? { rules[r] }

  static func isName(_ s: String) -> Bool {
    guard let f = s.unicodeScalars.first, s.unicodeScalars.count <= 32, ("a"..."z").contains(Character(f)) else { return false }
    return s.unicodeScalars.allSatisfy { ("a"..."z").contains(Character($0)) || ("0"..."9").contains(Character($0)) }
  }
  static func isFeatureId(_ s: String) -> Bool {
    guard !s.isEmpty, s.count <= 48, !s.hasPrefix("-"), !s.hasSuffix("-"), !s.contains("--"),
          let f = s.unicodeScalars.first, ("a"..."z").contains(Character(f)) else { return false }
    return s.unicodeScalars.allSatisfy { ("a"..."z").contains(Character($0)) || ("0"..."9").contains(Character($0)) || $0 == "-" }
  }

  /// A profile from its JSON object, or nil when it is not one (a wrong file never half applies).
  static func from(_ any: Any?) -> Profile? {
    guard let p = any as? [String: Any], (p["schema"] as? Int) == 1,
          let name = p["name"] as? String, isName(name),
          let ch = p["channel"] as? [String: Any], let kind = ch["kind"] as? String,
          let others = p["othersShared"] as? String, others == "on" || others == "off" else { return nil }
    let channel: Channel
    switch kind {
    case "gsquad": channel = .gsquad
    case "local": channel = .local
    case "url":
      guard let u = ch["url"] as? String, u.hasPrefix("https://"), !u.contains(" "), u.count > 8 else { return nil }
      channel = .url(u)
    default: return nil
    }
    var features: [String: Bool] = [:]
    for (k, v) in (p["features"] as? [String: Any]) ?? [:] where isFeatureId(k) { if let b = v as? Bool, isBool(v) { features[k] = b } }
    var rules: [String: Bool] = [:]
    let r = (p["rules"] as? [String: Any]) ?? [:]
    for k in ruleNames { if let v = r[k], isBool(v), let b = v as? Bool { rules[k] = b } }
    let d = ((p["display"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
    return Profile(name: name, display: d.isEmpty ? name : String(d.prefix(60)), channel: channel,
                   othersShared: others == "on", features: features, rules: rules)
  }
  /// JSONSerialization gives numbers and booleans as NSNumber: only a real true or false counts.
  static func isBool(_ v: Any) -> Bool {
    guard let n = v as? NSNumber else { return false }
    return CFGetTypeID(n) == CFBooleanGetTypeID()
  }

  static func load(_ url: URL?) -> Profile? {
    guard let url, let data = try? Data(contentsOf: url), let any = try? JSONSerialization.jsonObject(with: data) else { return nil }
    return from(any)
  }

  /// This app's bundled profile, nil when it has none. Read once.
  static let current: Profile? = load(Bundle.main.url(forResource: "profile", withExtension: "json"))

  /// A rule's answer for this build: the per account answer (BuildRules, protected-158) unless the profile narrows it.
  /// Both must allow it, so a wrong profile on the developer's account can never open PS over 1Password or Signal (fails closed),
  /// and with no profile the answer is exactly the per account one, as in V1.57.
  static func allows(_ rule: String, account: Bool, profile: Profile? = current) -> Bool {
    guard let v = profile?.rule(rule) else { return account }
    return v && account
  }
}

// protected-158's one place for the per account rules (BuildRules.swift, not edited here). The design called this
// call ProtectedRules.fromProfile; protected-158 named its place BuildRules, so it lives on BuildRules.
extension BuildRules {
  /// The per account rules narrowed by this build's profile: each rule is on only when both allow it.
  /// No profile (every build made the V1.57 way): exactly the per account rules.
  static func fromProfile(_ account: Rules, profile: Profile? = Profile.current) -> Rules {
    Rules(tabOverProtected: Profile.allows("tabOverProtectedApps", account: account.tabOverProtected, profile: profile),
          islandOverProtected: Profile.allows("islandOverProtectedApps", account: account.islandOverProtected, profile: profile))
  }
}
