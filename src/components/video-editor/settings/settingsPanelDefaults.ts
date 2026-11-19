import { DEFAULT_CURSOR_IDLE_HIDE } from "../videoPlayback/cursorIdleVisibility";
import { getDefaultBorderRadiusPercent } from "@/components/video-editor/projectPersistence";
import {
	DEFAULT_AUTO_CAPTION_SETTINGS,
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_CLICK_EFFECT,
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
	DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
	DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_PADDING,
	DEFAULT_SHADOW_INTENSITY,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
} from "@/components/video-editor/types";

import type { SettingsPanelProps } from "./settingsPanelProps";

const defaults = {
	accountUser: () => null,
	hideAppearance: () => false,
	advanced: () => false,
	panelMode: () => "editor",
	hasClipAudioOverrides: () => false,
	shadowIntensity: () => DEFAULT_SHADOW_INTENSITY,
	backgroundBlur: () => 0,
	connectZooms: () => true,
	autoApplyFreshRecordingAutoZooms: () => true,
	zoomInDurationMs: () => DEFAULT_ZOOM_IN_DURATION_MS,
	zoomOutDurationMs: () => DEFAULT_ZOOM_OUT_DURATION_MS,
	showCursor: () => false,
	loopCursor: () => false,
	cursorStyle: () => DEFAULT_CURSOR_STYLE,
	cursorSize: () => 5,
	cursorSmoothing: () => 2,
	cursorSpringStiffnessMultiplier: () => 1,
	cursorSpringDampingMultiplier: () => 1,
	cursorSpringMassMultiplier: () => 1,
	cameraSpringStiffnessMultiplier: () => 1,
	cameraSpringDampingMultiplier: () => 1.13,
	cameraSpringMassMultiplier: () => 1.12,
	zoomClassicMode: () => false,
	cursorClickEffect: () => DEFAULT_CURSOR_CLICK_EFFECT,
	cursorClickEffectColor: () => DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	cursorClickEffectScale: () => DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
	cursorClickEffectOpacity: () => DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
	cursorClickEffectDurationMs: () => DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
	cursorClickBounce: () => DEFAULT_CURSOR_CLICK_BOUNCE,
	cursorClickBounceDuration: () => DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	cursorSway: () => DEFAULT_CURSOR_SWAY,
	cursorIdleHide: () => ({ ...DEFAULT_CURSOR_IDLE_HIDE }),
	borderRadius: () => getDefaultBorderRadiusPercent(),
	webcamPreviewSrc: () => null,
	webcamPreviewCurrentTime: () => 0,
	webcamPreviewPlaying: () => false,
	padding: () => DEFAULT_PADDING,
	annotationRegions: () => [],
	autoCaptions: () => [],
	autoCaptionSettings: () => DEFAULT_AUTO_CAPTION_SETTINGS,
	whisperModelDownloadStatus: () => "idle",
	whisperModelDownloadProgress: () => 0,
	isGeneratingCaptions: () => false,
	captionCurrentTimeMs: () => 0,
	selectedCaptionId: () => null,
	nativeCaptureUnavailableSession: () => false,
} satisfies { [K in keyof SettingsPanelProps]?: () => SettingsPanelProps[K] };
type DefaultKey = keyof typeof defaults;
export type ResolvedSettingsPanelProps = Omit<SettingsPanelProps, DefaultKey> & {
	[K in DefaultKey]-?: Exclude<SettingsPanelProps[K], undefined>;
};
export function resolveSettingsPanelProps(props: SettingsPanelProps): ResolvedSettingsPanelProps {
	const resolved = { ...props };
	for (const key of Object.keys(defaults) as DefaultKey[]) {
		if (resolved[key] === undefined) Object.assign(resolved, { [key]: defaults[key]() });
	}
	return resolved as ResolvedSettingsPanelProps;
}

/** Build a controlled section with only the public fields owned by that section. */
export function pickSettingsProps<T, K extends keyof T>(props: T, keys: readonly K[]): Pick<T, K> {
	return Object.fromEntries(keys.map((key) => [key, props[key]])) as Pick<T, K>;
}
