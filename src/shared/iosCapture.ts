export type IOSSessionId = string;
export type IOSDeviceToken = string;
export type IOSCaptureMode = "passthrough" | "h264-encode";
export type AudioAvailability = "unknown" | "available" | "unavailable";

export interface NativeTime {
	value: string;
	timescale: number;
}

export interface IOSRecordingOptions {
	deviceAudio: boolean;
	microphoneToken: IOSDeviceToken | null;
}

export interface IOSVideoFormat {
	codedWidth: number;
	codedHeight: number;
	displayWidth: number;
	displayHeight: number;
	codec: string;
	colorPrimaries: string | null;
	transferFunction: string | null;
	ycbcrMatrix: string | null;
	fullRange: boolean | null;
	transform: readonly [number, number, number, number, number, number];
	observedFrameRate: number | null;
	fingerprint: string;
}

export interface IOSAudioFormat {
	codec: string;
	sampleRate: number;
	channels: number;
}

export interface IOSDeviceSource {
	sourceType: "ios-device";
	id: string;
	deviceToken: IOSDeviceToken;
	displayName: string;
	generation: number;
	deviceAudio: AudioAvailability;
}

export interface IOSMicrophoneOption {
	token: IOSDeviceToken;
	label: string;
}

export type CaptureSource<TDesktop> = TDesktop | IOSDeviceSource;
export type IOSCapturePhase =
	| "unavailable"
	| "idle"
	| "discovering"
	| "preparing"
	| "ready"
	| "starting"
	| "recording"
	| "stopping"
	| "finalising"
	| "completed"
	| "cancelled"
	| "failed"
	| "interrupted"
	| "recoveryAvailable";

export const IOS_CAPTURE_ERROR_CODES = [
	"UNSUPPORTED_PLATFORM",
	"HELPER_UNAVAILABLE",
	"PROTOCOL_MISMATCH",
	"PERMISSION_DENIED",
	"DEVICE_NOT_FOUND",
	"DEVICE_BUSY",
	"UNSUPPORTED_FORMAT",
	"NO_VIDEO_SAMPLES",
	"CLOCK_MAPPING_UNAVAILABLE",
	"RECORDING_BUSY",
	"FORMAT_CHANGED",
	"DEVICE_DISCONNECTED",
	"AUDIO_INTERRUPTED",
	"DISK_SPACE_LOW",
	"WRITER_FAILED",
	"FINALIZATION_FAILED",
	"HELPER_EXITED",
	"INVALID_REQUEST",
	"UNSUPPORTED_OPERATION",
] as const;
export type IOSCaptureErrorCode = (typeof IOS_CAPTURE_ERROR_CODES)[number];

export interface IOSCaptureFailure {
	code: IOSCaptureErrorCode;
	recoverable: boolean;
}

export interface IOSCaptureSnapshot {
	sequence: number;
	generation: number;
	sessionId: IOSSessionId | null;
	phase: IOSCapturePhase;
	devices: readonly IOSDeviceSource[];
	microphones: readonly IOSMicrophoneOption[];
	source: IOSDeviceSource | null;
	options: IOSRecordingOptions | null;
	format: IOSVideoFormat | null;
	mode: IOSCaptureMode | null;
	elapsedMs: number;
	acceptedVideoSamples: number;
	warningCodes: readonly string[];
	error: IOSCaptureFailure | null;
}

export interface CaptureMetadata {
	version: 1;
	sourceKind: "ios-device";
	mode: IOSCaptureMode;
	format: IOSVideoFormat;
	deviceAudioRecorded: boolean;
	narrationRecorded: boolean;
	stopReason: string;
	interrupted: boolean;
}

export interface CommittedIOSRecording {
	sessionId: IOSSessionId;
	videoPath: string;
	hideOverlayCursorByDefault: true;
	captureMetadata: CaptureMetadata;
}

export interface NativeVideoMediaFormat {
	codec: string;
	width: number;
	height: number;
}

export interface NativeMediaArtifact {
	relativeName: string;
	mediaKind: "video" | "device-audio" | "microphone";
	firstHostTime: NativeTime;
	duration: NativeTime;
	sampleCount: number;
	mediaFormat: NativeVideoMediaFormat | IOSAudioFormat;
}

