const MIN_WHISPER_TIMEOUT_MS = 30 * 60 * 1000;
// Whisper small with DTW measured ~0.4x realtime on a 12-thread laptop CPU; 3x leaves
// headroom for much slower machines without cutting off long recordings.
const WHISPER_TIMEOUT_PER_AUDIO_SECOND_MS = 3 * 1000;
const WAV_HEADER_BYTES = 44;
// Caption audio is extracted as 16 kHz mono signed 16-bit PCM.
const CAPTION_WAV_BYTES_PER_SECOND = 16_000 * 2;

export class WhisperTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(
			`Whisper did not finish transcribing within ${Math.round(timeoutMs / 60_000)} minutes. Try a smaller Whisper model or a shorter recording.`,
		);
		this.name = "WhisperTimeoutError";
	}
}

export function getWavDurationSec(fileSizeBytes: number): number {
	return Math.max(0, fileSizeBytes - WAV_HEADER_BYTES) / CAPTION_WAV_BYTES_PER_SECOND;
}

export function getWhisperTimeoutMs(audioDurationSec: number): number {
	if (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0) {
		return MIN_WHISPER_TIMEOUT_MS;
	}
	return Math.max(
		MIN_WHISPER_TIMEOUT_MS,
		Math.ceil(audioDurationSec * WHISPER_TIMEOUT_PER_AUDIO_SECOND_MS),
	);
}

/** execFile marks a child killed by its `timeout` option with `killed: true`. */
export function isProcessTimeoutError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { killed?: unknown }).killed === true
	);
}
