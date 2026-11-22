import { Graphics, Sprite, Texture } from "pixi.js";
import { useEffect, useRef } from "react";
import { destroyPixiContainer } from "@/lib/pixiApplicationLifecycle";
import { createClipPlayback, findPreviewClipAtTimelineTime } from "./clipPlayback";
import type { PlaybackProps } from "./playbackProps";
import { createPlaybackAnimationState } from "./playbackTypes";
import { PreviewFrameTexture } from "./previewFrameTexture";
import { subscribePreviewReadiness } from "./previewReadiness";
import type { usePlaybackState } from "./usePlaybackState";
export type usePlaybackTransportInput = Pick<
	ReturnType<typeof usePlaybackState> & PlaybackProps,
	| "requestPreviewRender"
	| "regenerateFrame"
	| "videoRef"
	| "lastRenderedContentTimeRef"
	| "shouldSnapPausedFrameRef"
	| "shouldRegenerateFrameRef"
	| "suspendRenderingRef"
	| "lockedVideoDimensionsRef"
	| "videoPath"
	| "onPreviewReadyChange"
	| "videoReady"
	| "pixiReady"
	| "appRef"
	| "videoEffectsContainerRef"
	| "videoContainerRef"
	| "cursorContainerRef"
	| "cameraContainerRef"
	| "previewVideoSourceRef"
	| "videoSpriteRef"
	| "maskGraphicsRef"
	| "cursorOverlayRef"
	| "animationStateRef"
	| "layoutVideoContentRef"
	| "clipRegionsRef"
	| "timelineTimeRef"
	| "currentTimeRef"
	| "onTimeUpdate"
	| "isPlayingRef"
	| "onPlayStateChange"
	| "onPlaybackErrorRef"
	| "clipPlaybackRef"
	| "autoPlay"
	| "isSeekingRef"
	| "baseMaskRef"
	| "sourceRedactionRef"
	| "updatePreviewTextureRef"
