import Foundation
import CoreGraphics
import ScreenCaptureKit
import AppKit

struct WindowListEntry: Codable {
	let id: String
	let name: String
	let display_id: String
	let appName: String?
	let windowTitle: String?
	let bundleId: String?
	let x: Double
	let y: Double
	let width: Double
	let height: Double
	let visible: Bool
	let visibleX: Double?
	let visibleY: Double?
	let visibleWidth: Double?
	let visibleHeight: Double?
}

struct WindowRect {
	let x: Double
	let y: Double
	let width: Double
	let height: Double

	var right: Double { x + width }
	var bottom: Double { y + height }

	func intersection(_ other: WindowRect) -> WindowRect? {
		let nextX = max(x, other.x)
		let nextY = max(y, other.y)
		let nextRight = min(right, other.right)
		let nextBottom = min(bottom, other.bottom)
		let nextWidth = nextRight - nextX
		let nextHeight = nextBottom - nextY
		return nextWidth > 0 && nextHeight > 0
			? WindowRect(x: nextX, y: nextY, width: nextWidth, height: nextHeight)
			: nil
	}
}

struct WindowVisibility {
	let visible: Bool
	let bounds: WindowRect?
}

func normalize(_ value: String?) -> String? {
	guard let rawValue = value?.trimmingCharacters(in: .whitespacesAndNewlines), !rawValue.isEmpty else {
		return nil
	}

	return rawValue
}

let excludedBundleIds: Set<String> = [
	"com.apple.controlcenter",
	"com.apple.dock",
	"com.apple.WindowManager",
	"com.apple.wallpaper.agent",
]

let excludedWindowTitles: Set<String> = [
	"Display 1 Backstop",
	"Event Shield Window",
	"Menubar",
	"Offscreen Wallpaper Window",
	"Wallpaper-",
]

func rectFromCgWindowBounds(_ value: Any?) -> WindowRect? {
	guard let dictionary = value as? NSDictionary else {
		return nil
	}

	var rect = CGRect.zero
	if CGRectMakeWithDictionaryRepresentation(dictionary, &rect) {
		return WindowRect(
			x: Double(rect.origin.x),
			y: Double(rect.origin.y),
			width: Double(rect.width),
			height: Double(rect.height)
		)
	}

	return nil
}

func subtract(_ cutout: WindowRect, from source: WindowRect) -> [WindowRect] {
	guard let overlap = source.intersection(cutout) else {
		return [source]
	}

	var pieces: [WindowRect] = []

	if overlap.y > source.y {
		pieces.append(WindowRect(
			x: source.x,
			y: source.y,
			width: source.width,
			height: overlap.y - source.y
		))
	}

	if overlap.bottom < source.bottom {
		pieces.append(WindowRect(
			x: source.x,
			y: overlap.bottom,
			width: source.width,
			height: source.bottom - overlap.bottom
		))
	}

	if overlap.x > source.x {
		pieces.append(WindowRect(
			x: source.x,
			y: overlap.y,
			width: overlap.x - source.x,
			height: overlap.height
		))
	}

	if overlap.right < source.right {
		pieces.append(WindowRect(
			x: overlap.right,
			y: overlap.y,
			width: source.right - overlap.right,
			height: overlap.height
		))
	}

	return pieces.filter { $0.width > 0 && $0.height > 0 }
}

func unionRect(_ rects: [WindowRect]) -> WindowRect? {
	guard let first = rects.first else {
		return nil
	}

	var minX = first.x
	var minY = first.y
	var maxRight = first.right
	var maxBottom = first.bottom

	for rect in rects.dropFirst() {
		minX = min(minX, rect.x)
		minY = min(minY, rect.y)
		maxRight = max(maxRight, rect.right)
		maxBottom = max(maxBottom, rect.bottom)
	}

	return WindowRect(x: minX, y: minY, width: maxRight - minX, height: maxBottom - minY)
}

func shouldIgnoreWindowStackEntry(_ entry: [String: Any]) -> Bool {
	let layer = entry[kCGWindowLayer as String] as? Int ?? 0
	if layer != 0 {
		return true
	}

	let alpha = entry[kCGWindowAlpha as String] as? Double ?? 1
	if alpha <= 0 {
		return true
	}

	if let appName = normalize(entry[kCGWindowOwnerName as String] as? String),
	   appName == "Recordly" {
		return true
	}

	let ownerPid = entry[kCGWindowOwnerPID as String] as? pid_t
	let bundleId = ownerPid.flatMap { pid in
		normalize(NSRunningApplication(processIdentifier: pid)?.bundleIdentifier)
	}
	if let bundleId, excludedBundleIds.contains(bundleId) {
		return true
	}

	if let windowTitle = normalize(entry[kCGWindowName as String] as? String),
	   excludedWindowTitles.contains(windowTitle) {
		return true
	}

	guard let bounds = rectFromCgWindowBounds(entry[kCGWindowBounds as String]),
	      bounds.width >= 1,
	      bounds.height >= 1 else {
		return true
	}

	return false
}

