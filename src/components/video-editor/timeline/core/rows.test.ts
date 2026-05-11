import { describe, expect, it } from "vitest";
import {
	getAnnotationTrackIndex,
	getAnnotationTrackRowId,
	getAudioTrackIndex,
	getAudioTrackRowId,
	isAnnotationTrackRowId,
	isAudioTrackRowId,
} from "./rows";

describe("timeline core/rows", () => {
	it("builds and parses annotation rows", () => {
		expect(getAnnotationTrackRowId(2.9)).toBe("row-annotation-2");
		expect(getAnnotationTrackRowId(-5)).toBe("row-annotation-0");
		expect(getAnnotationTrackIndex("row-annotation-4")).toBe(4);
		expect(getAnnotationTrackIndex("row-annotation")).toBe(0);
		expect(isAnnotationTrackRowId("row-annotation")).toBe(true);
		expect(isAnnotationTrackRowId("row-annotation-1")).toBe(true);
	});

	it("handles invalid annotation row IDs safely", () => {
		expect(getAnnotationTrackIndex("row-annotation-foo")).toBe(0);
		expect(getAnnotationTrackIndex("other")).toBe(0);
		expect(isAnnotationTrackRowId("row-audio-1")).toBe(false);
	});

	it("builds and parses audio rows", () => {
		expect(getAudioTrackRowId(1.2)).toBe("row-audio-1");
		expect(getAudioTrackRowId(-3)).toBe("row-audio-0");
		expect(getAudioTrackIndex("row-audio-3")).toBe(3);
		expect(getAudioTrackIndex("row-audio")).toBe(0);
		expect(isAudioTrackRowId("row-audio")).toBe(true);
		expect(isAudioTrackRowId("row-audio-1")).toBe(true);
	});

	it("handles invalid audio row IDs safely", () => {
		expect(getAudioTrackIndex("row-audio-foo")).toBe(0);
		expect(getAudioTrackIndex("other")).toBe(0);
		expect(isAudioTrackRowId("row-annotation-1")).toBe(false);
	});
});
