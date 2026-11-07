import { getWebcamMediaTargetTimeSeconds } from "@/components/video-editor/videoPlayback/webcamSync";
import { clampMediaTimeToDuration } from "@/lib/mediaTiming";
import { ForwardFrameSource } from "./forwardFrameSource";
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";
import { resolveMediaElementSource } from "./localMediaSource";
import { WEBCAM_MEDIA_ELEMENT_READY_TIMEOUT_MS } from "./modernFrameUtils";

export async function setupWebcamSource(
	context: Pick<
		LegacyFrameRendererContext,
		| "config"
		| "webcamForwardFrameSource"
		| "closeWebcamDecodedFrame"
		| "cleanupWebcamSource"
		| "webcamVideoElement"
		| "webcamFrameCacheCanvas"
		| "webcamFrameCacheCtx"
		| "lastSyncedWebcamTime"
		| "webcamSeekPromise"
		| "pendingMediaCancellations"
		| "mediaCancelled"
	>,
	preferMediaElementSampling = context.config.preferMediaElementSampling,
): Promise<void> {
	const webcamUrl = context.config.webcamUrl;
	if (!context.config.webcam?.enabled || !webcamUrl) {
		context.webcamForwardFrameSource?.cancel();
		void context.webcamForwardFrameSource?.destroy();
		context.webcamForwardFrameSource = null;
		context.closeWebcamDecodedFrame();
		context.cleanupWebcamSource?.();
		context.cleanupWebcamSource = null;
		context.webcamVideoElement = null;
		context.webcamFrameCacheCanvas = null;
		context.webcamFrameCacheCtx = null;
		context.lastSyncedWebcamTime = null;
		return;
	}

	context.webcamForwardFrameSource?.cancel();
	void context.webcamForwardFrameSource?.destroy();
	context.webcamForwardFrameSource = null;
	context.closeWebcamDecodedFrame();
	context.cleanupWebcamSource?.();
	context.cleanupWebcamSource = null;

	if (!preferMediaElementSampling) {
		try {
			const frameSource = new ForwardFrameSource();
			await frameSource.initialize(webcamUrl);
			context.webcamForwardFrameSource = frameSource;
			context.webcamVideoElement = null;
			context.webcamSeekPromise = null;
			context.webcamFrameCacheCanvas = null;
			context.webcamFrameCacheCtx = null;
			context.lastSyncedWebcamTime = null;
			return;
		} catch (error) {
			console.warn(
				"[FrameRenderer] Decoder-backed webcam source unavailable during export; falling back to media element sync:",
				error,
			);
		}
	}

	const webcamSource = await resolveMediaElementSource(webcamUrl);
	context.cleanupWebcamSource = webcamSource.revoke;

	const video = document.createElement("video");
	video.crossOrigin = "anonymous";
	video.src = webcamSource.src;
	video.muted = true;
	video.preload = "auto";
	video.playsInline = true;
	video.load();

	await new Promise<void>((resolve, reject) => {
		let readyTimeout: number | null = null;
		const onReady = () => {
			if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
				return;
			}
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("Failed to load webcam source for export"));
		};
		const cleanup = () => {
			if (readyTimeout !== null) window.clearTimeout(readyTimeout);
			context.pendingMediaCancellations.delete(onError);
			video.removeEventListener("loadeddata", onReady);
			video.removeEventListener("canplay", onReady);
			video.removeEventListener("canplaythrough", onReady);
			video.removeEventListener("error", onError);
		};
		if (context.mediaCancelled) {
			onError();
			return;
		}
		if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			resolve();
			return;
		}
		video.addEventListener("loadeddata", onReady, { once: true });
		video.addEventListener("canplay", onReady, { once: true });
		video.addEventListener("canplaythrough", onReady, { once: true });
		video.addEventListener("error", onError, { once: true });
		context.pendingMediaCancellations.add(onError);
		readyTimeout = window.setTimeout(onError, WEBCAM_MEDIA_ELEMENT_READY_TIMEOUT_MS);
	}).catch((error) => {
		console.warn("[FrameRenderer] Webcam overlay unavailable during export:", error);
		context.webcamVideoElement = null;
	});

	if (!context.mediaCancelled && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
		context.webcamVideoElement = video;
		return;
	}

	video.pause();
	video.src = "";
	video.load();
	context.cleanupWebcamSource?.();
	context.cleanupWebcamSource = null;
	context.webcamVideoElement = null;
	context.webcamFrameCacheCanvas = null;
	context.webcamFrameCacheCtx = null;
	context.lastSyncedWebcamTime = null;
}

