import { getAssetPath, getExportableVideoUrl, getRenderableAssetUrl } from "@/lib/assetPath";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { drawCssGradientBackground } from "./cssGradientBackground";
import { ForwardFrameSource } from "./forwardFrameSource";
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";
import { configureHighQuality2DContext } from "./legacyFrameRendererContext";

export async function setupBackground(
	context: Pick<
		LegacyFrameRendererContext,
		| "resolveWallpaperForExport"
		| "config"
		| "backgroundCtx"
		| "backgroundForwardFrameSource"
		| "backgroundForwardFrameSourceUrl"
		| "backgroundForwardFrameDurationSec"
		| "closeBackgroundDecodedFrame"
		| "cleanupBackgroundSource"
		| "lastSyncedBackgroundLoopTimeSec"
		| "backgroundVideoElement"
		| "backgroundSeekPromise"
		| "backgroundSprite"
		| "loadBackgroundMediaElementSource"
		| "resolveWallpaperImageUrl"
	>,
): Promise<void> {
	const wallpaper = await context.resolveWallpaperForExport(context.config.wallpaper);

	// Create background canvas for separate rendering (not affected by zoom)
	const bgCanvas = document.createElement("canvas");
	bgCanvas.width = context.config.width;
	bgCanvas.height = context.config.height;
	const bgCtx = configureHighQuality2DContext(bgCanvas.getContext("2d"));

	if (!bgCtx) {
		throw new Error("Failed to get 2D context for background canvas");
	}

	context.backgroundCtx = bgCtx;
	context.backgroundForwardFrameSource?.cancel();
	void context.backgroundForwardFrameSource?.destroy();
	context.backgroundForwardFrameSource = null;
	context.backgroundForwardFrameSourceUrl = null;
	context.backgroundForwardFrameDurationSec = null;
	context.closeBackgroundDecodedFrame();
	context.cleanupBackgroundSource?.();
	context.cleanupBackgroundSource = null;
	context.lastSyncedBackgroundLoopTimeSec = null;
	if (context.backgroundVideoElement) {
		context.backgroundVideoElement.pause();
		context.backgroundVideoElement.src = "";
		context.backgroundVideoElement.load();
		context.backgroundVideoElement = null;
	}
	context.backgroundSeekPromise = null;

	try {
		// Check for video wallpaper first
		if (isVideoWallpaperSource(wallpaper)) {
			let videoSrc = wallpaper;
			if (wallpaper.startsWith("/") && !wallpaper.startsWith("//")) {
				videoSrc = await getAssetPath(wallpaper.replace(/^\//, ""));
			}

			if (!context.config.preferMediaElementSampling) {
				try {
					const frameSource = new ForwardFrameSource();
					const metadata = await frameSource.initialize(videoSrc);
					context.backgroundForwardFrameSource = frameSource;
					context.backgroundForwardFrameSourceUrl = videoSrc;
					context.backgroundForwardFrameDurationSec =
						getEffectiveVideoStreamDurationSeconds({
							duration: metadata?.duration,
							streamDuration: metadata?.streamDuration,
						});
					context.backgroundVideoElement = null;
					context.backgroundSeekPromise = null;
					context.lastSyncedBackgroundLoopTimeSec = null;
					context.backgroundSprite = bgCanvas;
					return;
				} catch (error) {
					console.warn(
						"[FrameRenderer] Decoder-backed video wallpaper unavailable during export; falling back to media element sync:",
						error,
					);
				}
			}

			if (!(await context.loadBackgroundMediaElementSource(videoSrc, wallpaper))) {
				throw new Error(`Failed to load video wallpaper: ${wallpaper}`);
			}
			context.backgroundSprite = bgCanvas;
			return;
		}

		// Render background based on type
		if (
			wallpaper.startsWith("file://") ||
			wallpaper.startsWith("data:") ||
			wallpaper.startsWith("/") ||
			wallpaper.startsWith("http")
		) {
			// Image background
			const img = new Image();
			const imageUrl = await context.resolveWallpaperImageUrl(wallpaper);
			// Don't set crossOrigin for same-origin images to avoid CORS taint.
			if (
				imageUrl.startsWith("http") &&
				window.location.origin &&
				!imageUrl.startsWith(window.location.origin)
			) {
				img.crossOrigin = "anonymous";
			}

			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = (err) => {
					console.error(
						"[FrameRenderer] Failed to load background image:",
						imageUrl,
						err,
					);
					reject(new Error(`Failed to load background image: ${imageUrl}`));
				};
				img.src = imageUrl;
			});

			// Draw the image using cover and center positioning
			const imgAspect = img.width / img.height;
			const canvasAspect = context.config.width / context.config.height;

			let drawWidth, drawHeight, drawX, drawY;

			if (imgAspect > canvasAspect) {
				drawHeight = context.config.height;
				drawWidth = drawHeight * imgAspect;
				drawX = (context.config.width - drawWidth) / 2;
				drawY = 0;
			} else {
				drawWidth = context.config.width;
				drawHeight = drawWidth / imgAspect;
				drawX = 0;
				drawY = (context.config.height - drawHeight) / 2;
			}

			bgCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
		} else if (wallpaper.startsWith("#")) {
			bgCtx.fillStyle = wallpaper;
			bgCtx.fillRect(0, 0, context.config.width, context.config.height);
		} else if (
			drawCssGradientBackground(bgCtx, wallpaper, context.config.width, context.config.height)
		) {
			// Shared with native export so preview colors and CSS stop positions survive export.
		} else {
			bgCtx.fillStyle = wallpaper;
			bgCtx.fillRect(0, 0, context.config.width, context.config.height);
		}
	} catch (error) {
		console.error("[FrameRenderer] Error setting up background, using fallback:", error);
		bgCtx.fillStyle = "#000000";
		bgCtx.fillRect(0, 0, context.config.width, context.config.height);
	}

	// Store the background canvas for compositing
	context.backgroundSprite = bgCanvas;
}

