import {
	ADVANCED_VERTICAL_PADDING_MAX,
	type CropRegion,
	type CursorClickEffectStyle,
	getTimelineDurationMs,
	type Padding,
	type WebcamCorner,
	type WebcamOverlaySettings,
	type WebcamPositionPreset,
	type ZoomMotionBlurTuning,
	type ZoomTransitionEasing,
} from "../../types";
import { midpointMs, requirePreviewFlag, withPreview } from "./previewAfterEdit";
import {
	type EditorOpContext,
	type EditorOpMap,
	rejectUnknown,
	requireFiniteNumber,
	requireObject,
} from "./types";

type Appearance = EditorOpContext["appearance"];
type Range = readonly [number, number];

const NOT_UNDOABLE =
	"Look settings are not part of the editor history, so history.undo will not revert this. Set the previous values again to go back.";

const EASINGS: ZoomTransitionEasing[] = ["recordly", "glide", "smooth", "snappy", "linear"];
const CLICK_EFFECTS: CursorClickEffectStyle[] = ["none", "spotlight", "ripple", "echo"];
const CURSOR_STYLES = ["macos", "tahoe", "tahoe-inverted", "windows11", "dot", "figma"];
const CORNERS: WebcamCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
const PRESETS: WebcamPositionPreset[] = [
	...CORNERS,
	"top-center",
	"center-left",
	"center",
	"center-right",
	"bottom-center",
	"custom",
];

const LOOK_PRESETS = ["clean", "dark", "none"] as const;
type LookPreset = (typeof LOOK_PRESETS)[number];

const MOTION_NUMBERS: Record<string, Range> = {
	zoomInDurationMs: [60, 4000],
	zoomOutDurationMs: [60, 4000],
	connectedZoomDurationMs: [60, 4000],
	connectedZoomGapMs: [0, 5000],
	zoomSmoothness: [0, 1],
	zoomMotionBlur: [0, 2],
	cursorSize: [0.5, 10],
	cursorSmoothing: [0, 2],
	cursorMotionBlur: [0, 2],
	cursorSway: [0, 2],
	cursorClickBounce: [0, 5],
	cursorClickBounceDuration: [60, 500],
	cursorClickEffectScale: [0.5, 2],
	cursorClickEffectOpacity: [0, 1],
	cursorClickEffectDurationMs: [120, 1200],
	cursorSpringStiffnessMultiplier: [0.25, 3],
	cursorSpringDampingMultiplier: [0.25, 3],
	cursorSpringMassMultiplier: [0.25, 3],
	cameraSpringStiffnessMultiplier: [0.25, 3],
	cameraSpringDampingMultiplier: [0.25, 3],
	cameraSpringMassMultiplier: [0.25, 3],
};

const MOTION_EASINGS = ["zoomInEasing", "zoomOutEasing", "connectedZoomEasing"];
const MOTION_BOOLEANS = ["zoomClassicMode", "connectZooms", "showCursor", "loopCursor"];
const BLUR_TUNING: Record<keyof ZoomMotionBlurTuning, Range> = {
	panVelocityThreshold: [0, 240],
	zoomVelocityThreshold: [0, 0.4],
	maxDirectionalBlurPx: [0, 96],
	maxRadialBlurStrength: [0, 1.5],
	panResponsePerSecond: [1, 30],
	zoomResponsePerSecond: [1, 30],
	zoomSafeZoneRadiusPx: [0, 80],
};

const WEBCAM_NUMBERS: Record<string, Range> = {
	size: [10, 100],
	width: [10, 100],
	height: [10, 100],
	roundness: [0, 100],
	shadow: [0, 1],
	margin: [0, 96],
	positionX: [0, 1],
	positionY: [0, 1],
};
const WEBCAM_BOOLEANS = ["enabled", "mirror", "reactToZoom"];
const WEBCAM_FIELDS = [
	...Object.keys(WEBCAM_NUMBERS),
	...WEBCAM_BOOLEANS,
	"timeOffsetMs",
	"corner",
	"positionPreset",
	"cropRegion",
];
const WEBCAM_READ_ONLY = ["sourcePath", "visibleRanges", "cornerRadius"] as const;

function requireInRange(value: unknown, field: string, [min, max]: Range) {
	const number = requireFiniteNumber(value, field);
	if (number < min || number > max) {
		throw new Error(`${field} must be between ${min} and ${max}, not ${number}.`);
	}
	return number;
}