export interface NativeClockRate {
	numerator: string;
	denominator: string;
}

export interface NativeClockAnchor {
	hostTime: NativeTime;
	mediaTime: NativeTime;
}

export interface NativeTimingGap {
	start: NativeTime;
	duration: NativeTime;
}

export interface NativeTimingStream {
	mediaKind: NativeMediaArtifact["mediaKind"];
	firstHostTime: NativeTime;
	duration: NativeTime;
	rate: NativeClockRate;
	clockAnchor: NativeClockAnchor;
	gaps: readonly NativeTimingGap[];
}

export interface NativeTiming {
	version: 1;
	timeline: "host-mapped";
	gapsRepresentedInMedia: true;
	streams: readonly NativeTimingStream[];
}

export interface NativeCaptureResult {
	sessionId: IOSSessionId;
	stopReason: string;
	format: IOSVideoFormat;
	mode: IOSCaptureMode;
	video: NativeMediaArtifact;
	deviceAudio?: NativeMediaArtifact;
	microphone?: NativeMediaArtifact;
	timingFile: "native-timing.json";
	timing?: NativeTiming;
}

export interface IOSMediaInspection {
	decodable: boolean;
	duration: NativeTime;
	video?: IOSVideoFormat;
	audio?: IOSAudioFormat;
}
export type NativeMediaInspection = IOSMediaInspection;

export const IOS_CAPTURE_CAPABILITIES = Object.freeze({
	supportsPause: false,
	supportsWebcam: false,
	supportsTouchTelemetry: false,
	previewMaxLongestEdge: 480,
	previewMaxFramesPerSecond: 5,
	previewMaxJpegBytes: 128 * 1024,
	protocolVersion: 1,
} as const);

type RendererCommand =
	| { protocolVersion: 1; requestId: string; command: "hello" | "discover" }
	| {
			protocolVersion: 1;
			requestId: string;
			command: "prepare";
			generation: number;
			payload: { deviceToken: IOSDeviceToken; options: IOSRecordingOptions };
	  }
	| {
			protocolVersion: 1;
			requestId: string;
			command: "setPreviewEnabled";
			sessionId: IOSSessionId;
			generation: number;
			payload: { enabled: boolean };
	  }
	| {
			protocolVersion: 1;
			requestId: string;
			command: "start" | "stop" | "release";
			sessionId: IOSSessionId;
	  }
	| {
			protocolVersion: 1;
			requestId: string;
			command: "cancel";
			sessionId: IOSSessionId;
			payload: { discardAcceptedMedia: boolean };
	  };

export type IOSCaptureCommand = RendererCommand;
export interface NativeStorageCapability {
	sessionRoot: string;
	allowedRelativeNames: readonly string[];
}
export type NativeIOSCaptureCommand =
	| RendererCommand
	| {
			protocolVersion: 1;
			requestId: string;
			command: "prepare";
			sessionId: IOSSessionId;
			generation: number;
			payload: {
				deviceToken: IOSDeviceToken;
				inventoryGeneration: number;
				options: IOSRecordingOptions;
			};
			storage: NativeStorageCapability;
	  }
	| {
			protocolVersion: 1;
			requestId: string;
			command: "inspectMedia";
			sessionId: IOSSessionId;
			payload: { relativeName: string };
			storage: NativeStorageCapability;
	  }
	| { protocolVersion: 1; requestId: string; command: "shutdown" };

