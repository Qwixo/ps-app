import AppKit
import WebKit
import ObjectiveC

// No "Reload" in any right click menu in PS (V1.34, the developer 5 Nov 2026: "currently it just says reload which I don't
// like"). WebKit's own menu in every PS web view (the Tab list, the main page, the cards, the toasts, the AFK and Are
// you sure screens, the Second Computer window) offered Reload, which reloads that page under the developer's hands. The web
// pages now show PS's own task menu or nothing (web src/nocontext.ts, views/TaskMenu.tsx); this takes
// Reload out of whatever WebKit still builds, for every WKWebView PS makes, in one place, so the native cards with
// their own small pages are covered too. Copy, Paste and Look Up in a text box stay.
enum NoReload {
  private static var installed = false
  /// Is the WKWebView menu hook in place? (the self test checks it)
  static var active: Bool { installed }

  /// Called once at launch, before any web view shows a menu.
  static func install() {
    guard !installed else { return }
    let cls: AnyClass = WKWebView.self
    let sel = #selector(NSView.willOpenMenu(_:with:))
    guard let m = class_getInstanceMethod(cls, sel) else { return }
    typealias Fn = @convention(c) (AnyObject, Selector, NSMenu, NSEvent) -> Void
    let old = unsafeBitCast(method_getImplementation(m), to: Fn.self)
    let block: @convention(block) (AnyObject, NSMenu, NSEvent) -> Void = { obj, menu, event in
      old(obj, sel, menu, event)
      clean(menu)
    }
    let imp = imp_implementationWithBlock(block)
    // WKWebView's own method when it has one, else a new one on WKWebView (NSView's stays as it was).
    if !class_addMethod(cls, sel, imp, method_getTypeEncoding(m)) { method_setImplementation(m, imp) }
    installed = true
  }

  /// Reload out, and no separator left hanging at either end (a menu with nothing left does not show).
  static func clean(_ menu: NSMenu) {
    for item in menu.items where isReload(item) { menu.removeItem(item) }
    while let f = menu.items.first, f.isSeparatorItem { menu.removeItem(f) }
    while let l = menu.items.last, l.isSeparatorItem { menu.removeItem(l) }
    var prev = false
    for item in menu.items { if item.isSeparatorItem && prev { menu.removeItem(item) } else { prev = item.isSeparatorItem } }
  }
  static func isReload(_ item: NSMenuItem) -> Bool {
    let id = item.identifier?.rawValue ?? ""
    return id == "WKMenuItemIdentifierReload" || id.hasSuffix("Reload") || (id.isEmpty && item.title == "Reload")
  }
}
