import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import Foundation

let agentTag: Int64 = 0x52434459
let defaultDriftLimit = 8.0
let driftWindow: TimeInterval = 1

struct Failure: Error {
	let message: String
	init(_ message: String) { self.message = message }
}

final class SharedState {
	private let lock = NSLock()
	private var epoch = 0
	private var armedEpoch: Int?
	private var lastEmit: TimeInterval = 0
	private var drift = 0.0
	private var driftLimit = defaultDriftLimit
	private var driftStart: TimeInterval = 0
	var tap: CFMachPort?

	func currentEpoch() -> Int {
		lock.lock()
		defer { lock.unlock() }
		return epoch
	}

	func armedToken() -> Int? {
		lock.lock()
		defer { lock.unlock() }
		return armedEpoch == epoch ? epoch : nil
	}

	func isArmed() -> Bool {
		lock.lock()
		defer { lock.unlock() }
		return armedEpoch != nil
	}

	func setArmed(_ armed: Bool, tolerance: Double = defaultDriftLimit) {
		lock.lock()
		defer { lock.unlock() }
		if armed {
			driftLimit = tolerance
			armedEpoch = epoch
			drift = 0
			driftStart = ProcessInfo.processInfo.systemUptime
		} else {
			epoch += 1
			armedEpoch = nil
		}
	}

	func pointerMoved(dx: Double, dy: Double) {
		lock.lock()
		let now = ProcessInfo.processInfo.systemUptime
		if now - driftStart > driftWindow {
			drift = 0
			driftStart = now
		}
		drift += hypot(dx, dy)
		let tookOver = drift > driftLimit
		lock.unlock()
		if tookOver {
			userInput(kind: "move", escape: false)
		}
	}

	func userInput(kind: String, escape: Bool) {
		lock.lock()
		defer { lock.unlock() }
		guard armedEpoch != nil else { return }
		let firstAfterArm = armedEpoch == epoch
		epoch += 1
		let now = ProcessInfo.processInfo.systemUptime
		if firstAfterArm || escape || now - lastEmit >= 0.25 {
			lastEmit = now
			send(["event": "user-input", "kind": kind, "escape": escape])
		}
	}
}

final class HeldInput {
	private let lock = NSLock()
	private var held: [(id: Int, release: () -> Void)] = []
	private var nextId = 0
	private var stopped = false

	func press(_ down: () -> Void, release: @escaping () -> Void) throws -> Int {
		lock.lock()
		defer { lock.unlock() }
		guard !stopped else { throw Failure("Recordly's input helper is stopping") }
		down()
		nextId += 1
		held.append((nextId, release))
		return nextId
	}

	func release(_ id: Int) {
		lock.lock()
		defer { lock.unlock() }
		guard let index = held.firstIndex(where: { $0.id == id }) else { return }
		held.remove(at: index).release()
	}

	func releaseAll() {
		lock.lock()
		defer { lock.unlock() }
		stopped = true
		while let entry = held.popLast() {
			entry.release()
		}
	}
}

let state = SharedState()
let held = HeldInput()
let outputLock = NSLock()
let inputQueue = DispatchQueue(label: "recordly.agent-input.input")
let workQueue = DispatchQueue(label: "recordly.agent-input.work", attributes: .concurrent)

let eventSource: CGEventSource? = {
	let source = CGEventSource(stateID: .hidSystemState)
	source?.userData = agentTag
	source?.localEventsSuppressionInterval = 0
	source?.setLocalEventsFilterDuringSuppressionState(
		[.permitLocalMouseEvents, .permitLocalKeyboardEvents, .permitSystemDefinedEvents],
		state: .eventSuppressionStateSuppressionInterval
	)
	source?.setLocalEventsFilterDuringSuppressionState(
		[.permitLocalMouseEvents, .permitLocalKeyboardEvents, .permitSystemDefinedEvents],
		state: .eventSuppressionStateRemoteMouseDrag
	)
	return source
}()

func send(_ object: [String: Any]) {
	guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]) else {
		return
	}
	data.append(0x0A)
	outputLock.lock()
	defer { outputLock.unlock() }
	data.withUnsafeBytes { buffer in
		guard let base = buffer.baseAddress else { return }
		var offset = 0
		while offset < buffer.count {
			let written = write(STDOUT_FILENO, base + offset, buffer.count - offset)
			if written <= 0 {
				releaseAndExit()
			}
			offset += written
		}
	}
}

func number(_ request: [String: Any], _ key: String) throws -> Double {
	guard let value = (request[key] as? NSNumber)?.doubleValue, value.isFinite else {
		throw Failure("missing or invalid \(key)")
	}
	return value
}

func optionalNumber(_ request: [String: Any], _ key: String, _ fallback: Double) -> Double {
	guard let value = (request[key] as? NSNumber)?.doubleValue, value.isFinite else {
		return fallback
	}
	return value
}

func integer(_ request: [String: Any], _ key: String, _ fallback: Int, _ range: ClosedRange<Int>) throws -> Int {
	let value = optionalNumber(request, key, Double(fallback))
	guard value.rounded() == value, value >= Double(range.lowerBound), value <= Double(range.upperBound) else {
		throw Failure("\(key) must be a whole number from \(range.lowerBound) to \(range.upperBound)")
	}
	return Int(value)
}

func milliseconds(_ request: [String: Any], _ fallback: Double) -> Double {
	min(max(optionalNumber(request, "ms", fallback), 0), 600_000)
}

func point(_ request: [String: Any], _ xKey: String, _ yKey: String) throws -> CGPoint {
	CGPoint(x: try number(request, xKey), y: try number(request, yKey))
}

