import { DESKTOP_WALLPAPER } from "@/lib/desktopWallpaper";
import { hasElectronAppSettings, loadAppSetting, saveAppSetting } from "../../lib/appSettings";
import { normalizeCustomGradients } from "./customGradients";
import { type ExportPreferences, normalizeExportPreferences } from "./exportPreferences";
import {
	getDefaultBorderRadiusPercent,
	legacyBorderRadiusPixelsToPercent,
	normalizePadding,
	normalizeProjectEditor,
	type ProjectEditorState,
	stripPersistedDevMotionBlurSettings,
} from "./projectPersistence";
import {
	type CaptureSourceKind,
	DEFAULT_PADDING,
	DEFAULT_WINDOW_PADDING,
	getDefaultPaddingForCaptureSource,
	type Padding,
	WEBCAM_ROUNDNESS_VERSION,
} from "./types";

type PersistedEditorControls = Pick<
	ProjectEditorState,
	| "wallpaper"
	| "shadowIntensity"
	| "backgroundBlur"
	| "zoomMotionBlur"
	| "zoomMotionBlurTuning"
	| "connectZooms"
	| "zoomInDurationMs"
	| "zoomInOverlapMs"
	| "zoomOutDurationMs"
	| "connectedZoomGapMs"
	| "connectedZoomDurationMs"
	| "zoomInEasing"
	| "zoomOutEasing"
	| "connectedZoomEasing"
	| "showCursor"
	| "loopCursor"
	| "alwaysUsePointerCursor"
	| "cursorStyle"
	| "cursorSize"
	| "cursorSmoothing"
	| "cursorSpringStiffnessMultiplier"
	| "cursorSpringDampingMultiplier"
	| "cursorSpringMassMultiplier"
	| "cameraSpringStiffnessMultiplier"
	| "cameraSpringDampingMultiplier"
	| "cameraSpringMassMultiplier"
	| "cursorMotionBlur"
	| "cursorClickEffect"
	| "cursorClickEffectColor"
	| "cursorClickEffectScale"
	| "cursorClickEffectOpacity"
	| "cursorClickEffectDurationMs"
	| "cursorClickBounce"
	| "cursorClickBounceDuration"
	| "cursorSway"
	| "cursorIdleHide"
	| "borderRadius"
	| "padding"
	| "webcam"
	| "aspectRatio"
>;

type PartialEditorControls = Partial<PersistedEditorControls>;

type PresetAutoCaptionSettings = ProjectEditorState["autoCaptionSettings"];
type PresetCropRegion = ProjectEditorState["cropRegion"];
type PresetWebcamSettings = Omit<
	ProjectEditorState["webcam"],
	"sourcePath" | "visibleRanges" | "loop"
>;

export interface EditorPresetSnapshot extends Omit<PersistedEditorControls, "webcam"> {
	borderRadiusUnit: "percent";
	cropRegion: PresetCropRegion;
	webcam?: PresetWebcamSettings;
	autoCaptionSettings: PresetAutoCaptionSettings;
}

export interface EditorPreset {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	snapshot: EditorPresetSnapshot;
}

export interface EditorPreferences
	extends Omit<PersistedEditorControls, "padding">,
		ExportPreferences {
	/** Last padding used for display and area recordings. */
	screenPadding: Padding;
	/** Last padding used for window recordings. */
	windowPadding: Padding;
	autoApplyFreshRecordingAutoZooms: boolean;
	borderRadiusUnit: "percent";
	customAspectWidth: string;
	customAspectHeight: string;
	customWallpapers: string[];
	customGradients: string[];
	customColors: string[];
	whisperExecutablePath: string | null;
	whisperModelPath: string | null;
}

const LEGACY_EDITOR_PREFERENCES_STORAGE_KEY = "recordly.editor.preferences";
export const EDITOR_PREFERENCES_STORAGE_KEY = "recordly.editor.preferences.v2";
export const EDITOR_PRESETS_STORAGE_KEY = "recordly.editor.presets";

