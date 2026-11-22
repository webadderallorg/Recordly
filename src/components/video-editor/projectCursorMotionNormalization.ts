import { CURSOR_MOTION_PRESETS, resolveCursorMotionPresetId } from "./cursorMotionPresets";
import type { ProjectEditorState } from "./projectPersistenceTypes";
import { clamp, DEFAULT_MOTION_PRESET, isFiniteNumber } from "./projectPersistenceUtils";
import {
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
	DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
	DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
	DEFAULT_CURSOR_STYLE,
	normalizeCursorClickEffectColor,
} from "./types";

export function normalizeProjectCursorMotion(
	editor: Partial<ProjectEditorState>,
	normalizedZoomInDurationMs: number,
	normalizedZoomOutDurationMs: number,
) {
	const normalizedCursorStyle =
		typeof editor.cursorStyle === "string" && editor.cursorStyle.trim().length > 0
			? editor.cursorStyle === "mono"
				? "tahoe-inverted"
				: editor.cursorStyle
			: DEFAULT_CURSOR_STYLE;

	const normalizedMotionValues = {
		zoomInDurationMs: normalizedZoomInDurationMs,
		zoomOutDurationMs: normalizedZoomOutDurationMs,
		cursorSize: isFiniteNumber(editor.cursorSize)
			? clamp(editor.cursorSize, 0.5, 10)
			: DEFAULT_MOTION_PRESET.cursorSize,
		cursorSmoothing: isFiniteNumber(editor.cursorSmoothing)
			? clamp(editor.cursorSmoothing, 0, 2)
			: DEFAULT_MOTION_PRESET.cursorSmoothing,
		cursorSpringStiffnessMultiplier: isFiniteNumber(editor.cursorSpringStiffnessMultiplier)
			? clamp(editor.cursorSpringStiffnessMultiplier, 0.25, 3)
			: DEFAULT_MOTION_PRESET.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: isFiniteNumber(editor.cursorSpringDampingMultiplier)
			? clamp(editor.cursorSpringDampingMultiplier, 0.25, 3)
			: DEFAULT_MOTION_PRESET.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: isFiniteNumber(editor.cursorSpringMassMultiplier)
			? clamp(editor.cursorSpringMassMultiplier, 0.25, 3)
			: DEFAULT_MOTION_PRESET.cursorSpringMassMultiplier,
		cursorClickBounce: isFiniteNumber((editor as Partial<ProjectEditorState>).cursorClickBounce)
			? clamp((editor as Partial<ProjectEditorState>).cursorClickBounce as number, 0, 5)
			: DEFAULT_MOTION_PRESET.cursorClickBounce,
		cursorClickBounceDuration: isFiniteNumber(
			(editor as Partial<ProjectEditorState>).cursorClickBounceDuration,
		)
			? clamp(
					(editor as Partial<ProjectEditorState>).cursorClickBounceDuration as number,
					60,
					500,
				)
			: DEFAULT_MOTION_PRESET.cursorClickBounceDuration,
	};

	const normalizedCursorClickEffectScale = isFiniteNumber(
		(editor as Partial<ProjectEditorState>).cursorClickEffectScale,
	)
		? clamp((editor as Partial<ProjectEditorState>).cursorClickEffectScale as number, 0.5, 2)
		: DEFAULT_CURSOR_CLICK_EFFECT_SCALE;

	const normalizedCursorClickEffectOpacity = isFiniteNumber(
		(editor as Partial<ProjectEditorState>).cursorClickEffectOpacity,
	)
		? clamp((editor as Partial<ProjectEditorState>).cursorClickEffectOpacity as number, 0, 1)
		: DEFAULT_CURSOR_CLICK_EFFECT_OPACITY;

	const normalizedCursorClickEffectDurationMs = isFiniteNumber(
		(editor as Partial<ProjectEditorState>).cursorClickEffectDurationMs,
	)
		? clamp(
				(editor as Partial<ProjectEditorState>).cursorClickEffectDurationMs as number,
				120,
				1200,
			)
		: DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS;

	const normalizedCursorClickEffectColor = normalizeCursorClickEffectColor(
		(editor as Partial<ProjectEditorState>).cursorClickEffectColor,
		DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	);

	const normalizedMotionPreset =
		CURSOR_MOTION_PRESETS[resolveCursorMotionPresetId(normalizedMotionValues)];
	return {
		normalizedCursorStyle,
		normalizedCursorClickEffectScale,
		normalizedCursorClickEffectOpacity,
		normalizedCursorClickEffectDurationMs,
		normalizedCursorClickEffectColor,
		normalizedMotionPreset,
	};
}