function requireBoolean(value: unknown, field: string) {
	if (typeof value !== "boolean") throw new Error(`${field} must be true or false.`);
	return value;
}

function requireOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]) {
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(`${field} must be one of ${allowed.join(", ")}, not ${String(value)}.`);
	}
	return value as T;
}

function requireLookPresetName(value: unknown): LookPreset {
	return requireOneOf(value, "name", LOOK_PRESETS);
}

function requireCrop(value: unknown, field: string): CropRegion {
	const crop = requireObject(value, field);
	rejectUnknown(crop, ["x", "y", "width", "height"], field);
	const x = requireInRange(crop.x, `${field}.x`, [0, 1]);
	const y = requireInRange(crop.y, `${field}.y`, [0, 1]);
	const width = requireFiniteNumber(crop.width, `${field}.width`);
	const height = requireFiniteNumber(crop.height, `${field}.height`);
	if (width <= 0 || height <= 0) {
		throw new Error(
			`${field}: width and height are fractions of the frame and must be above 0.`,
		);
	}
	if (x + width > 1 + 1e-9 || y + height > 1 + 1e-9) {
		throw new Error(
			`${field}: x + width and y + height must not exceed 1 (the crop would be larger than the frame).`,
		);
	}
	return { x, y, width, height };
}

function requirePadding(value: unknown): Padding {
	if (typeof value === "number") {
		const all = requireInRange(value, "padding", [0, 100]);
		return { top: all, bottom: all, left: all, right: all, linked: true };
	}
	const padding = requireObject(value, "padding");
	rejectUnknown(padding, ["top", "bottom", "left", "right", "linked"], "padding");
	const linked =
		padding.linked === undefined ? false : requireBoolean(padding.linked, "padding.linked");
	const verticalMax = linked ? 100 : ADVANCED_VERTICAL_PADDING_MAX;
	const next = {
		top: requireInRange(padding.top, "padding.top", [0, verticalMax]),
		bottom: requireInRange(padding.bottom, "padding.bottom", [0, verticalMax]),
		left: requireInRange(padding.left, "padding.left", [0, 100]),
		right: requireInRange(padding.right, "padding.right", [0, 100]),
		linked,
	};
	if (linked && new Set([next.top, next.bottom, next.left, next.right]).size > 1) {
		throw new Error(
			"padding is linked, so top, bottom, left and right must all be equal. Set linked to false to give each side its own value.",
		);
	}
	return next;
}

function requireWebcam(value: unknown, current: WebcamOverlaySettings) {
	const args = requireObject(value, "webcam");
	rejectUnknown(args, [...WEBCAM_FIELDS, ...WEBCAM_READ_ONLY], "webcam");
	for (const key of WEBCAM_READ_ONLY) {
		if (args[key] !== undefined && JSON.stringify(args[key]) !== JSON.stringify(current[key])) {
			throw new Error(
				`webcam.${key} is read-only: it describes the recording and cannot be changed here. Leave it out, or send back the value get_editor_state reports.`,
			);
		}
	}
	const next: WebcamOverlaySettings = { ...current };
	const record = next as unknown as Record<string, unknown>;
	for (const [key, range] of Object.entries(WEBCAM_NUMBERS)) {
		if (args[key] !== undefined)
			record[key] = requireInRange(args[key], `webcam.${key}`, range);
	}
	for (const key of WEBCAM_BOOLEANS) {
		if (args[key] !== undefined) record[key] = requireBoolean(args[key], `webcam.${key}`);
	}
	if (args.timeOffsetMs !== undefined) {
		next.timeOffsetMs = Math.round(
			requireFiniteNumber(args.timeOffsetMs, "webcam.timeOffsetMs"),
		);
	}
	if (args.corner !== undefined)
		next.corner = requireOneOf(args.corner, "webcam.corner", CORNERS);
	if (args.positionPreset !== undefined) {
		next.positionPreset = requireOneOf(args.positionPreset, "webcam.positionPreset", PRESETS);
	}
	if (args.cropRegion !== undefined)
		next.cropRegion = requireCrop(args.cropRegion, "webcam.cropRegion");
	if (next.enabled && !next.sourcePath) {
		throw new Error(
			"webcam.enabled cannot be turned on because this project has no webcam recording to show.",
		);
	}
	return next;
}

