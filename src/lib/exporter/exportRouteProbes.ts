import { withMediaDeadline } from "./mediaDeadline";
import { getVideoDecoderConfig } from "./videoDecoderConfig";
import { loadVideoDemuxerMetadata } from "./videoDemuxerMetadata";

/**
 * Small background checks of a fast path that this device previously had to avoid.
 * Each one exercises the same component that failed, on a few seconds of work, and
 * answers only "healthy" (true) or "not proven healthy" (false): any error, timeout
 * or unsupported configuration keeps the remembered safe route.
 */
const PROBE_TIMEOUT_MS = 8_000;
const DECODE_PROBE_CHUNKS = 90;
const DECODE_PROBE_MIN_FRAMES = 5;
const DECODE_PROBE_WINDOW_SEC = 3.5;
const ENCODE_PROBE_FRAMES = 30;
const QUEUE_LIMIT = 12;
const QUEUE_RECHECK_MS = 20;

const ignoreDiagnostic = (): void => undefined;

function waitBriefly(signal: AbortSignal, wakeOn?: (wake: () => void) => void) {
	return new Promise<void>((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, QUEUE_RECHECK_MS);
		signal.addEventListener("abort", done, { once: true });
		wakeOn?.(done);
	});
}

/** Can the default (hardware-preferred) decoder produce frames from this source again? */
export async function probeHardwareVideoDecode(
	videoUrl: string,
	signal: AbortSignal,
): Promise<boolean> {
	if (typeof VideoDecoder === "undefined") return false;
	let loaded: Awaited<ReturnType<typeof loadVideoDemuxerMetadata>> | undefined;
	let decoder: VideoDecoder | undefined;
	let reader: ReadableStreamDefaultReader<EncodedVideoChunk> | undefined;
	try {
		// Probe diagnostics would read as failures of the export running alongside.
		loaded = await loadVideoDemuxerMetadata(videoUrl, signal, false, ignoreDiagnostic);
		const { demuxer, mediaInfo } = loaded;
		const config = await getVideoDecoderConfig(demuxer, signal);
		// AV1 always decodes in software, so there is no hardware path to re-test.
		if (/^av01|av1/i.test(config.codec)) return false;
		let outputs = 0;
		let failed = false;
		let wake: (() => void) | null = null;
		const notify = () => {
			const resolve = wake;
			wake = null;
			resolve?.();
		};
		const activeDecoder = new VideoDecoder({
			output: (frame) => {
				frame.close();
				outputs++;
				notify();
			},
			error: () => {
				failed = true;
				notify();
			},
		});
		decoder = activeDecoder;
		activeDecoder.ondequeue = notify;
		// The export's first attempt uses this same default configuration.
		activeDecoder.configure(config);
		const startSec =
			typeof mediaInfo.start_time === "number" && Number.isFinite(mediaInfo.start_time)
				? mediaInfo.start_time
				: 0;
		const activeReader = demuxer
			.read("video", startSec, startSec + DECODE_PROBE_WINDOW_SEC)
			.getReader();
		reader = activeReader;
		return await withMediaDeadline(
			async (attemptSignal) => {
				let submitted = 0;
				while (submitted < DECODE_PROBE_CHUNKS && !failed) {
					const { done, value } = await activeReader.read();
					attemptSignal.throwIfAborted();
					if (done || !value) break;
					while (activeDecoder.decodeQueueSize > QUEUE_LIMIT && !failed) {
						await waitBriefly(attemptSignal, (resolve) => {
							wake = resolve;
						});
						attemptSignal.throwIfAborted();
					}
					activeDecoder.decode(value);
					submitted++;
				}
				if (failed || submitted === 0) return false;
				await activeDecoder.flush();
				return !failed && outputs >= Math.min(DECODE_PROBE_MIN_FRAMES, submitted);
			},
			{ signal, timeoutMs: PROBE_TIMEOUT_MS, message: "Hardware decode probe timed out" },
		);
	} catch {
		return false;
	} finally {
		reader?.cancel().catch(() => undefined);
		try {
			if (decoder && decoder.state !== "closed") decoder.close();
		} catch {
			// The probe result is already decided.
		}
		try {
			loaded?.demuxer.destroy();
		} catch {
			// A stuck worker is terminated by destroy; nothing else to release.
		}
	}
}

/** Can the hardware H.264 encoder produce output at this export size again? */
export async function probeHardwareH264Encode(
	options: {
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		codec?: string;
		annexB: boolean;
	},
	signal: AbortSignal,
): Promise<boolean> {
	if (typeof VideoEncoder === "undefined" || typeof OffscreenCanvas === "undefined") return false;
	const config: VideoEncoderConfig = {
		codec: options.codec ?? "avc1.640034",
		width: options.width,
		height: options.height,
		bitrate: options.bitrate,
		framerate: options.frameRate,
		hardwareAcceleration: "prefer-hardware",
		...(options.annexB ? { avc: { format: "annexb" as const } } : {}),
	};
	let encoder: VideoEncoder | undefined;
	try {
		const support = await VideoEncoder.isConfigSupported(config);
		if (!support.supported || signal.aborted) return false;
		let chunks = 0;
		let failed = false;
		const activeEncoder = new VideoEncoder({
			output: () => {
				chunks++;
			},
			error: () => {
				failed = true;
			},
		});
		encoder = activeEncoder;
		const canvas = new OffscreenCanvas(options.width, options.height);
		const context = canvas.getContext("2d");
		if (!context) return false;
		return await withMediaDeadline(
			async (attemptSignal) => {
				activeEncoder.configure(config);
				for (let index = 0; index < ENCODE_PROBE_FRAMES && !failed; index++) {
					context.fillStyle = `hsl(${(index * 12) % 360} 60% 50%)`;
					context.fillRect(0, 0, options.width, options.height);
					const frame = new VideoFrame(canvas, {
						timestamp: Math.round((index * 1_000_000) / options.frameRate),
					});
					try {
						activeEncoder.encode(frame, { keyFrame: index === 0 });
					} finally {
						frame.close();
					}
					while (activeEncoder.encodeQueueSize > 4 && !failed) {
						await waitBriefly(attemptSignal);
						attemptSignal.throwIfAborted();
					}
				}
				if (failed) return false;
				await activeEncoder.flush();
				return !failed && chunks > 0;
			},
			{ signal, timeoutMs: PROBE_TIMEOUT_MS, message: "Hardware encode probe timed out" },
		);
	} catch {
		return false;
	} finally {
		try {
			if (encoder && encoder.state !== "closed") encoder.close();
		} catch {
			// The probe result is already decided.
		}
	}
}