export type IOSCaptureEvent =
	| {
			protocolVersion: 1;
			event: "accepted";
			sequence: number;
			requestId: string;
			sessionId?: IOSSessionId;
			generation?: number;
			payload:
				| Record<string, never>
				| {
						build: string;
						protocolVersion: 1;
						capabilities: typeof IOS_CAPTURE_CAPABILITIES;
				  }
				| { inspection: IOSMediaInspection };
	  }
	| {
			protocolVersion: 1;
			event: "inventoryChanged";
			sequence: number;
			requestId?: never;
			generation?: number;
			payload: {
				devices: readonly IOSDeviceSource[];
				microphones: readonly IOSMicrophoneOption[];
				inventoryGeneration: number;
			};
	  }
	| {
			protocolVersion: 1;
			event: "prepared";
			sequence: number;
			requestId?: never;
			sessionId: IOSSessionId;
			generation: number;
			payload: {
				source: IOSDeviceSource;
				options: IOSRecordingOptions;
				format: IOSVideoFormat;
				mode: IOSCaptureMode;
			};
	  }
	| {
			protocolVersion: 1;
			event: "recordingStarted";
			sequence: number;
			requestId?: never;
			sessionId: IOSSessionId;
			generation: number;
			payload: { firstHostTime: NativeTime; acceptedVideoSamples: number };
	  }
	| {
			protocolVersion: 1;
			event: "progress";
			sequence: number;
			requestId?: never;
			sessionId: IOSSessionId;
			generation: number;
			payload: { elapsedMs: number; acceptedVideoSamples: number };
	  }
	| {
			protocolVersion: 1;
			event: "warning";
			sequence: number;
			requestId?: never;
			sessionId?: IOSSessionId;
			generation?: number;
			payload: { code: string };
	  }
	| {
			protocolVersion: 1;
			event: "nativeFinalized";
			sequence: number;
			requestId?: never;
			sessionId: IOSSessionId;
			generation: number;
			payload: { result: NativeCaptureResult };
	  }
	| {
			protocolVersion: 1;
			event: "error";
			sequence: number;
			requestId?: string;
			sessionId?: IOSSessionId;
			generation?: number;
			payload: IOSCaptureFailure;
	  };

const TOKEN = /^[A-Za-z0-9._~-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

function fail(message: string): never {
	throw new TypeError(`Invalid iOS capture contract: ${message}`);
}
function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(name);
	return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[], name: string): void {
	if (Object.keys(value).some((key) => !keys.includes(key))) fail(`${name} has unknown fields`);
}
function string(value: unknown, name: string, max = 256): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max) fail(name);
	return value;
}
function token(value: unknown, name: string): string {
	const result = string(value, name, 128);
	if (!TOKEN.test(result)) fail(name);
	return result;
}
function uuid(value: unknown, name: string): string {
	const result = string(value, name, 36);
	if (!UUID.test(result)) fail(name);
	return result;
}
function integer(value: unknown, name: string, minimum = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(name);
	return value as number;
}
function finite(value: unknown, name: string, minimum = 0): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) fail(name);
	return value;
}
function nullableString(value: unknown, name: string): string | null {
	return value === null ? null : string(value, name);
}

export function validateNativeTime(value: unknown): value is NativeTime {
	try {
		const input = record(value, "native time");
		exact(input, ["value", "timescale"], "native time");
		if (typeof input.value !== "string" || !/^-?(0|[1-9]\d*)$/.test(input.value)) return false;
		const ticks = BigInt(input.value);
		return (
			ticks >= INT64_MIN &&
			ticks <= INT64_MAX &&
			Number.isInteger(input.timescale) &&
			(input.timescale as number) > 0 &&
			(input.timescale as number) <= 1_000_000_000
		);
	} catch {
		return false;
	}
}

function nativeTime(value: unknown, name: string): NativeTime {
	if (!validateNativeTime(value)) fail(name);
	return value;
}

export function isIOSDeviceSource(value: unknown): value is IOSDeviceSource {
	try {
		const input = record(value, "device source");
		exact(
			input,
			["sourceType", "id", "deviceToken", "displayName", "generation", "deviceAudio"],
			"device source",
		);
		if (input.sourceType !== "ios-device") return false;
		const deviceToken = token(input.deviceToken, "device token");
		if (input.id !== `ios-device:${deviceToken}`) return false;
		string(input.displayName, "display name", 256);
		integer(input.generation, "generation");
		return (
			input.deviceAudio === "unknown" ||
			input.deviceAudio === "available" ||
			input.deviceAudio === "unavailable"
		);
	} catch {
		return false;
	}
}

