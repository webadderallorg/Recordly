import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "../../types";
import { annotationsOps } from "./annotations";
import { captionsOps } from "./captions";
import { lookOps } from "./look";
import { renderPreview } from "./preview";
import type { EditorOpContext } from "./types";
import { zoomOps } from "./zoom";

vi.mock("./preview", () => ({ renderPreview: vi.fn() }));

const render = vi.mocked(renderPreview);

const sheet = (atMs: number) => ({
	image: { data: "AAAA", mimeType: "image/jpeg" as const, width: 10, height: 10 },
	frames: [{ atMs, sourceMs: atMs }],
	rendered: ["look"],
	notRendered: [],
	reused: ["decoded video"],
	note: "composite.",
});

function frozenContext(
	clips: unknown[] = [],
	extra: { zoomRegions?: unknown[]; autoCaptions?: unknown[] } = {},
) {
	return {
		duration: 10,
		videoSourcePath: "/tmp/a.mp4",
		timeline: {
			clipRegions: clips,
			annotationRegions: [],
			zoomRegions: extra.zoomRegions ?? [],
			autoCaptions: extra.autoCaptions ?? [],
			autoCaptionSettings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, enabled: false },
			setAnnotationRegions: vi.fn(),
			setSelectedAnnotationId: vi.fn(),
			setZoomRegions: vi.fn(),
			setSelectedZoomId: vi.fn(),
			setAutoCaptions: vi.fn(),
			setAutoCaptionSettings: vi.fn(),
			setSelectedCaptionId: vi.fn(),
		},
		appearance: {
			padding: 0,
			setPadding: vi.fn(),
			setBorderRadius: vi.fn(),
			setShadowIntensity: vi.fn(),
			setBackgroundBlur: vi.fn(),
		},
		ids: {
			zoom: { current: 1 },
			annotation: { current: 1 },
			annotationZIndex: { current: 1 },
		},
		assertSameRecording: () => undefined,
	} as unknown as EditorOpContext;
}

const blur = { kind: "blur", startMs: 1000, endMs: 3000, x: 10, y: 10, width: 20, height: 20 };

beforeEach(() => {
	render.mockReset();
	render.mockImplementation(async (args) => sheet((args as { atMs: number }).atMs));
});