const DEFAULT_EDITOR_CONTROLS = normalizeProjectEditor({});

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
	autoApplyFreshRecordingAutoZooms: true,
	wallpaper: DESKTOP_WALLPAPER,
	shadowIntensity: DEFAULT_EDITOR_CONTROLS.shadowIntensity,
	backgroundBlur: DEFAULT_EDITOR_CONTROLS.backgroundBlur,
	zoomMotionBlur: DEFAULT_EDITOR_CONTROLS.zoomMotionBlur,
	zoomMotionBlurTuning: DEFAULT_EDITOR_CONTROLS.zoomMotionBlurTuning,
	connectZooms: DEFAULT_EDITOR_CONTROLS.connectZooms,
	zoomInDurationMs: DEFAULT_EDITOR_CONTROLS.zoomInDurationMs,
	zoomInOverlapMs: DEFAULT_EDITOR_CONTROLS.zoomInOverlapMs,
	zoomOutDurationMs: DEFAULT_EDITOR_CONTROLS.zoomOutDurationMs,
	connectedZoomGapMs: DEFAULT_EDITOR_CONTROLS.connectedZoomGapMs,
	connectedZoomDurationMs: DEFAULT_EDITOR_CONTROLS.connectedZoomDurationMs,
	zoomInEasing: DEFAULT_EDITOR_CONTROLS.zoomInEasing,
	zoomOutEasing: DEFAULT_EDITOR_CONTROLS.zoomOutEasing,
	connectedZoomEasing: DEFAULT_EDITOR_CONTROLS.connectedZoomEasing,
	showCursor: DEFAULT_EDITOR_CONTROLS.showCursor,
	loopCursor: DEFAULT_EDITOR_CONTROLS.loopCursor,
	alwaysUsePointerCursor: DEFAULT_EDITOR_CONTROLS.alwaysUsePointerCursor,
	cursorStyle: DEFAULT_EDITOR_CONTROLS.cursorStyle,
	cursorSize: DEFAULT_EDITOR_CONTROLS.cursorSize,
	cursorSmoothing: DEFAULT_EDITOR_CONTROLS.cursorSmoothing,
	cursorSpringStiffnessMultiplier: DEFAULT_EDITOR_CONTROLS.cursorSpringStiffnessMultiplier,
	cursorSpringDampingMultiplier: DEFAULT_EDITOR_CONTROLS.cursorSpringDampingMultiplier,
	cursorSpringMassMultiplier: DEFAULT_EDITOR_CONTROLS.cursorSpringMassMultiplier,
	cameraSpringStiffnessMultiplier: DEFAULT_EDITOR_CONTROLS.cameraSpringStiffnessMultiplier,
	cameraSpringDampingMultiplier: DEFAULT_EDITOR_CONTROLS.cameraSpringDampingMultiplier,
	cameraSpringMassMultiplier: DEFAULT_EDITOR_CONTROLS.cameraSpringMassMultiplier,
	cursorMotionBlur: DEFAULT_EDITOR_CONTROLS.cursorMotionBlur,
	cursorClickEffect: DEFAULT_EDITOR_CONTROLS.cursorClickEffect,
	cursorClickEffectColor: DEFAULT_EDITOR_CONTROLS.cursorClickEffectColor,
	cursorClickEffectScale: DEFAULT_EDITOR_CONTROLS.cursorClickEffectScale,
	cursorClickEffectOpacity: DEFAULT_EDITOR_CONTROLS.cursorClickEffectOpacity,
	cursorClickEffectDurationMs: DEFAULT_EDITOR_CONTROLS.cursorClickEffectDurationMs,
	cursorClickBounce: DEFAULT_EDITOR_CONTROLS.cursorClickBounce,
	cursorClickBounceDuration: DEFAULT_EDITOR_CONTROLS.cursorClickBounceDuration,
	cursorSway: DEFAULT_EDITOR_CONTROLS.cursorSway,
	cursorIdleHide: DEFAULT_EDITOR_CONTROLS.cursorIdleHide,
	borderRadius: DEFAULT_EDITOR_CONTROLS.borderRadius,
	borderRadiusUnit: "percent",
	screenPadding: { ...DEFAULT_PADDING },
	windowPadding: { ...DEFAULT_WINDOW_PADDING },
	webcam: DEFAULT_EDITOR_CONTROLS.webcam,
	aspectRatio: DEFAULT_EDITOR_CONTROLS.aspectRatio,
	...normalizeExportPreferences({}),
	customAspectWidth: "16",
	customAspectHeight: "9",
	customWallpapers: [],
	customGradients: [],
	customColors: [],
	whisperExecutablePath: null,
	whisperModelPath: null,
};

