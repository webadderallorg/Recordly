import Foundation
import AppKit
import ApplicationServices

// Force AppKit initialization so cursor images are populated in CLI context
let _ = NSApplication.shared

func knownCursorCandidates() -> [(String, NSCursor)] {
	var candidates: [(String, NSCursor)] = [
		("arrow", .arrow),
		("text", .iBeam),
		("pointer", .pointingHand),
		("pointer", .dragCopy),
		("pointer", .dragLink),
		("pointer", .contextualMenu),
		("crosshair", .crosshair),
		("open-hand", .openHand),
		("closed-hand", .closedHand),
		("resize-ew", .resizeLeft),
		("resize-ew", .resizeRight),
		("resize-ew", .resizeLeftRight),
		("resize-ns", .resizeUp),
		("resize-ns", .resizeDown),
		("resize-ns", .resizeUpDown),
		("not-allowed", .operationNotAllowed),
	]

	if #available(macOS 10.13, *) {
		candidates.append(("text", .iBeamCursorForVerticalLayout))
	}

	return candidates
}

let signatureAcceptanceThreshold = 12000
let relaxedSignatureAcceptanceThresholds: [String: Int] = [
	"text": 28000,
	"crosshair": 32000,
]
let strictSignatureAcceptanceThresholds: [String: Int] = [
	"open-hand": 3200,
	"closed-hand": 3200,
]

let systemWideElement = AXUIElementCreateSystemWide()
let totalScreenHeight = NSScreen.screens.reduce(CGFloat(0)) { max($0, $1.frame.maxY) }
let axEditableAttribute = "AXEditable"
let axLinkRole = "AXLink"

struct CursorSignature {
	let aspectRatio: Double
	let hotspotXRatio: Double
	let hotspotYRatio: Double
	let shapeSamples: [UInt8]
}

func signature(for cursor: NSCursor, sampleSize: Int = 32) -> CursorSignature? {
	let image = cursor.image
	let sourceSize = image.size
	guard sourceSize.width > 0, sourceSize.height > 0 else {
		return nil
	}

	guard let bitmap = NSBitmapImageRep(
		bitmapDataPlanes: nil,
		pixelsWide: sampleSize,
		pixelsHigh: sampleSize,
		bitsPerSample: 8,
		samplesPerPixel: 4,
		hasAlpha: true,
		isPlanar: false,
		colorSpaceName: .deviceRGB,
		bytesPerRow: 0,
		bitsPerPixel: 0
	) else {
		return nil
	}

	bitmap.size = NSSize(width: sampleSize, height: sampleSize)

	NSGraphicsContext.saveGraphicsState()
	guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
		NSGraphicsContext.restoreGraphicsState()
		return nil
	}

	NSGraphicsContext.current = context
	context.imageInterpolation = .high

	let scale = min(CGFloat(sampleSize) / sourceSize.width, CGFloat(sampleSize) / sourceSize.height)
	let drawWidth = sourceSize.width * scale
	let drawHeight = sourceSize.height * scale
	let drawRect = NSRect(
		x: (CGFloat(sampleSize) - drawWidth) / 2,
		y: (CGFloat(sampleSize) - drawHeight) / 2,
		width: drawWidth,
		height: drawHeight
	)

	image.draw(in: drawRect, from: .zero, operation: .copy, fraction: 1)
	context.flushGraphics()
	NSGraphicsContext.restoreGraphicsState()

	guard let data = bitmap.bitmapData else {
		return nil
	}

	var alphaSamples: [UInt8] = []
	alphaSamples.reserveCapacity(sampleSize * sampleSize)
	let bytesPerRow = bitmap.bytesPerRow

	for y in 0..<sampleSize {
		for x in 0..<sampleSize {
			let offset = y * bytesPerRow + x * 4
			let alpha = data[offset + 3]
			alphaSamples.append(alpha > 24 ? 255 : 0)
		}
	}

	let hotspot = cursor.hotSpot
	return CursorSignature(
		aspectRatio: Double(sourceSize.width / max(1, sourceSize.height)),
		hotspotXRatio: Double(hotspot.x / max(1, sourceSize.width)),
		hotspotYRatio: Double(hotspot.y / max(1, sourceSize.height)),
		shapeSamples: alphaSamples
	)
}

