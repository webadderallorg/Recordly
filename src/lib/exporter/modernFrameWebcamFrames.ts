import {
	getWebcamCropSourceRect,
	isWebcamCropRegionDefault,
} from "@/components/video-editor/webcamOverlay";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { WebcamRenderSource } from "./modernFrameTypes";
import { configureHighQuality2DContext } from "./modernFrameUtils";

/** Owns webcam frames resources for one export renderer. */
export class FrameWebcamFrames {
	constructor(private readonly context: Pick<FrameRenderContext, "config">) {}

	webcamFrameCacheCanvas: HTMLCanvasElement | null = null;

	webcamFrameCacheCtx: CanvasRenderingContext2D | null = null;

	webcamRenderMode: "hidden" | "live" | "cached" = "hidden";

	setWebcamRenderMode(nextMode: "hidden" | "live" | "cached"): void {
		if (this.webcamRenderMode === nextMode) {
			return;
		}

		if (nextMode === "cached") {
			console.log("[FrameRenderer] Webcam export source fell back to the last synced frame");
		} else if (this.webcamRenderMode === "cached" && nextMode === "live") {
			console.log("[FrameRenderer] Webcam export source resynchronized");
		}

		this.webcamRenderMode = nextMode;
	}

	ensureWebcamFrameCache(width: number, height: number): boolean {
		const targetWidth = Math.max(1, Math.ceil(width));
		const targetHeight = Math.max(1, Math.ceil(height));

		if (
			this.webcamFrameCacheCanvas &&
			this.webcamFrameCacheCanvas.width === targetWidth &&
			this.webcamFrameCacheCanvas.height === targetHeight &&
			this.webcamFrameCacheCtx
		) {
			return true;
		}

		this.webcamFrameCacheCanvas = document.createElement("canvas");
		this.webcamFrameCacheCanvas.width = targetWidth;
		this.webcamFrameCacheCanvas.height = targetHeight;
		this.webcamFrameCacheCtx = configureHighQuality2DContext(
			this.webcamFrameCacheCanvas.getContext("2d"),
		);

		return !!this.webcamFrameCacheCtx;
	}

	refreshWebcamFrameCache(
		source: CanvasImageSource | VideoFrame,
		width: number,
		height: number,
	): boolean {
		const sourceRect = getWebcamCropSourceRect(
			this.context.config.webcam?.cropRegion,
			width,
			height,
		);
		if (!this.ensureWebcamFrameCache(sourceRect.sw, sourceRect.sh)) {
			return false;
		}

		if (!this.webcamFrameCacheCanvas || !this.webcamFrameCacheCtx) {
			return false;
		}

		this.webcamFrameCacheCtx.clearRect(
			0,
			0,
			this.webcamFrameCacheCanvas.width,
			this.webcamFrameCacheCanvas.height,
		);
		this.webcamFrameCacheCtx.drawImage(
			source,
			sourceRect.sx,
			sourceRect.sy,
			sourceRect.sw,
			sourceRect.sh,
			0,
			0,
			this.webcamFrameCacheCanvas.width,
			this.webcamFrameCacheCanvas.height,
		);
		return true;
	}

	getCachedWebcamRenderSource(): WebcamRenderSource | null {
		if (
			!this.webcamFrameCacheCanvas ||
			this.webcamFrameCacheCanvas.width <= 0 ||
			this.webcamFrameCacheCanvas.height <= 0
		) {
			return null;
		}

		return {
			source: this.webcamFrameCacheCanvas,
			width: this.webcamFrameCacheCanvas.width,
			height: this.webcamFrameCacheCanvas.height,
			mode: "cached",
		};
	}

	resolveRenderableWebcamSource(
		liveSource: CanvasImageSource | VideoFrame | null,
		liveSourceWidth: number,
		liveSourceHeight: number,
		canUseLiveSource: boolean,
	): WebcamRenderSource | null {
		if (canUseLiveSource && liveSource && liveSourceWidth > 0 && liveSourceHeight > 0) {
			const usesDefaultCropRegion = isWebcamCropRegionDefault(
				this.context.config.webcam?.cropRegion,
			);
			const needsCacheBackedSource =
				!usesDefaultCropRegion ||
				(typeof HTMLVideoElement !== "undefined" && liveSource instanceof HTMLVideoElement);

			if (needsCacheBackedSource) {
				this.refreshWebcamFrameCache(liveSource, liveSourceWidth, liveSourceHeight);
				const cachedSource = this.getCachedWebcamRenderSource();
				if (cachedSource) {
					this.setWebcamRenderMode("live");
					return cachedSource;
				}
			}

			this.setWebcamRenderMode("live");
			return {
				source: liveSource,
				width: liveSourceWidth,
				height: liveSourceHeight,
				mode: "live",
			};
		}

		const cachedSource = this.getCachedWebcamRenderSource();
		if (cachedSource) {
			this.setWebcamRenderMode("cached");
			return cachedSource;
		}

		if (canUseLiveSource && liveSource && liveSourceWidth > 0 && liveSourceHeight > 0) {
			this.setWebcamRenderMode("live");
			return {
				source: liveSource,
				width: liveSourceWidth,
				height: liveSourceHeight,
				mode: "live",
			};
		}

		this.setWebcamRenderMode("hidden");
		return null;
	}
}
