import AppKit

// V1.58 the island's right click menu (Island.swift showMenu): the plain items run through IslandMenuTarget, and the
// time item is IslandMinutesView, "Disappear for [30] minutes" in one row, the number changeable before choosing:
// scroll up or down on the row to change it, or click the number and type a time (45, 1h, 1:30, 2h 15m). Enter or a
// click on the row chooses it; Esc closes the menu. The words wait for the developer's approval (v158-island-move.md).

/** Runs a closure per menu item (NSMenu needs an Objective C target). */
final class IslandMenuTarget: NSObject {
  var actions: [NSMenuItem: () -> Void] = [:]
  @objc func run(_ item: NSMenuItem) { actions[item]?() }
}

final class IslandMinutesView: NSView, NSTextFieldDelegate {
  private let lead = NSTextField(labelWithString: "Disappear for")
  private let field = NSTextField(string: "")
  private let unit = NSTextField(labelWithString: "minutes")
  private let hint = NSTextField(labelWithString: "Scroll, or click the number to type a time")
  private var minutes: Int
  private let choose: (Int) -> Void
  private var hot = false { didSet { if hot != oldValue { needsDisplay = true; recolour() } } }
  private var scrollSum: CGFloat = 0

  init(minutes: Int, choose: @escaping (Int) -> Void) {
    self.minutes = IslandAwayCore.clampMinutes(minutes)
    self.choose = choose
    super.init(frame: NSRect(x: 0, y: 0, width: 252, height: 44))
    for l in [lead, unit] { l.font = .menuFont(ofSize: 0); l.textColor = .labelColor; addSubview(l) }
    hint.font = .systemFont(ofSize: NSFont.smallSystemFontSize - 1)
    hint.textColor = .secondaryLabelColor
    addSubview(hint)
    field.font = .monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
    field.alignment = .center
    field.bezelStyle = .roundedBezel
    field.focusRingType = .none
    field.delegate = self
    field.target = self
    field.action = #selector(enter)
    field.setAccessibilityLabel("Minutes to disappear for. Scroll to change, or type a time and press Enter")
    addSubview(field)
    setAccessibilityElement(true)
    setAccessibilityRole(.menuItem)
    show()
    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  required init?(coder: NSCoder) { fatalError("not used") }

  private func show() {
    field.stringValue = "\(minutes)"
    unit.stringValue = IslandAwayCore.unit(minutes)
    setAccessibilityLabel("Disappear for \(minutes) \(IslandAwayCore.unit(minutes))")
    needsLayout = true
  }
  override func layout() {
    super.layout()
    let x0: CGFloat = 14, top = bounds.height - 6
    lead.sizeToFit(); unit.sizeToFit(); hint.sizeToFit()
    let rowH: CGFloat = 22
    let y = top - rowH
    lead.frame.origin = NSPoint(x: x0, y: y + (rowH - lead.frame.height) / 2)
    field.frame = NSRect(x: lead.frame.maxX + 6, y: y, width: 52, height: rowH)
    unit.frame.origin = NSPoint(x: field.frame.maxX + 6, y: y + (rowH - unit.frame.height) / 2)
    hint.frame.origin = NSPoint(x: x0, y: 3)
  }
  override func draw(_ r: NSRect) {
    guard hot else { return }
    NSColor.selectedContentBackgroundColor.setFill()
    NSBezierPath(roundedRect: bounds.insetBy(dx: 5, dy: 1), xRadius: 5, yRadius: 5).fill()
  }
  private func recolour() {
    for l in [lead, unit] { l.textColor = hot ? .selectedMenuItemTextColor : .labelColor }
    hint.textColor = hot ? NSColor.selectedMenuItemTextColor.withAlphaComponent(0.8) : .secondaryLabelColor
  }
  override func mouseEntered(with e: NSEvent) { hot = true }
  override func mouseExited(with e: NSEvent) { hot = false }

  /// Up (the wheel, or two fingers, as the hand moves) adds time; down takes it off. Small trackpad moves add up.
  override func scrollWheel(with e: NSEvent) {
    let dy = e.isDirectionInvertedFromDevice ? -e.scrollingDeltaY : e.scrollingDeltaY
    scrollSum += e.hasPreciseScrollingDeltas ? dy : dy * 6
    while abs(scrollSum) >= 6 {
      let up = scrollSum > 0
      scrollSum += up ? -6 : 6
      if let typed = IslandAwayCore.parse(field.stringValue) { minutes = typed }
      minutes = IslandAwayCore.scrolled(from: minutes, up: up)
    }
    show()
  }
  /// A click on the row (not on the number) chooses the time shown.
  override func mouseUp(with e: NSEvent) {
    let p = convert(e.locationInWindow, from: nil)
    if field.frame.insetBy(dx: -2, dy: -2).contains(p) { return }
    commit()
  }
  @objc private func enter() { commit() }
  /// The typed time, or the number shown; a time that is not one makes the error sound and keeps the menu open.
  private func commit() {
    guard let m = IslandAwayCore.parse(field.stringValue) else { NSSound.beep(); field.selectText(nil); return }
    minutes = m
    show()
    enclosingMenuItem?.menu?.cancelTracking()
    let choose = self.choose
    DispatchQueue.main.async { choose(m) }
  }
  /// While typing: the word after it follows the number; Esc closes the menu, as everywhere else.
  func controlTextDidChange(_ n: Notification) {
    if let m = IslandAwayCore.parse(field.stringValue) { unit.stringValue = IslandAwayCore.unit(m); needsLayout = true }
  }
  func control(_ c: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
    if sel == #selector(NSResponder.cancelOperation(_:)) { enclosingMenuItem?.menu?.cancelTracking(); return true }
    return false
  }
}
