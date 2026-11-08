export const TARGET_FRAME_RATE = 60;
export const TARGET_WIDTH = 3840;
export const TARGET_HEIGHT = 2160;
export const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;
export const QHD_WIDTH = 2560;
export const QHD_HEIGHT = 1440;
export const QHD_PIXELS = QHD_WIDTH * QHD_HEIGHT;
export const BITRATE_4K = 45_000_000;
export const BITRATE_QHD = 28_000_000;
export const BITRATE_BASE = 18_000_000;
export const HIGH_FRAME_RATE_THRESHOLD = 60;
export const HIGH_FRAME_RATE_BOOST = 1.7;
export const DEFAULT_WIDTH = 1920;
export const DEFAULT_HEIGHT = 1080;
export const CODEC_ALIGNMENT = 2;
export const RECORDER_TIMESLICE_MS = 250;
export const BITS_PER_MEGABIT = 1_000_000;
export const MIN_FRAME_RATE = 30;
export const CHROME_MEDIA_SOURCE = "desktop";
export const RECORDING_FILE_PREFIX = "recording-";
export const AUDIO_BITRATE_VOICE = 128_000;
export const AUDIO_BITRATE_SYSTEM = 192_000;
export const MIC_GAIN_BOOST = 1.4;
type BrowserCaptureCursorMode = "always" | "never";
export type BrowserCaptureCursorPolicy = {
	streamCursor: BrowserCaptureCursorMode;
	hideOsCursorBeforeRecording: boolean;
	hideEditorOverlayCursorByDefault: boolean;
};

export function resolveBrowserCaptureCursorPolicy({
	nativeWindowsCaptureStartFailed = false,
}: {
	nativeWindowsCaptureStartFailed?: boolean;
} = {}): BrowserCaptureCursorPolicy {
	if (nativeWindowsCaptureStartFailed) {
		// If WGC already failed, avoid the telemetry overlay path that can lag on
		// constrained Windows systems; keep the browser-captured cursor instead.
		return {
			streamCursor: "always",
			hideOsCursorBeforeRecording: false,
			hideEditorOverlayCursorByDefault: true,
		};
	}

	return {
		streamCursor: "never",
		hideOsCursorBeforeRecording: true,
		hideEditorOverlayCursorByDefault: true,
	};
}

export function shouldUseNativeWindowsCaptureForSource(
	source: Pick<ProcessedDesktopSource, "id"> | null | undefined,
): boolean {
	return source?.id?.startsWith("screen:") === true || source?.id?.startsWith("window:") === true;
}

export function createBrowserRecordingOptions({
	audioBitsPerSecond,
	mimeType,
	videoBitsPerSecond,
}: {
	audioBitsPerSecond?: number;
	mimeType?: string;
	videoBitsPerSecond: number;
}): MediaRecorderOptions {
	const options: MediaRecorderOptions = {
		videoBitsPerSecond,
		bitsPerSecond: videoBitsPerSecond + (audioBitsPerSecond ?? 0),
	};

	if (audioBitsPerSecond !== undefined) {
		options.audioBitsPerSecond = audioBitsPerSecond;
	}

	if (mimeType) {
		options.mimeType = mimeType;
	}

	return options;
}
export const computeBitrate = (width: number, height: number) => {
	const pixels = width * height;
	const highFrameRateBoost =
		TARGET_FRAME_RATE >= HIGH_FRAME_RATE_THRESHOLD ? HIGH_FRAME_RATE_BOOST : 1;

	if (pixels >= FOUR_K_PIXELS) {
		return Math.round(BITRATE_4K * highFrameRateBoost);
	}

	if (pixels >= QHD_PIXELS) {
		return Math.round(BITRATE_QHD * highFrameRateBoost);
	}

	return Math.round(BITRATE_BASE * highFrameRateBoost);
};