function options(value: unknown): IOSRecordingOptions {
	const input = record(value, "recording options");
	exact(input, ["deviceAudio", "microphoneToken"], "recording options");
	if (typeof input.deviceAudio !== "boolean") fail("deviceAudio");
	return {
		deviceAudio: input.deviceAudio,
		microphoneToken:
			input.microphoneToken === null ? null : token(input.microphoneToken, "microphoneToken"),
	};
}

export function parseIOSRecordingOptions(value: unknown): IOSRecordingOptions {
	return options(value);
}

export function parseIOSDeviceSource(value: unknown): IOSDeviceSource {
	if (!isIOSDeviceSource(value)) fail("device source");
	return value;
}

function baseCommand(value: unknown): Record<string, unknown> {
	const input = record(value, "command");
	if (input.protocolVersion !== 1) fail("protocolVersion");
	token(input.requestId, "requestId");
	return input;
}

function parseRendererCommand(value: unknown): RendererCommand {
	const input = baseCommand(value);
	switch (input.command) {
		case "hello":
		case "discover":
			exact(input, ["protocolVersion", "requestId", "command"], "command");
			break;
		case "prepare": {
			exact(
				input,
				["protocolVersion", "requestId", "command", "generation", "payload"],
				"command",
			);
			integer(input.generation, "generation");
			const payload = record(input.payload, "prepare payload");
			exact(payload, ["deviceToken", "options"], "prepare payload");
			token(payload.deviceToken, "deviceToken");
			options(payload.options);
			break;
		}
		case "setPreviewEnabled": {
			exact(
				input,
				["protocolVersion", "requestId", "command", "sessionId", "generation", "payload"],
				"command",
			);
			uuid(input.sessionId, "sessionId");
			integer(input.generation, "generation");
			const payload = record(input.payload, "preview payload");
			exact(payload, ["enabled"], "preview payload");
			if (typeof payload.enabled !== "boolean") fail("enabled");
			break;
		}
		case "start":
		case "stop":
		case "release":
			exact(input, ["protocolVersion", "requestId", "command", "sessionId"], "command");
			uuid(input.sessionId, "sessionId");
			break;
		case "cancel": {
			exact(
				input,
				["protocolVersion", "requestId", "command", "sessionId", "payload"],
				"command",
			);
			uuid(input.sessionId, "sessionId");
			const payload = record(input.payload, "cancel payload");
			exact(payload, ["discardAcceptedMedia"], "cancel payload");
			if (typeof payload.discardAcceptedMedia !== "boolean") fail("discardAcceptedMedia");
			break;
		}
		default:
			fail("command");
	}
	return value as RendererCommand;
}

export function parseIOSCaptureCommand(value: unknown): IOSCaptureCommand {
	return parseRendererCommand(value);
}

function storage(value: unknown): NativeStorageCapability {
	const input = record(value, "storage capability");
	exact(input, ["sessionRoot", "allowedRelativeNames"], "storage capability");
	string(input.sessionRoot, "sessionRoot", 4096);
	if (
		!Array.isArray(input.allowedRelativeNames) ||
		input.allowedRelativeNames.length === 0 ||
		input.allowedRelativeNames.length > 16
	)
		fail("allowedRelativeNames");
	for (const name of input.allowedRelativeNames) {
		const relative = string(name, "relative name", 128);
		if (
			relative.includes("/") ||
			relative.includes("\\") ||
			relative === "." ||
			relative === ".."
		)
			fail("relative name");
	}
	return value as NativeStorageCapability;
}

