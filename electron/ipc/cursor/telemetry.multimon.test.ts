import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCursorScreenPoint, getPrimaryDisplay, getDisplayNearestPoint, getAllDisplays } =
	vi.hoisted(() => ({
		getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
		getPrimaryDisplay: vi.fn(() => ({ scaleFactor: 1 })),
		getDisplayNearestPoint: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1536, height: 864 } })),
		getAllDisplays: vi.fn(() => []),
	}));

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint,
		getPrimaryDisplay,
		getDisplayNearestPoint,
		getAllDisplays,
	})),
}));

import { setSelectedSource } from "../state";
import { getNormalizedCursorPoint } from "./telemetry";

// Regression tests for multi-monitor cursor normalization
// (https://github.com/webadderallorg/Recordly issues: pinned cursor / misplaced
// click zooms on Linux). The uiohook mousemove cache previously overrode
// Electron's cursor position with raw X-screen coordinates that live in the
// merged X screen space on multi-monitor X11/XWayland setups; subtracting
// per-display bounds from them clamped everything to the display edge.
describe("getNormalizedCursorPoint multi-monitor", () => {
	beforeEach(() => {
		setSelectedSource({ id: "screen:0", display_id: "1", name: "Screen 1" });
		getAllDisplays.mockReturnValue([
			{ id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 } },
			{ id: 2, bounds: { x: 1536, y: 0, width: 1536, height: 864 } },
		]);
	});

	it("normalizes a mid-display cursor to ~0.5", () => {
		getCursorScreenPoint.mockReturnValue({ x: 768, y: 432 });
		const point = getNormalizedCursorPoint();
		expect(point.cx).toBeCloseTo(0.5, 5);
		expect(point.cy).toBeCloseTo(0.5, 5);
	});

	it("normalizes within the selected display when the cursor is on a secondary display", () => {
		// Cursor at the center of the secondary display (DIP space).
		getCursorScreenPoint.mockReturnValue({ x: 2304, y: 216 });
		const point = getNormalizedCursorPoint();
		// The source display is display 1 (primary); the cursor is off it, so
		// the result must still be a valid clamped coordinate, not NaN/garbage.
		expect(Number.isFinite(point.cx)).toBe(true);
		expect(Number.isFinite(point.cy)).toBe(true);
		expect(point.cx).toBeGreaterThanOrEqual(0);
		expect(point.cx).toBeLessThanOrEqual(1);
		expect(point.cy).toBeGreaterThanOrEqual(0);
		expect(point.cy).toBeLessThanOrEqual(1);
	});

	it("tracks a moving cursor across the primary display", () => {
		getCursorScreenPoint.mockReturnValue({ x: 154, y: 86 });
		expect(getNormalizedCursorPoint().cx).toBeCloseTo(0.1, 3);

		getCursorScreenPoint.mockReturnValue({ x: 1382, y: 778 });
		const bottomRight = getNormalizedCursorPoint();
		expect(bottomRight.cx).toBeCloseTo(0.9, 3);
		expect(bottomRight.cy).toBeCloseTo(0.9, 3);
	});
});
