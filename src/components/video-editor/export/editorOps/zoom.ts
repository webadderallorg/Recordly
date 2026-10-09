import {
	clampFocusToDepth,
	DEFAULT_ZOOM_DEPTH,
	getTimelineDurationMs,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomMode,
	type ZoomRegion,
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

const MODES: ZoomMode[] = ["auto", "manual"];
const DEPTHS = Object.keys(ZOOM_DEPTH_SCALES).map(Number) as ZoomDepth[];

function requireDepth(value: unknown, op: string): ZoomDepth {
	if (typeof value !== "number" || !DEPTHS.includes(value as ZoomDepth)) {
		throw new Error(
			`${op}: depth must be one of ${DEPTHS.join(", ")} (${DEPTHS.map((d) => `${d}=${ZOOM_DEPTH_SCALES[d]}x`).join(", ")}), not ${String(value)}.`,
		);
	}
	return value as ZoomDepth;
}

function requireFocus(value: unknown, op: string): ZoomFocus {
	const focus = requireObject(value, `${op} focus`);
	const cx = requireFiniteNumber(focus.cx, "focus.cx");
	const cy = requireFiniteNumber(focus.cy, "focus.cy");
	if (cx < 0 || cx > 1 || cy < 0 || cy > 1) {
		throw new Error(
			`${op}: focus.cx and focus.cy are fractions of the frame between 0 and 1 (0.5, 0.5 is the centre), not ${cx}, ${cy}.`,
		);
	}
	return { cx, cy };
}

function requireMode(value: unknown, op: string): ZoomMode {
	if (!MODES.includes(value as ZoomMode)) {
		throw new Error(`${op}: mode must be "auto" or "manual", not ${String(value)}.`);
	}
	return value as ZoomMode;
}

function timelineMs(context: EditorOpContext) {
	return getTimelineDurationMs(context.timeline.clipRegions, Math.round(context.duration * 1000));
}

function checkRange(
	startMs: number,
	endMs: number,
	others: ZoomRegion[],
	context: EditorOpContext,
	op: string,
) {
	const total = timelineMs(context);
	if (total <= 0) throw new Error(`${op}: there is no recording loaded to zoom.`);
	if (startMs < 0 || endMs <= startMs) {
		throw new Error(
			`${op}: startMs and endMs are timeline milliseconds (after cuts, not source time) and need 0 <= startMs < endMs.`,
		);
	}
	if (endMs > total) {
		throw new Error(
			`${op}: endMs ${endMs} is past the end of the timeline (${total} ms). Times are timeline milliseconds.`,
		);
	}
	const clash = others.find((other) => startMs < other.endMs && endMs > other.startMs);
	if (clash) {
		throw new Error(
			`${op}: ${startMs}-${endMs} ms overlaps zoom "${clash.id}" (${clash.startMs}-${clash.endMs} ms). Remove or move it first.`,
		);
	}
}

function requireKnownZoom(args: Record<string, unknown>, context: EditorOpContext, op: string) {
	if (typeof args.id !== "string" || args.id === "") {
		throw new Error(`${op}: id must be a non-empty string.`);
	}
	const region = context.timeline.zoomRegions.find((candidate) => candidate.id === args.id);
	if (!region) {
		throw new Error(
			`${op}: there is no zoom with id "${args.id}". Use an id from zoom.add or get_state.`,
		);
	}
	return region;
}

function describe(region: ZoomRegion) {
	return { ...region, scale: ZOOM_DEPTH_SCALES[region.depth] };
}

function zoomMoment(region: ZoomRegion, context: EditorOpContext) {
	return {
		atMs: midpointMs(region.startMs, region.endMs, context),
		why: `Shown at the middle of the zoom (${region.startMs}-${region.endMs} ms), where it is fully in.`,
	};
}

export const zoomOps: EditorOpMap = {
	"zoom.add": (payload, context) => {
		const args = requireObject(payload, "zoom.add");
		rejectUnknown(args, ["startMs", "endMs", "depth", "focus", "mode", "preview"], "zoom.add");
		const preview = requirePreviewFlag(args.preview);
		const startMs = Math.round(requireFiniteNumber(args.startMs, "startMs"));
		const endMs = Math.round(requireFiniteNumber(args.endMs, "endMs"));
		const depth =
			args.depth === undefined ? DEFAULT_ZOOM_DEPTH : requireDepth(args.depth, "zoom.add");
		const focus =
			args.focus === undefined ? { cx: 0.5, cy: 0.5 } : requireFocus(args.focus, "zoom.add");
		const mode = args.mode === undefined ? "manual" : requireMode(args.mode, "zoom.add");
		checkRange(startMs, endMs, context.timeline.zoomRegions, context, "zoom.add");
		const region: ZoomRegion = {
			id: nextId(context.ids.zoom, "zoom"),
			startMs,
			endMs,
			depth,
			focus: clampFocusToDepth(focus, depth),
			mode,
		};
		context.timeline.setZoomRegions((current) => [...current, region]);
		context.timeline.setSelectedZoomId(region.id);
		return withPreview(
			{ zoom: describe(region), undoable: true },
			preview,
			context,
			{ timeline: { zoomRegions: [...context.timeline.zoomRegions, region] } },
			() => zoomMoment(region, context),
		);
	},

	"zoom.update": (payload, context) => {
		const args = requireObject(payload, "zoom.update");
		rejectUnknown(
			args,
			["id", "startMs", "endMs", "depth", "focus", "mode", "preview"],
			"zoom.update",
		);
		const preview = requirePreviewFlag(args.preview);
		const region = requireKnownZoom(args, context, "zoom.update");
		const next: ZoomRegion = { ...region };
		if (args.startMs !== undefined)
			next.startMs = Math.round(requireFiniteNumber(args.startMs, "startMs"));
		if (args.endMs !== undefined)
			next.endMs = Math.round(requireFiniteNumber(args.endMs, "endMs"));
		if (args.depth !== undefined) next.depth = requireDepth(args.depth, "zoom.update");
		if (args.focus !== undefined) next.focus = requireFocus(args.focus, "zoom.update");
		if (args.mode !== undefined) next.mode = requireMode(args.mode, "zoom.update");
		if (Object.keys(args).filter((key) => key !== "preview").length === 1) {
			throw new Error("zoom.update needs at least one field to change besides id.");
		}
		checkRange(
			next.startMs,
			next.endMs,
			context.timeline.zoomRegions.filter((other) => other.id !== region.id),
			context,
			"zoom.update",
		);
		next.focus = clampFocusToDepth(next.focus, next.depth);
		context.timeline.setZoomRegions((current) =>
			current.map((candidate) => (candidate.id === region.id ? next : candidate)),
		);
		return withPreview(
			{ zoom: describe(next), undoable: true },
			preview,
			context,
			{
				timeline: {
					zoomRegions: context.timeline.zoomRegions.map((candidate) =>
						candidate.id === region.id ? next : candidate,
					),
				},
			},
			() => zoomMoment(next, context),
		);
	},

	"zoom.remove": (payload, context) => {
		const args = requireObject(payload, "zoom.remove");
		rejectUnknown(args, ["id"], "zoom.remove");
		const region = requireKnownZoom(args, context, "zoom.remove");
		context.timeline.setZoomRegions((current) =>
			current.filter((candidate) => candidate.id !== region.id),
		);
		if (context.timeline.selectedZoomId === region.id) context.timeline.setSelectedZoomId(null);
		return { removed: region.id, undoable: true };
	},

	"zoom.clear": (payload, context) => {
		requireObject(payload, "zoom.clear");
		const count = context.timeline.zoomRegions.length;
		if (count === 0)
			return { removed: 0, note: "There were no zooms to clear.", undoable: false };
		context.timeline.setZoomRegions([]);
		context.timeline.setSelectedZoomId(null);
		return { removed: count, undoable: true };
	},
};
