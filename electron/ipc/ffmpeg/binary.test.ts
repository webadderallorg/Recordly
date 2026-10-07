import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { isPackaged: false },
}));

import { pickFfmpegBinaryPath } from "./binary";

const BUNDLED = "/app/resources/ffmpeg";
const SYSTEM = "/usr/bin/ffmpeg";
const OVERRIDE = "/opt/ffmpeg/build/ffmpeg";

describe("pickFfmpegBinaryPath", () => {
	it("prefers the system binary on Linux", () => {
		expect(
			pickFfmpegBinaryPath({
				override: null,
				bundled: BUNDLED,
				system: SYSTEM,
				platform: "linux",
			}),
		).toEqual({ path: SYSTEM, source: "system" });
	});

	it("uses the bundled binary on Linux when no system binary exists", () => {
		expect(
			pickFfmpegBinaryPath({
				override: null,
				bundled: BUNDLED,
				system: null,
				platform: "linux",
			}),
		).toEqual({ path: BUNDLED, source: "bundled" });
	});

	it("keeps the bundled binary first on macOS", () => {
		expect(
			pickFfmpegBinaryPath({
				override: null,
				bundled: BUNDLED,
				system: SYSTEM,
				platform: "darwin",
			}),
		).toEqual({ path: BUNDLED, source: "bundled" });
	});

	it("keeps the bundled binary first on Windows", () => {
		expect(
			pickFfmpegBinaryPath({
				override: null,
				bundled: BUNDLED,
				system: "C:\\ffmpeg\\bin\\ffmpeg.exe",
				platform: "win32",
			}),
		).toEqual({ path: BUNDLED, source: "bundled" });
	});

	it("falls back to the system binary on macOS (and other platforms) when bundled is missing", () => {
		expect(
			pickFfmpegBinaryPath({
				override: null,
				bundled: null,
				system: SYSTEM,
				platform: "darwin",
			}),
		).toEqual({ path: SYSTEM, source: "system" });
	});

	it("lets RECORDLY_FFMPEG_PATH win on every platform", () => {
		for (const platform of ["linux", "darwin", "win32"] as const) {
			expect(
				pickFfmpegBinaryPath({
					override: OVERRIDE,
					bundled: BUNDLED,
					system: SYSTEM,
					platform,
				}),
			).toEqual({ path: OVERRIDE, source: "override" });
		}
	});

	it("returns null when no candidate exists", () => {
		expect(
			pickFfmpegBinaryPath({
				override: null,
				bundled: null,
				system: null,
				platform: "linux",
			}),
		).toBeNull();
	});
});
