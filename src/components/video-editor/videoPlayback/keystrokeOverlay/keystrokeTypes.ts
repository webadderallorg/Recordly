export type KeystrokeModifier = "meta" | "ctrl" | "alt" | "shift";
export type KeystrokeOverlayMode = "shortcuts" | "all";
export type KeystrokeOverlayPosition =
	| "bottom-left"
	| "bottom-center"
	| "bottom-right"
	| "top-center";

export interface KeystrokeOverlaySettings {
	enabled: boolean;
	mode: KeystrokeOverlayMode;
	position: KeystrokeOverlayPosition;
	size: number; // 0.5–2
}

export const DEFAULT_KEYSTROKE_OVERLAY: KeystrokeOverlaySettings = {
	enabled: false,
	mode: "shortcuts",
	position: "bottom-left",
	size: 1,
};

export interface KeystrokeTelemetryPoint {
	timeMs: number;
	key: string; // lowercase token: "c" | "enter" | "arrowleft" | "f12"
	modifiers: KeystrokeModifier[];
}

export interface KeycapGroup {
	id: string; // `${timeMs}:${key}:${modsSorted}`
	labels: string[];
	opacity: number;
}