export function drawVideoFrameToBackground(
	context: Pick<
		LegacyFrameRendererContext,
		"backgroundVideoElement" | "drawBackgroundSourceToCanvas"
	>,
): void {
	const video = context.backgroundVideoElement;
	if (!video) return;

	context.drawBackgroundSourceToCanvas(video, video.videoWidth, video.videoHeight);
}

export function drawBackgroundSourceToCanvas(
	context: Pick<LegacyFrameRendererContext, "backgroundCtx" | "config">,
	source: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
): void {
	const ctx = context.backgroundCtx;
	if (!ctx) return;

	const w = context.config.width;
	const h = context.config.height;
	const safeSourceWidth = Math.max(1, sourceWidth);
	const safeSourceHeight = Math.max(1, sourceHeight);
	const videoAspect = safeSourceWidth / safeSourceHeight;
	const canvasAspect = w / h;

	let drawWidth: number, drawHeight: number, drawX: number, drawY: number;
	if (videoAspect > canvasAspect) {
		drawHeight = h;
		drawWidth = drawHeight * videoAspect;
		drawX = (w - drawWidth) / 2;
		drawY = 0;
	} else {
		drawWidth = w;
		drawHeight = drawWidth / videoAspect;
		drawX = 0;
		drawY = (h - drawHeight) / 2;
	}

	ctx.clearRect(0, 0, w, h);
	ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
}

export async function resolveWallpaperImageUrl(
	_context: Pick<LegacyFrameRendererContext, never>,
	wallpaper: string,
): Promise<string> {
	if (
		wallpaper.startsWith("file://") ||
		wallpaper.startsWith("data:") ||
		wallpaper.startsWith("http")
	) {
		return wallpaper;
	}

	const resolved = await getAssetPath(wallpaper.replace(/^\/+/, ""));
	if (resolved.startsWith("/") && window.location.protocol.startsWith("http")) {
		return `${window.location.origin}${resolved}`;
	}

	return resolved;
}

export async function resolveWallpaperForExport(
	_context: Pick<LegacyFrameRendererContext, never>,
	wallpaper: string,
): Promise<string> {
	if (!wallpaper) {
		return wallpaper;
	}

	if (isVideoWallpaperSource(wallpaper)) {
		return getExportableVideoUrl(wallpaper);
	}

	if (
		wallpaper.startsWith("#") ||
		wallpaper.startsWith("linear-gradient") ||
		wallpaper.startsWith("radial-gradient")
	) {
		return wallpaper;
	}

	const looksLikeAbsoluteFilePath =
		wallpaper.startsWith("/") &&
		!wallpaper.startsWith("//") &&
		!wallpaper.startsWith("/wallpapers/") &&
		!wallpaper.startsWith("/app-icons/");

	const wallpaperAsset = looksLikeAbsoluteFilePath ? `file://${encodeURI(wallpaper)}` : wallpaper;

	return getRenderableAssetUrl(wallpaperAsset);
}
