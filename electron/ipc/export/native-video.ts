import type { ChildProcessByStdio } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import type { MessagePortMain, WebContents } from "electron";
import { app, powerSaveBlocker } from "electron";
import type { NativeStaticLayoutOverlayLayer } from "../../../src/lib/exporter/nativeStaticLayoutOverlays";
import {
	getNativeStaticLayoutOverlayFrameByteSize,
	sortNativeStaticLayoutOverlayLayers,
	validateNativeStaticLayoutOverlayLayer,
} from "../../../src/lib/exporter/nativeStaticLayoutOverlays";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import type {
	ExportEncoderPreference,
	ExportVideoCodec,
	NativeExportEncodingMode,
	NativeStaticLayoutBackend,
	NativeStaticLayoutExportArgsConfig,
	NativeVideoAudioMuxMetrics,
	NativeVideoExportAudioMode,
	NativeVideoExportEditedTrackSegment,
	NativeVideoExportFinishOptions,
} from "../nativeVideoExport";
import {
	buildEditedTrackSourceAudioFilter,
	buildNativeConcatArgs,
	buildNativeCudaOverlayStaticLayoutArgs,
	buildNativeCudaScaleCpuPadStaticLayoutArgs,
	buildNativePrecompositedStaticLayoutArgs,
	buildNativeStaticBackgroundRenderArgs,
	buildNativeStaticLayoutChunks,
	buildNativeVideoExportArgs,
	buildTrimmedSourceAudioFilter,
	createNativeSquircleMaskPgmBuffer,
	getEditedAudioExtension,
	getNativeEncoderCandidates,
	getNativeVideoInputByteSize,
	isNativeCudaOutOfMemory,
	parseAvailableFfmpegEncoders,
} from "../nativeVideoExport";
import { cachedNativeVideoEncoder, setCachedNativeVideoEncoder } from "../state";

const execFileAsync = promisify(execFile);
const getNowMs = () => performance.now();
const formatFfmpegSeconds = (milliseconds: number) => (milliseconds / 1000).toFixed(3);
const MISSING_NATIVE_STATIC_BACKGROUND_COLOR = "#ffffff";
const NATIVE_EXPORT_HIGH_PRIORITY = os.constants.priority.PRIORITY_HIGH;
// Dummy frame size used to probe whether an encoder can initialize. Must be
// large enough to satisfy hardware encoder minimums (NVENC rejects frames
// smaller than ~192x192 on recent NVIDIA drivers), while staying cheap.
const NATIVE_ENCODER_PROBE_DIMENSION = 256;
const NVIDIA_PCI_VENDOR_ID = 0x10de;
const NVIDIA_CUDA_EXPORT_ENV = "RECORDLY_EXPERIMENTAL_NVIDIA_CUDA_EXPORT";
const NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV = "RECORDLY_NVIDIA_CUDA_ALLOW_AUDIO_EXPORT";
const NVIDIA_CUDA_FORCE_VIDEO_ONLY_ENV = "RECORDLY_NVIDIA_CUDA_FORCE_VIDEO_ONLY";
const NVIDIA_CUDA_AUTO_STALL_TIMEOUT_ENV = "RECORDLY_NVIDIA_CUDA_AUTO_STALL_TIMEOUT_MS";
const DEFAULT_NVIDIA_CUDA_AUTO_STALL_TIMEOUT_MS = 120_000;
const NATIVE_GPU_STALL_TIMEOUT_ENV = "RECORDLY_NATIVE_GPU_STALL_TIMEOUT_MS";
const DEFAULT_NATIVE_GPU_STALL_TIMEOUT_MS = 120_000;
const NATIVE_STATIC_LAYOUT_SOURCE_PROXY_REFERENCE_PIXEL_RATE = 1920 * 1080 * 30;
const NATIVE_STATIC_LAYOUT_SOURCE_PROXY_1080P30_BITRATE = 24_000_000;
const NATIVE_STATIC_LAYOUT_SOURCE_PROXY_MAX_BITRATE = 80_000_000;
const NATIVE_STATIC_LAYOUT_SOURCE_PROXY_CONTAINERS = new Set([".mp4", ".m4v", ".mov"]);

type ElectronGpuDeviceLike = {
	vendorId?: number | string;
	vendorString?: string;
	deviceString?: string;
};

type ElectronGpuInfoLike = {
	gpuDevice?: ElectronGpuDeviceLike[];
};

export const NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION = 1;

export type NativeVideoExportFramePortMessage =
	| {
			type: "hello";
			protocol: typeof NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION;
			sessionId: string;
			capabilityProbe: ArrayBuffer;
	  }
	| {
			type: "frame";
			protocol: typeof NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION;
			sessionId: string;
			requestId: number;
			sequence: number;
			frame: ArrayBuffer;
	  };

export type NativeVideoExportFramePortResponse =
	| {
			type: "ready";
			protocol: typeof NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION;
			sessionId: string;
			transferable: true;
			transferProbe: ArrayBuffer;
	  }
	| {
			type: "ack";
			protocol: typeof NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION;
			sessionId: string;
			requestId: number;
			sequence: number;
			success: true;
	  }
	| {
			type: "error";
			protocol: typeof NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION;
			sessionId: string;
			requestId?: number;
			sequence?: number;
			success: false;
			error: string;
			fallbackAvailable: boolean;
	  };

export type NativeVideoExportSession = {
	ffmpegProcess: ChildProcessByStdio<Writable, null, Readable>;
	outputPath: string;
	inputByteSize: number;
	inputMode: "rawvideo" | "h264-stream";
	maxQueuedWriteBytes: number;
	stderrOutput: string;
	encoderName: string;
	processError: Error | null;
	stdinError: Error | null;
	terminating: boolean;
	writeSequence: Promise<void>;
	completionPromise: Promise<void>;
	sender: WebContents | null;
	pendingWriteRequestIds: Set<number>;
	framePort: MessagePortMain | null;
	framePortReady: boolean;
	nextFrameSequence: number;
	pendingFrameRequests: Map<number, { sequence: number }>;
	completedFrameRequestIds: Set<number>;
};

export const nativeVideoExportSessions = new Map<string, NativeVideoExportSession>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
	return value instanceof ArrayBuffer;
}

function isValidRequestNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sendNativeVideoExportFramePortMessage(
	port: MessagePortMain,
	message: NativeVideoExportFramePortResponse,
	transfer?: ArrayBuffer,
) {
	try {
		if (transfer) {
			// Electron 43 types MessagePortMain's transfer list as MessagePortMain[],
			// although Chromium's structured clone implementation also accepts
			// ArrayBuffers. Verify detachment at runtime instead of assuming zero-copy.
			port.postMessage(message, [transfer as unknown as MessagePortMain]);
			return transfer.byteLength === 0;
		}
		port.postMessage(message);
		return true;
	} catch {
		return false;
	}
}

export function sendNativeVideoExportFramePortError(
	port: MessagePortMain,
	sessionId: string,
	error: string,
	options: {
		requestId?: number;
		sequence?: number;
		fallbackAvailable: boolean;
	},
) {
	return sendNativeVideoExportFramePortMessage(port, {
		type: "error",
		protocol: NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION,
		sessionId,
		success: false,
		error,
		...options,
	});
}

function clearNativeVideoExportFramePort(session: NativeVideoExportSession) {
	const port = session.framePort;
	session.framePort = null;
	session.framePortReady = false;
	session.pendingFrameRequests.clear();
	if (port) {
		try {
			port.close();
		} catch {
			// The renderer may already have closed the port.
		}
	}
}

export function flushNativeVideoExportFramePortPendingRequests(
	sessionId: string,
	session: NativeVideoExportSession,
	error: string,
) {
	const port = session.framePort;
	if (port && session.framePortReady) {
		for (const [requestId, pendingRequest] of session.pendingFrameRequests) {
			sendNativeVideoExportFramePortError(port, sessionId, error, {
				requestId,
				sequence: pendingRequest.sequence,
				fallbackAvailable: false,
			});
		}
	}
	session.pendingFrameRequests.clear();
}

function handleNativeVideoExportFramePortMessage(
	sessionId: string,
	session: NativeVideoExportSession,
	port: MessagePortMain,
	value: unknown,
) {
	if (!isRecord(value)) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Invalid native export frame message",
			{
				fallbackAvailable: false,
			},
		);
		return;
	}

	if (value.protocol !== NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Unsupported native export frame protocol",
			{
				fallbackAvailable: true,
			},
		);
		return;
	}
	if (value.sessionId !== sessionId) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Native export frame session mismatch",
			{
				fallbackAvailable: false,
			},
		);
		return;
	}

	if (value.type === "hello") {
		if (session.framePortReady) {
			sendNativeVideoExportFramePortError(
				port,
				sessionId,
				"Native export frame channel handshake was already completed",
				{ fallbackAvailable: false },
			);
			return;
		}
		if (!isArrayBuffer(value.capabilityProbe) || value.capabilityProbe.byteLength !== 1) {
			sendNativeVideoExportFramePortError(
				port,
				sessionId,
				"Native export frame channel transferable probe was invalid",
				{ fallbackAvailable: true },
			);
			clearNativeVideoExportFramePort(session);
			return;
		}

		if (
			!sendNativeVideoExportFramePortMessage(
				port,
				{
					type: "ready",
					protocol: NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION,
					sessionId,
					transferable: true,
					transferProbe: value.capabilityProbe,
				},
				value.capabilityProbe,
			)
		) {
			clearNativeVideoExportFramePort(session);
			return;
		}
		session.framePortReady = true;
		return;
	}

	if (value.type !== "frame") {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Unknown native export frame message",
			{
				fallbackAvailable: false,
			},
		);
		return;
	}
	if (!session.framePortReady) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Native export frame channel handshake is incomplete",
			{ fallbackAvailable: true },
		);
		return;
	}

	const requestId = value.requestId;
	const sequence = value.sequence;
	if (!isValidRequestNumber(requestId) || !isValidRequestNumber(sequence)) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Native export frame request and sequence must be non-negative safe integers",
			{ fallbackAvailable: false },
		);
		return;
	}
	if (
		session.completedFrameRequestIds.has(requestId) ||
		session.pendingFrameRequests.has(requestId)
	) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Duplicate native export frame request",
			{
				requestId,
				sequence,
				fallbackAvailable: false,
			},
		);
		return;
	}
	if (sequence !== session.nextFrameSequence) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			sequence < session.nextFrameSequence
				? "Duplicate native export frame sequence"
				: `Out-of-order native export frame sequence; expected ${session.nextFrameSequence}`,
			{ requestId, sequence, fallbackAvailable: false },
		);
		return;
	}
	if (!isArrayBuffer(value.frame) || value.frame.byteLength === 0) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Native export frame payload must be a non-empty ArrayBuffer",
			{ requestId, sequence, fallbackAvailable: false },
		);
		return;
	}
	if (session.inputMode !== "h264-stream" && value.frame.byteLength !== session.inputByteSize) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			`Native video export expected ${session.inputByteSize} bytes per frame but received ${value.frame.byteLength}`,
			{ requestId, sequence, fallbackAvailable: false },
		);
		return;
	}
	if (session.terminating) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Native video export session was cancelled",
			{ requestId, sequence, fallbackAvailable: false },
		);
		return;
	}

	session.pendingFrameRequests.set(requestId, { sequence });
	session.completedFrameRequestIds.add(requestId);
	session.nextFrameSequence += 1;
	void enqueueNativeVideoExportFrameWrite(session, value.frame)
		.then(() => {
			const pendingRequest = session.pendingFrameRequests.get(requestId);
			if (!pendingRequest) {
				return;
			}
			session.pendingFrameRequests.delete(requestId);
			if (
				!sendNativeVideoExportFramePortMessage(port, {
					type: "ack",
					protocol: NATIVE_VIDEO_EXPORT_FRAME_PROTOCOL_VERSION,
					sessionId,
					requestId,
					sequence: pendingRequest.sequence,
					success: true,
				})
			) {
				clearNativeVideoExportFramePort(session);
			}
		})
		.catch((error: unknown) => {
			const nativeError = error instanceof Error ? error : new Error(String(error));
			session.stdinError = nativeError;
			const pendingRequest = session.pendingFrameRequests.get(requestId);
			if (!pendingRequest) {
				return;
			}
			session.pendingFrameRequests.delete(requestId);
			if (
				!sendNativeVideoExportFramePortError(port, sessionId, nativeError.message, {
					requestId,
					sequence: pendingRequest.sequence,
					fallbackAvailable: false,
				})
			) {
				clearNativeVideoExportFramePort(session);
			}
		});
}

export function attachNativeVideoExportFramePort(
	sessionId: string,
	session: NativeVideoExportSession,
	port: MessagePortMain,
	sender: WebContents,
) {
	if (session.terminating) {
		sendNativeVideoExportFramePortError(
			port,
			sessionId,
			"Native video export session was cancelled",
			{
				fallbackAvailable: false,
			},
		);
		port.close();
		return false;
	}

	if (session.framePort) {
		flushNativeVideoExportFramePortPendingRequests(
			sessionId,
			session,
			"Native export frame channel was replaced",
		);
		clearNativeVideoExportFramePort(session);
	}

	session.sender = sender;
	session.framePort = port;
	session.framePortReady = false;
	session.nextFrameSequence = 0;
	session.pendingFrameRequests.clear();
	session.completedFrameRequestIds.clear();
	port.on("message", (event) => {
		if (session.framePort !== port) {
			return;
		}
		handleNativeVideoExportFramePortMessage(sessionId, session, port, event.data);
	});
	port.on("close", () => {
		if (session.framePort !== port) {
			return;
		}
		session.framePort = null;
		session.framePortReady = false;
		session.pendingFrameRequests.clear();
	});
	sender.once("destroyed", () => {
		if (session.framePort !== port) {
			return;
		}
		flushNativeVideoExportFramePortPendingRequests(
			sessionId,
			session,
			"Native export renderer was reloaded before frame acknowledgements settled",
		);
		clearNativeVideoExportFramePort(session);
	});
	port.start();
	return true;
}

export function closeNativeVideoExportFramePort(
	sessionId: string,
	session: NativeVideoExportSession,
	error: string,
) {
	flushNativeVideoExportFramePortPendingRequests(sessionId, session, error);
	clearNativeVideoExportFramePort(session);
}

export interface NativeStaticLayoutTimelineSegment {
	sourceStartMs: number;
	sourceEndMs: number;
	outputStartMs: number;
	outputEndMs: number;
	speed: number;
}

export interface NativeStaticLayoutExportOptions {
	sessionId?: string;
	inputPath: string;
	/** High-level output contract; encoder names never cross this boundary. */
	videoCodec?: ExportVideoCodec;
	encoderPreference?: ExportEncoderPreference;
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	encodingMode: NativeExportEncodingMode;
	durationSec: number;
	overlayLayers?: NativeStaticLayoutOverlayLayer[];
	contentWidth: number;
	contentHeight: number;
	offsetX: number;
	offsetY: number;
	sourceCropX?: number;
	sourceCropY?: number;
	sourceCropWidth?: number;
	sourceCropHeight?: number;
	backgroundColor: string;
	backgroundImagePath?: string | null;
	backgroundBlurPx?: number;
	borderRadius?: number;
	shadowIntensity?: number;
	webcamInputPath?: string | null;
	webcamLeft?: number;
	webcamTop?: number;
	webcamSize?: number;
	webcamRadius?: number;
	webcamShadowIntensity?: number;
	webcamMirror?: boolean;
	webcamTimeOffsetMs?: number;
	cursorTelemetry?: Array<{
		timeMs: number;
		cx: number;
		cy: number;
		cursorTypeIndex?: number;
		bounceScale?: number;
		visible?: boolean;
	}>;
	cursorTelemetryPath?: string | null;
	cursorSize?: number;
	cursorAtlasPngDataUrl?: string | null;
	cursorAtlasPath?: string | null;
	cursorAtlasEntries?: Array<{
		index: number;
		x: number;
		y: number;
		width: number;
		height: number;
		anchorX: number;
		anchorY: number;
		aspectRatio: number;
	}>;
	cursorAtlasMetadataPath?: string | null;
	zoomTelemetry?: Array<{
		timeMs: number;
		scale: number;
		x: number;
		y: number;
		blurStrength?: number;
		blurCenterX?: number;
		blurCenterY?: number;
	}>;
	zoomTelemetryPath?: string | null;
	/** Resolved temporal zoom motion blur plan (temporalMotionBlur.ts config). */
	temporalBlur?: {
		sampleCount: number;
		shutterFraction: number;
		weightCurvePower: number;
	} | null;
	/** JSON manifest describing renderer-prepared RGBA overlay sidecars. */
	overlayManifestPath?: string | null;
	/**
	 * True when the renderer excluded cursor pixels from the overlay sidecars
	 * and the native cursor atlas owns them. The CUDA compositor must draw the
	 * atlas on top of the sidecars; stripping the cursor assets would drop the
	 * cursor, and passing them while the sidecar still baked them would
	 * double-render. Absent/false keeps the baked-sidecar contract.
	 */
	cursorAtlasOwned?: boolean;
	timelineSegments?: NativeStaticLayoutTimelineSegment[];
	timelineMapPath?: string | null;
	chunkDurationSec?: number;
	experimentalWindowsGpuCompositor?: boolean;
	experimentalNvidiaCudaExport?: boolean;
	audioOptions?: NativeVideoExportFinishOptions;
	nvidiaCudaForceVideoOnly?: boolean;
}

export interface NativeStaticLayoutExportProgress {
	sessionId?: string;
	backend?: NativeStaticLayoutBackend;
	stage?: "preparing" | "finalizing";
	elapsedMs?: number;
	averageFps?: number;
	instantFps?: number;
	/**
	 * End-to-end estimate (frames / wall-clock since process spawn). This
	 * includes preparation time, so it is NOT a native encode speed; it must
	 * never be presented as measured encode FPS.
	 */
	estimatedFps?: number;
	/** Where the reported FPS values came from. */
	fpsSource?: "native" | "estimated";
	intervalMs?: number;
	intervalFrames?: number;
	intervalDecodeWallMs?: number;
	intervalEncodeMs?: number;
	intervalPipelineWaitMs?: number;
	intervalCompositeMs?: number;
	intervalNvencMs?: number;
	intervalPacketWriteMs?: number;
	intervalWebcamDecodeMs?: number;
	intervalWebcamCopyMs?: number;
	intervalRoiCompositeFrames?: number;
	intervalMonolithicCompositeFrames?: number;
	intervalCopyCompositeFrames?: number;
	intervalZoomBlurFrames?: number;
	intervalTemporalBlurStationaryFrames?: number;
	intervalTemporalBgCacheBuilds?: number;
	intervalTemporalBgCacheHits?: number;
	intervalOverlayStaticRegionBlends?: number;
	currentFrame: number;
	totalFrames: number;
	percentage: number;
}

type NativeVideoAudioMuxProgress = {
	ratio: number;
	processedSec?: number;
	totalSec?: number;
};

type NativeVideoAudioMuxArgsOptions = {
	progressPipe?: 1 | 2;
};

export interface WindowsGpuExportSummary {
	success?: boolean;
	width?: number;
	height?: number;
	fps?: number;
	seconds?: number;
	mediaMs?: number;
	frames?: number;
	gpuDecodeSurface?: boolean;
	webcamOverlay?: boolean;
	cursorOverlay?: boolean;
	cursorAtlas?: boolean;
	zoomOverlay?: boolean;
	surfacePoolSize?: number;
	adapterIndex?: number;
	adapterVendorId?: number;
	adapterDeviceId?: number;
	adapterDedicatedVideoMemoryMB?: number;
	encoderBackend?: string;
	encoderTuningApplied?: boolean;
	nvencOutputBytes?: number;
	initializeMs?: number;
	initCoInitializeMs?: number;
	initMfStartupMs?: number;
	initD3DDeviceMs?: number;
	initSourceReaderMs?: number;
	initWebcamReaderMs?: number;
	initVideoProcessorMs?: number;
	initTexturesMs?: number;
	initShaderPipelineMs?: number;
	initSinkWriterMs?: number;
	totalMs?: number;
	readMs?: number;
	clearMs?: number;
	videoProcessMs?: number;
	writeSampleMs?: number;
	finalizeMs?: number;
	realtimeMultiplier?: number;
}

export interface NvidiaCudaNativeSummary {
	success?: boolean;
	selectionStage?: string;
	sourceTimestampMode?: string;
	timelineMode?: string;
	frames?: number;
	totalMs?: number;
	fps?: number;
	measuredFps?: number;
	mappedDisplayFrames?: number;
	selectedDisplayFrames?: number;
	skippedDisplayFrames?: number;
	roiCompositeFrames?: number;
	monolithicCompositeFrames?: number;
	copyCompositeFrames?: number;
	cursorAtlas?: boolean;
	webcamOverlay?: boolean;
	zoomOverlay?: boolean;
	zoomSamples?: number;
	overlayLayers?: number;
	overlayBlendFrames?: number;
	/** Renderer-resolved temporal zoom motion blur sample count (config, not
	 * measured: the helper does not yet echo it in its summary). */
	temporalBlurSampleCount?: number;
	/** Temporal blur output frames (additive compositor counter). */
	temporalBlurFrames?: number;
	/** Total temporal blur sample composites across all output frames. */
	temporalBlurSamplesTotal?: number;
	/** Temporal blur frames that reused the precomposed invariant background. */
	temporalBlurBgPrecomposedFrames?: number;
	/** Overlay sidecar frames read from disk (additive). */
	overlayFileLoads?: number;
	/** Overlay sidecar frames served from the resident ring slot (additive). */
	overlayCacheHits?: number;
	/** Overlay blends confined to static alpha bounds (additive). */
	overlayStaticRegionBlends?: number;
	/** Overlay sidecar width in pixels (renderer-derived, additive). */
	overlayWidth?: number;
	/** Overlay sidecar height in pixels (renderer-derived, additive). */
	overlayHeight?: number;
	/** Overlay sidecar logical frame count (output duration frames). */
	overlayFrameCount?: number;
	/** Overlay sidecar physical frame count (effectiveFrameCount when deduped). */
	overlayPhysicalFrames?: number;
	/** Overlay sidecar stored frame count after identical-suffix dedup. */
	overlayEffectiveFrames?: number;
	/** Temporal blur frames composited by the stationary fused kernel. */
	temporalBlurStationaryFrames?: number;
	/** Temporal blur invariant-background cache builds (additive). */
	temporalBgCacheBuilds?: number;
	/** Temporal blur invariant-background cache hits (additive). */
	temporalBgCacheHits?: number;
	/**
	 * Overlay host-read wall time in ms. The helper currently reports only the
	 * combined overlayUploadMs; these fields stay absent until main.cu separates
	 * host reads from H2D enqueues.
	 */
	overlayHostReadMs?: number;
	overlayH2DEnqueueMs?: number;
	/** Stage wall/GPU timings in ms, additive over the encode run. */
	compositeMs?: number;
	compositeGpuMs?: number;
	zoomBlurGpuMs?: number;
	overlayBlendGpuMs?: number;
	overlayUploadMs?: number;
	nvencMs?: number;
	packetWriteMs?: number;
	decodeMs?: number;
	decodeWallMs?: number;
	encodeMs?: number;
	flushMs?: number;
	realtimeMultiplier?: number;
	outputBytes?: number;
}

