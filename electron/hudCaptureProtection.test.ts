import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
	getHudCaptureExcludedProcessIds,
	shouldProtectHudCapture,
	supportsHudCaptureProtection,
} from "../src/lib/hudCaptureProtection";

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
