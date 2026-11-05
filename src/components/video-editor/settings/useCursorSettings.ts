import { useEffect, useRef, useState } from "react";
import { DEFAULT_EDITOR_PREFERENCES } from "@/components/video-editor/editorPreferences";
import { DEFAULT_CURSOR_CLICK_BOUNCE, type CursorStyle } from "@/components/video-editor/types";
import {
	type CursorStylePreviewAsset,
	getCursorStylePreview,
} from "@/components/video-editor/videoPlayback/cursorRenderer";

import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";

type CursorStyleOption = { value: CursorStyle; label: string };

const BUILTIN_CURSOR_STYLE_OPTIONS: CursorStyleOption[] = [
	{ value: "macos", label: "macOS" },
	{ value: "tahoe", label: "Golden Gate" },
	{ value: "windows11", label: "Windows 11" },
	{ value: "dot", label: "Touch" },
	{ value: "figma", label: "Minimal" },
	{ value: "bold-outline", label: "Bold Outline" },
	{ value: "pixel-hand", label: "Pixel Glove" },
	{ value: "breezex", label: "Linux (BreezeX)" },
];

export const cursorSettingsKeys = [
	"onShowCursorChange",
	"onLoopCursorChange",
	"onCursorStyleChange",
	"onCursorSizeChange",
	"onCursorSmoothingChange",
	"onCursorSpringStiffnessMultiplierChange",
	"onCursorSpringDampingMultiplierChange",
	"onCursorSpringMassMultiplierChange",
	"onCursorClickEffectChange",
	"onCursorClickEffectColorChange",
	"onCursorClickEffectScaleChange",
	"onCursorClickEffectOpacityChange",
	"onCursorClickEffectDurationMsChange",
	"cursorClickBounce",
	"onCursorClickBounceChange",
	"onCursorClickBounceDurationChange",
	"onCursorSwayChange",
	"onCursorIdleHideChange",
] as const;
export function useCursorSettings(
	props: Pick<ResolvedSettingsPanelProps, (typeof cursorSettingsKeys)[number]>,
) {
	const {
		onShowCursorChange,
		onLoopCursorChange,
		onCursorStyleChange,
		onCursorSizeChange,
		onCursorSmoothingChange,
		onCursorSpringStiffnessMultiplierChange,
		onCursorSpringDampingMultiplierChange,
		onCursorSpringMassMultiplierChange,
		onCursorClickEffectChange,
		onCursorClickEffectColorChange,
		onCursorClickEffectScaleChange,
		onCursorClickEffectOpacityChange,
		onCursorClickEffectDurationMsChange,
		cursorClickBounce,
		onCursorClickBounceChange,
		onCursorClickBounceDurationChange,
		onCursorSwayChange,
		onCursorIdleHideChange,
	} = props;
	const lastCursorBounceStrength = useRef(
		cursorClickBounce > 0 ? cursorClickBounce : DEFAULT_CURSOR_CLICK_BOUNCE,
	);
	useEffect(() => {
		if (cursorClickBounce > 0) lastCursorBounceStrength.current = cursorClickBounce;
	}, [cursorClickBounce]);
	const [builtInCursorPreviewUrls, setBuiltInCursorPreviewUrls] = useState<
		Partial<Record<string, CursorStylePreviewAsset>>
	>({});

	const cursorPreviewUrls = builtInCursorPreviewUrls;
	const showDevMotionControls = import.meta.env.DEV;
	const cursorStyleOptions = BUILTIN_CURSOR_STYLE_OPTIONS;

	useEffect(() => {
		let cancelled = false;
		void Promise.all(
			BUILTIN_CURSOR_STYLE_OPTIONS.map(
				async ({ value }) => [value, await getCursorStylePreview(value)] as const,
			),
		)
			.then((entries) => {
				if (!cancelled) setBuiltInCursorPreviewUrls(Object.fromEntries(entries));
			})
			.catch((error) => console.warn("Failed to load cursor previews", error));
		return () => {
			cancelled = true;
		};
	}, []);
	const resetCursorSection = () => {
		onShowCursorChange?.(DEFAULT_EDITOR_PREFERENCES.showCursor);
		onLoopCursorChange?.(DEFAULT_EDITOR_PREFERENCES.loopCursor);
		onCursorStyleChange?.(DEFAULT_EDITOR_PREFERENCES.cursorStyle);
		onCursorSizeChange?.(DEFAULT_EDITOR_PREFERENCES.cursorSize);
		onCursorSmoothingChange?.(DEFAULT_EDITOR_PREFERENCES.cursorSmoothing);
		onCursorSpringStiffnessMultiplierChange?.(
			DEFAULT_EDITOR_PREFERENCES.cursorSpringStiffnessMultiplier,
		);
		onCursorSpringDampingMultiplierChange?.(
			DEFAULT_EDITOR_PREFERENCES.cursorSpringDampingMultiplier,
		);
		onCursorSpringMassMultiplierChange?.(DEFAULT_EDITOR_PREFERENCES.cursorSpringMassMultiplier);
		onCursorClickEffectChange?.(DEFAULT_EDITOR_PREFERENCES.cursorClickEffect);
		onCursorClickEffectColorChange?.(DEFAULT_EDITOR_PREFERENCES.cursorClickEffectColor);
		onCursorClickEffectScaleChange?.(DEFAULT_EDITOR_PREFERENCES.cursorClickEffectScale);
		onCursorClickEffectOpacityChange?.(DEFAULT_EDITOR_PREFERENCES.cursorClickEffectOpacity);
		onCursorClickEffectDurationMsChange?.(
			DEFAULT_EDITOR_PREFERENCES.cursorClickEffectDurationMs,
		);
		onCursorClickBounceChange?.(DEFAULT_EDITOR_PREFERENCES.cursorClickBounce);
		onCursorClickBounceDurationChange?.(DEFAULT_EDITOR_PREFERENCES.cursorClickBounceDuration);
		onCursorSwayChange?.(DEFAULT_EDITOR_PREFERENCES.cursorSway);
		onCursorIdleHideChange?.({ ...DEFAULT_EDITOR_PREFERENCES.cursorIdleHide });
	};

	return {
		lastCursorBounceStrength,
		cursorPreviewUrls,
		showDevMotionControls,
		cursorStyleOptions,
		resetCursorSection,
	};
}