func signatureScore(_ lhs: CursorSignature, _ rhs: CursorSignature) -> Int {
	let count = min(lhs.shapeSamples.count, rhs.shapeSamples.count)
	var imageDifference = 0
	for index in 0..<count {
		imageDifference += abs(Int(lhs.shapeSamples[index]) - Int(rhs.shapeSamples[index]))
	}

	let aspectPenalty = Int(abs(lhs.aspectRatio - rhs.aspectRatio) * 1800)
	let hotspotPenalty = Int((abs(lhs.hotspotXRatio - rhs.hotspotXRatio) + abs(lhs.hotspotYRatio - rhs.hotspotYRatio)) * 2200)
	return imageDifference + aspectPenalty + hotspotPenalty
}

let knownCursorSignatures: [(String, CursorSignature)] = knownCursorCandidates().compactMap { entry in
	guard let cursorSignature = signature(for: entry.1) else {
		return nil
	}

	return (entry.0, cursorSignature)
}

func attributeString(_ element: AXUIElement, _ attribute: String) -> String? {
	var value: CFTypeRef?
	let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
	guard error == .success else {
		return nil
	}

	return value as? String
}

func attributeBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
	var value: CFTypeRef?
	let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
	guard error == .success else {
		return nil
	}

	return value as? Bool
}

func actionNames(_ element: AXUIElement) -> [String] {
	var names: CFArray?
	let error = AXUIElementCopyActionNames(element, &names)
	guard error == .success, let actions = names as? [String] else {
		return []
	}

	return actions
}

func currentElement() -> AXUIElement? {
	guard let location = CGEvent(source: nil)?.location else {
		return nil
	}

	var element: AXUIElement?
	let y = totalScreenHeight > 0 ? totalScreenHeight - location.y : location.y
	let error = AXUIElementCopyElementAtPosition(systemWideElement, Float(location.x), Float(y), &element)
	guard error == .success else {
		return nil
	}

	return element
}

func focusedElement() -> AXUIElement? {
	var value: CFTypeRef?
	let error = AXUIElementCopyAttributeValue(systemWideElement, kAXFocusedUIElementAttribute as CFString, &value)
	guard error == .success, let value else {
		return nil
	}

	return unsafeBitCast(value, to: AXUIElement.self)
}

func parentElement(of element: AXUIElement) -> AXUIElement? {
	var value: CFTypeRef?
	let error = AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &value)
	guard error == .success, let value else {
		return nil
	}

	return unsafeBitCast(value, to: AXUIElement.self)
}

func hasAttribute(_ element: AXUIElement, _ attribute: String) -> Bool {
	var value: CFTypeRef?
	return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success
}

func ancestorChain(startingAt element: AXUIElement?, maxDepth: Int = 4) -> [AXUIElement] {
	guard let element else {
		return []
	}

	var elements: [AXUIElement] = [element]
	var current = element
	var depth = 0

	while depth < maxDepth, let parent = parentElement(of: current) {
		elements.append(parent)
		current = parent
		depth += 1
	}

	return elements
}

func metadataString(for element: AXUIElement) -> String {
	return [
		attributeString(element, kAXRoleAttribute),
		attributeString(element, kAXSubroleAttribute),
		attributeString(element, kAXRoleDescriptionAttribute),
		attributeString(element, kAXDescriptionAttribute),
		attributeString(element, kAXHelpAttribute),
		attributeString(element, kAXTitleAttribute),
	]
	.compactMap { $0?.lowercased() }
	.joined(separator: " ")
}

