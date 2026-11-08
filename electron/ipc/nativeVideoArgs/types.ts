export type NativeExportEncodingMode = "fast" | "balanced" | "quality";

export type NativeVideoExportAudioMode = "none" | "copy-source" | "trim-source" | "edited-track";

export type NativeVideoExportEditedTrackStrategy =
	| "filtergraph-fast-path"
	| "offline-render-fallback";

export interface NativeVideoExportStartOptions {
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	encodingMode: NativeExportEncodingMode;
	inputMode?: "rawvideo" | "h264-stream";
	deliveryProfile?: "cloud";
}

export interface NativeVideoExportAudioSegment {
	startMs: number;
	endMs: number;
}

export interface NativeVideoExportEditedTrackSegment extends NativeVideoExportAudioSegment {
	speed: number;
}

export interface NativeVideoExportFinishOptions {
	audioMode?: NativeVideoExportAudioMode;
	audioSourcePath?: string | null;
	audioSourceCodec?: string | null;
	audioSourceSampleRate?: number;
	outputDurationSec?: number;
	trimSegments?: NativeVideoExportAudioSegment[];
	editedTrackStrategy?: NativeVideoExportEditedTrackStrategy;
	editedTrackSegments?: NativeVideoExportEditedTrackSegment[];
	editedAudioData?: ArrayBuffer;
	editedAudioMimeType?: string | null;
}

export interface NativeVideoAudioMuxMetrics {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
}

export type NativeStaticLayoutBackend =
	| "cuda-overlay"
	| "cuda-scale-cpu-pad"
	| "cuda-static-composite"
	| "nvidia-cuda-compositor"
	| "windows-d3d11-compositor";

export interface NativeStaticLayoutExportArgsConfig {
	inputPath: string;
	outputPath: string;
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	encodingMode: NativeExportEncodingMode;
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
	staticBackgroundPath?: string | null;
	maskPath?: string | null;
	borderRadius?: number;
	shadowIntensity?: number;
	startSec?: number;
	durationSec?: number;
}

export interface NativeStaticLayoutChunk {
	index: number;
	startSec: number;
	durationSec: number;
}
