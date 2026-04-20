import type { ProjectEditorState } from "./projectPersistenceShared";
import { clamp, isFiniteNumber } from "./projectPersistenceShared";
import {
	type AnnotationRegion,
	type AutoCaptionAnimation,
	type AutoCaptionSettings,
	type CaptionCue,
	type CaptionCueWord,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_AUTO_CAPTION_SETTINGS,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	getDefaultCaptionFontFamily,
	type AudioRegion,
	type ClipRegion,
	type SpeedRegion,
	type TrimRegion,
	type ZoomRegion,
} from "./types";

function normalizeAutoCaptionAnimation(
	value: unknown,
	fallback: AutoCaptionAnimation,
): AutoCaptionAnimation {
	return value === "none" || value === "fade" || value === "rise" || value === "pop"
		? value
		: fallback;
}

function normalizeTimedRegions<T extends { id: string; startMs: number; endMs: number }>(
	regions: unknown,
	mapRegion: (region: T, startMs: number, endMs: number) => T,
): T[] {
	return Array.isArray(regions)
		? regions
				.filter((region): region is T => Boolean(region && typeof region.id === "string"))
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					return mapRegion(region, startMs, endMs);
				})
		: [];
}

export function normalizeZoomRegions(editor: Partial<ProjectEditorState>): ZoomRegion[] {
	return Array.isArray(editor.zoomRegions)
		? editor.zoomRegions
				.filter((region): region is ZoomRegion => Boolean(region && typeof region.id === "string"))
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					return {
						id: region.id,
						startMs,
						endMs,
						depth: [1, 2, 3, 4, 5, 6].includes(region.depth)
							? region.depth
							: DEFAULT_ZOOM_DEPTH,
						focus: {
							cx: clamp(isFiniteNumber(region.focus?.cx) ? region.focus.cx : 0.5, 0, 1),
							cy: clamp(isFiniteNumber(region.focus?.cy) ? region.focus.cy : 0.5, 0, 1),
						},
						mode:
							region.mode === "auto" || region.mode === "manual" ? region.mode : undefined,
					};
				})
		: [];
}

export function normalizeTrimRegions(editor: Partial<ProjectEditorState>): TrimRegion[] {
	return normalizeTimedRegions<TrimRegion>(editor.trimRegions, (region, startMs, endMs) => ({
		id: region.id,
		startMs,
		endMs,
	}));
}

export function normalizeClipRegions(editor: Partial<ProjectEditorState>): ClipRegion[] {
	return normalizeTimedRegions<ClipRegion>(editor.clipRegions, (region, startMs, endMs) => ({
		id: region.id,
		startMs,
		endMs,
		speed: isFiniteNumber(region.speed) ? region.speed : 1,
		muted: typeof region.muted === "boolean" ? region.muted : false,
		...(isFiniteNumber(region.sourceStartMs)
			? { sourceStartMs: Math.max(0, Math.round(region.sourceStartMs)) }
			: {}),
	}));
}

export function normalizeSpeedRegions(editor: Partial<ProjectEditorState>): SpeedRegion[] {
	return normalizeTimedRegions<SpeedRegion>(editor.speedRegions, (region, startMs, endMs) => ({
		id: region.id,
		startMs,
		endMs,
		speed:
			region.speed === 0.25 ||
			region.speed === 0.5 ||
			region.speed === 0.75 ||
			region.speed === 1.25 ||
			region.speed === 1.5 ||
			region.speed === 1.75 ||
			region.speed === 2
				? region.speed
				: DEFAULT_PLAYBACK_SPEED,
	}));
}

export function normalizeAnnotationRegions(
	editor: Partial<ProjectEditorState>,
): AnnotationRegion[] {
	return Array.isArray(editor.annotationRegions)
		? editor.annotationRegions
				.filter((region): region is AnnotationRegion => Boolean(region && typeof region.id === "string"))
				.map((region, index) => {
					const rawStart = isFiniteNumber(region.startMs) ? Math.round(region.startMs) : 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					return {
						id: region.id,
						startMs,
						endMs,
						type:
							region.type === "image" || region.type === "figure" || region.type === "blur"
								? region.type
								: "text",
						content: typeof region.content === "string" ? region.content : "",
						textContent:
							typeof region.textContent === "string" ? region.textContent : undefined,
						imageContent:
							typeof region.imageContent === "string" ? region.imageContent : undefined,
						position: {
							x: clamp(
								isFiniteNumber(region.position?.x)
									? region.position.x
									: DEFAULT_ANNOTATION_POSITION.x,
								0,
								100,
							),
							y: clamp(
								isFiniteNumber(region.position?.y)
									? region.position.y
									: DEFAULT_ANNOTATION_POSITION.y,
								0,
								100,
							),
						},
						size: {
							width: clamp(
								isFiniteNumber(region.size?.width)
									? region.size.width
									: DEFAULT_ANNOTATION_SIZE.width,
								1,
								200,
							),
							height: clamp(
								isFiniteNumber(region.size?.height)
									? region.size.height
									: DEFAULT_ANNOTATION_SIZE.height,
								1,
								200,
							),
						},
						style: {
							...DEFAULT_ANNOTATION_STYLE,
							...(region.style && typeof region.style === "object" ? region.style : {}),
						},
						zIndex: isFiniteNumber(region.zIndex) ? region.zIndex : index + 1,
						figureData: region.figureData
							? { ...DEFAULT_FIGURE_DATA, ...region.figureData }
							: undefined,
						blurIntensity: isFiniteNumber(region.blurIntensity)
							? clamp(region.blurIntensity, 1, 100)
							: 20,
						blurColor:
							typeof region.blurColor === "string" ? region.blurColor : undefined,
						trackIndex: isFiniteNumber(region.trackIndex)
							? Math.max(0, Math.floor(region.trackIndex))
							: 0,
					};
				})
		: [];
}

