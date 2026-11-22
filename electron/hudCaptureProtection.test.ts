import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
	getHudCaptureExcludedProcessIds,
	shouldProtectHudCapture,
	supportsHudCaptureProtection,
} from "../src/lib/hudCaptureProtection";
import { getHudOverlayWindowBounds, shouldExpandHudOverlayFallback } from "./hudOverlayBounds";
import { supportsX11HudWindowDrag } from "./hudOverlayWindowOptions";

describe("HUD capture protection lifecycle", () => {
	it("uses window protection on Windows and macOS only", () => {
		expect(supportsHudCaptureProtection("win32")).toBe(true);
		expect(supportsHudCaptureProtection("darwin")).toBe(true);
		expect(supportsHudCaptureProtection("linux")).toBe(false);
	});

	it("only builds a macOS process exclusion when protection is enabled", () => {
		expect(getHudCaptureExcludedProcessIds("darwin", true, 734)).toEqual([734]);
		expect(getHudCaptureExcludedProcessIds("darwin", false, 734)).toEqual([]);
		expect(getHudCaptureExcludedProcessIds("win32", true, 734)).toEqual([]);
		expect(getHudCaptureExcludedProcessIds("linux", true, 734)).toEqual([]);
	});
});

it("protects initial capture frames while keeping idle and failed starts visible", () => {
	expect(shouldProtectHudCapture(true, false, false)).toBe(false);
	expect(shouldProtectHudCapture(true, false, true)).toBe(true);
	expect(shouldProtectHudCapture(true, true, false)).toBe(true);
	expect(shouldProtectHudCapture(true, false, false)).toBe(false);
	expect(shouldProtectHudCapture(false, true, true)).toBe(false);
});

it("restores the latest requested HUD mouse state when source selection ends", () => {
	// Run the actual main-process setters and IPC listeners without opening native windows.
	const source = readFileSync(new URL("./windows.ts", import.meta.url), "utf8");
	const setters = source.slice(
		source.indexOf("function setHudOverlayMousePassthrough("),
		source.indexOf("// Keep compatibility with existing drag IPC/state."),
	);
	const listeners = new Map<string, (_event: unknown, value: boolean) => void>();
	const mouse = vi.fn();
	const context = {
		hudOverlayIgnoringMouse: true,
		hudOverlaySourceSelectionActive: false,
		hudOverlayRecordingActive: false,
		hudOverlayMouseReassertTimer: null,
		hudOverlayWindow: { isDestroyed: () => false, setIgnoreMouseEvents: mouse },
		isHudOverlayMousePassthroughSupported: () => true,
		applyHudOverlayBounds: vi.fn(),
		setHudOverlayFallbackExpanded: vi.fn(),
		ipcMain: {
			on: (channel: string, listener: (_event: unknown, value: boolean) => void) =>
				listeners.set(channel, listener),
		},
	};
	runInNewContext(ts.transpileModule(setters, {}).outputText, context);
	const request = (ignore: boolean) =>
		listeners.get("hud-overlay-set-ignore-mouse")!(null, ignore);
	const select = (active: boolean) =>
		listeners.get("hud-overlay-set-source-selection-active")!(null, active);
	request(false);
	expect(mouse).toHaveBeenLastCalledWith(false);
	select(true);
	expect(mouse).toHaveBeenLastCalledWith(true, { forward: true });
	select(false);
	expect(mouse).toHaveBeenLastCalledWith(false);
	// Pointer changes during selection supersede the earlier state without disabling passthrough.
	select(true);
	request(true);
	select(false);
	expect(mouse).toHaveBeenLastCalledWith(true, { forward: true });
	select(true);
	request(false);
	expect(mouse).toHaveBeenLastCalledWith(true, { forward: true });
	select(false);
	expect(mouse).toHaveBeenLastCalledWith(false);
	// Repeated/cancelled selection notifications do not replace the saved request.
	select(true);
	select(true);
	select(false);
	expect(mouse).toHaveBeenLastCalledWith(false);
});