export function parseNativeIOSCaptureCommand(value: unknown): NativeIOSCaptureCommand {
	const input = baseCommand(value);
	if (input.command === "shutdown") {
		exact(input, ["protocolVersion", "requestId", "command"], "command");
		return value as NativeIOSCaptureCommand;
	}
	if (input.command === "inspectMedia") {
		exact(
			input,
			["protocolVersion", "requestId", "command", "sessionId", "payload", "storage"],
			"command",
		);
		uuid(input.sessionId, "sessionId");
		storage(input.storage);
		const payload = record(input.payload, "inspect payload");
		exact(payload, ["relativeName"], "inspect payload");
		const name = string(payload.relativeName, "relativeName", 128);
		if (name.includes("/") || name.includes("\\") || name === "." || name === "..")
			fail("relativeName");
		return value as NativeIOSCaptureCommand;
	}
	if (input.command === "prepare" && "storage" in input) {
		exact(
			input,
			[
				"protocolVersion",
				"requestId",
				"command",
				"sessionId",
				"generation",
				"payload",
				"storage",
			],
			"command",
		);
		uuid(input.sessionId, "sessionId");
		integer(input.generation, "generation");
		storage(input.storage);
		const payload = record(input.payload, "prepare payload");
		exact(payload, ["deviceToken", "inventoryGeneration", "options"], "prepare payload");
		token(payload.deviceToken, "deviceToken");
		integer(payload.inventoryGeneration, "inventoryGeneration");
		options(payload.options);
		return value as NativeIOSCaptureCommand;
	}
	return parseRendererCommand(value);
}

function videoFormat(value: unknown): IOSVideoFormat {
	const input = record(value, "video format");
	exact(
		input,
		[
			"codedWidth",
			"codedHeight",
			"displayWidth",
			"displayHeight",
			"codec",
			"colorPrimaries",
			"transferFunction",
			"ycbcrMatrix",
			"fullRange",
			"transform",
			"observedFrameRate",
			"fingerprint",
		],
		"video format",
	);
	for (const key of ["codedWidth", "codedHeight", "displayWidth", "displayHeight"] as const)
		integer(input[key], key, 1);
	string(input.codec, "codec", 64);
	nullableString(input.colorPrimaries, "colorPrimaries");
	nullableString(input.transferFunction, "transferFunction");
	nullableString(input.ycbcrMatrix, "ycbcrMatrix");
	if (input.fullRange !== null && typeof input.fullRange !== "boolean") fail("fullRange");
	if (
		!Array.isArray(input.transform) ||
		input.transform.length !== 6 ||
		input.transform.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
	)
		fail("transform");
	if (input.observedFrameRate !== null) finite(input.observedFrameRate, "observedFrameRate");
	token(input.fingerprint, "fingerprint");
	return value as IOSVideoFormat;
}

export function parseIOSVideoFormat(value: unknown): IOSVideoFormat {
	return videoFormat(value);
}

export function parseIOSCaptureSnapshot(value: unknown): IOSCaptureSnapshot {
	const input = record(value, "capture snapshot");
	exact(
		input,
		[
			"sequence",
			"generation",
			"sessionId",
			"phase",
			"devices",
			"microphones",
			"source",
			"options",
			"format",
			"mode",
			"elapsedMs",
			"acceptedVideoSamples",
			"warningCodes",
			"error",
		],
		"capture snapshot",
	);
	integer(input.sequence, "sequence");
	integer(input.generation, "generation");
	if (input.sessionId !== null) uuid(input.sessionId, "sessionId");
	const phases: readonly IOSCapturePhase[] = [
		"unavailable",
		"idle",
		"discovering",
		"preparing",
		"ready",
		"starting",
		"recording",
		"stopping",
		"finalising",
		"completed",
		"cancelled",
		"failed",
		"interrupted",
		"recoveryAvailable",
	];
	if (!phases.includes(input.phase as IOSCapturePhase)) fail("phase");
	if (!Array.isArray(input.devices) || !input.devices.every(isIOSDeviceSource)) fail("devices");
	if (!Array.isArray(input.microphones)) fail("microphones");
	for (const mic of input.microphones) {
		const item = record(mic, "microphone");
		exact(item, ["token", "label"], "microphone");
		token(item.token, "microphone token");
		string(item.label, "microphone label");
	}
	if (input.source !== null && !isIOSDeviceSource(input.source)) fail("source");
	if (input.options !== null) options(input.options);
	if (input.format !== null) videoFormat(input.format);
	if (input.mode !== null && input.mode !== "passthrough" && input.mode !== "h264-encode")
		fail("mode");
	finite(input.elapsedMs, "elapsedMs");
	integer(input.acceptedVideoSamples, "acceptedVideoSamples");
	if (!Array.isArray(input.warningCodes) || input.warningCodes.length > 64) fail("warningCodes");
	for (const code of input.warningCodes) token(code, "warningCode");
	if (input.error !== null) {
		const error = record(input.error, "error");
		exact(error, ["code", "recoverable"], "error");
		if (
			!(IOS_CAPTURE_ERROR_CODES as readonly unknown[]).includes(error.code) ||
			typeof error.recoverable !== "boolean"
		)
			fail("error");
	}
	return value as IOSCaptureSnapshot;
}

