import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { ForwardFrameSource } from "./forwardFrameSource";
import { resolveMediaElementSource } from "./localMediaSource";
import type { FrameRenderContext } from "./modernFrameRenderer";
import { BACKGROUND_MEDIA_ELEMENT_READY_TIMEOUT_MS } from "./modernFrameUtils";

/** Owns background playback resources for one export renderer. */
export class FrameBackgroundPlayback {
	constructor(private readonly context: Pick<FrameRenderContext, "textures" | "background">) {}

	backgroundForwardFrameSource: ForwardFrameSource | null = null;

	backgroundForwardFrameSourceUrl: string | null = null;

	backgroundForwardFrameDurationSec: number | null = null;

	backgroundDecodedFrame: VideoFrame | null = null;

	backgroundVideoElement: HTMLVideoElement | null = null;

	backgroundSeekPromise: Promise<void> | null = null;

	cleanupBackgroundSource: (() => void) | null = null;

	lastSyncedBackgroundLoopTimeSec: number | null = null;

	closeBackgroundDecodedFrame(): void {
		if (!this.backgroundDecodedFrame) {
			return;
		}

		this.backgroundDecodedFrame.close();
		this.backgroundDecodedFrame = null;
	}

	async restartBackgroundForwardFrameSource(): Promise<void> {
		const sourceUrl = this.backgroundForwardFrameSourceUrl;
		if (!sourceUrl) {
			return;
		}

		const nextSource = new ForwardFrameSource();
		const metadata = await nextSource.initialize(sourceUrl);
		const previousSource = this.backgroundForwardFrameSource;

		this.backgroundForwardFrameSource = nextSource;
		const effectiveDuration = getEffectiveVideoStreamDurationSeconds({
			duration: metadata?.duration,
			streamDuration: metadata?.streamDuration,
		});
		this.backgroundForwardFrameDurationSec =
			Number.isFinite(effectiveDuration) && effectiveDuration > 0 ? effectiveDuration : null;
		this.lastSyncedBackgroundLoopTimeSec = null;

		previousSource?.cancel();
		void previousSource?.destroy();
	}