func frame(_ request: [String: Any]) throws -> CGRect {
	guard let raw = request["frame"] as? [String: Any] else {
		throw Failure("missing frame")
	}
	return CGRect(
		x: try number(raw, "x"),
		y: try number(raw, "y"),
		width: try number(raw, "width"),
		height: try number(raw, "height")
	)
}

func windowId(_ request: [String: Any]) -> CGWindowID? {
	guard let value = (request["windowId"] as? NSNumber)?.uint32Value, value > 0 else {
		return nil
	}
	return value
}

func pid(_ request: [String: Any]) throws -> pid_t {
	guard let value = request["pid"] as? NSNumber, value.int32Value > 0 else {
		throw Failure("missing or invalid pid")
	}
	return value.int32Value
}

func checkAbort(_ epoch: Int) throws {
	if state.currentEpoch() != epoch {
		throw Failure("user-input")
	}
}

func pause(until deadline: TimeInterval, epoch: Int) throws {
	while true {
		try checkAbort(epoch)
		let remaining = deadline - ProcessInfo.processInfo.systemUptime
		if remaining <= 0 {
			return
		}
		usleep(useconds_t(min(remaining, 0.01) * 1_000_000))
	}
}

func pause(ms: Double, epoch: Int) throws {
	try pause(until: ProcessInfo.processInfo.systemUptime + ms / 1000, epoch: epoch)
}

func ease(_ t: Double) -> Double {
	t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
}

let sourceModifierFlags: CGEventFlags = [
	.maskAlphaShift, .maskShift, .maskControl, .maskAlternate, .maskCommand, CGEventFlags(rawValue: 0xFFFF),
]

func post(_ event: CGEvent?, flags: CGEventFlags = []) {
	guard let event else { return }
	event.flags = event.flags.subtracting(sourceModifierFlags).union(flags)
	event.setIntegerValueField(.eventSourceUserData, value: agentTag)
	event.post(tap: .cghidEventTap)
}

func cursorLocation() -> CGPoint {
	CGEvent(source: nil)?.location ?? .zero
}

struct ModifierKey {
	let name: String
	let flag: CGEventFlags
	let code: CGKeyCode?
	let device: UInt64
}

let modifierKeys = [
	ModifierKey(name: "ctrl", flag: .maskControl, code: 59, device: 0x1),
	ModifierKey(name: "alt", flag: .maskAlternate, code: 58, device: 0x20),
	ModifierKey(name: "shift", flag: .maskShift, code: 56, device: 0x2),
	ModifierKey(name: "cmd", flag: .maskCommand, code: 55, device: 0x8),
	ModifierKey(name: "fn", flag: .maskSecondaryFn, code: nil, device: 0),
]

func modifierFlags(_ request: [String: Any]) throws -> CGEventFlags {
	var flags: CGEventFlags = []
	for name in request["modifiers"] as? [String] ?? [] {
		guard let key = modifierKeys.first(where: { $0.name == name }) else {
			throw Failure("unknown modifier: \(name). Use cmd, shift, alt, ctrl or fn")
		}
		flags.insert(key.flag)
	}
	return flags
}

func holdModifiers(_ flags: CGEventFlags, epoch: Int, _ body: (CGEventFlags) throws -> Void) throws {
	var current = flags.intersection(.maskSecondaryFn)
	var ids: [Int] = []
	defer { ids.reversed().forEach(held.release) }
	for key in modifierKeys where flags.contains(key.flag) {
		guard let code = key.code else { continue }
		try checkAbort(epoch)
		let before = current
		current.formUnion([key.flag, CGEventFlags(rawValue: key.device)])
		let after = current
		ids.append(try held.press(
			{ post(CGEvent(keyboardEventSource: eventSource, virtualKey: code, keyDown: true), flags: after) },
			release: { post(CGEvent(keyboardEventSource: eventSource, virtualKey: code, keyDown: false), flags: before) }
		))
	}
	if !ids.isEmpty {
		try pause(ms: 15, epoch: epoch)
	}
	try body(current)
	if !ids.isEmpty {
		usleep(15_000)
	}
}

struct MouseButton {
	let down: CGEventType
	let up: CGEventType
	let dragged: CGEventType
	let button: CGMouseButton
}

func mouseButton(_ request: [String: Any]) throws -> MouseButton {
	switch request["button"] as? String ?? "left" {
	case "left": return MouseButton(down: .leftMouseDown, up: .leftMouseUp, dragged: .leftMouseDragged, button: .left)
	case "right": return MouseButton(down: .rightMouseDown, up: .rightMouseUp, dragged: .rightMouseDragged, button: .right)
	case "middle": return MouseButton(down: .otherMouseDown, up: .otherMouseUp, dragged: .otherMouseDragged, button: .center)
	case let other: throw Failure("unknown button: \(other)")
	}
}

func mouseEvent(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton, clickState: Int64? = nil) -> CGEvent? {
	let event = CGEvent(mouseEventSource: eventSource, mouseType: type, mouseCursorPosition: point, mouseButton: button)
	if let clickState {
		event?.setIntegerValueField(.mouseEventClickState, value: clickState)
	}
	return event
}

func pressButton(_ button: MouseButton, at point: CGPoint, flags: CGEventFlags, clickState: Int64) throws -> Int {
	try held.press(
		{ post(mouseEvent(button.down, point, button.button, clickState: clickState), flags: flags) },
		release: { post(mouseEvent(button.up, cursorLocation(), button.button, clickState: clickState), flags: flags) }
	)
}

