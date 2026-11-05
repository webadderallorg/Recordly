import { Application, Container } from "pixi.js";
import { useEffect } from "react";
import { createVideoBlurFilters } from "@/lib/exporter/videoBlurFilters";
import { destroyPixiApplication } from "@/lib/pixiApplicationLifecycle";
import { DEFAULT_CURSOR_CONFIG, PixiCursorOverlay, preloadCursorAssets } from "./cursorRenderer";
import { initializePixiRenderer, toRendererErrorMessage } from "./initializePreviewRenderer";
import type { PlaybackProps } from "./playbackProps";
import type { usePlaybackLayout } from "./usePlaybackLayout";
import type { usePlaybackState } from "./usePlaybackState";
export type usePlaybackRendererInput = Pick<
	ReturnType<typeof usePlaybackState> & ReturnType<typeof usePlaybackLayout> & PlaybackProps,
	| "containerRef"
	| "appRef"
	| "cameraContainerRef"
	| "videoEffectsContainerRef"
	| "zoomBlurFilterRef"
	| "motionBlurFilterRef"
	| "syncPreviewMotionBlurQuality"
	| "videoContainerRef"
	| "cursorContainerRef"
	| "cursorSizeRef"
	| "cursorStyleRef"
	| "cursorSmoothingRef"
	| "cursorSpringStiffnessMultiplierRef"
	| "cursorSpringDampingMultiplierRef"
	| "cursorSpringMassMultiplierRef"
	| "cursorMotionBlurRef"
	| "cursorClickEffectRef"
	| "cursorClickEffectColorRef"
	| "cursorClickEffectScaleRef"
	| "cursorClickEffectOpacityRef"
	| "cursorClickEffectDurationMsRef"
	| "cursorClickBounceRef"
	| "cursorClickBounceDurationRef"
	| "cursorSwayRef"
	| "cursorOverlayRef"
	| "setPixiReady"
	| "onError"
	| "videoSpriteRef"
