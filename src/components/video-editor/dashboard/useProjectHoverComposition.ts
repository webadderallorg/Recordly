import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectPreviewData } from "@/types/projectPreview";
import type { AnnotationRegion, WebcamOverlaySettings } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { preloadProjectHoverFonts } from "./projectHoverFonts";
import { createHoverCompositionGate } from "./projectHoverReadiness";

/** Keep every layer below one visibility gate until the same, complete scene is drawn. */
export function useProjectHoverComposition({
	data,
	playback,
	host,
	rendererReady,
	metadataReady,
	telemetryReady,
	annotationImages,
	annotations,
	aspectRatio,
	webcam,
	timelineTime,
	onFailure,
}: {
	data: ProjectPreviewData;
	playback: RefObject<VideoPlaybackRef | null>;
	host: RefObject<HTMLDivElement | null>;
	rendererReady: boolean;
	metadataReady: boolean;
	telemetryReady: boolean;
	annotationImages: readonly string[];
	annotations: readonly AnnotationRegion[];
	aspectRatio: number;
	webcam: WebcamOverlaySettings;
	timelineTime: RefObject<number>;
	onFailure: () => void;
}) {
	const [visible, setVisible] = useState(false);
	const refreshRef = useRef<(() => void) | null>(null);
	const committed = useRef({ metadataReady: false, telemetryReady: false, aspectRatio, webcam });
	// Child playback effects update their input refs before this parent effect runs.
	useEffect(() => {
		committed.current = { metadataReady, telemetryReady, aspectRatio, webcam };
		refreshRef.current?.();
	}, [metadataReady, telemetryReady, aspectRatio, webcam]);

	useLayoutEffect(() => {
		const element = host.current;
		if (!element) return;
		element.style.opacity = "0";
		element.style.visibility = "hidden";
		setVisible(false);
		if (!rendererReady) return;
		const app = playback.current?.app;
		if (!app) return;
		let active = true;
		const images = new Map<string, { ready: boolean; image: HTMLImageElement }>();
		const videos = new Map<HTMLVideoElement, () => void>();
		let decodedBackground: { video: HTMLVideoElement; source: string } | null = null;
		let refresh: () => void = () => undefined;
		let annotationFontsReady = false;
		const fail = () => {
			if (active) onFailure();
		};
		const expectedSource = new URL(data.videoUrl, location.href).href;
		const imageReady = (source: string) => {
			const existing = images.get(source);
			if (existing) return existing.ready;
			const image = new Image();
			const resource = { ready: false, image };
			images.set(source, resource);
			image.onerror = fail;
			image.onload = () => {
				void image
					.decode()
					.then(() => {
						if (!active) return;
						resource.ready = true;
						refresh();
					})
					.catch(fail);
			};
			image.src = source;
			return false;
		};
		const mediaReady = (video: HTMLVideoElement | null) =>
			Boolean(
				video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0,
			);
		const read = () => {
			const annotationImagesReady =
				annotationImages.map(imageReady).every(Boolean) &&
				Array.from(
					element.querySelectorAll<HTMLImageElement>("[data-annotation-id] img"),
				).every((image) => image.complete && image.naturalWidth > 0);
			const player = playback.current;
			const frame = player?.composedFrame;
			const video = player?.video ?? null;
			const container = player?.containerRef.current;
			const width = container?.clientWidth ?? 0;
			const height = container?.clientHeight ?? 0;
			const background = element.querySelector<HTMLElement>("[data-preview-background]");
			const kind = background?.dataset.backgroundKind;
			const backgroundSource = background?.dataset.backgroundSource ?? "";
			const backgroundVideo = kind === "video" ? (background as HTMLVideoElement) : null;
			if (backgroundVideo && mediaReady(backgroundVideo) && !backgroundVideo.seeking) {
				decodedBackground = { video: backgroundVideo, source: backgroundVideo.currentSrc };
			} else if (
				!backgroundVideo ||
				backgroundVideo.readyState === 0 ||
				backgroundVideo.error ||
				decodedBackground?.video !== backgroundVideo ||
				decodedBackground?.source !== backgroundVideo.currentSrc
			) {
				decodedBackground = null;
			}
			const camera = element.querySelector<HTMLElement>("[data-webcam-overlay]");
			const cameraVideo = camera?.querySelector("video") ?? null;
			const cameraRequired =
				committed.current.webcam.enabled &&
				Boolean(committed.current.webcam.sourcePath || data.webcamUrl);
			const cameraReady =
				!cameraRequired ||
				(Boolean(data.webcamUrl) &&
					camera?.dataset.webcamReady === "true" &&
					mediaReady(cameraVideo));
			const geometryReady =
				width > 0 &&
				height > 0 &&
				Math.abs(width / height - committed.current.aspectRatio) < 0.02;
			const frameMatches = Boolean(
				frame &&
					geometryReady &&
					frame.source === expectedSource &&
					Math.abs(frame.width - width) <= 1 &&
					Math.abs(frame.height - height) <= 1 &&
					Math.abs(app.screen.width - width) <= 1 &&
					Math.abs(app.screen.height - height) <= 1 &&
					player?.videoSprite?.visible,
			);
			// A same-source wallpaper seek keeps its last decoded image, like the main video.
			// It must still settle before the very first complete composition is revealed.
			const backgroundReady =
				kind === "style" ||
				(kind === "image" && Boolean(backgroundSource) && imageReady(backgroundSource)) ||
				(kind === "video" &&
					(mediaReady(backgroundVideo) ||
						(frameMatches &&
							Boolean(decodedBackground) &&
							Boolean(backgroundVideo?.seeking))));
			const retainedMain = frameMatches && Boolean(video?.seeking);
			const retainedCamera =
				frameMatches &&
				camera?.dataset.webcamReady === "true" &&
				Boolean(cameraVideo?.seeking);
			return {
				prerequisitesReady:
					committed.current.metadataReady &&
					committed.current.telemetryReady &&
					annotationImagesReady &&
					annotationFontsReady &&
					(mediaReady(video) || retainedMain) &&
					backgroundReady &&
					(cameraReady || retainedCamera) &&
					element.querySelector('[data-preview-captions-ready="true"]') !== null,
				canRetain: frameMatches,
				frameValid:
					frameMatches &&
					!video?.seeking &&
					!backgroundVideo?.seeking &&
					(!cameraRequired || !cameraVideo?.seeking),
				key: `${expectedSource}:${width}x${height}:${committed.current.aspectRatio}:${kind}:${backgroundSource}:${data.webcamUrl}`,
				revision: frame?.revision ?? 0,
			};
		};
		const gate = createHoverCompositionGate({
			read,
			requestComposition: () => playback.current?.seekTimeline(timelineTime.current),
			onVisibilityChange(next) {
				if (!active) return;
				// Hide synchronously before the browser can paint a resized/invalid scene.
				element.style.opacity = next ? "1" : "0";
				element.style.visibility = next ? "visible" : "hidden";
				element.dataset.previewReady = String(next);
				setVisible(next);
			},
		});
		const listenToMedia = () => {
			const required = new Set<HTMLVideoElement>();
			if (playback.current?.video) required.add(playback.current.video);
			const background = element.querySelector<HTMLVideoElement>(
				"video[data-preview-background]",
			);
			if (background) required.add(background);
			if (committed.current.webcam.enabled) {
				const camera = element.querySelector<HTMLVideoElement>(
					"[data-webcam-overlay] video",
				);
				if (camera) required.add(camera);
			}
			for (const [video, dispose] of videos)
				if (!required.has(video)) {
					dispose();
					videos.delete(video);
				}
			for (const video of required) {
				if (videos.has(video)) continue;
				const events = ["loadedmetadata", "loadeddata", "canplay", "seeked", "emptied"];
				for (const event of events) video.addEventListener(event, refresh);
				video.addEventListener("error", fail);
				videos.set(video, () => {
					for (const event of events) video.removeEventListener(event, refresh);
					video.removeEventListener("error", fail);
				});
			}
		};
		refresh = () => {
			if (!active) return;
			listenToMedia();
			gate.refresh();
		};
		refreshRef.current = refresh;
		const runner = app.renderer.runners.postrender;
		const listener = { postrender: gate.postrender };
		runner.add(listener);
		const resize = new ResizeObserver(refresh);
		resize.observe(element);
		if (playback.current?.containerRef.current)
			resize.observe(playback.current.containerRef.current);
		const changes = new MutationObserver(refresh);
		changes.observe(element, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				"data-background-kind",
				"data-background-source",
				"data-webcam-ready",
				"data-preview-captions-ready",
			],
		});
		const imageError = (event: Event) => {
			if (event.target instanceof HTMLImageElement) fail();
		};
		element.addEventListener("load", refresh, true);
		element.addEventListener("error", imageError, true);
		// Caption readiness is reported by this preview. Global font events also
		// include unrelated UI and must not hide or seek an established composition.
		void preloadProjectHoverFonts(annotations, document.fonts)
			.then(() => {
				if (!active) return;
				annotationFontsReady = true;
				refresh();
			})
			.catch(fail);
		refresh();
		return () => {
			active = false;
			element.style.opacity = "0";
			element.style.visibility = "hidden";
			refreshRef.current = null;
			gate.dispose();
			if (runner.name !== null) runner.remove(listener);
			resize.disconnect();
			changes.disconnect();
			for (const dispose of videos.values()) dispose();
			for (const resource of images.values()) {
				resource.image.onload = null;
				resource.image.onerror = null;
			}
			element.removeEventListener("load", refresh, true);
			element.removeEventListener("error", imageError, true);
		};
	}, [
		rendererReady,
		data,
		playback,
		host,
		timelineTime,
		onFailure,
		annotationImages,
		annotations,
	]);
	return visible;
}
