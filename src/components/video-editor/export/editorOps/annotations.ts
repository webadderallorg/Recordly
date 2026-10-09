import {
	type AnnotationRegion,
	type AnnotationSpace,
	type AnnotationType,
	type ArrowDirection,
	BLUR_ANNOTATION_STRENGTH,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_HIGHLIGHT_DIM,
	getTimelineDurationMs,
	MAX_HIGHLIGHT_DIM,
	MIN_HIGHLIGHT_DIM,
} from "../../types";
import { midpointMs, requirePreviewFlag, withPreview } from "./previewAfterEdit";
import {
	type EditorOpContext,
	type EditorOpMap,
	nextId,
	rejectUnknown,
	requireFiniteNumber,
	requireObject,
} from "./types";

const KINDS: AnnotationType[] = ["text", "image", "figure", "blur", "highlight"];
const ALIGNS = ["left", "center", "right"] as const;
const ARROWS: ArrowDirection[] = [
	"up",
	"down",
	"left",
	"right",
	"up-right",
	"up-left",
	"down-right",
	"down-left",
];
const KIND_FIELDS: Record<AnnotationType, string[]> = {
	text: ["text", "fontSize", "color", "backgroundColor", "textAlign"],
	image: ["image"],
	figure: ["arrowDirection", "color", "strokeWidth"],
	blur: ["strength", "blurColor"],
	highlight: ["dim"],
};

const PLATE_TEXT_PRESETS: Record<string, Record<string, unknown>> = {
	lower_third: {
		x: 5,
		y: 80,
		width: 50,
		height: 12,
		space: "screen",
		fontSize: 36,
		color: "#FFFFFF",
		backgroundColor: "rgba(10, 10, 10, 0.88)",
		textAlign: "left",
	},
	callout: {
		width: 24,
		height: 8,
		space: "frame",
		fontSize: 26,
		color: "#111111",
		backgroundColor: "#FFD60A",
		textAlign: "center",
	},
};
const PRESET_NAMES = Object.keys(PLATE_TEXT_PRESETS);

function resolvePreset(args: Record<string, unknown>, op: string) {
	if (args.preset === undefined) return args;
	if (typeof args.preset !== "string" || !PLATE_TEXT_PRESETS[args.preset]) {
		throw new Error(
			`${op}: preset must be exactly one of ${PRESET_NAMES.join(", ")}; got ${JSON.stringify(args.preset)}.`,
		);
	}
	if (args.kind !== undefined && args.kind !== "text") {
		throw new Error(
			`${op}: preset "${args.preset}" styles a text annotation, not a ${args.kind}.`,
		);
	}
	const { preset: _preset, ...explicit } = args;
	const given = Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined));
	return { ...PLATE_TEXT_PRESETS[args.preset], ...given, kind: "text" };
}
const ALL_KIND_FIELDS = [...new Set(Object.values(KIND_FIELDS).flat())];
const SPACES: AnnotationSpace[] = ["frame", "screen"];
const GEOMETRY = ["startMs", "endMs", "x", "y", "width", "height", "trackIndex", "space"];
const ADD_FIELDS = ["kind", "preset", "preview", ...GEOMETRY, ...ALL_KIND_FIELDS];
const MIN_RENDERED_MS = 67;

function optionalNumber(value: unknown, field: string) {
	return value === undefined ? undefined : requireFiniteNumber(value, field);
}

