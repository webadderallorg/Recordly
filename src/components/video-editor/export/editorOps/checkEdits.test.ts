import { describe, expect, it } from "vitest";
import {
	cardSpans,
	checkEditsOps,
	contrastRatio,
	lintEdits,
	MIN_CONTRAST_RATIO,
	parseColor,
} from "./checkEdits";
import type { EditorOpContext } from "./types";

const whole = [{ id: "c1", startMs: 0, endMs: 10_000, sourceStartMs: 0, speed: 1 }];
const cutClips = [
	{ id: "c1", startMs: 0, endMs: 3000, sourceStartMs: 0, speed: 1 },
	{ id: "c2", startMs: 3000, endMs: 6000, sourceStartMs: 4000, speed: 1 },
];

function annotation(patch: Record<string, unknown> = {}) {
	return {
		id: "a1",
		startMs: 1000,
		endMs: 3000,
		type: "text",
		content: "Title",
		style: { color: "#ff0000" },
		position: { x: 5, y: 5 },
		size: { width: 20, height: 10 },
		space: "frame",
		...patch,
	};
}

function zoom(patch: Record<string, unknown> = {}) {
	return {
		id: "z1",
		startMs: 1000,
		endMs: 3000,
		depth: 3,
		focus: { cx: 0.8, cy: 0.8 },
		...patch,
	};
}

function make(
	timeline: Record<string, unknown> = {},
	appearance: Record<string, unknown> = {},
): EditorOpContext {
	return {
		duration: 10,
		videoSourcePath: "/tmp/take.mp4",
		timeline: {
			clipRegions: whole,
			zoomRegions: [],
			annotationRegions: [],
			speedRegions: [],
			autoCaptions: [],
			...timeline,
		},
		appearance: {
			padding: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			...appearance,
		},
	} as unknown as EditorOpContext;
}

const kinds = (context: EditorOpContext) => lintEdits(context).problems.map((p) => p.kind);

