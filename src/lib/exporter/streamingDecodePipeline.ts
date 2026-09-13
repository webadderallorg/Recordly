import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import type { WebDemuxer } from "web-demuxer";
import { resolveSupportedVideoDecoderConfig } from "./decoderCodec";
import {
	buildVideoDecodeFailure,
	getDecodedFrameTimelineOffsetUs,
	preserveFirstVideoDecodeFailure,
	type DecodedVideoInfo,
	type VideoDecodeFailureContext,
} from "./streamingDecoderSupport";
import { computeVideoSegments, splitVideoSegmentsBySpeed } from "./videoTimelineSegments";

type OnFrameCallback = (
	frame: VideoFrame,
	exportTimestampUs: number,
	sourceTimestampMs: number,
	cursorTimestampMs: number,
) => Promise<void>;

interface StreamingDecodeContext {
	demuxer: WebDemuxer;
	decoder: VideoDecoder | null;
	readonly cancelled: boolean;
	readonly metadata: DecodedVideoInfo;
	pendingFrames: VideoFrame[];
	readonly maxDecodeQueue: number;
	readonly maxPendingFrames: number;
}

const STARTUP_STABILIZATION_SECONDS = 1.25;
const STARTUP_MAX_DECODE_QUEUE = 12;
const STARTUP_MAX_PENDING_FRAMES = 28;