function requireString(value: unknown, field: string) {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${field} must be a non-empty string.`);
	}
	return value;
}

function rejectInapplicable(args: Record<string, unknown>, kind: AnnotationType, op: string) {
	for (const field of ALL_KIND_FIELDS) {
		if (args[field] !== undefined && !KIND_FIELDS[kind].includes(field)) {
			throw new Error(`${op}: "${field}" does not apply to a ${kind} annotation.`);
		}
	}
}

function checkFrame(
	region: Pick<AnnotationRegion, "startMs" | "endMs" | "position" | "size">,
	context: EditorOpContext,
	op: string,
) {
	const timelineMs = getTimelineDurationMs(
		context.timeline.clipRegions,
		Math.round(context.duration * 1000),
	);
	if (timelineMs <= 0) throw new Error(`${op}: there is no recording loaded to annotate.`);
	const { startMs, endMs, position, size } = region;
	if (startMs < 0 || endMs <= startMs) {
		throw new Error(
			`${op}: startMs and endMs are timeline milliseconds (after cuts, not source time) and need 0 <= startMs < endMs.`,
		);
	}
	if (endMs > timelineMs) {
		throw new Error(
			`${op}: endMs ${endMs} is past the end of the timeline (${timelineMs} ms). Times are timeline milliseconds.`,
		);
	}
	if (size.width <= 0 || size.height <= 0) {
		throw new Error(
			`${op}: width and height are percent of the video frame and must be above 0.`,
		);
	}
	if (
		position.x < 0 ||
		position.y < 0 ||
		position.x + size.width > 100 ||
		position.y + size.height > 100
	) {
		throw new Error(
			`${op}: x, y, width and height are percent (0-100) of the video frame with the origin at its top-left, and the box must stay inside the frame.`,
		);
	}
}

function checkRenderedLength(
	args: Record<string, unknown>,
	region: Pick<AnnotationRegion, "startMs" | "endMs">,
	op: string,
) {
	if (args.startMs === undefined && args.endMs === undefined) return;
	if (region.endMs - region.startMs >= MIN_RENDERED_MS) return;
	throw new Error(
		`${op}: ${region.endMs - region.startMs} ms is too short to be rendered — a range under ${MIN_RENDERED_MS} ms can fall between two exported frames and show up in none of them. Use at least ${MIN_RENDERED_MS} ms.`,
	);
}

function checkKindFields(region: AnnotationRegion, op: string) {
	if (region.type === "text" && !(region.textContent ?? "").trim()) {
		throw new Error(`${op}: a text annotation needs non-empty text.`);
	}
	if (region.type === "image" && !(region.imageContent ?? "").startsWith("data:image/")) {
		throw new Error(`${op}: image must be a data:image/... URL.`);
	}
	if (region.type === "blur" && region.space === "screen") {
		throw new Error(
			`${op}: a blur cannot use space "screen". It must sit on the zoomed picture to track what it hides, so use space "frame".`,
		);
	}
	if (region.type === "highlight") {
		if (region.space === "screen") {
			throw new Error(
				`${op}: a highlight cannot use space "screen". It points at something in the picture, so it must follow the zoom; use space "frame".`,
			);
		}
		const dim = region.highlightDim;
		if (dim !== undefined && !(dim >= MIN_HIGHLIGHT_DIM && dim <= MAX_HIGHLIGHT_DIM)) {
			throw new Error(
				`${op}: dim must be between ${MIN_HIGHLIGHT_DIM} and ${MAX_HIGHLIGHT_DIM} (the share of the surroundings that is darkened).`,
			);
		}
		const { x, y } = region.position;
		if (x <= 0 && y <= 0 && x + region.size.width >= 100 && y + region.size.height >= 100) {
			throw new Error(
				`${op}: this highlight covers the whole frame, so it would dim nothing. Give it a rectangle smaller than the frame.`,
			);
		}
	}
	const intensity = region.blurIntensity;
	if (region.type === "blur" && intensity !== undefined && (intensity < 1 || intensity > 100)) {
		throw new Error(`${op}: strength must be between 1 and 100.`);
	}
	if (region.type === "figure" && region.figureData) {
		if (!ARROWS.includes(region.figureData.arrowDirection)) {
			throw new Error(`${op}: arrowDirection must be one of ${ARROWS.join(", ")}.`);
		}
		if (!(region.figureData.strokeWidth > 0)) {
			throw new Error(`${op}: strokeWidth must be above 0.`);
		}
	}
	if (region.type === "text" && !(region.style.fontSize > 0)) {
		throw new Error(`${op}: fontSize must be above 0.`);
	}
}

function applyKindFields(region: AnnotationRegion, args: Record<string, unknown>) {
	const next = { ...region };
	if (args.text !== undefined) {
		const text = requireString(args.text, "text");
		next.textContent = text;
		next.content = text;
	}
	if (args.image !== undefined) {
		const image = requireString(args.image, "image");
		next.imageContent = image;
		next.content = image;
	}
	if (
		args.fontSize !== undefined ||
		args.backgroundColor !== undefined ||
		args.textAlign !== undefined ||
		(args.color !== undefined && region.type === "text")
	) {
		next.style = { ...next.style };
		if (args.backgroundColor !== undefined)
			next.style.backgroundColor = requireString(args.backgroundColor, "backgroundColor");
		if (args.textAlign !== undefined) {
			if (!ALIGNS.includes(args.textAlign as (typeof ALIGNS)[number])) {
				throw new Error(`textAlign must be one of ${ALIGNS.join(", ")}.`);
			}
			next.style.textAlign = args.textAlign as (typeof ALIGNS)[number];
		}
		if (args.fontSize !== undefined)
			next.style.fontSize = requireFiniteNumber(args.fontSize, "fontSize");
		if (args.color !== undefined) next.style.color = requireString(args.color, "color");
	}
	if (region.type === "figure") {
		const base = region.figureData ?? DEFAULT_FIGURE_DATA;
		next.figureData = {
			arrowDirection:
				args.arrowDirection === undefined
					? base.arrowDirection
					: (args.arrowDirection as ArrowDirection),
			color: args.color === undefined ? base.color : requireString(args.color, "color"),
			strokeWidth:
				args.strokeWidth === undefined
					? base.strokeWidth
					: requireFiniteNumber(args.strokeWidth, "strokeWidth"),
		};
	}
	if (region.type === "blur") {
		if (args.strength !== undefined)
			next.blurIntensity = requireFiniteNumber(args.strength, "strength");
		if (args.blurColor !== undefined)
			next.blurColor = requireString(args.blurColor, "blurColor");
	}
	if (region.type === "highlight" && args.dim !== undefined) {
		next.highlightDim = requireFiniteNumber(args.dim, "dim");
	}
	return next;
}

function checkHighlightOverlap(region: AnnotationRegion, context: EditorOpContext, op: string) {
	if (region.type !== "highlight") return;
	const clash = context.timeline.annotationRegions.find(
		(other) =>
			other.type === "highlight" &&
			other.id !== region.id &&
			other.startMs < region.endMs &&
			region.startMs < other.endMs,
	);
	if (clash) {
		throw new Error(
			`${op}: highlight "${clash.id}" already spotlights ${clash.startMs}-${clash.endMs} ms. Two spotlights at once would dim each other's rectangle, so keep them one after another.`,
		);
	}
}