>;
export function usePlaybackRenderer(input: usePlaybackRendererInput) {
	const {
		containerRef,
		appRef,
		cameraContainerRef,
		videoEffectsContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		syncPreviewMotionBlurQuality,
		videoContainerRef,
		cursorContainerRef,
		cursorSizeRef,
		cursorStyleRef,
		cursorSmoothingRef,
		cursorSpringStiffnessMultiplierRef,
		cursorSpringDampingMultiplierRef,
		cursorSpringMassMultiplierRef,
		cursorMotionBlurRef,
		cursorClickEffectRef,
		cursorClickEffectColorRef,
		cursorClickEffectScaleRef,
		cursorClickEffectOpacityRef,
		cursorClickEffectDurationMsRef,
		cursorClickBounceRef,
		cursorClickBounceDurationRef,
		cursorSwayRef,
		cursorOverlayRef,
		setPixiReady,
		onError,
		videoSpriteRef,
	} = input;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let mounted = true;
		let app: Application | null = null;

		(async () => {
			let cursorOverlayEnabled = true;
			try {
				await preloadCursorAssets();
			} catch (error) {
				cursorOverlayEnabled = false;
				console.warn(
					"Native cursor assets are unavailable in preview; continuing without cursor overlay.",
					error,
				);
			}

			app = await initializePixiRenderer(container);

			app.ticker.maxFPS = 60;

			if (!mounted) {
				destroyPixiApplication(app, "unmounted preview renderer");
				return;
			}

			appRef.current = app;
			container.appendChild(app.canvas);

			// Camera container - this will be scaled/positioned for zoom
			const cameraContainer = new Container();
			cameraContainerRef.current = cameraContainer;
			app.stage.addChild(cameraContainer);

			// Match the export scene graph so zoom motion blur is applied to the
			// same layer in preview and export.
			const videoEffectsContainer = new Container();
			videoEffectsContainerRef.current = videoEffectsContainer;
			const blurFilters = createVideoBlurFilters();
			zoomBlurFilterRef.current = blurFilters.zoom;
			motionBlurFilterRef.current = blurFilters.motion;
			videoEffectsContainer.filters = [
				motionBlurFilterRef.current,
				zoomBlurFilterRef.current,
			];
			cameraContainer.addChild(videoEffectsContainer);
			syncPreviewMotionBlurQuality();

			// Video container - holds the masked video sprite
			const videoContainer = new Container();
			videoContainerRef.current = videoContainer;
			videoEffectsContainer.addChild(videoContainer);

			const cursorContainer = new Container();
			cursorContainerRef.current = cursorContainer;
			cameraContainer.addChild(cursorContainer);

			// Cursor overlay - rendered above the masked video so it can sit in front
			// of the content without getting clipped.
			if (cursorOverlayEnabled) {
				const cursorOverlay = new PixiCursorOverlay({
					dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * cursorSizeRef.current,
					minViewportScale: 0,
					style: cursorStyleRef.current,
					smoothingFactor: cursorSmoothingRef.current,
					springTuning: {
						stiffnessMultiplier: cursorSpringStiffnessMultiplierRef.current,
						dampingMultiplier: cursorSpringDampingMultiplierRef.current,
						massMultiplier: cursorSpringMassMultiplierRef.current,
					},
					motionBlur: cursorMotionBlurRef.current,
					clickEffect: cursorClickEffectRef.current,
					clickEffectColor: cursorClickEffectColorRef.current,
					clickEffectScale: cursorClickEffectScaleRef.current,
					clickEffectOpacity: cursorClickEffectOpacityRef.current,
					clickEffectDurationMs: cursorClickEffectDurationMsRef.current,
					clickBounce: cursorClickBounceRef.current,
					clickBounceDuration: cursorClickBounceDurationRef.current,
					sway: cursorSwayRef.current,
				});
				cursorOverlayRef.current = cursorOverlay;
				cursorOverlay.setFilterResolution(
					app.renderer.resolution || window.devicePixelRatio || 1,
				);
				cursorContainer.addChild(cursorOverlay.container);
			} else {
				cursorOverlayRef.current = null;
			}

			setPixiReady(true);
		})().catch((error) => {
			if (!mounted) return;
			console.error("Failed to initialize preview renderer:", error);
			onError(toRendererErrorMessage(error));
		});

		return () => {
			mounted = false;
			setPixiReady(false);
			if (cursorOverlayRef.current) {
				cursorOverlayRef.current.destroy();
				cursorOverlayRef.current = null;
			}
			if (videoEffectsContainerRef.current) {
				videoEffectsContainerRef.current.filters = null;
			}
			zoomBlurFilterRef.current?.destroy();
			motionBlurFilterRef.current?.destroy();
			zoomBlurFilterRef.current = null;
			motionBlurFilterRef.current = null;
			destroyPixiApplication(app, "preview renderer");
			appRef.current = null;
			cameraContainerRef.current = null;
			videoEffectsContainerRef.current = null;
			videoContainerRef.current = null;
			cursorContainerRef.current = null;
			videoSpriteRef.current = null;
		};
	}, [
		onError,
		syncPreviewMotionBlurQuality,
		containerRef,
		appRef,
		cameraContainerRef,
		videoEffectsContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		videoContainerRef,
		cursorContainerRef,
		cursorSizeRef,
		cursorStyleRef,
		cursorSmoothingRef,
		cursorSpringStiffnessMultiplierRef,
		cursorSpringDampingMultiplierRef,
		cursorSpringMassMultiplierRef,
		cursorMotionBlurRef,
		cursorClickEffectRef,
		cursorClickEffectColorRef,
		cursorClickEffectScaleRef,
		cursorClickEffectOpacityRef,
		cursorClickEffectDurationMsRef,
		cursorClickBounceRef,
		cursorClickBounceDurationRef,
		cursorSwayRef,
		cursorOverlayRef,
		setPixiReady,
		videoSpriteRef,
	]);
	return {};
}