func elementLooksTextual(_ element: AXUIElement) -> Bool {
	let role = attributeString(element, kAXRoleAttribute)
	let subrole = attributeString(element, kAXSubroleAttribute)
	let editable = attributeBool(element, axEditableAttribute)
	let metadata = metadataString(for: element)
	let actions = actionNames(element)

	let textRoles: Set<String> = [
		kAXTextFieldRole as String,
		kAXTextAreaRole as String,
		kAXComboBoxRole as String,
		kAXSearchFieldSubrole as String,
	]

	if editable == true || textRoles.contains(role ?? "") || textRoles.contains(subrole ?? "") {
		return true
	}

	if metadata.contains("text field")
		|| metadata.contains("search field")
		|| metadata.contains("editor")
		|| metadata.contains("insertion point")
		|| metadata.contains("caret")
		|| metadata.contains("source editor") {
		return true
	}

	return hasAttribute(element, kAXSelectedTextRangeAttribute as String)
		|| hasAttribute(element, kAXNumberOfCharactersAttribute as String)
		|| (actions.contains(kAXPressAction as String) && metadata.contains("text"))
}

func accessibilityCursorMatch() -> String? {
	let hoveredChain = ancestorChain(startingAt: currentElement())
	let focusedChain = ancestorChain(startingAt: focusedElement())

	for element in hoveredChain + focusedChain {
		if elementLooksTextual(element) {
			return "text"
		}
	}

	guard let element = hoveredChain.first else {
		return nil
	}

	let role = attributeString(element, kAXRoleAttribute)
	let enabled = attributeBool(element, kAXEnabledAttribute)
	let actions = actionNames(element)
	let metadata = hoveredChain
		.map { metadataString(for: $0) }
		.filter { !$0.isEmpty }
		.joined(separator: " ")
	if metadata.contains("crosshair") || metadata.contains("cross hair") || metadata.contains("precision") || metadata.contains("crop") {
		return "crosshair"
	}

	if role == kAXSplitterRole as String {
		return "resize-ew"
	}

	let pressableRoles: Set<String> = [
		kAXButtonRole as String,
		axLinkRole,
		kAXMenuItemRole as String,
		kAXPopUpButtonRole as String,
		kAXRadioButtonRole as String,
		kAXCheckBoxRole as String,
		kAXTabGroupRole as String,
	]
	let hasPressAction = actions.contains(kAXPressAction as String)
	if enabled == false && (hasPressAction || pressableRoles.contains(role ?? "")) {
		return "not-allowed"
	}
	if hasPressAction || pressableRoles.contains(role ?? "") {
		return "pointer"
	}

	return nil
}

func currentSystemCursorType() -> String {
	let resolvedCursor: NSCursor? = DispatchQueue.main.sync {
		if #available(macOS 14.0, *) {
			return NSCursor.currentSystem ?? NSCursor.current
		}

		return NSCursor.current
	}

	guard let resolvedCursor else {
		return accessibilityCursorMatch() ?? "arrow"
	}

	guard let currentSignature = signature(for: resolvedCursor) else {
		return accessibilityCursorMatch() ?? "arrow"
	}

	guard let bestMatch = knownCursorSignatures.min(by: { lhs, rhs in
		signatureScore(currentSignature, lhs.1) < signatureScore(currentSignature, rhs.1)
	}) else {
		return accessibilityCursorMatch() ?? "arrow"
	}

	let bestScore = signatureScore(currentSignature, bestMatch.1)
	let primaryThreshold = strictSignatureAcceptanceThresholds[bestMatch.0] ?? signatureAcceptanceThreshold
	let matchedCursorType: String
	if bestScore > primaryThreshold {
		if let relaxedThreshold = relaxedSignatureAcceptanceThresholds[bestMatch.0], bestScore <= relaxedThreshold {
			matchedCursorType = bestMatch.0
		} else {
			matchedCursorType = "arrow"
		}
	} else {
		matchedCursorType = bestMatch.0
	}

	return matchedCursorType
}

func exportCursorImages() {
	let cursorForType: [(String, NSCursor)] = [
		("arrow", .arrow),
		("text", .iBeam),
		("pointer", .pointingHand),
		("crosshair", .crosshair),
		("open-hand", .openHand),
		("closed-hand", .closedHand),
		("resize-ew", .resizeLeftRight),
		("resize-ns", .resizeUpDown),
		("not-allowed", .operationNotAllowed),
	]

	for (name, cursor) in cursorForType {
		let image = cursor.image
		let hotspot = cursor.hotSpot
		let size = image.size
		guard size.width > 0, size.height > 0 else { continue }

		guard let tiffData = image.tiffRepresentation,
			  let bitmapRep = NSBitmapImageRep(data: tiffData),
			  let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
			continue
		}

		let base64 = pngData.base64EncodedString()
		let hotspotXRatio = hotspot.x / size.width
		let hotspotYRatio = hotspot.y / size.height
		let aspectRatio = size.width / size.height
		print("CURSOR_IMAGE:\(name):\(hotspotXRatio):\(hotspotYRatio):\(aspectRatio):\(base64)")
		fflush(stdout)
	}
}

