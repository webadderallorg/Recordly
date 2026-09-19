import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

import { parseKeystrokeMonitorLine } from "./monitor";

const nativeMonitorSource = readFileSync(
	fileURLToPath(new URL("../../native/NativeCursorMonitor.swift", import.meta.url)),
	"utf8",
);

describe("parseKeystrokeMonitorLine", () => {
	it("parses KEY:down:c:meta", () => {
		expect(parseKeystrokeMonitorLine("KEY:down:c:meta")).toEqual({
			key: "c",
			modifiers: ["meta"],
		});
	});

	it("parses empty modifiers", () => {
		expect(parseKeystrokeMonitorLine("KEY:down:enter:")).toEqual({
			key: "enter",
			modifiers: [],
		});
	});

	it("ignores malformed lines", () => {
		expect(parseKeystrokeMonitorLine("KEY:down:C:meta")).toBeNull();
		expect(parseKeystrokeMonitorLine("KEY:up:c:meta")).toBeNull();
		expect(parseKeystrokeMonitorLine("STATE:arrow")).toBeNull();
		expect(parseKeystrokeMonitorLine("INTERACTION:mousedown:1")).toBeNull();
	});

	it("parses named punctuation tokens", () => {
		expect(parseKeystrokeMonitorLine("KEY:down:comma:")).toEqual({
			key: "comma",
			modifiers: [],
		});
	});
});

describe("native cursor monitor keystroke tap", () => {
	it("retries the mouse-only tap when the combined key mask cannot be created", () => {
		expect(nativeMonitorSource).toContain("installListenOnlyTap(combinedMask)");
		expect(nativeMonitorSource).toContain("installListenOnlyTap(mouseOnlyMask)");
		expect(nativeMonitorSource).toContain(
			"Keyboard event tap unavailable; keystroke telemetry disabled",
		);
		expect(nativeMonitorSource).toContain(
			"Mouse interaction event tap unavailable; click telemetry disabled",
		);
	});

	it("emits named punctuation tokens from the Swift key map", () => {
		expect(nativeMonitorSource).toContain('return "comma"');
		expect(nativeMonitorSource).toContain('return "period"');
	});
});
