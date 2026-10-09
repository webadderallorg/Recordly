import { describe, expect, it } from "vitest";

import {
	getHudOverlayCornerBounds,
	getHudOverlayWindowBounds,
	resizeHudOverlayFallbackBounds,
	resolveHudOverlayIgnoreMouse,
	shouldExpandHudOverlayFallback,
} from "./hudOverlayBounds";

describe("getHudOverlayWindowBounds", () => {
	const workArea = {
		x: 120,
		y: 40,
		width: 1920,
		height: 1040,
	};

	it("uses the full work area when mouse passthrough is supported", () => {
		expect(getHudOverlayWindowBounds(workArea, true)).toEqual(workArea);
	});

	it("uses a bottom-centered compact fallback when mouse passthrough is unavailable", () => {
		expect(getHudOverlayWindowBounds(workArea, false)).toEqual({
			x: 650,
			y: 920,
			width: 860,
			height: 160,
		});
	});

	it("expands the non-passthrough fallback for HUD menus and hover interaction", () => {
		expect(getHudOverlayWindowBounds(workArea, false, true)).toEqual({
			x: 650,
			y: 540,
			width: 860,
			height: 540,
		});
	});

	it("keeps the compact fallback inside small displays", () => {
		expect(
			getHudOverlayWindowBounds(
				{
					x: -100,
					y: 20,
					width: 640,
					height: 420,
				},
				false,
			),
		).toEqual({
			x: -100,
			y: 280,
			width: 640,
			height: 160,
		});
	});

	it("fits the expanded fallback inside small displays", () => {
		expect(
			getHudOverlayWindowBounds(
				{
					x: -100,
					y: 20,
					width: 640,
					height: 420,
				},
				false,
				true,
			),
		).toEqual({
			x: -100,
			y: 20,
			width: 640,
			height: 420,
		});
	});
});

describe("resizeHudOverlayFallbackBounds", () => {
	const workArea = {
		x: 0,
		y: 0,
		width: 1920,
		height: 1080,
	};

	it("preserves the dragged bottom edge when expanding", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 420,
					y: 700,
					width: 860,
					height: 160,
				},
				true,
			),
		).toEqual({
			x: 420,
			y: 320,
			width: 860,
			height: 540,
		});
	});

	it("preserves the dragged bottom edge when compacting", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 420,
					y: 320,
					width: 860,
					height: 540,
				},
				false,
			),
		).toEqual({
			x: 420,
			y: 700,
			width: 860,
			height: 160,
		});
	});

	it("keeps resized fallback bounds inside the display work area", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 1500,
					y: 900,
					width: 860,
					height: 160,
				},
				true,
			),
		).toEqual({
			x: 1060,
			y: 520,
			width: 860,
			height: 540,
		});
	});
});

describe("shouldExpandHudOverlayFallback", () => {
	it("expands while recording only when the floating webcam preview is visible", () => {
		expect(
			shouldExpandHudOverlayFallback({
				fallbackExpanded: false,
				recordingActive: true,
				webcamPreviewVisible: true,
			}),
		).toBe(true);
	});

	it("keeps the compact recording fallback when there is no webcam preview", () => {
		expect(
			shouldExpandHudOverlayFallback({
				fallbackExpanded: false,
				recordingActive: true,
				webcamPreviewVisible: false,
			}),
		).toBe(false);
	});

	it("preserves manual fallback expansion outside recording", () => {
		expect(
			shouldExpandHudOverlayFallback({
				fallbackExpanded: true,
				recordingActive: false,
				webcamPreviewVisible: false,
			}),
		).toBe(true);
	});

	it("does not expand for webcam visibility outside recording", () => {
		expect(
			shouldExpandHudOverlayFallback({
				fallbackExpanded: false,
				recordingActive: false,
				webcamPreviewVisible: true,
			}),
		).toBe(false);
	});
});

describe("resolveHudOverlayIgnoreMouse", () => {
	const idle = { sourceSelectionActive: false, recordingActive: false, agentActive: false };

	it("forces passthrough while an agent is acting, regardless of the pointer latch", () => {
		expect(resolveHudOverlayIgnoreMouse(false, { ...idle, agentActive: true })).toBe(true);
		expect(
			resolveHudOverlayIgnoreMouse(false, {
				...idle,
				agentActive: true,
				recordingActive: true,
			}),
		).toBe(true);
	});

	it("restores the requested latch once the agent is done", () => {
		expect(resolveHudOverlayIgnoreMouse(false, idle)).toBe(false);
		expect(resolveHudOverlayIgnoreMouse(true, idle)).toBe(true);
	});

	it("keeps source selection passthrough unless recording", () => {
		expect(resolveHudOverlayIgnoreMouse(false, { ...idle, sourceSelectionActive: true })).toBe(
			true,
		);
		expect(
			resolveHudOverlayIgnoreMouse(false, {
				...idle,
				sourceSelectionActive: true,
				recordingActive: true,
			}),
		).toBe(false);
	});
});

describe("overlay modes", () => {
	const idle = { sourceSelectionActive: false, recordingActive: false, agentActive: false };
	const workArea = { x: 100, y: 50, width: 1920, height: 1080 };

	it.each([
		["top-left", { x: 100, y: 50 }],
		["top-right", { x: 1160, y: 50 }],
		["bottom-left", { x: 100, y: 970 }],
		["bottom-right", { x: 1160, y: 970 }],
		["bottom-center", { x: 630, y: 970 }],
	] as const)("parks the compact window in %s", (corner, origin) => {
		expect(getHudOverlayCornerBounds(workArea, corner)).toEqual({
			...origin,
			width: 860,
			height: 160,
		});
	});

	it("keeps an expanded window inside the corner", () => {
		expect(getHudOverlayCornerBounds(workArea, "top-right", true)).toMatchObject({
			y: 50,
			height: 540,
		});
	});

	it("click_through on always ignores the mouse, even while recording", () => {
		expect(
			resolveHudOverlayIgnoreMouse(false, {
				...idle,
				recordingActive: true,
				clickThrough: "on",
			}),
		).toBe(true);
	});

	it("click_through off disables the agent latch but not the pointer latch", () => {
		const state = { ...idle, agentActive: true, clickThrough: "off" as const };
		expect(resolveHudOverlayIgnoreMouse(false, state)).toBe(false);
		expect(resolveHudOverlayIgnoreMouse(true, state)).toBe(true);
	});

	it("click_through auto keeps the agent latch", () => {
		expect(
			resolveHudOverlayIgnoreMouse(false, {
				...idle,
				agentActive: true,
				clickThrough: "auto",
			}),
		).toBe(true);
	});
});
