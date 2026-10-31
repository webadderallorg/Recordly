import type { SpeedRegion } from "@/components/video-editor/types";
import { AudioProcessorBase } from "./audioProcessorBase";
import type { TimelineSlice, TrimLikeRegion } from "./audioProcessorShared";

export class AudioTimelineProcessor extends AudioProcessorBase {
	protected buildTimelineSlices(
		sourceDurationMs: number,
		trimRegions: TrimLikeRegion[],
		speedRegions: SpeedRegion[],
	): TimelineSlice[] {
		const boundaries = new Set<number>();
		boundaries.add(0);
		boundaries.add(sourceDurationMs);

		for (const trim of trimRegions) {
			if (trim.startMs >= 0 && trim.startMs <= sourceDurationMs) boundaries.add(trim.startMs);
			if (trim.endMs >= 0 && trim.endMs <= sourceDurationMs) boundaries.add(trim.endMs);
		}
		for (const speed of speedRegions) {
			if (speed.startMs >= 0 && speed.startMs <= sourceDurationMs)
				boundaries.add(speed.startMs);
			if (speed.endMs >= 0 && speed.endMs <= sourceDurationMs) boundaries.add(speed.endMs);
		}

		const sorted = [...boundaries].sort((a, b) => a - b);
		const slices: TimelineSlice[] = [];

		for (let i = 0; i < sorted.length - 1; i++) {
			const start = sorted[i];
			const end = sorted[i + 1];
			if (end - start < 0.001) continue;

			// Skip segments entirely inside a trim region
			const midpoint = (start + end) / 2;
			if (this.isInTrimRegion(midpoint, trimRegions)) continue;

			const speedRegion = speedRegions.find(
				(s) => midpoint >= s.startMs && midpoint < s.endMs,
			);

			slices.push({
				sourceStartMs: start,
				sourceEndMs: end,
				speed: speedRegion?.speed ?? 1,
			});
		}

		return slices;
	}

	// Map a source-timeline timestamp to the corresponding output-timeline timestamp.
	protected sourceTimeToOutputTime(sourceMs: number, slices: TimelineSlice[]): number {
		let outputMs = 0;

		for (const slice of slices) {
			if (sourceMs <= slice.sourceStartMs) {
				return outputMs;
			}
			const sliceDurationMs = slice.sourceEndMs - slice.sourceStartMs;
			if (sourceMs >= slice.sourceEndMs) {
				outputMs += sliceDurationMs / slice.speed;
				continue;
			}
			// Source time falls within this slice
			outputMs += (sourceMs - slice.sourceStartMs) / slice.speed;
			return outputMs;
		}

		return outputMs;
	}