function requireBlurTuning(value: unknown, current: ZoomMotionBlurTuning) {
	const args = requireObject(value, "zoomMotionBlurTuning");
	rejectUnknown(args, Object.keys(BLUR_TUNING), "zoomMotionBlurTuning");
	const next = { ...current };
	for (const [key, range] of Object.entries(BLUR_TUNING)) {
		if (args[key] !== undefined) {
			next[key as keyof ZoomMotionBlurTuning] = requireInRange(
				args[key],
				`zoomMotionBlurTuning.${key}`,
				range,
			);
		}
	}
	return next;
}

function setterName(key: string) {
	return `set${key[0].toUpperCase()}${key.slice(1)}`;
}

function applyAll(appearance: Appearance, updates: Record<string, unknown>, op: string) {
	const pending = Object.entries(updates).map(([key, value]) => {
		const setter = (appearance as unknown as Record<string, unknown>)[setterName(key)];
		if (typeof setter !== "function") {
			throw new Error(
				`${op}: this editor has no control for ${key}, so nothing was changed.`,
			);
		}
		return [setter as (v: unknown) => void, value] as const;
	});
	for (const [setter, value] of pending) setter(value);
}

function nonEmptyArgs(args: Record<string, unknown>, op: string) {
	if (Object.values(args).every((value) => value === undefined)) {
		throw new Error(`${op} needs at least one field to change.`);
	}
}

function lookMoment(context: EditorOpContext) {
	return {
		atMs: midpointMs(
			0,
			getTimelineDurationMs(
				context.timeline.clipRegions,
				Math.round(context.duration * 1000),
			),
			context,
		),
		why: "A look change has no moment of its own and the editor does not report a playhead, so this is the middle of the edited timeline. Pass render_preview an atMs to check it elsewhere, for example during a zoom or while the webcam shows.",
	};
}

