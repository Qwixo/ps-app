// Draws the PS.dmg window background (640 x 400 points, 1x and 2x), run once by hand:
//   swift release/dmg/make-background.swift release/dmg
// then: tiffutil -cathidpicheck background.png background-2x.png -out background.tiff (a name with "@" in it
// would look like an email address to release/audit.py, since the TIFF keeps the file names)
// PS sits at (170, 190) and Applications at (470, 190) in the window (layout.py): the arrow runs between.
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let W: CGFloat = 640, H: CGFloat = 400
let pink = NSColor(red: 0xEC / 255, green: 0x4E / 255, blue: 0x86 / 255, alpha: 1)
let deep = NSColor(red: 0xC8 / 255, green: 0x36 / 255, blue: 0x6B / 255, alpha: 1)
let ink = NSColor(red: 0x1B / 255, green: 0x1A / 255, blue: 0x1D / 255, alpha: 1)

func draw(scale: CGFloat, to path: String) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale), bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: W, height: H)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  // Soft blush, a little warmer at the top.
  NSGradient(colors: [NSColor(red: 1, green: 0.957, blue: 0.973, alpha: 1), NSColor(red: 0.992, green: 0.933, blue: 0.957, alpha: 1)])!
    .draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)
  // The arrow from PS to Applications (y is flipped: Finder's 190 from the top is 210 from the bottom).
  let y: CGFloat = H - 190
  let shaft = NSBezierPath()
  shaft.move(to: NSPoint(x: 252, y: y)); shaft.line(to: NSPoint(x: 378, y: y))
  shaft.lineWidth = 6; shaft.lineCapStyle = .round
  pink.setStroke(); shaft.stroke()
  let head = NSBezierPath()
  head.move(to: NSPoint(x: 392, y: y)); head.line(to: NSPoint(x: 372, y: y + 13)); head.line(to: NSPoint(x: 372, y: y - 13)); head.close()
  pink.setFill(); head.fill()
  // Words.
  let p = NSMutableParagraphStyle(); p.alignment = .center
  func text(_ s: String, _ size: CGFloat, _ weight: NSFont.Weight, _ color: NSColor, _ top: CGFloat) {
    let a: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: p]
    (s as NSString).draw(in: NSRect(x: 0, y: H - top - size * 1.4, width: W, height: size * 1.5), withAttributes: a)
  }
  text("Drag PS app to Applications", 22, .bold, ink, 52)
  text("or double-click PS app and click Install PS app", 14, .regular, deep, 300)
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}
draw(scale: 1, to: "\(out)/background.png")
draw(scale: 2, to: "\(out)/background-2x.png")
print("wrote \(out)/background.png and background-2x.png")