function applyGeometry(region: AnnotationRegion, args: Record<string, unknown>) {
	const startMs = optionalNumber(args.startMs, "startMs");
	const endMs = optionalNumber(args.endMs, "endMs");
	const x = optionalNumber(args.x, "x");
	const y = optionalNumber(args.y, "y");
	const width = optionalNumber(args.width, "width");
	const height = optionalNumber(args.height, "height");
	const trackIndex = optionalNumber(args.trackIndex, "trackIndex");
	if (trackIndex !== undefined && (!Number.isInteger(trackIndex) || trackIndex < 0)) {
		throw new Error("trackIndex must be a whole number, 0 or more.");
	}
	const space = args.space;
	if (space !== undefined && !SPACES.includes(space as AnnotationSpace)) {
		throw new Error(`space must be one of ${SPACES.join(", ")}.`);
	}
	return {
		...region,
		space: (space as AnnotationSpace | undefined) ?? region.space,
		startMs: startMs === undefined ? region.startMs : Math.round(startMs),
		endMs: endMs === undefined ? region.endMs : Math.round(endMs),
		position: { x: x ?? region.position.x, y: y ?? region.position.y },
		size: { width: width ?? region.size.width, height: height ?? region.size.height },
		trackIndex: trackIndex ?? region.trackIndex,
	};
}

function requireKnownId(args: Record<string, unknown>, context: EditorOpContext, op: string) {
	const id = requireString(args.id, "id");
	const region = context.timeline.annotationRegions.find((candidate) => candidate.id === id);
	if (!region) {
		throw new Error(
			`${op}: there is no annotation with id "${id}". Use the id returned by annotate.add.`,
		);
	}
	return region;
}

function annotationMoment(region: AnnotationRegion, context: EditorOpContext) {
	return {
		atMs: midpointMs(region.startMs, region.endMs, context),
		why: `Shown at ${region.startMs}-${region.endMs} ms's midpoint, the middle of the ${region.type} annotation.`,
	};
}

