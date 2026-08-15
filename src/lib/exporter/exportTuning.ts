import type { ExportEncodeBackend, ExportEncodingMode, ExportNativeTransportMode } from "./types";

const DEFAULT_ENCODING_MODE: ExportEncodingMode = "balanced";
type WebCodecsLatencyMode = "quality" | "realtime";
const BASELINE_PIXELS_PER_SECOND = 1280 * 720 * 60;
const RAW_FRAME_BYTES_PER_PIXEL = 4;
const CONSERVATIVE_RAW_FRAME_LIMIT = 2;

const LATENCY_MODE_PREFERENCES: Record<ExportEncodingMode, readonly WebCodecsLatencyMode[]> = {
	fast: ["realtime", "quality"],
	balanced: ["realtime", "quality"],
	quality: ["quality", "realtime"],
};

const TARGET_QUEUE_SECONDS: Record<ExportEncodingMode, number> = {
	fast: 1.25,
	balanced: 2,
	quality: 2.4,
};

const MIN_QUEUE_LIMIT: Record<ExportEncodingMode, number> = {
	fast: 36,
	balanced: 72,
	quality: 96,
};

const MAX_QUEUE_LIMIT: Record<ExportEncodingMode, number> = {
	fast: 96,
	balanced: 120,
	quality: 180,
};

const KEYFRAME_INTERVAL_SECONDS: Record<ExportEncodingMode, number> = {
	fast: 4,
	balanced: 3,
	quality: 2.5,
};

function normalizeEncodingMode(encodingMode?: ExportEncodingMode): ExportEncodingMode {
	return encodingMode ?? DEFAULT_ENCODING_MODE;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function getEffectiveHardwareConcurrency(hardwareConcurrency?: number): number {
	if (typeof hardwareConcurrency === "number" && Number.isFinite(hardwareConcurrency)) {
		return Math.max(1, Math.floor(hardwareConcurrency));
	}

	if (
		typeof navigator !== "undefined" &&
		typeof navigator.hardwareConcurrency === "number" &&
		Number.isFinite(navigator.hardwareConcurrency)
	) {
		return Math.max(1, Math.floor(navigator.hardwareConcurrency));
	}

	return 8;
}

function getRelativePixelRate(width: number, height: number, frameRate: number): number {
	return (
		(Math.max(1, width) * Math.max(1, height) * Math.max(1, frameRate)) /
		BASELINE_PIXELS_PER_SECOND
	);
}

export interface ExportBackpressureProfile {
	name: string;
	maxEncodeQueue: number;
	maxDecodeQueue: number;
	maxPendingFrames: number;
	maxInFlightNativeWrites: number;
	maxInFlightNativeRawFrames: number;
	maxInFlightNativeRawBytes: number;
}

interface ExportBackpressureProfileOptions {
	encodeBackend: ExportEncodeBackend;
	width: number;
	height: number;
	frameRate: number;
	encodingMode?: ExportEncodingMode;
	hardwareConcurrency?: number;
}

export interface NativeRawFrameBackpressureLimits {
	maxInFlightFrames: number;
	maxInFlightBytes: number;
}

export function getNativeRawFrameByteSize(width: number, height: number): number {
	return (
		Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height)) * RAW_FRAME_BYTES_PER_PIXEL
	);
}

export function getNativeRawFrameBackpressureLimits(options: {
	width: number;
	height: number;
	profile: ExportBackpressureProfile;
	transportMode: ExportNativeTransportMode;
	maxInFlightFrames?: number;
	maxInFlightBytes?: number;
}): NativeRawFrameBackpressureLimits {
	const frameByteSize = getNativeRawFrameByteSize(options.width, options.height);
	const requestedFrames =
		typeof options.maxInFlightFrames === "number" && Number.isFinite(options.maxInFlightFrames)
			? Math.floor(options.maxInFlightFrames)
			: options.profile.maxInFlightNativeRawFrames;
	const requestedBytes =
		typeof options.maxInFlightBytes === "number" && Number.isFinite(options.maxInFlightBytes)
			? Math.floor(options.maxInFlightBytes)
			: options.profile.maxInFlightNativeRawBytes;
	const transportFrameLimit =
		options.transportMode === "cloned-ipc"
			? Math.min(requestedFrames, CONSERVATIVE_RAW_FRAME_LIMIT)
			: requestedFrames;
	const maxInFlightFrames = Math.max(1, transportFrameLimit);
	const transportByteLimit =
		options.transportMode === "cloned-ipc"
			? Math.min(requestedBytes, frameByteSize * CONSERVATIVE_RAW_FRAME_LIMIT)
			: requestedBytes;

	return {
		maxInFlightFrames,
		maxInFlightBytes: Math.max(
			frameByteSize,
			Math.min(
				Math.max(frameByteSize, transportByteLimit),
				frameByteSize * maxInFlightFrames,
			),
		),
	};
}

