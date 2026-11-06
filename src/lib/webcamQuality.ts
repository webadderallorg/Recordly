export type WebcamQualityPreset = "720p30" | "1080p30" | "1080p60";

export interface WebcamQualityConfig {
	id: WebcamQualityPreset;
	label: string;
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
}

export const WEBCAM_QUALITY_PRESETS: WebcamQualityConfig[] = [
	{
		id: "720p30",
		label: "Smooth (720p · 30fps)",
		width: 1280,
		height: 720,
		frameRate: 30,
		bitrate: 8_000_000,
	},
	{
		id: "1080p30",
		label: "Sharp (1080p · 30fps)",
		width: 1920,
		height: 1080,
		frameRate: 30,
		bitrate: 12_000_000,
	},
	{
		id: "1080p60",
		label: "Sharp+Smooth (1080p · 60fps)",
		width: 1920,
		height: 1080,
		frameRate: 60,
		bitrate: 16_000_000,
	},
];

export const DEFAULT_WEBCAM_QUALITY: WebcamQualityPreset = "1080p30";

export function getWebcamQualityConfig(id: WebcamQualityPreset | undefined): WebcamQualityConfig {
	return (
		WEBCAM_QUALITY_PRESETS.find((preset) => preset.id === id) ??
		WEBCAM_QUALITY_PRESETS.find((preset) => preset.id === DEFAULT_WEBCAM_QUALITY)!
	);
}