function normalizePositiveIntegerString(value: unknown, fallback: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}

	return String(parsed);
}

function normalizeCustomWallpapers(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) {
		return fallback;
	}

	return Array.from(
		new Set(
			value.filter((item): item is string => typeof item === "string" && item.length > 0),
		),
	);
}

function normalizeNullablePath(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function normalizePresetAutoCaptionSettings(value: unknown): PresetAutoCaptionSettings {
	return normalizeProjectEditor({
		autoCaptionSettings:
			value && typeof value === "object" ? (value as PresetAutoCaptionSettings) : undefined,
	}).autoCaptionSettings;
}

export function normalizeEditorPresetSnapshot(candidate: unknown): EditorPresetSnapshot {
	const normalizedPreferences = normalizeEditorPreferences(candidate);
	const raw =
		candidate && typeof candidate === "object"
			? (candidate as Partial<EditorPresetSnapshot>)
			: {};
	const normalizedCropRegion = normalizeProjectEditor({
		cropRegion: raw.cropRegion,
	}).cropRegion;
	const normalizedControls = normalizeEditorControls(
		{ ...normalizedPreferences, padding: raw.padding },
		{ ...normalizedPreferences, padding: DEFAULT_PADDING },
	);
	const { webcam: normalizedWebcam, ...sceneControls } = normalizedControls;
	const {
		sourcePath: _sourcePath,
		visibleRanges: _visibleRanges,
		loop: _loop,
		...webcam
	} = normalizedWebcam;

	return {
		...sceneControls,
		borderRadiusUnit: "percent",
		// Only apply webcam values saved with the current shape system.
		...(raw.webcam?.roundnessVersion === WEBCAM_ROUNDNESS_VERSION ? { webcam } : {}),
		cropRegion: normalizedCropRegion,
		autoCaptionSettings: normalizePresetAutoCaptionSettings(raw.autoCaptionSettings),
	};
}

export function getDefaultEditorPresetSnapshot(
	captureSourceKind: CaptureSourceKind | null,
	wallpaper: string,
): EditorPresetSnapshot {
	return normalizeEditorPresetSnapshot({
		...DEFAULT_EDITOR_PREFERENCES,
		padding: getDefaultPaddingForCaptureSource(captureSourceKind),
		wallpaper,
		webcam: undefined,
	});
}

function normalizePresetName(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim().replace(/\s+/g, " ");
	return trimmed.length > 0 ? trimmed : null;
}

function normalizePresetTimestamp(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}

	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeEditorPreset(candidate: unknown): EditorPreset | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const raw = candidate as Partial<EditorPreset>;
	const name = normalizePresetName(raw.name);
	if (!name) {
		return null;
	}

	const timestamp = new Date().toISOString();
	const id =
		typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id : crypto.randomUUID();

	return {
		id,
		name,
		createdAt: normalizePresetTimestamp(raw.createdAt, timestamp),
		updatedAt: normalizePresetTimestamp(raw.updatedAt, timestamp),
		snapshot: normalizeEditorPresetSnapshot(raw.snapshot),
	};
}

