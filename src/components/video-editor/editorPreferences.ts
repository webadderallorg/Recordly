import {
	normalizeExportBackendPreference,
	normalizeExportMp4FrameRate,
	normalizeExportPipelineModel,
	normalizeProjectEditor,
	type ProjectEditorState,
} from "./projectPersistence";

type PersistedEditorControls = Pick<
	ProjectEditorState,
	| "wallpaper"
	| "shadowIntensity"
	| "backgroundBlur"
	| "zoomMotionBlur"
	| "zoomTemporalMotionBlur"
	| "zoomMotionBlurSampleCount"
	| "zoomMotionBlurShutterFraction"
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
	| "cursorStyle"
	| "cursorSize"
	| "cursorSmoothing"
	| "cursorSpringStiffnessMultiplier"
	| "cursorSpringDampingMultiplier"
	| "cursorSpringMassMultiplier"
	| "cursorMotionBlur"
	| "cursorClickBounce"
	| "cursorClickBounceDuration"
	| "cursorSway"
	| "borderRadius"
	| "padding"
	| "frame"
	| "webcam"
	| "aspectRatio"
	| "exportEncodingMode"
	| "exportBackendPreference"
	| "exportPipelineModel"
	| "exportQuality"
	| "mp4FrameRate"
	| "exportFormat"
	| "gifFrameRate"
	| "gifLoop"
	| "gifSizePreset"
>;

type PartialEditorControls = Partial<PersistedEditorControls>;

type PresetAutoCaptionSettings = ProjectEditorState["autoCaptionSettings"];

export interface EditorPresetSnapshot extends PersistedEditorControls {
	autoCaptionSettings: PresetAutoCaptionSettings;
	whisperExecutablePath: string | null;
	whisperModelPath: string | null;
}

export interface EditorPreset {
	id: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	snapshot: EditorPresetSnapshot;
}

export interface EditorPreferences extends PersistedEditorControls {
	customAspectWidth: string;
	customAspectHeight: string;
	customWallpapers: string[];
	autoApplyFreshRecordingAutoZooms: boolean;
	whisperExecutablePath: string | null;
	whisperModelPath: string | null;
}

export const EDITOR_PREFERENCES_STORAGE_KEY = "recordly.editor.preferences";
export const EDITOR_PRESETS_STORAGE_KEY = "recordly.editor.presets";

const DEFAULT_EDITOR_CONTROLS = normalizeProjectEditor({});

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
	wallpaper: DEFAULT_EDITOR_CONTROLS.wallpaper,
	shadowIntensity: DEFAULT_EDITOR_CONTROLS.shadowIntensity,
	backgroundBlur: DEFAULT_EDITOR_CONTROLS.backgroundBlur,
	zoomMotionBlur: DEFAULT_EDITOR_CONTROLS.zoomMotionBlur,
	zoomTemporalMotionBlur: DEFAULT_EDITOR_CONTROLS.zoomTemporalMotionBlur,
	zoomMotionBlurSampleCount: DEFAULT_EDITOR_CONTROLS.zoomMotionBlurSampleCount,
	zoomMotionBlurShutterFraction: DEFAULT_EDITOR_CONTROLS.zoomMotionBlurShutterFraction,
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
	cursorStyle: DEFAULT_EDITOR_CONTROLS.cursorStyle,
	cursorSize: DEFAULT_EDITOR_CONTROLS.cursorSize,
	cursorSmoothing: DEFAULT_EDITOR_CONTROLS.cursorSmoothing,
	cursorSpringStiffnessMultiplier: DEFAULT_EDITOR_CONTROLS.cursorSpringStiffnessMultiplier,
	cursorSpringDampingMultiplier: DEFAULT_EDITOR_CONTROLS.cursorSpringDampingMultiplier,
	cursorSpringMassMultiplier: DEFAULT_EDITOR_CONTROLS.cursorSpringMassMultiplier,
	cursorMotionBlur: DEFAULT_EDITOR_CONTROLS.cursorMotionBlur,
	cursorClickBounce: DEFAULT_EDITOR_CONTROLS.cursorClickBounce,
	cursorClickBounceDuration: DEFAULT_EDITOR_CONTROLS.cursorClickBounceDuration,
	cursorSway: DEFAULT_EDITOR_CONTROLS.cursorSway,
	borderRadius: DEFAULT_EDITOR_CONTROLS.borderRadius,
	padding: DEFAULT_EDITOR_CONTROLS.padding,
	frame: DEFAULT_EDITOR_CONTROLS.frame,
	webcam: DEFAULT_EDITOR_CONTROLS.webcam,
	aspectRatio: DEFAULT_EDITOR_CONTROLS.aspectRatio,
	exportEncodingMode: DEFAULT_EDITOR_CONTROLS.exportEncodingMode,
	exportBackendPreference: DEFAULT_EDITOR_CONTROLS.exportBackendPreference,
	exportPipelineModel: DEFAULT_EDITOR_CONTROLS.exportPipelineModel,
	exportQuality: DEFAULT_EDITOR_CONTROLS.exportQuality,
	mp4FrameRate: DEFAULT_EDITOR_CONTROLS.mp4FrameRate,
	exportFormat: DEFAULT_EDITOR_CONTROLS.exportFormat,
	gifFrameRate: DEFAULT_EDITOR_CONTROLS.gifFrameRate,
	gifLoop: DEFAULT_EDITOR_CONTROLS.gifLoop,
	gifSizePreset: DEFAULT_EDITOR_CONTROLS.gifSizePreset,
	customAspectWidth: "16",
	customAspectHeight: "9",
	customWallpapers: [],
	autoApplyFreshRecordingAutoZooms: true,
	whisperExecutablePath: null,
	whisperModelPath: null,
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

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