export function parseCaptureMetadata(value: unknown): CaptureMetadata {
	const input = record(value, "capture metadata");
	exact(
		input,
		[
			"version",
			"sourceKind",
			"mode",
			"format",
			"deviceAudioRecorded",
			"narrationRecorded",
			"stopReason",
			"interrupted",
		],
		"capture metadata",
	);
	if (input.version !== 1 || input.sourceKind !== "ios-device") fail("capture metadata version");
	if (input.mode !== "passthrough" && input.mode !== "h264-encode") fail("mode");
	videoFormat(input.format);
	if (
		typeof input.deviceAudioRecorded !== "boolean" ||
		typeof input.narrationRecorded !== "boolean" ||
		typeof input.interrupted !== "boolean"
	)
		fail("capture metadata flags");
	string(input.stopReason, "stopReason", 128);
	return value as CaptureMetadata;
}

export function normalizeCaptureMetadata(value: unknown): CaptureMetadata | undefined {
	try {
		return parseCaptureMetadata(value);
	} catch {
		return undefined;
	}
}

export function parseCommittedIOSRecording(value: unknown): CommittedIOSRecording {
	const input = record(value, "committed recording");
	exact(
		input,
		["sessionId", "videoPath", "hideOverlayCursorByDefault", "captureMetadata"],
		"committed recording",
	);
	uuid(input.sessionId, "sessionId");
	string(input.videoPath, "videoPath", 4096);
	if (input.hideOverlayCursorByDefault !== true) fail("hideOverlayCursorByDefault");
	parseCaptureMetadata(input.captureMetadata);
	return value as CommittedIOSRecording;
}

function mediaArtifact(
	value: unknown,
	expected?: NativeMediaArtifact["mediaKind"],
): NativeMediaArtifact {
	const input = record(value, "media artifact");
	exact(
		input,
		["relativeName", "mediaKind", "firstHostTime", "duration", "sampleCount", "mediaFormat"],
		"media artifact",
	);
	const relativeName = string(input.relativeName, "relativeName", 128);
	if (relativeName.includes("/") || relativeName.includes("\\")) fail("relativeName");
	if (
		input.mediaKind !== "video" &&
		input.mediaKind !== "device-audio" &&
		input.mediaKind !== "microphone"
	)
		fail("mediaKind");
	if (expected && input.mediaKind !== expected) fail("mediaKind");
	nativeTime(input.firstHostTime, "firstHostTime");
	nativeTime(input.duration, "duration");
	integer(input.sampleCount, "sampleCount", 1);
	const format = record(input.mediaFormat, "mediaFormat");
	if (input.mediaKind === "video") {
		exact(format, ["codec", "width", "height"], "video media format");
		string(format.codec, "codec", 64);
		integer(format.width, "width", 1);
		integer(format.height, "height", 1);
	} else {
		exact(format, ["codec", "sampleRate", "channels"], "audio media format");
		string(format.codec, "codec", 64);
		integer(format.sampleRate, "sampleRate", 1);
		integer(format.channels, "channels", 1);
	}
	return value as NativeMediaArtifact;
}

