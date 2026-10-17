import { describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => ({
	getMaxTexturesPerBatch: vi.fn(() => {
		throw new Error("WebGL unavailable");
	}),
}));

import {
	getBatchTextureLimitMismatchMessage,
	readWebGlMaxBatchableTextures,
} from "./pixiBatchTextureLimits";

describe("getBatchTextureLimitMismatchMessage", () => {
	it("returns null when WebGPU and WebGL batch limits match", () => {
		expect(getBatchTextureLimitMismatchMessage(16, 16)).toBeNull();
	});

	it("describes the mismatch when limits differ (Mesa WebGL 32 vs WebGPU 16)", () => {
		expect(getBatchTextureLimitMismatchMessage(16, 32)).toContain(
			"WebGPU batch texture limit (16) differs from WebGL (32)",
		);
	});
});

describe("readWebGlMaxBatchableTextures", () => {
	it("returns null when the WebGL test context cannot be created", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(readWebGlMaxBatchableTextures()).toBeNull();
	});
});
