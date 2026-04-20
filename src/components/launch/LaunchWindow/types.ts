export interface DesktopSource {
	id: string;
	name: string;
	thumbnail: string | null;
	display_id: string;
	appIcon: string | null;
	originalName: string;
	sourceType: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

export const LOCALE_LABELS: Record<string, string> = {
	en: "EN",
	es: "ES",
	nl: "NL",
	"zh-CN": "中文",
	ko: "한국어",
};

export const COUNTDOWN_OPTIONS = [0, 3, 5, 10];
export const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;
export const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };
export const DEFAULT_RECORDING_HUD_OFFSET = { x: 0, y: 0 };