describe("preview after an edit", () => {
	it("does nothing and adds nothing unless asked", () => {
		const result = annotationsOps["annotate.add"](blur, frozenContext()) as Record<
			string,
			unknown
		>;
		expect(render).not.toHaveBeenCalled();
		expect(result.preview).toBeUndefined();
		expect(result.previewError).toBeUndefined();
	});

	it("renders annotations at their midpoint against the state AFTER the edit", async () => {
		const result = (await annotationsOps["annotate.add"](
			{ ...blur, preview: true },
			frozenContext(),
		)) as { id: string; preview: { atMs: number; image: unknown; note: string } };
		expect(render).toHaveBeenCalledTimes(1);
		const [payload, seen] = render.mock.calls[0];
		expect(payload).toEqual({ atMs: 2000 });
		expect(seen.timeline.annotationRegions.map((r) => r.id)).toEqual([result.id]);
		expect(result.preview.atMs).toBe(2000);
		expect(result.preview.image).toBeDefined();
		expect(result.preview.note).toContain("midpoint");
	});

	it("keeps the edit and reports why when the preview fails", async () => {
		render.mockRejectedValue(
			new Error("A preview is already rendering. Wait for it to finish."),
		);
		const context = frozenContext();
		const result = (await annotationsOps["annotate.add"](
			{ ...blur, preview: true },
			context,
		)) as Record<string, unknown>;
		expect(context.timeline.setAnnotationRegions).toHaveBeenCalledTimes(1);
		expect(result.id).toBe("annotation-1");
		expect(result.preview).toBeUndefined();
		expect(result.previewError).toMatch(/edit was applied.*already rendering/);
	});

	it("rejects a non-boolean preview before changing anything", () => {
		const context = frozenContext();
		expect(() => annotationsOps["annotate.add"]({ ...blur, preview: "yes" }, context)).toThrow(
			/preview must be true or false/,
		);
		expect(context.timeline.setAnnotationRegions).not.toHaveBeenCalled();
	});

	it("clamps an annotation that ends on the last stretch into the timeline", async () => {
		await annotationsOps["annotate.add"](
			{ ...blur, startMs: 9900, endMs: 10000, preview: true },
			frozenContext(),
		);
		expect(render.mock.calls[0][0]).toEqual({ atMs: 9950 });
	});

	it("previews a zoom at its midpoint, including on update", async () => {
		const context = frozenContext([], {
			zoomRegions: [
				{
					id: "zoom-1",
					startMs: 0,
					endMs: 1000,
					depth: 3,
					focus: { cx: 0.5, cy: 0.5 },
					mode: "manual",
				},
			],
		});
		await zoomOps["zoom.add"]({ startMs: 2000, endMs: 4000, preview: true }, context);
		expect(render.mock.calls[0][0]).toEqual({ atMs: 3000 });
		expect(render.mock.calls[0][1].timeline.zoomRegions).toHaveLength(2);
		await zoomOps["zoom.update"]({ id: "zoom-1", endMs: 800, preview: true }, context);
		expect(render.mock.calls[1][0]).toEqual({ atMs: 400 });
	});

	it("still insists on a real change when only preview is given", () => {
		const context = frozenContext([], {
			zoomRegions: [
				{
					id: "zoom-1",
					startMs: 0,
					endMs: 1000,
					depth: 3,
					focus: { cx: 0.5, cy: 0.5 },
					mode: "manual",
				},
			],
		});
		expect(() => zoomOps["zoom.update"]({ id: "zoom-1", preview: true }, context)).toThrow(
			/at least one field/,
		);
	});

	it("previews a look change at the middle of the timeline with the new look applied", async () => {
		const context = frozenContext();
		const result = (await lookOps["look.preset"](
			{ name: "clean", preview: true },
			context,
		)) as {
			preview: { note: string };
		};
		expect(render.mock.calls[0][0]).toEqual({ atMs: 5000 });
		expect(render.mock.calls[0][1].appearance.padding).toEqual(
			expect.objectContaining({ top: 4 }),
		);
		expect(result.preview.note).toContain("middle of the edited timeline");
		expect(() => lookOps["look.set"]({ preview: true }, context)).toThrow(/at least one field/);
	});

	it("projects a caption's source time onto the edited timeline", async () => {
		const clips = [{ id: "c", startMs: 0, endMs: 4000, sourceStartMs: 5000, speed: 1 }];
		const context = frozenContext(clips);
		await captionsOps["captions.set"](
			{ cues: [{ startMs: 1000, endMs: 3000, text: "Hello" }], preview: true },
			context,
		);
		expect(render.mock.calls[0][0]).toEqual({ atMs: 2000 });
		const seen = render.mock.calls[0][1];
		expect(seen.timeline.autoCaptions[0]).toEqual(expect.objectContaining({ startMs: 6000 }));
		expect(seen.timeline.autoCaptionSettings.enabled).toBe(true);
	});

	it("reports a caption that sits in a cut as edited but not previewable", async () => {
		const clips = [{ id: "c", startMs: 0, endMs: 4000, sourceStartMs: 0, speed: 1 }];
		const context = frozenContext(clips, {
			autoCaptions: [{ id: "cue-1", startMs: 6000, endMs: 7000, text: "x" }],
		});
		const result = (await captionsOps["captions.update"](
			{ id: "cue-1", text: "y", preview: true },
			context,
		)) as Record<string, unknown>;
		expect(context.timeline.setAutoCaptions).toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();
		expect(result.id).toBe("cue-1");
		expect(result.previewError).toMatch(/inside a cut/);
	});
});
