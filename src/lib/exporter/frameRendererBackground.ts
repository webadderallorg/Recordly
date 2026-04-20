import { BlurFilter, Sprite, Texture } from "pixi.js";
import { getAssetPath, getRenderableAssetUrl } from "@/lib/assetPath";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { ForwardFrameSource } from "./forwardFrameSource";
import type { FrameRenderConfig, MutableVideoTextureSource } from "./frameRendererTypes";
import type { FrameRenderer } from "./modernFrameRenderer";
import {
	applyCoverLayoutToSprite,
	configureHighQuality2DContext,
	createTextureFromSource,
	drawSourceCoverToCanvas,
} from "./frameRendererHelpers";

export function resetBackgroundLayer(self: FrameRenderer): void {
	self.backgroundForwardFrameSource?.cancel();
	void self.backgroundForwardFrameSource?.destroy();
	self.backgroundForwardFrameSource = null;
	closeBackgroundDecodedFrame(self);

	if (self.backgroundVideoElement) {
		self.backgroundVideoElement.pause();
		self.backgroundVideoElement.src = "";
		self.backgroundVideoElement.load();
		self.backgroundVideoElement = null;
	}

	const backgroundTexture = self.backgroundSprite?.texture ?? null;
	self.backgroundSprite?.destroy({ texture: false, textureSource: false });
	backgroundTexture?.destroy(true);

	self.backgroundSprite = null;
	self.backgroundTextureSource = null;
	self.backgroundBlurFilter = null;
	self.backgroundContainer?.removeChildren();
}

export async function setupBackground(self: FrameRenderer): Promise<void> {
	resetBackgroundLayer(self);

	const wallpaper = await resolveWallpaperForExport(self.config.wallpaper);

	try {
		if (isVideoWallpaperSource(wallpaper)) {
			let videoSrc = wallpaper;
			if (wallpaper.startsWith("/") && !wallpaper.startsWith("//")) {
				videoSrc = await getAssetPath(wallpaper.replace(/^\//, ""));
			}

			try {
				const frameSource = new ForwardFrameSource();
				await frameSource.initialize(videoSrc);
				self.backgroundForwardFrameSource = frameSource;
				return;
			} catch (error) {
				console.warn(
					"[FrameRenderer] Decoder-backed wallpaper source unavailable during export; falling back to media element sync:",
					error,
				);
			}

			const video = document.createElement("video");
			video.muted = true;
			video.loop = true;
			video.playsInline = true;
			video.preload = "auto";
			video.src = videoSrc;

			await new Promise<void>((resolve, reject) => {
				video.onloadeddata = () => resolve();
				video.onerror = () =>
					reject(new Error(`Failed to load video wallpaper: ${wallpaper}`));
			});

			self.backgroundVideoElement = video;
			ensureBackgroundSprite(self, video, video.videoWidth, video.videoHeight);
			return;
		}

		const bgCanvas = document.createElement("canvas");
		bgCanvas.width = self.config.width;
		bgCanvas.height = self.config.height;
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
			const imageUrl = await resolveWallpaperImageUrl(wallpaper);
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
				self.config.width,
				self.config.height,
			);
		} else if (wallpaper.startsWith("#")) {
			bgCtx.fillStyle = wallpaper;
			bgCtx.fillRect(0, 0, self.config.width, self.config.height);
		} else if (
			wallpaper.startsWith("linear-gradient") ||
			wallpaper.startsWith("radial-gradient")
		) {
			const gradientMatch = wallpaper.match(/(linear|radial)-gradient\((.+)\)/);
			if (!gradientMatch) {
				bgCtx.fillStyle = "#000000";
				bgCtx.fillRect(0, 0, self.config.width, self.config.height);
			} else {
				const [, type, params] = gradientMatch;
				const parts = params.split(",").map((value) => value.trim());
				const gradient =
					type === "linear"
						? bgCtx.createLinearGradient(0, 0, 0, self.config.height)
						: bgCtx.createRadialGradient(
								self.config.width / 2,
								self.config.height / 2,
								0,
								self.config.width / 2,
								self.config.height / 2,
								Math.max(self.config.width, self.config.height) / 2,
							);

				parts.forEach((part, index) => {
					if (type === "linear" && (part.startsWith("to ") || part.includes("deg"))) {
						return;
					}

					const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
					if (!colorMatch) {
						return;
					}

					const position = index / Math.max(parts.length - 1, 1);
					gradient.addColorStop(position, colorMatch[1]);
				});

				bgCtx.fillStyle = gradient;
				bgCtx.fillRect(0, 0, self.config.width, self.config.height);
			}
		} else {
			bgCtx.fillStyle = wallpaper;
			bgCtx.fillRect(0, 0, self.config.width, self.config.height);
		}

		const blurredCanvas =
			self.config.backgroundBlur > 0
				? createPreblurredBackgroundCanvas(self.config, bgCanvas)
				: null;
		const backgroundSource = blurredCanvas ?? bgCanvas;
		const backgroundTexture = Texture.from(backgroundSource);
		self.backgroundSprite = new Sprite(backgroundTexture);
		self.backgroundContainer?.addChild(self.backgroundSprite);
		applyCoverLayoutToSprite(
			self.backgroundSprite,
			backgroundSource.width,
			backgroundSource.height,
			self.config.width,
			self.config.height,
			self.config.width / 2,
			self.config.height / 2,
		);
	} catch (error) {
		console.error("[FrameRenderer] Error setting up background, using fallback:", error);
		const fallback = document.createElement("canvas");
		fallback.width = self.config.width;
		fallback.height = self.config.height;
		const ctx = configureHighQuality2DContext(fallback.getContext("2d"));
		if (!ctx) {
			throw new Error("Failed to create fallback background context");
		}
		ctx.fillStyle = "#000000";
		ctx.fillRect(0, 0, fallback.width, fallback.height);
		self.backgroundSprite = new Sprite(Texture.from(fallback));
		self.backgroundContainer?.addChild(self.backgroundSprite);
		applyCoverLayoutToSprite(
			self.backgroundSprite,
			fallback.width,
			fallback.height,
			self.config.width,
			self.config.height,
			self.config.width / 2,
			self.config.height / 2,
		);
	}
}

