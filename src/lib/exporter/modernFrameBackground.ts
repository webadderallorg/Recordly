import { BlurFilter, Sprite, Texture } from "pixi.js";
import { getSceneEffectMetrics } from "@/components/video-editor/videoPlayback/sceneEffects";
import { getAssetPath, getExportableVideoUrl, getRenderableAssetUrl } from "@/lib/assetPath";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { drawCssGradientBackground } from "./cssGradientBackground";
import { ForwardFrameSource } from "./forwardFrameSource";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { MutableVideoTextureSource } from "./modernFrameTypes";
import {
	applyCoverLayoutToSprite,
	configureHighQuality2DContext,
	drawSourceCoverToCanvas,
} from "./modernFrameUtils";

/** Owns background resources for one export renderer. */
export class FrameBackground {
	constructor(
		private readonly context: Pick<
			FrameRenderContext,
			"backgroundPlayback" | "scene" | "config" | "textures"
		>,
	) {}

	backgroundSprite: Sprite | null = null;

	backgroundTextureSource: MutableVideoTextureSource | null = null;

	backgroundBlurFilter: BlurFilter | null = null;

	resetBackgroundLayer(): void {
		this.context.backgroundPlayback.backgroundForwardFrameSource?.cancel();
		void this.context.backgroundPlayback.backgroundForwardFrameSource?.destroy();
		this.context.backgroundPlayback.backgroundForwardFrameSource = null;
		this.context.backgroundPlayback.backgroundForwardFrameSourceUrl = null;
		this.context.backgroundPlayback.backgroundForwardFrameDurationSec = null;
		this.context.backgroundPlayback.closeBackgroundDecodedFrame();
		this.context.backgroundPlayback.cleanupBackgroundSource?.();
		this.context.backgroundPlayback.cleanupBackgroundSource = null;
		this.context.backgroundPlayback.lastSyncedBackgroundLoopTimeSec = null;

		if (this.context.backgroundPlayback.backgroundVideoElement) {
			this.context.backgroundPlayback.backgroundVideoElement.pause();
			this.context.backgroundPlayback.backgroundVideoElement.src = "";
			this.context.backgroundPlayback.backgroundVideoElement.load();
			this.context.backgroundPlayback.backgroundVideoElement = null;
		}

		const backgroundTexture = this.backgroundSprite?.texture ?? null;
		this.backgroundSprite?.destroy({ texture: false, textureSource: false });
		backgroundTexture?.destroy(true);

		this.backgroundSprite = null;
		this.backgroundTextureSource = null;
		this.backgroundBlurFilter = null;
		this.context.scene.backgroundContainer?.removeChildren();
	}

