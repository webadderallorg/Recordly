import { afterEach, describe, expect, it, vi } from "vitest";
import { ModernVideoExporter } from "./modernVideoExporter";
import type { VideoExporterConfig } from "./types";
import { VideoExporter } from "./videoExporter";

interface NativeExportStartup {
	tryStartNativeVideoExport: () => Promise<boolean>;
	shouldUseExperimentalNativeExport: () => boolean;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

for (const Exporter of [ModernVideoExporter, VideoExporter]) {
	describe(`${Exporter.name} Annex B encoder fallback`, () => {
		it.each([
			"hardware",
			"software",
			"unsupported",
			"probe-error",
			"configure-error",
			"odd-width",
			"odd-height",
		] as const)("handles %s without starting an unusable native session", async (scenario) => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const configure = vi.fn((_config: VideoEncoderConfig) => {
				if (scenario === "configure-error") throw new Error("Encoder configure failed");
			});
			const close = vi.fn();
			const probe = vi.fn(async (config: VideoEncoderConfig) => {
				if (scenario === "probe-error") throw new Error("Encoder probe failed");
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
				videoUrl: "file:///recording.mp4",
				width: scenario === "odd-width" ? 1919 : 1920,
				height: scenario === "odd-height" ? 1079 : 1080,
				frameRate: 30,
				bitrate: 8_000_000,
				wallpaper: "#000000",
			} as VideoExporterConfig;
			const exporter = new Exporter(config) as unknown as NativeExportStartup;
			if (Exporter === VideoExporter) {
				vi.spyOn(exporter, "shouldUseExperimentalNativeExport").mockReturnValue(true);
			}

			const success = await exporter.tryStartNativeVideoExport();

			expect(success).toBe(scenario === "hardware" || scenario === "software");
			if (scenario === "hardware" || scenario === "software") {
				expect(configure).toHaveBeenCalledWith(
					expect.objectContaining({
						codec: "avc1.640034",
						width: 1920,
						height: 1080,
						hardwareAcceleration:
							scenario === "hardware" ? "prefer-hardware" : "prefer-software",
						avc: { format: "annexb" },
					}),
				);
				expect(start).toHaveBeenCalledWith(
					expect.objectContaining({ inputMode: "h264-stream" }),
				);
			} else if (scenario !== "configure-error") {
				expect(start).not.toHaveBeenCalled();
				expect(configure).not.toHaveBeenCalled();
			}
			if (scenario === "software" || scenario === "unsupported") {
				expect(probe).toHaveBeenCalledTimes(2);
				expect(probe.mock.calls.map(([config]) => config.hardwareAcceleration)).toEqual([
					"prefer-hardware",
					"prefer-software",
				]);
			} else if (scenario === "odd-width" || scenario === "odd-height") {
				expect(probe).not.toHaveBeenCalled();
			} else {
				expect(probe).toHaveBeenCalledTimes(1);
			}
			if (scenario === "configure-error") {
				expect(close).toHaveBeenCalledOnce();
				expect(cancel).toHaveBeenCalledWith("test-session");
			}
		});
	});
}
