import { describe, expect, it } from "vitest";
import {
	buildAllRegionSpans,
	buildTimelineItems,
	getAnnotationLabel,
	getAudioLabel,
	resolveDropRowId,
} from "./timelineModel";

const BASE_ANNOTATION = {
	id: "a1",
	startMs: 200,
	endMs: 1200,
	position: { x: 0, y: 0 },
	size: { width: 1, height: 1 },
	style: {
		fontSize: 12,
		color: "#fff",
		backgroundColor: "transparent",
		borderRadius: 0,
		fontFamily: "Inter",
		fontWeight: "normal" as const,
		fontStyle: "normal" as const,
		textDecoration: "none" as const,
		textAlign: "left" as const,
	},
	zIndex: 0,
};

describe("timeline model", () => {
	it("maps regions to timeline items and labels", () => {
		const items = buildTimelineItems({
			zoomRegions: [
				{ id: "z1", startMs: 0, endMs: 1000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			],
			clipRegions: [{ id: "c1", startMs: 0, endMs: 4000, speed: 1 }],
			annotationRegions: [
				{ ...BASE_ANNOTATION, type: "text" as const, content: "Hello timeline", trackIndex: 1 },
			],
			audioRegions: [
				{ id: "au1", startMs: 500, endMs: 2000, audioPath: "/tmp/foo.mp3", volume: 1, trackIndex: 0 },
			],
		});

		expect(items).toHaveLength(4);
		expect(items.find((i) => i.id === "a1")?.rowId).toBe("row-annotation-1");
		expect(items.find((i) => i.id === "au1")?.label).toBe("foo");
	});

	it("builds all variant labels for annotation and audio", () => {
		expect(getAnnotationLabel({ ...BASE_ANNOTATION, type: "text", content: "   " })).toBe(
			"Empty text",
		);
		expect(
			getAnnotationLabel({
				...BASE_ANNOTATION,
				type: "text",
				content: "abcdefghijklmnopqrstuvwxyz",
			}),
		).toBe("abcdefghijklmnopqrst...");
		expect(getAnnotationLabel({ ...BASE_ANNOTATION, type: "image", content: "x" })).toBe(
			"Image",
		);
		expect(getAnnotationLabel({ ...BASE_ANNOTATION, type: "figure", content: "x" })).toBe(
			"Annotation",
		);

		expect(getAudioLabel({ id: "1", startMs: 0, endMs: 1, audioPath: "C:\\x\\y\\z.wav", volume: 1 })).toBe("z");
		expect(getAudioLabel({ id: "2", startMs: 0, endMs: 1, audioPath: "", volume: 1 })).toBe("Audio");
	});

	it("builds row spans for dnd constraints", () => {
		const spans = buildAllRegionSpans({
			zoomRegions: [
				{ id: "z1", startMs: 0, endMs: 1000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
			],
			clipRegions: [{ id: "c1", startMs: 0, endMs: 4000, speed: 1 }],
			audioRegions: [
				{ id: "au1", startMs: 500, endMs: 2000, audioPath: "x.wav", volume: 1, trackIndex: 2 },
			],
		});
		expect(spans.map((s) => s.rowId)).toEqual(["row-zoom", "row-clip", "row-audio-2"]);
	});

	it("keeps items in their domain rows during dnd", () => {
		const items = [
			{ id: "a1", rowId: "row-annotation-1", span: { start: 0, end: 1 }, label: "A", variant: "annotation" as const },
			{ id: "au1", rowId: "row-audio-2", span: { start: 0, end: 1 }, label: "X", variant: "audio" as const },
			{ id: "z1", rowId: "row-zoom", span: { start: 0, end: 1 }, label: "Z", variant: "zoom" as const },
		];
		expect(resolveDropRowId("a1", "row-audio-0", items)).toBe("row-annotation-1");
		expect(resolveDropRowId("a1", "row-annotation-3", items)).toBe("row-annotation-3");
		expect(resolveDropRowId("au1", "row-annotation-1", items)).toBe("row-audio-2");
		expect(resolveDropRowId("au1", "row-audio-7", items)).toBe("row-audio-7");
		expect(resolveDropRowId("z1", "row-audio-1", items)).toBe("row-zoom");
		expect(resolveDropRowId("unknown", "row-audio-1", items)).toBe("row-audio-1");
	});
});
