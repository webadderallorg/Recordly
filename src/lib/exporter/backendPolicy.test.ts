import { describe, expect, it } from "vitest";

import {
	getDefaultLightningRenderBackend,
	normalizeLightningRuntimePlatform,
	shouldPreferNativeAutoBackend,
} from "./backendPolicy";

describe("backendPolicy", () => {
	it("normalizes common platform hints", () => {
		expect(normalizeLightningRuntimePlatform("Win32")).toBe("win32");
		expect(normalizeLightningRuntimePlatform("Linux x86_64")).toBe("linux");
		expect(normalizeLightningRuntimePlatform("MacIntel")).toBe("darwin");
		expect(normalizeLightningRuntimePlatform("unknown")).toBe("unknown");
	});

	it("keeps auto backend WebCodecs-first on every platform", () => {
		expect(shouldPreferNativeAutoBackend("win32")).toBe(false);
		expect(shouldPreferNativeAutoBackend("linux")).toBe(false);
		expect(shouldPreferNativeAutoBackend("darwin")).toBe(false);
		expect(shouldPreferNativeAutoBackend("unknown")).toBe(false);
	});

	it("keeps Lightning exports on the stable WebGL renderer by default", () => {
		expect(getDefaultLightningRenderBackend()).toBe("webgl");
	});
});
