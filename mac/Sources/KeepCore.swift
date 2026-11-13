import Foundation

/// What happens when the Keep overlay tick comes off (V1.57). Pure, so it can be unit tested (tests/keepcore-test.sh).
///
/// The Tab list's Edit mode keeps the list up by turning Keep overlay on for itself, and turns it off again when you
/// leave Edit. Up to V1.56 Keep off always put the list away, so clicking a page in the Edit overview (or Done) dropped
/// The developer back into the app underneath (the developer, 13 Nov 2026: "it keeps you in until you hold/let go of tab again or you
/// click anywhere on screen that there isn't a button/panel").
///
/// Now the page can say `stay`: the list stays up, pinned, like a tap of Tab. Clicks land on the list again (no more
/// click through), so a click on empty space closes it (the page's own background click), and the next Tab closes it
/// by the usual Tab rules (Tab keeps the list open on: a hold; off: Tab down). The Keep tick itself, Esc, locking and
/// a page that does not say `stay` still put the list away as before.
enum KeepCore {
  enum Off: Equatable {
    /// The list goes away (as always before V1.57).
    case hide
    /// The list stays up, pinned, taking clicks everywhere.
    case stayPinned
  }

  static func off(stay: Bool, shown: Bool) -> Off {
    stay && shown ? .stayPinned : .hide
  }
}
