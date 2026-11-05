import type { ProjectEditorState } from "./projectPersistenceTypes";
import { getCaptionPreset } from "./captionPresets";
import { clamp, isFiniteNumber, normalizeAutoCaptionAnimation } from "./projectPersistenceUtils";
import {
	type AutoCaptionSettings,
	type CaptionCue,
	type CaptionCueWord,
	DEFAULT_AUTO_CAPTION_SETTINGS,
	getDefaultCaptionFontFamily,
} from "./types";

export function normalizeProjectCaptions(editor: Partial<ProjectEditorState>) {
	const normalizedAutoCaptions: CaptionCue[] = Array.isArray(
		(editor as Partial<ProjectEditorState>).autoCaptions,
	)
		? ((editor as Partial<ProjectEditorState>).autoCaptions as CaptionCue[])
				.filter((cue): cue is CaptionCue => Boolean(cue && typeof cue.id === "string"))
				.map((cue) => {
					const rawStart = isFiniteNumber(cue.startMs) ? Math.round(cue.startMs) : 0;
					const rawEnd = isFiniteNumber(cue.endMs)
						? Math.round(cue.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					const words: CaptionCueWord[] | undefined = Array.isArray(cue.words)
						? cue.words
								.filter((word): word is CaptionCueWord =>
									Boolean(word && typeof word.text === "string"),
								)
								.map((word) => {
									const rawWordStart = isFiniteNumber(word.startMs)
										? Math.round(word.startMs)
										: startMs;
									const rawWordEnd = isFiniteNumber(word.endMs)
										? Math.round(word.endMs)
										: rawWordStart + 1;
									const normalizedWordStart = clamp(
										rawWordStart,
										startMs,
										endMs - 1,
									);
									const normalizedWordEnd = clamp(
										rawWordEnd,
										normalizedWordStart + 1,
										endMs,
									);

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

	const rawAutoCaptionSettings: Partial<AutoCaptionSettings> =
		editor.autoCaptionSettings && typeof editor.autoCaptionSettings === "object"
			? (editor.autoCaptionSettings as Partial<AutoCaptionSettings>)
			: {};

	const normalizedAutoCaptionSettings: AutoCaptionSettings = {
		style: getCaptionPreset(rawAutoCaptionSettings.style).id,
		enabled:
			typeof rawAutoCaptionSettings.enabled === "boolean"
				? rawAutoCaptionSettings.enabled
				: DEFAULT_AUTO_CAPTION_SETTINGS.enabled,
		timelineQuickAdd:
			typeof rawAutoCaptionSettings.timelineQuickAdd === "boolean"
				? rawAutoCaptionSettings.timelineQuickAdd
				: DEFAULT_AUTO_CAPTION_SETTINGS.timelineQuickAdd,
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
	return { normalizedAutoCaptions, normalizedAutoCaptionSettings };
}