export function parseNativeTiming(value: unknown): NativeTiming {
	const input = record(value, "native timing");
	exact(input, ["version", "timeline", "gapsRepresentedInMedia", "streams"], "native timing");
	if (
		input.version !== 1 ||
		input.timeline !== "host-mapped" ||
		input.gapsRepresentedInMedia !== true ||
		!Array.isArray(input.streams) ||
		input.streams.length === 0 ||
		input.streams.length > 3
	)
		fail("native timing");
	for (const item of input.streams) {
		const stream = record(item, "timing stream");
		exact(
			stream,
			["mediaKind", "firstHostTime", "duration", "rate", "clockAnchor", "gaps"],
			"timing stream",
		);
		if (
			stream.mediaKind !== "video" &&
			stream.mediaKind !== "device-audio" &&
			stream.mediaKind !== "microphone"
		)
			fail("mediaKind");
		nativeTime(stream.firstHostTime, "firstHostTime");
		nativeTime(stream.duration, "duration");
		const rate = record(stream.rate, "rate");
		exact(rate, ["numerator", "denominator"], "rate");
		const numerator = nativeTime(
			{ value: rate.numerator, timescale: 1 },
			"rate numerator",
		).value;
		const denominator = nativeTime(
			{ value: rate.denominator, timescale: 1 },
			"rate denominator",
		).value;
		if (BigInt(numerator) <= 0n || BigInt(denominator) <= 0n) fail("rate");
		const anchor = record(stream.clockAnchor, "clockAnchor");
		exact(anchor, ["hostTime", "mediaTime"], "clockAnchor");
		nativeTime(anchor.hostTime, "hostTime");
		nativeTime(anchor.mediaTime, "mediaTime");
		if (!Array.isArray(stream.gaps) || stream.gaps.length > 10_000) fail("gaps");
		for (const itemGap of stream.gaps) {
			const gap = record(itemGap, "gap");
			exact(gap, ["start", "duration"], "gap");
			nativeTime(gap.start, "gap start");
			nativeTime(gap.duration, "gap duration");
		}
	}
	return value as NativeTiming;
}

export function parseNativeCaptureResult(value: unknown): NativeCaptureResult {
	const input = record(value, "native result");
	exact(
		input,
		[
			"sessionId",
			"stopReason",
			"format",
			"mode",
			"video",
			"deviceAudio",
			"microphone",
			"timingFile",
			"timing",
		],
		"native result",
	);
	uuid(input.sessionId, "sessionId");
	string(input.stopReason, "stopReason", 128);
	videoFormat(input.format);
	if (input.mode !== "passthrough" && input.mode !== "h264-encode") fail("mode");
	mediaArtifact(input.video, "video");
	if (input.deviceAudio !== undefined) mediaArtifact(input.deviceAudio, "device-audio");
	if (input.microphone !== undefined) mediaArtifact(input.microphone, "microphone");
	if (input.timingFile !== "native-timing.json") fail("timingFile");
	if (input.timing !== undefined) parseNativeTiming(input.timing);
	return value as NativeCaptureResult;
}

export function parseNativeMediaInspection(value: unknown): NativeMediaInspection {
	const input = record(value, "media inspection");
	exact(input, ["decodable", "duration", "video", "audio"], "media inspection");
	if (typeof input.decodable !== "boolean") fail("decodable");
	nativeTime(input.duration, "duration");
	if (input.video !== undefined) videoFormat(input.video);
	if (input.audio !== undefined) {
		const audio = record(input.audio, "audio format");
		exact(audio, ["codec", "sampleRate", "channels"], "audio format");
		string(audio.codec, "codec", 64);
		integer(audio.sampleRate, "sampleRate", 1);
		integer(audio.channels, "channels", 1);
	}
	return value as NativeMediaInspection;
}

function captureCapabilities(value: unknown): void {
	const input = record(value, "capabilities");
	exact(input, Object.keys(IOS_CAPTURE_CAPABILITIES), "capabilities");
	for (const [key, expected] of Object.entries(IOS_CAPTURE_CAPABILITIES)) {
		if (input[key] !== expected) fail("capabilities");
	}
}

function eventBase(value: unknown): Record<string, unknown> {
	const input = record(value, "event");
	if (input.protocolVersion !== 1) fail("protocolVersion");
	integer(input.sequence, "sequence");
	if (input.sessionId !== undefined) uuid(input.sessionId, "sessionId");
	if (input.generation !== undefined) integer(input.generation, "generation");
	if (input.requestId !== undefined) token(input.requestId, "requestId");
	return input;
}

