import { describe, expect, it } from "vitest";
import type { AudioPeaksData } from "./core/timelineTypes";
import {
	BoundedMediaUrlResolverCache,
	buildSourceSidecarPathCandidates,
	buildTimelineSourceAudioTracks,
	classifyAuthoritativeSourceSidecars,
	isWindowsNavigatorPlatform,
	resolveSourceSidecarExtensions,
} from "./sourceAudioTracks";

function peaks(id: number): AudioPeaksData {
	return {
		durationMs: 1000,
		peaks: new Float32Array([id]),
	};
}

const labels = {
	system: "Source System",
	mic: "Source Mic",
	mixed: "Source",
};

describe("timeline source audio tracks", () => {
	describe("buildSourceSidecarPathCandidates", () => {
		it("builds all real sidecar variants on non-Windows platforms", () => {
			expect(
				buildSourceSidecarPathCandidates("C:\\Recordly\\recording-1.mp4", "mic", "darwin"),
			).toEqual([
				"C:/Recordly/recording-1.mic.wav",
				"C:/Recordly/recording-1.mic.m4a",
				"C:/Recordly/recording-1.mic.webm",
			]);
			expect(
				buildSourceSidecarPathCandidates("/Recordings/rec-1.mp4", "system", "linux"),
			).toEqual([
				"/Recordings/rec-1.system.wav",
				"/Recordings/rec-1.system.m4a",
				"/Recordings/rec-1.system.webm",
			]);
		});

		it("avoids impossible .m4a/.webm candidates on Windows", () => {
			expect(
				buildSourceSidecarPathCandidates("C:\\Recordly\\recording-1.mp4", "mic", "win32"),
			).toEqual(["C:/Recordly/recording-1.mic.wav"]);
			expect(
				buildSourceSidecarPathCandidates(
					"C:\\Recordly\\recording-1.mp4",
					"system",
					"win32",
				),
			).toEqual(["C:/Recordly/recording-1.system.wav"]);
		});

		it("applies Windows detection to Navigator-style platform strings", () => {
			expect(resolveSourceSidecarExtensions("Win32")).toEqual([".wav"]);
			expect(resolveSourceSidecarExtensions("Windows")).toEqual([".wav"]);
			expect(resolveSourceSidecarExtensions("MacIntel")).toEqual([".wav", ".m4a", ".webm"]);
			expect(resolveSourceSidecarExtensions(undefined)).toEqual([".wav", ".m4a", ".webm"]);
		});

		it("keeps the real .wav candidate first when variants are tried", () => {
			const candidates = buildSourceSidecarPathCandidates("/srv/rec.mp4", "mic", "MacIntel");
			expect(candidates[0]).toBe("/srv/rec.mic.wav");
			expect(candidates).toContain("/srv/rec.mic.m4a");
			expect(candidates).toContain("/srv/rec.mic.webm");
		});
	});

	describe("BoundedMediaUrlResolverCache", () => {
		it("deduplicates repeated resolution of the same path", async () => {
			let calls = 0;
			const resolver = async (resource: string) => {
				calls += 1;
				return `http://127.0.0.1/video?path=${encodeURIComponent(resource)}`;
			};
			const cache = new BoundedMediaUrlResolverCache(resolver);

			const path = "/srv/rec.system.wav";
			const first = await cache.resolve(path);
			const second = await cache.resolve(path);

			expect(calls).toBe(1);
			expect(second).toBe(first);
		});

		it("distinct paths are resolved independently", async () => {
			const resolved: string[] = [];
			const resolver = async (resource: string) => {
				resolved.push(resource);
				return `url:${resource}`;
			};
			const cache = new BoundedMediaUrlResolverCache(resolver);

			await cache.resolve("/srv/a.wav");
			await cache.resolve("/srv/b.wav");

			expect(resolved).toEqual(["/srv/a.wav", "/srv/b.wav"]);
		});

		it("bounded cache evicts the least-recently-used path", async () => {
			const resolved: string[] = [];
			const resolver = async (resource: string) => {
				resolved.push(resource);
				return `url:${resource}`;
			};
			const cache = new BoundedMediaUrlResolverCache(resolver, 2);

			await cache.resolve("/srv/a.wav");
			await cache.resolve("/srv/b.wav");
			await cache.resolve("/srv/a.wav");
			await cache.resolve("/srv/c.wav");
			await cache.resolve("/srv/b.wav");

			expect(resolved).toEqual(["/srv/a.wav", "/srv/b.wav", "/srv/c.wav", "/srv/b.wav"]);
		});

		it("does not cache a failed resolution forever", async () => {
			let calls = 0;
			const resolver = async (resource: string) => {
				calls += 1;
				if (calls === 1) throw new Error("boom");
				return `url:${resource}`;
			};
			const cache = new BoundedMediaUrlResolverCache(resolver);
			const path = "/srv/a.wav";

			await expect(cache.resolve(path)).rejects.toThrow("boom");
			expect(await cache.resolve(path)).toBe("url:/srv/a.wav");
			expect(calls).toBe(2);
		});
	});

	describe("isWindowsNavigatorPlatform", () => {
		it("matches Windows platform prefixes only", () => {
			expect(isWindowsNavigatorPlatform("Win32")).toBe(true);
			expect(isWindowsNavigatorPlatform("Win64")).toBe(true);
			expect(isWindowsNavigatorPlatform("Windows")).toBe(true);
			expect(isWindowsNavigatorPlatform("MacIntel")).toBe(false);
			expect(isWindowsNavigatorPlatform("Linux x86_64")).toBe(false);
			expect(isWindowsNavigatorPlatform(undefined)).toBe(false);
		});
	});

	describe("classifyAuthoritativeSourceSidecars", () => {
		it("uses the authoritative two paths once on the normal Windows path", () => {
			const classified = classifyAuthoritativeSourceSidecars(
				["C:\\Recordly\\recording-1.system.wav", "C:\\Recordly\\recording-1.mic.wav"],
				[],
				"Win32",
			);
			expect(classified.systemPaths).toEqual(["C:\\Recordly\\recording-1.system.wav"]);
			expect(classified.micPaths).toEqual(["C:\\Recordly\\recording-1.mic.wav"]);
			expect(classified.pendingPaths).toEqual([]);
		});

		it("drops impossible .m4a/.webm candidates on Windows", () => {
			const classified = classifyAuthoritativeSourceSidecars(
				[
					"/srv/rec.system.wav",
					"/srv/rec.system.m4a",
					"/srv/rec.system.webm",
					"/srv/rec.mic.wav",
				],
				[],
				"Win32",
			);
			expect(classified.systemPaths).toEqual(["/srv/rec.system.wav"]);
			expect(classified.micPaths).toEqual(["/srv/rec.mic.wav"]);
		});

		it("preserves real macOS/Linux sidecar variants", () => {
			const classified = classifyAuthoritativeSourceSidecars(
				[
					"/srv/rec.system.wav",
					"/srv/rec.system.m4a",
					"/srv/rec.system.webm",
					"/srv/rec.mic.m4a",
				],
				[],
				"MacIntel",
			);
			expect(classified.systemPaths).toEqual([
				"/srv/rec.system.wav",
				"/srv/rec.system.m4a",
				"/srv/rec.system.webm",
			]);
			expect(classified.micPaths).toEqual(["/srv/rec.mic.m4a"]);
		});

		it("deduplicates pending paths and never duplicates a known sidecar", () => {
			const classified = classifyAuthoritativeSourceSidecars(
				["/srv/rec.system.wav"],
				["/srv/rec.system.wav", "/srv/rec.mic.wav", "/srv/rec.mic.wav"],
				"Win32",
			);
			// The already-present system sidecar is not repeated as pending; the
			// delayed mic sidecar is surfaced exactly once for retry.
			expect(classified.systemPaths).toEqual(["/srv/rec.system.wav"]);
			expect(classified.micPaths).toEqual([]);
			expect(classified.pendingPaths).toEqual(["/srv/rec.mic.wav"]);
		});

		it("retains a delayed sidecar path for retry when metadata says it is coming", () => {
			const classified = classifyAuthoritativeSourceSidecars(
				["/srv/rec.system.wav"],
				["/srv/rec.mic.wav"],
				"Win32",
			);
			expect(classified.systemPaths).toEqual(["/srv/rec.system.wav"]);
			expect(classified.micPaths).toEqual([]);
			expect(classified.pendingPaths).toEqual(["/srv/rec.mic.wav"]);
		});

		it("drops impossible .m4a pending candidates on Windows", () => {
			const classified = classifyAuthoritativeSourceSidecars(
				[],
				["/srv/rec.mic.wav", "/srv/rec.mic.m4a"],
				"Win32",
			);
			expect(classified.pendingPaths).toEqual(["/srv/rec.mic.wav"]);
		});
	});

	it("keeps embedded system audio controllable when mic is a sidecar", () => {
		const source = peaks(1);
		const mic = peaks(2);

		expect(
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks: source,
				micSidecarPeaks: mic,
				systemSidecarPeaks: null,
				labels,
			}),
		).toEqual([
			{ id: "system", label: "Source System", peaks: source },
			{ id: "mic", label: "Source Mic", peaks: mic },
		]);
	});

	it("does not invent a system track when only the mic sidecar exists", () => {
		const mic = peaks(2);

		expect(
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks: null,
				micSidecarPeaks: mic,
				systemSidecarPeaks: null,
				labels,
			}),
		).toEqual([{ id: "mic", label: "Source Mic", peaks: mic }]);
	});

	it("uses dedicated sidecars over the embedded track when both source tracks exist", () => {
		const source = peaks(1);
		const system = peaks(2);
		const mic = peaks(3);

		expect(
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks: source,
				micSidecarPeaks: mic,
				systemSidecarPeaks: system,
				labels,
			}),
		).toEqual([
			{ id: "system", label: "Source System", peaks: system },
			{ id: "mic", label: "Source Mic", peaks: mic },
		]);
	});

	it("falls back to one mixed source track when no dedicated sidecar exists", () => {
		const source = peaks(1);

		expect(
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks: source,
				micSidecarPeaks: null,
				systemSidecarPeaks: null,
				labels,
			}),
		).toEqual([{ id: "mixed", label: "Source", peaks: source }]);
	});
});