function normalizeEditorPresets(candidates: unknown): EditorPreset[] {
	if (!Array.isArray(candidates)) {
		return [];
	}

	return candidates
		.map((item) => normalizeEditorPreset(item))
		.filter((preset): preset is EditorPreset => preset !== null)
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function serializeEditorPresetSnapshot(snapshot: EditorPresetSnapshot): string {
	return JSON.stringify(normalizeEditorPresetSnapshot(snapshot));
}

function normalizeEditorControls(
	raw: PartialEditorControls,
	fallback: PersistedEditorControls,
): PersistedEditorControls {
	const sanitizedRaw = stripPersistedDevMotionBlurSettings(raw);
	const candidate: PartialEditorControls = {
		wallpaper:
			typeof sanitizedRaw.wallpaper === "string"
				? sanitizedRaw.wallpaper
				: fallback.wallpaper,
		shadowIntensity: sanitizedRaw.shadowIntensity ?? fallback.shadowIntensity,
		backgroundBlur: sanitizedRaw.backgroundBlur ?? fallback.backgroundBlur,
		zoomMotionBlur: sanitizedRaw.zoomMotionBlur ?? fallback.zoomMotionBlur,
		connectZooms: sanitizedRaw.connectZooms ?? fallback.connectZooms,
		zoomInDurationMs: sanitizedRaw.zoomInDurationMs ?? fallback.zoomInDurationMs,
		zoomInOverlapMs: sanitizedRaw.zoomInOverlapMs ?? fallback.zoomInOverlapMs,
		zoomOutDurationMs: sanitizedRaw.zoomOutDurationMs ?? fallback.zoomOutDurationMs,
		connectedZoomGapMs: sanitizedRaw.connectedZoomGapMs ?? fallback.connectedZoomGapMs,
		connectedZoomDurationMs:
			sanitizedRaw.connectedZoomDurationMs ?? fallback.connectedZoomDurationMs,
		zoomInEasing: sanitizedRaw.zoomInEasing ?? fallback.zoomInEasing,
		zoomOutEasing: sanitizedRaw.zoomOutEasing ?? fallback.zoomOutEasing,
		connectedZoomEasing: sanitizedRaw.connectedZoomEasing ?? fallback.connectedZoomEasing,
		showCursor: sanitizedRaw.showCursor ?? fallback.showCursor,
		loopCursor: sanitizedRaw.loopCursor ?? fallback.loopCursor,
		alwaysUsePointerCursor:
			sanitizedRaw.alwaysUsePointerCursor ?? fallback.alwaysUsePointerCursor,
		cursorStyle: sanitizedRaw.cursorStyle ?? fallback.cursorStyle,
		cursorSize: sanitizedRaw.cursorSize ?? fallback.cursorSize,
		cursorSmoothing: sanitizedRaw.cursorSmoothing ?? fallback.cursorSmoothing,
		cursorSpringStiffnessMultiplier:
			sanitizedRaw.cursorSpringStiffnessMultiplier ??
			fallback.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier:
			sanitizedRaw.cursorSpringDampingMultiplier ?? fallback.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier:
			sanitizedRaw.cursorSpringMassMultiplier ?? fallback.cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier:
			sanitizedRaw.cameraSpringStiffnessMultiplier ??
			fallback.cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier:
			sanitizedRaw.cameraSpringDampingMultiplier ?? fallback.cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier:
			sanitizedRaw.cameraSpringMassMultiplier ?? fallback.cameraSpringMassMultiplier,
		cursorMotionBlur: sanitizedRaw.cursorMotionBlur ?? fallback.cursorMotionBlur,
		cursorClickEffect: sanitizedRaw.cursorClickEffect ?? fallback.cursorClickEffect,
		cursorClickEffectColor:
			sanitizedRaw.cursorClickEffectColor ?? fallback.cursorClickEffectColor,
		cursorClickEffectScale:
			sanitizedRaw.cursorClickEffectScale ?? fallback.cursorClickEffectScale,
		cursorClickEffectOpacity:
			sanitizedRaw.cursorClickEffectOpacity ?? fallback.cursorClickEffectOpacity,
		cursorClickEffectDurationMs:
			sanitizedRaw.cursorClickEffectDurationMs ?? fallback.cursorClickEffectDurationMs,
		cursorClickBounce: sanitizedRaw.cursorClickBounce ?? fallback.cursorClickBounce,
		cursorClickBounceDuration:
			sanitizedRaw.cursorClickBounceDuration ?? fallback.cursorClickBounceDuration,
		cursorSway: sanitizedRaw.cursorSway ?? fallback.cursorSway,
		cursorIdleHide: sanitizedRaw.cursorIdleHide ?? fallback.cursorIdleHide,
		borderRadius: sanitizedRaw.borderRadius ?? fallback.borderRadius,
		padding: sanitizedRaw.padding ?? fallback.padding,
		webcam: sanitizedRaw.webcam ?? fallback.webcam,
		aspectRatio: sanitizedRaw.aspectRatio ?? fallback.aspectRatio,
	};

	const normalized = normalizeProjectEditor(candidate);

	return {
		wallpaper: normalized.wallpaper,
		shadowIntensity: normalized.shadowIntensity,
		backgroundBlur: normalized.backgroundBlur,
		zoomMotionBlur: normalized.zoomMotionBlur,
		zoomMotionBlurTuning: normalized.zoomMotionBlurTuning,
		connectZooms: normalized.connectZooms,
		zoomInDurationMs: normalized.zoomInDurationMs,
		zoomInOverlapMs: normalized.zoomInOverlapMs,
		zoomOutDurationMs: normalized.zoomOutDurationMs,
		connectedZoomGapMs: normalized.connectedZoomGapMs,
		connectedZoomDurationMs: normalized.connectedZoomDurationMs,
		zoomInEasing: normalized.zoomInEasing,
		zoomOutEasing: normalized.zoomOutEasing,
		connectedZoomEasing: normalized.connectedZoomEasing,
		showCursor: normalized.showCursor,
		loopCursor: normalized.loopCursor,
		alwaysUsePointerCursor: normalized.alwaysUsePointerCursor,
		cursorStyle: normalized.cursorStyle,
		cursorSize: normalized.cursorSize,
		cursorSmoothing: normalized.cursorSmoothing,
		cursorSpringStiffnessMultiplier: normalized.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: normalized.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: normalized.cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: normalized.cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier: normalized.cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier: normalized.cameraSpringMassMultiplier,
		cursorMotionBlur: normalized.cursorMotionBlur,
		cursorClickEffect: normalized.cursorClickEffect,
		cursorClickEffectColor: normalized.cursorClickEffectColor,
		cursorClickEffectScale: normalized.cursorClickEffectScale,
		cursorClickEffectOpacity: normalized.cursorClickEffectOpacity,
		cursorClickEffectDurationMs: normalized.cursorClickEffectDurationMs,
		cursorClickBounce: normalized.cursorClickBounce,
		cursorClickBounceDuration: normalized.cursorClickBounceDuration,
		cursorSway: normalized.cursorSway,
		cursorIdleHide: normalized.cursorIdleHide,
		borderRadius: normalized.borderRadius,
		padding: normalized.padding,
		webcam: {
			...normalized.webcam,
			shape:
				sanitizedRaw.webcam?.shape == null
					? fallback.webcam.shape
					: normalized.webcam.shape,
		},
		aspectRatio: normalized.aspectRatio,
	};
}

export function normalizeEditorPreferences(
	candidate: unknown,
	fallback: EditorPreferences = DEFAULT_EDITOR_PREFERENCES,
): EditorPreferences {
	const raw =
		candidate && typeof candidate === "object" ? (candidate as Partial<EditorPreferences>) : {};
	const controls =
		raw.borderRadiusUnit === "percent" || typeof raw.borderRadius !== "number"
			? raw
			: {
					...raw,
					borderRadius:
						raw.borderRadius === 0
							? getDefaultBorderRadiusPercent()
							: legacyBorderRadiusPixelsToPercent(raw.borderRadius),
				};

	const { padding: _sharedPadding, ...normalizedControls } = normalizeEditorControls(controls, {
		...fallback,
		padding: fallback.screenPadding,
	});

	return {
		...normalizedControls,
		screenPadding: normalizePadding(raw.screenPadding, fallback.screenPadding),
		windowPadding: normalizePadding(raw.windowPadding, fallback.windowPadding),
		...normalizeExportPreferences({ ...fallback, ...raw }),
		borderRadiusUnit: "percent",
		customAspectWidth: normalizePositiveIntegerString(
			raw.customAspectWidth,
			fallback.customAspectWidth,
		),
		customAspectHeight: normalizePositiveIntegerString(
			raw.customAspectHeight,
			fallback.customAspectHeight,
		),
		customWallpapers: normalizeCustomWallpapers(
			raw.customWallpapers,
			fallback.customWallpapers,
		),
		customGradients: normalizeCustomGradients(raw.customGradients ?? fallback.customGradients),
		customColors: normalizeCustomColors(raw.customColors ?? fallback.customColors),
		autoApplyFreshRecordingAutoZooms:
			typeof raw.autoApplyFreshRecordingAutoZooms === "boolean"
				? raw.autoApplyFreshRecordingAutoZooms
				: fallback.autoApplyFreshRecordingAutoZooms,
		whisperExecutablePath:
			normalizeNullablePath(raw.whisperExecutablePath) ?? fallback.whisperExecutablePath,
		whisperModelPath: normalizeNullablePath(raw.whisperModelPath) ?? fallback.whisperModelPath,
	};
}

function isEditorPreferenceRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStoredEditorPreferences(key: string): Record<string, unknown> | null {
	const persisted = loadAppSetting<unknown>(key);
	if (isEditorPreferenceRecord(persisted)) return persisted;
	try {
		const stored = globalThis.localStorage?.getItem(key);
		const parsed: unknown = stored ? JSON.parse(stored) : null;
		return isEditorPreferenceRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function loadEditorPreferences(): EditorPreferences {
	const current = readStoredEditorPreferences(EDITOR_PREFERENCES_STORAGE_KEY);
	if (current !== null) return normalizeEditorPreferences(current);

	const previous = readStoredEditorPreferences(LEGACY_EDITOR_PREFERENCES_STORAGE_KEY);
	if (!previous) return DEFAULT_EDITOR_PREFERENCES;

	// Retain the saved scene appearance while adopting the new export and motion defaults.
	const {
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		borderRadius,
		screenPadding,
		windowPadding,
		customWallpapers,
		customGradients,
		customColors,
		whisperExecutablePath,
		whisperModelPath,
	} = normalizeEditorPreferences(previous);
	return {
		...DEFAULT_EDITOR_PREFERENCES,
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		borderRadius,
		screenPadding,
		windowPadding,
		customWallpapers,
		customGradients,
		customColors,
		whisperExecutablePath,
		whisperModelPath,
	};
}

export function getPaddingPreference(
	preferences: Pick<EditorPreferences, "screenPadding" | "windowPadding">,
	kind: CaptureSourceKind | null,
): Padding {
	return { ...(kind === "window" ? preferences.windowPadding : preferences.screenPadding) };
}

export type EditorPreferencesPatch = Omit<Partial<EditorPreferences>, "webcam"> & {
	webcam?: Partial<EditorPreferences["webcam"]>;
};

export function saveEditorPreferences(preferences: EditorPreferencesPatch): void {
	try {
		const current = loadEditorPreferences();
		const merged = normalizeEditorPreferences(
			{
				...current,
				...preferences,
				webcam: { ...current.webcam, ...preferences.webcam },
			},
			current,
		);
		const persisted = stripPersistedDevMotionBlurSettings(merged);
		saveAppSetting(EDITOR_PREFERENCES_STORAGE_KEY, persisted);
		saveLocalStorageJson(EDITOR_PREFERENCES_STORAGE_KEY, persisted);
	} catch {
		// Ignore storage failures so editor controls still work.
	}
}

function saveLocalStorageJson(key: string, value: unknown): boolean {
	try {
		if (typeof globalThis.localStorage === "undefined") {
			return false;
		}

		globalThis.localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

export function loadEditorPresets(): EditorPreset[] {
	const persisted = loadAppSetting<unknown>(EDITOR_PRESETS_STORAGE_KEY);
	if (persisted !== null) {
		return normalizeEditorPresets(persisted);
	}

	try {
		const stored = globalThis.localStorage?.getItem(EDITOR_PRESETS_STORAGE_KEY);
		if (!stored) {
			return [];
		}

		return normalizeEditorPresets(JSON.parse(stored));
	} catch {
		return [];
	}
}

export function saveEditorPresets(presets: EditorPreset[]): boolean {
	try {
		const normalized = normalizeEditorPresets(presets);
		const hasDesktopStore = hasElectronAppSettings();
		if (hasDesktopStore && !saveAppSetting(EDITOR_PRESETS_STORAGE_KEY, normalized))
			return false;
		return saveLocalStorageJson(EDITOR_PRESETS_STORAGE_KEY, normalized) || hasDesktopStore;
	} catch {
		// Ignore storage failures so editor controls still work.
		return false;
	}
}

function normalizeCustomColors(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value
				.filter(
					(color): color is string =>
						typeof color === "string" && /^#[\da-f]{6}$/i.test(color),
				)
				.map((color) => color.toLowerCase()),
		),
	].slice(0, 50);
}