export async function syncWebcamFrame(
	context: Pick<
		LegacyFrameRendererContext,
		| "webcamVideoElement"
		| "config"
		| "webcamForwardFrameSource"
		| "closeWebcamDecodedFrame"
		| "webcamDecodedFrame"
		| "lastSyncedWebcamTime"
		| "webcamSeekPromise"
		| "cleanupWebcamSource"
		| "webcamFrameCacheCanvas"
		| "webcamFrameCacheCtx"
		| "pendingMediaCancellations"
		| "mediaCancelled"
	>,
	targetTime: number,
): Promise<void> {
	const webcamTargetTime = getWebcamMediaTargetTimeSeconds({
		currentTime: targetTime,
		webcamDuration: Number.isFinite(context.webcamVideoElement?.duration)
			? context.webcamVideoElement?.duration
			: null,
		timeOffsetMs: context.config.webcam?.timeOffsetMs,
	});

	if (context.webcamForwardFrameSource) {
		const frameSource = context.webcamForwardFrameSource;
		const clampedTime = clampMediaTimeToDuration(webcamTargetTime, null);
		try {
			const decodedFrame = await frameSource.getFrameAtTime(clampedTime);
			context.closeWebcamDecodedFrame();
			context.webcamDecodedFrame = decodedFrame;
			if (decodedFrame) context.lastSyncedWebcamTime = clampedTime;
			return;
		} catch (error) {
			console.warn(
				"[FrameRenderer] Webcam decoder failed; retrying media element sync:",
				error,
			);
			frameSource.cancel();
			void frameSource.destroy();
			if (context.webcamForwardFrameSource === frameSource) {
				context.webcamForwardFrameSource = null;
			}
			context.closeWebcamDecodedFrame();
			context.lastSyncedWebcamTime = null;
			if (context.mediaCancelled) return;
			try {
				await setupWebcamSource(context, true);
			} catch (fallbackError) {
				console.warn(
					"[FrameRenderer] Webcam media element fallback unavailable:",
					fallbackError,
				);
				context.webcamVideoElement = null;
				return;
			}
		}
	}

	const webcamVideo = context.webcamVideoElement;
	if (!webcamVideo) {
		return;
	}

	const clampedTime = clampMediaTimeToDuration(
		webcamTargetTime,
		Number.isFinite(webcamVideo.duration) ? webcamVideo.duration : null,
	);

	if (Math.abs(webcamVideo.currentTime - clampedTime) <= 0.008) {
		context.lastSyncedWebcamTime = clampedTime;
		return;
	}

	if (context.webcamSeekPromise) {
		await context.webcamSeekPromise;
	}

	context.webcamSeekPromise = new Promise<void>((resolve) => {
		let settled = false;
		let fallbackTimeout: number | null = null;
		let animationFrameRequestId: number | null = null;
		let videoFrameRequestId: number | null = null;
		const waitForPresentedFrame = () => {
			const requestVideoFrameCallback = (
				webcamVideo as HTMLVideoElement & {
					requestVideoFrameCallback?: (
						callback: (
							now: DOMHighResTimeStamp,
							metadata: VideoFrameCallbackMetadata,
						) => void,
					) => number;
					cancelVideoFrameCallback?: (handle: number) => void;
				}
			).requestVideoFrameCallback;

			const scheduleAnimationFrameFinish = () => {
				animationFrameRequestId = requestAnimationFrame(() => {
					animationFrameRequestId = null;
					finish();
				});
			};

			scheduleAnimationFrameFinish();

			if (typeof requestVideoFrameCallback === "function") {
				videoFrameRequestId = requestVideoFrameCallback.call(webcamVideo, () => {
					videoFrameRequestId = null;
					finish();
				});
				return;
			}
		};
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			if (Math.abs(webcamVideo.currentTime - clampedTime) <= 0.02) {
				context.lastSyncedWebcamTime = clampedTime;
			}
			cleanup();
			resolve();
		};
		const handleMediaReady = () => {
			if (
				!webcamVideo.seeking &&
				Math.abs(webcamVideo.currentTime - clampedTime) <= 0.01 &&
				webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
			) {
				waitForPresentedFrame();
			}
		};
		const cleanup = () => {
			context.pendingMediaCancellations.delete(finish);
			webcamVideo.removeEventListener("seeked", waitForPresentedFrame);
			webcamVideo.removeEventListener("loadeddata", handleMediaReady);
			webcamVideo.removeEventListener("canplay", handleMediaReady);
			webcamVideo.removeEventListener("error", finish);
			if (animationFrameRequestId !== null) {
				cancelAnimationFrame(animationFrameRequestId);
				animationFrameRequestId = null;
			}
			if (
				videoFrameRequestId !== null &&
				typeof (
					webcamVideo as HTMLVideoElement & {
						cancelVideoFrameCallback?: (handle: number) => void;
					}
				).cancelVideoFrameCallback === "function"
			) {
				(
					webcamVideo as HTMLVideoElement & {
						cancelVideoFrameCallback: (handle: number) => void;
					}
				).cancelVideoFrameCallback(videoFrameRequestId);
				videoFrameRequestId = null;
			}
			if (fallbackTimeout !== null) {
				window.clearTimeout(fallbackTimeout);
			}
		};

		webcamVideo.addEventListener("seeked", waitForPresentedFrame, {
			once: true,
		});
		webcamVideo.addEventListener("loadeddata", handleMediaReady, {
			once: true,
		});
		webcamVideo.addEventListener("canplay", handleMediaReady, {
			once: true,
		});
		webcamVideo.addEventListener("error", finish, {
			once: true,
		});
		fallbackTimeout = window.setTimeout(() => {
			finish();
		}, 50);

		context.pendingMediaCancellations.add(finish);
		if (context.mediaCancelled) {
			finish();
			return;
		}

		try {
			webcamVideo.currentTime = clampedTime;
		} catch {
			finish();
			return;
		}

		if (
			!webcamVideo.seeking &&
			Math.abs(webcamVideo.currentTime - clampedTime) <= 0.001 &&
			webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
		) {
			waitForPresentedFrame();
		}
	});

	try {
		await context.webcamSeekPromise;
	} finally {
		context.webcamSeekPromise = null;
	}
}

export function closeWebcamDecodedFrame(
	context: Pick<LegacyFrameRendererContext, "webcamDecodedFrame">,
): void {
	if (!context.webcamDecodedFrame) {
		return;
	}

	context.webcamDecodedFrame.close();
	context.webcamDecodedFrame = null;
}
