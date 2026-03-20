import { normalizeProjectEditor, type ProjectEditorState } from "./projectPersistence";

type PersistedEditorControls = Pick<
	ProjectEditorState,
	| "wallpaper"
	| "shadowIntensity"
	| "backgroundBlur"
	| "zoomMotionBlur"
	| "connectZooms"
	| "showCursor"
	| "loopCursor"
	| "cursorSize"
	| "cursorSmoothing"
	| "cursorMotionBlur"
	| "cursorClickBounce"
	| "cursorClickBounceDuration"
	| "cursorSway"
	| "borderRadius"
	| "padding"
	| "webcam"
	| "aspectRatio"
	| "exportQuality"
	| "exportFormat"
	| "gifFrameRate"
	| "gifLoop"
	| "gifSizePreset"
>;

type PartialEditorControls = Partial<PersistedEditorControls>;

export interface EditorPreferences extends PersistedEditorControls {
	customAspectWidth: string;
	customAspectHeight: string;
	customWallpapers: string[];
}

export const EDITOR_PREFERENCES_STORAGE_KEY = "recordly.editor.preferences";

const DEFAULT_EDITOR_CONTROLS = normalizeProjectEditor({});

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
	wallpaper: DEFAULT_EDITOR_CONTROLS.wallpaper,
	shadowIntensity: DEFAULT_EDITOR_CONTROLS.shadowIntensity,
	backgroundBlur: DEFAULT_EDITOR_CONTROLS.backgroundBlur,
	zoomMotionBlur: DEFAULT_EDITOR_CONTROLS.zoomMotionBlur,
	connectZooms: DEFAULT_EDITOR_CONTROLS.connectZooms,
	showCursor: DEFAULT_EDITOR_CONTROLS.showCursor,
	loopCursor: DEFAULT_EDITOR_CONTROLS.loopCursor,
	cursorSize: DEFAULT_EDITOR_CONTROLS.cursorSize,
	cursorSmoothing: DEFAULT_EDITOR_CONTROLS.cursorSmoothing,
	cursorMotionBlur: DEFAULT_EDITOR_CONTROLS.cursorMotionBlur,
	cursorClickBounce: DEFAULT_EDITOR_CONTROLS.cursorClickBounce,
	cursorClickBounceDuration: DEFAULT_EDITOR_CONTROLS.cursorClickBounceDuration,
	cursorSway: DEFAULT_EDITOR_CONTROLS.cursorSway,
	borderRadius: DEFAULT_EDITOR_CONTROLS.borderRadius,
	padding: DEFAULT_EDITOR_CONTROLS.padding,
	webcam: DEFAULT_EDITOR_CONTROLS.webcam,
	aspectRatio: DEFAULT_EDITOR_CONTROLS.aspectRatio,
	exportQuality: DEFAULT_EDITOR_CONTROLS.exportQuality,
	exportFormat: DEFAULT_EDITOR_CONTROLS.exportFormat,
	gifFrameRate: DEFAULT_EDITOR_CONTROLS.gifFrameRate,
	gifLoop: DEFAULT_EDITOR_CONTROLS.gifLoop,
	gifSizePreset: DEFAULT_EDITOR_CONTROLS.gifSizePreset,
	customAspectWidth: "16",
	customAspectHeight: "9",
	customWallpapers: [],
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
		new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0)),
	);
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
		connectZooms: raw.connectZooms ?? fallback.connectZooms,
		showCursor: raw.showCursor ?? fallback.showCursor,
		loopCursor: raw.loopCursor ?? fallback.loopCursor,
		cursorSize: raw.cursorSize ?? fallback.cursorSize,
		cursorSmoothing: raw.cursorSmoothing ?? fallback.cursorSmoothing,
		cursorMotionBlur: raw.cursorMotionBlur ?? fallback.cursorMotionBlur,
		cursorClickBounce: raw.cursorClickBounce ?? fallback.cursorClickBounce,
		cursorClickBounceDuration:
			raw.cursorClickBounceDuration ?? fallback.cursorClickBounceDuration,
		cursorSway: raw.cursorSway ?? fallback.cursorSway,
		borderRadius: raw.borderRadius ?? fallback.borderRadius,
		padding: raw.padding ?? fallback.padding,
		webcam: raw.webcam ?? fallback.webcam,
		aspectRatio: raw.aspectRatio ?? fallback.aspectRatio,
		exportQuality: raw.exportQuality ?? fallback.exportQuality,
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
		connectZooms: normalized.connectZooms,
		showCursor: normalized.showCursor,
		loopCursor: normalized.loopCursor,
		cursorSize: normalized.cursorSize,
		cursorSmoothing: normalized.cursorSmoothing,
		cursorMotionBlur: normalized.cursorMotionBlur,
		cursorClickBounce: normalized.cursorClickBounce,
		cursorClickBounceDuration: normalized.cursorClickBounceDuration,
		cursorSway: normalized.cursorSway,
		borderRadius: normalized.borderRadius,
		padding: normalized.padding,
		webcam: normalized.webcam,
		aspectRatio: normalized.aspectRatio,
		exportQuality: normalized.exportQuality,
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
		customWallpapers: normalizeCustomWallpapers(raw.customWallpapers, fallback.customWallpapers),
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