	// Schedule an AudioBuffer through the timeline slices in an OfflineAudioContext.
	// Each non-trimmed segment creates an AudioBufferSourceNode with the appropriate
	// playbackRate for speed regions. When chunkOutputStartSec/chunkDurationSec are
	// provided, only sources overlapping the chunk window are scheduled.
	protected scheduleBufferThroughTimeline(
		ctx: OfflineAudioContext,
		buffer: AudioBuffer,
		slices: TimelineSlice[],
		sourceStartDelaySec: number,
		gain = 1,
		chunkOutputStartSec = 0,
		chunkDurationSec = Number.POSITIVE_INFINITY,
		mutedOutputRangesSec: Array<{ startSec: number; endSec: number }> = [],
	): void {
		let outputOffsetSec = 0;

		for (const slice of slices) {
			const sliceSourceDurationSec = (slice.sourceEndMs - slice.sourceStartMs) / 1000;
			if (slice.outputStartMs !== undefined) outputOffsetSec = slice.outputStartMs / 1000;
			const sliceOutputDurationSec = sliceSourceDurationSec / slice.speed;

			// Where in the buffer does this slice read from?
			const bufferOffsetSec = slice.sourceStartMs / 1000 - sourceStartDelaySec;

			// Skip if slice doesn't overlap with the buffer at all
			if (
				bufferOffsetSec + sliceSourceDurationSec <= 0 ||
				bufferOffsetSec >= buffer.duration
			) {
				outputOffsetSec += sliceOutputDurationSec;
				continue;
			}

			// Clamp to buffer bounds
			let effectiveBufferStartSec = Math.max(0, bufferOffsetSec);
			const trimmedFromStartSec = effectiveBufferStartSec - bufferOffsetSec;
			let effectiveSourceDurationSec = Math.min(
				sliceSourceDurationSec - trimmedFromStartSec,
				buffer.duration - effectiveBufferStartSec,
			);

			if (effectiveSourceDurationSec <= 0.001) {
				outputOffsetSec += sliceOutputDurationSec;
				continue;
			}

			// Calculate output position (global then chunk-local)
			let localOutputStartSec =
				outputOffsetSec + trimmedFromStartSec / slice.speed - chunkOutputStartSec;
			let localOutputEndSec = localOutputStartSec + effectiveSourceDurationSec / slice.speed;

			// Skip if entirely outside chunk window
			if (localOutputEndSec <= 0 || localOutputStartSec >= chunkDurationSec) {
				outputOffsetSec += sliceOutputDurationSec;
				continue;
			}

			// Clip to chunk start
			if (localOutputStartSec < 0) {
				const skipOutputSec = -localOutputStartSec;
				const skipSourceSec = skipOutputSec * slice.speed;
				effectiveBufferStartSec += skipSourceSec;
				effectiveSourceDurationSec -= skipSourceSec;
				localOutputStartSec = 0;
			}

			// Clip to chunk end
			if (localOutputEndSec > chunkDurationSec) {
				const excessOutputSec = localOutputEndSec - chunkDurationSec;
				effectiveSourceDurationSec -= excessOutputSec * slice.speed;
			}

			if (effectiveSourceDurationSec <= 0.001) {
				outputOffsetSec += sliceOutputDurationSec;
				continue;
			}

			const audibleRanges: Array<{ startSec: number; endSec: number }> = [
				{
					startSec: localOutputStartSec + chunkOutputStartSec,
					endSec:
						localOutputStartSec +
						chunkOutputStartSec +
						effectiveSourceDurationSec / slice.speed,
				},
			];
			for (const mutedRange of mutedOutputRangesSec) {
				for (let rangeIndex = audibleRanges.length - 1; rangeIndex >= 0; rangeIndex -= 1) {
					const current = audibleRanges[rangeIndex];
					const overlapStart = Math.max(current.startSec, mutedRange.startSec);
					const overlapEnd = Math.min(current.endSec, mutedRange.endSec);
					if (overlapEnd <= overlapStart) {
						continue;
					}
					audibleRanges.splice(rangeIndex, 1);
					if (current.startSec < overlapStart) {
						audibleRanges.push({ startSec: current.startSec, endSec: overlapStart });
					}
					if (overlapEnd < current.endSec) {
						audibleRanges.push({ startSec: overlapEnd, endSec: current.endSec });
					}
				}
			}

			for (const audibleRange of audibleRanges) {
				const audibleDurationSec = audibleRange.endSec - audibleRange.startSec;
				if (audibleDurationSec <= 0.001) {
					continue;
				}
				const source = ctx.createBufferSource();
				const gainNode = ctx.createGain();
				gainNode.gain.value = Math.max(0, Math.min(2, gain));

				const sourceOffsetSec =
					effectiveBufferStartSec +
					(audibleRange.startSec - (localOutputStartSec + chunkOutputStartSec)) *
						slice.speed;
				const localStartSec = audibleRange.startSec - chunkOutputStartSec;
				const sourceDurationSec = audibleDurationSec * slice.speed;

				const stretchedBuffer = this.stretchAudioBuffer(
					buffer,
					slice.speed,
					sourceOffsetSec,
					sourceDurationSec,
					audibleDurationSec,
					ctx,
				);

				source.buffer = stretchedBuffer;
				source.playbackRate.value = 1;
				source.connect(gainNode);
				gainNode.connect(ctx.destination);

				source.start(localStartSec);
			}

			outputOffsetSec += sliceOutputDurationSec;
		}
	}