it("keeps the hovered HUD interactive across the work area when recording starts", () => {
	const source = readFileSync(new URL("./windows.ts", import.meta.url), "utf8");
	const bounds = source.slice(
		source.indexOf("function getHudOverlayBounds("),
		source.indexOf("function getUpdateToastBounds("),
	);
	const passthrough = source.slice(
		source.indexOf("function setHudOverlayMousePassthrough("),
		source.indexOf('ipcMain.on("hud-overlay-set-ignore-mouse"'),
	);
	const recordingActive = source.slice(
		source.indexOf("export function setHudOverlayRecordingActive("),
		source.indexOf("export function createUpdateToastWindow("),
	);
	const mouse = vi.fn();
	const setBounds = vi.fn();
	const workArea = { x: 1920, y: 24, width: 1536, height: 816 };
	const context: Record<string, unknown> = {
		hudOverlayIgnoringMouse: true,
		hudOverlaySourceSelectionActive: false,
		hudOverlayRecordingActive: false,
		hudOverlayFallbackExpanded: false,
		hudOverlayWebcamPreviewVisible: false,
		hudCaptureStarting: true,
		hudOverlayMouseReassertTimer: null,
		hudOverlayWindow: {
			isDestroyed: () => false,
			isVisible: () => false,
			setBounds,
			setIgnoreMouseEvents: mouse,
		},
		isHudOverlayMousePassthroughSupported: () => true,
		getHudOverlayDisplay: () => ({ workArea }),
		getHudOverlayWindowBounds,
		x11HudDraggedBounds: undefined,
		x11HudRecordingShapeKey: "",
		positionUpdateToastWindow: vi.fn(),
		shouldExpandHudOverlayFallback,
		setHudOverlayFallbackExpanded: vi.fn(),
		notifyEditorMode: vi.fn(),
		reassertHudOverlayCaptureProtection: vi.fn(),
	};
	runInNewContext(
		`${ts.transpileModule(`${bounds}\n${passthrough}\n${recordingActive.replace("export ", "")}`, {}).outputText}
		this.setHudOverlayMousePassthrough = setHudOverlayMousePassthrough;
		this.setHudOverlayRecordingActive = setHudOverlayRecordingActive;`,
		context,
	);
	const setPassthrough = context.setHudOverlayMousePassthrough as (ignore: boolean) => void;
	const setRecording = context.setHudOverlayRecordingActive as (recording: boolean) => void;

	// The pointer rests on the record button, so the renderer has made the HUD interactive.
	setPassthrough(false);
	setRecording(true);
	expect(setBounds).toHaveBeenLastCalledWith(workArea, false);
	expect(mouse).toHaveBeenLastCalledWith(false);

	// A pointer away from the HUD still leaves the recorded app clickable.
	setPassthrough(true);
	setRecording(false);
	expect(mouse).toHaveBeenLastCalledWith(true, { forward: true });
});

it.each([
	{ session: "X11", env: { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" }, resize: [true, false] },
	{
		session: "Wayland with XWayland",
		env: { DISPLAY: ":0", XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
		resize: [],
	},
	{ session: "no display", env: {}, resize: [] },
])("resizes only for an open HUD menu on $session", ({ env, resize }) => {
	const source = readFileSync(new URL("./windows.ts", import.meta.url), "utf8");
	const setters = source.slice(
		source.indexOf("function setHudOverlayMousePassthrough("),
		source.indexOf("// Keep compatibility with existing drag IPC/state."),
	);
	const sender = {};
	type Handler = (event: { sender: object }, value: boolean) => void;
	const handlers = new Map<string, Handler>();
	const changes: boolean[] = [];
	const context = {
		process: { platform: "linux", env },
		app: { commandLine: { getSwitchValue: () => "" } },
		supportsX11HudWindowDrag,
		hudOverlayIgnoringMouse: true,
		hudOverlaySourceSelectionActive: false,
		hudOverlayRecordingActive: false,
		hudOverlayFallbackExpanded: false,
		hudOverlayMouseReassertTimer: null,
		hudOverlayWindow: {
			webContents: sender,
			isDestroyed: () => false,
			setIgnoreMouseEvents: vi.fn(),
		},
		isHudOverlayMousePassthroughSupported: () => false,
		setHudOverlayFallbackExpanded(expanded: boolean) {
			context.hudOverlayFallbackExpanded = expanded;
			changes.push(expanded);
		},
		ipcMain: { on: (channel: string, handler: Handler) => handlers.set(channel, handler) },
	};
	runInNewContext(ts.transpileModule(setters, {}).outputText, context);
	handlers.get("hud-overlay-set-ignore-mouse")!({ sender }, false);
	expect(changes).toEqual([]);

	const menu = handlers.get("hud-overlay-set-popover-open")!;
	menu({ sender: {} }, true);
	context.hudOverlayRecordingActive = true;
	menu({ sender }, true);
	context.hudOverlayRecordingActive = false;
	context.hudOverlaySourceSelectionActive = true;
	menu({ sender }, true);
	context.hudOverlaySourceSelectionActive = false;
	expect(changes).toEqual([]);

	menu({ sender }, true);
	menu({ sender }, true);
	handlers.get("hud-overlay-set-ignore-mouse")!({ sender }, true);
	menu({ sender }, false);
	expect(changes).toEqual(resize);
});
