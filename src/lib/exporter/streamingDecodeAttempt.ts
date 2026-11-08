import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import {
	buildVideoDecodeFailure,
	getDecodedFrameTimelineOffsetUs,
	preserveFirstVideoDecodeFailure,
	type VideoDecodeFailureContext,
} from "./streamingDecoderSupport";
import type {
	DecodeReadWindow,
	OnFrameCallback,
	StreamingDecodeContext,
} from "./streamingDecodeTypes";
import {
	computeVideoSegments,
	segmentFrameCount,
	segmentSourceTime,
	splitVideoSegmentsBySpeed,
	type VideoSegment,
} from "./videoTimelineSegments";

const STARTUP_STABILIZATION_SECONDS = 1.25;

const STARTUP_MAX_DECODE_QUEUE = 12;

const STARTUP_MAX_PENDING_FRAMES = 28;
export async function decodeVideoStreamAttempt(
	context: StreamingDecodeContext,

	targetFrameRate: number,
	trimRegions: TrimRegion[] | undefined,
	speedRegions: SpeedRegion[] | undefined,
	onFrame: OnFrameCallback,
	segmentsOverride?: VideoSegment[],
	readWindow?: DecodeReadWindow,
	forceSoftwareDecode = false,
): Promise<void> {
	if (!context.demuxer || !context.metadata) {
		throw new Error("Must call loadMetadata() before decodeAll()");
	}

	const decoderConfig = await context.demuxer.getDecoderConfig("video");
	const codec = context.metadata.codec.toLowerCase();
	const shouldPreferSoftwareDecode =
		forceSoftwareDecode || codec.includes("av01") || codec.includes("av1");
	const effectiveVideoDuration = getEffectiveVideoStreamDurationSeconds({
		duration: context.metadata.duration,
		streamDuration: context.metadata.streamDuration,
	});
	const segments =
		segmentsOverride ??
		splitVideoSegmentsBySpeed(
			computeVideoSegments(effectiveVideoDuration, trimRegions),
			speedRegions,
		);
	const segmentOutputFrameCounts = segments.map((segment) =>
		segmentFrameCount(segment, targetFrameRate),
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
	let outputComplete = expectedOutputFrames === 0;
	let stopped = false;
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
			if (stopped || context.cancelled || outputComplete || decodeError) {
				frame.close();
				return;
			}
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
		if (!shouldPreferSoftwareDecode || forceSoftwareDecode) {
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
		if (stopped || context.cancelled || decodeError) return Promise.resolve(null);
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
	// read() seeks backwards to a keyframe. Keep timestamps in the source's PTS
	// domain: the existing timeline offset below retains the seek position.
	const mediaStartSec = context.metadata.mediaStartTime ?? 0;
	const reader = context.demuxer
		.read(
			"video",
			readWindow ? Math.max(0, mediaStartSec + readWindow.startSec) : 0,
			readWindow ? Math.min(readEndSec, mediaStartSec + readWindow.endSec + 0.5) : readEndSec,
		)
		.getReader();

	let readerCancellation: Promise<void> | undefined;
	const stop = () => {
		stopped = true;
		if (frameResolve) {
			const resolve = frameResolve;
			frameResolve = null;
			resolve(null);
		}
		notifyBackpressureProgress();
		readerCancellation ??= reader.cancel().catch(() => {
			/* already closed */
		});
	};
	const removeCancellationHandler = context.onCancel?.(stop);
	if (context.cancelled) stop();

	// Feed chunks to decoder in background with backpressure
	const feedPromise = (async () => {
		try {
			while (!stopped && !context.cancelled && !decodeError && !outputComplete) {
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
					!stopped &&
					!decodeError &&
					!outputComplete &&
					context.decoder!.state === "configured" &&
					(context.decoder!.decodeQueueSize > decodeQueueLimit ||
						pendingFrames.length > pendingFrameLimit) &&
					!context.cancelled
				) {
					await waitForBackpressureProgress();
				}
				if (stopped || context.cancelled || decodeError || outputComplete) break;
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

			if (
				!stopped &&
				!context.cancelled &&
				!outputComplete &&
				context.decoder!.state === "configured"
			) {
				await context.decoder!.flush();
			}
		} catch (e) {
			if (!stopped) recordFirstDecodeError(e);
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
	let currentFrame: VideoFrame | null = null;

	const emitHeldFrameForTarget = async (segment: VideoSegment) => {
		if (!heldFrame) return false;
		const segmentFrameCount = segmentOutputFrameCounts[segmentIdx];
		if (segmentFrameIndex >= segmentFrameCount) return false;

		const sourceTimeSec = segmentSourceTime(segment, segmentFrameIndex, targetFrameRate);

		const sourceTimestampMs = sourceTimeSec * 1000;
		await onFrame(
			heldFrame,
			(segment.outputStartSec === undefined
				? exportFrameIndex
				: (segment.outputFrameStart ??
						Math.ceil(segment.outputStartSec * targetFrameRate)) + segmentFrameIndex) *
				frameDurationUs,
			sourceTimestampMs,
			sourceTimestampMs,
		);
		segmentFrameIndex++;
		exportFrameIndex++;
		if (exportFrameIndex >= expectedOutputFrames) {
			outputComplete = true;
			stop();
		}
		return true;
	};

	try {
		while (!context.cancelled && !outputComplete && segmentIdx < segments.length) {
			const frame = await getNextFrame();
			if (!frame) break;
			currentFrame = frame;

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
			}

			if (segmentIdx >= segments.length) {
				frame.close();
				currentFrame = null;
				continue;
			}

			const currentSegment = segments[segmentIdx];

			// Keep the nearest pre-roll frame for cuts between source frames.
			if (frameTimeSec < currentSegment.startSec - epsilonSec) {
				heldFrame?.close();
				heldFrame = frame;
				currentFrame = null;
				heldFrameSec = frameTimeSec;
				continue;
			}

			if (!heldFrame) {
				heldFrame = frame;
				currentFrame = null;
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

				const sourceTimeSec = segmentSourceTime(
					currentSegment,
					segmentFrameIndex,
					targetFrameRate,
				);
				if (sourceTimeSec > handoffBoundarySec) {
					break;
				}

				await emitHeldFrameForTarget(currentSegment);
			}

			heldFrame.close();
			heldFrame = frame;
			currentFrame = null;
			heldFrameSec = frameTimeSec;
		}

		// Flush remaining output frames for the last decoded frame.
		if (!decodeError && heldFrame && segmentIdx < segments.length) {
			while (!context.cancelled && segmentIdx < segments.length) {
				const segment = segments[segmentIdx];
				// A sample window can start between the final source frame and EOF.
				// Its one-frame read pre-roll is still eligible for that in-duration sample.
				const hasEligibleWindowPreroll =
					readWindow &&
					segmentIdx === 0 &&
					segment.startSec < effectiveVideoDuration &&
					heldFrameSec >= readWindow.startSec - epsilonSec;
				if (heldFrameSec < segment.startSec - epsilonSec && !hasEligibleWindowPreroll) {
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
	} finally {
		// Stop the producer before joining it: it may be asleep on backpressure
		// or waiting on a demux read while the renderer has finished/failed.
		stop();
		removeCancellationHandler?.();
		currentFrame?.close();
		heldFrame?.close();
		if (context.decoder && context.decoder.state !== "closed") {
			context.decoder.close();
		}
		await readerCancellation;
		await feedPromise;
		for (const frame of pendingFrames) frame.close();
		pendingFrames.length = 0;
		context.decoder = null;
	}

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
		throw buildVideoDecodeFailure(
			new Error(
				`Video decode ended early at ${lastDecodedFrameSec.toFixed(3)}s (needed ${requiredEndSec.toFixed(3)}s; rendered ${exportFrameIndex}/${expectedOutputFrames} frames).`,
			),
			getDecoderFailureContext(),
		);
	}
}
