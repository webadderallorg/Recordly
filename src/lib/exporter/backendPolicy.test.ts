import { describe, expect, it } from "vitest";

import {
	getDefaultLightningRenderBackend,
	normalizeLightningRuntimePlatform,
	planLightningExportRoutes,
	resolveLinuxExportRenderBackend,
	shouldPreferNativeAutoBackend,
	shouldPreferNativeStaticLayoutBeforeBreeze,
} from "./backendPolicy";

describe("backendPolicy", () => {
	it("normalizes common platform hints", () => {
		expect(normalizeLightningRuntimePlatform("Win32")).toBe("win32");
		expect(normalizeLightningRuntimePlatform("Linux x86_64")).toBe("linux");
		expect(normalizeLightningRuntimePlatform("MacIntel")).toBe("darwin");
		expect(normalizeLightningRuntimePlatform("unknown")).toBe("unknown");
	});

	it("prefers native auto backend on desktop platforms with the fastest native path", () => {
		expect(shouldPreferNativeAutoBackend("win32")).toBe(true);
		expect(shouldPreferNativeAutoBackend("linux")).toBe(false);
		expect(shouldPreferNativeAutoBackend("darwin")).toBe(true);
		expect(shouldPreferNativeAutoBackend("unknown")).toBe(false);
	});

	it("keeps Lightning exports on the stable WebGL renderer by default", () => {
		expect(getDefaultLightningRenderBackend()).toBe("webgl");
	});

	it("keeps Windows auto exports on the streaming route by default", () => {
		expect(shouldPreferNativeStaticLayoutBeforeBreeze("win32", "auto")).toBe(false);
		expect(shouldPreferNativeStaticLayoutBeforeBreeze("darwin", "auto")).toBe(false);

		expect(
			planLightningExportRoutes({
				backendPreference: "auto",
				platform: "win32",
				nativeStaticLayoutAvailable: true,
			}),
		).toMatchObject({
			selectedRoute: "breeze-stream",
			decisions: [
				{ route: "native-static-layout", status: "rejected" },
				{ route: "breeze-stream", status: "selected" },
				{ route: "webcodecs", status: "fallback" },
			],
		});
	});

	it("ignores native static skip reasons for Windows auto routing", () => {
		expect(
			planLightningExportRoutes({
				backendPreference: "auto",
				platform: "win32",
				nativeStaticLayoutAvailable: true,
				nativeStaticLayoutSkipReasons: ["unsupported-caption-overlay"],
			}),
		).toEqual({
			selectedRoute: "breeze-stream",
			decisions: [
				{
					route: "native-static-layout",
					status: "rejected",
					reasons: ["platform-does-not-use-native-static-layout"],
				},
				{
					route: "breeze-stream",
					status: "selected",
					reasons: ["platform-prefers-native-streaming"],
				},
				{
					route: "webcodecs",
					status: "fallback",
					reasons: ["breeze-unavailable-fallback"],
				},
			],
		});
	});

	it("documents the native static layout path when Breeze is selected explicitly", () => {
		expect(
			planLightningExportRoutes({
				backendPreference: "breeze",
				platform: "win32",
				nativeStaticLayoutAvailable: true,
			}),
		).toEqual({
			selectedRoute: "native-static-layout",
			decisions: [
				{
					route: "native-static-layout",
					status: "selected",
					reasons: ["visually-compatible"],
				},
				{
					route: "breeze-stream",
					status: "fallback",
					reasons: ["user-selected-breeze"],
				},
				{
					route: "webcodecs",
					status: "fallback",
					reasons: ["breeze-unavailable-fallback"],
				},
			],
		});
	});

	it("keeps explicit Breeze selected when native static layout is unavailable", () => {
		expect(
			planLightningExportRoutes({
				backendPreference: "breeze",
				platform: "win32",
				nativeStaticLayoutAvailable: false,
			}),
		).toEqual({
			selectedRoute: "breeze-stream",
			decisions: [
				{
					route: "native-static-layout",
					status: "rejected",
					reasons: ["native-static-unavailable"],
				},
				{
					route: "breeze-stream",
					status: "selected",
					reasons: ["user-selected-breeze"],
				},
				{
					route: "webcodecs",
					status: "fallback",
					reasons: ["breeze-unavailable-fallback"],
				},
			],
		});
	});

	it("records explicit Breeze native static layout skip reasons", () => {
		expect(
			planLightningExportRoutes({
				backendPreference: "breeze",
				platform: "win32",
				nativeStaticLayoutAvailable: true,
				nativeStaticLayoutSkipReasons: ["unsupported-audio-mix"],
			}),
		).toEqual({
			selectedRoute: "breeze-stream",
			decisions: [
				{
					route: "native-static-layout",
					status: "rejected",
					reasons: ["unsupported-audio-mix"],
				},
				{
					route: "breeze-stream",
					status: "selected",
					reasons: ["user-selected-breeze"],
				},
				{
					route: "webcodecs",
					status: "fallback",
					reasons: ["breeze-unavailable-fallback"],
				},
			],
		});
	});

	it("documents why macOS auto skips native static layout", () => {
		expect(
			planLightningExportRoutes({
				backendPreference: "auto",
				platform: "darwin",
				nativeStaticLayoutAvailable: true,
			}),
		).toEqual({
			selectedRoute: "breeze-stream",
			decisions: [
				{
					route: "native-static-layout",
					status: "rejected",
					reasons: ["platform-does-not-use-native-static-layout"],
				},
				{
					route: "breeze-stream",
					status: "selected",
					reasons: ["platform-prefers-native-streaming"],
				},
				{
					route: "webcodecs",
					status: "fallback",
					reasons: ["breeze-unavailable-fallback"],
				},
			],
		});
	});
});

describe("resolveLinuxExportRenderBackend (Linux Lightning export backend)", () => {
	it("honors RECORDLY_LINUX_RENDER_BACKEND=webgl on Linux", () => {
		expect(resolveLinuxExportRenderBackend("linux", "webgl")).toBe("webgl");
	});

	it("honors RECORDLY_LINUX_RENDER_BACKEND=webgpu on Linux (experimental WebGPU path)", () => {
		expect(resolveLinuxExportRenderBackend("linux", "webgpu")).toBe("webgpu");
	});

	it("defaults the Linux export backend to WebGPU (dynamic webgl fallback lives in the exporter)", () => {
		expect(resolveLinuxExportRenderBackend("linux", undefined)).toBe("webgpu");
	});

	it("falls back to the WebGPU default on Linux for invalid or null env values", () => {
		expect(resolveLinuxExportRenderBackend("linux", "banana")).toBe("webgpu");
		expect(resolveLinuxExportRenderBackend("linux", null)).toBe("webgpu");
	});

	it("leaves non-Linux platforms on the default backend selection", () => {
		expect(resolveLinuxExportRenderBackend("darwin", "webgl")).toBeUndefined();
		expect(resolveLinuxExportRenderBackend("win32", "webgl")).toBeUndefined();
		expect(resolveLinuxExportRenderBackend("unknown", "webgpu")).toBeUndefined();
	});
});