	protected stretchAudioBuffer(
		originalBuffer: AudioBuffer,
		speed: number,
		sourceOffsetSec: number,
		sourceDurationSec: number,
		audibleDurationSec: number,
		ctx: BaseAudioContext,
	): AudioBuffer {
		const sampleRate = originalBuffer.sampleRate;
		const channels = originalBuffer.numberOfChannels;

		const startSample = Math.max(0, Math.floor(sourceOffsetSec * sampleRate));
		const sourceSamples = Math.floor(sourceDurationSec * sampleRate);
		const endSample = Math.min(originalBuffer.length, startSample + sourceSamples);

		const outSamples = Math.floor(audibleDurationSec * sampleRate);
		if (outSamples <= 0 || startSample >= originalBuffer.length) {
			return ctx.createBuffer(channels, 1, sampleRate);
		}

		const outBuffer = ctx.createBuffer(channels, outSamples, sampleRate);

		if (Math.abs(speed - 1) < 0.001) {
			const copyLength = Math.min(endSample - startSample, outSamples);
			if (copyLength > 0) {
				for (let c = 0; c < channels; c++) {
					outBuffer.copyToChannel(
						originalBuffer
							.getChannelData(c)
							.subarray(startSample, startSample + copyLength),
						c,
					);
				}
			}
			return outBuffer;
		}

		// WSOLA uses windowing which causes fade-in at the start and fade-out at the end.
		// To avoid clicks at chunk boundaries, we render with 100ms of padding and trim it.
		const paddingSec = 0.1;
		const paddingOutSamples = Math.floor(sampleRate * paddingSec);
		const paddingInSamples = Math.floor(paddingOutSamples * speed);

		const workStartIn = Math.max(0, startSample - paddingInSamples);
		const workEndIn = Math.min(originalBuffer.length, endSample + paddingInSamples);

		const actualPaddingInStart = startSample - workStartIn;
		// We expect the output offset for the requested start to be roughly:
		const actualPaddingOutStart = Math.floor(actualPaddingInStart / speed);

		const windowSize = Math.floor(sampleRate * 0.04);
		const hopOut = Math.floor(windowSize * 0.5);
		const hopIn = Math.floor(hopOut * speed);
		const searchRange = Math.floor(sampleRate * 0.015);

		const workOutSamples = Math.floor((workEndIn - workStartIn) / speed) + windowSize * 2;
		const workOutBuffer = ctx.createBuffer(channels, workOutSamples, sampleRate);

		const inDataByChannel = Array.from({ length: channels }, (_, c) =>
			originalBuffer.getChannelData(c),
		);
		const workOutDataByChannel = Array.from({ length: channels }, (_, c) =>
			workOutBuffer.getChannelData(c),
		);

		const window = new Float32Array(windowSize);
		for (let i = 0; i < windowSize; i++) {
			window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
		}

		let inOffset = workStartIn;
		let outOffset = 0;

		// Initial window
		for (let i = 0; i < windowSize; i++) {
			if (inOffset + i < workEndIn && outOffset + i < workOutSamples) {
				for (let c = 0; c < channels; c++) {
					workOutDataByChannel[c][outOffset + i] +=
						inDataByChannel[c][inOffset + i] * window[i];
				}
			}
		}

		outOffset += hopOut;
		inOffset += hopIn;

		while (outOffset + windowSize < workOutSamples && inOffset + windowSize < workEndIn) {
			let bestOffset = inOffset;
			const minSearch = Math.max(workStartIn, inOffset - searchRange);
			const maxSearch = Math.min(workEndIn - windowSize, inOffset + searchRange);

			if (maxSearch > minSearch) {
				let maxCorr = -Infinity;
				let bestDelta = 0;

				for (let testOffset = minSearch; testOffset <= maxSearch; testOffset += 4) {
					let corr = 0;
					for (let i = 0; i < hopOut; i += 4) {
						if (outOffset + i < workOutSamples && testOffset + i < workEndIn) {
							for (let c = 0; c < channels; c++) {
								corr +=
									workOutDataByChannel[c][outOffset + i] *
									inDataByChannel[c][testOffset + i];
							}
						}
					}
					if (corr > maxCorr) {
						maxCorr = corr;
						bestDelta = testOffset - inOffset;
					}
				}
				bestOffset = inOffset + bestDelta;
			}

			for (let i = 0; i < windowSize; i++) {
				if (bestOffset + i < workEndIn && outOffset + i < workOutSamples) {
					for (let c = 0; c < channels; c++) {
						workOutDataByChannel[c][outOffset + i] +=
							inDataByChannel[c][bestOffset + i] * window[i];
					}
				}
			}

			outOffset += hopOut;
			inOffset += hopIn;
		}

		// Transfer the stable middle portion to the final buffer
		for (let c = 0; c < channels; c++) {
			const finalData = outBuffer.getChannelData(c);
			const tempData = workOutBuffer.getChannelData(c);
			for (let i = 0; i < outSamples; i++) {
				const srcIdx = actualPaddingOutStart + i;
				if (srcIdx < workOutSamples) {
					finalData[i] = tempData[srcIdx];
				}
			}
		}

		return outBuffer;
	}

	// Create a WAV file header for the given audio parameters.
}
