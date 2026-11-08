export const NATIVE_EXPORT_ENGINE_NAME = "Breeze";
export const MEDIA_SOURCE_RETRY_ERROR_TOKENS = [
	"readavpacket",
	"get_media_info",
	"avfoundation",
	"failed after 3 attempts",
	"pipeline failed",
];
export const LIGHTNING_PIPELINE_NAME = "Lightning (Beta)";
export const STATIC_LAYOUT_CHUNK_DURATION_SEC = 120;
export const NATIVE_STATIC_LAYOUT_MAX_EXTRACTING_PROGRESS = 95;
export const NATIVE_STATIC_LAYOUT_FRAME_COMPLETE_PROGRESS = 96;
export const NATIVE_ENCODER_QUEUE_LIMIT = 64;
export const NATIVE_WRITE_BATCH_MAX_CHUNKS = 12;
export const NATIVE_WRITE_BATCH_MAX_BYTES = 2 * 1024 * 1024;
export const ENCODER_PROGRESS_TIMEOUT_MS = 30_000;

export function getNowMs(): number {
	if (typeof performance !== "undefined" && typeof performance.now === "function")
		return performance.now();
	return Date.now();
}