	async setupBackground(): Promise<void> {
		this.resetBackgroundLayer();

		const wallpaper = await this.resolveWallpaperForExport(this.context.config.wallpaper);

		try {
			if (isVideoWallpaperSource(wallpaper)) {
				let videoSrc = wallpaper;
				if (wallpaper.startsWith("/") && !wallpaper.startsWith("//")) {
					videoSrc = await getAssetPath(wallpaper.replace(/^\//, ""));
				}

				try {
					const frameSource = new ForwardFrameSource();
					const metadata = await frameSource.initialize(videoSrc);
					this.context.backgroundPlayback.backgroundForwardFrameSource = frameSource;
					this.context.backgroundPlayback.backgroundForwardFrameSourceUrl = videoSrc;
					this.context.backgroundPlayback.backgroundForwardFrameDurationSec =
						getEffectiveVideoStreamDurationSeconds({
							duration: metadata?.duration,
							streamDuration: metadata?.streamDuration,
						});
					this.context.backgroundPlayback.backgroundVideoElement = null;
					this.context.backgroundPlayback.backgroundSeekPromise = null;
					this.context.backgroundPlayback.lastSyncedBackgroundLoopTimeSec = null;
					return;
				} catch (error) {
					console.warn(
						"[FrameRenderer] Decoder-backed video wallpaper unavailable during export; falling back to media element sync:",
						error,
					);
				}

				if (
					!(await this.context.backgroundPlayback.loadBackgroundMediaElementSource(
						videoSrc,
						wallpaper,
					))
				) {
					throw new Error(`Failed to load video wallpaper: ${wallpaper}`);
				}
				return;
			}

			const bgCanvas = document.createElement("canvas");
			bgCanvas.width = this.context.config.width;
			bgCanvas.height = this.context.config.height;
			const bgCtx = configureHighQuality2DContext(bgCanvas.getContext("2d"));

			if (!bgCtx) {
				throw new Error("Failed to get 2D context for background canvas");
			}

			if (
				wallpaper.startsWith("file://") ||
				wallpaper.startsWith("data:") ||
				wallpaper.startsWith("/") ||
				wallpaper.startsWith("http")
			) {
				const img = new Image();
				const imageUrl = await this.resolveWallpaperImageUrl(wallpaper);
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

				drawSourceCoverToCanvas(
					bgCtx,
					img,
					img.width,
					img.height,
					this.context.config.width,
					this.context.config.height,
				);
			} else if (wallpaper.startsWith("#")) {
				bgCtx.fillStyle = wallpaper;
				bgCtx.fillRect(0, 0, this.context.config.width, this.context.config.height);
			} else if (
				drawCssGradientBackground(
					bgCtx,
					wallpaper,
					this.context.config.width,
					this.context.config.height,
				)
			) {
				// Shared with native export so preview colors and CSS stop positions survive export.
			} else {
				bgCtx.fillStyle = wallpaper;
				bgCtx.fillRect(0, 0, this.context.config.width, this.context.config.height);
			}

			const blurredCanvas =
				this.context.config.backgroundBlur > 0
					? this.createPreblurredBackgroundCanvas(bgCanvas)
					: null;
			const backgroundSource = blurredCanvas ?? bgCanvas;
			const backgroundTexture = Texture.from(backgroundSource);
			this.backgroundSprite = new Sprite(backgroundTexture);
			this.context.scene.backgroundContainer?.addChild(this.backgroundSprite);
			applyCoverLayoutToSprite(
				this.backgroundSprite,
				backgroundSource.width,
				backgroundSource.height,
				this.context.config.width,
				this.context.config.height,
				this.context.config.width / 2,
				this.context.config.height / 2,
			);
		} catch (error) {
			console.error("[FrameRenderer] Error setting up background, using fallback:", error);
			const fallback = document.createElement("canvas");
			fallback.width = this.context.config.width;
			fallback.height = this.context.config.height;
			const ctx = configureHighQuality2DContext(fallback.getContext("2d"));
			if (!ctx) {
				throw new Error("Failed to create fallback background context");
			}
			ctx.fillStyle = "#000000";
			ctx.fillRect(0, 0, fallback.width, fallback.height);
			this.backgroundSprite = new Sprite(Texture.from(fallback));
			this.context.scene.backgroundContainer?.addChild(this.backgroundSprite);
			applyCoverLayoutToSprite(
				this.backgroundSprite,
				fallback.width,
				fallback.height,
				this.context.config.width,
				this.context.config.height,
				this.context.config.width / 2,
				this.context.config.height / 2,
			);
		}
	}

	async ensureBackgroundSprite(
		source: CanvasImageSource | VideoFrame,
		sourceWidth: number,
		sourceHeight: number,
	): Promise<void> {
		if (!this.context.scene.backgroundContainer) {
			return;
		}

		const resolvedSource =
			typeof VideoFrame !== "undefined" && source instanceof VideoFrame
				? await this.context.textures.resolveDetachedVideoFrameSource(
						source,
						"background",
						sourceWidth,
						sourceHeight,
					)
				: typeof HTMLVideoElement !== "undefined" &&
						source instanceof HTMLVideoElement &&
						sourceWidth > 0 &&
						sourceHeight > 0
					? (() => {
							const staging = this.context.textures.ensureVideoFrameStagingCanvas(
								"background",
								sourceWidth,
								sourceHeight,
							);
							if (!staging) {
								return source;
							}
							staging.context.clearRect(
								0,
								0,
								staging.canvas.width,
								staging.canvas.height,
							);
							staging.context.drawImage(
								source,
								0,
								0,
								staging.canvas.width,
								staging.canvas.height,
							);
							return staging.canvas;
						})()
					: source;

		if (!this.backgroundSprite) {
			const texture = this.context.textures.createTextureFromSource(resolvedSource);
			this.backgroundSprite = new Sprite(texture);
			this.backgroundTextureSource = texture.source as unknown as MutableVideoTextureSource;
			this.context.scene.backgroundContainer.addChild(this.backgroundSprite);

			if (this.context.config.backgroundBlur > 0) {
				const sceneEffects = getSceneEffectMetrics({
					viewportWidth: this.context.config.width,
					backgroundBlur: this.context.config.backgroundBlur,
					shadowIntensity: 0,
				});
				this.backgroundBlurFilter = new BlurFilter();
				this.backgroundBlurFilter.blur = sceneEffects.backgroundBlurPx;
				this.backgroundBlurFilter.quality = 4;
				this.backgroundBlurFilter.resolution =
					this.context.scene.app?.renderer.resolution ?? 1;
				this.backgroundBlurFilter.repeatEdgePixels = true;
				this.backgroundSprite.filters = [this.backgroundBlurFilter];
			}
		} else if (this.backgroundTextureSource) {
			this.backgroundTextureSource.resource = resolvedSource;
			this.backgroundTextureSource.update();
		}

		applyCoverLayoutToSprite(
			this.backgroundSprite,
			sourceWidth,
			sourceHeight,
			this.context.config.width,
			this.context.config.height,
			this.context.config.width / 2,
			this.context.config.height / 2,
		);
	}

	createPreblurredBackgroundCanvas(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement | null {
		const blurredCanvas = document.createElement("canvas");
		blurredCanvas.width = sourceCanvas.width;
		blurredCanvas.height = sourceCanvas.height;
		const blurredCtx = configureHighQuality2DContext(blurredCanvas.getContext("2d"));
		if (!blurredCtx) {
			return null;
		}

		blurredCtx.save();
		const sceneEffects = getSceneEffectMetrics({
			viewportWidth: this.context.config.width,
			backgroundBlur: this.context.config.backgroundBlur,
			shadowIntensity: 0,
		});
		const blurPx = sceneEffects.backgroundBlurPx;
		const overscan = sceneEffects.backgroundOverscanPx;
		blurredCtx.filter = `blur(${blurPx}px)`;
		blurredCtx.drawImage(
			sourceCanvas,
			-overscan,
			-overscan,
			blurredCanvas.width + overscan * 2,
			blurredCanvas.height + overscan * 2,
		);
		blurredCtx.restore();

		return blurredCanvas;
	}

	async resolveWallpaperImageUrl(wallpaper: string): Promise<string> {
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

	async resolveWallpaperForExport(wallpaper: string): Promise<string> {
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

		const wallpaperAsset = looksLikeAbsoluteFilePath
			? `file://${encodeURI(wallpaper)}`
			: wallpaper;
		return getRenderableAssetUrl(wallpaperAsset);
	}
}