func buildVisibilityByWindowId() -> [UInt32: WindowVisibility] {
	guard let windowInfo = CGWindowListCopyWindowInfo(
		[.optionOnScreenOnly, .excludeDesktopElements],
		kCGNullWindowID
	) as? [[String: Any]] else {
		return [:]
	}

	var visibilityByWindowId: [UInt32: WindowVisibility] = [:]
	var coveringRects: [WindowRect] = []

	for entry in windowInfo {
		guard let windowNumber = entry[kCGWindowNumber as String] as? UInt32,
		      let bounds = rectFromCgWindowBounds(entry[kCGWindowBounds as String]) else {
			continue
		}

		if shouldIgnoreWindowStackEntry(entry) {
			continue
		}

		var visibleRects = [bounds]
		for cover in coveringRects {
			visibleRects = visibleRects.flatMap { subtract(cover, from: $0) }
			if visibleRects.isEmpty {
				break
			}
		}

		visibilityByWindowId[windowNumber] = WindowVisibility(
			visible: !visibleRects.isEmpty,
			bounds: unionRect(visibleRects)
		)

		coveringRects.append(bounds)
	}

	return visibilityByWindowId
}

// Force CoreGraphics Services initialization before asking ScreenCaptureKit for
// shareable content. Without this, the helper can stall sporadically when run
// as a standalone CLI process from Electron.
let _ = CGMainDisplayID()

let group = DispatchGroup()
group.enter()

Task {
	do {
		let shareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
		let visibilityByWindowId = buildVisibilityByWindowId()
		let hasVisibilityStack = !visibilityByWindowId.isEmpty

		struct RawWindowEntry {
			let entry: WindowListEntry
			let hasRawTitle: Bool
			let bundleId: String?
		}

		let rawEntries = shareableContent.windows.compactMap { window -> RawWindowEntry? in
			let appName = normalize(window.owningApplication?.applicationName)
			let windowTitle = normalize(window.title)
			let bundleId = normalize(window.owningApplication?.bundleIdentifier)
			let frame = window.frame
			let visibility = visibilityByWindowId[window.windowID]
			let visibleBounds = visibility?.bounds

			guard window.windowLayer == 0 else {
				return nil
			}

			guard frame.width >= 50, frame.height >= 50 else {
				return nil
			}

			guard appName != nil || windowTitle != nil else {
				return nil
			}

			if let bundleId, excludedBundleIds.contains(bundleId) {
				return nil
			}

			if let windowTitle, excludedWindowTitles.contains(windowTitle) {
				return nil
			}

			let matchedDisplay = shareableContent.displays.first(where: { display in
				display.frame.intersects(frame) || display.frame.contains(CGPoint(x: frame.midX, y: frame.midY))
			})

			let resolvedWindowTitle = windowTitle ?? appName ?? "Window"
			let resolvedName: String
			if let appName, let windowTitle {
				resolvedName = "\(appName) — \(windowTitle)"
			} else {
				resolvedName = resolvedWindowTitle
			}

			let entry = WindowListEntry(
				id: "window:\(window.windowID):0",
				name: resolvedName,
				display_id: matchedDisplay.map { String($0.displayID) } ?? "",
				appName: appName,
				windowTitle: resolvedWindowTitle,
				bundleId: bundleId,
				x: Double(frame.origin.x),
				y: Double(frame.origin.y),
				width: Double(frame.width),
				height: Double(frame.height),
				visible: hasVisibilityStack ? (visibility?.visible ?? false) : true,
				visibleX: visibleBounds?.x,
				visibleY: visibleBounds?.y,
				visibleWidth: visibleBounds?.width,
				visibleHeight: visibleBounds?.height
			)

			return RawWindowEntry(entry: entry, hasRawTitle: windowTitle != nil, bundleId: bundleId)
		}

		// For apps with multiple windows, drop auxiliary windows that lack a
		// distinct title (e.g. Arc's sidebar/tab-bar chrome). If ALL windows
		// from an app lack titles, keep them all.
		var titledCountByBundle: [String: Int] = [:]
		for raw in rawEntries {
			if let bid = raw.bundleId, raw.hasRawTitle {
				titledCountByBundle[bid, default: 0] += 1
			}
		}

		let entries = rawEntries
			.filter { raw in
				guard let bid = raw.bundleId else { return true }
				if let titled = titledCountByBundle[bid], titled > 0 {
					return raw.hasRawTitle
				}
				return true
			}
			.map { $0.entry }
		.sorted { lhs, rhs in
			let lhsApp = lhs.appName ?? lhs.name
			let rhsApp = rhs.appName ?? rhs.name
			if lhsApp != rhsApp {
				return lhsApp.localizedCaseInsensitiveCompare(rhsApp) == .orderedAscending
			}

			return (lhs.windowTitle ?? lhs.name).localizedCaseInsensitiveCompare(rhs.windowTitle ?? rhs.name) == .orderedAscending
		}

		let encoder = JSONEncoder()
		encoder.outputFormatting = [.sortedKeys]
		let data = try encoder.encode(entries)
		FileHandle.standardOutput.write(data)
	} catch {
		fputs("Error listing windows: \(error.localizedDescription)\n", stderr)
		fflush(stderr)
		exit(1)
	}

	group.leave()
}

group.wait()