func glide(
	to target: CGPoint,
	ms: Double,
	epoch: Int,
	type: CGEventType = .mouseMoved,
	button: CGMouseButton = .left,
	flags: CGEventFlags = []
) throws {
	try checkAbort(epoch)
	let start = cursorLocation()
	let steps = ms > 0 ? max(1, Int((ms * 120 / 1000).rounded())) : 1
	let startTime = ProcessInfo.processInfo.systemUptime
	for step in 1...steps {
		try checkAbort(epoch)
		let progress = ease(Double(step) / Double(steps))
		let next = CGPoint(x: start.x + (target.x - start.x) * progress, y: start.y + (target.y - start.y) * progress)
		post(mouseEvent(type, next, button), flags: flags)
		try pause(until: startTime + ms / 1000 * Double(step) / Double(steps), epoch: epoch)
	}
}

func approach(_ target: CGPoint, epoch: Int) throws {
	let start = cursorLocation()
	if hypot(start.x - target.x, start.y - target.y) > 2 {
		try glide(to: target, ms: 300, epoch: epoch)
	}
}

func move(_ request: [String: Any]) throws -> (Int) throws -> Void {
	let target = try point(request, "x", "y")
	let ms = milliseconds(request, 0)
	return { epoch in try glide(to: target, ms: ms, epoch: epoch) }
}

func click(_ request: [String: Any]) throws -> (Int) throws -> Void {
	let target = try point(request, "x", "y")
	let button = try mouseButton(request)
	let modifiers = try modifierFlags(request)
	let count = try integer(request, "count", 1, 1...3)
	let ms = milliseconds(request, 0)
	return { epoch in
		try glide(to: target, ms: ms, epoch: epoch)
		try pause(ms: 250, epoch: epoch)
		try holdModifiers(modifiers, epoch: epoch) { flags in
			for clickState in 1...count {
				if clickState > 1 {
					try pause(ms: 90, epoch: epoch)
				}
				try checkAbort(epoch)
				let id = try pressButton(button, at: target, flags: flags, clickState: Int64(clickState))
				usleep(60_000)
				held.release(id)
			}
		}
	}
}

func drag(_ request: [String: Any]) throws -> (Int) throws -> Void {
	let from = try point(request, "fromX", "fromY")
	let to = try point(request, "toX", "toY")
	let button = try mouseButton(request)
	let modifiers = try modifierFlags(request)
	let ms = max(milliseconds(request, 0), 150)
	return { epoch in
		try approach(from, epoch: epoch)
		try holdModifiers(modifiers, epoch: epoch) { flags in
			try pause(ms: 50, epoch: epoch)
			let id = try pressButton(button, at: from, flags: flags, clickState: 1)
			defer { held.release(id) }
			try pause(ms: 120, epoch: epoch)
			try glide(to: to, ms: ms, epoch: epoch, type: button.dragged, button: button.button, flags: flags)
			try pause(ms: 120, epoch: epoch)
		}
	}
}

func scroll(_ request: [String: Any]) throws -> (Int) throws -> Void {
	let target = try point(request, "x", "y")
	let dy = min(max(optionalNumber(request, "dy", 0), -1_000_000), 1_000_000)
	let dx = min(max(optionalNumber(request, "dx", 0), -1_000_000), 1_000_000)
	let requested = milliseconds(request, 400)
	let ms = requested > 0 ? requested : 400
	let modifiers = try modifierFlags(request)
	return { epoch in
		try approach(target, epoch: epoch)
		try holdModifiers(modifiers, epoch: epoch) { flags in
			let steps = max(1, Int((ms / 16).rounded()))
			let startTime = ProcessInfo.processInfo.systemUptime
			var sentX = 0
			var sentY = 0
			for step in 1...steps {
				try checkAbort(epoch)
				let progress = ease(Double(step) / Double(steps))
				let wantY = Int((dy * progress).rounded())
				let wantX = Int((dx * progress).rounded())
				let stepY = wantY - sentY
				let stepX = wantX - sentX
				if stepY != 0 || stepX != 0 {
					let event = CGEvent(
						scrollWheelEvent2Source: eventSource,
						units: .pixel,
						wheelCount: 2,
						wheel1: Int32(clamping: -stepY),
						wheel2: Int32(clamping: -stepX),
						wheel3: 0
					)
					event?.location = target
					post(event, flags: flags)
					sentY = wantY
					sentX = wantX
				}
				try pause(until: startTime + ms / 1000 * Double(step) / Double(steps), epoch: epoch)
			}
		}
	}
}

func keyEvent(_ code: CGKeyCode, down: Bool, _ unicode: [UniChar]?) -> CGEvent? {
	let event = CGEvent(keyboardEventSource: eventSource, virtualKey: code, keyDown: down)
	if let unicode {
		event?.keyboardSetUnicodeString(stringLength: unicode.count, unicodeString: unicode)
	}
	return event
}

func tap(_ code: CGKeyCode, flags: CGEventFlags = [], unicode: [UniChar]? = nil) throws {
	let id = try held.press(
		{ post(keyEvent(code, down: true, unicode), flags: flags) },
		release: { post(keyEvent(code, down: false, unicode), flags: flags) }
	)
	usleep(8_000)
	held.release(id)
}

func utf16Chunks(_ character: Character) -> [[UniChar]] {
	var chunks: [[UniChar]] = [[]]
	for scalar in character.unicodeScalars {
		let units = Array(String(scalar).utf16)
		if chunks[chunks.count - 1].count + units.count > 20 {
			chunks.append([])
		}
		chunks[chunks.count - 1] += units
	}
	return chunks
}