type NativeRawFrameWaiter = {
	frameByteSize: number;
	resolve: () => void;
	reject: (error: Error) => void;
};

export class NativeRawFrameBackpressureQueue {
	private inFlightBytes = 0;
	private inFlightFrames = 0;
	private closedError: Error | null = null;
	private waiters = new Set<NativeRawFrameWaiter>();

	constructor(
		private readonly maxInFlightBytes: number,
		private readonly maxInFlightFrames: number,
	) {}

	get currentInFlightBytes(): number {
		return this.inFlightBytes;
	}

	get currentInFlightFrames(): number {
		return this.inFlightFrames;
	}

	canAccept(frameByteSize: number): boolean {
		return (
			frameByteSize > 0 &&
			this.inFlightFrames < this.maxInFlightFrames &&
			this.inFlightBytes + frameByteSize <= this.maxInFlightBytes
		);
	}

	async waitForCapacity(frameByteSize: number): Promise<void> {
		this.validateFrameByteSize(frameByteSize);
		if (this.closedError) {
			throw this.closedError;
		}
		if (this.canAccept(frameByteSize)) {
			return;
		}

		await new Promise<void>((resolve, reject) => {
			this.waiters.add({
				frameByteSize,
				resolve,
				reject,
			});
		});
	}

	reserve(frameByteSize: number): void {
		this.validateFrameByteSize(frameByteSize);
		if (this.closedError) {
			throw this.closedError;
		}
		if (!this.canAccept(frameByteSize)) {
			throw new Error("Native raw-frame backpressure capacity was not available");
		}

		this.inFlightBytes += frameByteSize;
		this.inFlightFrames += 1;
	}

	release(frameByteSize: number): void {
		this.inFlightBytes = Math.max(0, this.inFlightBytes - frameByteSize);
		this.inFlightFrames = Math.max(0, this.inFlightFrames - 1);
		this.notifyWaiters();
	}

	fail(error: Error): void {
		if (this.closedError) {
			return;
		}
		this.closedError = error;
		const waiters = [...this.waiters];
		this.waiters.clear();
		for (const waiter of waiters) {
			waiter.reject(error);
		}
	}

	private validateFrameByteSize(frameByteSize: number): void {
		if (!Number.isFinite(frameByteSize) || frameByteSize <= 0) {
			throw new Error("Native raw-frame byte size must be positive");
		}
		if (frameByteSize > this.maxInFlightBytes) {
			throw new Error("Native raw-frame byte size exceeds the configured byte cap");
		}
	}

	private notifyWaiters(): void {
		for (const waiter of [...this.waiters]) {
			if (!this.canAccept(waiter.frameByteSize)) {
				continue;
			}
			this.waiters.delete(waiter);
			waiter.resolve();
		}
	}
}

export function getPreferredWebCodecsLatencyModes(
	encodingMode?: ExportEncodingMode,
): readonly WebCodecsLatencyMode[] {
	return LATENCY_MODE_PREFERENCES[normalizeEncodingMode(encodingMode)];
}

export function getWebCodecsEncodeQueueLimit(
	frameRate: number,
	encodingMode?: ExportEncodingMode,
): number {
	const resolvedEncodingMode = normalizeEncodingMode(encodingMode);
	const targetLimit = Math.round(frameRate * TARGET_QUEUE_SECONDS[resolvedEncodingMode]);

	return clamp(
		targetLimit,
		MIN_QUEUE_LIMIT[resolvedEncodingMode],
		MAX_QUEUE_LIMIT[resolvedEncodingMode],
	);
}

