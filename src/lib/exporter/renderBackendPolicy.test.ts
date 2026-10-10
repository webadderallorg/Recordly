import { describe, expect, it } from "vitest";
import { getPreferredRenderBackendForPlatform } from "./backendPolicy";

describe("getPreferredRenderBackendForPlatform", () => {
	it("prefers WebGL on Linux, where Pixi's WebGPU batcher fails on the first frame", () => {
		expect(getPreferredRenderBackendForPlatform("linux")).toBe("webgl");
	});

	it("keeps the renderer's own ordering elsewhere", () => {
		expect(getPreferredRenderBackendForPlatform("darwin")).toBeUndefined();
		expect(getPreferredRenderBackendForPlatform("win32")).toBeUndefined();
		expect(getPreferredRenderBackendForPlatform("unknown")).toBeUndefined();
	});
});
