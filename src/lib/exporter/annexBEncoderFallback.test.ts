import { afterEach, describe, expect, it, vi } from "vitest";
import { tryStartNativeVideoExport as startLegacy } from "./legacyVideoNativeEncoder";
import { startNativeVideoExport as startModern } from "./modernNativeStreamStart";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

for (const backend of ["legacy", "modern"] as const) {
	describe(`${backend} Annex B encoder fallback`, () => {
		it.each([
			"hardware",
			"software",
			"unsupported",
			"probe-error",
			"configure-error",
			"odd-width",
			"odd-height",
		] as const)("preserves native recovery when the encoder is %s", async (scenario) => {
			vi.spyOn(console, "log").mockImplementation(() => {});
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const configure = vi.fn(() => {
				if (scenario === "configure-error") throw new Error("Configure failed");
			});
			const close = vi.fn();
			const probe = vi.fn(async (config: VideoEncoderConfig) => {
				if (scenario === "probe-error") throw new Error("Probe failed");
				return {
					supported:
						scenario === "hardware" ||
						scenario === "configure-error" ||
						(scenario === "software" &&
							config.hardwareAcceleration === "prefer-software"),
				};
			});
			class Encoder {
				static isConfigSupported = probe;
				configure = configure;
				close = close;
			}
			vi.stubGlobal("VideoEncoder", Encoder);
			const start = vi.fn(async () => ({ success: true, sessionId: "test-session" }));
			const cancel = vi.fn(async () => ({ success: true }));
			vi.stubGlobal("window", {
				electronAPI: { nativeVideoExportStart: start, nativeVideoExportCancel: cancel },
			});
			const config = {
				width: scenario === "odd-width" ? 1919 : 1920,
				height: scenario === "odd-height" ? 1079 : 1080,
				bitrate: 8_000_000,
				frameRate: 30,
			};
			const modern = {
				config,
				cancelled: false,
				native: { nativeOutputChunkCount: 0 },
				flow: {},
				metrics: {},
			} as unknown as Parameters<typeof startModern>[0];
			const legacy = {
				config,
				cancelled: false,
				shouldUseExperimentalNativeExport: () => true,
			} as unknown as Parameters<typeof startLegacy>[0];
			const selected =
				backend === "modern" ? await startModern(modern, {}) : await startLegacy(legacy);
			const stream = scenario === "hardware" || scenario === "software";
			const oddDimensions = scenario === "odd-width" || scenario === "odd-height";
			expect(selected).toBe(!oddDimensions && (stream || backend === "modern"));
			if (stream) {
				expect(configure).toHaveBeenCalledWith(
					expect.objectContaining({
						codec: "avc1.640034",
						hardwareAcceleration:
							scenario === "hardware" ? "prefer-hardware" : "prefer-software",
						avc: { format: "annexb" },
					}),
				);
				expect(start).toHaveBeenCalledWith(
					expect.objectContaining({ inputMode: "h264-stream" }),
				);
			} else if (oddDimensions) {
				expect(probe).not.toHaveBeenCalled();
				expect(configure).not.toHaveBeenCalled();
				expect(start).not.toHaveBeenCalled();
			} else if (backend === "modern") {
				// Retain the newer rawvideo fallback when no browser stream can run.
				expect(start).toHaveBeenLastCalledWith(
					expect.objectContaining({ inputMode: "rawvideo" }),
				);
			} else if (scenario !== "configure-error") {
				expect(start).not.toHaveBeenCalled();
			}
			if (scenario === "software" || scenario === "unsupported") {
				expect(probe.mock.calls.map(([config]) => config.hardwareAcceleration)).toEqual([
					"prefer-hardware",
					"prefer-software",
				]);
			}
			if (scenario === "configure-error") {
				expect(close).toHaveBeenCalledOnce();
				expect(cancel).toHaveBeenCalledWith("test-session");
			}
		});
	});
}
