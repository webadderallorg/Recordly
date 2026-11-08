import Foundation
import AppKit

// Initialize cursor images without registering this command-line exporter as
// another foreground instance of its parent Electron app in the macOS Dock.
NSApplication.shared.setActivationPolicy(.prohibited)

struct CursorAsset: Codable {
	let dataUrl: String
	let hotspotX: Double
	let hotspotY: Double
	let width: Double
	let height: Double
}

let minimumCursorRenderScale: CGFloat = 12

/// Reference pixel height that all cursor images are normalized to after trimming.
/// Kept high so large in-app cursor scaling still preserves raster detail up to 10x.
let referencePixelHeight: CGFloat = 1024

func bestCursorCGImage(for image: NSImage) -> CGImage? {
	var proposedRect = CGRect(origin: .zero, size: image.size)
	if let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) {
		return cgImage
	}

	let sortedRepresentations = image.representations.sorted { lhs, rhs in
		let lhsPixels = lhs.pixelsWide * lhs.pixelsHigh
		let rhsPixels = rhs.pixelsWide * rhs.pixelsHigh
		return lhsPixels > rhsPixels
	}

	for representation in sortedRepresentations {
		if let bitmap = representation as? NSBitmapImageRep, let cgImage = bitmap.cgImage {
			return cgImage
		}
	}

	return nil
}

func makeRetinaImage(from cgImage: CGImage, pointSize: NSSize) -> NSImage {
	let bitmap = NSBitmapImageRep(cgImage: cgImage)
	bitmap.size = pointSize
	let image = NSImage(size: pointSize)
	image.addRepresentation(bitmap)
	return image
}

/// Find the bounding box of non-transparent pixels in a bitmap.
/// Returns (x, y, width, height) in pixel coordinates (origin top-left).
func findOpaqueBounds(_ bitmap: NSBitmapImageRep) -> (x: Int, y: Int, width: Int, height: Int)? {
	let w = bitmap.pixelsWide
	let h = bitmap.pixelsHigh
	guard let data = bitmap.bitmapData else { return nil }
	let bpr = bitmap.bytesPerRow
	var minX = w, minY = h, maxX = -1, maxY = -1
	for y in 0..<h {
		for x in 0..<w {
			let alpha = data[y * bpr + x * 4 + 3]
			if alpha > 2 {
				if x < minX { minX = x }
				if x > maxX { maxX = x }
				if y < minY { minY = y }
				if y > maxY { maxY = y }
			}
		}
	}
	if maxX < 0 { return nil }
	return (minX, minY, maxX - minX + 1, maxY - minY + 1)
}

