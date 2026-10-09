import { describe, expect, it } from "vitest";
import type { ClipRegion } from "../types";
import { buildExportRenderOptions } from "./buildExportRenderOptions";
import type { ClipTransition } from "./editorOps/transitions";

type Options = ReturnType<typeof buildExportRenderOptions>;

const clips: ClipRegion[] = [
	{ id: "clip-1", startMs: 0, endMs: 5000, sourceStartMs: 0, speed: 1 },
	{ id: "clip-2", startMs: 5000, endMs: 9000, sourceStartMs: 5000, speed: 1 },
];

const dip: ClipTransition = { id: "dip-clip-2", kind: "dip", ms: 400, afterClipId: "clip-2" };

function build(transitions: ClipTransition[], clipRegions = clips): Options {
	return buildExportRenderOptions({
		appearance: {
			wallpaper: "#000000",
			webcam: { sourcePath: null },
			padding: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		},
		timeline: { clipRegions, trimRegions: [], transitions, autoCaptions: [] },
		effectiveSpeedRegions: [],
		effectiveZoomRegions: [],
		effectiveCursorTelemetry: [],
		effectiveShowCursor: true,
		previewWidth: 1920,
		previewHeight: 1080,
		shadowIntensity: 0,
		onProgress: () => undefined,
	} as unknown as Parameters<typeof buildExportRenderOptions>[0]);
}

describe("buildExportRenderOptions dips", () => {
	it("hands back the same dips reference on two calls with unchanged inputs", () => {
		const first = build([dip]);
		const second = build([dip]);
		expect(first.dips).toEqual([{ atMs: 5000, ms: 400 }]);
		expect(second.dips).toBe(first.dips);
	});

	it("hands back the same empty reference when there are no transitions", () => {
		expect(build([]).dips).toBe(build([]).dips);
		expect(build([]).dips).toEqual([]);
	});

	it("hands back a different reference once the dip actually changes", () => {
		const before = build([dip]);
		const after = build([{ ...dip, ms: 900 }]);
		expect(after.dips).not.toBe(before.dips);
		expect(after.dips).toEqual([{ atMs: 5000, ms: 900 }]);
		expect(build([{ ...dip, ms: 900 }]).dips).toBe(after.dips);
	});

	it("hands back a different reference when the clips move under an unchanged dip", () => {
		const before = build([dip]);
		const after = build(
			[dip],
			[
				{ ...clips[0], endMs: 3000 },
				{ ...clips[1], startMs: 3000, endMs: 7000 },
			],
		);
		expect(after.dips).toEqual([{ atMs: 3000, ms: 400 }]);
		expect(after.dips).not.toBe(before.dips);
	});
});
