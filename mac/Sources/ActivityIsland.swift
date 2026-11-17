import AppKit
import SwiftUI

// The Activity monitor on the island (PS 1.65, the developer's request of 17 Nov 2026: "While open, the island can show a tiny live
// CPU and memory readout"). A small black capsule beside the island, like the recording part (ScreenRecIsland.swift): two tiny
// bars and two numbers, CPU and memory. It shows only while the Activity monitor is open, and goes away when it closes, when the
// Tab list goes, in private mode, or when the island is not on screen. It never takes a click (the window ignores the mouse), so
// it never takes over the mouse or the keyboard.
//
// Cost: the numbers come from the monitor's own sample (ActivityMonitor.swift), at most one change a sample. No timer of its own,
// no animation that keeps running: one short spring per change, nothing between samples.
final class ActivityIsland: ObservableObject {
  static let shared = ActivityIsland()
  @Published var shown = false
  @Published var cpu = 0.0
  @Published var mem = 0.0
  @Published var cpuText = "0%"
  @Published var memText = "0%"
  private var open = false
  private var win: IslandPanel?
  private var hideWork: DispatchWorkItem?
  static let w: CGFloat = 132, h: CGFloat = 24, gap: CGFloat = 6, margin: CGFloat = 2

  /// The page opened the monitor (main thread). The readout comes with the first numbers.
  func opened() { open = true }
  /// Closed, or the Tab list went away (main thread).
  func closed() { open = false; hide() }

  /// New numbers from a sample (main thread).
  func update(cpu: Double, used: UInt64, total: UInt64) {
    guard open, Features.on("activity-monitor") else { hide(); return }
    let t = ActivityCore.readout(cpu: cpu, used: used, total: total)
    let calm = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let m = total > 0 ? Double(used) / Double(total) * 100 : 0
    withAnimation(calm ? nil : .spring(response: 0.45, dampingFraction: 0.8)) {
      self.cpu = min(100, max(0, cpu)); self.mem = min(100, max(0, m))
    }
    cpuText = t.cpu; memText = t.mem
    place()
  }

  private func place() {
    guard open, !PrivateHold.shared.on, let a = Island.shared.timerAnchor() else { hide(); return }
    hideWork?.cancel(); hideWork = nil
    let win = window(level: a.panel.level)
    // Beside the island on the right when there is room (the recording part prefers the left), else the left, else below.
    let w = Self.w
    let rightRoom = a.screen.maxX - 4 - (a.shape.maxX + Self.gap), leftRoom = a.shape.minX - Self.gap - (a.screen.minX + 4)
    let f: CGRect
    if w <= rightRoom { f = CGRect(x: a.shape.maxX + Self.gap, y: a.bubbleY, width: w, height: Self.h) }
    else if w <= leftRoom { f = CGRect(x: a.shape.minX - Self.gap - w, y: a.bubbleY, width: w, height: Self.h) }
    else { f = CGRect(x: max(a.screen.minX + 4, min(a.shape.midX - w / 2, a.screen.maxX - 4 - w)), y: a.shape.minY - Self.gap - Self.h, width: w, height: Self.h) }
    let full = f.insetBy(dx: -Self.margin, dy: -Self.margin).integral
    if win.frame != full { win.setFrame(full, display: true) }
    let calm = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    let anim: Animation = calm ? .easeInOut(duration: 0.2) : .spring(response: 0.42, dampingFraction: 0.62)
    if !win.isVisible { shown = false; win.orderFrontRegardless(); DispatchQueue.main.async { [weak self] in withAnimation(anim) { self?.shown = true } } }
    else if !shown { withAnimation(anim) { shown = true } }
  }
  private func hide() {
    guard let w = win, w.isVisible, hideWork == nil else { return }
    let calm = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    withAnimation(calm ? .easeOut(duration: 0.15) : .spring(response: 0.3, dampingFraction: 0.86)) { shown = false }
    let work = DispatchWorkItem { [weak self] in self?.hideWork = nil; if self?.shown == false { self?.win?.orderOut(nil) } }
    hideWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.32, execute: work)
  }
  private func window(level: NSWindow.Level) -> IslandPanel {
    if let w = win { if w.level != level { w.level = level }; return w }
    let p = IslandPanel(contentRect: NSRect(x: 0, y: 0, width: Self.w + 4, height: Self.h + 4), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false; p.level = level
    p.hidesOnDeactivate = false; p.isReleasedWhenClosed = false; p.collectionBehavior = IslandPlace.spaces
    p.ignoresMouseEvents = true   // a readout only: clicks go through to whatever is below
    p.contentView = IslandHost(rootView: ActivityIslandView(m: self))
    if ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil { p.alphaValue = 0 }
    win = p
    return p
  }
}

/// "CPU 23%" and "MEM 61%", each over a hairline bar, white on the island's black.
struct ActivityIslandView: View {
  @ObservedObject var m: ActivityIsland
  var body: some View {
    let calm = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    ZStack {
      if m.shown {
        HStack(spacing: 10) {
          meter("CPU", m.cpuText, m.cpu, Color(red: 0.45, green: 0.78, blue: 1))
          meter("MEM", m.memText, m.mem, Color(red: 0.75, green: 0.6, blue: 1))
        }
        .padding(.horizontal, 11)
        .frame(width: ActivityIsland.w, height: ActivityIsland.h)
        .background(Capsule().fill(Color.black))
        .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 0.8))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Processor \(m.cpuText), memory \(m.memText)")
        .transition(calm ? .opacity : .scale(scale: 0.2, anchor: .leading).combined(with: .opacity).combined(with: .offset(x: -14)))
      }
    }
    .frame(width: ActivityIsland.w + 2 * ActivityIsland.margin, height: ActivityIsland.h + 2 * ActivityIsland.margin)
    .environment(\.colorScheme, .dark)
  }
  private func meter(_ label: String, _ text: String, _ v: Double, _ tint: Color) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: 4) {
        Text(label).font(.system(size: 8.5, weight: .heavy)).foregroundColor(Color.white.opacity(0.5))
        Text(text).font(.system(size: 10.5, weight: .bold)).monospacedDigit().foregroundColor(.white)
      }
      GeometryReader { g in
        ZStack(alignment: .leading) {
          Capsule().fill(Color.white.opacity(0.12))
          Capsule().fill(tint).frame(width: max(2, g.size.width * CGFloat(v / 100)))
        }
      }
      .frame(height: 2)
    }
    .frame(maxWidth: .infinity)
  }
}
