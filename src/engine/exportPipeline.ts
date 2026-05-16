import { Muxer, ArrayBufferTarget } from "mp4-muxer";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExportOptions {
	duration: number;
	fps: 24 | 30 | 60;
	width: number;
	height: number;
	videoBitrate?: number;
	/** Called with 0–1 progress */
	onProgress?: (progress: number) => void;
	/**
	 * Per-frame render callback. The pipeline calls this for each frame time.
	 * The callback must render the scene to the given canvas at the given time.
	 */
	renderFrame: (canvas: OffscreenCanvas, time: number) => Promise<void>;
}

export interface ExportResult {
	blob: Blob;
	durationMs: number;
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportAnimation(opts: ExportOptions): Promise<ExportResult> {
	const { duration, fps, width, height, onProgress, renderFrame } = opts;
	const bitrate = opts.videoBitrate ?? 8_000_000;
	const totalFrames = Math.ceil(duration * fps);
	const frameInterval = 1_000_000 / fps; // microseconds per frame

	const target = new ArrayBufferTarget();
	const muxer = new Muxer({
		target,
		video: {
			codec: "avc",
			width,
			height,
		},
		fastStart: "in-memory",
	});

	const encoder = new VideoEncoder({
		output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
		error: (e) => console.error("VideoEncoder error:", e),
	});

	encoder.configure({
		codec: "avc1.4d0034", // H.264 High Profile
		width,
		height,
		bitrate,
		framerate: fps,
		latencyMode: "quality",
	});

	const offscreen = new OffscreenCanvas(width, height);
	const startMs = performance.now();

	for (let i = 0; i < totalFrames; i++) {
		const time = i / fps;
		const timestampUs = Math.round(i * frameInterval);

		await renderFrame(offscreen, time);

		const frame = new VideoFrame(offscreen, {
			timestamp: timestampUs,
			duration: frameInterval,
		});

		encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
		frame.close();

		onProgress?.((i + 1) / totalFrames);

		// Yield to the event loop every 10 frames to keep UI responsive
		if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
	}

	await encoder.flush();
	muxer.finalize();

	const buffer = target.buffer;
	const blob = new Blob([buffer], { type: "video/mp4" });

	return { blob, durationMs: performance.now() - startMs };
}

// ─── Download helper ──────────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