func makeAsset(for cursor: NSCursor) -> CursorAsset? {
	let baseImage = cursor.image
	let pointSize = baseImage.size
	guard let sourceCGImage = bestCursorCGImage(for: baseImage) else { return nil }
	let sourcePixelWidth = max(1, sourceCGImage.width)
	let sourcePixelHeight = max(1, sourceCGImage.height)
	let sourceScaleX = CGFloat(sourcePixelWidth) / max(1, pointSize.width)
	let sourceScaleY = CGFloat(sourcePixelHeight) / max(1, pointSize.height)
	let sourceScale = max(sourceScaleX, sourceScaleY)
	let image = makeRetinaImage(from: sourceCGImage, pointSize: pointSize)
	let renderScale = max(
		minimumCursorRenderScale,
		referencePixelHeight / max(1, CGFloat(sourcePixelHeight))
	)
	let pixelWidth = max(1, Int((CGFloat(sourcePixelWidth) * renderScale).rounded(.up)))
	let pixelHeight = max(1, Int((CGFloat(sourcePixelHeight) * renderScale).rounded(.up)))

	// Render at full resolution
	guard let bitmap = NSBitmapImageRep(
		bitmapDataPlanes: nil,
		pixelsWide: pixelWidth,
		pixelsHigh: pixelHeight,
		bitsPerSample: 8,
		samplesPerPixel: 4,
		hasAlpha: true,
		isPlanar: false,
		colorSpaceName: .deviceRGB,
		bytesPerRow: 0,
		bitsPerPixel: 0
	) else { return nil }

	bitmap.size = NSSize(width: CGFloat(pixelWidth), height: CGFloat(pixelHeight))

	NSGraphicsContext.saveGraphicsState()
	guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
		NSGraphicsContext.restoreGraphicsState()
		return nil
	}
	NSGraphicsContext.current = context
	context.imageInterpolation = .none
	context.cgContext.interpolationQuality = .none
	image.draw(
		in: NSRect(x: 0, y: 0, width: CGFloat(pixelWidth), height: CGFloat(pixelHeight)),
		from: .zero,
		operation: .copy,
		fraction: 1
	)
	context.flushGraphics()
	NSGraphicsContext.restoreGraphicsState()

	// Find opaque bounds and crop away transparent padding
	guard let bounds = findOpaqueBounds(bitmap) else { return nil }
	guard let fullCG = bitmap.cgImage else { return nil }
	let cropRect = CGRect(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height)
	guard let croppedCG = fullCG.cropping(to: cropRect) else { return nil }

	// Scale cropped image to referencePixelHeight
	let aspect = CGFloat(bounds.width) / CGFloat(bounds.height)
	let outH = Int(referencePixelHeight)
	let outW = max(1, Int((referencePixelHeight * aspect).rounded(.up)))

	guard let outBitmap = NSBitmapImageRep(
		bitmapDataPlanes: nil,
		pixelsWide: outW,
		pixelsHigh: outH,
		bitsPerSample: 8,
		samplesPerPixel: 4,
		hasAlpha: true,
		isPlanar: false,
		colorSpaceName: .deviceRGB,
		bytesPerRow: 0,
		bitsPerPixel: 0
	) else { return nil }

	outBitmap.size = NSSize(width: outW, height: outH)

	NSGraphicsContext.saveGraphicsState()
	guard let outCtx = NSGraphicsContext(bitmapImageRep: outBitmap) else {
		NSGraphicsContext.restoreGraphicsState()
		return nil
	}
	NSGraphicsContext.current = outCtx
	outCtx.imageInterpolation = .none
	outCtx.cgContext.interpolationQuality = .none
	let nsImage = NSImage(cgImage: croppedCG, size: NSSize(width: bounds.width, height: bounds.height))
	nsImage.draw(
		in: NSRect(x: 0, y: 0, width: outW, height: outH),
		from: .zero,
		operation: .copy,
		fraction: 1
	)
	outCtx.flushGraphics()
	NSGraphicsContext.restoreGraphicsState()

	guard let pngData = outBitmap.representation(using: .png, properties: [:]) else { return nil }
	let base64 = pngData.base64EncodedString()

	// Adjust hotspot using the extracted source image scale so 2x cursor reps keep the correct anchor.
	let hotspot = cursor.hotSpot
	let hotspotPxX = hotspot.x * sourceScale * renderScale - CGFloat(bounds.x)
	let hotspotPxY = hotspot.y * sourceScale * renderScale - CGFloat(bounds.y)
	let scaleToOut = referencePixelHeight / CGFloat(bounds.height)
	let outHotspotX = hotspotPxX * scaleToOut
	let outHotspotY = hotspotPxY * scaleToOut

	return CursorAsset(
		dataUrl: "data:image/png;base64,\(base64)",
		hotspotX: Double(outHotspotX),
		hotspotY: Double(outHotspotY),
		width: Double(outW),
		height: Double(outH)
	)
}

let cursorMap: [String: NSCursor] = [
	"arrow": .arrow,
	"text": .iBeam,
	"pointer": .pointingHand,
	"crosshair": .crosshair,
	"open-hand": .openHand,
	"closed-hand": .closedHand,
	"resize-ew": .resizeLeftRight,
	"resize-ns": .resizeUpDown,
	"not-allowed": .operationNotAllowed,
]

var assets: [String: CursorAsset] = [:]
for (key, cursor) in cursorMap {
	if let asset = makeAsset(for: cursor) {
		assets[key] = asset
	}
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let data = try encoder.encode(assets)
FileHandle.standardOutput.write(data)

