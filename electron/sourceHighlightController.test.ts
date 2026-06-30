import { describe, expect, it, vi } from "vitest";
import type { WindowBounds } from "./ipc/types";
import {
	createSourceHighlightController,
	getSourceHighlightWindowBounds,
} from "./sourceHighlightController";

function createMockHighlightWindow() {
	return {
		close: vi.fn(),
		isDestroyed: vi.fn(() => false),
		loadURL: vi.fn(async () => undefined),
		moveTop: vi.fn(),
		on: vi.fn(),
		setAlwaysOnTop: vi.fn(),
		setBounds: vi.fn(),
		setContentProtection: vi.fn(),
		setIgnoreMouseEvents: vi.fn(),
		setVisibleOnAllWorkspaces: vi.fn(),
		showInactive: vi.fn(),
	};
}

describe("getSourceHighlightWindowBounds", () => {
	it("adds a small outer pad for window targets", () => {
		expect(
			getSourceHighlightWindowBounds({
				x: 100,
				y: 200,
				width: 640,
				height: 360,
			}),
		).toEqual({
			x: 94,
			y: 194,
			width: 652,
			height: 372,
		});
	});

	it("does not push macOS screen highlights under the menu bar", () => {
		const bounds: WindowBounds = {
			x: 0,
			y: 25,
			width: 1440,
			height: 875,
		};

		expect(getSourceHighlightWindowBounds(bounds, { isMacScreen: true })).toEqual(bounds);
	});
});

describe("createSourceHighlightController", () => {
	it("creates a capture-protected click-through green outline window", async () => {
		const highlightWindow = createMockHighlightWindow();
		const controller = createSourceHighlightController({
			createWindow: vi.fn(() => highlightWindow),
			reassertHudOverlayMousePassthrough: vi.fn(),
		});

		await expect(
			controller.show({
				x: 10,
				y: 20,
				width: 300,
				height: 200,
			}),
		).resolves.toBe(true);

		expect(highlightWindow.setContentProtection).toHaveBeenCalledWith(true);
		expect(highlightWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
		expect(highlightWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
			visibleOnFullScreen: true,
		});
		const loadedUrl = String(highlightWindow.loadURL.mock.calls[0]?.[0]);
		const loadedHtml = Buffer.from(loadedUrl.split(",")[1] ?? "", "base64").toString("utf8");
		expect(loadedHtml).toContain("#00d166");
		expect(loadedHtml).toContain("border-radius:22px");
	});

	it("redraws hover changes by moving the existing outline instead of replacing it", async () => {
		const highlightWindow = createMockHighlightWindow();
		const createWindow = vi.fn(() => highlightWindow);
		const controller = createSourceHighlightController({
			createWindow,
			reassertHudOverlayMousePassthrough: vi.fn(),
		});

		await controller.show({ x: 0, y: 0, width: 200, height: 100 });
		await controller.show({ x: 300, y: 120, width: 500, height: 280 });

		expect(createWindow).toHaveBeenCalledTimes(1);
		expect(highlightWindow.setBounds).toHaveBeenCalledWith(
			{
				x: 294,
				y: 114,
				width: 512,
				height: 292,
			},
			false,
		);
		expect(highlightWindow.close).not.toHaveBeenCalled();
	});

	it("clears the persistent recording outline explicitly", async () => {
		const highlightWindow = createMockHighlightWindow();
		const controller = createSourceHighlightController({
			createWindow: vi.fn(() => highlightWindow),
			reassertHudOverlayMousePassthrough: vi.fn(),
		});

		await controller.show({ x: 0, y: 0, width: 200, height: 100 });
		controller.clear();

		expect(highlightWindow.close).toHaveBeenCalledTimes(1);
	});
});
