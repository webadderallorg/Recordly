import { getWebcamMediaTargetTimeSeconds } from "@/components/video-editor/videoPlayback/webcamSync";
import { clampMediaTimeToDuration } from "@/lib/mediaTiming";
import { ForwardFrameSource } from "./forwardFrameSource";
import { resolveMediaElementSource } from "./localMediaSource";
import type { FrameRenderContext } from "./modernFrameRenderer";
import { WEBCAM_MEDIA_ELEMENT_READY_TIMEOUT_MS } from "./modernFrameUtils";

/** Owns webcam media resources for one export renderer. */
export class FrameWebcamMedia {
	constructor(
		private readonly context: Pick<FrameRenderContext, "config" | "webcamFrames" | "webcam">,
	) {}

	webcamForwardFrameSource: ForwardFrameSource | null = null;

	webcamDecodedFrame: VideoFrame | null = null;

	webcamVideoElement: HTMLVideoElement | null = null;

	webcamSeekPromise: Promise<void> | null = null;

	cleanupWebcamSource: (() => void) | null = null;

	lastSyncedWebcamTime: number | null = null;

	disposeWebcamMediaElement(video: HTMLVideoElement): void {
		try {
			video.pause();
			video.src = "";
			video.load();
		} catch {
			// Ignore media element teardown errors during export fallback.
		}
	}

	clearWebcamMediaElement(): void {
		if (this.webcamVideoElement) {
			this.disposeWebcamMediaElement(this.webcamVideoElement);
		}

		this.webcamVideoElement = null;
		this.webcamSeekPromise = null;
		this.cleanupWebcamSource?.();
		this.cleanupWebcamSource = null;
	}