export function ensureBackgroundSprite(
	self: FrameRenderer,
	source: CanvasImageSource | VideoFrame,
	sourceWidth: number,
	sourceHeight: number,
): void {
	if (!self.backgroundContainer) {
		return;
	}

	if (!self.backgroundSprite) {
		const texture = createTextureFromSource(source);
		self.backgroundSprite = new Sprite(texture);
		self.backgroundTextureSource = texture.source as unknown as MutableVideoTextureSource;
		self.backgroundContainer.addChild(self.backgroundSprite);

		if (self.config.backgroundBlur > 0) {
			self.backgroundBlurFilter = new BlurFilter();
			self.backgroundBlurFilter.blur = self.config.backgroundBlur * 3;
			self.backgroundBlurFilter.quality = 4;
			self.backgroundBlurFilter.resolution = self.app?.renderer.resolution ?? 1;
			self.backgroundSprite.filters = [self.backgroundBlurFilter];
		}
	} else if (self.backgroundTextureSource) {
		self.backgroundTextureSource.resource = source;
		self.backgroundTextureSource.update();
	}

	applyCoverLayoutToSprite(
		self.backgroundSprite,
		sourceWidth,
		sourceHeight,
		self.config.width,
		self.config.height,
		self.config.width / 2,
		self.config.height / 2,
	);
}

function createPreblurredBackgroundCanvas(
	config: FrameRenderConfig,
	sourceCanvas: HTMLCanvasElement,
): HTMLCanvasElement | null {
	const blurredCanvas = document.createElement("canvas");
	blurredCanvas.width = sourceCanvas.width;
	blurredCanvas.height = sourceCanvas.height;
	const blurredCtx = configureHighQuality2DContext(blurredCanvas.getContext("2d"));
	if (!blurredCtx) {
		return null;
	}

	blurredCtx.save();
	blurredCtx.filter = `blur(${config.backgroundBlur * 3}px)`;
	blurredCtx.drawImage(sourceCanvas, 0, 0, blurredCanvas.width, blurredCanvas.height);
	blurredCtx.restore();

	return blurredCanvas;
}

export function closeBackgroundDecodedFrame(self: FrameRenderer): void {
	if (!self.backgroundDecodedFrame) {
		return;
	}

	self.backgroundDecodedFrame.close();
	self.backgroundDecodedFrame = null;
}

export async function syncBackgroundFrame(
	self: FrameRenderer,
	timeSeconds: number,
): Promise<void> {
	if (self.backgroundForwardFrameSource) {
		const decodedFrame = await self.backgroundForwardFrameSource.getFrameAtTime(
			Math.max(0, timeSeconds),
		);
		closeBackgroundDecodedFrame(self);
		self.backgroundDecodedFrame = decodedFrame;
		if (decodedFrame) {
			ensureBackgroundSprite(
				self,
				decodedFrame,
				decodedFrame.displayWidth,
				decodedFrame.displayHeight,
			);
		}
		return;
	}

	const video = self.backgroundVideoElement;
	if (!video) {
		return;
	}

	if (video.duration && Number.isFinite(video.duration)) {
		const targetTime = timeSeconds % video.duration;
		if (Math.abs(video.currentTime - targetTime) > 0.008) {
			video.currentTime = targetTime;
			await new Promise<void>((resolve) => {
				const onSeeked = () => {
					video.removeEventListener("seeked", onSeeked);
					resolve();
				};
				video.addEventListener("seeked", onSeeked);
			});
		}
	}

	ensureBackgroundSprite(self, video, video.videoWidth, video.videoHeight);
}

async function resolveWallpaperImageUrl(wallpaper: string): Promise<string> {
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

async function resolveWallpaperForExport(wallpaper: string): Promise<string> {
	if (!wallpaper) {
		return wallpaper;
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
