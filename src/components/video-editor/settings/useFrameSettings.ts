import { useRef } from "react";
import {
	DEFAULT_EDITOR_PREFERENCES,
	loadEditorPreferences,
} from "@/components/video-editor/editorPreferences";
import type { Padding } from "@/components/video-editor/types";
import { DEFAULT_PADDING } from "@/components/video-editor/types";
import { isZeroPadding } from "@/components/video-editor/videoPlayback/layoutUtils";
import { type AspectRatio } from "@/utils/aspectRatioUtils";

import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";

export const frameSettingsKeys = [
	"onBackgroundBlurChange",
	"onShadowChange",
	"onBorderRadiusChange",
	"padding",
	"onPaddingChange",
	"aspectRatio",
	"onAspectRatioChange",
] as const;
export function useFrameSettings(
	props: Pick<ResolvedSettingsPanelProps, (typeof frameSettingsKeys)[number]>,
	initialEditorPreferences: ReturnType<typeof loadEditorPreferences>,
) {
	const {
		onBackgroundBlurChange,
		onShadowChange,
		onBorderRadiusChange,
		padding,
		onPaddingChange,
		aspectRatio,
		onAspectRatioChange,
	} = props;
	const removeBackgroundStateRef = useRef<{
		aspectRatio: AspectRatio;
		padding: Padding;
	} | null>(null);
	const handleRemoveBackgroundToggle = (checked: boolean) => {
		if (checked) {
			removeBackgroundStateRef.current = {
				aspectRatio,
				padding,
			};
			onAspectRatioChange?.("native");
			onPaddingChange?.({ top: 0, bottom: 0, left: 0, right: 0, linked: padding.linked });
			return;
		}

		const previousState = removeBackgroundStateRef.current;
		if (previousState) {
			onAspectRatioChange?.(previousState.aspectRatio);
			onPaddingChange?.(previousState.padding);
			removeBackgroundStateRef.current = null;
			return;
		}

		// Fallback if the project loaded in a "background removed" state already
		onAspectRatioChange?.(initialEditorPreferences.aspectRatio);
		onPaddingChange?.({ ...DEFAULT_PADDING });
	};

	const togglePaddingLink = () => {
		const isLinked = padding.linked !== false;
		const nextLinked = !isLinked;
		if (nextLinked) {
			// Compute average for relinking to avoid sudden shifts
			const avg = Math.round(
				(padding.top + padding.bottom + padding.left + padding.right) / 4,
			);
			onPaddingChange?.({
				top: avg,
				bottom: avg,
				left: avg,
				right: avg,
				linked: true,
			});
		} else {
			onPaddingChange?.({
				...padding,
				linked: false,
			});
		}
	};

	const handlePaddingSideChange = (side: keyof Padding, value: number) => {
		if (padding.linked !== false) {
			onPaddingChange?.({
				top: value,
				bottom: value,
				left: value,
				right: value,
				linked: true,
			});
		} else {
			onPaddingChange?.({
				...padding,
				[side]: value,
			});
		}
	};
	const resetFrameSection = () => {
		onBackgroundBlurChange?.(DEFAULT_EDITOR_PREFERENCES.backgroundBlur);
		onShadowChange?.(DEFAULT_EDITOR_PREFERENCES.shadowIntensity);
		onBorderRadiusChange?.(DEFAULT_EDITOR_PREFERENCES.borderRadius);
		onAspectRatioChange?.(DEFAULT_EDITOR_PREFERENCES.aspectRatio);
		onPaddingChange?.({ ...DEFAULT_EDITOR_PREFERENCES.padding });
		removeBackgroundStateRef.current = null;
	};

	const removeBackgroundEnabled = aspectRatio === "native" && isZeroPadding(padding);

	return {
		resetFrameSection,
		removeBackgroundEnabled,
		handleRemoveBackgroundToggle,
		togglePaddingLink,
		handlePaddingSideChange,
	};
}
