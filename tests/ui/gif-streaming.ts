import GIF from "gif.js";
import { GifExporter } from "@/lib/exporter/gifExporter";
import { StreamingVideoDecoder } from "@/lib/exporter/streamingDecoder";
import { StreamingGifEncoder } from "@/lib/exporter/streamingGifEncoder";
import type { ExportProgress } from "@/lib/exporter/types";

const workerScript = new URL("gif.js/dist/gif.worker.js", import.meta.url).toString();
type Decoder = {
	tracks: {
		ready: Promise<void>;
		selectedTrack: { frameCount: number; repetitionCount: number };
	};
	decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
	close(): void;
};
const ImageDecoder = (window as unknown as { ImageDecoder: new (options: object) => Decoder })
	.ImageDecoder;
async function inspect(blob: Blob) {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const decoder = new ImageDecoder({ data: bytes, type: "image/gif" });
	try {
		await decoder.tracks.ready;
		const track = decoder.tracks.selectedTrack;
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d")!;
		const frames = [];
		for (let i = 0; i < track.frameCount; i++) {
			const { image } = await decoder.decode({ frameIndex: i });
			try {
				canvas.width = image.displayWidth;
				canvas.height = image.displayHeight;
				context.drawImage(image, 0, 0);
				const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
				let hash = 2166136261;
				for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
				frames.push({
					hash,
					duration: image.duration,
					width: canvas.width,
					height: canvas.height,
				});
			} finally {
				image.close();
			}
		}
		return {
			frames,
			loop: track.repetitionCount,
			header: String.fromCharCode(...bytes.subarray(0, 6)),
			trailer: bytes[bytes.length - 1],
			size: bytes.length,
		};
	} finally {
		decoder.close();
	}
}
async function compare() {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 48;
	const context = canvas.getContext("2d")!;
	const streaming = new StreamingGifEncoder({ width: 48, height: 48, repeat: 0, workerScript });
	const legacy = new GIF({
		workers: 4,
		width: 48,
		height: 48,
		quality: 10,
		workerScript,
		repeat: 0,
		transparent: null,
		dither: "FloydSteinberg",
	});
	try {
		for (let i = 0; i < 24; i++) {
			context.clearRect(0, 0, 48, 48);
			context.globalAlpha = i % 2 ? 0.5 : 1;
			context.fillStyle = `hsl(${i * 15} 70% 50%)`;
			context.fillRect(0, 0, 48, 48);
			context.fillStyle = "#fff";
			context.fillRect(i, i, 10, 10);
			context.globalAlpha = 1;
			legacy.addFrame(canvas, { delay: 40, copy: true });
			await streaming.addFrame(canvas, 40);
		}
		const streamed = await streaming.finish();
		const original = await new Promise<Blob>((resolve) => {
			legacy.on("finished", resolve);
			legacy.render();
		});
		return { streamed: await inspect(streamed), original: await inspect(original) };
	} finally {
		streaming.abort();
		legacy.abort();
	}
}
async function exportVideo(estimate = false) {
	const progress: ExportProgress[] = [];
	const exporter = new GifExporter({
		videoUrl: new URL("./fixtures/filmstrip.mp4", import.meta.url).href,
		width: 160,
		height: 90,
		frameRate: 15,
		loop: true,
		sizePreset: "original",
		wallpaper: "#101010",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		onProgress: (update) => progress.push(update),
	});
	if (estimate) return exporter.estimateSize();
	const result = await exporter.export();
	if (!result.success || !result.blob) throw new Error(result.error || "Export failed");
	return {
		gif: await inspect(result.blob),
		percentages: progress.map((p) => p.percentage),
		phases: progress.map((p) => p.phase),
		totalFrames: progress.at(-1)?.totalFrames,
	};
}
async function compareSampleDecode() {
	const decoder = new StreamingVideoDecoder();
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d")!;
	const inspectFrame = (
		frame: VideoFrame | null,
		exportTimestampUs: number,
		sourceTimestampMs: number,
		cursorTimestampMs: number,
	) => {
		if (!frame) throw new Error("Unexpected gap in filmstrip fixture");
		canvas.width = frame.displayWidth;
		canvas.height = frame.displayHeight;
		context.drawImage(frame, 0, 0);
		let hash = 2166136261;
		for (const byte of context.getImageData(0, 0, canvas.width, canvas.height).data)
			hash = Math.imul(hash ^ byte, 16777619) >>> 0;
		return { hash, exportTimestampUs, sourceTimestampMs, cursorTimestampMs };
	};
	type FrameInspection = ReturnType<typeof inspectFrame>;
	const complete: FrameInspection[] = [];
	const sample: FrameInspection[] = [];
	try {
		await decoder.loadMetadata(new URL("./fixtures/filmstrip.mp4", import.meta.url).href);
		await decoder.decodeAll(15, undefined, undefined, async (...args) => {
			complete.push(inspectFrame(...args));
		});
		await decoder.decodeSampleWindow(
			15,
			undefined,
			undefined,
			async (...args) => {
				sample.push(inspectFrame(...args));
			},
			undefined,
			15,
			60,
		);
		return { completeFrameCount: complete.length, expected: complete.slice(15, 75), sample };
	} finally {
		decoder.destroy();
	}
}

function button(id: string, run: () => Promise<unknown>) {
	document.getElementById(id)!.onclick = async () => {
		const output = document.getElementById("result")!;
		output.textContent = "working";
		try {
			output.textContent = JSON.stringify(await run());
		} catch (error) {
			output.textContent = JSON.stringify({ error: String(error) });
		}
	};
}
button("encode", compare);
button("export", () => exportVideo());
button("estimate", () => exportVideo(true));

button("sample-decode", compareSampleDecode);