export const annotationsOps: EditorOpMap = {
	"annotate.add": (payload, context) => {
		const raw = requireObject(payload, "annotate.add");
		rejectUnknown(raw, ADD_FIELDS, "annotate.add");
		const args = resolvePreset(raw, "annotate.add");
		const kind = args.kind as AnnotationType;
		if (!KINDS.includes(kind)) {
			throw new Error(`annotate.add: kind must be one of ${KINDS.join(", ")}.`);
		}
		const preview = requirePreviewFlag(args.preview);
		rejectInapplicable(args, kind, "annotate.add");
		for (const field of ["startMs", "endMs", "x", "y", "width", "height"]) {
			requireFiniteNumber(args[field], field);
		}
		const base: AnnotationRegion = {
			id: "",
			startMs: 0,
			endMs: 0,
			type: kind,
			content: "",
			position: { x: 0, y: 0 },
			size: { width: 0, height: 0 },
			style:
				kind === "blur" || kind === "highlight"
					? { ...DEFAULT_ANNOTATION_STYLE, borderRadius: 0 }
					: { ...DEFAULT_ANNOTATION_STYLE },
			zIndex: 0,
			trackIndex: 0,
		};
		if (kind === "figure") base.figureData = { ...DEFAULT_FIGURE_DATA };
		if (kind === "blur") base.blurIntensity = BLUR_ANNOTATION_STRENGTH;
		if (kind === "highlight") base.highlightDim = DEFAULT_HIGHLIGHT_DIM;
		const draft = applyKindFields(applyGeometry(base, args), args);
		checkFrame(draft, context, "annotate.add");
		checkRenderedLength(args, draft, "annotate.add");
		checkKindFields(draft, "annotate.add");
		checkHighlightOverlap(draft, context, "annotate.add");
		const region: AnnotationRegion = {
			...draft,
			id: nextId(context.ids.annotation, "annotation"),
			zIndex: context.ids.annotationZIndex.current++,
		};
		context.timeline.setAnnotationRegions((current) => [...current, region]);
		context.timeline.setSelectedAnnotationId(region.id);
		return withPreview(
			{
				id: region.id,
				kind,
				space: region.space ?? "frame",
				startMs: region.startMs,
				endMs: region.endMs,
			},
			preview,
			context,
			{ timeline: { annotationRegions: [...context.timeline.annotationRegions, region] } },
			() => annotationMoment(region, context),
		);
	},

	"annotate.update": (payload, context) => {
		const args = requireObject(payload, "annotate.update");
		const existing = requireKnownId(args, context, "annotate.update");
		if (args.kind !== undefined) {
			throw new Error(
				"annotate.update cannot change an annotation's kind. Remove it and add a new one.",
			);
		}
		const fields = [...GEOMETRY, ...ALL_KIND_FIELDS];
		rejectUnknown(args, ["id", "kind", "preview", ...fields], "annotate.update");
		const preview = requirePreviewFlag(args.preview);
		if (!fields.some((field) => args[field] !== undefined)) {
			throw new Error(
				`annotate.update needs at least one field to change: ${fields.join(", ")}.`,
			);
		}
		rejectInapplicable(args, existing.type, "annotate.update");
		const region = applyKindFields(applyGeometry(existing, args), args);
		checkFrame(region, context, "annotate.update");
		checkRenderedLength(args, region, "annotate.update");
		checkKindFields(region, "annotate.update");
		checkHighlightOverlap(region, context, "annotate.update");
		context.timeline.setAnnotationRegions((current) =>
			current.map((candidate) => (candidate.id === region.id ? region : candidate)),
		);
		return withPreview(
			{
				id: region.id,
				kind: region.type,
				space: region.space ?? "frame",
				startMs: region.startMs,
				endMs: region.endMs,
			},
			preview,
			context,
			{
				timeline: {
					annotationRegions: context.timeline.annotationRegions.map((candidate) =>
						candidate.id === region.id ? region : candidate,
					),
				},
			},
			() => annotationMoment(region, context),
		);
	},

	"annotate.remove": (payload, context) => {
		const args = requireObject(payload, "annotate.remove");
		rejectUnknown(args, ["id"], "annotate.remove");
		const existing = requireKnownId(args, context, "annotate.remove");
		context.timeline.setAnnotationRegions((current) =>
			current.filter((candidate) => candidate.id !== existing.id),
		);
		if (context.timeline.selectedAnnotationId === existing.id) {
			context.timeline.setSelectedAnnotationId(null);
		}
		return { removed: existing.id };
	},

	"annotate.clear": (payload, context) => {
		if (payload !== undefined && payload !== null) {
			const args = requireObject(payload, "annotate.clear");
			if (Object.keys(args).length > 0) {
				throw new Error(
					"annotate.clear takes no arguments and removes every annotation. To remove a single one, use annotate.remove with its id.",
				);
			}
		}
		const count = context.timeline.annotationRegions.length;
		if (count === 0) throw new Error("annotate.clear: there are no annotations to clear.");
		context.timeline.setAnnotationRegions([]);
		context.timeline.setSelectedAnnotationId(null);
		return { removed: count };
	},
};
