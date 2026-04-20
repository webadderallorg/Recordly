import { clampMediaTimeToDuration } from "@/lib/mediaTiming";
import { ForwardFrameSource } from "./forwardFrameSource";
import { resolveMediaElementSource } from "./localMediaSource";
import type { FrameRenderer } from "./modernFrameRenderer";

export function closeWebcamDecodedFrame(self: FrameRenderer): void {
	if (!self.webcamDecodedFrame) {
		return;
	}

	self.webcamDecodedFrame.close();
	self.webcamDecodedFrame = null;
}

export async function setupWebcamSource(self: FrameRenderer): Promise<void> {
	const webcamUrl = self.config.webcamUrl;
	if (!self.config.webcam?.enabled || !webcamUrl) {
		self.webcamForwardFrameSource?.cancel();
		void self.webcamForwardFrameSource?.destroy();
		self.webcamForwardFrameSource = null;
		closeWebcamDecodedFrame(self);
		self.cleanupWebcamSource?.();
		self.cleanupWebcamSource = null;
		self.webcamVideoElement = null;
		self.webcamFrameCacheCanvas = null;
		self.webcamFrameCacheCtx = null;
		self.lastSyncedWebcamTime = null;
		self.lastWebcamCacheRefreshTime = null;
		self.webcamLayoutCache = null;
		self.webcamRenderMode = "hidden";
		return;
	}

	self.webcamForwardFrameSource?.cancel();
	void self.webcamForwardFrameSource?.destroy();
	self.webcamForwardFrameSource = null;
	closeWebcamDecodedFrame(self);
	self.cleanupWebcamSource?.();
	self.cleanupWebcamSource = null;
	self.webcamFrameCacheCanvas = null;
	self.webcamFrameCacheCtx = null;
	self.lastWebcamCacheRefreshTime = null;
	self.webcamLayoutCache = null;
	self.webcamRenderMode = "hidden";

	try {
		const frameSource = new ForwardFrameSource();
		await frameSource.initialize(webcamUrl);
		self.webcamForwardFrameSource = frameSource;
		self.webcamVideoElement = null;
		self.webcamSeekPromise = null;
		self.lastSyncedWebcamTime = null;
		self.lastWebcamCacheRefreshTime = null;
		return;
	} catch (error) {
		console.warn(
			"[FrameRenderer] Decoder-backed webcam source unavailable during export; falling back to media element sync:",
			error,
		);
	}

	const webcamSource = await resolveMediaElementSource(webcamUrl);
	self.cleanupWebcamSource = webcamSource.revoke;

	const video = document.createElement("video");
	video.src = webcamSource.src;
	video.muted = true;
	video.preload = "auto";
	video.playsInline = true;
	video.load();

	await new Promise<void>((resolve, reject) => {
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
			video.removeEventListener("loadeddata", onReady);
			video.removeEventListener("canplay", onReady);
			video.removeEventListener("canplaythrough", onReady);
			video.removeEventListener("error", onError);
		};

		if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			resolve();
			return;
		}

		video.addEventListener("loadeddata", onReady, { once: true });
		video.addEventListener("canplay", onReady, { once: true });
		video.addEventListener("canplaythrough", onReady, { once: true });
		video.addEventListener("error", onError, { once: true });
	}).catch((error) => {
		console.warn("[FrameRenderer] Webcam overlay unavailable during export:", error);
		self.webcamVideoElement = null;
	});

	if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
		self.webcamVideoElement = video;
		return;
	}

	self.webcamVideoElement = null;
	self.lastSyncedWebcamTime = null;
}

export async function syncWebcamFrame(
	self: FrameRenderer,
	targetTime: number,
): Promise<void> {
	const webcamTimeOffsetSec = (self.config.webcam?.timeOffsetMs ?? 0) / 1000;
	const webcamTargetTime = Math.max(0, targetTime + webcamTimeOffsetSec);

	if (self.webcamForwardFrameSource) {
		const clampedTime = clampMediaTimeToDuration(webcamTargetTime, null);
		const decodedFrame = await self.webcamForwardFrameSource.getFrameAtTime(clampedTime);
		closeWebcamDecodedFrame(self);
		self.webcamDecodedFrame = decodedFrame;
		if (decodedFrame) {
			self.lastSyncedWebcamTime = clampedTime;
		}
		return;
	}

	const webcamVideo = self.webcamVideoElement;
	if (!webcamVideo) {
		return;
	}

	const clampedTime = clampMediaTimeToDuration(
		webcamTargetTime,
		Number.isFinite(webcamVideo.duration) ? webcamVideo.duration : null,
	);

	if (Math.abs(webcamVideo.currentTime - clampedTime) <= 0.008) {
		self.lastSyncedWebcamTime = clampedTime;
		return;
	}

	if (self.webcamSeekPromise) {
		await self.webcamSeekPromise;
	}

	self.webcamSeekPromise = new Promise<void>((resolve) => {
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
			}
		};

		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			if (Math.abs(webcamVideo.currentTime - clampedTime) <= 0.02) {
				self.lastSyncedWebcamTime = clampedTime;
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

		webcamVideo.addEventListener("seeked", waitForPresentedFrame, { once: true });
		webcamVideo.addEventListener("loadeddata", handleMediaReady, { once: true });
		webcamVideo.addEventListener("canplay", handleMediaReady, { once: true });
		webcamVideo.addEventListener("error", finish, { once: true });

		fallbackTimeout = window.setTimeout(() => {
			finish();
		}, 50);

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
		await self.webcamSeekPromise;
	} finally {
		self.webcamSeekPromise = null;
	}
}