if CommandLine.arguments.contains("--export-images") {
	exportCursorImages()
	exit(0)
}

func focusedIsSecureTextField() -> Bool {
	guard let element = focusedElement() else {
		return false
	}
	let subrole = attributeString(element, kAXSubroleAttribute)
	return subrole == (kAXSecureTextFieldSubrole as String) || subrole == "AXSecureTextField"
}

func isModifierOnlyKeyCode(_ keyCode: Int64) -> Bool {
	switch keyCode {
	case 0x36, 0x37, 0x38, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E:
		return true
	default:
		return false
	}
}

func keystrokeToken(forKeyCode keyCode: Int64) -> String? {
	switch keyCode {
	case 0x00: return "a"
	case 0x0B: return "b"
	case 0x08: return "c"
	case 0x02: return "d"
	case 0x0E: return "e"
	case 0x03: return "f"
	case 0x05: return "g"
	case 0x04: return "h"
	case 0x22: return "i"
	case 0x26: return "j"
	case 0x28: return "k"
	case 0x25: return "l"
	case 0x2E: return "m"
	case 0x2D: return "n"
	case 0x1F: return "o"
	case 0x23: return "p"
	case 0x0C: return "q"
	case 0x0F: return "r"
	case 0x01: return "s"
	case 0x11: return "t"
	case 0x20: return "u"
	case 0x09: return "v"
	case 0x0D: return "w"
	case 0x07: return "x"
	case 0x10: return "y"
	case 0x06: return "z"
	case 0x1D: return "0"
	case 0x12: return "1"
	case 0x13: return "2"
	case 0x14: return "3"
	case 0x15: return "4"
	case 0x17: return "5"
	case 0x16: return "6"
	case 0x1A: return "7"
	case 0x1C: return "8"
	case 0x19: return "9"
	case 0x24, 0x4C: return "enter"
	case 0x35: return "esc"
	case 0x30: return "tab"
	case 0x31: return "space"
	case 0x33: return "backspace"
	case 0x75: return "delete"
	case 0x7B: return "arrowleft"
	case 0x7C: return "arrowright"
	case 0x7E: return "arrowup"
	case 0x7D: return "arrowdown"
	case 0x73: return "home"
	case 0x77: return "end"
	case 0x74: return "pageup"
	case 0x79: return "pagedown"
	case 0x7A: return "f1"
	case 0x78: return "f2"
	case 0x63: return "f3"
	case 0x76: return "f4"
	case 0x60: return "f5"
	case 0x61: return "f6"
	case 0x62: return "f7"
	case 0x64: return "f8"
	case 0x65: return "f9"
	case 0x6D: return "f10"
	case 0x67: return "f11"
	case 0x6F: return "f12"
	case 0x69: return "f13"
	case 0x6B: return "f14"
	case 0x71: return "f15"
	case 0x6A: return "f16"
	case 0x40: return "f17"
	case 0x4F: return "f18"
	case 0x50: return "f19"
	case 0x2B: return "comma"
	case 0x2F: return "period"
	case 0x1B: return "minus"
	case 0x18: return "equal"
	case 0x2C: return "slash"
	case 0x29: return "semicolon"
	case 0x27: return "quote"
	case 0x21: return "bracketleft"
	case 0x1E: return "bracketright"
	case 0x2A: return "backslash"
	case 0x32: return "backquote"
	default:
		return nil
	}
}