func typeCharacter(_ character: Character) throws {
	switch character {
	case "\n", "\r", "\r\n":
		try tap(36)
	case "\t":
		try tap(48)
	default:
		for chunk in utf16Chunks(character) {
			try tap(0, unicode: chunk)
		}
	}
}

func typeText(_ request: [String: Any]) throws -> (Int) throws -> Void {
	guard let text = request["text"] as? String else {
		throw Failure("missing text")
	}
	let cps = optionalNumber(request, "cps", 15)
	let interval = 1 / (cps > 0 ? cps : 15)
	return { epoch in
		let start = ProcessInfo.processInfo.systemUptime
		for (index, character) in text.enumerated() {
			try pause(until: start + Double(index) * interval, epoch: epoch)
			try typeCharacter(character)
		}
	}
}

let namedKeyCodes: [String: CGKeyCode] = [
	"enter": 36, "tab": 48, "space": 49, "backspace": 51, "escape": 53, "delete": 117,
	"home": 115, "end": 119, "pageup": 116, "pagedown": 121,
	"left": 123, "right": 124, "down": 125, "up": 126,
	"f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
	"f9": 101, "f10": 109, "f11": 103, "f12": 111, "f13": 105, "f14": 107, "f15": 113,
	"f16": 106, "f17": 64, "f18": 79, "f19": 80, "f20": 90,
	"keypad0": 82, "keypad1": 83, "keypad2": 84, "keypad3": 85, "keypad4": 86,
	"keypad5": 87, "keypad6": 88, "keypad7": 89, "keypad8": 91, "keypad9": 92,
	"keypaddecimal": 65, "keypadmultiply": 67, "keypadplus": 69, "keypadclear": 71,
	"keypaddivide": 75, "keypadenter": 76, "keypadminus": 78, "keypadequals": 81,
]

let punctuationKeys: [String: String] = [
	"minus": "-", "equal": "=", "leftbracket": "[", "rightbracket": "]", "backslash": "\\",
	"semicolon": ";", "quote": "'", "comma": ",", "period": ".", "slash": "/", "grave": "`",
]

let keypadCodes = Set(namedKeyCodes.filter { $0.key.hasPrefix("keypad") }.values)

func carbonModifiers(_ flags: CGEventFlags) -> UInt32 {
	var state = 0
	if flags.contains(.maskCommand) { state |= cmdKey }
	if flags.contains(.maskShift) { state |= shiftKey }
	if flags.contains(.maskAlternate) { state |= optionKey }
	if flags.contains(.maskControl) { state |= controlKey }
	return UInt32(state >> 8) & 0xFF
}

typealias LayoutKey = (code: CGKeyCode, flags: CGEventFlags)

struct KeyboardLayout {
	let id: String
	let data: CFData
	let keyboardType: UInt32
	var characters: [String: LayoutKey] = [:]
	var commandCharacters: [String: LayoutKey] = [:]

	func translate(_ code: CGKeyCode, _ flags: CGEventFlags, deadKeys: Bool) -> String? {
		guard let bytes = CFDataGetBytePtr(data) else { return nil }
		var deadKeyState: UInt32 = 0
		var length = 0
		var characters = [UniChar](repeating: 0, count: 8)
		let status = UCKeyTranslate(
			UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self),
			code,
			UInt16(kUCKeyActionDown),
			carbonModifiers(flags),
			keyboardType,
			deadKeys ? 0 : OptionBits(1 << kUCKeyTranslateNoDeadKeysBit),
			&deadKeyState,
			characters.count,
			&length,
			&characters
		)
		guard status == noErr, length > 0, deadKeyState == 0 else { return nil }
		return String(utf16CodeUnits: characters, count: length)
	}

	func unicode(_ code: CGKeyCode, _ flags: CGEventFlags) -> [UniChar]? {
		translate(code, flags, deadKeys: false).map { Array($0.utf16) }
	}
}

var layoutCache: KeyboardLayout?

func layoutSource() -> (id: String, data: CFData)? {
	for copy in [TISCopyCurrentKeyboardLayoutInputSource, TISCopyCurrentASCIICapableKeyboardLayoutInputSource] {
		guard let source = copy()?.takeRetainedValue(),
			let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else {
			continue
		}
		let id = TISGetInputSourceProperty(source, kTISPropertyInputSourceID)
			.map { Unmanaged<CFString>.fromOpaque($0).takeUnretainedValue() as String } ?? ""
		return (id, Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue())
	}
	return nil
}

func currentLayout() throws -> KeyboardLayout {
	guard let source = layoutSource() else {
		throw Failure("keyboard layout unavailable")
	}
	if let layoutCache, layoutCache.id == source.id {
		return layoutCache
	}
	var layout = KeyboardLayout(id: source.id, data: source.data, keyboardType: UInt32(LMGetKbdType()))
	let combinations: [(flags: CGEventFlags, command: Bool)] = [
		([], false), (.maskShift, false), (.maskAlternate, false), ([.maskShift, .maskAlternate], false),
		(.maskCommand, true), ([.maskCommand, .maskShift], true),
	]
	for combination in combinations {
		for code in CGKeyCode(0)..<128 where !keypadCodes.contains(code) {
			guard let text = layout.translate(code, combination.flags, deadKeys: true),
				!text.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) else {
				continue
			}
			if combination.command {
				if layout.commandCharacters[text] == nil {
					layout.commandCharacters[text] = (code, combination.flags.subtracting(.maskCommand))
				}
			} else if layout.characters[text] == nil {
				layout.characters[text] = (code, combination.flags)
			}
		}
	}
	layoutCache = layout
	return layout
}

enum KeyStroke {
	case key(CGKeyCode, CGEventFlags, [UniChar]?)
	case text(Character)
}