	async syncBackgroundFrame(timeSeconds: number): Promise<void> {
		if (this.backgroundForwardFrameSource) {
			const duration = this.backgroundForwardFrameDurationSec;
			const shouldLoop = Number.isFinite(duration) && (duration ?? 0) > 0;
			let normalizedTargetTime = shouldLoop
				? ((timeSeconds % duration!) + duration!) % duration!
				: Math.max(0, timeSeconds);

			if (
				shouldLoop &&
				this.lastSyncedBackgroundLoopTimeSec !== null &&
				normalizedTargetTime + 0.001 < this.lastSyncedBackgroundLoopTimeSec
			) {
				try {
					await this.restartBackgroundForwardFrameSource();
				} catch (error) {
					console.warn(
						"[FrameRenderer] Unable to restart looping video wallpaper decoder during export:",
						error,
					);
				}
			}

			let decodedFrame: VideoFrame | null = null;
			try {
				decodedFrame =
					await this.backgroundForwardFrameSource.getFrameAtTime(normalizedTargetTime);
			} catch (error) {
				console.warn(
					"[FrameRenderer] Decoder-backed video wallpaper failed during export; falling back to media element sync:",
					error,
				);
				if (await this.fallbackBackgroundForwardFrameSourceToMediaElement()) {
					await this.syncBackgroundFrame(timeSeconds);
				}
				return;
			}
			const resolvedDecodedDuration =
				this.backgroundForwardFrameSource.getResolvedDurationSec();
			if (
				shouldLoop &&
				this.backgroundForwardFrameSource.hasReachedEndOfStream() &&
				Number.isFinite(resolvedDecodedDuration) &&
				(resolvedDecodedDuration ?? 0) > 0 &&
				normalizedTargetTime > (resolvedDecodedDuration ?? 0) + 0.001
			) {
				this.backgroundForwardFrameDurationSec = resolvedDecodedDuration ?? null;
				this.closeBackgroundDecodedFrame();
				decodedFrame?.close();
				try {
					await this.restartBackgroundForwardFrameSource();
					normalizedTargetTime =
						((timeSeconds % resolvedDecodedDuration!) + resolvedDecodedDuration!) %
						resolvedDecodedDuration!;
					const restartedFrame =
						await this.backgroundForwardFrameSource.getFrameAtTime(
							normalizedTargetTime,
						);
					this.backgroundDecodedFrame = restartedFrame;
					if (restartedFrame) {
						this.lastSyncedBackgroundLoopTimeSec = normalizedTargetTime;
						const resolvedBackgroundSource =
							this.context.textures.stageVideoFrameForTexture(
								restartedFrame,
								"background",
								restartedFrame.displayWidth,
								restartedFrame.displayHeight,
							);
						await this.context.background.ensureBackgroundSprite(
							resolvedBackgroundSource,
							restartedFrame.displayWidth,
							restartedFrame.displayHeight,
						);
					}
					return;
				} catch (error) {
					console.warn(
						"[FrameRenderer] Unable to wrap looping video wallpaper at decoded EOF during export:",
						error,
					);
					if (await this.fallbackBackgroundForwardFrameSourceToMediaElement()) {
						await this.syncBackgroundFrame(timeSeconds);
					}
					return;
				}
			}
			this.closeBackgroundDecodedFrame();
			this.backgroundDecodedFrame = decodedFrame;
			if (decodedFrame) {
				this.lastSyncedBackgroundLoopTimeSec = normalizedTargetTime;
				const resolvedBackgroundSource = this.context.textures.stageVideoFrameForTexture(
					decodedFrame,
					"background",
					decodedFrame.displayWidth,
					decodedFrame.displayHeight,
				);
				await this.context.background.ensureBackgroundSprite(
					resolvedBackgroundSource,
					decodedFrame.displayWidth,
					decodedFrame.displayHeight,
				);
			}
			return;
		}

		const video = this.backgroundVideoElement;
		if (!video) {
			return;
		}

		if (video.duration && Number.isFinite(video.duration)) {
			const targetTime = timeSeconds % video.duration;
			if (Math.abs(video.currentTime - targetTime) > 0.008) {
				if (this.backgroundSeekPromise) {
					await this.backgroundSeekPromise;
				}

				this.backgroundSeekPromise = new Promise<void>((resolve) => {
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

					video.addEventListener("seeked", waitForPresentedFrame, {
						once: true,
					});
					video.addEventListener("loadeddata", handleMediaReady, {
						once: true,
					});
					video.addEventListener("canplay", handleMediaReady, { once: true });
					video.addEventListener("error", finish, { once: true });

					fallbackTimeout = window.setTimeout(() => {
						finish();
					}, 50);

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
					await this.backgroundSeekPromise;
				} finally {
					this.backgroundSeekPromise = null;
				}
			}
		}

		this.context.background.ensureBackgroundSprite(video, video.videoWidth, video.videoHeight);
	}

	async fallbackBackgroundForwardFrameSourceToMediaElement(): Promise<boolean> {
		const sourceUrl = this.backgroundForwardFrameSourceUrl;
		this.backgroundForwardFrameSource?.cancel();
		void this.backgroundForwardFrameSource?.destroy();
		this.backgroundForwardFrameSource = null;
		this.backgroundForwardFrameSourceUrl = null;
		this.backgroundForwardFrameDurationSec = null;
		this.closeBackgroundDecodedFrame();
		this.lastSyncedBackgroundLoopTimeSec = null;

		return sourceUrl ? this.loadBackgroundMediaElementSource(sourceUrl, sourceUrl) : false;
	}

	async loadBackgroundMediaElementSource(videoSrc: string, errorLabel: string): Promise<boolean> {
		if (this.backgroundVideoElement) {
			try {
				this.backgroundVideoElement.pause();
				this.backgroundVideoElement.src = "";
				this.backgroundVideoElement.load();
			} catch {
				// Ignore media element teardown errors during export fallback.
			}
			this.backgroundVideoElement = null;
		}
		this.backgroundSeekPromise = null;
		this.cleanupBackgroundSource?.();
		this.cleanupBackgroundSource = null;

		let backgroundSource: Awaited<ReturnType<typeof resolveMediaElementSource>>;
		try {
			backgroundSource = await resolveMediaElementSource(videoSrc);
		} catch (error) {
			console.warn(
				"[FrameRenderer] Unable to resolve video wallpaper fallback source:",
				error,
			);
			return false;
		}
		this.cleanupBackgroundSource = backgroundSource.revoke;

		const video = document.createElement("video");
		video.crossOrigin = "anonymous";
		video.muted = true;
		video.loop = true;
		video.playsInline = true;
		video.preload = "auto";
		video.src = backgroundSource.src;
		video.load();

		const ready = await new Promise<boolean>((resolve) => {
			let settled = false;
			let timeoutId: ReturnType<typeof setTimeout> | null = null;

			function cleanup() {
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
			onReady();
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
			if (this.cleanupBackgroundSource === backgroundSource.revoke) {
				this.cleanupBackgroundSource = null;
			}
			return false;
		}

		this.backgroundVideoElement = video;
		this.lastSyncedBackgroundLoopTimeSec = null;
		await this.context.background.ensureBackgroundSprite(
			video,
			video.videoWidth,
			video.videoHeight,
		);
		return true;
	}
}
