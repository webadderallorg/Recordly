import { Graphics, Sprite, Texture } from "pixi.js";
import { useEffect } from "react";
import { destroyPixiContainer } from "@/lib/pixiApplicationLifecycle";
import { createClipPlayback } from "./clipPlayback";
import type { PlaybackProps } from "./playbackProps";
import { createPlaybackAnimationState } from "./playbackTypes";
import { PreviewFrameTexture } from "./previewFrameTexture";
import type { usePlaybackState } from "./usePlaybackState";
export type usePlaybackTransportInput = Pick<
	ReturnType<typeof usePlaybackState> & PlaybackProps,
	| "requestPreviewRender"
	| "videoRef"
	| "lastRenderedContentTimeRef"
	| "shouldSnapPausedFrameRef"
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
		videoRef,
		lastRenderedContentTimeRef,
		shouldSnapPausedFrameRef,
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
		onPreviewReadyChange?.(videoReady);
	}, [onPreviewReadyChange, videoReady]);

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
		const frameTexture = new PreviewFrameTexture(source);
		const videoSprite = new Sprite(Texture.EMPTY);
		videoSprite.visible = false;
		videoSpriteRef.current = videoSprite;
		let reportedTextureError = false;
		let lastFrameAnnotations: PlaybackProps["annotationRegions"] | null = null;
		let lastFrameCrop: { x: number; y: number; width: number; height: number } | null = null;
		const updatePreviewTexture = () => {
			const { annotationRegions } = sourceRedactionRef.current;
			const crop = baseMaskRef.current.sourceCrop ?? { x: 0, y: 0, width: 1, height: 1 };
			if (video.seeking) {
				// Keep the already-uploaded, privacy-composed image while decoding.
				// An output edit invalidates that image until its masks can be rebuilt.
				if (
					annotationRegions !== lastFrameAnnotations ||
					!lastFrameCrop ||
					crop.x !== lastFrameCrop.x ||
					crop.y !== lastFrameCrop.y ||
					crop.width !== lastFrameCrop.width ||
					crop.height !== lastFrameCrop.height
				)
					videoSprite.visible = false;
				return;
			}
			try {
				videoSprite.texture = frameTexture.update(video, {
					annotations: annotationRegions,
					// Match the crop already applied to the sprite, including during edits.
					cropRegion: crop,
					timeMs: timelineTimeRef.current * 1000,
				});
				lastFrameAnnotations = annotationRegions;
				lastFrameCrop = { ...crop };
				videoSprite.visible = true;
				reportedTextureError = false;
			} catch (error) {
				// A failed privacy pass must never reveal the unredacted source.
				videoSprite.visible = false;
				if (!reportedTextureError) {
					reportedTextureError = true;
					onPlaybackErrorRef.current(
						error instanceof Error ? error.message : String(error),
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
				onTimeUpdate(time);
				requestPreviewRender();
			},
			onPlaying: (playing) => {
				isPlayingRef.current = playing;
				onPlayStateChange(playing);
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
		video.addEventListener("seeked", handleSeeked);
		video.addEventListener("seeking", handleSeeking);

		return () => {
			if (updatePreviewTextureRef.current === updatePreviewTexture) {
				updatePreviewTextureRef.current = null;
			}
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
		onPlayStateChange,
		onTimeUpdate,
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
		baseMaskRef,
		sourceRedactionRef,
		updatePreviewTextureRef,
	]);
	return {};
}
