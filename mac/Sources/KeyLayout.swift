// What the slash chord's two physical keys type on the developer's current keyboard layout (the developer, 20 Oct 2026).
// The chord always uses the physical keys (ANSI 44 and 47: "/" and "." on US and British layouts);
// this reads the layout so PS > Settings can say which characters those keys are, and the log
// notes it if a layout puts something else there. Read on the main thread only.
import Carbon

enum KeyLayout {
  /// (character on key 44, character on key 47, layout name), eg ("/", ".", "British").
  static func slashKeys() -> (slash: String, dot: String, name: String) {
    guard let src = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
          let ptr = TISGetInputSourceProperty(src, kTISPropertyUnicodeKeyLayoutData) else { return ("?", "?", "unknown") }
    let data = Unmanaged<CFData>.fromOpaque(ptr).takeUnretainedValue() as Data
    let name = TISGetInputSourceProperty(src, kTISPropertyLocalizedName).map { Unmanaged<CFString>.fromOpaque($0).takeUnretainedValue() as String } ?? "unknown"
    func char(_ code: Int64) -> String {
      data.withUnsafeBytes { raw -> String in
        guard let layout = raw.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return "?" }
        var dead: UInt32 = 0, len = 0
        var chars = [UniChar](repeating: 0, count: 4)
        let st = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDown), 0, UInt32(LMGetKbdType()),
                                OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, 4, &len, &chars)
        return st == noErr && len > 0 ? String(utf16CodeUnits: chars, count: len) : "?"
      }
    }
    return (char(SLASH_KEY), char(DOT_KEY), name)
  }
  /// What one physical key types on the layout in use (V1.47 Tab overlay shortcuts), or its fixed name (Tab, F13,
  /// Right Option). Letters come back in capitals, as printed on the key.
  static func label(_ code: Int) -> String {
    if let n = OpenKeysCore.fixedName(code) { return n }
    let c = labels([code])[code] ?? "?"
    return c
  }
  /// Labels for many keys at once (one layout read). Keys that type nothing printable get their fixed name or "Key N".
  static func labels(_ codes: [Int]) -> [Int: String] {
    var out: [Int: String] = [:]
    guard let src = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
          let ptr = TISGetInputSourceProperty(src, kTISPropertyUnicodeKeyLayoutData) else {
      for c in codes { out[c] = OpenKeysCore.fixedName(c) ?? "Key \(c)" }
      return out
    }
    let data = Unmanaged<CFData>.fromOpaque(ptr).takeUnretainedValue() as Data
    data.withUnsafeBytes { raw in
      guard let layout = raw.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return }
      for code in codes {
        if let n = OpenKeysCore.fixedName(code) { out[code] = n; continue }
        var dead: UInt32 = 0, len = 0
        var chars = [UniChar](repeating: 0, count: 4)
        let st = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDisplay), 0, UInt32(LMGetKbdType()),
                                OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, 4, &len, &chars)
        let s = st == noErr && len > 0 ? String(utf16CodeUnits: chars, count: len).trimmingCharacters(in: .whitespacesAndNewlines.union(.controlCharacters)) : ""
        out[code] = s.isEmpty ? "Key \(code)" : s.uppercased()
      }
    }
    return out
  }
  /// The layout's name, eg "British" or "Russian".
  static func layoutName() -> String {
    guard let src = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue() else { return "unknown" }
    return TISGetInputSourceProperty(src, kTISPropertyLocalizedName).map { Unmanaged<CFString>.fromOpaque($0).takeUnretainedValue() as String } ?? "unknown"
  }
  /// Called on main whenever the layout changes (the Settings tab's labels follow it).
  static var onChange: (() -> Void)?

  /// Logs the keys now and whenever the developer switches keyboard layout.
  static func watch() {
    let log = {
      let k = slashKeys()
      psLog("PS slash chord: on \(k.name) the chord keys type \"\(k.slash)\" and \"\(k.dot)\"" + (k.slash == "/" && k.dot == "." ? "" : " (not / and ., the chord stays on those same physical keys)"))
    }
    log()
    DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name(kTISNotifySelectedKeyboardInputSourceChanged as String), object: nil, queue: .main) { _ in log(); onChange?() }
  }
}