>;
export function usePlaybackTransport(input: usePlaybackTransportInput) {
	const {
		requestPreviewRender,
		regenerateFrame,
		videoRef,
		lastRenderedContentTimeRef,
		shouldSnapPausedFrameRef,
		shouldRegenerateFrameRef,
		suspendRenderingRef,
		lockedVideoDimensionsRef,
		videoPath,
		onPreviewReadyChange,
		videoReady,
		pixiReady,
		appRef,
		videoEffectsContainerRef,
		videoContainerRef,
		cursorContainerRef,
		cameraContainerRef,
		previewVideoSourceRef,
		videoSpriteRef,
		maskGraphicsRef,
		cursorOverlayRef,
		animationStateRef,
		layoutVideoContentRef,
		clipRegionsRef,
		timelineTimeRef,
		currentTimeRef,
		onTimeUpdate,
		isPlayingRef,
		onPlayStateChange,
		onPlaybackErrorRef,
		clipPlaybackRef,
		autoPlay,
		isSeekingRef,
		baseMaskRef,
		sourceRedactionRef,
		updatePreviewTextureRef,
	} = input;
	const callbacksRef = useRef({ onTimeUpdate, onPlayStateChange, onPreviewReadyChange });
	callbacksRef.current = { onTimeUpdate, onPlayStateChange, onPreviewReadyChange };

	// biome-ignore lint/correctness/useExhaustiveDependencies: A new media path must reset the persistent video element.
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		video.pause();
		video.currentTime = 0;
		isSeekingRef.current = false;
		lastRenderedContentTimeRef.current = null;
		shouldSnapPausedFrameRef.current = true;
		lockedVideoDimensionsRef.current = null;
	}, [
		videoPath,
		videoRef,
		lastRenderedContentTimeRef,
		shouldSnapPausedFrameRef,
		lockedVideoDimensionsRef,
		isSeekingRef,
	]);

	useEffect(() => {
		if (!videoReady || !pixiReady) callbacksRef.current.onPreviewReadyChange?.(false);
	}, [videoReady, pixiReady]);

	useEffect(() => {
		if (!pixiReady || !videoReady) return;

		const video = videoRef.current;
		const app = appRef.current;
		const videoEffectsContainer = videoEffectsContainerRef.current;
		const videoContainer = videoContainerRef.current;
		const cursorContainer = cursorContainerRef.current;
		const cameraContainer = cameraContainerRef.current;

		if (
			!video ||
			!app ||
			!videoEffectsContainer ||
			!videoContainer ||
			!cursorContainer ||
			!cameraContainer
		)
			return;
		if (video.videoWidth === 0 || video.videoHeight === 0) return;

		const source = previewVideoSourceRef.current.getSource();
		let frameTexture = new PreviewFrameTexture(source);
		const videoSprite = new Sprite(Texture.EMPTY);
		videoSprite.visible = false;
		videoSpriteRef.current = videoSprite;
		let reportedTextureError = false;
		let regenerateWhenMediaReady = false;
		let lastFramePrivacyKey: string | null = null;
		let lastFrameCrop: { x: number; y: number; width: number; height: number } | null = null;
		const rebuildTexture = () => {
			// Drop the upload and cached privacy surface without resetting the decoder.
			videoSprite.visible = false;
			videoSprite.texture = Texture.EMPTY;
			frameTexture.dispose();
			source.unload();
			frameTexture = new PreviewFrameTexture(source);
			shouldRegenerateFrameRef.current = false;
		};
		const updatePreviewTexture = () => {
			const { annotationRegions, privacyKey } = sourceRedactionRef.current;
			const crop = baseMaskRef.current.sourceCrop ?? { x: 0, y: 0, width: 1, height: 1 };
			if (video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
				// Keep the already-uploaded, privacy-composed image while decoding.
				// An output edit invalidates that image until its masks can be rebuilt.
				if (
					privacyKey !== lastFramePrivacyKey ||
					(privacyKey !== "[]" &&
						(!lastFrameCrop ||
							crop.x !== lastFrameCrop.x ||
							crop.y !== lastFrameCrop.y ||
							crop.width !== lastFrameCrop.width ||
							crop.height !== lastFrameCrop.height))
				)
					videoSprite.visible = false;
				return;
			}
			const uploadFrame = () => {
				const texture = frameTexture.update(video, {
					annotations: annotationRegions,
					// Match the crop already applied to the sprite, including during edits.
					cropRegion: crop,
					timeMs: timelineTimeRef.current * 1000,
				});
				if (
					texture.destroyed ||
					texture.source.destroyed ||
					texture.width !== video.videoWidth ||
					texture.height !== video.videoHeight
				) {
					throw new Error("Preview frame texture does not match the decoded recording");
				}
				videoSprite.texture = texture;
				lastFramePrivacyKey = privacyKey;
				lastFrameCrop = { ...crop };
				videoSprite.visible = true;
				reportedTextureError = false;
				regenerateWhenMediaReady = false;
			};

			const regenerate = shouldRegenerateFrameRef.current && !suspendRenderingRef.current;
			try {
				if (regenerate) rebuildTexture();
				uploadFrame();
			} catch (error) {
				// A failed privacy pass must never reveal the unredacted source.
				videoSprite.visible = false;
				if (regenerate) regenerateWhenMediaReady = true;
				let failure = error;
				if (!regenerate && !reportedTextureError && !suspendRenderingRef.current) {
					console.warn("Preview frame invalid; rebuilding its texture:", error);
					try {
						rebuildTexture();
						uploadFrame();
						console.info("Recovered the recording preview frame.");
						return;
					} catch (retryError) {
						failure = retryError;
					}
				}
				if (!reportedTextureError) {
					reportedTextureError = true;
					onPlaybackErrorRef.current(
						failure instanceof Error ? failure.message : String(failure),
					);
				}
			}
		};
		updatePreviewTextureRef.current = updatePreviewTexture;
		updatePreviewTexture();

		const maskGraphics = new Graphics();
		videoContainer.addChild(videoSprite);
		// Match both export renderers: crop/round the source first, then blur
		// its silhouette. Masking the effects wrapper clips the trails away.
		videoEffectsContainer.addChild(maskGraphics);
		videoContainer.mask = maskGraphics;
		maskGraphicsRef.current = maskGraphics;
		if (cursorOverlayRef.current) {
			cursorContainer.addChild(cursorOverlayRef.current.container);
		}

		const stopReadiness = subscribePreviewReadiness({
			runner: app.renderer.runners.postrender,
			isFrameReady: () => {
				const openingGap =
					clipRegionsRef.current.length > 0 &&
					!findPreviewClipAtTimelineTime(
						timelineTimeRef.current * 1000,
						clipRegionsRef.current,
					);
				const composedTime = lastRenderedContentTimeRef.current;
				return (
					composedTime !== null &&
					Math.abs(composedTime - timelineTimeRef.current * 1000) < 0.001 &&
					!shouldSnapPausedFrameRef.current &&
					!video.seeking &&
					video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
					app.canvas.width > 0 &&
					app.canvas.height > 0 &&
					baseMaskRef.current.width > 0 &&
					baseMaskRef.current.height > 0 &&
					(videoSprite.visible || openingGap)
				);
			},
			onChange: (ready) => callbacksRef.current.onPreviewReadyChange?.(ready),
		});

		animationStateRef.current = createPlaybackAnimationState();

		layoutVideoContentRef.current?.();
		video.pause();

		let preserveCameraAcrossCut = false;
		const transport = createClipPlayback({
			video,
			getClips: () => clipRegionsRef.current,
			onSourceSeek: (reason) => {
				preserveCameraAcrossCut = reason === "cut";
				// currentTime starts seeking synchronously, before the DOM event.
				isSeekingRef.current = true;
				if (!preserveCameraAcrossCut) shouldSnapPausedFrameRef.current = true;
			},
			onTime: (time, source) => {
				timelineTimeRef.current = time;
				if (source !== null) currentTimeRef.current = source * 1000;
				callbacksRef.current.onTimeUpdate(time);
				requestPreviewRender();
			},
			onPlaying: (playing) => {
				isPlayingRef.current = playing;
				callbacksRef.current.onPlayStateChange(playing);
			},
			onError: (error) =>
				onPlaybackErrorRef.current(error instanceof Error ? error.message : String(error)),
		});
		clipPlaybackRef.current = transport;
		transport.seek(timelineTimeRef.current);
		updatePreviewTexture();
		if (autoPlay)
			void transport.play().catch((error) => onPlaybackErrorRef.current(String(error)));
		const handleSeeked = () => {
			if (video.seeking) return;
			// Pixi's default seek handler only updates paused videos. Scrubbing
			// while playing must also upload the decoded frame with its new pose.
			updatePreviewTexture();
			isSeekingRef.current = false;
			// A source seek at a contiguous cut must not reset the camera springs.
			if (!preserveCameraAcrossCut || !isPlayingRef.current)
				shouldSnapPausedFrameRef.current = true;
			preserveCameraAcrossCut = false;
			requestPreviewRender();
		};
		const handleSeeking = () => {
			isSeekingRef.current = true;
			if (!preserveCameraAcrossCut) shouldSnapPausedFrameRef.current = true;
		};
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") regenerateFrame();
		};
		const handleMediaReady = () => {
			// A paused preview has no continuous ticker to retry a deferred upload.
			if (regenerateWhenMediaReady) {
				regenerateWhenMediaReady = false;
				shouldRegenerateFrameRef.current = true;
			}
			if (shouldRegenerateFrameRef.current) requestPreviewRender();
		};
		const canvas = app.canvas;
		document.addEventListener("visibilitychange", handleVisibilityChange);
		canvas.addEventListener("webglcontextrestored", regenerateFrame);
		video.addEventListener("canplay", handleMediaReady);
		video.addEventListener("loadeddata", handleMediaReady);
		video.addEventListener("seeked", handleSeeked);
		video.addEventListener("seeking", handleSeeking);

		return () => {
			stopReadiness();
			if (updatePreviewTextureRef.current === updatePreviewTexture) {
				updatePreviewTextureRef.current = null;
			}
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			canvas.removeEventListener("webglcontextrestored", regenerateFrame);
			video.removeEventListener("canplay", handleMediaReady);
			video.removeEventListener("loadeddata", handleMediaReady);
			video.removeEventListener("seeked", handleSeeked);
			video.removeEventListener("seeking", handleSeeking);
			transport.dispose();
			clipPlaybackRef.current = null;

			videoEffectsContainer.mask = null;
			videoContainer.mask = null;
			destroyPixiContainer(videoSprite);
			destroyPixiContainer(maskGraphics);
			maskGraphicsRef.current = null;
			frameTexture.dispose();
			previewVideoSourceRef.current.suspend();

			videoSpriteRef.current = null;
		};
	}, [
		autoPlay,
		requestPreviewRender,
		regenerateFrame,
		pixiReady,
		videoReady,
		videoRef,
		appRef,
		videoEffectsContainerRef,
		videoContainerRef,
		cursorContainerRef,
		cameraContainerRef,
		previewVideoSourceRef,
		videoSpriteRef,
		maskGraphicsRef,
		cursorOverlayRef,
		animationStateRef,
		layoutVideoContentRef,
		clipRegionsRef,
		timelineTimeRef,
		currentTimeRef,
		isPlayingRef,
		onPlaybackErrorRef,
		clipPlaybackRef,
		isSeekingRef,
		shouldSnapPausedFrameRef,
		shouldRegenerateFrameRef,
		suspendRenderingRef,
		baseMaskRef,
		sourceRedactionRef,
		updatePreviewTextureRef,
		lastRenderedContentTimeRef,
	]);
	return {};
}