	async loadWebcamMediaElementSource(webcamUrl: string): Promise<boolean> {
		this.clearWebcamMediaElement();

		let webcamSource: Awaited<ReturnType<typeof resolveMediaElementSource>>;
		try {
			webcamSource = await resolveMediaElementSource(webcamUrl);
		} catch (error) {
			console.warn("[FrameRenderer] Unable to resolve webcam media element source:", error);
			return false;
		}
		this.cleanupWebcamSource = webcamSource.revoke;

		const video = document.createElement("video");
		video.crossOrigin = "anonymous";
		video.src = webcamSource.src;
		video.muted = true;
		video.preload = "auto";
		video.playsInline = true;
		video.load();

		const ready = await new Promise<boolean>((resolve) => {
			let readyTimeout: number | null = null;
			const onReady = () => {
				if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
					return;
				}
				cleanup();
				resolve(true);
			};
			const onError = () => {
				cleanup();
				resolve(false);
			};
			const cleanup = () => {
				video.removeEventListener("loadeddata", onReady);
				video.removeEventListener("canplay", onReady);
				video.removeEventListener("canplaythrough", onReady);
				video.removeEventListener("error", onError);
				if (readyTimeout !== null) {
					window.clearTimeout(readyTimeout);
					readyTimeout = null;
				}
			};

			if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
				resolve(true);
				return;
			}

			video.addEventListener("loadeddata", onReady, { once: true });
			video.addEventListener("canplay", onReady, { once: true });
			video.addEventListener("canplaythrough", onReady, { once: true });
			video.addEventListener("error", onError, { once: true });
			readyTimeout = window.setTimeout(() => {
				console.warn(
					`[FrameRenderer] Webcam media element fallback did not become ready within ${WEBCAM_MEDIA_ELEMENT_READY_TIMEOUT_MS}ms`,
				);
				onError();
			}, WEBCAM_MEDIA_ELEMENT_READY_TIMEOUT_MS);
		});

		if (ready && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			this.webcamVideoElement = video;
			this.lastSyncedWebcamTime = null;
			return true;
		}

		console.warn("[FrameRenderer] Webcam overlay unavailable during export");
		this.disposeWebcamMediaElement(video);
		this.clearWebcamMediaElement();
		return false;
	}

	async setupWebcamSource(): Promise<void> {
		const webcamUrl = this.context.config.webcamUrl;
		this.webcamForwardFrameSource?.cancel();
		void this.webcamForwardFrameSource?.destroy();
		this.webcamForwardFrameSource = null;
		this.closeWebcamDecodedFrame();
		this.clearWebcamMediaElement();
		this.context.webcamFrames.webcamFrameCacheCanvas = null;
		this.context.webcamFrames.webcamFrameCacheCtx = null;
		this.context.webcam.webcamLayoutCache = null;
		this.context.webcamFrames.webcamRenderMode = "hidden";
		this.lastSyncedWebcamTime = null;

		if (!this.context.config.webcam?.enabled || !webcamUrl) return;

		try {
			const frameSource = new ForwardFrameSource();
			await frameSource.initialize(webcamUrl);
			this.webcamForwardFrameSource = frameSource;
			this.webcamVideoElement = null;
			this.webcamSeekPromise = null;
			this.lastSyncedWebcamTime = null;
			return;
		} catch (error) {
			console.warn(
				"[FrameRenderer] Decoder-backed webcam source unavailable during export; falling back to media element sync:",
				error,
			);
		}

		await this.loadWebcamMediaElementSource(webcamUrl);
		this.lastSyncedWebcamTime = null;
	}

	getExpectedWebcamTargetTimeSeconds(targetTime: number): number {
		return getWebcamMediaTargetTimeSeconds({
			currentTime: targetTime,
			webcamDuration: Number.isFinite(this.webcamVideoElement?.duration)
				? this.webcamVideoElement?.duration
				: null,
			timeOffsetMs: this.context.config.webcam?.timeOffsetMs,
		});
	}

	async syncWebcamFrame(targetTime: number): Promise<void> {
		const webcamTargetTime = this.getExpectedWebcamTargetTimeSeconds(targetTime);

		if (this.webcamForwardFrameSource) {
			const clampedTime = clampMediaTimeToDuration(webcamTargetTime, null);
			try {
				const decodedFrame =
					await this.webcamForwardFrameSource.getFrameAtTime(clampedTime);
				this.closeWebcamDecodedFrame();
				this.webcamDecodedFrame = decodedFrame;
				if (decodedFrame) {
					this.lastSyncedWebcamTime = clampedTime;
				}
				return;
			} catch (error) {
				console.warn(
					"[FrameRenderer] Decoder-backed webcam source failed during export; falling back to media element sync:",
					error,
				);
				this.webcamForwardFrameSource.cancel();
				void this.webcamForwardFrameSource.destroy();
				this.webcamForwardFrameSource = null;
				this.closeWebcamDecodedFrame();
				this.lastSyncedWebcamTime = null;
				const webcamUrl = this.context.config.webcamUrl;
				if (!webcamUrl || !(await this.loadWebcamMediaElementSource(webcamUrl))) {
					return;
				}
			}
		}

		const webcamVideo = this.webcamVideoElement;
		if (!webcamVideo) {
			return;
		}

		const clampedTime = clampMediaTimeToDuration(
			webcamTargetTime,
			Number.isFinite(webcamVideo.duration) ? webcamVideo.duration : null,
		);

		if (Math.abs(webcamVideo.currentTime - clampedTime) <= 0.008) {
			this.lastSyncedWebcamTime = clampedTime;
			return;
		}

		if (this.webcamSeekPromise) {
			await this.webcamSeekPromise;
		}

		this.webcamSeekPromise = new Promise<void>((resolve) => {
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
					this.lastSyncedWebcamTime = clampedTime;
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

			webcamVideo.addEventListener("seeked", waitForPresentedFrame, {
				once: true,
			});
			webcamVideo.addEventListener("loadeddata", handleMediaReady, {
				once: true,
			});
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
			await this.webcamSeekPromise;
		} finally {
			this.webcamSeekPromise = null;
		}
	}

	closeWebcamDecodedFrame(): void {
		if (!this.webcamDecodedFrame) {
			return;
		}

		this.webcamDecodedFrame.close();
		this.webcamDecodedFrame = null;
	}

	getWebcamSourceDimensions(source: HTMLVideoElement | VideoFrame): {
		width: number;
		height: number;
	} {
		if ("displayWidth" in source && "displayHeight" in source) {
			return {
				width: source.displayWidth,
				height: source.displayHeight,
			};
		}

		return {
			width: source.videoWidth,
			height: source.videoHeight,
		};
	}
}
