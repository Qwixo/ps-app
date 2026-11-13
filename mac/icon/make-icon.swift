// Turns the square PS logo into a macOS app icon: rounded square on Apple's 1024 grid
// (824 px body, 100 px margin) with a soft shadow. Usage: swift make-icon.swift <logo> <out.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let src = NSImage(contentsOfFile: args[1]) else { print("usage: make-icon <logo> <out.png>"); exit(1) }
let size = 1024, body: CGFloat = 824, margin: CGFloat = 100, radius: CGFloat = 185
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let rect = CGRect(x: margin, y: margin + 10, width: body, height: body)
let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 28, color: CGColor(gray: 0, alpha: 0.45))
ctx.addPath(path); ctx.setFillColor(CGColor(gray: 0.05, alpha: 1)); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.addPath(path); ctx.clip()
var r = CGRect(origin: .zero, size: src.size)
let cg = src.cgImage(forProposedRect: &r, context: nil, hints: nil)!
ctx.interpolationQuality = .high
ctx.draw(cg, in: rect)
ctx.restoreGState()
// thin inner edge so the dark icon reads on a dark Dock
ctx.addPath(path); ctx.setStrokeColor(CGColor(gray: 1, alpha: 0.12)); ctx.setLineWidth(2); ctx.strokePath()
let out = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! out.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