export function normalizeAudioRegions(editor: Partial<ProjectEditorState>): AudioRegion[] {
	return normalizeTimedRegions<AudioRegion>(editor.audioRegions, (region, startMs, endMs) => ({
		id: region.id,
		startMs,
		endMs,
		audioPath: typeof region.audioPath === "string" ? region.audioPath : "",
		volume: isFiniteNumber(region.volume) ? clamp(region.volume, 0, 1) : 1,
		trackIndex: isFiniteNumber(region.trackIndex)
			? Math.max(0, Math.floor(region.trackIndex))
			: 0,
	}));
}

export function normalizeAutoCaptions(editor: Partial<ProjectEditorState>): CaptionCue[] {
	return Array.isArray(editor.autoCaptions)
		? editor.autoCaptions
				.filter((cue): cue is CaptionCue => Boolean(cue && typeof cue.id === "string"))
				.map((cue) => {
					const rawStart = isFiniteNumber(cue.startMs) ? Math.round(cue.startMs) : 0;
					const rawEnd = isFiniteNumber(cue.endMs) ? Math.round(cue.endMs) : rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					const words: CaptionCueWord[] | undefined = Array.isArray(cue.words)
						? cue.words
								.filter((word): word is CaptionCueWord => Boolean(word && typeof word.text === "string"))
								.map((word) => {
									const rawWordStart = isFiniteNumber(word.startMs)
										? Math.round(word.startMs)
										: startMs;
									const rawWordEnd = isFiniteNumber(word.endMs)
										? Math.round(word.endMs)
										: rawWordStart + 1;
									const normalizedWordStart = clamp(rawWordStart, startMs, endMs - 1);
									const normalizedWordEnd = clamp(rawWordEnd, normalizedWordStart + 1, endMs);

									return {
										text: word.text.trim(),
										startMs: normalizedWordStart,
										endMs: normalizedWordEnd,
										...(word.leadingSpace ? { leadingSpace: true } : {}),
									};
								})
								.filter((word) => word.text.length > 0)
						: undefined;

					return {
						id: cue.id,
						startMs,
						endMs,
						text: typeof cue.text === "string" ? cue.text.trim() : "",
						...(words && words.length > 0 ? { words } : {}),
					};
				})
				.filter((cue) => cue.text.length > 0)
		: [];
}

export function normalizeAutoCaptionSettings(
	editor: Partial<ProjectEditorState>,
): AutoCaptionSettings {
	const rawAutoCaptionSettings: Partial<AutoCaptionSettings> =
		editor.autoCaptionSettings && typeof editor.autoCaptionSettings === "object"
			? editor.autoCaptionSettings
			: {};

	return {
		enabled:
			typeof rawAutoCaptionSettings.enabled === "boolean"
				? rawAutoCaptionSettings.enabled
				: DEFAULT_AUTO_CAPTION_SETTINGS.enabled,
		language:
			typeof rawAutoCaptionSettings.language === "string" &&
			rawAutoCaptionSettings.language.trim()
				? rawAutoCaptionSettings.language.trim()
				: DEFAULT_AUTO_CAPTION_SETTINGS.language,
		fontFamily: getDefaultCaptionFontFamily(),
		fontSize: isFiniteNumber(rawAutoCaptionSettings.fontSize)
			? clamp(rawAutoCaptionSettings.fontSize, 16, 72)
			: DEFAULT_AUTO_CAPTION_SETTINGS.fontSize,
		bottomOffset: isFiniteNumber(rawAutoCaptionSettings.bottomOffset)
			? clamp(rawAutoCaptionSettings.bottomOffset, 0, 30)
			: DEFAULT_AUTO_CAPTION_SETTINGS.bottomOffset,
		maxWidth: isFiniteNumber(rawAutoCaptionSettings.maxWidth)
			? clamp(rawAutoCaptionSettings.maxWidth, 40, 95)
			: DEFAULT_AUTO_CAPTION_SETTINGS.maxWidth,
		maxRows: isFiniteNumber(rawAutoCaptionSettings.maxRows)
			? clamp(Math.round(rawAutoCaptionSettings.maxRows), 1, 4)
			: DEFAULT_AUTO_CAPTION_SETTINGS.maxRows,
		animationStyle: normalizeAutoCaptionAnimation(
			rawAutoCaptionSettings.animationStyle,
			DEFAULT_AUTO_CAPTION_SETTINGS.animationStyle,
		),
		boxRadius: isFiniteNumber(rawAutoCaptionSettings.boxRadius)
			? clamp(rawAutoCaptionSettings.boxRadius, 0, 40)
			: DEFAULT_AUTO_CAPTION_SETTINGS.boxRadius,
		textColor:
			typeof rawAutoCaptionSettings.textColor === "string" &&
			rawAutoCaptionSettings.textColor.trim()
				? rawAutoCaptionSettings.textColor
				: DEFAULT_AUTO_CAPTION_SETTINGS.textColor,
		inactiveTextColor:
			typeof rawAutoCaptionSettings.inactiveTextColor === "string" &&
			rawAutoCaptionSettings.inactiveTextColor.trim()
				? rawAutoCaptionSettings.inactiveTextColor
				: DEFAULT_AUTO_CAPTION_SETTINGS.inactiveTextColor,
		backgroundOpacity: isFiniteNumber(rawAutoCaptionSettings.backgroundOpacity)
			? clamp(rawAutoCaptionSettings.backgroundOpacity, 0, 1)
			: DEFAULT_AUTO_CAPTION_SETTINGS.backgroundOpacity,
	};
}