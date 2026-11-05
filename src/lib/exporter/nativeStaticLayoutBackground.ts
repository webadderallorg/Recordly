import {
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { createCssGradientBackground } from "./cssGradientBackground";
import { getLocalFilePath } from "./localMediaSource";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";

export type NativeStaticLayoutBackground =
	| {
			backgroundColor: string;
			backgroundImagePath?: null;
			temporaryPath?: string;
	  }
	| {
			backgroundColor: string;
			backgroundImagePath: string;
			temporaryPath?: string;
	  };

const MISSING_NATIVE_WALLPAPER_FALLBACK_COLOR = "#ffffff";

/** Materializes the background assets consumed by native compositors. */
export class NativeStaticLayoutBackgroundAssets {
	skipReason: string | null = null;

	constructor(
		private readonly config: Pick<VideoExporterConfig, "wallpaper" | "width" | "height">,
	) {}

	async resolve(): Promise<NativeStaticLayoutBackground | null> {
		this.skipReason = null;
		const configuredWallpaper = this.config.wallpaper?.trim() ?? "";
		const wallpaper = configuredWallpaper || DEFAULT_WALLPAPER_PATH;
		if (/^#?[0-9a-f]{6}$/i.test(wallpaper)) {
			return {
				backgroundColor: wallpaper.startsWith("#") ? wallpaper : `#${wallpaper}`,
				backgroundImagePath: null,
			};
		}

		if (wallpaper.startsWith("data:image/") || wallpaper.startsWith("blob:")) {
			const materialized = await this.materializeImageSource(wallpaper);
			if (materialized) {
				return materialized;
			}
			this.skipReason = "unsupported-background-image-materialize-failed";
			return null;
		}

		if (wallpaper.startsWith("linear-gradient") || wallpaper.startsWith("radial-gradient")) {
			const materialized = await this.materializeGradientBackground(wallpaper);
			if (materialized) {
				return materialized;
			}
			this.skipReason = "unsupported-background-gradient-materialize-failed";
			return null;
		}

		if (isVideoWallpaperSource(wallpaper)) {
			this.skipReason = "unsupported-background-video";
			return null;
		}

		if (wallpaper.startsWith("data:") || wallpaper.startsWith("blob:")) {
			this.skipReason = "unsupported-background-data-or-blob";
			return null;
		}

		if (wallpaper.startsWith("http")) {
			this.skipReason = "unsupported-background-remote";
			return null;
		}

		if (wallpaper.startsWith("/wallpapers/") || wallpaper.startsWith("/app-icons/")) {
			const assetPath = await this.resolveBundledAssetPath(wallpaper);
			if (assetPath) {
				return { backgroundColor: "#101010", backgroundImagePath: assetPath };
			}

			const fallbackAssetPath = await this.resolveBundledAssetPath(
				`/${DEFAULT_WALLPAPER_RELATIVE_PATH}`,
			);
			return fallbackAssetPath
				? { backgroundColor: "#101010", backgroundImagePath: fallbackAssetPath }
				: {
						backgroundColor: MISSING_NATIVE_WALLPAPER_FALLBACK_COLOR,
						backgroundImagePath: null,
					};
		}

		const localPath = getLocalFilePath(wallpaper);
		if (localPath) {
			return { backgroundColor: "#101010", backgroundImagePath: localPath };
		}

		this.skipReason = "unsupported-background-local-path";
		return null;
	}

	private async materializeImageSource(
		imageSource: string,
	): Promise<NativeStaticLayoutBackground | null> {
		if (typeof fetch !== "function") {
			return null;
		}

		try {
			const response = await fetch(imageSource);
			if (!response.ok) {
				return null;
			}

			const blob = await response.blob();
			const mimeType = (blob.type || this.getDataUrlMimeType(imageSource)).toLowerCase();
			if (!mimeType.startsWith("image/")) {
				return null;
			}

			const extension = this.getImageExtension(mimeType);
			if (!extension) {
				return null;
			}

			const tempPath = await this.writeTempAsset(
				new Uint8Array(await blob.arrayBuffer()),
				extension,
			);
			return tempPath
				? {
						backgroundColor: "#101010",
						backgroundImagePath: tempPath,
						temporaryPath: tempPath,
					}
				: null;
		} catch (error) {
			console.warn("[VideoExporter] Unable to materialize native background image", error);
			return null;
		}
	}

	private async materializeGradientBackground(
		wallpaper: string,
	): Promise<NativeStaticLayoutBackground | null> {
		if (typeof document === "undefined") {
			return null;
		}

		try {
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(this.config.width));
			canvas.height = Math.max(1, Math.round(this.config.height));
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				return null;
			}

			const gradient = this.createGradient(ctx, wallpaper);
			if (!gradient) {
				return null;
			}

			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, "image/png"),
			);
			if (!blob) {
				return null;
			}

			const tempPath = await this.writeTempAsset(
				new Uint8Array(await blob.arrayBuffer()),
				"png",
			);
			return tempPath
				? {
						backgroundColor: "#101010",
						backgroundImagePath: tempPath,
						temporaryPath: tempPath,
					}
				: null;
		} catch (error) {
			console.warn("[VideoExporter] Unable to materialize native gradient background", error);
			return null;
		}
	}

	createGradient(ctx: CanvasRenderingContext2D, wallpaper: string): CanvasGradient | null {
		return createCssGradientBackground(ctx, wallpaper, this.config.width, this.config.height);
	}

	private async writeTempAsset(bytes: Uint8Array, extension: string): Promise<string | null> {
		if (typeof window === "undefined") {
			return null;
		}

		const api = window.electronAPI;
		if (
			!api?.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream ||
			bytes.byteLength === 0
		) {
			return null;
		}

		let streamId: string | undefined;
		try {
			const openResult = await api.openExportStream({ extension });
			if (!openResult.success || !openResult.streamId) {
				return null;
			}

			streamId = openResult.streamId;
			const writeResult = await api.writeExportStreamChunk(streamId, 0, bytes);
			if (!writeResult.success) {
				throw new Error(writeResult.error || "Failed to write native background temp file");
			}

			const closeResult = await api.closeExportStream(streamId);
			streamId = undefined;
			return closeResult.success && closeResult.tempPath ? closeResult.tempPath : null;
		} catch (error) {
			console.warn("[VideoExporter] Unable to write native background temp file", error);
			if (streamId) {
				await api.closeExportStream(streamId, { abort: true }).catch(() => undefined);
			}
			return null;
		}
	}

	async cleanup(background: NativeStaticLayoutBackground | null | undefined) {
		const temporaryPath = background?.temporaryPath;
		if (!temporaryPath || typeof window === "undefined") {
			return;
		}

		try {
			await window.electronAPI?.discardExportedTemp?.(temporaryPath);
		} catch {
			// Best-effort cleanup for temporary materialized background assets.
		}
	}

	private getDataUrlMimeType(dataUrl: string) {
		return dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "";
	}

	private getImageExtension(mimeType: string): string | null {
		if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
		if (mimeType === "image/png") return "png";
		if (mimeType === "image/bmp") return "bmp";
		return null;
	}

	private async resolveBundledAssetPath(assetPath: string): Promise<string | null> {
		const normalizedAssetPath = assetPath.replace(/^\/+/, "");
		const [assetDirectory, fileName] = normalizedAssetPath.split("/");
		if (!assetDirectory || !fileName) {
			return null;
		}

		try {
			const result = await window.electronAPI?.listAssetDirectory?.(assetDirectory);
			if (
				result?.success &&
				result.files &&
				!result.files.includes(decodeURIComponent(fileName))
			) {
				console.warn("[VideoExporter] Native static layout wallpaper asset is missing", {
					assetPath,
				});
				return null;
			}
		} catch {
			// Keep native export opportunistic when directory probing is unavailable.
		}

		const assetBasePath = await window.electronAPI?.getAssetBasePath?.();
		if (!assetBasePath) {
			return null;
		}

		const assetUrl = new URL(normalizedAssetPath, assetBasePath).toString();
		return getLocalFilePath(assetUrl);
	}
}