export const lookOps: EditorOpMap = {
	"look.set": (payload, context) => {
		const { appearance } = context;
		const args = requireObject(payload, "look.set");
		rejectUnknown(
			args,
			[
				"wallpaper",
				"padding",
				"borderRadius",
				"shadowIntensity",
				"backgroundBlur",
				"crop",
				"cropRegion",
				"webcam",
				"preview",
			],
			"look.set",
		);
		const { preview: previewArg, ...changes } = args;
		const preview = requirePreviewFlag(previewArg);
		nonEmptyArgs(changes, "look.set");
		if (args.crop !== undefined && args.cropRegion !== undefined) {
			throw new Error("Send either crop or cropRegion, not both: they are the same setting.");
		}
		const updates: Record<string, unknown> = {};
		if (args.wallpaper !== undefined) {
			if (typeof args.wallpaper !== "string" || args.wallpaper.trim() === "") {
				throw new Error(
					"wallpaper must be a non-empty string: a wallpaper path, image URL or colour.",
				);
			}
			updates.wallpaper = args.wallpaper;
		}
		if (args.padding !== undefined) updates.padding = requirePadding(args.padding);
		if (args.borderRadius !== undefined) {
			updates.borderRadius = requireInRange(args.borderRadius, "borderRadius", [0, 50]);
		}
		if (args.shadowIntensity !== undefined) {
			updates.shadowIntensity = requireInRange(
				args.shadowIntensity,
				"shadowIntensity",
				[0, 1],
			);
		}
		if (args.backgroundBlur !== undefined) {
			updates.backgroundBlur = requireInRange(args.backgroundBlur, "backgroundBlur", [0, 8]);
		}
		const crop = args.crop === undefined ? args.cropRegion : args.crop;
		if (crop !== undefined) {
			updates.cropRegion = requireCrop(crop, args.crop === undefined ? "cropRegion" : "crop");
		}
		if (args.webcam !== undefined)
			updates.webcam = requireWebcam(args.webcam, appearance.webcam);
		applyAll(appearance, updates, "look.set");
		const { cropRegion, ...rest } = updates;
		return withPreview(
			{
				applied: cropRegion ? { ...rest, crop: cropRegion } : rest,
				undoable: false,
				note: NOT_UNDOABLE,
			},
			preview,
			context,
			{ appearance: updates as Partial<Appearance> },
			() => lookMoment(context),
		);
	},

	"look.motion": (payload, { appearance }) => {
		const args = requireObject(payload, "look.motion");
		const numberKeys = [...Object.keys(MOTION_NUMBERS), "zoomInOverlapMs"];
		rejectUnknown(
			args,
			[
				...numberKeys,
				...MOTION_EASINGS,
				...MOTION_BOOLEANS,
				"cursorStyle",
				"cursorClickEffect",
				"zoomMotionBlurTuning",
			],
			"look.motion",
		);
		nonEmptyArgs(args, "look.motion");
		const updates: Record<string, unknown> = {};
		for (const [key, range] of Object.entries(MOTION_NUMBERS)) {
			if (args[key] !== undefined) updates[key] = requireInRange(args[key], key, range);
		}
		for (const key of MOTION_EASINGS) {
			if (args[key] !== undefined) updates[key] = requireOneOf(args[key], key, EASINGS);
		}
		for (const key of MOTION_BOOLEANS) {
			if (args[key] !== undefined) updates[key] = requireBoolean(args[key], key);
		}
		if (args.cursorStyle !== undefined) {
			updates.cursorStyle = requireOneOf(args.cursorStyle, "cursorStyle", CURSOR_STYLES);
		}
		if (args.cursorClickEffect !== undefined) {
			updates.cursorClickEffect = requireOneOf(
				args.cursorClickEffect,
				"cursorClickEffect",
				CLICK_EFFECTS,
			);
		}
		if (args.zoomMotionBlurTuning !== undefined) {
			updates.zoomMotionBlurTuning = requireBlurTuning(
				args.zoomMotionBlurTuning,
				appearance.zoomMotionBlurTuning,
			);
		}
		if (args.zoomInOverlapMs !== undefined || updates.zoomInDurationMs !== undefined) {
			const duration = (updates.zoomInDurationMs ?? appearance.zoomInDurationMs) as number;
			const overlap =
				args.zoomInOverlapMs === undefined
					? appearance.zoomInOverlapMs
					: requireInRange(args.zoomInOverlapMs, "zoomInOverlapMs", [0, 4000]);
			if (overlap > duration) {
				throw new Error(
					`zoomInOverlapMs (${overlap}) cannot be longer than zoomInDurationMs (${duration}).`,
				);
			}
			if (args.zoomInOverlapMs !== undefined) updates.zoomInOverlapMs = overlap;
		}
		applyAll(appearance, updates, "look.motion");
		return { applied: updates, undoable: false, note: NOT_UNDOABLE };
	},

	"look.preset": (payload, context) => {
		const { appearance } = context;
		const args = requireObject(payload, "look.preset");
		rejectUnknown(args, ["name", "preview"], "look.preset");
		const preview = requirePreviewFlag(args.preview);

		if (args.name === undefined) {
			throw new Error("look.preset: name is required.");
		}

		const name = requireLookPresetName(args.name);

		const updates: Record<string, unknown> = {};

		if (name === "clean") {
			updates.padding = 4;
			updates.borderRadius = 12;
			updates.shadowIntensity = 0.35;
			updates.backgroundBlur = 0;
		} else if (name === "dark") {
			updates.padding = 4;
			updates.borderRadius = 12;
			updates.shadowIntensity = 0.5;
			updates.backgroundBlur = 2;
			updates.wallpaper = "/wallpapers/tahoe-dark.jpg";
		} else if (name === "none") {
			updates.padding = 0;
			updates.borderRadius = 0;
			updates.shadowIntensity = 0;
			updates.backgroundBlur = 0;
		}

		const processedUpdates: Record<string, unknown> = {};
		if (updates.padding !== undefined)
			processedUpdates.padding = requirePadding(updates.padding);
		if (updates.borderRadius !== undefined) {
			processedUpdates.borderRadius = requireInRange(
				updates.borderRadius,
				"borderRadius",
				[0, 50],
			);
		}
		if (updates.shadowIntensity !== undefined) {
			processedUpdates.shadowIntensity = requireInRange(
				updates.shadowIntensity,
				"shadowIntensity",
				[0, 1],
			);
		}
		if (updates.backgroundBlur !== undefined) {
			processedUpdates.backgroundBlur = requireInRange(
				updates.backgroundBlur,
				"backgroundBlur",
				[0, 8],
			);
		}
		if (updates.wallpaper !== undefined) {
			if (typeof updates.wallpaper !== "string" || updates.wallpaper.trim() === "") {
				throw new Error(
					"wallpaper must be a non-empty string: a wallpaper path, image URL or colour.",
				);
			}
			processedUpdates.wallpaper = updates.wallpaper;
		}

		applyAll(appearance, processedUpdates, "look.preset");
		return withPreview(
			{ applied: processedUpdates, undoable: false, note: NOT_UNDOABLE },
			preview,
			context,
			{ appearance: processedUpdates as Partial<Appearance> },
			() => lookMoment(context),
		);
	},
};
