import {
	FilesetResolver,
	ImageSegmenter,
	type ImageSegmenterResult,
} from "@mediapipe/tasks-vision";

export type BackgroundMode = "none" | "blur" | "color" | "image";

export type BackgroundEffectOptions = {
	mode: BackgroundMode;
	blurIntensity: number;
	color: string;
	imageDataUrl: string | null;
};

export const DEFAULT_BACKGROUND_OPTIONS: BackgroundEffectOptions = {
	mode: "none",
	blurIntensity: 50,
	color: "#1f2937",
	imageDataUrl: null,
};

const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/selfie_segmenter.tflite";
const SEGMENTATION_WIDTH = 256;
const SEGMENTATION_HEIGHT = 256;
const MAX_BLUR_PX = 24;

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function loadSegmenter(): Promise<ImageSegmenter> {
	if (!segmenterPromise) {
		segmenterPromise = (async () => {
			const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
			return ImageSegmenter.createFromOptions(fileset, {
				baseOptions: {
					modelAssetPath: MODEL_PATH,
					delegate: "GPU",
				},
				runningMode: "VIDEO",
				outputCategoryMask: true,
				outputConfidenceMasks: false,
			});
		})().catch((error) => {
			segmenterPromise = null;
			throw error;
		});
	}
	return segmenterPromise;
}

export type ProcessedStream = {
	stream: MediaStream;
	stop: () => void;
};

type Internals = {
	cancelled: boolean;
	rafHandle: number | null;
	video: HTMLVideoElement;
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	maskCanvas: HTMLCanvasElement;
	maskCtx: CanvasRenderingContext2D;
	bgImage: HTMLImageElement | null;
	bgImageUrl: string | null;
};

/**
 * Wrap a webcam MediaStream with a background effect (blur / solid color / image).
 * Returns a new MediaStream produced from a canvas. Caller owns both streams: the
 * input stream is NOT stopped here — only the processing pipeline.
 */