export interface NvidiaCudaExportSummary {
	success?: boolean;
	inputPath?: string;
	outputCodec?: ExportVideoCodec;
	outputPath?: string;
	fps?: number;
	bitrateMbps?: number;
	durationSec?: number;
	targetFrames?: number;
	sourcePtsFrames?: number;
	sourcePtsSource?: string;
	timingsMs?: {
		demux?: number;
		backgroundConvert?: number;
		cursorAtlas?: number;
		webcamConvert?: number;
		webcamDemux?: number;
		sourcePtsProbe?: number;
		nativeEncode?: number;
		mux?: number;
		endToEnd?: number;
	};
	nativeSummary?: NvidiaCudaNativeSummary;
	nativeProcessPriorityBoosted?: boolean;
	appRuntimeGuard?: {
		powerGuardStarted?: boolean;
		wrapperProcessPriorityBoosted?: boolean;
		nativeProcessPriorityBoosted?: boolean;
	};
	gpuSamples?: unknown[];
	gpuSummary?: unknown;
	outputVideo?: unknown;
	outputAudio?: unknown;
}

export interface NativeVideoMetadataProbe {
	width: number;
	height: number;
	duration: number;
	mediaStartTime?: number;
	streamStartTime?: number;
	streamDuration?: number;
	frameRate: number;
	codec: string;
	hasAudio: boolean;
	audioCodec?: string;
	audioSampleRate?: number;
}

export interface NativeVideoStreamStatsProbe {
	durationSec: number | null;
	frameCount: number | null;
	frameRate: number | null;
}

export interface NativeStaticLayoutChunkMetric {
	index: number;
	startSec: number;
	durationSec: number;
	backend: NativeStaticLayoutBackend;
	elapsedMs: number;
	outputBytes: number;
	fallbackReason?: string;
	windowsGpuSummary?: WindowsGpuExportSummary;
	nvidiaCudaSummary?: NvidiaCudaExportSummary;
}

export interface NativeStaticLayoutExportMetrics extends NativeVideoAudioMuxMetrics {
	chunkCount: number;
	chunkDurationSec: number;
	chunkExecMs: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount: number;
	videoOnlyBytes?: number;
	chunks: NativeStaticLayoutChunkMetric[];
}

export interface NativeStaticLayoutExportResult {
	outputPath: string;
	metrics: NativeStaticLayoutExportMetrics;
	videoCodec: ExportVideoCodec;
	encoderPreference: ExportEncoderPreference;
	encoderName: string;
	route: NativeStaticLayoutBackend;
}

export interface NativeStaticLayoutExportSession {
	terminating: boolean;
	currentProcess: ReturnType<typeof spawn> | null;
}

export function cleanupNativeVideoExportSessions() {
	for (const [sessionId, session] of nativeVideoExportSessions) {
		session.terminating = true;
		closeNativeVideoExportFramePort(
			sessionId,
			session,
			"Native video export sessions were cleaned up",
		);
		try {
			if (!session.ffmpegProcess.stdin.destroyed) {
				session.ffmpegProcess.stdin.destroy();
			}
		} catch {
			/* stream may already be closed */
		}
		try {
			session.ffmpegProcess.kill("SIGKILL");
		} catch {
			/* process may already be exited */
		}
		nativeVideoExportSessions.delete(sessionId);
	}

	for (const [sessionId, session] of nativeStaticLayoutExportSessions) {
		session.terminating = true;
		try {
			session.currentProcess?.kill("SIGKILL");
		} catch {
			/* process may already be exited */
		}
		nativeStaticLayoutExportSessions.delete(sessionId);
	}
}