export function parseIOSCaptureEvent(value: unknown): IOSCaptureEvent {
	const input = eventBase(value);
	const payload = record(input.payload, "event payload");
	switch (input.event) {
		case "accepted":
			exact(
				input,
				[
					"protocolVersion",
					"event",
					"sequence",
					"requestId",
					"sessionId",
					"generation",
					"payload",
				],
				"event",
			);
			token(input.requestId, "requestId");
			if ("inspection" in payload) {
				exact(payload, ["inspection"], "inspection response");
				parseNativeMediaInspection(payload.inspection);
			} else if (Object.keys(payload).length > 0) {
				exact(payload, ["build", "protocolVersion", "capabilities"], "hello payload");
				string(payload.build, "build");
				if (payload.protocolVersion !== 1) fail("hello payload");
				captureCapabilities(payload.capabilities);
			}
			break;
		case "inventoryChanged":
			exact(
				input,
				["protocolVersion", "event", "sequence", "generation", "payload"],
				"event",
			);
			exact(payload, ["devices", "microphones", "inventoryGeneration"], "inventory payload");
			if (!Array.isArray(payload.devices) || !payload.devices.every(isIOSDeviceSource))
				fail("devices");
			if (!Array.isArray(payload.microphones)) fail("microphones");
			for (const mic of payload.microphones) {
				const item = record(mic, "microphone");
				exact(item, ["token", "label"], "microphone");
				token(item.token, "microphone token");
				string(item.label, "microphone label");
			}
			integer(payload.inventoryGeneration, "inventoryGeneration");
			break;
		case "prepared":
			exact(
				input,
				["protocolVersion", "event", "sequence", "sessionId", "generation", "payload"],
				"event",
			);
			if (input.sessionId === undefined || input.generation === undefined)
				fail("session scope");
			exact(payload, ["source", "options", "format", "mode"], "prepared payload");
			if (!isIOSDeviceSource(payload.source)) fail("source");
			options(payload.options);
			videoFormat(payload.format);
			if (payload.mode !== "passthrough" && payload.mode !== "h264-encode") fail("mode");
			break;
		case "recordingStarted":
			exact(
				input,
				["protocolVersion", "event", "sequence", "sessionId", "generation", "payload"],
				"event",
			);
			if (input.sessionId === undefined || input.generation === undefined)
				fail("session scope");
			exact(payload, ["firstHostTime", "acceptedVideoSamples"], "started payload");
			nativeTime(payload.firstHostTime, "firstHostTime");
			integer(payload.acceptedVideoSamples, "acceptedVideoSamples", 1);
			break;
		case "progress":
			exact(
				input,
				["protocolVersion", "event", "sequence", "sessionId", "generation", "payload"],
				"event",
			);
			if (input.sessionId === undefined || input.generation === undefined)
				fail("session scope");
			exact(payload, ["elapsedMs", "acceptedVideoSamples"], "progress payload");
			finite(payload.elapsedMs, "elapsedMs");
			integer(payload.acceptedVideoSamples, "acceptedVideoSamples");
			break;
		case "warning":
			exact(
				input,
				["protocolVersion", "event", "sequence", "sessionId", "generation", "payload"],
				"event",
			);
			exact(payload, ["code"], "warning payload");
			token(payload.code, "warning code");
			break;
		case "nativeFinalized":
			exact(
				input,
				["protocolVersion", "event", "sequence", "sessionId", "generation", "payload"],
				"event",
			);
			if (input.sessionId === undefined || input.generation === undefined)
				fail("session scope");
			exact(payload, ["result"], "finalized payload");
			parseNativeCaptureResult(payload.result);
			break;
		case "error":
			exact(
				input,
				[
					"protocolVersion",
					"event",
					"sequence",
					"requestId",
					"sessionId",
					"generation",
					"payload",
				],
				"event",
			);
			exact(payload, ["code", "recoverable"], "error payload");
			if (
				!(IOS_CAPTURE_ERROR_CODES as readonly unknown[]).includes(payload.code) ||
				typeof payload.recoverable !== "boolean"
			)
				fail("error");
			break;
		default:
			fail("event");
	}
	return value as IOSCaptureEvent;
}
