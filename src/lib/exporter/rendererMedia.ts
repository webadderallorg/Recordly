import { recordExportDiagnostic } from "../feedback/exportDiagnostics";
import { resolveMediaElementSource } from "./localMediaSource";
import { withMediaDeadline } from "./mediaDeadline";
import type { ExportDiagnosticCallbacks } from "./types";

const MEDIA_LOAD_TIMEOUT_MS = 8_000;
type RendererAsset = "wallpaper-image" | "video-wallpaper" | "webcam";

export function reportRendererMediaFailure(
	asset: RendererAsset,
	mediaStage: "load" | "decode" | "fallback",
	error: unknown,
	record: NonNullable<ExportDiagnosticCallbacks["onDiagnostic"]> = recordExportDiagnostic,
) {
	record("renderer-media-failure", {
		asset,
		mediaStage,
		code:
			error instanceof DOMException && error.name === "TimeoutError"
				? "RENDER_MEDIA_TIMEOUT"
				: "RENDER_MEDIA_FAILED",
		reason: error instanceof Error ? error.message : String(error),
	});
}

export function resolveExportWallpaper(resolveUrl: () => Promise<string>, signal?: AbortSignal) {
	return withMediaDeadline(resolveUrl, {
		signal,
		timeoutMs: MEDIA_LOAD_TIMEOUT_MS,
		message: "Timed out resolving wallpaper",
	});
}

export function loadExportWallpaperImage(resolveUrl: () => Promise<string>, signal?: AbortSignal) {
	return withMediaDeadline(
		async (attemptSignal) => {
			const url = await resolveUrl();
			attemptSignal.throwIfAborted();
			const image = new Image();
			if (
				url.startsWith("http") &&
				window.location.origin &&
				!url.startsWith(window.location.origin)
			) {
				image.crossOrigin = "anonymous";
			}
			return new Promise<HTMLImageElement>((resolve, reject) => {
				const cleanup = () => {
					image.onload = null;
					image.onerror = null;
					attemptSignal.removeEventListener("abort", abort);
				};
				const abort = () => {
					cleanup();
					image.removeAttribute("src");
					reject(attemptSignal.reason);
				};
				image.onload = () => {
					cleanup();
					resolve(image);
				};
				image.onerror = () => {
					cleanup();
					reject(new Error("Failed to load wallpaper image"));
				};
				attemptSignal.addEventListener("abort", abort, { once: true });
				image.src = url;
			});
		},
		{ signal, timeoutMs: MEDIA_LOAD_TIMEOUT_MS, message: "Timed out loading wallpaper image" },
	);
}

export function resolveRendererMediaElementSource(
	url: string,
	asset: "video-wallpaper" | "webcam",
	signal?: AbortSignal,
) {
	return withMediaDeadline(
		async (attemptSignal) => {
			const source = await resolveMediaElementSource(url);
			if (attemptSignal.aborted) {
				source.revoke();
				attemptSignal.throwIfAborted();
			}
			return source;
		},
		{
			signal,
			timeoutMs: MEDIA_LOAD_TIMEOUT_MS,
			message: `Timed out opening ${asset === "webcam" ? "webcam" : "video wallpaper"} media`,
		},
	);
}

export function waitForRendererMediaElement(
	video: HTMLVideoElement,
	signal: AbortSignal,
	timeoutMs: number,
) {
	return withMediaDeadline(
		(attemptSignal) =>
			new Promise<void>((resolve, reject) => {
				const events = ["loadeddata", "canplay", "canplaythrough"];
				const cleanup = () => {
					for (const event of events) video.removeEventListener(event, ready);
					video.removeEventListener("error", failed);
					attemptSignal.removeEventListener("abort", aborted);
				};
				const ready = () => {
					if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
					cleanup();
					resolve();
				};
				const failed = () => {
					cleanup();
					reject(new Error("Fallback media could not be loaded"));
				};
				const aborted = () => {
					cleanup();
					reject(attemptSignal.reason);
				};
				for (const event of events) video.addEventListener(event, ready);
				video.addEventListener("error", failed);
				attemptSignal.addEventListener("abort", aborted, { once: true });
				if (video.error) failed();
				else ready();
			}),
		{ signal, timeoutMs, message: "Timed out waiting for media element fallback" },
	);
}
