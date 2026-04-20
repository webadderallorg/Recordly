import { useEffect } from "react";
import { BlurFilter, Graphics, Sprite, Texture, VideoSource } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { createVideoEventHandlers } from "../videoPlayback/videoEventHandlers";
import type { VideoPlaybackRuntimeRefs } from "./shared";

interface UsePixiVideoSceneParams {
	refs: VideoPlaybackRuntimeRefs;
	pixiReady: boolean;
	videoReady: boolean;
	onTimeUpdate: (time: number) => void;
	onPlayStateChange: (playing: boolean) => void;
	layoutVideoContent: () => void;
	updateOverlayForRegion: () => void;
}

export function usePixiVideoScene({
	refs,
	pixiReady,
	videoReady,
	onTimeUpdate,
	onPlayStateChange,
	layoutVideoContent,
	updateOverlayForRegion,
}: UsePixiVideoSceneParams) {
	useEffect(() => {
		if (!pixiReady || !videoReady) return;

		const video = refs.videoRef.current;
		const app = refs.appRef.current;
		const videoContainer = refs.videoContainerRef.current;
		const cursorContainer = refs.cursorContainerRef.current;

		if (!video || !app || !videoContainer || !cursorContainer) return;
		if (video.videoWidth === 0 || video.videoHeight === 0) return;

		const source = VideoSource.from(video);
		if ("autoPlay" in source) {
			(source as { autoPlay?: boolean }).autoPlay = false;
		}
		if ("autoUpdate" in source) {
			(source as { autoUpdate?: boolean }).autoUpdate = true;
		}
		const videoTexture = Texture.from(source);

		const videoSprite = new Sprite(videoTexture);
		refs.videoSpriteRef.current = videoSprite;

		const maskGraphics = new Graphics();
		videoContainer.addChild(videoSprite);
		videoContainer.addChild(maskGraphics);
		videoContainer.mask = maskGraphics;
		refs.maskGraphicsRef.current = maskGraphics;
		if (refs.cursorOverlayRef.current) {
			cursorContainer.addChild(refs.cursorOverlayRef.current.container);
		}

		const blurFilter = new BlurFilter();
		blurFilter.quality = 3;
		blurFilter.resolution = app.renderer.resolution;
		blurFilter.blur = 0;
		const motionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
		videoContainer.filters = [blurFilter, motionBlurFilter];
		refs.blurFilterRef.current = blurFilter;
		refs.motionBlurFilterRef.current = motionBlurFilter;

		layoutVideoContent();
		video.pause();

		const { handlePlay, handlePause, handleSeeked, handleSeeking } = createVideoEventHandlers({
			video,
			isSeekingRef: refs.isSeekingRef,
			isPlayingRef: refs.isPlayingRef,
			allowPlaybackRef: refs.allowPlaybackRef,
			currentTimeRef: refs.currentTimeRef,
			timeUpdateAnimationRef: refs.timeUpdateAnimationRef,
			onPlayStateChange,
			onTimeUpdate,
			trimRegionsRef: refs.trimRegionsRef,
			speedRegionsRef: refs.speedRegionsRef,
		});

		video.addEventListener("play", handlePlay);
		video.addEventListener("pause", handlePause);
		video.addEventListener("ended", handlePause);
		video.addEventListener("seeked", handleSeeked);
		video.addEventListener("seeking", handleSeeking);

		return () => {
			video.removeEventListener("play", handlePlay);
			video.removeEventListener("pause", handlePause);
			video.removeEventListener("ended", handlePause);
			video.removeEventListener("seeked", handleSeeked);
			video.removeEventListener("seeking", handleSeeking);

			if (refs.timeUpdateAnimationRef.current) {
				cancelAnimationFrame(refs.timeUpdateAnimationRef.current);
			}

			videoContainer.mask = null;
			if (videoSprite) {
				videoContainer.removeChild(videoSprite);
				videoSprite.destroy();
			}
			if (maskGraphics) {
				videoContainer.removeChild(maskGraphics);
				maskGraphics.destroy();
			}
			refs.maskGraphicsRef.current = null;
			if (refs.blurFilterRef.current) {
				videoContainer.filters = [];
				refs.blurFilterRef.current.destroy();
				refs.blurFilterRef.current = null;
			}
			if (refs.motionBlurFilterRef.current) {
				refs.motionBlurFilterRef.current.destroy();
				refs.motionBlurFilterRef.current = null;
			}
			videoTexture.destroy(false);
			refs.videoSpriteRef.current = null;
			updateOverlayForRegion();
		};
	}, [layoutVideoContent, onPlayStateChange, onTimeUpdate, pixiReady, refs, updateOverlayForRegion, videoReady]);
}