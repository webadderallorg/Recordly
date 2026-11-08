import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";
import { BACKGROUND_MEDIA_ELEMENT_READY_TIMEOUT_MS } from "./legacyFrameRendererContext";
import { resolveMediaElementSource } from "./localMediaSource";

export async function loadBackgroundMediaElementSource(
	context: Pick<
		LegacyFrameRendererContext,
		| "backgroundVideoElement"
		| "backgroundSeekPromise"
		| "cleanupBackgroundSource"
		| "pendingMediaCancellations"
		| "mediaCancelled"
		| "lastSyncedBackgroundLoopTimeSec"
		| "drawVideoFrameToBackground"
	>,
	videoSrc: string,
	errorLabel: string,
): Promise<boolean> {
	if (context.backgroundVideoElement) {
		try {
			context.backgroundVideoElement.pause();
			context.backgroundVideoElement.src = "";
			context.backgroundVideoElement.load();
		} catch {
			// Ignore media element teardown errors during export fallback.
		}
		context.backgroundVideoElement = null;
	}
	context.backgroundSeekPromise = null;
	context.cleanupBackgroundSource?.();
	context.cleanupBackgroundSource = null;

	let backgroundSource: Awaited<ReturnType<typeof resolveMediaElementSource>>;
	try {
		backgroundSource = await resolveMediaElementSource(videoSrc);
	} catch (error) {
		console.warn("[FrameRenderer] Unable to resolve video wallpaper fallback source:", error);
		return false;
	}
	context.cleanupBackgroundSource = backgroundSource.revoke;

	const video = document.createElement("video");
	video.crossOrigin = "anonymous";
	video.muted = true;
	video.loop = true;
	video.playsInline = true;
	video.preload = "auto";
	video.src = backgroundSource.src;
	video.load();

	const ready = await new Promise<boolean>((resolve) => {
		const pending = context.pendingMediaCancellations;
		const cancel = () => settle(false);
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		function cleanup() {
			pending.delete(cancel);
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			video.removeEventListener("loadeddata", onReady);
			video.removeEventListener("canplay", onReady);
			video.removeEventListener("error", onError);
		}

		function settle(value: boolean) {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve(value);
		}
		function onReady() {
			if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
				return;
			}
			settle(true);
		}
		function onError() {
			settle(false);
		}

		video.addEventListener("loadeddata", onReady);
		video.addEventListener("canplay", onReady);
		video.addEventListener("error", onError);
		timeoutId = setTimeout(() => {
			console.warn(
				`[FrameRenderer] Video wallpaper media element fallback did not become ready within ${BACKGROUND_MEDIA_ELEMENT_READY_TIMEOUT_MS}ms`,
			);
			settle(false);
		}, BACKGROUND_MEDIA_ELEMENT_READY_TIMEOUT_MS);
		pending.add(cancel);
		if (context.mediaCancelled) cancel();
		else onReady();
	});

	if (!ready) {
		console.warn(`[FrameRenderer] Failed to load video wallpaper: ${errorLabel}`);
		try {
			video.pause();
			video.src = "";
			video.load();
		} catch {
			// Ignore media element teardown errors on failed fallback.
		}
		backgroundSource.revoke();
		if (context.cleanupBackgroundSource === backgroundSource.revoke) {
			context.cleanupBackgroundSource = null;
		}
		return false;
	}

	context.backgroundVideoElement = video;
	context.lastSyncedBackgroundLoopTimeSec = null;
	context.drawVideoFrameToBackground();
	return true;
}

export async function syncBackgroundVideo(
	context: Pick<
		LegacyFrameRendererContext,
		| "backgroundVideoElement"
		| "backgroundSeekPromise"
		| "pendingMediaCancellations"
		| "mediaCancelled"
		| "drawVideoFrameToBackground"
	>,
	timeSeconds: number,
): Promise<void> {
	const video = context.backgroundVideoElement;
	if (!video) return;

	if (video.duration && Number.isFinite(video.duration)) {
		const targetTime = timeSeconds % video.duration;
		if (Math.abs(video.currentTime - targetTime) > 0.01) {
			if (context.backgroundSeekPromise) {
				await context.backgroundSeekPromise;
			}

			context.backgroundSeekPromise = new Promise<void>((resolve) => {
				let settled = false;
				let fallbackTimeout: number | null = null;
				let animationFrameRequestId: number | null = null;
				let videoFrameRequestId: number | null = null;

				const finish = () => {
					if (settled) {
						return;
					}
					settled = true;
					cleanup();
					resolve();
				};

				const waitForPresentedFrame = () => {
					const requestVideoFrameCallback = (
						video as HTMLVideoElement & {
							requestVideoFrameCallback?: (
								callback: (
									now: DOMHighResTimeStamp,
									metadata: VideoFrameCallbackMetadata,
								) => void,
							) => number;
							cancelVideoFrameCallback?: (handle: number) => void;
						}
					).requestVideoFrameCallback;

					animationFrameRequestId = requestAnimationFrame(() => {
						animationFrameRequestId = null;
						finish();
					});

					if (typeof requestVideoFrameCallback === "function") {
						videoFrameRequestId = requestVideoFrameCallback.call(video, () => {
							videoFrameRequestId = null;
							finish();
						});
					}
				};

				const handleMediaReady = () => {
					if (
						!video.seeking &&
						Math.abs(video.currentTime - targetTime) <= 0.01 &&
						video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
					) {
						waitForPresentedFrame();
					}
				};

				const cleanup = () => {
					context.pendingMediaCancellations.delete(finish);
					video.removeEventListener("seeked", waitForPresentedFrame);
					video.removeEventListener("loadeddata", handleMediaReady);
					video.removeEventListener("canplay", handleMediaReady);
					video.removeEventListener("error", finish);
					if (animationFrameRequestId !== null) {
						cancelAnimationFrame(animationFrameRequestId);
						animationFrameRequestId = null;
					}
					if (
						videoFrameRequestId !== null &&
						typeof (
							video as HTMLVideoElement & {
								cancelVideoFrameCallback?: (handle: number) => void;
							}
						).cancelVideoFrameCallback === "function"
					) {
						(
							video as HTMLVideoElement & {
								cancelVideoFrameCallback: (handle: number) => void;
							}
						).cancelVideoFrameCallback(videoFrameRequestId);
						videoFrameRequestId = null;
					}
					if (fallbackTimeout !== null) {
						window.clearTimeout(fallbackTimeout);
					}
				};

				video.addEventListener("seeked", waitForPresentedFrame, { once: true });
				video.addEventListener("loadeddata", handleMediaReady, { once: true });
				video.addEventListener("canplay", handleMediaReady, { once: true });
				video.addEventListener("error", finish, { once: true });

				fallbackTimeout = window.setTimeout(() => {
					finish();
				}, 50);

				context.pendingMediaCancellations.add(finish);
				if (context.mediaCancelled) {
					finish();
					return;
				}

				try {
					video.currentTime = targetTime;
				} catch {
					finish();
					return;
				}

				if (
					!video.seeking &&
					Math.abs(video.currentTime - targetTime) <= 0.001 &&
					video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
				) {
					waitForPresentedFrame();
				}
			});

			try {
				await context.backgroundSeekPromise;
			} finally {
				context.backgroundSeekPromise = null;
			}
		}
	}
	context.drawVideoFrameToBackground();
}