func emitKeystrokeIfNeeded(_ event: CGEvent) {
	if event.getIntegerValueField(.keyboardEventAutorepeat) != 0 {
		return
	}
	if focusedIsSecureTextField() {
		return
	}
	let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
	if isModifierOnlyKeyCode(keyCode) {
		return
	}
	guard let token = keystrokeToken(forKeyCode: keyCode) else {
		return
	}
	var mods: [String] = []
	if event.flags.contains(.maskCommand) {
		mods.append("meta")
	}
	if event.flags.contains(.maskControl) {
		mods.append("ctrl")
	}
	if event.flags.contains(.maskAlternate) {
		mods.append("alt")
	}
	if event.flags.contains(.maskShift) {
		mods.append("shift")
	}
	print("KEY:down:\(token):\(mods.joined(separator: ","))")
	fflush(stdout)
}

func mouseInteractionCallback(
	proxy: CGEventTapProxy,
	type: CGEventType,
	event: CGEvent,
	refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
	let action: String
	let button: Int
	switch type {
	case .leftMouseDown:
		action = "mousedown"
		button = 1
	case .leftMouseUp:
		action = "mouseup"
		button = 1
	case .rightMouseDown:
		action = "mousedown"
		button = 2
	case .rightMouseUp:
		action = "mouseup"
		button = 2
	case .otherMouseDown:
		guard event.getIntegerValueField(.mouseEventButtonNumber) == 2 else {
			return Unmanaged.passUnretained(event)
		}
		action = "mousedown"
		button = 3
	case .otherMouseUp:
		guard event.getIntegerValueField(.mouseEventButtonNumber) == 2 else {
			return Unmanaged.passUnretained(event)
		}
		action = "mouseup"
		button = 3
	case .keyDown:
		emitKeystrokeIfNeeded(event)
		return Unmanaged.passUnretained(event)
	default:
		return Unmanaged.passUnretained(event)
	}

	print("INTERACTION:\(action):\(button)")
	fflush(stdout)
	return Unmanaged.passUnretained(event)
}

func eventMask(for types: [CGEventType]) -> CGEventMask {
	types.reduce(CGEventMask(0)) { mask, type in
		mask | (CGEventMask(1) << type.rawValue)
	}
}

func installListenOnlyTap(_ mask: CGEventMask) -> Bool {
	guard let tap = CGEvent.tapCreate(
		tap: .cgSessionEventTap,
		place: .headInsertEventTap,
		options: .listenOnly,
		eventsOfInterest: mask,
		callback: mouseInteractionCallback,
		userInfo: nil
	),
	let eventTapSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
		return false
	}
	CFRunLoopAddSource(CFRunLoopGetMain(), eventTapSource, .commonModes)
	CGEvent.tapEnable(tap: tap, enable: true)
	return true
}

let captureKeys = CommandLine.arguments.contains("--capture-keys")
let mouseEventTypes: [CGEventType] = [
	.leftMouseDown,
	.leftMouseUp,
	.rightMouseDown,
	.rightMouseUp,
	.otherMouseDown,
	.otherMouseUp,
]
let mouseOnlyMask = eventMask(for: mouseEventTypes)
let combinedMask = captureKeys
	? mouseOnlyMask | (CGEventMask(1) << CGEventType.keyDown.rawValue)
	: mouseOnlyMask
if !installListenOnlyTap(combinedMask) {
	if captureKeys, installListenOnlyTap(mouseOnlyMask) {
		fputs("Keyboard event tap unavailable; keystroke telemetry disabled\n", stderr)
		fflush(stderr)
	} else {
		fputs("Mouse interaction event tap unavailable; click telemetry disabled\n", stderr)
		fflush(stderr)
	}
}

var lastState = ""
func emitStateIfNeeded() {
	let state = currentSystemCursorType()
	if state != lastState {
		lastState = state
		print("STATE:\(state)")
		fflush(stdout)
	}
}

let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
timer.schedule(deadline: .now(), repeating: .milliseconds(50))
timer.setEventHandler {
	emitStateIfNeeded()
}
timer.resume()

DispatchQueue.global(qos: .utility).async {
	while let line = readLine(strippingNewline: true)?.lowercased() {
		if line == "stop" {
			exit(0)
		}
	}
	exit(0)
}

RunLoop.main.run()
