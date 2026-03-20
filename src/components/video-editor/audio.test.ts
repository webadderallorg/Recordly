import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { toFileUrl, fromFileUrl, normalizeProjectEditor } from "./projectPersistence";

describe("Audio path handling", () => {
	describe("toFileUrl produces valid file:// URLs for audio paths", () => {
		it("should handle Unix absolute paths", () => {
			expect(toFileUrl("/Users/music/song.mp3")).toBe("file:///Users/music/song.mp3");
		});

		it("should handle Windows drive paths", () => {
			expect(toFileUrl("C:/Users/music/song.mp3")).toBe("file:///C:/Users/music/song.mp3");
		});

		it("should handle backslash Windows paths", () => {
			const result = toFileUrl("C:\\Users\\music\\song.mp3");
			expect(result).toMatch(/^file:\/\//);
			expect(result).toContain("C:");
			expect(result).toContain("song.mp3");
		});

		it("should encode spaces in path segments", () => {
			const result = toFileUrl("/Users/my music/my song.mp3");
			expect(result).toContain("my%20music");
			expect(result).toContain("my%20song.mp3");
		});

		it("should encode special characters like spaces", () => {
			const result = toFileUrl("/Users/music/song file.mp3");
			expect(result).toContain("song%20file.mp3");
			// Result should be a valid file:// URL
			expect(result).toMatch(/^file:\/\//);
		});

		it("should roundtrip through fromFileUrl for simple paths", () => {
			const paths = [
				"/Users/music/song.mp3",
				"/tmp/audio.wav",
				"/home/user/my-file.aac",
				"/data/recordings/track_01.flac",
			];
			for (const originalPath of paths) {
				const fileUrl = toFileUrl(originalPath);
				const recovered = fromFileUrl(fileUrl);
				expect(recovered).toBe(originalPath);
			}
		});

		it("should roundtrip paths with spaces through fromFileUrl", () => {
			const originalPath = "/Users/my user/my music/song file.mp3";
			const fileUrl = toFileUrl(originalPath);
			const recovered = fromFileUrl(fileUrl);
			expect(recovered).toBe(originalPath);
		});
	});
});

describe("Audio region normalization", () => {
	describe("volume is clamped to [0, 1]", () => {
		it("should clamp volume > 1 down to 1", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: 0, endMs: 1000, audioPath: "/test.mp3", volume: 5 },
				],
			} as any);
			expect(result.audioRegions[0].volume).toBe(1);
		});

		it("should clamp negative volume to 0", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: 0, endMs: 1000, audioPath: "/test.mp3", volume: -0.5 },
				],
			} as any);
			expect(result.audioRegions[0].volume).toBe(0);
		});

		it("should preserve valid volume values in [0, 1]", () => {
			fc.assert(
				fc.property(
					fc.double({ min: 0, max: 1, noNaN: true }),
					(volume) => {
						const result = normalizeProjectEditor({
							audioRegions: [
								{ id: "audio-1", startMs: 0, endMs: 1000, audioPath: "/test.mp3", volume },
							],
						} as any);
						expect(result.audioRegions[0].volume).toBeCloseTo(volume, 10);
					},
				),
			);
		});

		it("should default to 1 when volume is NaN", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: 0, endMs: 1000, audioPath: "/test.mp3", volume: NaN },
				],
			} as any);
			expect(result.audioRegions[0].volume).toBe(1);
		});

		it("should default to 1 when volume is undefined", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: 0, endMs: 1000, audioPath: "/test.mp3" },
				],
			} as any);
			expect(result.audioRegions[0].volume).toBe(1);
		});
	});

	describe("startMs and endMs boundaries", () => {
		it("should clamp negative startMs to 0", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: -500, endMs: 1000, audioPath: "/test.mp3", volume: 1 },
				],
			} as any);
			expect(result.audioRegions[0].startMs).toBe(0);
		});

		it("should ensure endMs > startMs when endMs < startMs", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: 1000, endMs: 500, audioPath: "/test.mp3", volume: 1 },
				],
			} as any);
			expect(result.audioRegions[0].endMs).toBeGreaterThan(result.audioRegions[0].startMs);
		});

		it("should handle equal startMs and endMs by ensuring minimum gap", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: 1000, endMs: 1000, audioPath: "/test.mp3", volume: 1 },
				],
			} as any);
			expect(result.audioRegions[0].endMs).toBeGreaterThan(result.audioRegions[0].startMs);
		});

		it("should preserve valid startMs/endMs for arbitrary non-negative values", () => {
			fc.assert(
				fc.property(
					fc.nat({ max: 100000 }),
					fc.integer({ min: 1, max: 100000 }),
					(startMs, duration) => {
						const endMs = startMs + duration;
						const result = normalizeProjectEditor({
							audioRegions: [
								{ id: "audio-1", startMs, endMs, audioPath: "/test.mp3", volume: 0.5 },
							],
						} as any);
						expect(result.audioRegions[0].startMs).toBe(startMs);
						expect(result.audioRegions[0].endMs).toBe(endMs);
					},
				),
			);
		});
	});

	describe("audioPath normalization", () => {
		it("should preserve a valid string path", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: 0, endMs: 1000, audioPath: "/Users/music/song.mp3", volume: 1 },
				],
			} as any);
			expect(result.audioRegions[0].audioPath).toBe("/Users/music/song.mp3");
		});

		it("should default to empty string for missing audioPath", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ id: "audio-1", startMs: 0, endMs: 1000, volume: 1 },
				],
			} as any);
			expect(result.audioRegions[0].audioPath).toBe("");
		});

		it("should filter out regions without a valid id", () => {
			const result = normalizeProjectEditor({
				audioRegions: [
					{ startMs: 0, endMs: 1000, audioPath: "/test.mp3", volume: 1 },
					{ id: "audio-1", startMs: 0, endMs: 1000, audioPath: "/test.mp3", volume: 1 },
				],
			} as any);
			expect(result.audioRegions).toHaveLength(1);
			expect(result.audioRegions[0].id).toBe("audio-1");
		});
	});

	describe("empty or missing audioRegions", () => {
		it("should return empty array when audioRegions is undefined", () => {
			const result = normalizeProjectEditor({} as any);
			expect(result.audioRegions).toEqual([]);
		});

		it("should return empty array when audioRegions is not an array", () => {
			const result = normalizeProjectEditor({ audioRegions: "invalid" } as any);
			expect(result.audioRegions).toEqual([]);
		});

		it("should return empty array when audioRegions is null", () => {
			const result = normalizeProjectEditor({ audioRegions: null } as any);
			expect(result.audioRegions).toEqual([]);
		});
	});
});
