import { describe, expect, it } from "vitest";
import { appendImportedClip } from "./clipImport";
import type { ClipRegion } from "./types";

const clip = (id: string, startMs: number, endMs: number, extra: Partial<ClipRegion> = {}) =>
	({ id, startMs, endMs, speed: 1, ...extra }) as ClipRegion;

const media = { sourceStartMs: 10_000, durationMs: 4_000 };

describe("appendImportedClip", () => {
	it("fences the existing clips off from the joined recording's source range", () => {
		const next = appendImportedClip([clip("a", 0, 6000)], media, "clip-2", 1);
		expect(next[0]).toMatchObject({ id: "a", sourceMinMs: 0, sourceMaxMs: 10_000 });
		expect(next[1]).toMatchObject({
			id: "clip-2",
			sourceStartMs: 10_000,
			sourceMinMs: 10_000,
			sourceMaxMs: 14_000,
			speed: 1,
		});
	});

	it("keeps bounds a clip already had, so a second join does not widen the first", () => {
		const existing = clip("a", 0, 6000, { sourceMinMs: 2_000, sourceMaxMs: 8_000 });
		const next = appendImportedClip([existing], media, "clip-2", 1);
		expect(next[0]).toMatchObject({ sourceMinMs: 2_000, sourceMaxMs: 8_000 });
	});

	it("lays the joined clip end to end with no gap", () => {
		const next = appendImportedClip([clip("a", 0, 6000)], media, "clip-2", 1);
		expect(next[0].startMs).toBe(0);
		expect(next[0].endMs).toBe(6000);
		expect(next[1].startMs).toBe(6000);
		expect(next[1].endMs).toBe(10_000);
	});

	it("inserts at a position, and clamps one that is out of range", () => {
		const clips = [clip("a", 0, 4000), clip("b", 4000, 8000)];
		expect(appendImportedClip(clips, media, "new", 0).map((c) => c.id)).toEqual([
			"new",
			"a",
			"b",
		]);
		expect(appendImportedClip(clips, media, "new", 99).map((c) => c.id)).toEqual([
			"a",
			"b",
			"new",
		]);
		expect(appendImportedClip(clips, media, "new", -5).map((c) => c.id)).toEqual([
			"new",
			"a",
			"b",
		]);
	});

	it("joins onto an empty timeline", () => {
		const next = appendImportedClip([], media, "clip-1", 0);
		expect(next).toHaveLength(1);
		expect(next[0]).toMatchObject({ startMs: 0, endMs: 4_000 });
	});
});
