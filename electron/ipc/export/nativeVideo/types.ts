import { type ChildProcessByStdio, spawn } from "node:child_process";
import { type Readable, type Writable } from "node:stream";
import { type WebContents } from "electron";
import {
	type NativeExportEncodingMode,
	type NativeStaticLayoutBackend,
	type NativeVideoAudioMuxMetrics,
	type NativeVideoExportFinishOptions,
} from "../../nativeVideoExport";

export type ElectronGpuDeviceLike = {
	active?: boolean;
	vendorId?: number | string;
	vendorString?: string;
	deviceString?: string;
};

export type ElectronGpuInfoLike = {
	gpuDevice?: ElectronGpuDeviceLike[];
	machineModelName?: string;
	machineModelVersion?: string;
};

export interface ExportHardwareInfo {
	platform: NodeJS.Platform;
	release: string;
	arch: string;
	cpuModel: string | null;
	logicalProcessors: number;
	totalMemoryGb: number;
	machineModel: string | null;
	gpus: Array<{
		name: string;
		vendor: string | null;
		active: boolean | null;
	}>;
	gpuFeatures: {
		videoDecode: string | null;
		videoEncode: string | null;
		webgl: string | null;
		webgpu: string | null;
	};
}

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
};

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
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	encodingMode: NativeExportEncodingMode;
	durationSec: number;
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
	zoomTelemetry?: Array<{ timeMs: number; scale: number; x: number; y: number }>;
	zoomTelemetryPath?: string | null;
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
	currentFrame: number;
	totalFrames: number;
	percentage: number;
}

export type NativeVideoAudioMuxProgress = {
	ratio: number;
	processedSec?: number;
	totalSec?: number;
};

export type NativeVideoAudioMuxArgsOptions = {
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

export interface NvidiaCudaExportSummary {
	success?: boolean;
	inputPath?: string;
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
	nativeSummary?: {
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
	};
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

export interface NativeStaticLayoutExportSession {
	terminating: boolean;
	currentProcess: ReturnType<typeof spawn> | null;
}

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
