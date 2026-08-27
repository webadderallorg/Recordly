import type { BodySegmenterInput } from "@tensorflow-models/body-segmentation";
import {
	normalizeWebcamBackgroundBlurSettings,
	type WebcamBackgroundBlurSettings,
} from "./webcamBackgroundBlur";

export type WebcamBackgroundBlurStatus = "idle" | "loading" | "ready" | "error";

export interface WebcamBackgroundBlurSnapshot {
	status: WebcamBackgroundBlurStatus;
	error: string | null;
}

export interface WebcamBlurRuntime {
	segmenter: {
		segmentPeople: (
			source: BodySegmenterInput,
			config?: { flipHorizontal?: boolean },
		) => Promise<unknown[]>;
		dispose: () => void;
	};
	drawBokehEffect: (
		canvas: HTMLCanvasElement,
		source: BodySegmenterInput,
		segmentations: unknown[],
		foregroundThreshold: number,
		backgroundBlurAmount: number,
		edgeBlurAmount: number,
		flipHorizontal: boolean,
	) => Promise<void>;
}

export interface WebcamBlurFrameOptions {
	amount: number;
	frameKey?: string | number;
}

type WebcamBlurRuntimeLoader = () => Promise<WebcamBlurRuntime>;

export interface WebcamBackgroundBlurEngineOptions {
	loader?: WebcamBlurRuntimeLoader;
	canvasFactory?: () => HTMLCanvasElement;
}

const FOREGROUND_THRESHOLD = 0.5;
const EDGE_BLUR_AMOUNT = 3;

function getErrorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : String(error);
}

function getSegmentationAssetBaseUrl(): string {
	return new URL("./webcam-segmentation", window.location.href).href;
}

async function loadDefaultRuntime(): Promise<WebcamBlurRuntime> {
	const [tf, bodySegmentation] = await Promise.all([
		import("@tensorflow/tfjs-core"),
		Promise.all([
			import("@tensorflow/tfjs-converter"),
			import("@tensorflow/tfjs-backend-webgl"),
			import("@mediapipe/selfie_segmentation"),
		]).then(() => import("@tensorflow-models/body-segmentation")),
	]);
	await tf.setBackend("webgl");
	await tf.ready();
	const segmenter = await bodySegmentation.createSegmenter(
		bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
		{
			runtime: "mediapipe",
			modelType: "landscape",
			solutionPath: getSegmentationAssetBaseUrl(),
		},
	);

	return {
		segmenter: segmenter as WebcamBlurRuntime["segmenter"],
		drawBokehEffect: async (...args) => {
			await bodySegmentation.drawBokehEffect(
				args[0],
				args[1],
				args[2] as never,
				args[3],
				args[4],
				args[5],
				args[6],
			);
		},
	};
}

export class WebcamBackgroundBlurEngine {
	private readonly loader: WebcamBlurRuntimeLoader;
	private readonly canvasFactory: () => HTMLCanvasElement;
	private readonly listeners = new Set<() => void>();
	private runtime: WebcamBlurRuntime | null = null;
	private loadPromise: Promise<WebcamBlurRuntime> | null = null;
	private outputCanvas: HTMLCanvasElement | null = null;
	private queue: Promise<void> = Promise.resolve();
	private generation = 0;
	private disposed = false;
	private lastFrameKey: string | number | undefined;
	private lastAmount: number | undefined;
	private snapshot: WebcamBackgroundBlurSnapshot = { status: "idle", error: null };

	constructor(options: WebcamBackgroundBlurEngineOptions = {}) {
		this.loader = options.loader ?? loadDefaultRuntime;
		this.canvasFactory = options.canvasFactory ?? (() => document.createElement("canvas"));
	}

	getSnapshot = (): WebcamBackgroundBlurSnapshot => this.snapshot;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	private setSnapshot(snapshot: WebcamBackgroundBlurSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}

	private async ensureRuntime(): Promise<WebcamBlurRuntime> {
		if (this.runtime) return this.runtime;
		if (this.loadPromise) return this.loadPromise;
		if (this.disposed) throw new Error("Webcam background blur engine is disposed");

		this.setSnapshot({ status: "loading", error: null });
		this.loadPromise = this.loader()
			.then((runtime) => {
				if (this.disposed) {
					runtime.segmenter.dispose();
					throw new Error("Webcam background blur engine was disposed while loading");
				}
				this.runtime = runtime;
				this.setSnapshot({ status: "ready", error: null });
				return runtime;
			})
			.catch((error) => {
				this.setSnapshot({ status: "error", error: getErrorMessage(error) });
				throw error;
			})
			.finally(() => {
				this.loadPromise = null;
			});
		return this.loadPromise;
	}

	private enqueue<T>(work: () => Promise<T>): Promise<T> {
		const result = this.queue.then(work, work);
		this.queue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async processFrame(
		source: BodySegmenterInput,
		options: WebcamBlurFrameOptions,
	): Promise<HTMLCanvasElement | null> {
		if (this.disposed || this.snapshot.status === "error") return null;
		const normalized: WebcamBackgroundBlurSettings = normalizeWebcamBackgroundBlurSettings({
			enabled: true,
			amount: options.amount,
		});
		if (
			options.frameKey !== undefined &&
			options.frameKey === this.lastFrameKey &&
			normalized.amount === this.lastAmount &&
			this.outputCanvas
		) {
			return this.outputCanvas;
		}

		const requestGeneration = this.generation;
		return this.enqueue(async () => {
			if (requestGeneration !== this.generation || this.disposed) return null;
			if (
				options.frameKey !== undefined &&
				options.frameKey === this.lastFrameKey &&
				normalized.amount === this.lastAmount &&
				this.outputCanvas
			) {
				return this.outputCanvas;
			}

			try {
				const runtime = await this.ensureRuntime();
				if (requestGeneration !== this.generation || this.disposed) return null;
				const segmentations = await runtime.segmenter.segmentPeople(source, {
					flipHorizontal: false,
				});
				if (requestGeneration !== this.generation || this.disposed) return null;
				this.outputCanvas ??= this.canvasFactory();
				await runtime.drawBokehEffect(
					this.outputCanvas,
					source,
					segmentations,
					FOREGROUND_THRESHOLD,
					normalized.amount,
					EDGE_BLUR_AMOUNT,
					false,
				);
				if (requestGeneration !== this.generation || this.disposed) return null;
				this.lastFrameKey = options.frameKey;
				this.lastAmount = normalized.amount;
				return this.outputCanvas;
			} catch (error) {
				this.setSnapshot({ status: "error", error: getErrorMessage(error) });
				return null;
			}
		});
	}

	invalidate(): void {
		this.generation += 1;
		this.lastFrameKey = undefined;
		this.lastAmount = undefined;
	}

	retry(): void {
		this.invalidate();
		this.runtime?.segmenter.dispose();
		this.runtime = null;
		this.loadPromise = null;
		this.setSnapshot({ status: "idle", error: null });
	}

	dispose(): void {
		this.disposed = true;
		this.invalidate();
		this.runtime?.segmenter.dispose();
		this.runtime = null;
		this.listeners.clear();
	}
}

let sharedWebcamBackgroundBlurEngine: WebcamBackgroundBlurEngine | null = null;

export function getSharedWebcamBackgroundBlurEngine(): WebcamBackgroundBlurEngine {
	sharedWebcamBackgroundBlurEngine ??= new WebcamBackgroundBlurEngine();
	return sharedWebcamBackgroundBlurEngine;
}
