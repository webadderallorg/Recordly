export type CloudPlan = "paid" | "not_paid" | "unknown";
export interface DecoderAttempt {
	code: string;
	sourceTimeSec?: number;
	chunkIndex?: number;
	chunkBytes?: number;
}
export interface ExportErrorReport {
	schemaVersion: number;
	cloudPlan: CloudPlan;
	format: "mp4" | "gif" | "unknown";
	failure: DecoderAttempt;
	stage: "input_decoding" | "saving" | "export";
	initialDecoder?: DecoderAttempt;
	softwareDecoder?: DecoderAttempt;
	appVersion?: string;
	platform: string;
	output?: { width: number; height: number; fps: number };
}
const codes = [
	"UNKNOWN",
	"SAVE_FAILED",
	"AUDIO_FAILED",
	"ENCODE_FAILED",
	"EXPORT_FAILED",
	"VIDEO_DECODE_ENCODING_ERROR",
	"VIDEO_DECODER_RESOURCE_EXHAUSTED",
	"VIDEO_DECODER_INVALID_STATE",
	"VIDEO_DECODE_FAILED",
	"VIDEO_CODEC_UNSUPPORTED",
	"VIDEO_DECODE_RECOVERY_FAILED",
];
const object = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
	Object.keys(value).every((key) => allowed.includes(key));
const oneOf = (value: unknown, allowed: string[]) =>
	typeof value === "string" && allowed.includes(value);
const number = (value: unknown, max: number, integer = false) =>
	typeof value === "number" &&
	Number.isFinite(value) &&
	value >= 0 &&
	value <= max &&
	(!integer || Number.isInteger(value));
function attempt(value: unknown) {
	return (
		object(value) &&
		keys(value, ["code", "sourceTimeSec", "chunkIndex", "chunkBytes"]) &&
		typeof value.code === "string" &&
		codes.includes(value.code) &&
		(value.sourceTimeSec === undefined || number(value.sourceTimeSec, 86400)) &&
		(value.chunkIndex === undefined || number(value.chunkIndex, 100_000_000, true)) &&
		(value.chunkBytes === undefined || number(value.chunkBytes, 100_000_000, true))
	);
}
/** Reject arbitrary strings/extra fields, including any account or free-text diagnostics. */
export function isExportErrorReport(value: unknown): value is ExportErrorReport {
	if (
		!object(value) ||
		!keys(value, [
			"schemaVersion",
			"cloudPlan",
			"format",
			"failure",
			"stage",
			"initialDecoder",
			"softwareDecoder",
			"appVersion",
			"platform",
			"output",
		])
	)
		return false;
	if (
		value.schemaVersion !== 1 ||
		!oneOf(value.cloudPlan, ["paid", "not_paid", "unknown"]) ||
		!oneOf(value.format, ["mp4", "gif", "unknown"]) ||
		!oneOf(value.stage, ["input_decoding", "saving", "export"]) ||
		!oneOf(value.platform, ["Windows", "macOS", "Linux", "unknown"]) ||
		!attempt(value.failure)
	)
		return false;
	if (value.initialDecoder !== undefined && !attempt(value.initialDecoder)) return false;
	if (value.softwareDecoder !== undefined && !attempt(value.softwareDecoder)) return false;
	if (
		value.appVersion !== undefined &&
		(typeof value.appVersion !== "string" ||
			!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.appVersion))
	)
		return false;
	return (
		value.output === undefined ||
		(object(value.output) &&
			keys(value.output, ["width", "height", "fps"]) &&
			number(value.output.width, 16384, true) &&
			number(value.output.height, 16384, true) &&
			number(value.output.fps, 240))
	);
}