func resolveKey(_ name: String, modifiers: CGEventFlags) throws -> KeyStroke {
	if let code = namedKeyCodes[name] {
		return .key(code, modifiers, (try? currentLayout())?.unicode(code, modifiers))
	}
	let character = punctuationKeys[name] ?? name
	guard character.count == 1, let single = character.first else {
		throw Failure(
			"unknown key: \(name). Use a key name such as enter, tab, escape, backspace, delete, up, " +
				"pagedown or f5, or one character such as a, ? or é. To enter text, use type_text"
		)
	}
	let layout = try currentLayout()
	let command = modifiers.contains(.maskCommand) ? layout.commandCharacters[character] : nil
	guard let entry = command ?? layout.characters[character] else {
		if modifiers.isEmpty {
			return .text(single)
		}
		throw Failure(
			"\(character) is not a single key on the current keyboard layout (\(layout.id)), so it cannot " +
				"be pressed with modifiers. Press it without modifiers, or use type_text"
		)
	}
	let flags = modifiers.union(entry.flags)
	return .key(entry.code, flags, layout.unicode(entry.code, flags))
}

func key(_ request: [String: Any]) throws -> (Int) throws -> Void {
	guard let name = request["key"] as? String, !name.isEmpty else {
		throw Failure("missing key")
	}
	let modifiers = try modifierFlags(request)
	let count = try integer(request, "repeat", 1, 1...100)
	let stroke = try DispatchQueue.main.sync { try resolveKey(name, modifiers: modifiers) }
	let holdFlags: CGEventFlags
	if case let .key(_, flags, _) = stroke {
		holdFlags = flags
	} else {
		holdFlags = []
	}
	return { epoch in
		try holdModifiers(holdFlags, epoch: epoch) { flags in
			let start = ProcessInfo.processInfo.systemUptime
			for index in 0..<count {
				try pause(until: start + Double(index) * 0.035, epoch: epoch)
				switch stroke {
				case let .key(code, _, unicode): try tap(code, flags: flags, unicode: unicode)
				case let .text(character): try typeCharacter(character)
				}
			}
		}
	}
}

let tapCallback: CGEventTapCallBack = { _, type, event, _ in
	if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
		if type == .tapDisabledByTimeout, state.isArmed(), let tap = state.tap {
			CGEvent.tapEnable(tap: tap, enable: true)
		}
		return Unmanaged.passUnretained(event)
	}
	if event.getIntegerValueField(.eventSourceUserData) == agentTag {
		return Unmanaged.passUnretained(event)
	}
	switch type {
	case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
		state.pointerMoved(
			dx: Double(event.getIntegerValueField(.mouseEventDeltaX)),
			dy: Double(event.getIntegerValueField(.mouseEventDeltaY))
		)
	case .keyDown, .flagsChanged:
		state.userInput(kind: "key", escape: type == .keyDown && event.getIntegerValueField(.keyboardEventKeycode) == 53)
	case .scrollWheel:
		let scrolled = event.getIntegerValueField(.scrollWheelEventPointDeltaAxis1) != 0
			|| event.getIntegerValueField(.scrollWheelEventPointDeltaAxis2) != 0
		if scrolled, event.getIntegerValueField(.scrollWheelEventMomentumPhase) == 0 {
			state.userInput(kind: "scroll", escape: false)
		}
	default:
		state.userInput(kind: "button", escape: false)
	}
	return Unmanaged.passUnretained(event)
}

func eventMask(_ types: [CGEventType]) -> CGEventMask {
	types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
}

func arm(_ request: [String: Any]) throws {
	let tolerance = (request["tolerancePx"] as? NSNumber)?.doubleValue ?? defaultDriftLimit
	if let tap = state.tap {
		CGEvent.tapEnable(tap: tap, enable: true)
		state.setArmed(true, tolerance: tolerance)
		return
	}
	let mouseTypes: [CGEventType] = [
		.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged,
		.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp,
		.scrollWheel,
	]
	let masks = [eventMask(mouseTypes + [.keyDown, .flagsChanged]), eventMask(mouseTypes)]
	for mask in masks {
		guard let tap = CGEvent.tapCreate(
			tap: .cgSessionEventTap,
			place: .headInsertEventTap,
			options: .listenOnly,
			eventsOfInterest: mask,
			callback: tapCallback,
			userInfo: nil
		), let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
			continue
		}
		CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
		CGEvent.tapEnable(tap: tap, enable: true)
		state.tap = tap
		state.setArmed(true, tolerance: tolerance)
		return
	}
	throw Failure("event tap unavailable")
}

func disarm() {
	state.setArmed(false)
	if let tap = state.tap {
		CGEvent.tapEnable(tap: tap, enable: false)
	}
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
	var value: AnyObject?
	guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
		return nil
	}
	return value
}

func rect(position: AnyObject?, size: AnyObject?) -> CGRect? {
	guard let position, let size,
		CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else {
		return nil
	}
	var point = CGPoint.zero
	var extent = CGSize.zero
	guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
		AXValueGetValue(size as! AXValue, .cgSize, &extent),
		point.x.isFinite, point.y.isFinite, extent.width.isFinite, extent.height.isFinite else {
		return nil
	}
	return CGRect(origin: point, size: extent)
}

func windowFrame(_ window: AXUIElement) -> CGRect? {
	rect(position: attribute(window, kAXPositionAttribute), size: attribute(window, kAXSizeAttribute))
}

func appWindows(_ app: AXUIElement) -> [AXUIElement] {
	attribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? []
}

@_silgen_name("_AXUIElementGetWindow")
func axWindowNumber(_ element: AXUIElement, _ windowId: UnsafeMutablePointer<CGWindowID>) -> AXError