export async function createProcessedStream(
	input: MediaStream,
	getOptions: () => BackgroundEffectOptions,
): Promise<ProcessedStream> {
	const videoTrack = input.getVideoTracks()[0];
	if (!videoTrack) {
		throw new Error("createProcessedStream: input stream has no video track");
	}

	const settings = videoTrack.getSettings();
	const width = settings.width ?? 1280;
	const height = settings.height ?? 720;
	const frameRate = settings.frameRate ?? 30;

	const segmenter = await loadSegmenter();

	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.srcObject = input;
	await video.play();

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d", { alpha: false });
	if (!ctx) throw new Error("createProcessedStream: 2d context unavailable");

	const maskCanvas = document.createElement("canvas");
	maskCanvas.width = SEGMENTATION_WIDTH;
	maskCanvas.height = SEGMENTATION_HEIGHT;
	const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
	if (!maskCtx) throw new Error("createProcessedStream: mask 2d context unavailable");

	const state: Internals = {
		cancelled: false,
		rafHandle: null,
		video,
		canvas,
		ctx,
		maskCanvas,
		maskCtx,
		bgImage: null,
		bgImageUrl: null,
	};

	const ensureBgImage = (url: string | null) => {
		if (url === state.bgImageUrl) return;
		state.bgImageUrl = url;
		if (!url) {
			state.bgImage = null;
			return;
		}
		const img = new Image();
		img.onload = () => {
			if (state.bgImageUrl === url) state.bgImage = img;
		};
		img.onerror = () => {
			if (state.bgImageUrl === url) state.bgImage = null;
		};
		img.src = url;
	};

	const drawBackground = (opts: BackgroundEffectOptions) => {
		if (opts.mode === "blur") {
			const px = Math.max(0, Math.min(MAX_BLUR_PX, (opts.blurIntensity / 100) * MAX_BLUR_PX));
			ctx.filter = `blur(${px}px)`;
			ctx.drawImage(video, 0, 0, width, height);
			ctx.filter = "none";
			return;
		}
		if (opts.mode === "color") {
			ctx.fillStyle = opts.color || "#000";
			ctx.fillRect(0, 0, width, height);
			return;
		}
		if (opts.mode === "image" && state.bgImage) {
			// cover-fit
			const img = state.bgImage;
			const scale = Math.max(width / img.width, height / img.height);
			const w = img.width * scale;
			const h = img.height * scale;
			ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
			return;
		}
		// fallback: solid color
		ctx.fillStyle = opts.color || "#000";
		ctx.fillRect(0, 0, width, height);
	};

	const renderFrame = (timestampMs: number) => {
		if (state.cancelled) return;
		const opts = getOptions();
		ensureBgImage(opts.mode === "image" ? opts.imageDataUrl : null);

		if (opts.mode === "none" || video.readyState < 2) {
			ctx.filter = "none";
			ctx.drawImage(video, 0, 0, width, height);
			state.rafHandle = requestAnimationFrame(renderFrame);
			return;
		}

		try {
			const result: ImageSegmenterResult = segmenter.segmentForVideo(video, timestampMs);
			const mask = result.categoryMask;
			if (!mask) {
				ctx.filter = "none";
				ctx.drawImage(video, 0, 0, width, height);
				state.rafHandle = requestAnimationFrame(renderFrame);
				return;
			}

			const maskWidth = mask.width;
			const maskHeight = mask.height;
			const maskData = mask.getAsUint8Array();
			maskCanvas.width = maskWidth;
			maskCanvas.height = maskHeight;

			// Build an RGBA image where alpha = person likelihood.
			// MediaPipe selfie segmenter: category 0 = background, 1 = person.
			const rgba = maskCtx.createImageData(maskWidth, maskHeight);
			for (let i = 0; i < maskData.length; i++) {
				const isPerson = maskData[i] === 0 ? 0 : 255;
				rgba.data[i * 4] = 255;
				rgba.data[i * 4 + 1] = 255;
				rgba.data[i * 4 + 2] = 255;
				rgba.data[i * 4 + 3] = isPerson;
			}
			maskCtx.putImageData(rgba, 0, 0);
			mask.close();

			// 1. Draw background.
			ctx.globalCompositeOperation = "source-over";
			drawBackground(opts);

			// 2. Draw the person on top, masked.
			//    Use an offscreen step: draw mask scaled, set composite, draw video.
			ctx.save();
			ctx.globalCompositeOperation = "source-over";
			// Composite person into a temp by drawing video then masking with destination-in.
			// To avoid an extra canvas, we draw the mask first onto main canvas via a 2-step:
			//   - draw the video into a temp, mask it, then composite onto main.
			// Simplest: use a single offscreen canvas reused per frame.
			drawPersonOnTop(ctx, video, maskCanvas, width, height);
			ctx.restore();
		} catch (error) {
			console.warn(
				"Background effect: segmentation failed, falling back to passthrough",
				error,
			);
			ctx.filter = "none";
			ctx.drawImage(video, 0, 0, width, height);
		}

		state.rafHandle = requestAnimationFrame(renderFrame);
	};

	state.rafHandle = requestAnimationFrame(renderFrame);

	const outputStream = canvas.captureStream(frameRate);

	return {
		stream: outputStream,
		stop: () => {
			state.cancelled = true;
			if (state.rafHandle !== null) cancelAnimationFrame(state.rafHandle);
			outputStream.getTracks().forEach((t) => t.stop());
			try {
				video.pause();
			} catch {
				/* ignore */
			}
			video.srcObject = null;
		},
	};
}

let personScratch: HTMLCanvasElement | null = null;
let personScratchCtx: CanvasRenderingContext2D | null = null;

function drawPersonOnTop(
	dest: CanvasRenderingContext2D,
	video: HTMLVideoElement,
	maskCanvas: HTMLCanvasElement,
	width: number,
	height: number,
) {
	if (!personScratch) {
		personScratch = document.createElement("canvas");
		personScratchCtx = personScratch.getContext("2d");
	}
	if (!personScratchCtx) return;
	if (personScratch.width !== width || personScratch.height !== height) {
		personScratch.width = width;
		personScratch.height = height;
	}
	const sctx = personScratchCtx;
	sctx.globalCompositeOperation = "source-over";
	sctx.clearRect(0, 0, width, height);
	sctx.drawImage(video, 0, 0, width, height);
	sctx.globalCompositeOperation = "destination-in";
	sctx.imageSmoothingEnabled = true;
	sctx.drawImage(maskCanvas, 0, 0, width, height);
	sctx.globalCompositeOperation = "source-over";
	dest.drawImage(personScratch, 0, 0);
}