function normalizeEditorPresetSnapshot(candidate: unknown): EditorPresetSnapshot {
	const normalizedPreferences = normalizeEditorPreferences(candidate);
	const raw =
		candidate && typeof candidate === "object"
			? (candidate as Partial<EditorPresetSnapshot>)
			: {};

	return {
		...normalizeEditorControls(normalizedPreferences, normalizedPreferences),
		autoCaptionSettings: normalizePresetAutoCaptionSettings(raw.autoCaptionSettings),
		whisperExecutablePath:
			normalizeNullablePath(raw.whisperExecutablePath) ??
			normalizedPreferences.whisperExecutablePath,
		whisperModelPath:
			normalizeNullablePath(raw.whisperModelPath) ?? normalizedPreferences.whisperModelPath,
	};
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
	raw: Partial<EditorPreferences>,
	fallback: EditorPreferences,
): PersistedEditorControls {
	const candidate: PartialEditorControls = {
		wallpaper: raw.wallpaper ?? fallback.wallpaper,
		shadowIntensity: raw.shadowIntensity ?? fallback.shadowIntensity,
		backgroundBlur: raw.backgroundBlur ?? fallback.backgroundBlur,
		zoomMotionBlur: raw.zoomMotionBlur ?? fallback.zoomMotionBlur,
		zoomTemporalMotionBlur: raw.zoomTemporalMotionBlur ?? fallback.zoomTemporalMotionBlur,
		zoomMotionBlurSampleCount:
			raw.zoomMotionBlurSampleCount ?? fallback.zoomMotionBlurSampleCount,
		zoomMotionBlurShutterFraction:
			raw.zoomMotionBlurShutterFraction ?? fallback.zoomMotionBlurShutterFraction,
		connectZooms: raw.connectZooms ?? fallback.connectZooms,
		zoomInDurationMs: raw.zoomInDurationMs ?? fallback.zoomInDurationMs,
		zoomInOverlapMs: raw.zoomInOverlapMs ?? fallback.zoomInOverlapMs,
		zoomOutDurationMs: raw.zoomOutDurationMs ?? fallback.zoomOutDurationMs,
		connectedZoomGapMs: raw.connectedZoomGapMs ?? fallback.connectedZoomGapMs,
		connectedZoomDurationMs: raw.connectedZoomDurationMs ?? fallback.connectedZoomDurationMs,
		zoomInEasing: raw.zoomInEasing ?? fallback.zoomInEasing,
		zoomOutEasing: raw.zoomOutEasing ?? fallback.zoomOutEasing,
		connectedZoomEasing: raw.connectedZoomEasing ?? fallback.connectedZoomEasing,
		showCursor: raw.showCursor ?? fallback.showCursor,
		loopCursor: raw.loopCursor ?? fallback.loopCursor,
		cursorStyle: raw.cursorStyle ?? fallback.cursorStyle,
		cursorSize: raw.cursorSize ?? fallback.cursorSize,
		cursorSmoothing: raw.cursorSmoothing ?? fallback.cursorSmoothing,
		cursorSpringStiffnessMultiplier:
			raw.cursorSpringStiffnessMultiplier ?? fallback.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier:
			raw.cursorSpringDampingMultiplier ?? fallback.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier:
			raw.cursorSpringMassMultiplier ?? fallback.cursorSpringMassMultiplier,
		cursorMotionBlur: raw.cursorMotionBlur ?? fallback.cursorMotionBlur,
		cursorClickBounce: raw.cursorClickBounce ?? fallback.cursorClickBounce,
		cursorClickBounceDuration:
			raw.cursorClickBounceDuration ?? fallback.cursorClickBounceDuration,
		cursorSway: raw.cursorSway ?? fallback.cursorSway,
		borderRadius: raw.borderRadius ?? fallback.borderRadius,
		padding: raw.padding ?? fallback.padding,
		frame: raw.frame !== undefined ? raw.frame : fallback.frame,
		webcam: raw.webcam ?? fallback.webcam,
		aspectRatio: raw.aspectRatio ?? fallback.aspectRatio,
		exportEncodingMode: raw.exportEncodingMode ?? fallback.exportEncodingMode,
		exportBackendPreference:
			raw.exportBackendPreference === undefined
				? fallback.exportBackendPreference
				: normalizeExportBackendPreference(raw.exportBackendPreference),
		exportPipelineModel:
			raw.exportPipelineModel === undefined
				? fallback.exportPipelineModel
				: normalizeExportPipelineModel(raw.exportPipelineModel),
		exportQuality: raw.exportQuality ?? fallback.exportQuality,
		mp4FrameRate:
			raw.mp4FrameRate === undefined
				? fallback.mp4FrameRate
				: normalizeExportMp4FrameRate(raw.mp4FrameRate),
		exportFormat: raw.exportFormat ?? fallback.exportFormat,
		gifFrameRate: raw.gifFrameRate ?? fallback.gifFrameRate,
		gifLoop: raw.gifLoop ?? fallback.gifLoop,
		gifSizePreset: raw.gifSizePreset ?? fallback.gifSizePreset,
	};

	const normalized = normalizeProjectEditor(candidate);

	return {
		wallpaper: normalized.wallpaper,
		shadowIntensity: normalized.shadowIntensity,
		backgroundBlur: normalized.backgroundBlur,
		zoomMotionBlur: normalized.zoomMotionBlur,
		zoomTemporalMotionBlur: normalized.zoomTemporalMotionBlur,
		zoomMotionBlurSampleCount: normalized.zoomMotionBlurSampleCount,
		zoomMotionBlurShutterFraction: normalized.zoomMotionBlurShutterFraction,
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
		cursorStyle: normalized.cursorStyle,
		cursorSize: normalized.cursorSize,
		cursorSmoothing: normalized.cursorSmoothing,
		cursorSpringStiffnessMultiplier: normalized.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: normalized.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: normalized.cursorSpringMassMultiplier,
		cursorMotionBlur: normalized.cursorMotionBlur,
		cursorClickBounce: normalized.cursorClickBounce,
		cursorClickBounceDuration: normalized.cursorClickBounceDuration,
		cursorSway: normalized.cursorSway,
		borderRadius: normalized.borderRadius,
		padding: normalized.padding,
		frame: normalized.frame,
		webcam: normalized.webcam,
		aspectRatio: normalized.aspectRatio,
		exportEncodingMode: normalized.exportEncodingMode,
		exportBackendPreference: normalized.exportBackendPreference,
		exportPipelineModel: normalized.exportPipelineModel,
		exportQuality: normalized.exportQuality,
		mp4FrameRate: normalized.mp4FrameRate,
		exportFormat: normalized.exportFormat,
		gifFrameRate: normalized.gifFrameRate,
		gifLoop: normalized.gifLoop,
		gifSizePreset: normalized.gifSizePreset,
	};
}

