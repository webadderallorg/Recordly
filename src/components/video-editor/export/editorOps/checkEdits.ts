import { projectCaptionCues } from "../../captionTimeline";
import {
	type AnnotationRegion,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	getTimelineDurationMs,
	ZOOM_DEPTH_SCALES,
} from "../../types";
import {
	BASE_PREVIEW_HEIGHT,
	BASE_PREVIEW_WIDTH,
	computePaddedLayout,
} from "../../videoPlayback/layoutUtils";
import { computeZoomTransform } from "../../videoPlayback/zoomTransform";
import { toSourceSpan } from "./captions";
import {
	cardSpans,
	contrastRatio,
	isPlate,
	PLATE_MIN_ALPHA,
	parseColor,
	type Rgba,
} from "./cardPlate";
import { type EditorOpContext, type EditorOpMap, rejectUnknown, requireObject } from "./types";

export type EditProblem = {
	severity: "error" | "warning";
	kind: string;
	subject: string;
	atMs: number;
	message: string;
};

export const MIN_PICTURE_AREA_WARN = 0.5;
export const MIN_SOURCE_AREA_WARN = 0.25;
const EDGE_TOLERANCE_PX = 1;
const CAPTION_COVERAGE_TOLERANCE_MS = 2;
export const MIN_CONTRAST_RATIO = 3;
export const MIN_CONTRAST_RATIO_UNKNOWN_BACKGROUND = 1.5;

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

function plateBehind(annotation: AnnotationRegion, annotations: AnnotationRegion[]) {
	return annotations.find(
		(plate) =>
			plate !== annotation &&
			isPlate(plate) &&
			plate.zIndex < annotation.zIndex &&
			plate.startMs <= annotation.startMs &&
			plate.endMs >= annotation.endMs &&
			plate.position.x <= annotation.position.x &&
			plate.position.y <= annotation.position.y &&
			plate.position.x + plate.size.width >= annotation.position.x + annotation.size.width &&
			plate.position.y + plate.size.height >= annotation.position.y + annotation.size.height,
	);
}

const CHECKS = [
	"empty_or_inverted_regions",
	"zoom_focus_off_frame",
	"annotation_off_frame",
	"zoom_crops_annotation",
	"blur_over_zoom",
	"look_picture_size",
	"look_crop",
	"low_contrast_annotation",
	"caption_validity",
];

type Box = { x: number; y: number; width: number; height: number };

function overlap(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) {
	const startMs = Math.max(a.startMs, b.startMs);
	const endMs = Math.min(a.endMs, b.endMs);
	return endMs > startMs ? Math.round((startMs + endMs) / 2) : null;
}

function croppedEdges(
	annotation: AnnotationRegion,
	mask: Box,
	zoomScale: number,
	focus: { cx: number; cy: number },
) {
	const transform = computeZoomTransform({
		stageSize: { width: BASE_PREVIEW_WIDTH, height: BASE_PREVIEW_HEIGHT },
		baseMask: mask,
		zoomScale,
		focusX: focus.cx,
		focusY: focus.cy,
	});
	const left =
		transform.x + (mask.x + (annotation.position.x / 100) * mask.width) * transform.scale;
	const top =
		transform.y + (mask.y + (annotation.position.y / 100) * mask.height) * transform.scale;
	const right = left + (annotation.size.width / 100) * mask.width * transform.scale;
	const bottom = top + (annotation.size.height / 100) * mask.height * transform.scale;
	const edges: string[] = [];
	if (left < -EDGE_TOLERANCE_PX) edges.push("left");
	if (right > BASE_PREVIEW_WIDTH + EDGE_TOLERANCE_PX) edges.push("right");
	if (top < -EDGE_TOLERANCE_PX) edges.push("top");
	if (bottom > BASE_PREVIEW_HEIGHT + EDGE_TOLERANCE_PX) edges.push("bottom");
	const hidden =
		right <= 0 || left >= BASE_PREVIEW_WIDTH || bottom <= 0 || top >= BASE_PREVIEW_HEIGHT;
	return { edges, hidden };
}