export function getWebCodecsKeyFrameInterval(
	frameRate: number,
	encodingMode?: ExportEncodingMode,
): number {
	const resolvedEncodingMode = normalizeEncodingMode(encodingMode);
	return Math.max(1, Math.round(frameRate * KEYFRAME_INTERVAL_SECONDS[resolvedEncodingMode]));
}

function createExportBackpressureProfile(options: {
	name: string;
	maxEncodeQueue: number;
	maxDecodeQueue: number;
	maxPendingFrames: number;
	maxInFlightNativeWrites: number;
	maxInFlightNativeRawFrames: number;
	width: number;
	height: number;
}): ExportBackpressureProfile {
	return {
		name: options.name,
		maxEncodeQueue: options.maxEncodeQueue,
		maxDecodeQueue: options.maxDecodeQueue,
		maxPendingFrames: options.maxPendingFrames,
		maxInFlightNativeWrites: options.maxInFlightNativeWrites,
		maxInFlightNativeRawFrames: options.maxInFlightNativeRawFrames,
		maxInFlightNativeRawBytes:
			getNativeRawFrameByteSize(options.width, options.height) *
			options.maxInFlightNativeRawFrames,
	};
}

export function getExportBackpressureProfile(
	options: ExportBackpressureProfileOptions,
): ExportBackpressureProfile {
	const hardwareConcurrency = getEffectiveHardwareConcurrency(options.hardwareConcurrency);
	const relativePixelRate = getRelativePixelRate(
		options.width,
		options.height,
		options.frameRate,
	);
	const isLowCoreSystem = hardwareConcurrency <= 4;
	const isHighCoreSystem = hardwareConcurrency >= 8;
	const isHeavyWorkload = relativePixelRate >= 1.5;
	const isExtremeWorkload = relativePixelRate >= 3;
	const maxEncodeQueue = getWebCodecsEncodeQueueLimit(options.frameRate, options.encodingMode);

	if (options.encodeBackend === "ffmpeg") {
		if (isLowCoreSystem || isExtremeWorkload) {
			return createExportBackpressureProfile({
				name: "breeze-conservative",
				maxEncodeQueue,
				maxDecodeQueue: 8,
				maxPendingFrames: 16,
				maxInFlightNativeWrites: 2,
				maxInFlightNativeRawFrames: 2,
				width: options.width,
				height: options.height,
			});
		}

		if (isHighCoreSystem && !isHeavyWorkload) {
			return createExportBackpressureProfile({
				name: "breeze-balanced-plus",
				maxEncodeQueue,
				maxDecodeQueue: 14,
				maxPendingFrames: 40,
				maxInFlightNativeWrites: 8,
				maxInFlightNativeRawFrames: 4,
				width: options.width,
				height: options.height,
			});
		}

		return createExportBackpressureProfile({
			name: "breeze-balanced",
			maxEncodeQueue,
			maxDecodeQueue: 12,
			maxPendingFrames: 28,
			maxInFlightNativeWrites: 4,
			maxInFlightNativeRawFrames: 4,
			width: options.width,
			height: options.height,
		});
	}

	if (isLowCoreSystem || isExtremeWorkload) {
		return createExportBackpressureProfile({
			name: "webcodecs-conservative",
			maxEncodeQueue,
			maxDecodeQueue: 8,
			maxPendingFrames: 20,
			maxInFlightNativeWrites: 1,
			maxInFlightNativeRawFrames: 1,
			width: options.width,
			height: options.height,
		});
	}

	if (isHighCoreSystem && !isHeavyWorkload) {
		return createExportBackpressureProfile({
			name: "webcodecs-balanced-plus",
			maxEncodeQueue,
			maxDecodeQueue: 12,
			maxPendingFrames: 32,
			maxInFlightNativeWrites: 1,
			maxInFlightNativeRawFrames: 1,
			width: options.width,
			height: options.height,
		});
	}

	return createExportBackpressureProfile({
		name: "webcodecs-balanced",
		maxEncodeQueue,
		maxDecodeQueue: 10,
		maxPendingFrames: 24,
		maxInFlightNativeWrites: 1,
		maxInFlightNativeRawFrames: 1,
		width: options.width,
		height: options.height,
	});
}
