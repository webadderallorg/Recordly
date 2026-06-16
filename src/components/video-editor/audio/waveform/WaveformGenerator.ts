import WorkerConstructor from "./waveform.worker?worker";
import type { AudioPeaksData } from "../../timeline/core/timelineTypes";
import { WAVEFORM_DEFAULT_PEAK_COUNT } from "../../timeline/core/constants";

const MAX_WAVEFORM_PEAKS = 200_000;

// Waveform peaks only need coarse amplitude data (~500 peaks/sec), so decode at
// a low sample rate. Decoding long recordings at the native 48kHz allocates
// gigabytes of PCM (50min stereo float32 ≈ 1.15 GB per file) and OOMs the
// renderer; 8kHz cuts that 6x while remaining visually identical.
const WAVEFORM_DECODE_SAMPLE_RATE = 8000;

export class WaveformGenerator {
	private worker: Worker;
	private peaksCache = new Map<string, AudioPeaksData>();
	private pending = new Map<string, Promise<AudioPeaksData>>();
	private workerRequestSeq = 0;
	private workerResolvers = new Map<number, { resolve: (peaks: Float32Array) => void; reject: (err: Error) => void }>();

	constructor() {
		this.worker = new WorkerConstructor();
		
		this.worker.addEventListener(
			"message",
			(event: MessageEvent<{ requestId: number; peaks?: Float32Array; error?: string }>) => {
				const { requestId, peaks, error } = event.data;
				const resolver = this.workerResolvers.get(requestId);
				if (!resolver) return;
				
				this.workerResolvers.delete(requestId);
				if (error) {
					resolver.reject(new Error(error));
				} else if (peaks) {
					resolver.resolve(peaks);
				}
			},
		);

		this.worker.addEventListener("error", (error: ErrorEvent) => {
			console.error("[WaveformGenerator] Worker fatal error:", error);
			const fatalError = error.error ?? new Error(error.message || "Worker crashed");
			
			// Reject all pending requests if the worker itself crashes
			for (const resolver of this.workerResolvers.values()) {
				resolver.reject(fatalError);
			}
			this.workerResolvers.clear();
		});
	}

	private computePeaksWithWorker(channels: Float32Array[], samples: number): Promise<Float32Array> {
		return new Promise((resolve, reject) => {
			const requestId = ++this.workerRequestSeq;
			this.workerResolvers.set(requestId, { resolve, reject });
			
			this.worker.postMessage(
				{
					requestId,
					channels,
					samples,
				},
				channels.map(c => c.buffer),
			);
		});
	}

	// Files larger than this threshold are skipped to avoid OOMing the renderer.
	// Audio sidecars are typically <100 MB; main video files can be several GB.
	static readonly MAX_DECODE_BYTES = 200 * 1024 * 1024; // 200 MB

	public async generate(url: string, peakCount = WAVEFORM_DEFAULT_PEAK_COUNT): Promise<AudioPeaksData> {
		const cacheKey = `${url}::${peakCount}`;
		const cached = this.peaksCache.get(cacheKey);
		if (cached) return cached;

		const inflight = this.pending.get(cacheKey);
		if (inflight) return inflight;

		const request = (async () => {
			const headResponse = await fetch(url, { method: "HEAD" });
			if (!headResponse.ok) {
				throw new Error(`Failed to probe media: ${headResponse.status}`);
			}
			const contentLength = parseInt(headResponse.headers.get("content-length") ?? "0", 10);
			if (contentLength > WaveformGenerator.MAX_DECODE_BYTES) {
				throw new Error(
					`File too large for in-memory audio decode (${Math.round(contentLength / 1024 / 1024)} MB)`,
				);
			}

			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`Failed to load media: ${response.status}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			// A throwaway OfflineAudioContext decodes (and resamples) at the low
			// waveform rate instead of the hardware rate of a live AudioContext.
			const decodeContext = new OfflineAudioContext({
				numberOfChannels: 1,
				length: 1,
				sampleRate: WAVEFORM_DECODE_SAMPLE_RATE,
			});
			const decoded = await decodeContext.decodeAudioData(arrayBuffer);
			const adaptivePeakCount = Math.max(
				peakCount,
				Math.floor(decoded.duration * 500)
			);
			const boundedPeakCount = Math.min(adaptivePeakCount, MAX_WAVEFORM_PEAKS);
			const channels: Float32Array[] = [];
			for (let i = 0; i < decoded.numberOfChannels; i++) {
				// We slice to transfer the underlying buffer to the worker
				channels.push(decoded.getChannelData(i).slice());
			}
			
			const peaks = await this.computePeaksWithWorker(channels, boundedPeakCount);

			// Robust Normalization: Use 99.5th percentile to avoid being squashed by a single loud spike/pop
			let max = 0;
			const sortedPeaks = [...peaks].sort((a, b) => a - b);
			const percentileIndex = Math.floor(sortedPeaks.length * 0.995);
			const robustMax = sortedPeaks[percentileIndex] || 0;

			// Fallback to absolute max if the percentile is zero (very quiet file)
			if (robustMax === 0) {
				for (let i = 0; i < peaks.length; i++) {
					if (peaks[i] > max) max = peaks[i];
				}
			} else {
				max = robustMax;
			}

			if (max > 0) {
				for (let i = 0; i < peaks.length; i++) {
					peaks[i] = Math.min(1.0, peaks[i] / max);
				}
			}

			const result: AudioPeaksData = {
				peaks,
				durationMs: decoded.duration * 1000,
			};
			this.peaksCache.set(cacheKey, result);
			this.pending.delete(cacheKey);
			return result;
		})().catch((error) => {
			this.pending.delete(cacheKey);
			throw error;
		});

		this.pending.set(cacheKey, request);
		return request;
	}
}

export const waveformGenerator = new WaveformGenerator();