export function normalizeEditorPreferences(
	candidate: unknown,
	fallback: EditorPreferences = DEFAULT_EDITOR_PREFERENCES,
): EditorPreferences {
	const raw =
		candidate && typeof candidate === "object" ? (candidate as Partial<EditorPreferences>) : {};

	return {
		...normalizeEditorControls(raw, fallback),
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
		autoApplyFreshRecordingAutoZooms: normalizeBoolean(
			raw.autoApplyFreshRecordingAutoZooms,
			fallback.autoApplyFreshRecordingAutoZooms,
		),
		whisperExecutablePath:
			normalizeNullablePath(raw.whisperExecutablePath) ?? fallback.whisperExecutablePath,
		whisperModelPath: normalizeNullablePath(raw.whisperModelPath) ?? fallback.whisperModelPath,
	};
}

export function loadEditorPreferences(): EditorPreferences {
	if (typeof globalThis.localStorage === "undefined") {
		return DEFAULT_EDITOR_PREFERENCES;
	}

	try {
		const stored = globalThis.localStorage.getItem(EDITOR_PREFERENCES_STORAGE_KEY);
		if (!stored) {
			return DEFAULT_EDITOR_PREFERENCES;
		}

		return normalizeEditorPreferences(JSON.parse(stored));
	} catch {
		return DEFAULT_EDITOR_PREFERENCES;
	}
}

export function saveEditorPreferences(preferences: Partial<EditorPreferences>): void {
	if (typeof globalThis.localStorage === "undefined") {
		return;
	}

	try {
		const current = loadEditorPreferences();
		const merged = normalizeEditorPreferences({ ...current, ...preferences }, current);
		globalThis.localStorage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, JSON.stringify(merged));
	} catch {
		// Ignore storage failures so editor controls still work.
	}
}

export function loadEditorPresets(): EditorPreset[] {
	if (typeof globalThis.localStorage === "undefined") {
		return [];
	}

	try {
		const stored = globalThis.localStorage.getItem(EDITOR_PRESETS_STORAGE_KEY);
		if (!stored) {
			return [];
		}

		return normalizeEditorPresets(JSON.parse(stored));
	} catch {
		return [];
	}
}

export function saveEditorPresets(presets: EditorPreset[]): boolean {
	if (typeof globalThis.localStorage === "undefined") {
		return false;
	}

	try {
		const normalized = normalizeEditorPresets(presets);
		globalThis.localStorage.setItem(EDITOR_PRESETS_STORAGE_KEY, JSON.stringify(normalized));
		return true;
	} catch {
		// Ignore storage failures so editor controls still work.
		return false;
	}
}
