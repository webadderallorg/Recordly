import { useEffect, useMemo, useState } from "react";
import { toast } from "@/components/ui/toast";
import {
	CURSOR_MOTION_PRESETS,
	type CursorMotionPresetId,
	getMatchingCursorMotionPresetId,
} from "@/components/video-editor/cursorMotionPresets";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { useTheme } from "@/contexts/ThemeContext";

import type { ResolvedSettingsPanelProps } from "./settingsPanelDefaults";
import { useSettingsTranslations } from "./useSettingsTranslations";

export const appSettingsKeys = [
	"zoomInDurationMs",
	"onZoomInDurationMsChange",
	"zoomOutDurationMs",
	"onZoomOutDurationMsChange",
	"cursorSize",
	"onCursorSizeChange",
	"cursorSmoothing",
	"onCursorSmoothingChange",
	"cursorSpringStiffnessMultiplier",
	"onCursorSpringStiffnessMultiplierChange",
	"cursorSpringDampingMultiplier",
	"onCursorSpringDampingMultiplierChange",
	"cursorSpringMassMultiplier",
	"onCursorSpringMassMultiplierChange",
	"cursorClickBounce",
	"onCursorClickBounceChange",
	"cursorClickBounceDuration",
	"onCursorClickBounceDurationChange",
] as const;
export function useAppSettings(
	props: Pick<ResolvedSettingsPanelProps, (typeof appSettingsKeys)[number]>,
) {
	const {
		zoomInDurationMs,
		onZoomInDurationMsChange,
		zoomOutDurationMs,
		onZoomOutDurationMsChange,
		cursorSize,
		onCursorSizeChange,
		cursorSmoothing,
		onCursorSmoothingChange,
		cursorSpringStiffnessMultiplier,
		onCursorSpringStiffnessMultiplierChange,
		cursorSpringDampingMultiplier,
		onCursorSpringDampingMultiplierChange,
		cursorSpringMassMultiplier,
		onCursorSpringMassMultiplierChange,
		cursorClickBounce,
		onCursorClickBounceChange,
		cursorClickBounceDuration,
		onCursorClickBounceDurationChange,
	} = props;
	const { tSettings } = useSettingsTranslations();
	const { preference: themePreference, setPreference: setThemePreference } = useTheme();
	const [experimentalUpdatesEnabled, setExperimentalUpdatesEnabled] = useState(false);
	const [savingExperimentalUpdates, setSavingExperimentalUpdates] = useState(false);
	const { openConfig: openShortcutsConfig } = useShortcuts();
	useEffect(() => {
		let cancelled = false;
		void window.electronAPI
			.getExperimentalUpdatesEnabled()
			.then((enabled) => {
				if (!cancelled) setExperimentalUpdatesEnabled(enabled);
			})
			.catch((error) => {
				console.error("Failed to load experimental updates preference:", error);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const updateExperimentalUpdatesPreference = async (enabled: boolean) => {
		const previousValue = experimentalUpdatesEnabled;
		setExperimentalUpdatesEnabled(enabled);
		setSavingExperimentalUpdates(true);
		try {
			const result = await window.electronAPI.setExperimentalUpdatesEnabled(enabled);
			setExperimentalUpdatesEnabled(result.enabled);
			if (!result.success) {
				toast.error(
					result.error ||
						tSettings("updates.saveFailed", "Failed to change the update channel."),
				);
			}
		} catch (error) {
			setExperimentalUpdatesEnabled(previousValue);
			toast.error(
				`${tSettings("updates.saveFailed", "Failed to change the update channel.")} ${String(error)}`,
			);
		} finally {
			setSavingExperimentalUpdates(false);
		}
	};
	const activeMotionPresetId = useMemo(() => {
		return getMatchingCursorMotionPresetId({
			zoomInDurationMs,
			zoomOutDurationMs,
			cursorSize,
			cursorSmoothing,
			cursorSpringStiffnessMultiplier,
			cursorSpringDampingMultiplier,
			cursorSpringMassMultiplier,
			cursorClickBounce,
			cursorClickBounceDuration,
		});
	}, [
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSize,
		cursorSmoothing,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cursorSpringStiffnessMultiplier,
		zoomInDurationMs,
		zoomOutDurationMs,
	]);

	const applyMotionPreset = (presetId: CursorMotionPresetId) => {
		const preset = CURSOR_MOTION_PRESETS[presetId];
		onZoomInDurationMsChange?.(preset.zoomInDurationMs);
		onZoomOutDurationMsChange?.(preset.zoomOutDurationMs);
		onCursorSizeChange?.(preset.cursorSize);
		onCursorSmoothingChange?.(preset.cursorSmoothing);
		onCursorSpringStiffnessMultiplierChange?.(preset.cursorSpringStiffnessMultiplier);
		onCursorSpringDampingMultiplierChange?.(preset.cursorSpringDampingMultiplier);
		onCursorSpringMassMultiplierChange?.(preset.cursorSpringMassMultiplier);
		onCursorClickBounceChange?.(preset.cursorClickBounce);
		onCursorClickBounceDurationChange?.(preset.cursorClickBounceDuration);
	};

	return {
		experimentalUpdatesEnabled,
		savingExperimentalUpdates,
		updateExperimentalUpdatesPreference,
		activeMotionPresetId,
		applyMotionPreset,
		openShortcutsConfig,
		themePreference,
		setThemePreference,
	};
}
