// The token guide's rules (V1.49, the developer, 12 Nov 2026: everyone finds connecting Supabase complicated and does not
// understand which access token to give PS app). Pure Foundation and CoreGraphics, so tests/setup-guide-test.swift
// builds it on its own. SetupGuide.swift is the part on screen.
//
// What lives here:
//  - what a Supabase access token looks like (sbp_ then letters, digits and underscores; scoped ones start sbp_fc);
//  - the steps of the guide, their words, and where on the browser window each arrow points;
//  - the clipboard rules: PS app looks at the clipboard ONLY while the guide is on its last step (Copy), skips
//    anything copied while 1Password or Signal was in front, skips anything marked concealed or transient (what
//    password managers mark their copies with), and keeps nothing but a match;
//  - where the step card docks beside the browser window (the window's frame only, never what is in it).
// Coordinates here are top left based (like CGWindowList), y grows downwards. SetupGuide.swift converts.
import Foundation
import CoreGraphics

enum GuideCore {

  // MARK: - the token

  /// Longest clipboard text PS app even tries to match. Anything longer is not a token and is dropped unread.
  static let maxClip = 300
  /// Exactly one Supabase access token, nothing around it.
  static func isAccessToken(_ t: String) -> Bool {
    t.utf8.count <= 204 && t.range(of: #"^sbp_[A-Za-z0-9_]{20,200}$"#, options: .regularExpression) != nil
  }
  /// The token in a piece of copied text (spaces and line breaks around it are fine), else nil.
  static func token(in clip: String) -> String? {
    guard clip.utf8.count <= maxClip else { return nil }
    let t = clip.trimmingCharacters(in: .whitespacesAndNewlines)
    return isAccessToken(t) ? t : nil
  }

  // MARK: - the steps

  enum Stage: String, CaseIterable { case account, generate, legacy, name, create, copy }

  /// Where the arrow's tip goes on the browser window, and from which side the numbered marker comes.
  struct Anchor: Equatable {
    var tip: CGPoint
    /// Unit vector from the tip towards the marker (top left based, so +y is down).
    var toward: CGVector
  }

  struct Step: Equatable {
    let stage: Stage
    let title: String
    let text: String
    /// The exact Supabase page PS app opens when this step starts (nil: stay on the page already open).
    let url: String?
  }

  static let signUpURL = "https://supabase.com/dashboard/sign-up"
  static let tokensURL = "https://supabase.com/dashboard/account/tokens"

  /// Every word on the step card. Supabase's own labels (Generate new token, Resource access, Create legacy token,
  /// Name, Expires in, Never, Generate token) are spelled exactly as its dashboard shows them (checked against
  /// supabase/supabase apps/studio, Account/AccessTokens, 12 Nov 2026).
  /// The token is a legacy (full access) one: the same kind the setup asked for before V1.49 and that real
  /// projects were set up with. A token scoped to an organization may not see it, and then a new person with no
  /// project could not go on. Never expiring, so later versions of PS app can still update the project.
  static let all: [Step] = [
    Step(stage: .account, title: "Make your free Supabase account",
         text: "Sign up with GitHub or your email. It is free and needs no card. When you are signed in, click Next.",
         url: signUpURL),
    Step(stage: .generate, title: "Click Generate new token",
         text: "It is the green button at the top right of the Access Tokens page. A panel slides in from the right.",
         url: tokensURL),
    Step(stage: .legacy, title: "Click Create legacy token",
         text: "It is a small link under Resource access, after Need a token with full access to your account? It makes the same kind of token PS app has always used.",
         url: nil),
    Step(stage: .name, title: "Name it PS app",
         text: "Type PS app in the Name box. Set Expires in to Never, so PS app can keep your project up to date.",
         url: nil),
    Step(stage: .create, title: "Click Generate token",
         text: "It is the green button at the bottom right of the panel.",
         url: nil),
    Step(stage: .copy, title: "Click the copy button",
         text: "It is at the right end of the box that shows your new token. PS app comes back with it by itself.",
         url: nil),
  ]

  /// The note on the Copy step, so nobody wonders why PS app noticed the token.
  static let watchNote = "PS app is watching the clipboard on this step only, for a Supabase token and nothing else. It never looks while 1Password or Signal is in front."
  static let caughtTitle = "Got your token"
  static let caughtText = "Taking you back to PS app."

  /// The steps of one run: from the account step (no Supabase account yet) or straight from the token steps.
  static func steps(from start: Stage) -> [Step] {
    let i = all.firstIndex { $0.stage == start } ?? 1
    return Array(all[i...])
  }

  /// The only step on which PS app looks at the clipboard.
  static func watches(_ s: Stage) -> Bool { s == .copy }

  // MARK: - where the arrows point

  /// Height of the browser's own bars above the page (tabs plus address bar), a typical value. The step words
  /// say what to click, so an arrow a little off still works.
  static let chrome: CGFloat = 86

  /// Width of Supabase's token panel (its Sheet: 800 points from 1024 wide, 656 from 640, else the full width).
  static func sheetWidth(_ w: CGFloat) -> CGFloat { w >= 1024 ? 800 : w >= 640 ? 656 : w }

  /// Where the arrow of `stage` points on a browser window with this frame, or nil for no arrow.
  static func anchor(_ stage: Stage, in f: CGRect) -> Anchor? {
    guard f.width >= 300, f.height >= 240 else { return nil }
    let sheetX = f.maxX - sheetWidth(f.width)
    var a: Anchor
    switch stage {
    case .account:
      return nil   // the sign up page changes shape a lot: the words carry this step
    case .generate:
      // The row under the page title: Filter tokens on the left, the docs buttons, then Generate new token on the
      // right (with a small arrow button after it). Below 1700 wide the content runs to the right edge.
      let x = min(f.maxX - 120, f.minX + 1500)
      a = Anchor(tip: CGPoint(x: x, y: f.minY + chrome + 210), toward: CGVector(dx: -0.62, dy: 0.78))
    case .legacy:
      // Resource access: its label and the "Create legacy token" link sit in the panel's left column.
      a = Anchor(tip: CGPoint(x: sheetX + sheetWidth(f.width) * 0.3, y: f.minY + chrome + 300), toward: CGVector(dx: -0.94, dy: 0.34))
    case .name:
      // In legacy mode a warning box sits above the Name row.
      a = Anchor(tip: CGPoint(x: sheetX + sheetWidth(f.width) * 0.6, y: f.minY + chrome + 205), toward: CGVector(dx: -0.94, dy: 0.34))
    case .create:
      a = Anchor(tip: CGPoint(x: f.maxX - 72, y: f.maxY - 34), toward: CGVector(dx: -0.6, dy: -0.8))
    case .copy:
      a = Anchor(tip: CGPoint(x: f.maxX - 48, y: f.minY + chrome + 150), toward: CGVector(dx: -0.6, dy: 0.8))
    }
    // Never outside the window, even on a short one.
    a.tip.x = min(max(a.tip.x, f.minX + 24), f.maxX - 24)
    a.tip.y = min(max(a.tip.y, f.minY + 24), f.maxY - 24)
    return a
  }

  // MARK: - the browser window (its frame only)

  /// The front most normal window of the browser in a CGWindowList answer (front to back order), or nil. Reads
  /// only the owner's process id, the layer, the alpha and the bounds: never a title, never an owner name. Any
  /// entry of another process is skipped on its process id alone.
  static func browserFrame(in list: [[String: Any]], pid: Int32) -> CGRect? {
    guard pid > 0 else { return nil }
    for w in list {
      guard (w["kCGWindowOwnerPID"] as? NSNumber)?.int32Value == pid else { continue }
      guard (w["kCGWindowLayer"] as? NSNumber)?.intValue == 0, ((w["kCGWindowAlpha"] as? NSNumber)?.doubleValue ?? 1) > 0.05,
            let b = w["kCGWindowBounds"] as? [String: Any],
            let x = (b["X"] as? NSNumber)?.doubleValue, let y = (b["Y"] as? NSNumber)?.doubleValue,
            let wd = (b["Width"] as? NSNumber)?.doubleValue, let h = (b["Height"] as? NSNumber)?.doubleValue,
            wd >= 300, h >= 240 else { continue }
      return CGRect(x: x, y: y, width: wd, height: h)
    }
    return nil
  }

  /// Where the step card goes: beside the browser on the right, else on the left, else inside its bottom left
  /// corner (Supabase's panel opens on the right). With no browser window known: the screen's bottom right.
  static func cardOrigin(browser: CGRect?, screen s: CGRect, card: CGSize) -> CGPoint {
    let gap: CGFloat = 14
    var p: CGPoint
    if let b = browser {
      let top = b.minY + chrome + 40
      if s.maxX - b.maxX >= card.width + gap * 2 { p = CGPoint(x: b.maxX + gap, y: top) }
      else if b.minX - s.minX >= card.width + gap * 2 { p = CGPoint(x: b.minX - gap - card.width, y: top) }
      else { p = CGPoint(x: b.minX + 22, y: b.maxY - card.height - 22) }
    } else {
      p = CGPoint(x: s.maxX - card.width - 24, y: s.maxY - card.height - 24)
    }
    p.x = min(max(p.x, s.minX + 8), s.maxX - card.width - 8)
    p.y = min(max(p.y, s.minY + 8), s.maxY - card.height - 8)
    return p
  }

  // MARK: - the clipboard rules

  /// Marks password managers and other apps put on copies that must not be watched or kept
  /// (nspasteboard.org). A copy with any of them is skipped without reading it.
  static let privateMarks: Set<String> = ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType",
                                          "org.nspasteboard.AutoGeneratedType", "com.agilebits.onepassword"]
  static let textType = "public.utf8-plain-text"

  /// Watches the clipboard's change count, and says when (and only when) one new copy may be read once.
  struct PasteWatch {
    private(set) var armed = false
    private(set) var last = 0
    enum Act: Equatable { case nothing, read }

    /// The Copy step began: only copies made from now on count.
    mutating func arm(count: Int) { armed = true; last = count }
    mutating func disarm() { armed = false }

    /// One look at the change count (a number, not the contents).
    mutating func tick(count: Int, protectedFront: Bool, types: () -> [String]) -> Act {
      guard armed else { return .nothing }
      if protectedFront { last = count; return .nothing }   // made while 1Password or Signal is in front: never read
      guard count != last else { return .nothing }
      last = count
      let t = types()
      guard t.contains(GuideCore.textType), t.allSatisfy({ !GuideCore.privateMarks.contains($0) }) else { return .nothing }
      return .read
    }

    /// The app in front changed. Leaving 1Password or Signal: whatever was copied there is skipped, even when the
    /// switch was quicker than the next look.
    mutating func frontChanged(count: Int, leftProtected: Bool) { if armed && leftProtected { last = count } }
  }
}