describe("check_edits", () => {
	it("reports nothing for a clean project and names every check that ran", () => {
		const result = lintEdits(make());
		expect(result.problems).toEqual([]);
		expect(result.checked).toContain("zoom_crops_annotation");
		expect(result.checked).toContain("caption_validity");
	});

	it("rejects arguments and mutates nothing", () => {
		const context = make({ annotationRegions: [annotation()] });
		const before = JSON.stringify(context.timeline);
		expect(() => checkEditsOps.check_edits({ nope: 1 }, context)).toThrow(/unknown field/);
		checkEditsOps.check_edits({}, context);
		expect(JSON.stringify(context.timeline)).toBe(before);
	});

	describe("zoom cropping a frame-space annotation", () => {
		it("errors when the zoom pushes it fully out of view, at the overlap midpoint", () => {
			const [problem] = lintEdits(
				make({ annotationRegions: [annotation()], zoomRegions: [zoom()] }),
			).problems;
			expect(problem).toMatchObject({
				severity: "error",
				kind: "zoom_crops_annotation",
				subject: "annotation a1",
				atMs: 2000,
			});
		});

		it("warns and names the edges when only partly cropped", () => {
			const [problem] = lintEdits(
				make({
					annotationRegions: [
						annotation({ position: { x: 10, y: 40 }, size: { width: 80, height: 10 } }),
					],
					zoomRegions: [zoom({ focus: { cx: 0.5, cy: 0.5 } })],
				}),
			).problems;
			expect(problem.severity).toBe("warning");
			expect(problem.message).toContain("left and right");
		});

		it("is fine for a screen-space annotation, a zoom elsewhere in time, or a box that stays inside", () => {
			const zooms = [zoom()];
			expect(
				kinds(
					make({
						annotationRegions: [annotation({ space: "screen" })],
						zoomRegions: zooms,
					}),
				),
			).toEqual([]);
			expect(
				kinds(
					make({
						annotationRegions: [annotation({ startMs: 5000, endMs: 6000 })],
						zoomRegions: zooms,
					}),
				),
			).toEqual([]);
			expect(
				kinds(
					make({
						annotationRegions: [
							annotation({
								position: { x: 45, y: 45 },
								size: { width: 10, height: 10 },
							}),
						],
						zoomRegions: [zoom({ focus: { cx: 0.5, cy: 0.5 } })],
					}),
				),
			).toEqual([]);
		});

		it("touching a region only at an instant is not an overlap", () => {
			expect(
				kinds(
					make({
						annotationRegions: [annotation({ startMs: 0, endMs: 1000 })],
						zoomRegions: [zoom()],
					}),
				),
			).toEqual([]);
		});
	});

	describe("look", () => {
		it("warns when padding leaves under half the frame", () => {
			const [problem] = lintEdits(make({}, { padding: 100 })).problems;
			expect(problem).toMatchObject({ severity: "warning", kind: "look_picture_small" });
			expect(problem.message).toContain("36%");
		});

		it("accepts ordinary padding", () => {
			expect(kinds(make({}, { padding: 28 }))).toEqual([]);
		});

		it("flags an empty or out-of-range crop, and warns on a tiny one", () => {
			expect(kinds(make({}, { cropRegion: { x: 0, y: 0, width: 0, height: 1 } }))).toContain(
				"look_crop_invalid",
			);
			expect(
				kinds(make({}, { cropRegion: { x: 0.6, y: 0, width: 0.6, height: 1 } })),
			).toContain("look_crop_invalid");
			expect(
				kinds(make({}, { cropRegion: { x: 0, y: 0, width: 0.4, height: 0.4 } })),
			).toContain("look_crop_small");
		});
	});

	describe("captions after a cut", () => {
		it("accepts a cue inside one clip", () => {
			const cues = [{ id: "q1", startMs: 500, endMs: 2500, text: "Hello" }];
			expect(kinds(make({ clipRegions: cutClips, autoCaptions: cues }))).toEqual([]);
		});

		it("errors on a cue that now spans a cut, reporting the timeline moment", () => {
			const cues = [{ id: "q1", startMs: 2000, endMs: 5000, text: "Hello" }];
			const [problem] = lintEdits(
				make({ clipRegions: cutClips, autoCaptions: cues }),
			).problems;
			expect(problem).toMatchObject({
				severity: "error",
				kind: "caption_crosses_cut",
				atMs: 2000,
			});
		});

		it("errors on a cue wholly inside a cut and on a cue whose head is cut", () => {
			expect(
				kinds(
					make({
						clipRegions: cutClips,
						autoCaptions: [{ id: "q1", startMs: 3200, endMs: 3800, text: "Gone" }],
					}),
				),
			).toEqual(["caption_in_cut"]);
			expect(
				kinds(
					make({
						clipRegions: cutClips,
						autoCaptions: [{ id: "q1", startMs: 3500, endMs: 5000, text: "Head" }],
					}),
				),
			).toEqual(["caption_crosses_cut"]);
		});

		it("accepts a cue across two clips that are contiguous in the source", () => {
			const split = [
				{ id: "c1", startMs: 0, endMs: 3000, sourceStartMs: 0, speed: 1 },
				{ id: "c2", startMs: 3000, endMs: 6000, sourceStartMs: 3000, speed: 1 },
			];
			const cues = [{ id: "q1", startMs: 2000, endMs: 4000, text: "Hello" }];
			expect(kinds(make({ clipRegions: split, autoCaptions: cues }))).toEqual([]);
		});

		it("errors on a cue across clips with different speeds", () => {
			const mixed = [
				{ id: "c1", startMs: 0, endMs: 3000, sourceStartMs: 0, speed: 1 },
				{ id: "c2", startMs: 3000, endMs: 4500, sourceStartMs: 3000, speed: 2 },
			];
			const cues = [{ id: "q1", startMs: 2000, endMs: 4000, text: "Hello" }];
			expect(kinds(make({ clipRegions: mixed, autoCaptions: cues }))).toEqual([
				"caption_crosses_cut",
			]);
		});

		it("errors on empty caption text", () => {
			const cues = [{ id: "q1", startMs: 0, endMs: 1000, text: "  " }];
			expect(kinds(make({ autoCaptions: cues }))).toEqual(["caption_empty"]);
		});
	});

	describe("blur over a zoom", () => {
		it("warns with the overlap moment", () => {
			const [problem] = lintEdits(
				make({
					annotationRegions: [
						annotation({ type: "blur", space: "screen", startMs: 2000, endMs: 4000 }),
					],
					zoomRegions: [zoom()],
				}),
			).problems;
			expect(problem).toMatchObject({
				severity: "warning",
				kind: "blur_over_zoom",
				atMs: 2500,
			});
		});
	});

	describe("plainly broken regions", () => {
		it("errors on inverted regions and off-frame focus", () => {
			expect(
				kinds(
					make({
						zoomRegions: [
							zoom({ startMs: 3000, endMs: 3000, focus: { cx: 1.4, cy: 0.5 } }),
						],
					}),
				),
			).toEqual(["empty_region", "zoom_focus_off_frame"]);
		});

		it("errors on a zero-size or fully off-frame annotation", () => {
			expect(
				kinds(
					make({ annotationRegions: [annotation({ size: { width: 0, height: 10 } })] }),
				),
			).toEqual(["annotation_zero_size"]);
			expect(
				kinds(make({ annotationRegions: [annotation({ position: { x: 100, y: 10 } })] })),
			).toEqual(["annotation_off_frame"]);
		});

		it("warns about a region that starts after the timeline ends", () => {
			const [problem] = lintEdits(
				make({
					zoomRegions: [
						zoom({ startMs: 10_000, endMs: 11_000, focus: { cx: 0.5, cy: 0.5 } }),
					],
				}),
			).problems;
			expect(problem).toMatchObject({ severity: "warning", kind: "region_past_end" });
		});
	});

	describe("low contrast annotation", () => {
		const low = (context: EditorOpContext) =>
			lintEdits(context).problems.filter((p) => p.kind === "low_contrast_annotation");
		const text = (color: string | undefined, patch: Record<string, unknown> = {}) =>
			annotation({ style: color === undefined ? undefined : { color }, ...patch });
		const screenOut = {
			space: "screen",
			position: { x: 0, y: 0 },
			size: { width: 10, height: 10 },
		};
		const withWallpaper = (wallpaper: string, regions: unknown[], timeline = {}) =>
			make({ annotationRegions: regions, ...timeline }, { wallpaper, padding: 60 });
		const grey = (v: number) => `#${v.toString(16).padStart(2, "0").repeat(3)}`;

		it("computes WCAG ratios", () => {
			const white = parseColor("#fff");
			const black = parseColor("black");
			expect(contrastRatio(white!, black!)).toBeCloseTo(21, 5);
			expect(contrastRatio(white!, white!)).toBe(1);
		});

		it("parses short hex, long hex, names and rgb, and rejects the rest", () => {
			expect(parseColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
			expect(parseColor("#0000FF")).toEqual({ r: 0, g: 0, b: 255, a: 1 });
			expect(parseColor("Red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
			expect(parseColor("rgba(1,2,3,0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
			for (const bad of [
				"",
				"nonsense",
				"#12",
				"#12345678",
				"rgb(300,0,0)",
				"linear-gradient(red,blue)",
				5,
				undefined,
			]) {
				expect(parseColor(bad)).toBeNull();
			}
		});

		it("warns on white text over an unknown picture, at the annotation midpoint", () => {
			const [problem] = low(make({ annotationRegions: [text("#FFFFFF")] }));
			expect(problem).toMatchObject({ severity: "warning", atMs: 2000 });
			expect(problem.message).toContain("render_preview at 2000 ms");
			expect(problem.message).toContain("cannot sample");
		});

		it("warns on black text over an unknown picture", () => {
			expect(low(make({ annotationRegions: [text("#000")] }))[0].message).toContain(
				"is dark",
			);
		});

		it("warns on near-white and near-black but not mid-grey, red or blue", () => {
			expect(low(make({ annotationRegions: [text("#eeeeee")] }))).toHaveLength(1);
			expect(low(make({ annotationRegions: [text("#111111")] }))).toHaveLength(1);
			for (const ok of ["#808080", "#ff0000", "#2563EB", "grey"]) {
				expect(low(make({ annotationRegions: [text(ok)] }))).toEqual([]);
			}
		});

		it("treats a missing colour as the default white", () => {
			expect(low(make({ annotationRegions: [text(undefined)] }))).toHaveLength(1);
		});

		it("skips an unparseable colour without crashing", () => {
			expect(low(make({ annotationRegions: [text("var(--x)")] }))).toEqual([]);
		});

		it("checks figures by figureData.color, defaulting to blue", () => {
			const figure = (figureData?: unknown) => annotation({ type: "figure", figureData });
			expect(low(make({ annotationRegions: [figure({ color: "#ffffff" })] }))).toHaveLength(
				1,
			);
			expect(low(make({ annotationRegions: [figure()] }))).toEqual([]);
		});

		it("never fires for a blur or an image", () => {
			const style = { color: "#ffffff" };
			for (const type of ["blur", "image"]) {
				expect(low(make({ annotationRegions: [annotation({ type, style })] }))).toEqual([]);
			}
		});

		it("is quiet with no annotations", () => {
			expect(low(make())).toEqual([]);
		});

		it("is quiet when no look is set (no wallpaper) and the colour is fine", () => {
			expect(
				low(make({ annotationRegions: [text("#ff0000", { space: "screen" })] })),
			).toEqual([]);
		});

		it("skips an annotation that starts after the timeline ends or is off-frame", () => {
			const late = text("#fff", { startMs: 20_000, endMs: 21_000 });
			const off = text("#fff", { position: { x: 100, y: 0 } });
			expect(low(make({ annotationRegions: [late, off] }))).toEqual([]);
		});

		it("compares a screen-space annotation outside the picture with a solid wallpaper", () => {
			const [problem] = low(withWallpaper("#FFFFFF", [text("#ffffff", screenOut)]));
			expect(problem.message).toContain("the wallpaper #FFFFFF");
			expect(problem.message).toContain("1.0:1");
			expect(low(withWallpaper("#000000", [text("#ffffff", screenOut)]))).toEqual([]);
			expect(low(withWallpaper("#FFFFFF", [text("#000000", screenOut)]))).toEqual([]);
		});

		it("flags black on a black wallpaper and mid-grey on mid-grey", () => {
			expect(low(withWallpaper("#000", [text("#000", screenOut)]))).toHaveLength(1);
			expect(low(withWallpaper("#808080", [text("#808080", screenOut)]))).toHaveLength(1);
		});

		it("passes a colour exactly at the threshold and warns one step under it", () => {
			const bg = parseColor("#ffffff")!;
			let lo = 0;
			let hi = 255;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (contrastRatio({ r: mid, g: mid, b: mid, a: 1 }, bg) >= MIN_CONTRAST_RATIO)
					lo = mid;
				else hi = mid;
			}
			expect(low(withWallpaper("#ffffff", [text(grey(lo), screenOut)]))).toEqual([]);
			expect(low(withWallpaper("#ffffff", [text(grey(hi), screenOut)]))).toHaveLength(1);
		});

		it("treats a frame-space annotation as over the picture, not the wallpaper", () => {
			const frame = {
				space: "frame",
				position: { x: 0, y: 0 },
				size: { width: 10, height: 10 },
			};
			expect(low(withWallpaper("#000000", [text("#ffffff", frame)]))).toHaveLength(1);
		});

		it("falls back to the unknown rule for an image wallpaper", () => {
			const image = "/wallpapers/tahoe-light.jpg";
			expect(low(withWallpaper(image, [text("#ffffff", screenOut)]))[0].message).toContain(
				"cannot sample",
			);
			expect(low(withWallpaper(image, [text("#ff0000", screenOut)]))).toEqual([]);
		});

		it("does not trust the wallpaper while a zoom is running", () => {
			const result = low(
				withWallpaper("#000000", [text("#ffffff", screenOut)], { zoomRegions: [zoom()] }),
			);
			expect(result[0].message).toContain("cannot sample");
		});

		it("does not trust the wallpaper when the annotation overlaps the picture", () => {
			const overlapping = {
				space: "screen",
				position: { x: 40, y: 40 },
				size: { width: 20, height: 20 },
			};
			expect(
				low(withWallpaper("#000000", [text("#ffffff", overlapping)]))[0].message,
			).toContain("cannot sample");
		});

		it("uses an opaque backing plate as the background, and ignores a transparent one", () => {
			const plated = text("#ffffff", {
				style: { color: "#ffffff", backgroundColor: "#000000" },
			});
			expect(low(make({ annotationRegions: [plated] }))).toEqual([]);
			const same = text("#ffffff", {
				style: { color: "#ffffff", backgroundColor: "#ffffff" },
			});
			expect(low(make({ annotationRegions: [same] }))[0].message).toContain(
				"its own background",
			);
			const clear = text("#ffffff", {
				style: { color: "#ffffff", backgroundColor: "transparent" },
			});
			expect(low(make({ annotationRegions: [clear] }))).toHaveLength(1);
		});

		it("never reports an error and is listed in checked", () => {
			const result = lintEdits(
				make({ annotationRegions: [text("#fff"), text("#000", { id: "a2" })] }),
			);
			expect(result.problems.every((p) => p.severity === "warning")).toBe(true);
			expect(result.checked).toContain("low_contrast_annotation");
		});
	});
	describe("title and end cards", () => {
		const plate = (patch: Record<string, unknown> = {}, style: Record<string, unknown> = {}) =>
			annotation({
				id: "plate",
				content: "",
				zIndex: 1,
				space: "screen",
				position: { x: 0, y: 0 },
				size: { width: 100, height: 100 },
				style: { fillBox: true, backgroundColor: "#000000", color: "#ffffff", ...style },
				...patch,
			});
		const heading = (color = "#ffffff", patch: Record<string, unknown> = {}) =>
			annotation({
				id: "head",
				content: "Welcome",
				zIndex: 2,
				space: "screen",
				position: { x: 10, y: 38 },
				size: { width: 80, height: 18 },
				style: { color },
				...patch,
			});
		const problems = (regions: unknown[]) =>
			lintEdits(make({ annotationRegions: regions })).problems.map(
				(p) => `${p.kind}:${p.subject}`,
			);

		it("is quiet for a correct card: plate, white heading, white subtitle", () => {
			const sub = heading("#ffffff", { id: "sub", position: { x: 15, y: 57 } });
			expect(problems([plate(), heading(), sub])).toEqual([]);
		});

		it("still warns for a heading black on its own black plate, naming the card background", () => {
			const found = lintEdits(
				make({ annotationRegions: [plate(), heading("#000000")] }),
			).problems;
			expect(found).toHaveLength(1);
			expect(found[0]).toMatchObject({
				kind: "low_contrast_annotation",
				subject: "annotation head",
			});
			expect(found[0].message).toContain("the card background #000000");
			expect(found[0].message).not.toContain("cannot sample");
		});

		it("uses the real plate colour: white heading on a white plate warns, black passes", () => {
			const white = { backgroundColor: "#ffffff" };
			expect(problems([plate({}, white), heading("#ffffff")])).toEqual([
				"low_contrast_annotation:annotation head",
			]);
			expect(problems([plate({}, white), heading("#000000")])).toEqual([]);
		});

		it("treats a fillBox plate with no background colour as an empty annotation, with its own message", () => {
			const bare = plate({}, { backgroundColor: undefined });
			const found = lintEdits(make({ annotationRegions: [bare] })).problems;
			expect(found.map((p) => p.kind)).toEqual(["annotation_empty_text"]);
			expect(found[0].message).toContain("no opaque background colour");
			expect(problems([plate({}, { backgroundColor: "transparent" })])).toEqual([
				"annotation_empty_text:annotation plate",
			]);
			expect(problems([plate({}, { backgroundColor: "rgba(0,0,0,0.2)" })])).toEqual([
				"annotation_empty_text:annotation plate",
			]);
		});

		it("still warns for a plain empty-text annotation that is not a plate", () => {
			expect(problems([annotation({ content: "" })])).toEqual([
				"annotation_empty_text:annotation a1",
			]);
			expect(problems([plate({}, { fillBox: false })])).toEqual([
				"annotation_empty_text:annotation plate",
			]);
		});

		it("does not let a plate vouch for text that is outside it in time or space", () => {
			const short = plate({ startMs: 1000, endMs: 2000 });
			expect(problems([short, heading("#000000")])).toEqual([
				"low_contrast_annotation:annotation head",
			]);
			const corner = plate({ size: { width: 50, height: 50 } });
			expect(problems([corner, heading("#ffffff")])).toEqual([
				"low_contrast_annotation:annotation head",
			]);
		});

		it("does not let a plate drawn above the text vouch for it", () => {
			expect(problems([plate({ zIndex: 5 }), heading("#ffffff")])).toEqual([
				"low_contrast_annotation:annotation head",
			]);
		});

		it("flags only the ordinary overlay when a card sits beside one", () => {
			const overlay = annotation({
				id: "late",
				startMs: 5000,
				endMs: 6000,
				style: { color: "#fff" },
			});
			expect(problems([plate(), heading(), overlay])).toEqual([
				"low_contrast_annotation:annotation late",
			]);
		});

		it("checks two cards each against its own plate", () => {
			const second = [
				plate({ id: "plate2", startMs: 6000, endMs: 8000 }, { backgroundColor: "#ffffff" }),
				heading("#ffffff", { id: "head2", startMs: 6000, endMs: 8000 }),
			];
			expect(problems([plate(), heading(), ...second])).toEqual([
				"low_contrast_annotation:annotation head2",
			]);
		});

		it("reports the span of every plate and nothing for no cards", () => {
			const regions = [plate(), heading(), plate({ id: "p2", startMs: 6000, endMs: 8000 })];
			expect(cardSpans(regions as never)).toEqual([
				{ startMs: 1000, endMs: 3000 },
				{ startMs: 6000, endMs: 8000 },
			]);
			expect(cardSpans([])).toEqual([]);
			expect(cardSpans([annotation({ content: "" })] as never)).toEqual([]);
		});
	});
});
