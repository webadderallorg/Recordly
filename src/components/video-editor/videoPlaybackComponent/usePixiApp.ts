import { useEffect } from "react";
import { Application, Container } from "pixi.js";
import { DEFAULT_CURSOR_CONFIG, PixiCursorOverlay, preloadCursorAssets } from "../videoPlayback/cursorRenderer";
import type { VideoPlaybackRuntimeRefs } from "./shared";

interface UsePixiAppParams {
	refs: VideoPlaybackRuntimeRefs;
	onError: (error: string) => void;
	setPixiReady: (ready: boolean) => void;
}

export function usePixiApp({ refs, onError, setPixiReady }: UsePixiAppParams) {
	useEffect(() => {
		const container = refs.containerRef.current;
		if (!container) return;

		let mounted = true;
		let app: Application | null = null;

		(async () => {
			let cursorOverlayEnabled = true;
			try {
				await preloadCursorAssets();
			} catch (error) {
				cursorOverlayEnabled = false;
				console.warn("Native cursor assets are unavailable in preview; continuing without cursor overlay.", error);
			}

			app = new Application();
			await app.init({
				width: container.clientWidth,
				height: container.clientHeight,
				backgroundAlpha: 0,
				antialias: true,
				failIfMajorPerformanceCaveat: false,
				resolution: window.devicePixelRatio || 1,
				autoDensity: true,
				preference: "webgl",
			});

			app.ticker.maxFPS = 60;

			if (!mounted) {
				app.destroy(true, { children: true, texture: false, textureSource: false });
				return;
			}

			refs.appRef.current = app;
			container.appendChild(app.canvas);

			const cameraContainer = new Container();
			refs.cameraContainerRef.current = cameraContainer;
			app.stage.addChild(cameraContainer);

			const videoContainer = new Container();
			refs.videoContainerRef.current = videoContainer;
			cameraContainer.addChild(videoContainer);

			const frameContainer = new Container();
			refs.frameContainerRef.current = frameContainer;
			cameraContainer.addChild(frameContainer);

			const cursorContainer = new Container();
			refs.cursorContainerRef.current = cursorContainer;
			cameraContainer.addChild(cursorContainer);

			if (cursorOverlayEnabled) {
				const cursorOverlay = new PixiCursorOverlay({
					dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * refs.cursorSizeRef.current,
					style: refs.cursorStyleRef.current,
					smoothingFactor: refs.cursorSmoothingRef.current,
					motionBlur: refs.cursorMotionBlurRef.current,
					clickBounce: refs.cursorClickBounceRef.current,
					clickBounceDuration: refs.cursorClickBounceDurationRef.current,
					sway: refs.cursorSwayRef.current,
				});
				refs.cursorOverlayRef.current = cursorOverlay;
				cursorContainer.addChild(cursorOverlay.container);
			} else {
				refs.cursorOverlayRef.current = null;
			}

			setPixiReady(true);
		})().catch((error) => {
			console.error("Failed to initialize preview renderer:", error);
			onError(error instanceof Error ? error.message : "Failed to initialize preview renderer");
		});

		return () => {
			mounted = false;
			setPixiReady(false);
			if (refs.cursorOverlayRef.current) {
				refs.cursorOverlayRef.current.destroy();
				refs.cursorOverlayRef.current = null;
			}
			if (app && app.renderer) {
				app.destroy(true, { children: true, texture: false, textureSource: false });
			}
			refs.appRef.current = null;
			refs.cameraContainerRef.current = null;
			refs.videoContainerRef.current = null;
			refs.frameContainerRef.current = null;
			refs.frameSpriteRef.current = null;
			refs.cursorContainerRef.current = null;
			refs.videoSpriteRef.current = null;
		};
	}, [onError, refs, setPixiReady]);
}