func isWindow(_ window: AXUIElement, id: CGWindowID?, frame: CGRect) -> Bool {
	var actualId: CGWindowID = 0
	if let id, axWindowNumber(window, &actualId) == .success {
		return actualId == id
	}
	guard let actual = windowFrame(window) else { return false }
	return abs(actual.minX - frame.minX) <= 4 && abs(actual.minY - frame.minY) <= 4
		&& abs(actual.width - frame.width) <= 4 && abs(actual.height - frame.height) <= 4
}

func matchWindow(_ app: AXUIElement, id: CGWindowID?, frame: CGRect, seconds: Double = 0) -> AXUIElement? {
	let deadline = ProcessInfo.processInfo.systemUptime + seconds
	while true {
		if let window = appWindows(app).first(where: { isWindow($0, id: id, frame: frame) }) {
			return window
		}
		if ProcessInfo.processInfo.systemUptime >= deadline {
			return nil
		}
		usleep(100_000)
	}
}

func raise(_ request: [String: Any]) throws -> [String: Any] {
	let pid = try pid(request)
	let target = try frame(request)
	guard let running = NSRunningApplication(processIdentifier: pid) else {
		throw Failure("process \(pid) is not running")
	}
	running.activate(options: [])
	let app = AXUIElementCreateApplication(pid)
	AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
	guard let window = matchWindow(app, id: windowId(request), frame: target, seconds: 1) else {
		return ["raised": false]
	}
	if (attribute(window, kAXMinimizedAttribute) as? Bool) == true {
		AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
	}
	let raised = AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success
	AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
	return ["raised": raised]
}

func axValue(_ type: AXValueType, _ value: UnsafeRawPointer) -> AXValue? {
	AXValueCreate(type, value)
}

// Moves and resizes one window through AX. Position is written twice around the size because a
// window that grows past the edge of its display is clamped back, and the second write corrects it.
func setBounds(_ request: [String: Any]) throws -> [String: Any] {
	let pid = try pid(request)
	let current = try frame(request)
	guard let raw = request["bounds"] as? [String: Any] else {
		throw Failure("missing bounds")
	}
	var origin = CGPoint(x: try number(raw, "x"), y: try number(raw, "y"))
	var extent = CGSize(width: try number(raw, "width"), height: try number(raw, "height"))
	guard extent.width >= 1, extent.height >= 1 else {
		throw Failure("width and height must be at least 1")
	}
	guard NSRunningApplication(processIdentifier: pid) != nil else {
		throw Failure("process \(pid) is not running")
	}
	guard let window = matchWindow(AXUIElementCreateApplication(pid), id: windowId(request), frame: current, seconds: 1),
		let position = axValue(.cgPoint, &origin), let size = axValue(.cgSize, &extent) else {
		throw Failure("the window could not be found")
	}
	if (attribute(window, kAXMinimizedAttribute) as? Bool) == true {
		AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
	}
	let moved = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, position)
	let resized = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, size)
	AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, position)
	guard moved == .success || resized == .success else {
		if (attribute(window, "AXFullScreen") as? Bool) == true {
			throw Failure("this window is full screen, so it cannot be moved or resized. Leave full screen first")
		}
		throw Failure("the app refused to move or resize this window (AX error \(moved.rawValue))")
	}
	guard let actual = windowFrame(window) else { return [:] }
	return ["frame": ["x": actual.minX, "y": actual.minY, "width": actual.width, "height": actual.height]]
}