export function parseWindowsGpuExportSummary(stdout: string): WindowsGpuExportSummary | null {
	const summaryLine = stdout
		.trim()
		.split(/\r?\n/)
		.reverse()
		.find((line) => line.trim().startsWith("{"));
	if (!summaryLine) {
		return null;
	}

	try {
		const parsed = JSON.parse(summaryLine) as WindowsGpuExportSummary;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

export function parseNvidiaCudaExportSummary(stdout: string): NvidiaCudaExportSummary | null {
	const trimmed = stdout.trim();
	const startIndex = trimmed.indexOf("{");
	const endIndex = trimmed.lastIndexOf("}");
	if (startIndex === -1 || endIndex <= startIndex) {
		return null;
	}

	try {
		const parsed = JSON.parse(
			trimmed.slice(startIndex, endIndex + 1),
		) as NvidiaCudaExportSummary;
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch {
		return null;
	}
}

const NVIDIA_CUDA_NATIVE_SUMMARY_METRIC_FIELDS = [
	"temporalBlurSampleCount",
	"temporalBlurSamplesTotal",
	"temporalBlurBgPrecomposedFrames",
	"temporalBlurFrames",
	"temporalBlurStationaryFrames",
	"temporalBgCacheBuilds",
	"temporalBgCacheHits",
	"compositeGpuMs",
	"zoomBlurGpuMs",
	"overlayBlendGpuMs",
	"overlayUploadMs",
	"overlayFileLoads",
	"overlayCacheHits",
	"overlayStaticRegionBlends",
	"overlayBlendFrames",
	"overlayWidth",
	"overlayHeight",
	"overlayFrameCount",
	"overlayPhysicalFrames",
	"overlayEffectiveFrames",
	"overlayHostReadMs",
	"overlayH2DEnqueueMs",
	"nvencMs",
	"packetWriteMs",
	"totalMs",
	"encodeMs",
	"decodeMs",
	"decodeWallMs",
	"compositeMs",
	"flushMs",
	"realtimeMultiplier",
	"outputBytes",
] as const satisfies ReadonlyArray<keyof NvidiaCudaNativeSummary>;

export type NvidiaCudaNativeSummaryMetricField =
	(typeof NVIDIA_CUDA_NATIVE_SUMMARY_METRIC_FIELDS)[number];

/**
 * Maps the additive native compositor counters into a flat metric object for
 * the completion log. Only fields the helper actually reported as finite
 * numbers are included, so absent counters never appear as undefined noise and
 * non-finite payloads are never surfaced as measured values. The values are
 * cumulative over the whole helper run (decode/compose/overlay/NVENC stages),
 * never interval deltas.
 */
export function resolveNvidiaCudaNativeSummaryMetrics(
	nativeSummary: NvidiaCudaNativeSummary | undefined,
): Partial<Record<NvidiaCudaNativeSummaryMetricField, number>> {
	const metrics: Partial<Record<NvidiaCudaNativeSummaryMetricField, number>> = {};
	if (!nativeSummary) {
		return metrics;
	}

	for (const field of NVIDIA_CUDA_NATIVE_SUMMARY_METRIC_FIELDS) {
		const value = nativeSummary[field];
		if (typeof value === "number" && Number.isFinite(value)) {
			metrics[field] = value;
		}
	}
	return metrics;
}

export type NvidiaCudaOverlaySidecarSummaryMetric = Pick<
	NvidiaCudaNativeSummary,
	| "overlayWidth"
	| "overlayHeight"
	| "overlayFrameCount"
	| "overlayPhysicalFrames"
	| "overlayEffectiveFrames"
>;

/**
 * Derives the overlay sidecar dimensions and physical/effective frame counts
 * from the renderer-prepared overlay layers for CUDA summary surfacing. All
 * fields are additive and only present when overlay layers exist. The physical
 * count is the sidecar's stored frame count (effectiveFrameCount after
 * identical-suffix dedup); the logical count is the output duration.
 */
export function resolveNvidiaCudaOverlaySidecarSummaryMetrics(
	options: NativeStaticLayoutExportOptions,
): Partial<NvidiaCudaOverlaySidecarSummaryMetric> {
	const layer = options.overlayLayers?.[0];
	if (
		!layer ||
		!Number.isFinite(layer.width) ||
		!Number.isFinite(layer.height) ||
		!Number.isFinite(layer.frameCount)
	) {
		return {};
	}

	const metrics: Partial<NvidiaCudaOverlaySidecarSummaryMetric> = {
		overlayWidth: Math.max(1, Math.round(layer.width)),
		overlayHeight: Math.max(1, Math.round(layer.height)),
		overlayFrameCount: Math.max(1, Math.round(layer.frameCount)),
		overlayPhysicalFrames: Math.max(
			1,
			Math.round(layer.effectiveFrameCount ?? layer.frameCount),
		),
	};
	if (layer.effectiveFrameCount !== undefined) {
		metrics.overlayEffectiveFrames = Math.max(1, Math.round(layer.effectiveFrameCount));
	}
	return metrics;
}

/**
 * Resolves the measured native encode FPS reported by the helper: the flush
 * span measuredFps is authoritative, with the encode-loop fps as the backward-
 * compatible fallback. Never derives FPS from wall-clock estimates.
 */
export function resolveNvidiaCudaNativeFps(
	summary: NvidiaCudaExportSummary | undefined,
): number | undefined {
	const nativeSummary = summary?.nativeSummary;
	const measuredFps = nativeSummary?.measuredFps;
	if (typeof measuredFps === "number" && Number.isFinite(measuredFps) && measuredFps > 0) {
		return measuredFps;
	}
	const fallbackFps = nativeSummary?.fps;
	if (typeof fallbackFps === "number" && Number.isFinite(fallbackFps) && fallbackFps > 0) {
		return fallbackFps;
	}
	return undefined;
}

/**
 * Verifies the additive compositor counters against each other so the
 * completion diagnostics can prove (rather than assume) that the reported
 * stage timings are sane. Returns human-readable issue strings; an empty array
 * means the metrics are internally consistent. These are diagnostics only and
 * never gate the export result.
 */
export function validateNvidiaCudaStageMetricInvariants(
	summary: NvidiaCudaExportSummary,
): string[] {
	const issues: string[] = [];
	const native = summary.nativeSummary;
	if (!native) {
		return issues;
	}

	const totalMs = native.totalMs;
	if (typeof totalMs === "number" && Number.isFinite(totalMs) && totalMs >= 0) {
		const stageFields: ReadonlyArray<
			readonly [NvidiaCudaNativeSummaryMetricField, number | undefined]
		> = [
			["compositeGpuMs", native.compositeGpuMs],
			["overlayBlendGpuMs", native.overlayBlendGpuMs],
			["overlayUploadMs", native.overlayUploadMs],
			["nvencMs", native.nvencMs],
			["packetWriteMs", native.packetWriteMs],
			["compositeMs", native.compositeMs],
			["zoomBlurGpuMs", native.zoomBlurGpuMs],
			["encodeMs", native.encodeMs],
			["decodeWallMs", native.decodeWallMs],
		];
		for (const [field, value] of stageFields) {
			if (typeof value === "number" && Number.isFinite(value) && value > totalMs + 0.5) {
				issues.push(`${field} ${value}ms exceeds helper wall time ${totalMs}ms`);
			}
		}
	}

	const temporalBlurFrames = native.temporalBlurFrames;
	if (typeof temporalBlurFrames === "number" && Number.isFinite(temporalBlurFrames)) {
		const samplesTotal = native.temporalBlurSamplesTotal;
		if (
			typeof samplesTotal === "number" &&
			Number.isFinite(samplesTotal) &&
			samplesTotal < temporalBlurFrames
		) {
			issues.push(
				`temporalBlurSamplesTotal ${samplesTotal} below temporalBlurFrames ${temporalBlurFrames}`,
			);
		}
		const bgPrecomposedFrames = native.temporalBlurBgPrecomposedFrames;
		if (
			typeof bgPrecomposedFrames === "number" &&
			Number.isFinite(bgPrecomposedFrames) &&
			bgPrecomposedFrames > temporalBlurFrames
		) {
			issues.push(
				`temporalBlurBgPrecomposedFrames ${bgPrecomposedFrames} exceeds temporalBlurFrames ${temporalBlurFrames}`,
			);
		}
	}

	const stationaryFrames = native.temporalBlurStationaryFrames;
	if (
		typeof stationaryFrames === "number" &&
		Number.isFinite(stationaryFrames) &&
		typeof temporalBlurFrames === "number" &&
		Number.isFinite(temporalBlurFrames) &&
		stationaryFrames > temporalBlurFrames
	) {
		issues.push(
			`temporalBlurStationaryFrames ${stationaryFrames} exceeds temporalBlurFrames ${temporalBlurFrames}`,
		);
	}
	const bgCacheBuilds = native.temporalBgCacheBuilds;
	const bgCacheHits = native.temporalBgCacheHits;
	if (
		typeof bgCacheBuilds === "number" &&
		Number.isFinite(bgCacheBuilds) &&
		typeof bgCacheHits === "number" &&
		Number.isFinite(bgCacheHits)
	) {
		const bgCacheTotal = bgCacheBuilds + bgCacheHits;
		const bgPrecomposedFrames = native.temporalBlurBgPrecomposedFrames;
		if (
			typeof bgPrecomposedFrames === "number" &&
			Number.isFinite(bgPrecomposedFrames) &&
			bgCacheTotal > bgPrecomposedFrames
		) {
			issues.push(
				`temporalBgCacheBuilds ${bgCacheBuilds} + temporalBgCacheHits ${bgCacheHits} exceed temporalBlurBgPrecomposedFrames ${bgPrecomposedFrames}`,
			);
		} else if (
			typeof temporalBlurFrames === "number" &&
			Number.isFinite(temporalBlurFrames) &&
			bgCacheTotal > temporalBlurFrames
		) {
			issues.push(
				`temporalBgCacheBuilds ${bgCacheBuilds} + temporalBgCacheHits ${bgCacheHits} exceed temporalBlurFrames ${temporalBlurFrames}`,
			);
		}
	}

	const overlayBlendFrames = native.overlayBlendFrames;
	const overlayStaticRegionBlends = native.overlayStaticRegionBlends;
	if (
		typeof overlayStaticRegionBlends === "number" &&
		Number.isFinite(overlayStaticRegionBlends) &&
		typeof overlayBlendFrames === "number" &&
		Number.isFinite(overlayBlendFrames) &&
		overlayStaticRegionBlends > overlayBlendFrames
	) {
		issues.push(
			`overlayStaticRegionBlends ${overlayStaticRegionBlends} exceeds overlayBlendFrames ${overlayBlendFrames}`,
		);
	}

	const overlayFrameCount = native.overlayFrameCount;
	if (typeof overlayFrameCount === "number" && Number.isFinite(overlayFrameCount)) {
		const overlayPhysicalFrames = native.overlayPhysicalFrames;
		if (
			typeof overlayPhysicalFrames === "number" &&
			Number.isFinite(overlayPhysicalFrames) &&
			overlayPhysicalFrames > overlayFrameCount
		) {
			issues.push(
				`overlayPhysicalFrames ${overlayPhysicalFrames} exceeds overlayFrameCount ${overlayFrameCount}`,
			);
		}
		const overlayEffectiveFrames = native.overlayEffectiveFrames;
		if (
			typeof overlayEffectiveFrames === "number" &&
			Number.isFinite(overlayEffectiveFrames) &&
			(overlayEffectiveFrames < 1 || overlayEffectiveFrames > overlayFrameCount)
		) {
			issues.push(
				`overlayEffectiveFrames ${overlayEffectiveFrames} out of range for overlayFrameCount ${overlayFrameCount}`,
			);
		}
	}

	return issues;
}

function getFiniteNumber(value: unknown) {
	const numberValue = typeof value === "string" ? Number(value) : value;
	return typeof numberValue === "number" && Number.isFinite(numberValue) ? numberValue : null;
}

function getNvidiaCudaOutputStreamNumber(stream: unknown, property: string) {
	if (!stream || typeof stream !== "object") {
		return null;
	}

	return getFiniteNumber((stream as Record<string, unknown>)[property]);
}

export function validateNvidiaCudaExportSummary(
	summary: NvidiaCudaExportSummary,
	expected: {
		durationSec: number;
		targetFrames: number;
		requiresTimelineSync?: boolean;
		videoCodec?: ExportVideoCodec;
	},
) {
	const issues: string[] = [];
	const expectedFrames = Math.max(1, Math.round(expected.targetFrames));
	const minimumFrames = Math.max(1, Math.floor(expectedFrames * 0.95));
	const expectedDurationSec = Math.max(0, expected.durationSec);
	const durationToleranceSec = Math.min(2, Math.max(0.5, expectedDurationSec * 0.02));
	const nativeFrames = getFiniteNumber(summary.nativeSummary?.frames);
	const outputVideoFrames = getNvidiaCudaOutputStreamNumber(summary.outputVideo, "nb_frames");
	const outputVideoDurationSec = getNvidiaCudaOutputStreamNumber(summary.outputVideo, "duration");
	const outputAudioDurationSec = getNvidiaCudaOutputStreamNumber(summary.outputAudio, "duration");

	if (expected.videoCodec && summary.outputCodec !== expected.videoCodec) {
		issues.push(
			`CUDA output codec ${summary.outputCodec ?? "unknown"} does not match expected ${expected.videoCodec}`,
		);
	}
	if (!summary.outputVideo) {
		issues.push("missing output video probe");
	}
	if (expected.requiresTimelineSync && !isNvidiaCudaTimestampAlignedSummary(summary)) {
		issues.push("CUDA timeline mode is not timestamp-aligned for audio export");
	}
	if (expected.requiresTimelineSync) {
		if (!summary.outputAudio) {
			issues.push("missing output audio stream");
		} else if (outputAudioDurationSec === null) {
			issues.push("missing output audio duration");
		} else if (outputAudioDurationSec <= 0) {
			issues.push("output audio duration is not positive");
		}
	}
	if (nativeFrames === null) {
		issues.push("missing native frame count");
	} else if (nativeFrames < minimumFrames) {
		issues.push(`native frames ${nativeFrames} below expected minimum ${minimumFrames}`);
	}
	if (outputVideoFrames !== null && outputVideoFrames < minimumFrames) {
		issues.push(
			`output video frames ${outputVideoFrames} below expected minimum ${minimumFrames}`,
		);
	}
	if (
		outputVideoDurationSec !== null &&
		Math.abs(outputVideoDurationSec - expectedDurationSec) > durationToleranceSec
	) {
		issues.push(
			`output video duration ${outputVideoDurationSec.toFixed(
				3,
			)}s differs from expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}
	if (
		outputAudioDurationSec !== null &&
		outputAudioDurationSec > 0 &&
		Math.abs(outputAudioDurationSec - expectedDurationSec) > durationToleranceSec
	) {
		issues.push(
			`output audio duration ${outputAudioDurationSec.toFixed(
				3,
			)}s differs from expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}

	return issues;
}

export function validateWindowsGpuExportSummary(
	summary: WindowsGpuExportSummary,
	expected: {
		durationSec: number;
		targetFrames: number;
	},
) {
	const issues: string[] = [];
	const expectedFrames = Math.max(1, Math.round(expected.targetFrames));
	const minimumFrames = Math.max(1, Math.floor(expectedFrames * 0.95));
	const expectedDurationSec = Math.max(0, expected.durationSec);
	const durationToleranceSec = Math.min(2, Math.max(0.5, expectedDurationSec * 0.02));
	const frames = getFiniteNumber(summary.frames);
	const mediaMs = getFiniteNumber(summary.mediaMs);
	const seconds = getFiniteNumber(summary.seconds) ?? (mediaMs !== null ? mediaMs / 1000 : null);

	if (frames === null) {
		issues.push("missing Windows GPU frame count");
	} else if (frames < minimumFrames) {
		issues.push(`Windows GPU frames ${frames} below expected minimum ${minimumFrames}`);
	}
	if (
		seconds !== null &&
		Number.isFinite(seconds) &&
		Math.abs(seconds - expectedDurationSec) > durationToleranceSec
	) {
		issues.push(
			`Windows GPU duration ${seconds.toFixed(3)}s differs from expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}

	return issues;
}

function parseRationalFrameRate(value: unknown) {
	if (typeof value !== "string") {
		return null;
	}
	const [numeratorRaw, denominatorRaw] = value.split("/");
	const numerator = Number(numeratorRaw);
	const denominator = Number(denominatorRaw);
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		numerator <= 0 ||
		denominator <= 0
	) {
		return null;
	}

	return numerator / denominator;
}

function parseOptionalPositiveNumber(value: unknown) {
	const parsed =
		typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalPositiveInteger(value: unknown) {
	const parsed = parseOptionalPositiveNumber(value);
	return parsed === null ? null : Math.max(0, Math.round(parsed));
}

export function parseNativeVideoStreamStatsProbeOutput(
	output: string,
): NativeVideoStreamStatsProbe | null {
	const parsed = JSON.parse(output) as {
		streams?: Array<{
			duration?: unknown;
			nb_frames?: unknown;
			nb_read_frames?: unknown;
			avg_frame_rate?: unknown;
			r_frame_rate?: unknown;
		}>;
	};
	const stream = parsed.streams?.[0];
	if (!stream) {
		return null;
	}

	return {
		durationSec: parseOptionalPositiveNumber(stream.duration),
		frameCount:
			parseOptionalPositiveInteger(stream.nb_read_frames) ??
			parseOptionalPositiveInteger(stream.nb_frames),
		frameRate:
			parseRationalFrameRate(stream.avg_frame_rate) ??
			parseRationalFrameRate(stream.r_frame_rate),
	};
}

export function validateNativeVideoStreamStats(
	stats: NativeVideoStreamStatsProbe,
	expected: {
		durationSec: number;
		targetFrames: number;
	},
) {
	const issues: string[] = [];
	const expectedFrames = Math.max(1, Math.round(expected.targetFrames));
	const minimumFrames = Math.max(1, Math.floor(expectedFrames * 0.95));
	const expectedDurationSec = Math.max(0, expected.durationSec);
	const durationToleranceSec = Math.min(2, Math.max(0.5, expectedDurationSec * 0.02));

	if (stats.frameCount === null) {
		issues.push("missing video frame count");
	} else if (stats.frameCount < minimumFrames) {
		issues.push(`video frames ${stats.frameCount} below expected minimum ${minimumFrames}`);
	}

	if (stats.durationSec === null) {
		issues.push("missing video stream duration");
	} else if (Math.abs(stats.durationSec - expectedDurationSec) > durationToleranceSec) {
		issues.push(
			`video stream duration ${stats.durationSec.toFixed(
				3,
			)}s differs from expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}

	return issues;
}

function isNvidiaCudaTimestampAlignedSummary(summary: NvidiaCudaExportSummary) {
	const nativeSummary = summary.nativeSummary;
	const timelineFields = [
		nativeSummary?.sourceTimestampMode,
		nativeSummary?.timelineMode,
		nativeSummary?.selectionStage,
	];
	return timelineFields.some((value) => {
		const normalized = String(value ?? "").toLowerCase();
		return normalized.includes("pts") || normalized.includes("timestamp");
	});
}

function shouldPersistNativeExportDiagnostics() {
	const rawValue = process.env.RECORDLY_NATIVE_EXPORT_DIAGNOSTICS?.trim().toLowerCase();
	return rawValue !== "0" && rawValue !== "off" && rawValue !== "false";
}

function shouldPersistNvidiaCudaExportDiagnostics() {
	return (
		shouldPersistNativeExportDiagnostics() ||
		process.env.RECORDLY_NVIDIA_CUDA_EXPORT_DIAGNOSTICS === "1"
	);
}

function getSafeDiagnosticsFileSegment(value: string | undefined) {
	const safe = (value || "session").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 96);
	return safe || "session";
}

function getCliArgValue(args: string[], name: string) {
	const index = args.indexOf(name);
	if (index === -1 || index + 1 >= args.length) {
		return null;
	}
	return args[index + 1] || null;
}

async function persistNvidiaCudaExportDiagnostics(params: {
	args: string[];
	code: number | null;
	elapsedMs: number;
	outputPath: string;
	sessionId?: string;
	signal: NodeJS.Signals | null;
	startedAtIso: string;
	stderr: string;
	stdout: string;
	summary: NvidiaCudaExportSummary | null;
	timedOut: boolean;
}) {
	if (!shouldPersistNvidiaCudaExportDiagnostics()) {
		return;
	}

	const diagnosticsDirectory = path.join(app.getPath("userData"), "native-export-diagnostics");
	const filePrefix = `${Date.now()}-${getSafeDiagnosticsFileSegment(params.sessionId)}`;
	const manifest = {
		backend: "nvidia-cuda-compositor",
		startedAt: params.startedAtIso,
		completedAt: new Date().toISOString(),
		elapsedMs: Number(params.elapsedMs.toFixed(2)),
		sessionId: params.sessionId ?? null,
		outputPath: params.outputPath,
		exitCode: params.code,
		signal: params.signal,
		timedOut: params.timedOut,
		args: params.args,
		summary: params.summary,
	};

	try {
		await fs.mkdir(diagnosticsDirectory, { recursive: true });
		const artifactsDirectory = path.join(diagnosticsDirectory, `${filePrefix}.artifacts`);
		const artifactArgs = [
			"--cursor-json",
			"--cursor-atlas-png",
			"--cursor-atlas-metadata",
			"--zoom-telemetry",
		];
		const artifactCopies = artifactArgs
			.map((argName) => {
				const sourcePath = getCliArgValue(params.args, argName);
				return sourcePath
					? {
							argName,
							sourcePath,
							outputPath: path.join(
								artifactsDirectory,
								`${getSafeDiagnosticsFileSegment(argName.replace(/^--/, ""))}-${path.basename(sourcePath)}`,
							),
						}
					: null;
			})
			.filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact));
		await fs.mkdir(artifactsDirectory, { recursive: true }).catch(() => undefined);
		await Promise.allSettled([
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.manifest.json`),
				`${JSON.stringify(manifest, null, 2)}\n`,
			),
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.stdout.json`),
				params.stdout,
			),
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.stderr.log`),
				params.stderr,
			),
			...artifactCopies.map((artifact) =>
				fs.copyFile(artifact.sourcePath, artifact.outputPath).catch(() => undefined),
			),
		]);
	} catch (error) {
		console.warn(
			"[native-static-layout-export] Failed to persist NVIDIA CUDA diagnostics",
			error,
		);
	}
}

async function persistWindowsGpuExportDiagnostics(params: {
	args: string[];
	code: number | null;
	elapsedMs: number;
	outputPath: string;
	signal: NodeJS.Signals | null;
	startedAtIso: string;
	stderr: string;
	stdout: string;
	summary: WindowsGpuExportSummary | null;
	timedOut: boolean;
}) {
	if (!shouldPersistNativeExportDiagnostics()) {
		return;
	}

	const diagnosticsDirectory = path.join(app.getPath("userData"), "native-export-diagnostics");
	const filePrefix = `${Date.now()}-windows-d3d11-compositor`;
	const manifest = {
		backend: "windows-d3d11-compositor",
		startedAt: params.startedAtIso,
		completedAt: new Date().toISOString(),
		elapsedMs: Number(params.elapsedMs.toFixed(2)),
		outputPath: params.outputPath,
		exitCode: params.code,
		signal: params.signal,
		timedOut: params.timedOut,
		args: params.args,
		summary: params.summary,
	};

	try {
		await fs.mkdir(diagnosticsDirectory, { recursive: true });
		await Promise.allSettled([
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.manifest.json`),
				`${JSON.stringify(manifest, null, 2)}\n`,
			),
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.stdout.log`),
				params.stdout,
			),
			fs.writeFile(
				path.join(diagnosticsDirectory, `${filePrefix}.stderr.log`),
				params.stderr,
			),
		]);
	} catch (error) {
		console.warn(
			"[native-static-layout-export] Failed to persist Windows GPU diagnostics",
			error,
		);
	}
}

export function parseWindowsGpuExportProgressLine(
	line: string,
): NativeStaticLayoutExportProgress | null {
	const trimmed = line.trim();
	const prefix = "PROGRESS ";
	if (!trimmed.startsWith(prefix)) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmed.slice(prefix.length)) as {
			currentFrame?: unknown;
			totalFrames?: unknown;
			percentage?: unknown;
			averageFps?: unknown;
			instantFps?: unknown;
			intervalMs?: unknown;
			intervalFrames?: unknown;
			intervalDecodeWallMs?: unknown;
			intervalEncodeMs?: unknown;
			intervalPipelineWaitMs?: unknown;
			intervalCompositeMs?: unknown;
			intervalNvencMs?: unknown;
			intervalPacketWriteMs?: unknown;
			intervalWebcamDecodeMs?: unknown;
			intervalWebcamCopyMs?: unknown;
			intervalRoiCompositeFrames?: unknown;
			intervalMonolithicCompositeFrames?: unknown;
			intervalCopyCompositeFrames?: unknown;
			intervalZoomBlurFrames?: unknown;
			intervalTemporalBlurStationaryFrames?: unknown;
			intervalTemporalBgCacheBuilds?: unknown;
			intervalTemporalBgCacheHits?: unknown;
			intervalOverlayStaticRegionBlends?: unknown;
			stage?: unknown;
		};
		const currentFrame = Number(parsed.currentFrame);
		const totalFrames = Number(parsed.totalFrames);
		const percentage = Number(parsed.percentage);
		if (
			!Number.isFinite(currentFrame) ||
			!Number.isFinite(totalFrames) ||
			!Number.isFinite(percentage) ||
			totalFrames <= 0
		) {
			return null;
		}

		const progress: NativeStaticLayoutExportProgress = {
			currentFrame: Math.max(0, Math.floor(currentFrame)),
			totalFrames: Math.max(1, Math.floor(totalFrames)),
			percentage: Math.min(100, Math.max(0, percentage)),
		};
		if (parsed.stage === "preparing" || parsed.stage === "finalizing") {
			progress.stage = parsed.stage;
		}
		const optionalNumberFields = [
			"averageFps",
			"instantFps",
			"intervalMs",
			"intervalFrames",
			"intervalDecodeWallMs",
			"intervalEncodeMs",
			"intervalPipelineWaitMs",
			"intervalCompositeMs",
			"intervalNvencMs",
			"intervalPacketWriteMs",
			"intervalWebcamDecodeMs",
			"intervalWebcamCopyMs",
			"intervalRoiCompositeFrames",
			"intervalMonolithicCompositeFrames",
			"intervalCopyCompositeFrames",
			"intervalZoomBlurFrames",
			"intervalTemporalBlurStationaryFrames",
			"intervalTemporalBgCacheBuilds",
			"intervalTemporalBgCacheHits",
			"intervalOverlayStaticRegionBlends",
		] as const;
		for (const field of optionalNumberFields) {
			const value = Number(parsed[field]);
			if (Number.isFinite(value) && value >= 0) {
				progress[field] = value;
			}
		}
		return progress;
	} catch {
		return null;
	}
}

export function mapNvidiaCudaWrapperProgressPercentage(progress: NativeStaticLayoutExportProgress) {
	if (progress.stage === "finalizing") {
		return progress.percentage;
	}

	if (progress.currentFrame > 0 || progress.percentage === 0) {
		return Math.min(98, 3 + progress.percentage * 0.95);
	}

	return progress.percentage;
}

// Distinguish native measured encode FPS from the end-to-end (preparation-
// inclusive) estimate. Only averageFps/instantFps reported by the native helper
// count as measured encode speed; the frames/wall-clock estimate since process
// spawn must be surfaced separately so callers never mistake it for encode
// throughput.
export function resolveNativeStaticLayoutFpsFields(
	progress: NativeStaticLayoutExportProgress,
	elapsedMs: number,
): {
	averageFps?: number;
	estimatedFps?: number;
	fpsSource?: "native" | "estimated";
} {
	const nativeAverageFps =
		typeof progress.averageFps === "number" &&
		Number.isFinite(progress.averageFps) &&
		progress.averageFps > 0
			? progress.averageFps
			: undefined;
	const nativeInstantFps =
		typeof progress.instantFps === "number" &&
		Number.isFinite(progress.instantFps) &&
		progress.instantFps > 0
			? progress.instantFps
			: undefined;
	const hasNativeMeasured = nativeInstantFps !== undefined || nativeAverageFps !== undefined;
	const estimatedFps =
		!hasNativeMeasured && elapsedMs > 0 && progress.currentFrame > 0
			? (progress.currentFrame * 1000) / elapsedMs
			: undefined;
	return {
		averageFps: nativeAverageFps,
		estimatedFps,
		fpsSource: hasNativeMeasured
			? "native"
			: estimatedFps !== undefined
				? "estimated"
				: undefined,
	};
}

export function hasNativeStaticLayoutProgressAdvanced(
	progress: { currentFrame: number; percentage: number; stage?: string },
	previous: { currentFrame: number; percentage: number; stage?: string },
) {
	const currentFrame = Math.max(0, Math.floor(progress.currentFrame));
	const percentage =
		typeof progress.percentage === "number" && Number.isFinite(progress.percentage)
			? progress.percentage
			: 0;
	if (currentFrame > previous.currentFrame) {
		return true;
	}
	if (percentage > previous.percentage + 0.1) {
		return true;
	}
	return progress.stage === "finalizing" && previous.stage !== "finalizing";
}

function startNativeStaticLayoutExportPowerGuard() {
	try {
		const blockerId = powerSaveBlocker.start("prevent-app-suspension");
		return {
			started: true,
			release: () => {
				if (powerSaveBlocker.isStarted(blockerId)) {
					powerSaveBlocker.stop(blockerId);
				}
			},
		};
	} catch (error) {
		console.warn("[native-static-layout-export] Failed to start power guard", error);
		return {
			started: false,
			release: () => undefined,
		};
	}
}

function setNativeStaticLayoutExportProcessPriority(pid: number | undefined, label: string) {
	if (!pid) {
		return false;
	}

	try {
		os.setPriority(pid, NATIVE_EXPORT_HIGH_PRIORITY);
		return true;
	} catch (error) {
		console.warn(`[native-static-layout-export] Failed to raise ${label} priority`, error);
		return false;
	}
}

export const nativeStaticLayoutExportSessions = new Map<string, NativeStaticLayoutExportSession>();

export interface NativeExportCapabilities {
	platform: NodeJS.Platform;
	nvidiaCuda: {
		available: boolean;
		skipReason: string | null;
		hasNvidiaGpu: boolean | null;
		hasWrapper: boolean;
		explicitEnabled: boolean;
		explicitDisabled: boolean;
		userOptInRequired: boolean;
	};
}

export function parseFfmpegDurationSeconds(value: string): number | null {
	const parts = value.trim().split(":");
	if (parts.length !== 3) {
		return null;
	}

	const [hours, minutes, seconds] = parts.map(Number);
	if (![hours, minutes, seconds].every(Number.isFinite)) {
		return null;
	}

	return hours * 3600 + minutes * 60 + seconds;
}

export function parseFfmpegFrameRate(line: string): number | null {
	const fpsMatch = line.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*fps\b/i);
	if (fpsMatch) {
		const frameRate = Number(fpsMatch[1]);
		return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null;
	}

	const tbrMatch = line.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*tbr\b/i);
	if (tbrMatch) {
		const frameRate = Number(tbrMatch[1]);
		return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null;
	}

	return null;
}

export function parseNativeVideoMetadataProbeOutput(
	output: string,
): NativeVideoMetadataProbe | null {
	const durationMatch = output.match(
		/Duration:\s*([0-9:.]+),\s*start:\s*(-?[0-9]+(?:\.[0-9]+)?)/i,
	);
	const duration = durationMatch ? parseFfmpegDurationSeconds(durationMatch[1]) : null;
	if (!duration || duration <= 0) {
		return null;
	}

	const mediaStartTime = durationMatch ? Number(durationMatch[2]) : 0;
	const lines = output.split(/\r?\n/);
	const videoLine = lines.find((line) => /\bVideo:\s*/i.test(line));
	if (!videoLine) {
		return null;
	}

	const dimensionsMatch = videoLine.match(/,\s*([0-9]{2,5})x([0-9]{2,5})(?:[,\s]|$)/);
	if (!dimensionsMatch) {
		return null;
	}

	const width = Number(dimensionsMatch[1]);
	const height = Number(dimensionsMatch[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		return null;
	}

	const videoCodecMatch = videoLine.match(/Video:\s*([^,\r\n]+)/i);
	const videoStartMatch = videoLine.match(/\bstart:\s*(-?[0-9]+(?:\.[0-9]+)?)/i);
	const frameRate = parseFfmpegFrameRate(videoLine) ?? 60;
	const audioLine = lines.find((line) => /\bAudio:\s*/i.test(line));
	const audioCodecMatch = audioLine?.match(/Audio:\s*([^,\r\n]+)/i);
	const audioSampleRateMatch = audioLine?.match(/,\s*([0-9]+)\s*Hz\b/i);

	return {
		width,
		height,
		duration,
		mediaStartTime: Number.isFinite(mediaStartTime) ? mediaStartTime : 0,
		streamStartTime: videoStartMatch ? Number(videoStartMatch[1]) : mediaStartTime,
		streamDuration: duration,
		frameRate,
		codec: videoCodecMatch?.[1]?.trim() || "unknown",
		hasAudio: Boolean(audioLine),
		audioCodec: audioCodecMatch?.[1]?.trim(),
		audioSampleRate: audioSampleRateMatch ? Number(audioSampleRateMatch[1]) : undefined,
	};
}

export async function probeNativeVideoMetadata(
	ffmpegPath: string,
	inputPath: string,
): Promise<NativeVideoMetadataProbe> {
	let output = "";
	try {
		const result = await execFileAsync(ffmpegPath, ["-hide_banner", "-i", inputPath], {
			timeout: 30_000,
			maxBuffer: 4 * 1024 * 1024,
		});
		output = `${result.stdout}\n${result.stderr}`;
	} catch (error) {
		const processOutput = error as { stdout?: unknown; stderr?: unknown };
		output = [processOutput.stdout, processOutput.stderr]
			.filter((value): value is string => typeof value === "string")
			.join("\n");
		if (!output) {
			throw error;
		}
	}

	const metadata = parseNativeVideoMetadataProbeOutput(output);
	if (!metadata) {
		throw new Error("Unable to parse native video metadata from FFmpeg output");
	}

	return metadata;
}

export async function probeNativeVideoStreamStats(
	ffprobePath: string,
	inputPath: string,
): Promise<NativeVideoStreamStatsProbe> {
	const result = await execFileAsync(
		ffprobePath,
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-count_frames",
			"-show_entries",
			"stream=duration,nb_frames,nb_read_frames,avg_frame_rate,r_frame_rate",
			"-of",
			"json",
			inputPath,
		],
		{ timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
	);
	const stats = parseNativeVideoStreamStatsProbeOutput(result.stdout);
	if (!stats) {
		throw new Error("Unable to parse native video stream stats from FFprobe output");
	}

	return stats;
}

async function validateNativeVideoOutputFile(
	ffprobePath: string,
	videoPath: string,
	expected: {
		durationSec: number;
		targetFrames: number;
	},
) {
	const stats = await probeNativeVideoStreamStats(ffprobePath, videoPath);
	const issues = validateNativeVideoStreamStats(stats, expected);
	if (issues.length > 0) {
		throw new Error(`Native video output is invalid: ${issues.join("; ")}`);
	}
}

export function isNativeStaticLayoutH264SourceCodec(codec: string | undefined) {
	const normalized = (codec ?? "").trim().toLowerCase();
	return (
		/\bh\.?264\b/.test(normalized) ||
		normalized.includes("avc1") ||
		normalized.includes("avc3") ||
		normalized.includes("mpeg-4 avc")
	);
}

export function shouldCreateNativeStaticLayoutSourceProxy(
	metadata: Pick<NativeVideoMetadataProbe, "codec">,
	inputPath: string,
) {
	const extension = path.extname(inputPath).toLowerCase();
	return (
		!isNativeStaticLayoutH264SourceCodec(metadata.codec) ||
		!NATIVE_STATIC_LAYOUT_SOURCE_PROXY_CONTAINERS.has(extension)
	);
}

export function getNativeStaticLayoutSourceProxyBitrate(
	options: Pick<NativeStaticLayoutExportOptions, "bitrate" | "frameRate" | "width" | "height">,
	metadata?: Pick<NativeVideoMetadataProbe, "width" | "height">,
) {
	const frameRate = Math.max(1, Math.round(options.frameRate));
	const width = Math.max(1, Math.round(metadata?.width ?? options.width));
	const height = Math.max(1, Math.round(metadata?.height ?? options.height));
	const pixelRateScale = Math.sqrt(
		(width * height * frameRate) / NATIVE_STATIC_LAYOUT_SOURCE_PROXY_REFERENCE_PIXEL_RATE,
	);
	const qualityFloor = Math.round(
		NATIVE_STATIC_LAYOUT_SOURCE_PROXY_1080P30_BITRATE * pixelRateScale,
	);
	return Math.min(
		NATIVE_STATIC_LAYOUT_SOURCE_PROXY_MAX_BITRATE,
		Math.max(Math.round(options.bitrate * 1.2), qualityFloor),
	);
}

export function buildNativeStaticLayoutSourceProxyArgs(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	metadata: NativeVideoMetadataProbe,
) {
	const frameRate = Math.max(1, Math.round(options.frameRate));
	const sourceDurationSec = Math.max(
		0.001,
		metadata.streamDuration ?? metadata.duration ?? options.durationSec,
	);
	const proxyBitrate = getNativeStaticLayoutSourceProxyBitrate(options, metadata);
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		options.inputPath,
		"-map",
		"0:v:0",
		"-an",
		"-t",
		formatCliNumber(sourceDurationSec),
		"-vf",
		`fps=fps=${frameRate}:start_time=0,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS`,
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-tune",
		"zerolatency",
		"-g",
		String(Math.max(1, Math.round(frameRate * 2))),
		"-b:v",
		String(proxyBitrate),
		"-maxrate",
		String(Math.round(proxyBitrate * 1.25)),
		"-bufsize",
		String(proxyBitrate * 2),
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		outputPath,
	];
}

export function validateNativeStaticLayoutSourceProxyMetadata(
	metadata: NativeVideoMetadataProbe,
	expected: { sourceDurationSec: number },
) {
	const issues: string[] = [];
	const expectedDurationSec = Math.max(0, expected.sourceDurationSec);
	const durationToleranceSec = Math.min(2, Math.max(0.5, expectedDurationSec * 0.03));
	if (!isNativeStaticLayoutH264SourceCodec(metadata.codec)) {
		issues.push(`proxy codec is not H.264/AVC: ${metadata.codec || "unknown"}`);
	}
	if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
		issues.push("proxy duration is unavailable");
	} else if (metadata.duration + durationToleranceSec < expectedDurationSec) {
		issues.push(
			`proxy duration ${metadata.duration.toFixed(
				3,
			)}s shorter than expected ${expectedDurationSec.toFixed(3)}s`,
		);
	}
	return issues;
}

export function getNativeVideoExportMaxQueuedWriteBytes(inputByteSize: number) {
	if (inputByteSize === 0) return 8 * 1024 * 1024;
	return Math.min(64 * 1024 * 1024, Math.max(16 * 1024 * 1024, inputByteSize * 4));
}

async function runFfmpegWithMetrics(
	ffmpegPath: string,
	args: string[],
	timeoutMs: number,
	session?: NativeStaticLayoutExportSession,
): Promise<{
	success: boolean;
	elapsedMs: number;
	stderr: string;
	code: number | null;
	signal: NodeJS.Signals | null;
}> {
	const startedAt = getNowMs();
	return await new Promise((resolve) => {
		const child = spawn(ffmpegPath, args, {
			stdio: ["ignore", "ignore", "pipe"],
		});
		if (session) {
			session.currentProcess = child;
			if (session.terminating) {
				child.kill("SIGKILL");
			}
		}
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			try {
				child.kill("SIGKILL");
			} catch {
				// ignore
			}
		}, timeoutMs);

		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			if (session?.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			resolve({
				success: false,
				elapsedMs: getNowMs() - startedAt,
				stderr: error instanceof Error ? error.message : String(error),
				code: null,
				signal: null,
			});
		});
		child.once("close", (code, signal) => {
			if (settled) return;
			settled = true;
			if (session?.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			resolve({
				success: code === 0,
				elapsedMs: getNowMs() - startedAt,
				stderr,
				code,
				signal,
			});
		});
	});
}

function parseFfmpegProgressClockSeconds(value: string) {
	const match = value.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
	if (!match) {
		return null;
	}

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	const seconds = Number(match[3]);
	if (![hours, minutes, seconds].every(Number.isFinite)) {
		return null;
	}

	return hours * 3600 + minutes * 60 + seconds;
}

export function parseFfmpegProgressLineSeconds(line: string) {
	const separatorIndex = line.indexOf("=");
	if (separatorIndex <= 0) {
		return null;
	}

	const key = line.slice(0, separatorIndex).trim();
	const value = line.slice(separatorIndex + 1).trim();
	if (key === "out_time_us" || key === "out_time_ms") {
		const microseconds = Number(value);
		return Number.isFinite(microseconds) && microseconds >= 0 ? microseconds / 1_000_000 : null;
	}
	if (key === "out_time") {
		return parseFfmpegProgressClockSeconds(value);
	}

	return null;
}

function createFfmpegMuxProgressHandler(
	totalSec: number | undefined,
	onProgress?: (progress: NativeVideoAudioMuxProgress) => void,
) {
	if (!onProgress || !Number.isFinite(totalSec) || !totalSec || totalSec <= 0) {
		return () => undefined;
	}

	let lineBuffer = "";
	let lastRatio = 0;
	return (chunk: Buffer | string) => {
		lineBuffer += chunk.toString();
		const lines = lineBuffer.split(/\r?\n/);
		lineBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const processedSec = parseFfmpegProgressLineSeconds(line);
			if (processedSec === null) {
				continue;
			}
			const ratio = Math.max(0, Math.min(1, processedSec / totalSec));
			if (ratio < lastRatio + 0.0025 && ratio < 1) {
				continue;
			}
			lastRatio = Math.max(lastRatio, ratio);
			onProgress({
				ratio: lastRatio,
				processedSec,
				totalSec,
			});
		}
	};
}

async function runFfmpegAudioMux(
	ffmpegPath: string,
	args: string[],
	timeoutMs: number,
	options: NativeVideoExportFinishOptions,
	onProgress?: (progress: NativeVideoAudioMuxProgress) => void,
	session?: NativeStaticLayoutExportSession,
) {
	if (!onProgress && !session) {
		await execFileAsync(ffmpegPath, args, {
			timeout: timeoutMs,
			maxBuffer: 20 * 1024 * 1024,
		});
		return;
	}

	const handleProgressChunk = createFfmpegMuxProgressHandler(
		options.outputDurationSec,
		onProgress,
	);
	await new Promise<void>((resolve, reject) => {
		const child = spawn(ffmpegPath, args, {
			stdio: ["ignore", "ignore", "pipe"],
		});
		if (session) {
			session.currentProcess = child;
			if (session.terminating) {
				child.kill("SIGKILL");
			}
		}

		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			child.kill("SIGKILL");
		}, timeoutMs);

		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			handleProgressChunk(text);
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			if (session?.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (code, signal) => {
			if (settled) return;
			settled = true;
			if (session?.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			if (session?.terminating) {
				reject(new Error("Native static layout export was cancelled"));
				return;
			}
			if (code !== 0) {
				const suffix = signal ? ` (signal ${signal})` : "";
				reject(
					new Error(
						`FFmpeg audio mux exited with code ${code ?? "unknown"}${suffix}` +
							(stderr.trim() ? `\nSTDERR:\n${stderr.trim()}` : ""),
					),
				);
				return;
			}
			if (onProgress) {
				const completeProgress: NativeVideoAudioMuxProgress = { ratio: 1 };
				if (
					typeof options.outputDurationSec === "number" &&
					Number.isFinite(options.outputDurationSec)
				) {
					completeProgress.processedSec = options.outputDurationSec;
					completeProgress.totalSec = options.outputDurationSec;
				}
				onProgress(completeProgress);
			}
			resolve();
		});
	});
}

export function isHardwareAcceleratedVideoEncoder(encoderName: string) {
	return /(videotoolbox|nvenc|qsv|amf|mf)/i.test(encoderName);
}

export async function removeTemporaryExportFile(filePath: string | null | undefined) {
	if (!filePath) {
		return;
	}

	try {
		await fs.rm(filePath, { force: true });
	} catch {
		// Ignore cleanup failures for temp export artifacts.
	}
}

export function getNativeVideoExportSessionError(
	session: NativeVideoExportSession,
	fallback: string,
) {
	return (
		session.stdinError?.message ||
		session.processError?.message ||
		session.stderrOutput.trim() ||
		fallback
	);
}

export function sendNativeVideoExportWriteFrameResult(
	sender: WebContents | null | undefined,
	sessionId: string,
	requestId: number,
	result: { success: boolean; error?: string },
) {
	if (!sender || sender.isDestroyed()) {
		return;
	}

	sender.send("native-video-export-write-frame-result", {
		sessionId,
		requestId,
		...result,
	});
}

export function settleNativeVideoExportWriteFrameRequest(
	sessionId: string,
	session: NativeVideoExportSession,
	requestId: number,
	result: { success: boolean; error?: string },
) {
	session.pendingWriteRequestIds.delete(requestId);
	sendNativeVideoExportWriteFrameResult(session.sender, sessionId, requestId, result);
}

export function flushNativeVideoExportPendingWriteRequests(
	sessionId: string,
	session: NativeVideoExportSession,
	error: string,
) {
	flushNativeVideoExportFramePortPendingRequests(sessionId, session, error);
	for (const requestId of session.pendingWriteRequestIds) {
		sendNativeVideoExportWriteFrameResult(session.sender, sessionId, requestId, {
			success: false,
			error,
		});
	}

	session.pendingWriteRequestIds.clear();
}

export function isIgnorableNativeVideoExportStreamError(error: Error | null | undefined): boolean {
	if (!error) {
		return false;
	}

	const errno = error as NodeJS.ErrnoException;
	return (
		errno.code === "EPIPE" ||
		errno.code === "ERR_STREAM_DESTROYED" ||
		/broken pipe|stream destroyed|eof/i.test(error.message)
	);
}

export async function waitForNativeVideoExportDrain(session: NativeVideoExportSession) {
	if (
		session.stdinError ||
		session.processError ||
		session.ffmpegProcess.stdin.destroyed ||
		session.ffmpegProcess.stdin.writableEnded ||
		!session.ffmpegProcess.stdin.writable ||
		session.ffmpegProcess.stdin.writableLength <= 0
	) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(
				new Error("Timed out while waiting for native export writer backpressure to clear"),
			);
		}, 15000);

		const cleanup = () => {
			clearTimeout(timeout);
			session.ffmpegProcess.stdin.off("drain", handleDrain);
			session.ffmpegProcess.stdin.off("error", handleError);
			session.ffmpegProcess.off("close", handleClose);
		};

		const handleDrain = () => {
			cleanup();
			resolve();
		};

		const handleError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const handleClose = () => {
			cleanup();
			reject(
				new Error(
					getNativeVideoExportSessionError(
						session,
						"Native video export writer closed before draining",
					),
				),
			);
		};

		session.ffmpegProcess.stdin.once("drain", handleDrain);
		session.ffmpegProcess.stdin.once("error", handleError);
		session.ffmpegProcess.once("close", handleClose);
	});
}

export function getNativeVideoExportFrameLength(frameData: Uint8Array | ArrayBuffer) {
	return frameData.byteLength;
}

export async function writeNativeVideoExportFrame(
	session: NativeVideoExportSession,
	frameData: Uint8Array | ArrayBuffer,
) {
	if (
		session.inputMode !== "h264-stream" &&
		getNativeVideoExportFrameLength(frameData) !== session.inputByteSize
	) {
		throw new Error(
			`Native video export expected ${session.inputByteSize} bytes per frame but received ${getNativeVideoExportFrameLength(frameData)}`,
		);
	}

	if (
		session.stdinError ||
		session.processError ||
		session.ffmpegProcess.stdin.destroyed ||
		session.ffmpegProcess.stdin.writableEnded ||
		!session.ffmpegProcess.stdin.writable
	) {
		throw new Error(
			getNativeVideoExportSessionError(
				session,
				"Native video export encoder is not accepting frames",
			),
		);
	}

	const frameBuffer =
		frameData instanceof ArrayBuffer
			? Buffer.from(frameData)
			: Buffer.from(frameData.buffer, frameData.byteOffset, frameData.byteLength);

	try {
		session.ffmpegProcess.stdin.write(frameBuffer);
	} catch (error) {
		session.stdinError = error instanceof Error ? error : new Error(String(error));
		throw session.stdinError;
	}

	if (session.ffmpegProcess.stdin.writableLength >= session.maxQueuedWriteBytes) {
		try {
			await waitForNativeVideoExportDrain(session);
		} catch (error) {
			session.stdinError = error instanceof Error ? error : new Error(String(error));
			throw session.stdinError;
		}
	}
}

function toConcatFileLine(filePath: string) {
	const normalized = filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
	return `file '${normalized}'`;
}

function getStaticLayoutChunkOutputPath(directory: string, index: number) {
	return path.join(directory, `chunk-${String(index).padStart(4, "0")}.mp4`);
}

function shouldUsePrecompositedStaticLayout(options: NativeStaticLayoutExportOptions) {
	return Boolean(
		options.backgroundImagePath ||
			(options.borderRadius ?? 0) > 0.5 ||
			(options.shadowIntensity ?? 0) > 0,
	);
}

export async function normalizeNativeStaticLayoutBackground(
	options: NativeStaticLayoutExportOptions,
): Promise<NativeStaticLayoutExportOptions> {
	if (!options.backgroundImagePath || (await pathExists(options.backgroundImagePath))) {
		return options;
	}

	console.warn(
		"[native-static-layout-export] Background image is missing; using solid fallback",
		{
			backgroundImagePath: options.backgroundImagePath,
		},
	);
	return {
		...options,
		backgroundColor: MISSING_NATIVE_STATIC_BACKGROUND_COLOR,
		backgroundImagePath: null,
	};
}

function getFfmpegFailureMessage(result: Awaited<ReturnType<typeof runFfmpegWithMetrics>>) {
	const suffix = result.signal ? ` (signal ${result.signal})` : "";
	const status = result.code === null ? "unknown" : String(result.code);
	return result.stderr.trim() || `FFmpeg exited with code ${status}${suffix}`;
}

function clampUnit(value: number) {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.min(1, Math.max(0, value));
}

function formatCliNumber(value: number) {
	return Number.isInteger(value)
		? String(value)
		: value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function hasNativeStaticLayoutTimeline(options: NativeStaticLayoutExportOptions) {
	return (options.timelineSegments?.length ?? 0) > 0;
}

function hasNativeStaticLayoutSourceCrop(options: NativeStaticLayoutExportOptions) {
	return Boolean(
		Number.isFinite(options.sourceCropWidth) &&
			Number.isFinite(options.sourceCropHeight) &&
			(options.sourceCropWidth ?? 0) >= 2 &&
			(options.sourceCropHeight ?? 0) >= 2,
	);
}

export function buildNativeStaticLayoutTimelineSegments(
	segments: NativeVideoExportEditedTrackSegment[],
): NativeStaticLayoutTimelineSegment[] {
	const timelineSegments: NativeStaticLayoutTimelineSegment[] = [];
	let outputCursorMs = 0;

	for (const segment of segments) {
		const sourceStartMs = Math.max(0, segment.startMs);
		const sourceEndMs = Math.max(sourceStartMs, segment.endMs);
		const speed = segment.speed;
		if (
			!Number.isFinite(sourceStartMs) ||
			!Number.isFinite(sourceEndMs) ||
			!Number.isFinite(speed) ||
			sourceEndMs - sourceStartMs <= 0.5 ||
			speed <= 0
		) {
			return [];
		}

		const outputDurationMs = (sourceEndMs - sourceStartMs) / speed;
		if (!Number.isFinite(outputDurationMs) || outputDurationMs <= 0.5) {
			return [];
		}

		const outputStartMs = outputCursorMs;
		const outputEndMs = outputStartMs + outputDurationMs;
		timelineSegments.push({
			sourceStartMs,
			sourceEndMs,
			outputStartMs,
			outputEndMs,
			speed,
		});
		outputCursorMs = outputEndMs;
	}

	return timelineSegments;
}

function validateNativeStaticLayoutTimelineSegments(
	segments: NativeStaticLayoutTimelineSegment[] | undefined,
	durationSec: number,
) {
	if (!segments?.length) {
		return [];
	}

	const normalized: NativeStaticLayoutTimelineSegment[] = [];
	let expectedOutputStartMs = 0;
	for (const segment of segments) {
		const sourceStartMs = Math.max(0, segment.sourceStartMs);
		const sourceEndMs = Math.max(sourceStartMs, segment.sourceEndMs);
		const outputStartMs = Math.max(0, segment.outputStartMs);
		const outputEndMs = Math.max(outputStartMs, segment.outputEndMs);
		const speed = segment.speed;
		if (
			!Number.isFinite(sourceStartMs) ||
			!Number.isFinite(sourceEndMs) ||
			!Number.isFinite(outputStartMs) ||
			!Number.isFinite(outputEndMs) ||
			!Number.isFinite(speed) ||
			sourceEndMs - sourceStartMs <= 0.5 ||
			outputEndMs - outputStartMs <= 0.5 ||
			speed <= 0
		) {
			throw new Error("Native timeline map contains an invalid segment");
		}

		if (Math.abs(outputStartMs - expectedOutputStartMs) > 2) {
			throw new Error("Native timeline map output ranges must be contiguous");
		}

		const expectedOutputDurationMs = (sourceEndMs - sourceStartMs) / speed;
		if (Math.abs(expectedOutputDurationMs - (outputEndMs - outputStartMs)) > 2) {
			throw new Error("Native timeline map segment speed does not match its output duration");
		}

		normalized.push({
			sourceStartMs,
			sourceEndMs,
			outputStartMs,
			outputEndMs,
			speed,
		});
		expectedOutputStartMs = outputEndMs;
	}

	if (Math.abs(expectedOutputStartMs / 1000 - durationSec) > 0.05) {
		throw new Error("Native timeline map duration does not match the export duration");
	}

	return normalized;
}

async function prepareNativeStaticLayoutTimelineMap(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const segments = validateNativeStaticLayoutTimelineSegments(
		options.timelineSegments,
		options.durationSec,
	);
	if (segments.length === 0) {
		return null;
	}

	const lines = segments.map((segment) =>
		[
			segment.sourceStartMs,
			segment.sourceEndMs,
			segment.outputStartMs,
			segment.outputEndMs,
			segment.speed,
		]
			.map(formatCliNumber)
			.join(","),
	);
	await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
	return outputPath;
}

async function pathExists(filePath: string) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function isNvidiaVendorId(value: unknown) {
	if (typeof value === "number") {
		return value === NVIDIA_PCI_VENDOR_ID;
	}
	if (typeof value !== "string") {
		return false;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized.length === 0) {
		return false;
	}
	const parsed = normalized.startsWith("0x")
		? Number.parseInt(normalized.slice(2), 16)
		: Number.parseInt(normalized, 10);

	return Number.isFinite(parsed) && parsed === NVIDIA_PCI_VENDOR_ID;
}

function includesNvidiaGpuName(value: unknown) {
	return typeof value === "string" && /\bnvidia\b/i.test(value);
}

function isNvidiaGpuDevice(device: unknown) {
	if (!device || typeof device !== "object") {
		return false;
	}

	const gpuDevice = device as ElectronGpuDeviceLike;
	return (
		isNvidiaVendorId(gpuDevice.vendorId) ||
		includesNvidiaGpuName(gpuDevice.vendorString) ||
		includesNvidiaGpuName(gpuDevice.deviceString)
	);
}

export function hasNvidiaGpuDeviceInGpuInfo(gpuInfo: unknown) {
	if (!gpuInfo || typeof gpuInfo !== "object") {
		return false;
	}

	const devices = (gpuInfo as ElectronGpuInfoLike).gpuDevice;
	return Array.isArray(devices) && devices.some(isNvidiaGpuDevice);
}

async function hasNvidiaGpuForCudaExportCandidate() {
	const hasNvidiaGpu = await probeNvidiaGpuForCudaExportCandidate();
	return hasNvidiaGpu ?? true;
}

async function probeNvidiaGpuForCudaExportCandidate(): Promise<boolean | null> {
	const getGPUInfo = (
		app as typeof app & {
			getGPUInfo?: (infoType: "basic") => Promise<unknown>;
		}
	).getGPUInfo;
	if (typeof getGPUInfo !== "function") {
		return null;
	}

	try {
		return hasNvidiaGpuDeviceInGpuInfo(await getGPUInfo.call(app, "basic"));
	} catch (error) {
		console.warn(
			"[native-static-layout-export] Unable to inspect GPU info before NVIDIA CUDA export; letting the helper decide",
			error,
		);
		return null;
	}
}

function getNativeBinPlatformArch() {
	return process.arch === "arm64" ? "win32-arm64" : "win32-x64";
}

async function resolveExperimentalWindowsGpuExporterPath() {
	if (process.platform !== "win32") {
		return null;
	}

	const executableNames = ["recordly-gpu-export.exe", "gpu-export-probe.exe"];
	const candidates: string[] = [];
	const configuredPath = process.env.RECORDLY_WINDOWS_GPU_EXPORT_EXE;
	if (configuredPath) {
		candidates.push(configuredPath);
	}

	const nativeBinDir = path.join("electron", "native", "bin", getNativeBinPlatformArch());
	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		for (const executableName of executableNames) {
			candidates.push(
				path.join(resourcesPath, "app.asar.unpacked", nativeBinDir, executableName),
				path.join(resourcesPath, nativeBinDir, executableName),
			);
		}
	}

	for (const executableName of executableNames) {
		candidates.push(
			path.join(process.cwd(), nativeBinDir, executableName),
			path.join(
				app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
				nativeBinDir,
				executableName,
			),
			path.join(process.cwd(), ".tmp", "gpu-export-probe-build", "Release", executableName),
			path.join(
				process.cwd(),
				"electron",
				"native",
				"gpu-export-probe",
				"build",
				"Release",
				executableName,
			),
		);
	}

	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}

	return null;
}

export function getNvidiaCudaAudioExportSkipReason(
	audioMode: NativeVideoExportAudioMode | undefined,
	options: { allowValidatedFallbackCandidate?: boolean } = {},
) {
	const resolvedAudioMode = audioMode ?? "none";
	if (resolvedAudioMode === "none") {
		return null;
	}
	if (process.env[NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV] === "1") {
		return null;
	}
	if (options.allowValidatedFallbackCandidate) {
		return null;
	}

	return `audio-mode:${resolvedAudioMode}`;
}

function isExplicitNvidiaCudaExportEnabled() {
	return process.env[NVIDIA_CUDA_EXPORT_ENV] === "1";
}

function isExplicitNvidiaCudaExportDisabled() {
	return process.env[NVIDIA_CUDA_EXPORT_ENV] === "0";
}

function isUserOptedInNvidiaCudaExport(options: NativeStaticLayoutExportOptions) {
	return options.experimentalNvidiaCudaExport === true && !isExplicitNvidiaCudaExportDisabled();
}

function isValidatedNvidiaCudaFallbackCandidate(options: NativeStaticLayoutExportOptions) {
	return isUserOptedInNvidiaCudaExport(options) && !isExplicitNvidiaCudaExportEnabled();
}

function isNvidiaCudaForceVideoOnlyEnabled() {
	return process.env[NVIDIA_CUDA_FORCE_VIDEO_ONLY_ENV] === "1";
}

export function getNvidiaCudaAutoStallTimeoutMs(autoCandidateActive = false) {
	if (!autoCandidateActive && !isExplicitNvidiaCudaExportEnabled()) {
		return null;
	}

	const rawValue = process.env[NVIDIA_CUDA_AUTO_STALL_TIMEOUT_ENV]?.trim();
	if (rawValue === "0" || rawValue?.toLowerCase() === "off") {
		return null;
	}

	const parsed = Number(rawValue);
	if (Number.isFinite(parsed) && parsed > 0) {
		return Math.max(10_000, Math.round(parsed));
	}

	return DEFAULT_NVIDIA_CUDA_AUTO_STALL_TIMEOUT_MS;
}

export function getNativeGpuCompositorStallTimeoutMs() {
	const rawValue = process.env[NATIVE_GPU_STALL_TIMEOUT_ENV]?.trim();
	if (rawValue === "0" || rawValue?.toLowerCase() === "off") {
		return null;
	}

	const parsed = Number(rawValue);
	if (Number.isFinite(parsed) && parsed > 0) {
		return Math.max(10_000, Math.round(parsed));
	}

	return DEFAULT_NATIVE_GPU_STALL_TIMEOUT_MS;
}

export async function getExperimentalNvidiaCudaExportSkipReason(
	options: NativeStaticLayoutExportOptions,
) {
	if (process.platform !== "win32") {
		return "not-windows";
	}
	if (isExplicitNvidiaCudaExportDisabled()) {
		return "env-disabled";
	}
	const explicitCuda = isExplicitNvidiaCudaExportEnabled();
	const userOptIn = isUserOptedInNvidiaCudaExport(options);
	if (!explicitCuda && !userOptIn) {
		return "env-disabled";
	}
	if (!options.experimentalWindowsGpuCompositor) {
		return "windows-gpu-compositor-disabled";
	}

	if (userOptIn) {
		if (!(await resolveExperimentalNvidiaCudaExportScriptPath())) {
			return "cuda-wrapper-unavailable";
		}
		if (!(await hasNvidiaGpuForCudaExportCandidate())) {
			return "nvidia-gpu-unavailable";
		}
	}

	return getNvidiaCudaAudioExportSkipReason(options.audioOptions?.audioMode, {
		allowValidatedFallbackCandidate:
			isValidatedNvidiaCudaFallbackCandidate(options) || isNvidiaCudaForceVideoOnlyEnabled(),
	});
}

export async function getNativeExportCapabilities(): Promise<NativeExportCapabilities> {
	if (process.platform !== "win32") {
		return {
			platform: process.platform,
			nvidiaCuda: {
				available: false,
				skipReason: "not-windows",
				hasNvidiaGpu: null,
				hasWrapper: false,
				explicitEnabled: isExplicitNvidiaCudaExportEnabled(),
				explicitDisabled: isExplicitNvidiaCudaExportDisabled(),
				userOptInRequired: true,
			},
		};
	}

	const explicitEnabled = isExplicitNvidiaCudaExportEnabled();
	const explicitDisabled = isExplicitNvidiaCudaExportDisabled();
	const wrapperPath = await resolveExperimentalNvidiaCudaExportScriptPath();
	const hasNvidiaGpu = await probeNvidiaGpuForCudaExportCandidate();
	// An inconclusive GPU probe (null) must NOT report the CUDA route
	// unavailable: Electron's getGPUInfo can fail in dev/packaged runs while the
	// live CUDA helper builds and initializes fine. The runtime attempt is the
	// authoritative check (the helper fails with noCpuFallback on non-NVIDIA
	// hardware), matching getExperimentalNvidiaCudaExportSkipReason which also
	// treats an inconclusive probe as "let the helper decide".
	const skipReason = explicitDisabled
		? "env-disabled"
		: !wrapperPath
			? "cuda-wrapper-unavailable"
			: hasNvidiaGpu === false
				? "nvidia-gpu-unavailable"
				: null;
	if (hasNvidiaGpu === null && !explicitDisabled && wrapperPath) {
		console.info(
			"[native-export] NVIDIA CUDA GPU probe was inconclusive; letting the live helper decide at runtime",
			{ wrapperPath, reason: skipReason },
		);
	} else if (skipReason) {
		console.info("[native-export] NVIDIA CUDA availability", {
			available: false,
			skipReason,
			hasNvidiaGpu,
			hasWrapper: Boolean(wrapperPath),
		});
	} else {
		console.info("[native-export] NVIDIA CUDA availability", {
			available: true,
			hasNvidiaGpu,
			hasWrapper: Boolean(wrapperPath),
		});
	}

	return {
		platform: process.platform,
		nvidiaCuda: {
			available: skipReason === null,
			skipReason,
			hasNvidiaGpu,
			hasWrapper: Boolean(wrapperPath),
			explicitEnabled,
			explicitDisabled,
			userOptInRequired: !explicitEnabled,
		},
	};
}

export async function resolveExperimentalNvidiaCudaExportScriptPath() {
	if (process.platform !== "win32") {
		return null;
	}

	const candidates: string[] = [];
	const configuredPath = process.env.RECORDLY_NVIDIA_CUDA_EXPORT_SCRIPT;
	if (configuredPath) {
		candidates.push(configuredPath);
	}
	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		candidates.push(
			path.join(
				resourcesPath,
				"app.asar.unpacked",
				"electron",
				"native",
				"nvidia-cuda-compositor",
				"run-mp4-pipeline.mjs",
			),
		);
	}
	candidates.push(
		path.join(
			process.cwd(),
			"electron",
			"native",
			"nvidia-cuda-compositor",
			"run-mp4-pipeline.mjs",
		),
		path.join(
			app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
			"electron",
			"native",
			"nvidia-cuda-compositor",
			"run-mp4-pipeline.mjs",
		),
		path.join(
			app.getAppPath(),
			"electron",
			"native",
			"nvidia-cuda-compositor",
			"run-mp4-pipeline.mjs",
		),
		path.join(process.cwd(), ".tmp", "nvdec-nvenc-probe", "run-mp4-pipeline.mjs"),
		path.join(app.getAppPath(), ".tmp", "nvdec-nvenc-probe", "run-mp4-pipeline.mjs"),
	);

	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}

	return null;
}

function resolveExperimentalNvidiaCudaNodeCommand() {
	const configuredNodePath = process.env.RECORDLY_NVIDIA_CUDA_NODE_EXE;
	if (configuredNodePath) {
		return {
			command: configuredNodePath,
			env: {},
		};
	}

	return {
		command: process.execPath,
		env: {
			ELECTRON_RUN_AS_NODE: "1",
		},
	};
}

function convertHexColorToNv12(color: string) {
	const hex = color.trim().match(/^#?([0-9a-f]{6})$/i)?.[1] ?? "101010";
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

	return {
		y: clampByte(((66 * r + 129 * g + 25 * b + 128) >> 8) + 16),
		u: clampByte(((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128),
		v: clampByte(((112 * r - 94 * g - 18 * b + 128) >> 8) + 128),
	};
}

export function getNativeStaticLayoutRawFrameFallbackReason(
	options: Pick<NativeStaticLayoutExportOptions, "videoCodec" | "encoderPreference">,
) {
	const videoCodec = options.videoCodec ?? "h264";
	const encoderPreference = options.encoderPreference ?? "auto";
	if (encoderPreference === "cpu") {
		return "encoder-preference-cpu-requires-native-rawvideo";
	}
	if (encoderPreference === "hardware" && videoCodec === "h264") {
		return "encoder-preference-hardware-requires-native-rawvideo";
	}
	return null;
}

function getNvidiaCudaBitrateMbps(options: NativeStaticLayoutExportOptions) {
	return Math.max(1, Math.round(options.bitrate / 1_000_000));
}

export function buildExperimentalWindowsGpuStaticLayoutArgs(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	if (options.videoCodec === "hevc") {
		throw new Error(
			"HEVC native static layout requires the generalized NVIDIA CUDA compositor",
		);
	}
	const shadowPixels = Math.round(clampUnit(options.shadowIntensity ?? 0) * 64);
	const backgroundBlurPx = Math.max(0, options.backgroundBlurPx ?? 0);
	const pixelCount = options.width * options.height;
	const surfacePoolSize = pixelCount <= 1920 * 1080 ? 12 : 8;
	const args = [
		"--input",
		options.inputPath,
		"--output",
		outputPath,
		"--width",
		String(options.width),
		"--height",
		String(options.height),
		"--fps",
		String(options.frameRate),
		"--seconds",
		formatCliNumber(options.durationSec),
		"--bitrate",
		String(options.bitrate),
		"--shader-composite",
		"--radius",
		formatCliNumber(Math.max(0, options.borderRadius ?? 0)),
		"--shadow",
		formatCliNumber(shadowPixels),
		"--content-left",
		String(Math.round(options.offsetX)),
		"--content-top",
		String(Math.round(options.offsetY)),
		"--content-width",
		String(Math.round(options.contentWidth)),
		"--content-height",
		String(Math.round(options.contentHeight)),
		"--background-color",
		options.backgroundColor,
		"--surface-pool-size",
		String(surfacePoolSize),
	];

	if (options.backgroundImagePath) {
		args.push("--background-image", options.backgroundImagePath);
	}
	if (
		Number.isFinite(options.sourceCropX) &&
		Number.isFinite(options.sourceCropY) &&
		Number.isFinite(options.sourceCropWidth) &&
		Number.isFinite(options.sourceCropHeight) &&
		(options.sourceCropWidth ?? 0) >= 2 &&
		(options.sourceCropHeight ?? 0) >= 2
	) {
		args.push(
			"--source-crop-x",
			String(Math.round(options.sourceCropX ?? 0)),
			"--source-crop-y",
			String(Math.round(options.sourceCropY ?? 0)),
			"--source-crop-width",
			String(Math.round(options.sourceCropWidth ?? 0)),
			"--source-crop-height",
			String(Math.round(options.sourceCropHeight ?? 0)),
		);
	}
	if (backgroundBlurPx > 0) {
		args.push("--background-blur", formatCliNumber(backgroundBlurPx));
	}
	if (options.webcamInputPath) {
		const webcamShadowPixels = Math.round(clampUnit(options.webcamShadowIntensity ?? 0) * 64);
		args.push(
			"--webcam-input",
			options.webcamInputPath,
			"--webcam-left",
			String(Math.round(options.webcamLeft ?? 0)),
			"--webcam-top",
			String(Math.round(options.webcamTop ?? 0)),
			"--webcam-size",
			String(Math.round(options.webcamSize ?? 0)),
			"--webcam-radius",
			formatCliNumber(Math.max(0, options.webcamRadius ?? 0)),
			"--webcam-shadow",
			formatCliNumber(webcamShadowPixels),
			"--webcam-time-offset-ms",
			formatCliNumber(options.webcamTimeOffsetMs ?? 0),
		);
		if (options.webcamMirror !== false) {
			args.push("--webcam-mirror");
		}
	}
	if (options.cursorTelemetryPath) {
		args.push(
			"--cursor-telemetry",
			options.cursorTelemetryPath,
			"--cursor-size",
			formatCliNumber(Math.max(1, options.cursorSize ?? 84)),
		);
		if (options.cursorAtlasPath && options.cursorAtlasMetadataPath) {
			args.push(
				"--cursor-atlas",
				options.cursorAtlasPath,
				"--cursor-atlas-metadata",
				options.cursorAtlasMetadataPath,
			);
		}
	}
	if (options.zoomTelemetryPath) {
		args.push("--zoom-telemetry", options.zoomTelemetryPath);
	}
	if (options.timelineMapPath) {
		args.push("--timeline-map", options.timelineMapPath);
	}

	return args;
}

async function prepareWindowsGpuCursorTelemetry(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const telemetry = options.cursorTelemetry;
	if (!telemetry || telemetry.length === 0) {
		return null;
	}

	const lines = telemetry
		.filter((sample) => {
			return (
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy)
			);
		})
		.map((sample) => {
			const timeMs = Math.max(0, sample.timeMs);
			const cx = Math.min(1, Math.max(0, sample.cx));
			const cy = Math.min(1, Math.max(0, sample.cy));
			const cursorTypeIndex = Math.max(
				0,
				Math.min(8, Math.round(sample.cursorTypeIndex ?? 0)),
			);
			const bounceScale = Math.min(2, Math.max(0.1, sample.bounceScale ?? 1));
			const visible = sample.visible !== false ? 1 : 0;
			return [
				formatCliNumber(timeMs),
				formatCliNumber(cx),
				formatCliNumber(cy),
				String(cursorTypeIndex),
				formatCliNumber(bounceScale),
				String(visible),
			].join(",");
		});

	if (lines.length === 0) {
		return null;
	}

	await fs.writeFile(outputPath, lines.join("\n"), "utf8");
	return outputPath;
}

async function prepareWindowsGpuCursorAtlas(
	options: NativeStaticLayoutExportOptions,
	atlasPath: string,
	metadataPath: string,
) {
	const dataUrl = options.cursorAtlasPngDataUrl;
	const entries = options.cursorAtlasEntries;
	if (!dataUrl || !entries?.length) {
		return null;
	}

	const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
	if (!match) {
		return null;
	}

	const metadataLines = entries
		.filter((entry) => {
			return (
				Number.isInteger(entry.index) &&
				Number.isFinite(entry.x) &&
				Number.isFinite(entry.y) &&
				Number.isFinite(entry.width) &&
				Number.isFinite(entry.height) &&
				Number.isFinite(entry.anchorX) &&
				Number.isFinite(entry.anchorY) &&
				Number.isFinite(entry.aspectRatio) &&
				entry.width > 0 &&
				entry.height > 0
			);
		})
		.map((entry) =>
			[
				String(Math.max(0, Math.min(8, entry.index))),
				formatCliNumber(Math.max(0, entry.x)),
				formatCliNumber(Math.max(0, entry.y)),
				formatCliNumber(Math.max(1, entry.width)),
				formatCliNumber(Math.max(1, entry.height)),
				formatCliNumber(Math.min(1, Math.max(0, entry.anchorX))),
				formatCliNumber(Math.min(1, Math.max(0, entry.anchorY))),
				formatCliNumber(Math.max(0.01, entry.aspectRatio)),
			].join(","),
		);
	if (metadataLines.length === 0) {
		return null;
	}

	await fs.writeFile(atlasPath, Buffer.from(match[1], "base64"));
	await fs.writeFile(metadataPath, metadataLines.join("\n"), "utf8");
	return { atlasPath, metadataPath };
}

/**
 * Resolves the native cursor asset paths that may be handed to a GPU compositor
 * wrapper. The Windows GPU compositor prep writes CSV telemetry/atlas artifacts
 * onto the options; the NVIDIA CUDA wrapper's `--cursor-json` contract is a JSON
 * {"samples":[...]} payload (the pipeline rejects raw CSV/TSV rows), so a CSV
 * path must never reach it. When overlay sidecars are present AND the cursor is
 * baked into the transparent RGBA layer (cursorAtlasOwned is not true), the CUDA
 * route must not draw the cursor again: stripping the assets is mandatory, never
 * a silent degradation (the wrapper is never given a malformed cursor file and
 * never double-renders the baked cursor). When cursorAtlasOwned is true the
 * sidecar excluded cursor pixels, so the assets must pass through untouched.
 */
export function resolveNvidiaCudaCursorAssets(
	options: NativeStaticLayoutExportOptions,
	strip: boolean,
): Pick<
	NativeStaticLayoutExportOptions,
	"cursorTelemetryPath" | "cursorAtlasPath" | "cursorAtlasMetadataPath"
> {
	if (!strip) {
		return {
			cursorTelemetryPath: options.cursorTelemetryPath ?? null,
			cursorAtlasPath: options.cursorAtlasPath ?? null,
			cursorAtlasMetadataPath: options.cursorAtlasMetadataPath ?? null,
		};
	}
	return {
		cursorTelemetryPath: null,
		cursorAtlasPath: null,
		cursorAtlasMetadataPath: null,
	};
}

async function prepareNvidiaCudaCursorTelemetry(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const telemetry = options.cursorTelemetry;
	if (!telemetry || telemetry.length === 0) {
		return null;
	}

	const samples = telemetry
		.filter((sample) => {
			return (
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy)
			);
		})
		.map((sample) => ({
			timeMs: Math.max(0, sample.timeMs),
			cx: Math.min(1, Math.max(0, sample.cx)),
			cy: Math.min(1, Math.max(0, sample.cy)),
			cursorTypeIndex: Math.max(0, Math.min(8, Math.round(sample.cursorTypeIndex ?? 0))),
			bounceScale: Math.min(2, Math.max(0.1, sample.bounceScale ?? 1)),
			visible: sample.visible !== false,
		}));
	if (samples.length === 0) {
		return null;
	}

	await fs.writeFile(outputPath, JSON.stringify({ samples }), "utf8");
	return outputPath;
}

async function prepareNvidiaCudaCursorAtlas(
	options: NativeStaticLayoutExportOptions,
	atlasPath: string,
	metadataPath: string,
) {
	const dataUrl = options.cursorAtlasPngDataUrl;
	const entries = options.cursorAtlasEntries;
	if (!dataUrl || !entries?.length) {
		return null;
	}

	const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
	if (!match) {
		return null;
	}

	const metadataLines = entries
		.filter((entry) => {
			return (
				Number.isInteger(entry.index) &&
				Number.isFinite(entry.x) &&
				Number.isFinite(entry.y) &&
				Number.isFinite(entry.width) &&
				Number.isFinite(entry.height) &&
				Number.isFinite(entry.anchorX) &&
				Number.isFinite(entry.anchorY) &&
				Number.isFinite(entry.aspectRatio) &&
				entry.width > 0 &&
				entry.height > 0
			);
		})
		.map((entry) =>
			[
				String(Math.max(0, Math.min(8, entry.index))),
				formatCliNumber(Math.max(0, entry.x)),
				formatCliNumber(Math.max(0, entry.y)),
				formatCliNumber(Math.max(1, entry.width)),
				formatCliNumber(Math.max(1, entry.height)),
				formatCliNumber(Math.min(1, Math.max(0, entry.anchorX))),
				formatCliNumber(Math.min(1, Math.max(0, entry.anchorY))),
				formatCliNumber(Math.max(0.01, entry.aspectRatio)),
			].join("\t"),
		);
	if (metadataLines.length === 0) {
		return null;
	}

	await fs.writeFile(atlasPath, Buffer.from(match[1], "base64"));
	await fs.writeFile(metadataPath, `${metadataLines.join("\n")}\n`, "utf8");
	return { atlasPath, metadataPath };
}

export function formatNativeStaticLayoutZoomTelemetryLines(
	telemetry: NonNullable<NativeStaticLayoutExportOptions["zoomTelemetry"]>,
): string[] {
	return telemetry
		.filter((sample) => {
			return (
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.scale) &&
				Number.isFinite(sample.x) &&
				Number.isFinite(sample.y)
			);
		})
		.map((sample) => {
			const timeMs = Math.max(0, sample.timeMs);
			const scale = Math.max(0.01, sample.scale);
			const blurStrength = Number.isFinite(sample.blurStrength)
				? Math.max(0, sample.blurStrength ?? 0)
				: 0;
			const blurCenterX = Number.isFinite(sample.blurCenterX) ? (sample.blurCenterX ?? 0) : 0;
			const blurCenterY = Number.isFinite(sample.blurCenterY) ? (sample.blurCenterY ?? 0) : 0;
			return [
				formatCliNumber(timeMs),
				formatCliNumber(scale),
				formatCliNumber(sample.x),
				formatCliNumber(sample.y),
				formatCliNumber(blurStrength),
				formatCliNumber(blurCenterX),
				formatCliNumber(blurCenterY),
			].join(",");
		});
}

async function prepareWindowsGpuZoomTelemetry(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	const telemetry = options.zoomTelemetry;
	if (!telemetry || telemetry.length === 0) {
		return null;
	}

	const lines = formatNativeStaticLayoutZoomTelemetryLines(telemetry);

	if (lines.length === 0) {
		return null;
	}

	await fs.writeFile(outputPath, lines.join("\n"), "utf8");
	return outputPath;
}

function shouldCreateWindowsGpuWebcamProxy(filePath: string) {
	const extension = path.extname(filePath).toLowerCase();
	return extension !== ".mp4" && extension !== ".m4v" && extension !== ".mov";
}

function buildWindowsGpuWebcamProxyArgs(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
) {
	if (!options.webcamInputPath) {
		throw new Error("Windows GPU webcam proxy requires an input path");
	}

	const frameRate = Math.max(1, Math.round(options.frameRate));
	const proxyBitrate = Math.max(2_000_000, Math.min(6_000_000, Math.round(options.bitrate / 3)));
	return [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		options.webcamInputPath,
		"-map",
		"0:v:0",
		"-an",
		"-t",
		formatCliNumber(options.durationSec),
		"-vf",
		`scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=${frameRate}`,
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-tune",
		"zerolatency",
		"-b:v",
		String(proxyBitrate),
		"-maxrate",
		String(Math.round(proxyBitrate * 1.2)),
		"-bufsize",
		String(proxyBitrate * 2),
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		outputPath,
	];
}

async function prepareWindowsGpuWebcamInput(
	ffmpegPath: string,
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	session: NativeStaticLayoutExportSession,
) {
	if (!options.webcamInputPath || !shouldCreateWindowsGpuWebcamProxy(options.webcamInputPath)) {
		return { inputPath: options.webcamInputPath ?? null, elapsedMs: 0 };
	}

	const result = await runFfmpegWithMetrics(
		ffmpegPath,
		buildWindowsGpuWebcamProxyArgs(options, outputPath),
		Math.max(5 * 60 * 1000, options.durationSec * 1000),
		session,
	);
	if (!result.success) {
		throw new Error(getFfmpegFailureMessage(result));
	}

	return { inputPath: outputPath, elapsedMs: result.elapsedMs };
}

async function prepareNativeStaticLayoutSourceInput(
	ffmpegPath: string,
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	session: NativeStaticLayoutExportSession,
) {
	const metadata = await probeNativeVideoMetadata(ffmpegPath, options.inputPath);
	if (!shouldCreateNativeStaticLayoutSourceProxy(metadata, options.inputPath)) {
		return {
			inputPath: options.inputPath,
			elapsedMs: 0,
			sourceCodec: metadata.codec,
			proxyCreated: false,
		};
	}

	const sourceDurationSec = Math.max(
		0.001,
		metadata.streamDuration ?? metadata.duration ?? options.durationSec,
	);
	const result = await runFfmpegWithMetrics(
		ffmpegPath,
		buildNativeStaticLayoutSourceProxyArgs(options, outputPath, metadata),
		Math.max(5 * 60 * 1000, sourceDurationSec * 2000),
		session,
	);
	if (!result.success) {
		throw new Error(getFfmpegFailureMessage(result));
	}

	const proxyMetadata = await probeNativeVideoMetadata(ffmpegPath, outputPath);
	const validationIssues = validateNativeStaticLayoutSourceProxyMetadata(proxyMetadata, {
		sourceDurationSec,
	});
	if (validationIssues.length > 0) {
		throw new Error(`Native source proxy is invalid: ${validationIssues.join("; ")}`);
	}

	return {
		inputPath: outputPath,
		elapsedMs: result.elapsedMs,
		sourceCodec: metadata.codec,
		proxyCodec: proxyMetadata.codec,
		proxyCreated: true,
	};
}

export function buildNativeStaticLayoutOverlayManifest(
	layers: readonly NativeStaticLayoutOverlayLayer[],
) {
	return {
		layers: [...layers]
			.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
			.map((layer) => ({
				id: layer.id,
				path: layer.path,
				x: layer.x,
				y: layer.y,
				width: layer.width,
				height: layer.height,
				// frameCount stays the logical output duration; effectiveFrameCount
				// is the physical frame count the renderer wrote when identical-suffix
				// dedup truncated the sidecar. Absent when every frame differs.
				frameCount: layer.frameCount,
				...(layer.effectiveFrameCount !== undefined
					? { effectiveFrameCount: layer.effectiveFrameCount }
					: {}),
			})),
	};
}

export function getNativeStaticLayoutOverlayExpectedSidecarBytes(
	layer: NativeStaticLayoutOverlayLayer,
) {
	// Physical sidecar byte-size validation must use the physical frame count
	// (effectiveFrameCount when present), never the logical output duration
	// (frameCount), so deduped overlays are not rejected as truncated.
	const physicalFrameCount = layer.effectiveFrameCount ?? layer.frameCount;
	return (
		getNativeStaticLayoutOverlayFrameByteSize(layer.width, layer.height) * physicalFrameCount
	);
}

export function buildExperimentalNvidiaCudaStaticLayoutArgs(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	workDir: string,
) {
	const background = convertHexColorToNv12(options.backgroundColor);
	const backgroundBlurPx = Math.max(0, options.backgroundBlurPx ?? 0);
	const shadowIntensityPct = Math.round(clampUnit(options.shadowIntensity ?? 0) * 100);
	const shadowOffsetY =
		shadowIntensityPct > 0 ? Math.max(1, Math.round(options.height * 0.012)) : 0;
	const args = [
		"--input",
		options.inputPath,
		"--output",
		outputPath,
		"--work-dir",
		workDir,
		"--width",
		String(options.width),
		"--height",
		String(options.height),
		"--fps",
		String(Math.max(1, Math.round(options.frameRate))),
		"--bitrate-mbps",
		String(getNvidiaCudaBitrateMbps(options)),
		"--output-codec",
		options.videoCodec ?? "h264",
		"--encoding-mode",
		options.encodingMode,
		"--duration-sec",
		formatCliNumber(options.durationSec),
		"--stream-sync",
		"--prewarm-ms",
		process.env.RECORDLY_NVIDIA_CUDA_PREWARM_MS || "500",
		"--content-x",
		String(Math.round(options.offsetX)),
		"--content-y",
		String(Math.round(options.offsetY)),
		"--content-width",
		String(Math.round(options.contentWidth)),
		"--content-height",
		String(Math.round(options.contentHeight)),
		"--radius",
		String(Math.round(Math.max(0, options.borderRadius ?? 0))),
		"--background-y",
		String(background.y),
		"--background-u",
		String(background.u),
		"--background-v",
		String(background.v),
	];
	if (!canMuxNvidiaCudaSourceAudioInline(options)) {
		args.push("--video-only");
	}

	if (options.backgroundImagePath) {
		args.push("--background-image", options.backgroundImagePath);
	}
	if (
		Number.isFinite(options.sourceCropX) &&
		Number.isFinite(options.sourceCropY) &&
		Number.isFinite(options.sourceCropWidth) &&
		Number.isFinite(options.sourceCropHeight) &&
		(options.sourceCropWidth ?? 0) >= 2 &&
		(options.sourceCropHeight ?? 0) >= 2
	) {
		args.push(
			"--source-crop-x",
			String(Math.round(options.sourceCropX ?? 0)),
			"--source-crop-y",
			String(Math.round(options.sourceCropY ?? 0)),
			"--source-crop-width",
			String(Math.round(options.sourceCropWidth ?? 0)),
			"--source-crop-height",
			String(Math.round(options.sourceCropHeight ?? 0)),
		);
	}
	if (backgroundBlurPx > 0) {
		args.push("--background-blur", formatCliNumber(backgroundBlurPx));
	}
	if (shadowOffsetY > 0 && shadowIntensityPct > 0) {
		args.push(
			"--shadow-offset-y",
			String(shadowOffsetY),
			"--shadow-intensity-pct",
			String(shadowIntensityPct),
		);
	}
	if (options.webcamInputPath && (options.webcamSize ?? 0) > 0) {
		args.push(
			"--webcam-input",
			options.webcamInputPath,
			"--webcam-x",
			String(Math.round(options.webcamLeft ?? 0)),
			"--webcam-y",
			String(Math.round(options.webcamTop ?? 0)),
			"--webcam-size",
			String(Math.round(options.webcamSize ?? 0)),
			"--webcam-radius",
			String(Math.round(Math.max(0, options.webcamRadius ?? 0))),
			"--webcam-time-offset-ms",
			formatCliNumber(options.webcamTimeOffsetMs ?? 0),
			"--webcam-stream",
		);
		if (options.webcamMirror !== false) {
			args.push("--webcam-mirror");
		}
	}
	if (options.cursorTelemetryPath) {
		args.push(
			"--cursor-json",
			options.cursorTelemetryPath,
			"--cursor-height",
			String(Math.round(Math.max(1, options.cursorSize ?? 84))),
			"--cursor-style",
			"external",
		);
		if (options.cursorAtlasPath && options.cursorAtlasMetadataPath) {
			args.push(
				"--cursor-atlas-png",
				options.cursorAtlasPath,
				"--cursor-atlas-metadata",
				options.cursorAtlasMetadataPath,
			);
		}
	}
	if (options.zoomTelemetryPath) {
		args.push("--zoom-telemetry", options.zoomTelemetryPath);
	}
	if (options.temporalBlur && options.temporalBlur.sampleCount >= 3) {
		args.push(
			"--temporal-blur-sample-count",
			String(Math.round(options.temporalBlur.sampleCount)),
			"--temporal-blur-shutter-fraction",
			formatCliNumber(options.temporalBlur.shutterFraction),
			"--temporal-blur-weight-power",
			formatCliNumber(options.temporalBlur.weightCurvePower),
		);
	}
	if (options.overlayManifestPath) {
		args.push("--overlay-manifest", options.overlayManifestPath);
	}
	if (options.timelineMapPath) {
		args.push("--timeline-map", options.timelineMapPath);
	}
	if (process.env.RECORDLY_NVIDIA_CUDA_SAMPLE_GPU === "1") {
		args.push("--sample-gpu");
	}

	return args;
}

function canMuxNvidiaCudaSourceAudioInline(options: NativeStaticLayoutExportOptions) {
	if (options.nvidiaCudaForceVideoOnly) {
		return false;
	}

	const audioOptions = options.audioOptions;
	if (audioOptions?.audioMode !== "copy-source" || !audioOptions.audioSourcePath) {
		return false;
	}

	return path.resolve(audioOptions.audioSourcePath) === path.resolve(options.inputPath);
}

async function runExperimentalNvidiaCudaStaticLayoutExport(
	ffmpegPath: string,
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	chunkDirectory: string,
	session: NativeStaticLayoutExportSession,
	onProgress?: (progress: NativeStaticLayoutExportProgress) => void,
) {
	const scriptPath = await resolveExperimentalNvidiaCudaExportScriptPath();
	if (!scriptPath) {
		throw new Error("Experimental NVIDIA CUDA export script is not available");
	}

	const nodeCommand = resolveExperimentalNvidiaCudaNodeCommand();
	const workDir = path.join(chunkDirectory, "nvidia-cuda-work");
	let effectiveOptions = options;
	if (options.overlayLayers?.length) {
		const overlayManifestPath = path.join(chunkDirectory, "overlay-manifest.json");
		await fs.writeFile(
			overlayManifestPath,
			JSON.stringify(buildNativeStaticLayoutOverlayManifest(options.overlayLayers)),
			"utf8",
		);
		effectiveOptions = {
			...options,
			overlayManifestPath,
		};
		if (options.cursorAtlasOwned !== true) {
			// Overlay sidecars already contain the renderer-baked cursor; the
			// Windows GPU prep may have left CSV telemetry/atlas paths on the
			// options and the CUDA wrapper JSON.parses --cursor-json (a CSV file
			// crashes it). Strip the cursor assets so the wrapper is never handed
			// a malformed cursor file and never double-renders the baked cursor.
			// When cursorAtlasOwned is true the sidecar excluded cursor pixels, so
			// the prepared JSON telemetry/atlas assets pass through untouched and
			// the wrapper draws the cursor natively.
			effectiveOptions = {
				...effectiveOptions,
				...resolveNvidiaCudaCursorAssets(effectiveOptions, true),
			};
		}
	}
	const args = [
		scriptPath,
		...buildExperimentalNvidiaCudaStaticLayoutArgs(effectiveOptions, outputPath, workDir),
	];
	const startedAt = getNowMs();
	const startedAtIso = new Date().toISOString();
	const timeoutMs = Math.max(20 * 60 * 1000, options.durationSec * 2000);
	const stallTimeoutMs = getNvidiaCudaAutoStallTimeoutMs(
		isValidatedNvidiaCudaFallbackCandidate(options),
	);
	const ffmpegDirectory = path.dirname(ffmpegPath);
	const pathKey = process.platform === "win32" ? "Path" : "PATH";
	const env = {
		...process.env,
		...nodeCommand.env,
		RECORDLY_NVIDIA_CUDA_EXPORT_HIGH_PRIORITY:
			process.env.RECORDLY_NVIDIA_CUDA_EXPORT_HIGH_PRIORITY ?? "1",
		RECORDLY_FFMPEG_EXE: ffmpegPath,
		RECORDLY_FFPROBE_EXE: process.env.RECORDLY_FFPROBE_EXE ?? getFfprobeBinaryPath(),
		[pathKey]: `${ffmpegDirectory}${path.delimiter}${process.env[pathKey] ?? ""}`,
	};
	const powerGuard = startNativeStaticLayoutExportPowerGuard();

	return await new Promise<{
		elapsedMs: number;
		stdout: string;
		stderr: string;
		summary: NvidiaCudaExportSummary;
	}>((resolve, reject) => {
		const child = spawn(nodeCommand.command, args, {
			env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const childPriorityApplied = setNativeStaticLayoutExportProcessPriority(
			child.pid,
			"NVIDIA CUDA export wrapper",
		);
		console.info("[native-static-layout-export] NVIDIA CUDA runtime guard started", {
			childPriorityApplied,
			powerGuardStarted: powerGuard.started,
		});
		session.currentProcess = child;
		if (session.terminating) {
			child.kill("SIGKILL");
		}

		let stdout = "";
		let stderr = "";
		let stderrLineBuffer = "";
		let lastProgressPercentage = 0;
		let lastProgressForStallGuard: {
			currentFrame: number;
			percentage: number;
			stage?: string;
		} = { currentFrame: -1, percentage: -1 };
		let stallTimedOut = false;
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			child.kill("SIGKILL");
		}, timeoutMs);
		let stallTimeout: ReturnType<typeof setTimeout> | null = null;
		const clearStallTimeout = () => {
			if (stallTimeout) {
				clearTimeout(stallTimeout);
				stallTimeout = null;
			}
		};
		const armStallTimeout = () => {
			if (!stallTimeoutMs) {
				return;
			}
			clearStallTimeout();
			stallTimeout = setTimeout(() => {
				if (settled) return;
				stallTimedOut = true;
				child.kill("SIGKILL");
			}, stallTimeoutMs);
		};
		armStallTimeout();

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			stderrLineBuffer += text;
			const lines = stderrLineBuffer.split(/\r?\n/);
			stderrLineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const progress = parseWindowsGpuExportProgressLine(line);
				if (!progress) {
					continue;
				}
				const elapsedMs = Math.max(0, getNowMs() - startedAt);
				const fpsFields = resolveNativeStaticLayoutFpsFields(progress, elapsedMs);
				if (fpsFields.fpsSource === "estimated") {
					console.warn(
						"[native-static-layout-export] Native helper has not reported measured encode FPS; using preparation-inclusive estimate",
						{
							backend: "nvidia-cuda-compositor",
							estimatedFps: fpsFields.estimatedFps,
							currentFrame: progress.currentFrame,
							elapsedMs,
						},
					);
				}
				const mappedPercentage = mapNvidiaCudaWrapperProgressPercentage(progress);
				lastProgressPercentage = Math.max(lastProgressPercentage, mappedPercentage);
				const progressForStallGuard = {
					currentFrame: progress.currentFrame,
					percentage: mappedPercentage,
					stage: progress.stage,
				};
				if (
					hasNativeStaticLayoutProgressAdvanced(
						progressForStallGuard,
						lastProgressForStallGuard,
					)
				) {
					lastProgressForStallGuard = progressForStallGuard;
					armStallTimeout();
				}
				onProgress?.({
					...progress,
					percentage: lastProgressPercentage,
					sessionId: options.sessionId,
					backend: "nvidia-cuda-compositor",
					elapsedMs,
					...fpsFields,
				});
			}
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			if (session.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			clearStallTimeout();
			powerGuard.release();
			reject(error);
		});
		child.once("close", async (code, signal) => {
			if (settled) return;
			settled = true;
			if (session.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			clearStallTimeout();
			powerGuard.release();

			if (session.terminating) {
				reject(new Error("Native static layout export was cancelled"));
				return;
			}

			const elapsedMs = getNowMs() - startedAt;
			const summary = parseNvidiaCudaExportSummary(stdout);
			if (summary) {
				summary.appRuntimeGuard = {
					powerGuardStarted: powerGuard.started,
					wrapperProcessPriorityBoosted: childPriorityApplied,
					nativeProcessPriorityBoosted: summary.nativeProcessPriorityBoosted,
				};
			}
			await Promise.allSettled([
				fs.writeFile(path.join(chunkDirectory, "nvidia-cuda-export.stdout.json"), stdout),
				fs.writeFile(path.join(chunkDirectory, "nvidia-cuda-export.stderr.log"), stderr),
				summary
					? fs.writeFile(
							path.join(chunkDirectory, "nvidia-cuda-export.summary.json"),
							`${JSON.stringify(summary, null, 2)}\n`,
						)
					: Promise.resolve(),
			]);
			await persistNvidiaCudaExportDiagnostics({
				args,
				code,
				elapsedMs,
				outputPath,
				sessionId: options.sessionId,
				signal,
				startedAtIso,
				stderr,
				stdout,
				summary,
				timedOut: stallTimedOut,
			});
			if (code !== 0 || !summary?.success) {
				const suffix = signal ? ` (signal ${signal})` : "";
				reject(
					new Error(
						(stallTimedOut && stallTimeoutMs
							? `Experimental NVIDIA CUDA exporter stalled for ${stallTimeoutMs}ms without progress`
							: stderr.trim()) ||
							stdout.trim() ||
							`Experimental NVIDIA CUDA exporter exited with code ${code ?? "unknown"}${suffix}`,
					),
				);
				return;
			}

			resolve({
				elapsedMs,
				stdout,
				stderr,
				summary,
			});
		});
	});
}

async function runExperimentalWindowsGpuStaticLayoutExport(
	options: NativeStaticLayoutExportOptions,
	outputPath: string,
	session: NativeStaticLayoutExportSession,
	onProgress?: (progress: NativeStaticLayoutExportProgress) => void,
) {
	const executablePath = await resolveExperimentalWindowsGpuExporterPath();
	if (!executablePath) {
		throw new Error("Experimental Windows GPU exporter is not built");
	}

	const args = buildExperimentalWindowsGpuStaticLayoutArgs(options, outputPath);
	const startedAt = getNowMs();
	const startedAtIso = new Date().toISOString();
	const timeoutMs = Math.max(15 * 60 * 1000, options.durationSec * 1000);
	const stallTimeoutMs = getNativeGpuCompositorStallTimeoutMs();

	return await new Promise<{
		elapsedMs: number;
		stdout: string;
		stderr: string;
		summary: WindowsGpuExportSummary;
	}>((resolve, reject) => {
		const child = spawn(executablePath, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		session.currentProcess = child;
		if (session.terminating) {
			child.kill("SIGKILL");
		}

		let stdout = "";
		let stderr = "";
		let stderrLineBuffer = "";
		let lastProgressForStallGuard: {
			currentFrame: number;
			percentage: number;
			stage?: string;
		} = { currentFrame: -1, percentage: -1 };
		let stallTimedOut = false;
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			child.kill("SIGKILL");
		}, timeoutMs);
		let stallTimeout: ReturnType<typeof setTimeout> | null = null;
		const clearStallTimeout = () => {
			if (stallTimeout) {
				clearTimeout(stallTimeout);
				stallTimeout = null;
			}
		};
		const armStallTimeout = () => {
			if (!stallTimeoutMs) {
				return;
			}
			clearStallTimeout();
			stallTimeout = setTimeout(() => {
				if (settled) return;
				stallTimedOut = true;
				child.kill("SIGKILL");
			}, stallTimeoutMs);
		};
		armStallTimeout();

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			stderr += text;
			stderrLineBuffer += text;
			const lines = stderrLineBuffer.split(/\r?\n/);
			stderrLineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const progress = parseWindowsGpuExportProgressLine(line);
				if (!progress) {
					continue;
				}
				if (hasNativeStaticLayoutProgressAdvanced(progress, lastProgressForStallGuard)) {
					lastProgressForStallGuard = {
						currentFrame: progress.currentFrame,
						percentage: progress.percentage,
						stage: progress.stage,
					};
					armStallTimeout();
				}
				const elapsedMs = Math.max(0, getNowMs() - startedAt);
				const fpsFields = resolveNativeStaticLayoutFpsFields(progress, elapsedMs);
				onProgress?.({
					...progress,
					sessionId: options.sessionId,
					backend: "windows-d3d11-compositor",
					elapsedMs,
					...fpsFields,
				});
			}
		});
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			if (session.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			clearStallTimeout();
			reject(error);
		});
		child.once("close", async (code, signal) => {
			if (settled) return;
			settled = true;
			if (session.currentProcess === child) {
				session.currentProcess = null;
			}
			clearTimeout(timeout);
			clearStallTimeout();

			if (session.terminating) {
				reject(new Error("Native static layout export was cancelled"));
				return;
			}

			const elapsedMs = getNowMs() - startedAt;
			const summary = parseWindowsGpuExportSummary(stdout);
			await persistWindowsGpuExportDiagnostics({
				args,
				code,
				elapsedMs,
				outputPath,
				signal,
				startedAtIso,
				stderr,
				stdout,
				summary,
				timedOut: stallTimedOut,
			});

			if (code !== 0 || !summary?.success) {
				const suffix = signal ? ` (signal ${signal})` : "";
				reject(
					new Error(
						(stallTimedOut && stallTimeoutMs
							? `Experimental Windows GPU exporter stalled for ${stallTimeoutMs}ms without progress`
							: stderr.trim()) ||
							stdout.trim() ||
							`Experimental Windows GPU exporter exited with code ${code ?? "unknown"}${suffix}`,
					),
				);
				return;
			}

			resolve({
				elapsedMs,
				stdout,
				stderr,
				summary,
			});
		});
	});
}

export async function exportNativeStaticLayoutVideo(
	ffmpegPath: string,
	options: NativeStaticLayoutExportOptions,
	onProgress?: (progress: NativeStaticLayoutExportProgress) => void,
): Promise<NativeStaticLayoutExportResult> {
	const videoCodec = options.videoCodec ?? "h264";
	const encoderPreference = options.encoderPreference ?? "auto";
	if (videoCodec !== "h264" && videoCodec !== "hevc") {
		throw new Error(`Unsupported native static-layout video codec: ${String(videoCodec)}`);
	}
	if (
		encoderPreference !== "auto" &&
		encoderPreference !== "hardware" &&
		encoderPreference !== "cpu"
	) {
		throw new Error(
			`Unsupported native static-layout encoder preference: ${String(encoderPreference)}`,
		);
	}
	options = { ...options, videoCodec, encoderPreference };
	const rawFrameFallbackReason = getNativeStaticLayoutRawFrameFallbackReason(options);
	if (rawFrameFallbackReason) {
		throw new Error(
			`Native static-layout export requires the native rawvideo route: ${rawFrameFallbackReason}`,
		);
	}

	if (options.width % 2 !== 0 || options.height % 2 !== 0) {
		throw new Error("Native static layout export requires even output dimensions");
	}
	if (!Number.isFinite(options.durationSec) || options.durationSec <= 0) {
		throw new Error("Native static layout export requires a positive duration");
	}
	if (options.overlayLayers?.length) {
		for (const layer of sortNativeStaticLayoutOverlayLayers(options.overlayLayers)) {
			const validationError = validateNativeStaticLayoutOverlayLayer(layer, {
				outputWidth: options.width,
				outputHeight: options.height,
				durationSec: options.durationSec,
				frameRate: options.frameRate,
			});
			if (validationError) {
				throw new Error(`Invalid native overlay layer: ${validationError}`);
			}
			const stat = await fs.stat(layer.path);
			const expectedBytes = getNativeStaticLayoutOverlayExpectedSidecarBytes(layer);
			if (stat.size < expectedBytes) {
				throw new Error(
					`Native overlay layer ${layer.id} is truncated: expected ${expectedBytes} bytes, received ${stat.size}`,
				);
			}
		}
	}
	if (
		options.cursorAtlasOwned === true &&
		!(
			options.experimentalWindowsGpuCompositor &&
			process.platform === "win32" &&
			(options.experimentalNvidiaCudaExport === true || isExplicitNvidiaCudaExportEnabled())
		)
	) {
		// The renderer excluded cursor pixels from the overlay sidecar because
		// the native atlas owns them. Only the generalized NVIDIA CUDA compositor
		// can draw that atlas on top of the sidecars; the FFmpeg overlay route
		// and the D3D11 helper cannot, so refusing the fallback is the only way
		// to avoid silently dropping the cursor.
		throw new Error(
			"Cursor ownership by the native atlas requires the generalized NVIDIA CUDA compositor on Windows; the FFmpeg overlay route cannot draw the cursor and the overlay sidecar excluded it.",
		);
	}
	options = await normalizeNativeStaticLayoutBackground(options);
	const nativeVideoEncoder = await resolveNativeVideoEncoder(
		ffmpegPath,
		options.encodingMode,
		videoCodec,
		encoderPreference,
	);
	if (
		options.webcamInputPath &&
		!(options.experimentalWindowsGpuCompositor && process.platform === "win32")
	) {
		throw new Error("Native webcam overlay requires the Windows GPU compositor");
	}
	if (
		options.zoomTelemetry?.length &&
		!(options.experimentalWindowsGpuCompositor && process.platform === "win32")
	) {
		throw new Error("Native zoom telemetry requires the Windows GPU compositor");
	}

	const chunkDurationSec = Math.max(1, Math.min(300, options.chunkDurationSec ?? 120));
	const chunks = buildNativeStaticLayoutChunks(options.durationSec, chunkDurationSec);
	if (chunks.length === 0) {
		throw new Error("Native static layout export produced no chunks");
	}

	const sessionId =
		options.sessionId ??
		`recordly-static-layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const session: NativeStaticLayoutExportSession = {
		terminating: false,
		currentProcess: null,
	};
	const chunkDirectory = path.join(app.getPath("temp"), sessionId);
	const concatListPath = path.join(chunkDirectory, "chunks.txt");
	const videoOnlyPath = path.join(app.getPath("temp"), `${sessionId}.mp4`);
	const ffprobePath = getFfprobeBinaryPath();
	let outputPathToKeep: string | null = null;
	let videoOutputValidated = false;
	const metrics: NativeStaticLayoutExportMetrics = {
		chunkCount: chunks.length,
		chunkDurationSec,
		chunkExecMs: 0,
		fallbackChunkCount: 0,
		chunks: [],
	};
	const validateRenderedVideoOutput = async () => {
		await validateNativeVideoOutputFile(ffprobePath, videoOnlyPath, {
			durationSec: options.durationSec,
			targetFrames: Math.ceil(options.durationSec * options.frameRate),
		});
		videoOutputValidated = true;
	};

	try {
		nativeStaticLayoutExportSessions.set(sessionId, session);
		await fs.mkdir(chunkDirectory, { recursive: true });
		const sourceInput = await prepareNativeStaticLayoutSourceInput(
			ffmpegPath,
			options,
			path.join(chunkDirectory, "source-proxy.mp4"),
			session,
		);
		if (sourceInput.elapsedMs > 0) {
			metrics.staticAssetExecMs = (metrics.staticAssetExecMs ?? 0) + sourceInput.elapsedMs;
		}
		if (sourceInput.inputPath !== options.inputPath) {
			console.info("[native-static-layout-export] Prepared H.264 source proxy", {
				sourceCodec: sourceInput.sourceCodec,
				proxyCodec: sourceInput.proxyCodec,
				elapsedMs: sourceInput.elapsedMs,
			});
			options = {
				...options,
				inputPath: sourceInput.inputPath,
			};
		}
		const timelineMapPath = await prepareNativeStaticLayoutTimelineMap(
			options,
			path.join(chunkDirectory, "timeline-map.csv"),
		);
		if (timelineMapPath) {
			if (!(options.experimentalWindowsGpuCompositor && process.platform === "win32")) {
				throw new Error("Native timeline-map export requires the Windows GPU compositor");
			}
			options = {
				...options,
				timelineMapPath,
			};
		}
		const fullConfig: NativeStaticLayoutExportArgsConfig = {
			inputPath: options.inputPath,
			outputPath: videoOnlyPath,
			videoCodec,
			width: options.width,
			height: options.height,
			frameRate: options.frameRate,
			bitrate: options.bitrate,
			encodingMode: options.encodingMode,
			contentWidth: options.contentWidth,
			contentHeight: options.contentHeight,
			offsetX: options.offsetX,
			offsetY: options.offsetY,
			sourceCropX: options.sourceCropX,
			sourceCropY: options.sourceCropY,
			sourceCropWidth: options.sourceCropWidth,
			sourceCropHeight: options.sourceCropHeight,
			backgroundColor: options.backgroundColor,
			backgroundImagePath: options.backgroundImagePath,
			backgroundBlurPx: options.backgroundBlurPx,
			borderRadius: options.borderRadius,
			shadowIntensity: options.shadowIntensity,
			durationSec: options.durationSec,
			overlayLayers: options.overlayLayers,
			videoEncoder: nativeVideoEncoder,
		};
		const usePrecompositedLayout = shouldUsePrecompositedStaticLayout(options);
		let didRenderVideo = false;
		let didMuxAudioInline = false;

		if (
			options.experimentalWindowsGpuCompositor &&
			process.platform === "win32" &&
			// The generalized NVIDIA CUDA compositor composites renderer-prepared
			// overlay sidecars natively; the Windows D3D11 helper cannot, so it is
			// skipped below when overlay layers are present.
			(options.overlayLayers?.length === 0 ||
				options.experimentalNvidiaCudaExport === true ||
				isExplicitNvidiaCudaExportEnabled())
		) {
			try {
				if (session.terminating) {
					throw new Error("Native static layout export was cancelled");
				}
				let experimentalGpuOptions = options;
				if (options.webcamInputPath) {
					const webcamProxyPath = path.join(chunkDirectory, "webcam-proxy.mp4");
					const webcamInput = await prepareWindowsGpuWebcamInput(
						ffmpegPath,
						options,
						webcamProxyPath,
						session,
					);
					if (webcamInput.elapsedMs > 0) {
						metrics.staticAssetExecMs =
							(metrics.staticAssetExecMs ?? 0) + webcamInput.elapsedMs;
					}
					if (
						webcamInput.inputPath &&
						webcamInput.inputPath !== options.webcamInputPath
					) {
						experimentalGpuOptions = {
							...options,
							webcamInputPath: webcamInput.inputPath,
						};
					}
				}
				if (options.cursorTelemetry?.length) {
					const cursorTelemetryPath = await prepareWindowsGpuCursorTelemetry(
						options,
						path.join(chunkDirectory, "cursor-telemetry.csv"),
					);
					if (cursorTelemetryPath) {
						experimentalGpuOptions = {
							...experimentalGpuOptions,
							cursorTelemetryPath,
						};
					}
					const cursorAtlas = await prepareWindowsGpuCursorAtlas(
						options,
						path.join(chunkDirectory, "cursor-atlas.png"),
						path.join(chunkDirectory, "cursor-atlas.csv"),
					);
					if (cursorAtlas) {
						experimentalGpuOptions = {
							...experimentalGpuOptions,
							cursorAtlasPath: cursorAtlas.atlasPath,
							cursorAtlasMetadataPath: cursorAtlas.metadataPath,
						};
					}
				}
				if (options.zoomTelemetry?.length) {
					const zoomTelemetryPath = await prepareWindowsGpuZoomTelemetry(
						options,
						path.join(chunkDirectory, "zoom-telemetry.csv"),
					);
					if (zoomTelemetryPath) {
						experimentalGpuOptions = {
							...experimentalGpuOptions,
							zoomTelemetryPath,
						};
					}
				}
				let experimentalNvidiaCudaOptions = experimentalGpuOptions;
				const nvidiaCudaSkipReason =
					await getExperimentalNvidiaCudaExportSkipReason(options);
				let shouldTryNvidiaCuda = nvidiaCudaSkipReason === null;
				const requiresStrictHevcCuda =
					options.videoCodec === "hevc" && options.encoderPreference === "hardware";
				const validatedCudaFallbackCandidate =
					isValidatedNvidiaCudaFallbackCandidate(options);
				if (
					shouldTryNvidiaCuda &&
					(validatedCudaFallbackCandidate || isNvidiaCudaForceVideoOnlyEnabled()) &&
					(experimentalNvidiaCudaOptions.audioOptions?.audioMode ?? "none") !== "none"
				) {
					experimentalNvidiaCudaOptions = {
						...experimentalNvidiaCudaOptions,
						nvidiaCudaForceVideoOnly: true,
					};
					console.info(
						"[native-static-layout-export] NVIDIA CUDA candidate will use shared audio mux validation",
						{
							audioMode:
								experimentalNvidiaCudaOptions.audioOptions?.audioMode ?? "none",
							forcedByEnv: isNvidiaCudaForceVideoOnlyEnabled(),
							userOptIn: options.experimentalNvidiaCudaExport === true,
						},
					);
				}
				const shouldLogNvidiaCudaSkip =
					isExplicitNvidiaCudaExportEnabled() ||
					(options.experimentalNvidiaCudaExport === true &&
						nvidiaCudaSkipReason !== "env-disabled");
				if (
					!shouldTryNvidiaCuda &&
					shouldLogNvidiaCudaSkip &&
					nvidiaCudaSkipReason !== "env-disabled"
				) {
					console.warn(
						"[native-static-layout-export] Skipping NVIDIA CUDA compositor; falling back to Windows GPU compositor",
						{
							reason: nvidiaCudaSkipReason,
							audioMode: options.audioOptions?.audioMode ?? "none",
							overrideEnv: NVIDIA_CUDA_ALLOW_AUDIO_EXPORT_ENV,
							userOptIn: options.experimentalNvidiaCudaExport === true,
						},
					);
				}
				if (
					!shouldTryNvidiaCuda &&
					((options.overlayLayers?.length &&
						(options.zoomTelemetry?.length || options.cursorAtlasOwned === true)) ||
						options.temporalBlur)
				) {
					throw new Error(
						`CUDA composition is unavailable (${nvidiaCudaSkipReason ?? "unknown"}) while zoom motion blur${options.cursorAtlasOwned === true ? ", a native-owned cursor," : ""} and/or temporal zoom motion blur (${options.temporalBlur?.sampleCount ?? "n/a"} samples) are requested; the FFmpeg overlay route cannot preserve these effects${options.cursorAtlasOwned === true ? " and cannot draw the cursor the sidecar excluded" : ""}.`,
					);
				}
				if (options.cursorAtlasOwned === true && !options.cursorTelemetry?.length) {
					throw new Error(
						"Native cursor atlas ownership requires cursor telemetry; refusing to drop the cursor on a fallback route.",
					);
				}
				if (shouldTryNvidiaCuda && options.cursorTelemetry?.length) {
					if (options.overlayLayers?.length && options.cursorAtlasOwned !== true) {
						// When overlay layers are present and the cursor is baked into the
						// transparent sidecar, drawing it again natively would double-render
						// and the atlas is intentionally absent. The Windows-GPU prep above
						// left CSV telemetry/atlas paths on the options; strip them so the
						// CUDA wrapper is never handed a CSV "cursor JSON" file (it
						// JSON.parses the path and crashes) and never double-renders the
						// baked cursor.
						experimentalNvidiaCudaOptions = {
							...experimentalNvidiaCudaOptions,
							...resolveNvidiaCudaCursorAssets(experimentalNvidiaCudaOptions, true),
						};
						shouldTryNvidiaCuda = true;
					} else {
						// No overlay layers, or the renderer excluded cursor pixels from
						// the overlay sidecar (cursorAtlasOwned): the CUDA compositor
						// draws the native atlas cursor on top of the composed video.
						const cursorTelemetryPath = await prepareNvidiaCudaCursorTelemetry(
							options,
							path.join(chunkDirectory, "cursor-telemetry.json"),
						);
						const cursorAtlas = await prepareNvidiaCudaCursorAtlas(
							options,
							path.join(chunkDirectory, "cursor-atlas-nvidia.png"),
							path.join(chunkDirectory, "cursor-atlas-nvidia.tsv"),
						);
						if (
							options.cursorAtlasOwned === true &&
							(!cursorTelemetryPath || !cursorAtlas)
						) {
							throw new Error(
								"Native cursor atlas ownership could not prepare cursor telemetry/atlas assets; refusing to drop the cursor on the FFmpeg overlay route.",
							);
						}
						shouldTryNvidiaCuda = Boolean(cursorTelemetryPath && cursorAtlas);
						if (cursorTelemetryPath && cursorAtlas) {
							experimentalNvidiaCudaOptions = {
								...experimentalNvidiaCudaOptions,
								cursorTelemetryPath,
								cursorAtlasPath: cursorAtlas.atlasPath,
								cursorAtlasMetadataPath: cursorAtlas.metadataPath,
							};
						}
					}
				}
				if (requiresStrictHevcCuda && !shouldTryNvidiaCuda) {
					throw new Error(
						`HEVC Hardware export requires the NVIDIA CUDA compositor; refusing fallback (${nvidiaCudaSkipReason ?? "cursor-atlas-unavailable"}) (noCpuFallback:true)`,
					);
				}

				if (shouldTryNvidiaCuda) {
					try {
						const shouldMuxAudioInline = canMuxNvidiaCudaSourceAudioInline(
							experimentalNvidiaCudaOptions,
						);
						const cudaResult = await runExperimentalNvidiaCudaStaticLayoutExport(
							ffmpegPath,
							experimentalNvidiaCudaOptions,
							videoOnlyPath,
							chunkDirectory,
							session,
							onProgress,
						);
						const cudaValidationIssues = validateNvidiaCudaExportSummary(
							cudaResult.summary,
							{
								durationSec: options.durationSec,
								targetFrames: Math.ceil(options.durationSec * options.frameRate),
								requiresTimelineSync: shouldMuxAudioInline,
								videoCodec,
							},
						);
						if (cudaValidationIssues.length > 0) {
							throw new Error(
								`Experimental NVIDIA CUDA compositor produced an invalid output: ${cudaValidationIssues.join("; ")}`,
							);
						}
						const outputStat = await fs.stat(videoOnlyPath);
						if (outputStat.size <= 0) {
							throw new Error(
								"Experimental NVIDIA CUDA compositor produced an empty output file",
							);
						}
						await validateRenderedVideoOutput();
						const overlaySidecarMetrics =
							resolveNvidiaCudaOverlaySidecarSummaryMetrics(options);
						if (overlaySidecarMetrics && cudaResult.summary.nativeSummary) {
							// Additive renderer-derived overlay sidecar metrics ride on the
							// parsed native summary so the completion log and chunk metrics
							// surface them without changing the helper contract.
							cudaResult.summary.nativeSummary = {
								...cudaResult.summary.nativeSummary,
								...overlaySidecarMetrics,
							};
						}
						const nativeSummaryMetrics = resolveNvidiaCudaNativeSummaryMetrics(
							cudaResult.summary.nativeSummary,
						);
						console.info(
							"[native-static-layout-export] NVIDIA CUDA compositor completed",
							{
								elapsedMs: cudaResult.elapsedMs,
								fps: cudaResult.summary.fps,
								targetFrames: cudaResult.summary.targetFrames,
								durationSec: cudaResult.summary.durationSec,
								// timingsMs.nativeEncode is the full native helper-process wall
								// time (spawn to exit: source decode, layout composition, NVENC,
								// flush). It is NOT the NVENC-API encode time, which is
								// reported separately as nativeSummary.nvencMs.
								nativeEncodeWallMs: cudaResult.summary.timingsMs?.nativeEncode,
								nativeEncodeMs: cudaResult.summary.timingsMs?.nativeEncode,
								muxMs: cudaResult.summary.timingsMs?.mux,
								endToEndMs: cudaResult.summary.timingsMs?.endToEnd,
								nativeFps: resolveNvidiaCudaNativeFps(cudaResult.summary),
								mappedDisplayFrames:
									cudaResult.summary.nativeSummary?.mappedDisplayFrames,
								selectedDisplayFrames:
									cudaResult.summary.nativeSummary?.selectedDisplayFrames,
								skippedDisplayFrames:
									cudaResult.summary.nativeSummary?.skippedDisplayFrames,
								roiCompositeFrames:
									cudaResult.summary.nativeSummary?.roiCompositeFrames,
								monolithicCompositeFrames:
									cudaResult.summary.nativeSummary?.monolithicCompositeFrames,
								copyCompositeFrames:
									cudaResult.summary.nativeSummary?.copyCompositeFrames,
								webcamOverlay: cudaResult.summary.nativeSummary?.webcamOverlay,
								cursorAtlas: cudaResult.summary.nativeSummary?.cursorAtlas,
								zoomOverlay: cudaResult.summary.nativeSummary?.zoomOverlay,
								zoomSamples: cudaResult.summary.nativeSummary?.zoomSamples,
								overlayLayers: cudaResult.summary.nativeSummary?.overlayLayers,
								...nativeSummaryMetrics,
								// The helper does not echo the configured temporal blur sample
								// count in its summary yet; fall back to the renderer-resolved
								// export plan so the log still exposes the requested count.
								temporalBlurSampleCount:
									nativeSummaryMetrics.temporalBlurSampleCount ??
									options.temporalBlur?.sampleCount,
								metricInvariants: validateNvidiaCudaStageMetricInvariants(
									cudaResult.summary,
								),
							},
						);
						metrics.chunkCount = 1;
						metrics.chunkDurationSec = options.durationSec;
						metrics.chunkExecMs += cudaResult.elapsedMs;
						metrics.chunks.push({
							index: 0,
							startSec: 0,
							durationSec: options.durationSec,
							backend: "nvidia-cuda-compositor",
							elapsedMs: cudaResult.elapsedMs,
							outputBytes: outputStat.size,
							nvidiaCudaSummary: cudaResult.summary,
						});
						didRenderVideo = true;
						didMuxAudioInline = shouldMuxAudioInline;
					} catch (error) {
						if (session.terminating) {
							throw error;
						}
						if (requiresStrictHevcCuda) {
							throw new Error(
								`HEVC Hardware NVIDIA CUDA compositor failed; refusing CPU, rawvideo, Breeze, or FFmpeg CUDA fallback (noCpuFallback:true): ${error instanceof Error ? error.message : String(error)}`,
							);
						}
						metrics.fallbackChunkCount++;
						console.warn(
							"[native-static-layout-export] Experimental NVIDIA CUDA compositor failed or produced invalid output; falling back to Windows GPU compositor:",
							error,
						);
						await removeTemporaryExportFile(videoOnlyPath);
						if (
							(options.overlayLayers?.length &&
								(options.zoomTelemetry?.length ||
									options.cursorAtlasOwned === true)) ||
							options.temporalBlur
						) {
							// Neither the D3D11 helper nor the FFmpeg overlay route can
							// preserve spatial zoom blur over the transparent overlay
							// sidecars, temporal zoom motion blur, or a native-owned cursor
							// whose pixels the sidecar excluded; surface the failure so the
							// renderer falls back to raw frames instead of silently dropping
							// the effect.
							throw new Error(
								`CUDA composition failed while zoom motion blur${options.temporalBlur ? ` (temporal ${options.temporalBlur.sampleCount} samples)` : ""}${options.cursorAtlasOwned === true ? ", a native-owned cursor" : ""} and ${options.overlayLayers?.length ?? 0} overlay layer(s) are requested: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					}
				}

				if (!didRenderVideo && videoCodec !== "hevc" && !options.overlayLayers?.length) {
					const gpuResult = await runExperimentalWindowsGpuStaticLayoutExport(
						experimentalGpuOptions,
						videoOnlyPath,
						session,
						onProgress,
					);
					const gpuValidationIssues = validateWindowsGpuExportSummary(gpuResult.summary, {
						durationSec: options.durationSec,
						targetFrames: Math.ceil(options.durationSec * options.frameRate),
					});
					if (gpuValidationIssues.length > 0) {
						throw new Error(
							`Experimental Windows GPU compositor produced an invalid output: ${gpuValidationIssues.join("; ")}`,
						);
					}
					await validateRenderedVideoOutput();
					console.info("[native-static-layout-export] Windows GPU compositor completed", {
						elapsedMs: gpuResult.elapsedMs,
						width: gpuResult.summary.width,
						height: gpuResult.summary.height,
						fps: gpuResult.summary.fps,
						frames: gpuResult.summary.frames,
						realtimeMultiplier: gpuResult.summary.realtimeMultiplier,
						surfacePoolSize: gpuResult.summary.surfacePoolSize,
						gpuDecodeSurface: gpuResult.summary.gpuDecodeSurface,
						adapterIndex: gpuResult.summary.adapterIndex,
						encoderBackend: gpuResult.summary.encoderBackend,
						encoderTuningApplied: gpuResult.summary.encoderTuningApplied,
						readMs: gpuResult.summary.readMs,
						videoProcessMs: gpuResult.summary.videoProcessMs,
						writeSampleMs: gpuResult.summary.writeSampleMs,
						finalizeMs: gpuResult.summary.finalizeMs,
						webcamOverlay: gpuResult.summary.webcamOverlay,
						cursorOverlay: gpuResult.summary.cursorOverlay,
						cursorAtlas: gpuResult.summary.cursorAtlas,
						zoomOverlay: gpuResult.summary.zoomOverlay,
					});
					const outputStat = await fs.stat(videoOnlyPath);
					metrics.chunkCount = 1;
					metrics.chunkDurationSec = options.durationSec;
					metrics.chunkExecMs += gpuResult.elapsedMs;
					metrics.chunks.push({
						index: 0,
						startSec: 0,
						durationSec: options.durationSec,
						backend: "windows-d3d11-compositor",
						elapsedMs: gpuResult.elapsedMs,
						outputBytes: outputStat.size,
						windowsGpuSummary: gpuResult.summary,
					});
					didRenderVideo = true;
				}
			} catch (error) {
				if (session.terminating) {
					throw error;
				}
				if (hasNativeStaticLayoutTimeline(options)) {
					throw error;
				}
				metrics.fallbackChunkCount++;
				console.warn(
					"[native-static-layout-export] Experimental Windows GPU compositor unavailable; falling back to FFmpeg static layout:",
					error,
				);
				await removeTemporaryExportFile(videoOnlyPath);
				if (options.webcamInputPath || options.zoomTelemetry?.length) {
					throw error;
				}
			}
		}

		if (!didRenderVideo && hasNativeStaticLayoutTimeline(options)) {
			throw new Error("Native timeline-map export requires a GPU compositor backend");
		}
		if (!didRenderVideo && hasNativeStaticLayoutSourceCrop(options)) {
			throw new Error("Native crop export requires a GPU compositor backend");
		}

		if (!didRenderVideo && usePrecompositedLayout) {
			const maskPath = path.join(chunkDirectory, "layout-mask.pgm");
			const staticBackgroundPath = path.join(chunkDirectory, "layout-background.png");
			await fs.writeFile(
				maskPath,
				createNativeSquircleMaskPgmBuffer(
					options.contentWidth,
					options.contentHeight,
					options.borderRadius ?? 0,
				),
			);

			const backgroundResult = await runFfmpegWithMetrics(
				ffmpegPath,
				buildNativeStaticBackgroundRenderArgs({
					...fullConfig,
					inputPath: options.inputPath,
					outputPath: staticBackgroundPath,
					maskPath,
				}),
				2 * 60 * 1000,
				session,
			);
			metrics.staticAssetExecMs = backgroundResult.elapsedMs;
			if (!backgroundResult.success) {
				throw new Error(getFfmpegFailureMessage(backgroundResult));
			}

			const fullResult = await runFfmpegWithMetrics(
				ffmpegPath,
				buildNativePrecompositedStaticLayoutArgs({
					...fullConfig,
					staticBackgroundPath,
					maskPath,
				}),
				15 * 60 * 1000,
				session,
			);
			metrics.chunkExecMs += fullResult.elapsedMs;
			if (!fullResult.success) {
				throw new Error(getFfmpegFailureMessage(fullResult));
			}

			const outputStat = await fs.stat(videoOnlyPath);
			metrics.chunkCount = 1;
			metrics.chunkDurationSec = options.durationSec;
			metrics.chunks.push({
				index: 0,
				startSec: 0,
				durationSec: options.durationSec,
				backend: "cuda-static-composite",
				elapsedMs: fullResult.elapsedMs,
				outputBytes: outputStat.size,
			});
		} else if (!didRenderVideo) {
			const primaryResult = await runFfmpegWithMetrics(
				ffmpegPath,
				buildNativeCudaOverlayStaticLayoutArgs(fullConfig),
				15 * 60 * 1000,
				session,
			);
			let fullResult = primaryResult;
			let fullBackend: NativeStaticLayoutBackend = "cuda-overlay";
			let fallbackReason: string | undefined;
			if (!primaryResult.success) {
				if (options.overlayLayers?.length) {
					throw new Error(
						`CUDA overlay-layer composition failed; refusing to drop ${options.overlayLayers.length} visual overlay layer(s): ${getFfmpegFailureMessage(primaryResult)}`,
					);
				}
				fullBackend = "cuda-scale-cpu-pad";
				fallbackReason = isNativeCudaOutOfMemory(primaryResult.stderr)
					? "cuda-oom"
					: "cuda-overlay-failed";
				metrics.fallbackChunkCount++;
				fullResult = await runFfmpegWithMetrics(
					ffmpegPath,
					buildNativeCudaScaleCpuPadStaticLayoutArgs(fullConfig),
					15 * 60 * 1000,
					session,
				);
			}
			metrics.chunkExecMs += fullResult.elapsedMs;
			if (fullResult !== primaryResult) {
				metrics.chunkExecMs += primaryResult.elapsedMs;
			}

			if (fullResult.success) {
				const outputStat = await fs.stat(videoOnlyPath);
				metrics.chunkCount = 1;
				metrics.chunkDurationSec = options.durationSec;
				metrics.chunks.push({
					index: 0,
					startSec: 0,
					durationSec: options.durationSec,
					backend: fullBackend,
					elapsedMs: fullResult.elapsedMs,
					outputBytes: outputStat.size,
					fallbackReason,
				});
			} else if (isNativeCudaOutOfMemory(fullResult.stderr)) {
				const concatLines: string[] = [];

				for (const chunk of chunks) {
					if (session.terminating) {
						throw new Error("Native static layout export was cancelled");
					}

					const outputPath = getStaticLayoutChunkOutputPath(chunkDirectory, chunk.index);
					const baseConfig: NativeStaticLayoutExportArgsConfig = {
						inputPath: options.inputPath,
						outputPath,
						videoCodec,
						width: options.width,
						height: options.height,
						frameRate: options.frameRate,
						bitrate: options.bitrate,
						encodingMode: options.encodingMode,
						contentWidth: options.contentWidth,
						contentHeight: options.contentHeight,
						offsetX: options.offsetX,
						offsetY: options.offsetY,
						backgroundColor: options.backgroundColor,
						videoEncoder: nativeVideoEncoder,
						startSec: chunk.startSec,
						durationSec: chunk.durationSec,
					};
					const primary = await runFfmpegWithMetrics(
						ffmpegPath,
						buildNativeCudaOverlayStaticLayoutArgs(baseConfig),
						15 * 60 * 1000,
						session,
					);
					let backend: NativeStaticLayoutBackend = "cuda-overlay";
					let result = primary;
					let fallbackReason: string | undefined;

					if (!primary.success && isNativeCudaOutOfMemory(primary.stderr)) {
						backend = "cuda-scale-cpu-pad";
						fallbackReason = "cuda-oom";
						metrics.fallbackChunkCount++;
						result = await runFfmpegWithMetrics(
							ffmpegPath,
							buildNativeCudaScaleCpuPadStaticLayoutArgs(baseConfig),
							15 * 60 * 1000,
							session,
						);
					}

					metrics.chunkExecMs += result.elapsedMs;
					if (!result.success) {
						throw new Error(getFfmpegFailureMessage(result));
					}

					const outputStat = await fs.stat(outputPath);
					metrics.chunks.push({
						index: chunk.index,
						startSec: chunk.startSec,
						durationSec: chunk.durationSec,
						backend,
						elapsedMs: result.elapsedMs,
						outputBytes: outputStat.size,
						fallbackReason,
					});
					concatLines.push(toConcatFileLine(outputPath));
				}

				metrics.chunkCount = chunks.length;
				await fs.writeFile(concatListPath, `${concatLines.join("\n")}\n`, "utf8");
				if (session.terminating) {
					throw new Error("Native static layout export was cancelled");
				}
				const concatStartedAt = getNowMs();
				const concatResult = await runFfmpegWithMetrics(
					ffmpegPath,
					buildNativeConcatArgs({ listPath: concatListPath, outputPath: videoOnlyPath }),
					15 * 60 * 1000,
					session,
				);
				metrics.concatExecMs = getNowMs() - concatStartedAt;
				if (!concatResult.success) {
					throw new Error(getFfmpegFailureMessage(concatResult));
				}
			} else {
				throw new Error(getFfmpegFailureMessage(fullResult));
			}
		}

		const videoOnlyStat = await fs.stat(videoOnlyPath);
		metrics.videoOnlyBytes = videoOnlyStat.size;
		if (!videoOutputValidated) {
			await validateRenderedVideoOutput();
		}
		if (didMuxAudioInline) {
			outputPathToKeep = videoOnlyPath;
			return {
				outputPath: videoOnlyPath,
				metrics,
				videoCodec,
				encoderPreference,
				encoderName: "nvidia-cuda-compositor",
				route: "nvidia-cuda-compositor",
			};
		}
		const audioMuxProgressStart = 97.25;
		const audioMuxProgressEnd = 99;
		const progressTotalFrames = Math.max(1, Math.ceil(options.durationSec * options.frameRate));
		const finalized = await muxNativeVideoExportAudio(
			videoOnlyPath,
			options.audioOptions ?? {},
			(progress) => {
				const ratio = Math.max(0, Math.min(1, progress.ratio));
				const percentage =
					audioMuxProgressStart + (audioMuxProgressEnd - audioMuxProgressStart) * ratio;
				const progressPayload: NativeStaticLayoutExportProgress = {
					sessionId,
					stage: "finalizing",
					currentFrame: progressTotalFrames,
					totalFrames: progressTotalFrames,
					percentage,
				};
				const backend = metrics.chunks[0]?.backend;
				if (backend) {
					progressPayload.backend = backend;
				}
				onProgress?.(progressPayload);
			},
			session,
		);
		Object.assign(metrics, finalized.metrics);
		outputPathToKeep = finalized.outputPath;
		const route = metrics.chunks[0]?.backend;
		if (!route) {
			throw new Error("Native static-layout export did not report a route");
		}
		return {
			outputPath: finalized.outputPath,
			metrics,
			videoCodec,
			encoderPreference,
			encoderName: nativeVideoEncoder,
			route,
		};
	} catch (error) {
		await removeTemporaryExportFile(videoOnlyPath);
		await removeTemporaryExportFile(videoOnlyPath.replace(/\.mp4$/, "-final.mp4"));
		throw error;
	} finally {
		nativeStaticLayoutExportSessions.delete(sessionId);
		await fs.rm(chunkDirectory, { force: true, recursive: true }).catch(() => undefined);
		if (outputPathToKeep !== videoOnlyPath) {
			await removeTemporaryExportFile(videoOnlyPath);
		}
	}
}

export async function enqueueNativeVideoExportFrameWrite(
	session: NativeVideoExportSession,
	frameData: Uint8Array | ArrayBuffer,
) {
	const writePromise = session.writeSequence.then(async () => {
		if (session.terminating) {
			throw new Error("Native video export session was cancelled");
		}

		await writeNativeVideoExportFrame(session, frameData);
	});

	session.writeSequence = writePromise.catch(() => undefined);
	await writePromise;
}

export async function enqueueNativeVideoExportFrameWrites(
	session: NativeVideoExportSession,
	frameDataList: Array<Uint8Array | ArrayBuffer>,
) {
	const writePromise = session.writeSequence.then(async () => {
		if (session.terminating) {
			throw new Error("Native video export session was cancelled");
		}

		for (const frameData of frameDataList) {
			await writeNativeVideoExportFrame(session, frameData);
		}
	});

	session.writeSequence = writePromise.catch(() => undefined);
	await writePromise;
}

export async function getAvailableNativeVideoEncoders(ffmpegPath: string) {
	const { stdout } = await execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	});

	return parseAvailableFfmpegEncoders(stdout);
}

export async function probeNativeVideoEncoder(
	ffmpegPath: string,
	encoderName: string,
	encodingMode: NativeExportEncodingMode,
) {
	const outputPath = path.join(
		app.getPath("temp"),
		`recordly-export-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
	);
	const args = buildNativeVideoExportArgs(
		encoderName,
		{
			width: NATIVE_ENCODER_PROBE_DIMENSION,
			height: NATIVE_ENCODER_PROBE_DIMENSION,
			frameRate: 1,
			bitrate: 1_500_000,
			encodingMode,
		},
		outputPath,
	);

	return new Promise<boolean>((resolve) => {
		const process = spawn(ffmpegPath, args, {
			stdio: ["pipe", "ignore", "pipe"],
		});
		let stderrOutput = "";
		const timeout = setTimeout(() => {
			try {
				process.kill("SIGKILL");
			} catch {
				// ignore
			}
			resolve(false);
		}, 15000);

		process.stderr.on("data", (chunk: Buffer) => {
			stderrOutput += chunk.toString();
		});

		process.on("close", (code) => {
			clearTimeout(timeout);
			void removeTemporaryExportFile(outputPath);
			if (code !== 0 && stderrOutput.trim().length > 0) {
				console.warn(
					`[native-export] Encoder probe failed for ${encoderName}:`,
					stderrOutput.trim(),
				);
			}
			resolve(code === 0);
		});

		process.stdin.end(
			Buffer.alloc(
				getNativeVideoInputByteSize(
					NATIVE_ENCODER_PROBE_DIMENSION,
					NATIVE_ENCODER_PROBE_DIMENSION,
				),
				0,
			),
		);
	});
}

export async function resolveNativeVideoEncoder(
	ffmpegPath: string,
	encodingMode: NativeExportEncodingMode,
	codec: "h264" | "hevc" = "h264",
	preference: "auto" | "hardware" | "cpu" = "auto",
) {
	if (
		cachedNativeVideoEncoder?.ffmpegPath === ffmpegPath &&
		cachedNativeVideoEncoder?.encodingMode === encodingMode &&
		cachedNativeVideoEncoder?.codec === codec &&
		cachedNativeVideoEncoder?.preference === preference
	) {
		return cachedNativeVideoEncoder.encoderName;
	}

	const availableEncoders = await getAvailableNativeVideoEncoders(ffmpegPath);
	const candidates = getNativeEncoderCandidates(codec, preference, process.platform);
	const usableCandidates = candidates.filter((encoderName) => availableEncoders.has(encoderName));

	if (usableCandidates.length === 0) {
		throw new Error(
			`No usable FFmpeg ${codec.toUpperCase()} encoder was available for native export (preference: ${preference})`,
		);
	}

	for (const encoderName of usableCandidates) {
		if (await probeNativeVideoEncoder(ffmpegPath, encoderName, encodingMode)) {
			setCachedNativeVideoEncoder({
				ffmpegPath,
				encodingMode,
				codec,
				preference,
				encoderName,
			});
			return encoderName;
		}
	}

	if (preference === "hardware") {
		throw new Error(
			`No usable hardware FFmpeg ${codec.toUpperCase()} encoder was available for native export. ` +
				`Tried: ${usableCandidates.join(", ")}. Install a supported hardware encoder or choose CPU/auto.`,
		);
	}

	throw new Error(
		`No usable FFmpeg ${codec.toUpperCase()} encoder was available for native export (preference: ${preference})`,
	);
}

export function canCopyAudioCodecIntoMp4(codec?: string | null) {
	const normalized = (codec ?? "").trim().toLowerCase();
	if (!normalized) {
		return false;
	}

	return (
		normalized.includes("aac") ||
		normalized.includes("mp4a") ||
		normalized.includes("mpeg-4 audio") ||
		normalized.includes("mp3") ||
		normalized.includes("alac")
	);
}

export function buildNativeVideoAudioMuxArgs(
	videoPath: string,
	audioInputPath: string,
	outputPath: string,
	options: NativeVideoExportFinishOptions,
	argsOptions: NativeVideoAudioMuxArgsOptions = {},
) {
	const audioMode = options.audioMode ?? "none";
	const useEditedTrackFiltergraph =
		audioMode === "edited-track" && options.editedTrackStrategy === "filtergraph-fast-path";
	const args = ["-y", "-hide_banner", "-loglevel", "error"];
	if (argsOptions.progressPipe) {
		args.push(
			"-stats_period",
			"0.5",
			"-progress",
			`pipe:${argsOptions.progressPipe}`,
			"-nostats",
		);
	}
	args.push("-i", videoPath, "-i", audioInputPath);

	if (audioMode === "trim-source") {
		const filter = buildTrimmedSourceAudioFilter(options.trimSegments ?? []);
		if (filter) {
			args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]");
		} else {
			args.push("-map", "0:v:0", "-map", "1:a:0");
		}
	} else if (useEditedTrackFiltergraph) {
		const filter = buildEditedTrackSourceAudioFilter(
			options.editedTrackSegments ?? [],
			options.audioSourceSampleRate ?? 0,
		);
		if (!filter) {
			throw new Error("Edited-track filtergraph inputs are incomplete for native export");
		}
		if (
			typeof options.outputDurationSec === "number" &&
			Number.isFinite(options.outputDurationSec) &&
			options.outputDurationSec > 0
		) {
			const duration = formatFfmpegSeconds(options.outputDurationSec * 1000);
			args.push(
				"-filter_complex",
				`${filter};[aout]apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[aout_sync]`,
				"-map",
				"0:v:0",
				"-map",
				"[aout_sync]",
			);
		} else {
			args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]");
		}
	} else {
		args.push("-map", "0:v:0", "-map", "1:a:0");
	}

	args.push("-c:v", "copy");
	if (audioMode === "copy-source" && canCopyAudioCodecIntoMp4(options.audioSourceCodec)) {
		args.push("-c:a", "copy");
	} else {
		args.push("-c:a", "aac", "-b:a", "192k");
	}
	if (
		typeof options.outputDurationSec === "number" &&
		Number.isFinite(options.outputDurationSec) &&
		options.outputDurationSec > 0
	) {
		args.push("-t", formatFfmpegSeconds(options.outputDurationSec * 1000));
	} else if (audioMode !== "copy-source") {
		args.push("-shortest");
	}
	args.push("-movflags", "+faststart", outputPath);

	return args;
}

export async function muxNativeVideoExportAudio(
	videoPath: string,
	options: NativeVideoExportFinishOptions,
	onProgress?: (progress: NativeVideoAudioMuxProgress) => void,
	session?: NativeStaticLayoutExportSession,
) {
	const audioMode = options.audioMode ?? "none";
	if (audioMode === "none") {
		return {
			outputPath: videoPath,
			metrics: {} as NativeVideoAudioMuxMetrics,
		};
	}

	const ffmpegPath = getFfmpegBinaryPath();
	const metrics: NativeVideoAudioMuxMetrics = {};
	const tempArtifacts: string[] = [];
	let audioInputPath = options.audioSourcePath ?? null;
	const useEditedTrackFiltergraph =
		audioMode === "edited-track" && options.editedTrackStrategy === "filtergraph-fast-path";

	if (audioMode === "edited-track" && !useEditedTrackFiltergraph) {
		if (!options.editedAudioData) {
			throw new Error("Edited audio data is missing for native export");
		}

		const extension = getEditedAudioExtension(options.editedAudioMimeType);
		audioInputPath = path.join(
			app.getPath("temp"),
			`recordly-export-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`,
		);
		const tempAudioWriteStartedAt = getNowMs();
		await fs.writeFile(audioInputPath, Buffer.from(options.editedAudioData));
		metrics.tempEditedAudioWriteMs = getNowMs() - tempAudioWriteStartedAt;
		metrics.tempEditedAudioBytes = options.editedAudioData.byteLength;
		tempArtifacts.push(audioInputPath);
	}

	if (!audioInputPath) {
		return {
			outputPath: videoPath,
			metrics,
		};
	}

	const outputPath = path.join(
		path.dirname(videoPath),
		`${path.basename(videoPath, path.extname(videoPath))}-final.mp4`,
	);

	const args = buildNativeVideoAudioMuxArgs(
		videoPath,
		audioInputPath,
		outputPath,
		options,
		onProgress ? { progressPipe: 2 } : {},
	);

	try {
		const ffmpegExecStartedAt = getNowMs();
		await runFfmpegAudioMux(ffmpegPath, args, 15 * 60 * 1000, options, onProgress, session);
		metrics.ffmpegExecMs = getNowMs() - ffmpegExecStartedAt;
		console.info("[native-video-export] Audio mux completed", {
			ffmpegExecMs: metrics.ffmpegExecMs,
			audioMode: options.audioMode,
			tempVideoBytes: metrics.tempVideoBytes,
			muxedVideoBytes: metrics.muxedVideoBytes,
		});
		await removeTemporaryExportFile(videoPath);
		return {
			outputPath,
			metrics,
		};
	} finally {
		await Promise.allSettled(
			tempArtifacts.map((artifactPath) => removeTemporaryExportFile(artifactPath)),
		);
	}
}

export async function muxExportedVideoAudioBuffer(
	videoData: ArrayBuffer,
	options: NativeVideoExportFinishOptions,
) {
	const tempVideoPath = path.join(
		app.getPath("temp"),
		`recordly-export-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
	);
	const metrics: NativeVideoAudioMuxMetrics = {};
	let succeeded = false;
	let outputPath = tempVideoPath;

	try {
		const tempVideoWriteStartedAt = getNowMs();
		await fs.writeFile(tempVideoPath, Buffer.from(videoData));
		metrics.tempVideoWriteMs = getNowMs() - tempVideoWriteStartedAt;
		metrics.tempVideoBytes = videoData.byteLength;
		const finalized = await muxNativeVideoExportAudio(tempVideoPath, options);
		Object.assign(metrics, finalized.metrics);
		outputPath = finalized.outputPath;
		// Record byte size via stat instead of reading the whole file into a
		// Buffer — fs.readFile throws ERR_FS_FILE_TOO_LARGE on >2 GiB outputs.
		try {
			const stat = await fs.stat(outputPath);
			metrics.muxedVideoBytes = stat.size;
		} catch {
			// Stat failures are non-fatal; size is purely metric data.
		}
		succeeded = true;
		return {
			outputPath,
			metrics,
		};
	} finally {
		// Always remove the unmuxed intermediate when the muxer wrote a separate
		// file. Only remove the muxed output on failure — on success the caller
		// owns it and is responsible for moving/deleting it.
		const cleanupTargets: string[] = [];
		if (outputPath !== tempVideoPath) {
			cleanupTargets.push(tempVideoPath);
		}
		if (!succeeded) {
			cleanupTargets.push(outputPath);
		}
		if (cleanupTargets.length > 0) {
			await Promise.allSettled(
				cleanupTargets.map((target) => removeTemporaryExportFile(target)),
			);
		}
	}
}