export async function decodeVideoStream(
	context: StreamingDecodeContext,

	targetFrameRate: number,
	trimRegions: TrimRegion[] | undefined,
	speedRegions: SpeedRegion[] | undefined,
	onFrame: OnFrameCallback,
): Promise<void> {
	if (!context.demuxer || !context.metadata) {
		throw new Error("Must call loadMetadata() before decodeAll()");
	}

	const decoderConfig = await resolveSupportedVideoDecoderConfig(
		await context.demuxer.getDecoderConfig("video"),
	);
	const codec = context.metadata.codec.toLowerCase();
	const shouldPreferSoftwareDecode = codec.includes("av01") || codec.includes("av1");
	const effectiveVideoDuration = getEffectiveVideoStreamDurationSeconds({
		duration: context.metadata.duration,
		streamDuration: context.metadata.streamDuration,
	});
	const segments = splitVideoSegmentsBySpeed(
		computeVideoSegments(effectiveVideoDuration, trimRegions),
		speedRegions,
	);
	const segmentOutputFrameCounts = segments.map((segment) =>
		Math.ceil(((segment.endSec - segment.startSec) / segment.speed) * targetFrameRate),
	);
	const expectedOutputFrames = segmentOutputFrameCounts.reduce((sum, count) => sum + count, 0);
	const frameDurationUs = 1_000_000 / targetFrameRate;
	const epsilonSec = 0.001;
	const startupStabilizationSeconds = STARTUP_STABILIZATION_SECONDS;
	const startupFrameBudget = Math.max(
		1,
		Math.round(targetFrameRate * startupStabilizationSeconds),
	);
	let exportFrameIndex = 0;
	let loggedSteadyStateBackpressure = false;
	const backpressureWaiters = new Set<() => void>();

	const notifyBackpressureProgress = () => {
		if (backpressureWaiters.size === 0) {
			return;
		}

		const waiters = [...backpressureWaiters];
		backpressureWaiters.clear();
		for (const resolve of waiters) {
			resolve();
		}
	};

	const waitForBackpressureProgress = () =>
		new Promise<void>((resolve) => {
			backpressureWaiters.add(resolve);
		});

	console.log(
		`[StreamingVideoDecoder] Startup-safe decode backpressure active for first ${startupStabilizationSeconds}s (${startupFrameBudget} frames)`,
	);

	// Async frame queue — decoder pushes, consumer pulls
	context.pendingFrames.length = 0;
	const pendingFrames = context.pendingFrames;
	let frameResolve: ((frame: VideoFrame | null) => void) | null = null;
	let decodeError: Error | null = null;
	let decodeDone = false;
	let firstDecodedFrameTimestampUs: number | null = null;
	let decodedFrameTimelineOffsetUs = 0;
	let submittedChunkCount = 0;
	let lastSubmittedChunk: EncodedVideoChunk | undefined;
	let lastSubmittedChunkIndex: number | undefined;
	const preferredDecoderConfig = shouldPreferSoftwareDecode
		? {
				...decoderConfig,
				hardwareAcceleration: "prefer-software" as const,
			}
		: decoderConfig;
	let activeDecoderConfig = preferredDecoderConfig;
	const getDecoderFailureContext = (): VideoDecodeFailureContext => ({
		decoderConfig: activeDecoderConfig,
		sourceMetadata: context.metadata ?? undefined,
		chunkIndex: lastSubmittedChunkIndex,
		chunk: lastSubmittedChunk,
		decoderState: context.decoder?.state,
		decodeQueueSize: context.decoder?.decodeQueueSize,
	});
	const recordFirstDecodeError = (error: unknown) => {
		decodeError = preserveFirstVideoDecodeFailure(
			decodeError,
			error,
			getDecoderFailureContext(),
		);
	};

	context.decoder = new VideoDecoder({
		output: (frame: VideoFrame) => {
			if (frameResolve) {
				const resolve = frameResolve;
				frameResolve = null;
				resolve(frame);
			} else {
				pendingFrames.push(frame);
			}
			notifyBackpressureProgress();
		},
		error: (e: DOMException) => {
			recordFirstDecodeError(e);
			if (frameResolve) {
				const resolve = frameResolve;
				frameResolve = null;
				resolve(null);
			}
			notifyBackpressureProgress();
		},
	});
	try {
		context.decoder.configure(preferredDecoderConfig);
	} catch (error) {
		if (!shouldPreferSoftwareDecode) {
			throw buildVideoDecodeFailure(error, getDecoderFailureContext());
		}
		// Fall back to default decoder config if software preference is unsupported.
		activeDecoderConfig = decoderConfig;
		try {
			context.decoder.configure(decoderConfig);
		} catch (fallbackError) {
			throw buildVideoDecodeFailure(fallbackError, getDecoderFailureContext());
		}
	}

	const getNextFrame = (): Promise<VideoFrame | null> => {
		if (decodeError) return Promise.resolve(null);
		if (pendingFrames.length > 0) {
			const frame = pendingFrames.shift()!;
			notifyBackpressureProgress();
			return Promise.resolve(frame);
		}
		if (decodeDone) return Promise.resolve(null);
		return new Promise((resolve) => {
			frameResolve = resolve;
		});
	};

	// One forward stream through the whole file.
	// Pass explicit range because some containers are truncated when no end is provided.
	const readEndSec =
		Math.max(
			context.metadata.duration + (context.metadata.mediaStartTime ?? 0),
			(context.metadata.streamDuration ?? context.metadata.duration) +
				(context.metadata.streamStartTime ?? context.metadata.mediaStartTime ?? 0),
		) + 0.5;
	const reader = context.demuxer.read("video", 0, readEndSec).getReader();

	// Feed chunks to decoder in background with backpressure
	const feedPromise = (async () => {
		try {
			while (!context.cancelled && !decodeError) {
				const { done, value: chunk } = await reader.read();
				if (done || !chunk) break;

				if (!loggedSteadyStateBackpressure && exportFrameIndex >= startupFrameBudget) {
					loggedSteadyStateBackpressure = true;
					console.log(
						"[StreamingVideoDecoder] Switched to steady-state decode backpressure",
					);
				}

				const decodeQueueLimit =
					exportFrameIndex < startupFrameBudget
						? Math.min(context.maxDecodeQueue, STARTUP_MAX_DECODE_QUEUE)
						: context.maxDecodeQueue;
				const pendingFrameLimit =
					exportFrameIndex < startupFrameBudget
						? Math.min(context.maxPendingFrames, STARTUP_MAX_PENDING_FRAMES)
						: context.maxPendingFrames;

				// Backpressure on both decode queue and decoded frame backlog.
				while (
					!decodeError &&
					context.decoder!.state === "configured" &&
					(context.decoder!.decodeQueueSize > decodeQueueLimit ||
						pendingFrames.length > pendingFrameLimit) &&
					!context.cancelled
				) {
					await waitForBackpressureProgress();
				}
				if (context.cancelled || decodeError) break;
				if (context.decoder!.state !== "configured") {
					recordFirstDecodeError(
						new DOMException(
							"Decoder closed before the next video chunk was submitted.",
							"InvalidStateError",
						),
					);
					break;
				}

				lastSubmittedChunk = chunk;
				lastSubmittedChunkIndex = submittedChunkCount;
				context.decoder!.decode(chunk);
				submittedChunkCount++;
			}

			if (!context.cancelled && context.decoder!.state === "configured") {
				await context.decoder!.flush();
			}
		} catch (e) {
			recordFirstDecodeError(e);
		} finally {
			decodeDone = true;
			if (frameResolve) {
				const resolve = frameResolve;
				frameResolve = null;
				resolve(null);
			}
			notifyBackpressureProgress();
		}
	})();

	// Route decoded frames into segments by timestamp, then deliver with VFR→CFR resampling
	let segmentIdx = 0;
	let segmentFrameIndex = 0;
	let lastDecodedFrameSec: number | null = null;
	let heldFrame: VideoFrame | null = null;
	let heldFrameSec = 0;

	const emitHeldFrameForTarget = async (segment: {
		startSec: number;
		endSec: number;
		speed: number;
	}) => {
		if (!heldFrame) return false;
		const segmentFrameCount = segmentOutputFrameCounts[segmentIdx];
		if (segmentFrameIndex >= segmentFrameCount) return false;

		const segmentDurationSec = segment.endSec - segment.startSec;
		const sourceTimeSec =
			segment.startSec + (segmentFrameIndex / segmentFrameCount) * segmentDurationSec;
		if (sourceTimeSec >= segment.endSec - epsilonSec) return false;

		const sourceTimestampMs = sourceTimeSec * 1000;
		await onFrame(
			heldFrame,
			exportFrameIndex * frameDurationUs,
			sourceTimestampMs,
			sourceTimestampMs,
		);
		segmentFrameIndex++;
		exportFrameIndex++;
		return true;
	};

	while (!context.cancelled && segmentIdx < segments.length) {
		const frame = await getNextFrame();
		if (!frame) break;

		if (firstDecodedFrameTimestampUs === null) {
			firstDecodedFrameTimestampUs = frame.timestamp;
			decodedFrameTimelineOffsetUs = getDecodedFrameTimelineOffsetUs(
				firstDecodedFrameTimestampUs,
				context.metadata,
			);
		}

		const normalizedFrameTimeSec = Math.max(
			0,
			(frame.timestamp - firstDecodedFrameTimestampUs + decodedFrameTimelineOffsetUs) /
				1_000_000,
		);
		const frameTimeSec: number =
			lastDecodedFrameSec === null
				? normalizedFrameTimeSec
				: Math.max(lastDecodedFrameSec, normalizedFrameTimeSec);
		lastDecodedFrameSec = frameTimeSec;

		// Finalize completed segments before handling this frame.
		while (
			segmentIdx < segments.length &&
			frameTimeSec >= segments[segmentIdx].endSec - epsilonSec
		) {
			const segment = segments[segmentIdx];
			while (!context.cancelled && (await emitHeldFrameForTarget(segment))) {
				// Keep emitting remaining output frames for this segment from the last known frame.
			}

			segmentIdx++;
			segmentFrameIndex = 0;
			if (
				heldFrame &&
				segmentIdx < segments.length &&
				heldFrameSec < segments[segmentIdx].startSec - epsilonSec
			) {
				heldFrame.close();
				heldFrame = null;
			}
		}

		if (segmentIdx >= segments.length) {
			frame.close();
			continue;
		}

		const currentSegment = segments[segmentIdx];

		// Before current segment (trimmed region or pre-roll).
		if (frameTimeSec < currentSegment.startSec - epsilonSec) {
			frame.close();
			continue;
		}

		if (!heldFrame) {
			heldFrame = frame;
			heldFrameSec = frameTimeSec;
			continue;
		}

		// Any target timestamp before this midpoint is closer to heldFrame than current frame.
		const handoffBoundarySec = (heldFrameSec + frameTimeSec) / 2;
		while (!context.cancelled) {
			const segmentFrameCount = segmentOutputFrameCounts[segmentIdx];
			if (segmentFrameIndex >= segmentFrameCount) {
				break;
			}

			const segmentDurationSec = currentSegment.endSec - currentSegment.startSec;
			const sourceTimeSec =
				currentSegment.startSec +
				(segmentFrameIndex / segmentFrameCount) * segmentDurationSec;
			if (sourceTimeSec >= currentSegment.endSec - epsilonSec) {
				break;
			}
			if (sourceTimeSec > handoffBoundarySec) {
				break;
			}

			const sourceTimestampMs = sourceTimeSec * 1000;
			await onFrame(
				heldFrame,
				exportFrameIndex * frameDurationUs,
				sourceTimestampMs,
				sourceTimestampMs,
			);
			segmentFrameIndex++;
			exportFrameIndex++;
		}

		heldFrame.close();
		heldFrame = frame;
		heldFrameSec = frameTimeSec;
	}

	// Flush remaining output frames for the last decoded frame.
	if (!decodeError && heldFrame && segmentIdx < segments.length) {
		while (!context.cancelled && segmentIdx < segments.length) {
			const segment = segments[segmentIdx];
			if (heldFrameSec < segment.startSec - epsilonSec) {
				break;
			}

			while (!context.cancelled && (await emitHeldFrameForTarget(segment))) {
				// Keep emitting output frames for the active segment.
			}

			segmentIdx++;
			segmentFrameIndex = 0;
			if (
				segmentIdx < segments.length &&
				heldFrameSec < segments[segmentIdx].startSec - epsilonSec
			) {
				break;
			}
		}
		heldFrame.close();
		heldFrame = null;
	} else if (heldFrame) {
		heldFrame.close();
		heldFrame = null;
	}

	// Drain leftover decoded frames
	while (!decodeDone && !decodeError) {
		const frame = await getNextFrame();
		if (!frame) break;
		frame.close();
	}

	try {
		reader.cancel();
	} catch {
		/* already closed */
	}
	await feedPromise;
	for (const f of pendingFrames) f.close();
	pendingFrames.length = 0;

	if (context.decoder?.state === "configured") {
		context.decoder.close();
	}
	context.decoder = null;

	if (decodeError) {
		throw decodeError;
	}

	const requiredEndSec = segments.length > 0 ? segments[segments.length - 1].endSec : 0;
	if (
		!context.cancelled &&
		lastDecodedFrameSec !== null &&
		requiredEndSec - lastDecodedFrameSec > 1 &&
		exportFrameIndex < expectedOutputFrames
	) {
		throw new Error(
			`Video decode ended early at ${lastDecodedFrameSec.toFixed(3)}s (needed ${requiredEndSec.toFixed(3)}s; rendered ${exportFrameIndex}/${expectedOutputFrames} frames).`,
		);
	}
}