func frontmostWindow() -> [String: Any] {
	guard let front = DispatchQueue.main.sync(execute: { NSWorkspace.shared.frontmostApplication }) else {
		return ["window": NSNull()]
	}
	let pid = front.processIdentifier
	let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
		as? [[String: Any]] ?? []
	for info in list {
		guard (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
			(info[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
			let bounds = info[kCGWindowBounds as String] as? NSDictionary,
			let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
			frame.width >= 50, frame.height >= 50 else {
			continue
		}
		let number = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0
		var title = info[kCGWindowName as String] as? String ?? ""
		if title.isEmpty,
			let window = matchWindow(AXUIElementCreateApplication(pid), id: number > 0 ? number : nil, frame: frame) {
			title = attribute(window, kAXTitleAttribute) as? String ?? ""
		}
		return [
			"window": [
				"pid": Int(pid),
				"windowId": Int(number),
				"title": title,
				"appName": front.localizedName ?? info[kCGWindowOwnerName as String] as? String ?? "",
				"bundleId": front.bundleIdentifier ?? NSNull(),
				"x": frame.minX,
				"y": frame.minY,
				"width": frame.width,
				"height": frame.height,
			] as [String: Any],
		]
	}
	return ["window": NSNull()]
}

let roleAliases: [String: Set<String>] = [
	"button": ["AXButton", "AXMenuButton"],
	"link": ["AXLink"],
	"textbox": ["AXTextField", "AXTextArea", "AXComboBox"],
	"textfield": ["AXTextField", "AXTextArea", "AXComboBox"],
	"checkbox": ["AXCheckBox"],
	"radio": ["AXRadioButton"],
	"tab": ["AXTabButton"],
	"menuitem": ["AXMenuItem", "AXMenuBarItem"],
	"text": ["AXStaticText"],
	"statictext": ["AXStaticText"],
	"heading": ["AXHeading"],
	"image": ["AXImage"],
]

let actionableRoles: Set<String> = [
	"AXButton", "AXMenuButton", "AXLink", "AXTextField", "AXTextArea", "AXComboBox", "AXCheckBox",
	"AXRadioButton", "AXTabButton", "AXMenuItem", "AXPopUpButton",
]

let findAttributes = [
	"AXRole", "AXSubrole", "AXTitle", "AXDescription", "AXValue", "AXHelp", "AXPlaceholderValue",
	"AXPosition", "AXSize", "AXChildren",
] as CFArray

let enhancedLock = NSLock()
var enhancedApps: Set<pid_t> = []
var activeFinds = 0
var restoreGeneration = 0
let enhancedIdle: TimeInterval = 60

func restoreEnhanced() {
	for pid in enhancedApps {
		AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXEnhancedUserInterface" as CFString, kCFBooleanFalse)
	}
	enhancedApps.removeAll()
}

func finishFind() {
	enhancedLock.withLock {
		activeFinds -= 1
		guard !enhancedApps.isEmpty else { return }
		restoreGeneration += 1
		let generation = restoreGeneration
		DispatchQueue.global().asyncAfter(deadline: .now() + enhancedIdle) {
			enhancedLock.withLock {
				if generation == restoreGeneration && activeFinds == 0 {
					restoreEnhanced()
				}
			}
		}
	}
}

func isChromium(_ window: AXUIElement) -> Bool {
	(attribute(window, kAXChildrenAttribute) as? [AXUIElement])?.contains { attribute($0, "ChromeAXNodeId") != nil } == true
}

func hasWebContent(_ element: AXUIElement, depth: Int = 0) -> Bool {
	let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
	if (attribute(element, kAXRoleAttribute) as? String) == "AXWebArea" {
		return !children.isEmpty
	}
	return depth < 20 && children.contains { hasWebContent($0, depth: depth + 1) }
}

func usable(_ value: AnyObject) -> AnyObject? {
	if CFGetTypeID(value) == AXValueGetTypeID(), AXValueGetType(value as! AXValue) == .axError {
		return nil
	}
	return value
}

func walk(_ window: AXUIElement, roles: Set<String>?, text: String, bounds: CGRect, offscreen: Bool) -> (matches: [(path: [Int], element: [String: Any])], exhausted: Bool) {
	let deadline = ProcessInfo.processInfo.systemUptime + 1.5
	var queue: [(element: AXUIElement, depth: Int, path: [Int], clip: CGRect?, web: Bool)] = [(window, 0, [], nil, false)]
	var head = 0
	var matches: [(path: [Int], element: [String: Any])] = []
	while head < queue.count {
		if head >= 20_000 || ProcessInfo.processInfo.systemUptime > deadline {
			return (matches, true)
		}
		let node = queue[head]
		head += 1
		var raw: CFArray?
		guard AXUIElementCopyMultipleAttributeValues(node.element, findAttributes, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success,
			let values = raw as? [AnyObject], values.count == 10 else {
			continue
		}
		let field = values.map(usable)
		let role = field[0] as? String ?? ""
		let subrole = field[1] as? String ?? ""
		let box = rect(position: field[7], size: field[8])
		if node.depth < 100, let children = field[9] as? [AXUIElement] {
			var clip = node.clip
			if role == "AXScrollArea" || role == "AXWebArea", let box {
				clip = clip?.intersection(box) ?? box
			}
			let web = node.web || role == "AXWebArea"
			for (index, child) in children.enumerated() {
				queue.append((child, node.depth + 1, node.path + [index], clip, web))
			}
		}
		if let roles, !roles.contains(role) && !roles.contains(subrole) {
			continue
		}
		let labels = [field[2], field[3], field[4], field[5], field[6]]
			.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
		let label = labels.first ?? ""
		if !text.isEmpty && !labels.contains(where: { $0.lowercased().contains(text) }) {
			continue
		}
		guard let box, !box.contains(bounds) else {
			continue
		}
		let centre = CGPoint(x: box.midX, y: box.midY)
		let visible = box.width > 1 && box.height > 1 && bounds.contains(centre) && node.clip?.contains(centre) != false
		guard visible || offscreen && max(box.width, box.height) > 1 else {
			continue
		}
		var element: [String: Any] = [
			"role": role,
			"label": String(label.prefix(200)),
			"x": box.minX,
			"y": box.minY,
			"width": box.width,
			"height": box.height,
		]
		if node.web {
			element["web"] = true
		}
		if !visible {
			element["visible"] = false
			if let clip = node.clip, !clip.isEmpty {
				element["container"] = ["x": clip.minX, "y": clip.minY, "width": clip.width, "height": clip.height]
			}
		}
		matches.append((node.path, element))
	}
	return (matches, false)
}

func describe(_ element: AXUIElement) -> [String: Any]? {
	var raw: CFArray?
	guard AXUIElementCopyMultipleAttributeValues(element, findAttributes, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success,
		let values = raw as? [AnyObject], values.count == 10 else {
		return nil
	}
	let field = values.map(usable)
	guard let box = rect(position: field[7], size: field[8]) else {
		return nil
	}
	let label = [field[2], field[3], field[4], field[5], field[6]]
		.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
		.first { !$0.isEmpty } ?? ""
	return [
		"role": field[0] as? String ?? "",
		"label": String(label.prefix(200)),
		"x": box.minX,
		"y": box.minY,
		"width": box.width,
		"height": box.height,
	]
}

func axParent(_ element: AXUIElement) -> AXUIElement? {
	guard let value = attribute(element, kAXParentAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else {
		return nil
	}
	return (value as! AXUIElement)
}

func elementAt(_ request: [String: Any]) throws -> [String: Any] {
	let pid = try pid(request)
	let spot = try point(request, "x", "y")
	guard AXIsProcessTrusted() else {
		throw Failure("accessibility permission is not granted")
	}
	var found: AXUIElement?
	let app = AXUIElementCreateApplication(pid)
	guard AXUIElementCopyElementAtPosition(app, Float(spot.x), Float(spot.y), &found) == .success,
		let hit = found else {
		return ["hit": NSNull(), "parent": NSNull()]
	}
	let parent = axParent(hit).flatMap(describe)
	return ["hit": describe(hit) ?? NSNull(), "parent": parent ?? NSNull()]
}

func find(_ request: [String: Any]) throws -> [String: Any] {
	let pid = try pid(request)
	let bounds = try frame(request)
	let limit = max(1, Int(optionalNumber(request, "limit", 50)))
	let text = (request["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
	let roleQuery = (request["role"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
	let roles: Set<String>?
	if roleQuery.isEmpty {
		roles = text.isEmpty ? actionableRoles : nil
	} else if roleQuery.hasPrefix("AX") {
		roles = [roleQuery]
	} else if let alias = roleAliases[roleQuery.lowercased()] {
		roles = alias
	} else {
		throw Failure("unknown role: \(roleQuery)")
	}

	guard AXIsProcessTrusted() else {
		throw Failure("accessibility permission is not granted")
	}
	enhancedLock.withLock { activeFinds += 1 }
	defer { finishFind() }
	let app = AXUIElementCreateApplication(pid)
	let wasManual = (attribute(app, "AXManualAccessibility") as? Bool) == true
	var justEnabled = !wasManual
		&& AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue) == .success
	guard let window = matchWindow(app, id: windowId(request), frame: bounds, seconds: 1) else {
		throw Failure("window not found in process \(pid)")
	}
	if !wasManual && !justEnabled && (attribute(app, "AXEnhancedUserInterface") as? Bool) == false && isChromium(window) {
		justEnabled = enhancedLock.withLock {
			enhancedApps.insert(pid)
			AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
			return (attribute(app, "AXEnhancedUserInterface") as? Bool) == true
		}
	}
	if justEnabled {
		let deadline = ProcessInfo.processInfo.systemUptime + 3
		while !hasWebContent(window) && ProcessInfo.processInfo.systemUptime < deadline {
			usleep(100_000)
		}
	}
	let (found, exhausted) = walk(window, roles: roles, text: text, bounds: bounds, offscreen: request["offscreen"] as? Bool == true)
	let matches = found.sorted { $0.path.lexicographicallyPrecedes($1.path) }
	return [
		"elements": matches.prefix(limit).map(\.element),
		"truncated": exhausted || matches.count > limit,
	]
}

func respond(_ id: Any, _ body: () throws -> [String: Any]) {
	do {
		var result = try body()
		result["id"] = id
		result["ok"] = true
		send(result)
	} catch let failure as Failure {
		send(["id": id, "ok": false, "error": failure.message])
	} catch {
		send(["id": id, "ok": false, "error": String(describing: error)])
	}
}

func runInput(_ id: Any, _ prepare: @escaping () throws -> (Int) throws -> Void) {
	inputQueue.async {
		respond(id) {
			let action = try prepare()
			guard let epoch = state.armedToken() else {
				throw Failure("user-input")
			}
			try action(epoch)
			return [:]
		}
	}
}

func releaseAndExit() -> Never {
	held.releaseAll()
	enhancedLock.lock()
	restoreEnhanced()
	exit(0)
}

func handle(_ line: String) {
	guard let data = line.data(using: .utf8),
		let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
		send(["id": NSNull(), "ok": false, "error": "invalid request"])
		return
	}
	let id: Any = request["id"] as? NSNumber ?? NSNull()
	let command = request["cmd"] as? String ?? ""
	switch command {
	case "move":
		runInput(id) { try move(request) }
	case "click":
		runInput(id) { try click(request) }
	case "drag":
		runInput(id) { try drag(request) }
	case "scroll":
		runInput(id) { try scroll(request) }
	case "type":
		runInput(id) { try typeText(request) }
	case "key":
		runInput(id) { try key(request) }
	case "arm":
		DispatchQueue.main.sync { respond(id) { try arm(request); return [:] } }
	case "disarm":
		DispatchQueue.main.sync { respond(id) { disarm(); return [:] } }
	case "frontmost_window":
		workQueue.async { respond(id) { frontmostWindow() } }
	case "preflight":
		respond(id) { ["postEvents": CGPreflightPostEventAccess(), "accessibility": AXIsProcessTrusted()] }
	case "cursor":
		respond(id) {
			let point = cursorLocation()
			return ["x": point.x, "y": point.y]
		}
	case "raise":
		workQueue.async { respond(id) { try raise(request) } }
	case "set_bounds":
		workQueue.async { respond(id) { try setBounds(request) } }
	case "find":
		workQueue.async { respond(id) { try find(request) } }
	case "at":
		workQueue.async { respond(id) { try elementAt(request) } }
	default:
		send(["id": id, "ok": false, "error": "unknown command: \(command)"])
	}
}

signal(SIGPIPE, SIG_IGN)
AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.5)

let signalSources = [SIGTERM, SIGINT, SIGHUP].map { signalNumber -> DispatchSourceSignal in
	signal(signalNumber, SIG_IGN)
	let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .global())
	source.setEventHandler { releaseAndExit() }
	source.resume()
	return source
}

Thread {
	while let line = readLine(strippingNewline: true) {
		if !line.trimmingCharacters(in: .whitespaces).isEmpty {
			handle(line)
		}
	}
	releaseAndExit()
}.start()

RunLoop.main.add(Timer(timeInterval: 86400, repeats: true) { _ in }, forMode: .common)
RunLoop.main.run()