export function lintEdits(context: EditorOpContext): {
	problems: EditProblem[];
	checked: string[];
} {
	const { timeline, appearance } = context;
	const problems: EditProblem[] = [];
	const add = (problem: EditProblem) => problems.push(problem);
	const totalMs = getTimelineDurationMs(
		timeline.clipRegions,
		Math.round(context.duration * 1000),
	);

	const regions = [
		...timeline.zoomRegions.map((region) => ({ kind: "zoom", region })),
		...timeline.annotationRegions.map((region) => ({ kind: "annotation", region })),
		...timeline.speedRegions.map((region) => ({ kind: "speed", region })),
		...timeline.clipRegions.map((region) => ({ kind: "clip", region })),
	];
	for (const { kind, region } of regions) {
		const subject = `${kind} ${region.id}`;
		if (region.endMs <= region.startMs) {
			add({
				severity: "error",
				kind: "empty_region",
				subject,
				atMs: region.startMs,
				message: `${subject} ends at ${region.endMs} ms, which is not after its start at ${region.startMs} ms.`,
			});
		} else if (kind !== "clip" && region.startMs >= totalMs) {
			add({
				severity: "warning",
				kind: "region_past_end",
				subject,
				atMs: Math.max(0, totalMs - 1),
				message: `${subject} starts at ${region.startMs} ms, after the timeline ends at ${totalMs} ms, so it never plays.`,
			});
		}
	}

	for (const zoom of timeline.zoomRegions) {
		const { cx, cy } = zoom.focus;
		if (!(cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1)) {
			add({
				severity: "error",
				kind: "zoom_focus_off_frame",
				subject: `zoom ${zoom.id}`,
				atMs: zoom.startMs,
				message: `zoom ${zoom.id} aims at (${cx}, ${cy}), outside the frame. Focus is a fraction from 0 to 1.`,
			});
		}
	}

	const crop = appearance.cropRegion;
	const cropValid =
		crop.width > 0 &&
		crop.height > 0 &&
		crop.x >= 0 &&
		crop.y >= 0 &&
		crop.x + crop.width <= 1.0001 &&
		crop.y + crop.height <= 1.0001;
	if (!cropValid) {
		add({
			severity: "error",
			kind: "look_crop_invalid",
			subject: "look.cropRegion",
			atMs: 0,
			message:
				"The crop is empty or reaches outside the recording. Its x, y, width and height are fractions from 0 to 1.",
		});
	} else if (crop.width * crop.height < MIN_SOURCE_AREA_WARN) {
		add({
			severity: "warning",
			kind: "look_crop_small",
			subject: "look.cropRegion",
			atMs: 0,
			message: `The crop keeps only ${Math.round(crop.width * crop.height * 100)}% of the recording.`,
		});
	}

	const layout = computePaddedLayout({
		width: BASE_PREVIEW_WIDTH,
		height: BASE_PREVIEW_HEIGHT,
		padding: appearance.padding,
		cropRegion: cropValid ? crop : { x: 0, y: 0, width: 1, height: 1 },
		videoWidth: BASE_PREVIEW_WIDTH,
		videoHeight: BASE_PREVIEW_HEIGHT,
	});
	const mask: Box = {
		x: layout.centerOffsetX,
		y: layout.centerOffsetY,
		width: layout.croppedDisplayWidth,
		height: layout.croppedDisplayHeight,
	};
	const picture = (mask.width * mask.height) / (BASE_PREVIEW_WIDTH * BASE_PREVIEW_HEIGHT);
	if (picture < MIN_PICTURE_AREA_WARN) {
		add({
			severity: "warning",
			kind: "look_picture_small",
			subject: "look.padding",
			atMs: 0,
			message: `With this padding the recording fills ${Math.round(picture * 100)}% of the frame and the rest is background. Padding is a percentage of the frame; lower it.`,
		});
	}

	for (const annotation of timeline.annotationRegions) {
		const subject = `annotation ${annotation.id}`;
		const { position, size } = annotation;
		if (size.width <= 0 || size.height <= 0) {
			add({
				severity: "error",
				kind: "annotation_zero_size",
				subject,
				atMs: annotation.startMs,
				message: `${subject} is ${size.width}% by ${size.height}%, so nothing can be drawn.`,
			});
			continue;
		}
		if (
			position.x >= 100 ||
			position.y >= 100 ||
			position.x + size.width <= 0 ||
			position.y + size.height <= 0
		) {
			add({
				severity: "error",
				kind: "annotation_off_frame",
				subject,
				atMs: annotation.startMs,
				message: `${subject} sits at (${position.x}%, ${position.y}%) size ${size.width}% by ${size.height}%, entirely outside the frame.`,
			});
			continue;
		}
		if (
			annotation.type === "text" &&
			!(annotation.textContent ?? annotation.content ?? "").trim() &&
			!isPlate(annotation)
		) {
			add({
				severity: "warning",
				kind: "annotation_empty_text",
				subject,
				atMs: annotation.startMs,
				message: annotation.style?.fillBox
					? `${subject} is a text annotation with no text and no opaque background colour, so it fills the frame with nothing. Set a backgroundColor to make it a card plate, or remove it.`
					: `${subject} is a text annotation with no text.`,
			});
		}
		if (annotation.space === "screen") continue;
		for (const zoom of timeline.zoomRegions) {
			const atMs = overlap(annotation, zoom);
			if (atMs === null) continue;
			const { edges, hidden } = croppedEdges(
				annotation,
				mask,
				ZOOM_DEPTH_SCALES[zoom.depth],
				zoom.focus,
			);
			if (!hidden && edges.length === 0) continue;
			add({
				severity: hidden ? "error" : "warning",
				kind: "zoom_crops_annotation",
				subject,
				atMs,
				message: hidden
					? `${subject} is in frame space and zoom ${zoom.id} (depth ${zoom.depth}) pushes it completely out of view. Set its space to "screen" or move the zoom.`
					: `${subject} is in frame space and zoom ${zoom.id} (depth ${zoom.depth}) crops its ${edges.join(" and ")} edge. Set its space to "screen" or move the zoom.`,
			});
		}
	}

	for (const blur of timeline.annotationRegions) {
		if (blur.type !== "blur") continue;
		for (const zoom of timeline.zoomRegions) {
			const atMs = overlap(blur, zoom);
			if (atMs === null) continue;
			add({
				severity: "warning",
				kind: "blur_over_zoom",
				subject: `annotation ${blur.id}`,
				atMs,
				message: `Blur ${blur.id} overlaps zoom ${zoom.id}. Check at ${atMs} ms that it still covers what it hides while the camera moves.`,
			});
		}
	}

	for (const annotation of timeline.annotationRegions) {
		if (annotation.type !== "text" && annotation.type !== "figure") continue;
		if (
			annotation.type === "text" &&
			!(annotation.textContent ?? annotation.content ?? "").trim()
		)
			continue;
		const { position, size } = annotation;
		if (size.width <= 0 || size.height <= 0) continue;
		if (
			position.x >= 100 ||
			position.y >= 100 ||
			position.x + size.width <= 0 ||
			position.y + size.height <= 0
		)
			continue;
		if (annotation.startMs >= totalMs || annotation.endMs <= annotation.startMs) continue;
		const subject = `annotation ${annotation.id}`;
		const atMs = Math.round((annotation.startMs + Math.min(annotation.endMs, totalMs)) / 2);
		const rawColor =
			annotation.type === "figure"
				? (annotation.figureData?.color ?? DEFAULT_FIGURE_DATA.color)
				: (annotation.style?.color ?? DEFAULT_ANNOTATION_STYLE.color);
		const color = parseColor(rawColor);
		if (!color) continue;

		const plate =
			annotation.type === "text" ? parseColor(annotation.style?.backgroundColor) : null;
		const card = plateBehind(annotation, timeline.annotationRegions);
		const cardFill = card ? parseColor(card.style.backgroundColor) : null;
		let background: Rgba | null = null;
		let backgroundName = "";
		if (plate && plate.a >= PLATE_MIN_ALPHA) {
			background = plate;
			backgroundName = `its own background ${annotation.style.backgroundColor}`;
		} else if (card && cardFill) {
			background = cardFill;
			backgroundName = `the card background ${card.style.backgroundColor}`;
		} else if (annotation.space === "screen") {
			const left = (position.x / 100) * BASE_PREVIEW_WIDTH;
			const top = (position.y / 100) * BASE_PREVIEW_HEIGHT;
			const right = left + (size.width / 100) * BASE_PREVIEW_WIDTH;
			const bottom = top + (size.height / 100) * BASE_PREVIEW_HEIGHT;
			const outsidePicture =
				right <= mask.x ||
				left >= mask.x + mask.width ||
				bottom <= mask.y ||
				top >= mask.y + mask.height;
			const zoomed = timeline.zoomRegions.some((zoom) => overlap(annotation, zoom) !== null);
			const wallpaper = parseColor(appearance.wallpaper);
			if (outsidePicture && !zoomed && wallpaper && wallpaper.a === 1) {
				background = wallpaper;
				backgroundName = `the wallpaper ${appearance.wallpaper}`;
			}
		}

		if (background) {
			const ratio = contrastRatio(color, background);
			if (ratio >= MIN_CONTRAST_RATIO) continue;
			add({
				severity: "warning",
				kind: "low_contrast_annotation",
				subject,
				atMs,
				message: `${subject} is ${rawColor} on ${backgroundName}, a contrast of ${ratio.toFixed(1)}:1 where ${MIN_CONTRAST_RATIO}:1 is needed, so it is likely invisible. Use a contrasting colour or give it a backing plate, then render_preview at ${atMs} ms to confirm.`,
			});
			continue;
		}

		const nearWhite = contrastRatio(color, WHITE) < MIN_CONTRAST_RATIO_UNKNOWN_BACKGROUND;
		const nearBlack = contrastRatio(color, BLACK) < MIN_CONTRAST_RATIO_UNKNOWN_BACKGROUND;
		if (!nearWhite && !nearBlack) continue;
		add({
			severity: "warning",
			kind: "low_contrast_annotation",
			subject,
			atMs,
			message: `${subject} is ${rawColor}, which is likely invisible if the picture behind it is ${nearWhite ? "light" : "dark"}. check_edits cannot sample the recording, so this is a guess. Use a contrasting colour or give it a backing plate, then render_preview at ${atMs} ms to confirm.`,
		});
	}

	const clips = timeline.clipRegions;
	for (const cue of timeline.autoCaptions) {
		const subject = `caption ${cue.id}`;
		if (!cue.text.trim()) {
			add({
				severity: "error",
				kind: "caption_empty",
				subject,
				atMs: 0,
				message: `${subject} has no text.`,
			});
			continue;
		}
		if (clips.length === 0) continue;
		const fragments = projectCaptionCues([cue], clips);
		if (fragments.length === 0) {
			add({
				severity: "error",
				kind: "caption_in_cut",
				subject,
				atMs: 0,
				message: `${subject} ("${cue.text}") is entirely inside a cut and never shows.`,
			});
			continue;
		}
		const start = Math.round(fragments[0].startMs);
		const end = Math.round(fragments[fragments.length - 1].endMs);
		const covered = fragments.reduce(
			(sum, fragment) => sum + (fragment.endMs - fragment.startMs) * fragment.clip.speed,
			0,
		);
		if (covered < cue.endMs - cue.startMs - CAPTION_COVERAGE_TOLERANCE_MS) {
			add({
				severity: "error",
				kind: "caption_crosses_cut",
				subject,
				atMs: start,
				message: `${subject} ("${cue.text}") is partly inside a cut. Re-time it or split it per shot.`,
			});
			continue;
		}
		try {
			toSourceSpan(start, end, context, subject);
		} catch (error) {
			add({
				severity: "error",
				kind: "caption_crosses_cut",
				subject,
				atMs: start,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { problems, checked: CHECKS };
}

export const checkEditsOps: EditorOpMap = {
	check_edits: (payload, context) => {
		rejectUnknown(requireObject(payload ?? {}, "check_edits"), [], "check_edits");
		return lintEdits(context);
	},
};

export { cardSpans, contrastRatio, parseColor };
