import type React from "react";
import { useEffect, useState } from "react";
import {
	getAssetPath,
	getRenderableAssetUrl,
	getRenderableVideoUrl,
	isAbsoluteLocalAssetPath,
} from "@/lib/assetPath";
import { clampMediaTimeToDuration } from "@/lib/mediaTiming";
import {
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { getCaptionFontFamily } from "../captionFonts";
import type { PlaybackProps } from "./playbackProps";
import { getEffectiveNativeAspectRatio } from "./playbackTypes";
import { getSceneEffectMetrics } from "./sceneEffects";
import type { usePlaybackState } from "./usePlaybackState";
export type usePlaybackWallpaperInput = Pick<
	PlaybackProps & ReturnType<typeof usePlaybackState>,
	| "onDurationChange"
	| "currentTime"
	| "currentTimeRef"
	| "wallpaper"
	| "previewViewportWidth"
	| "backgroundBlur"
	| "showShadow"
	| "shadowIntensity"
	| "autoCaptionSettings"
	| "lockedVideoDimensionsRef"
	| "cropRegion"
	| "videoRef"
>;
export function usePlaybackWallpaper(input: usePlaybackWallpaperInput) {
	const {
		onDurationChange,
		currentTime,
		currentTimeRef,
		wallpaper,
		previewViewportWidth,
		backgroundBlur,
		showShadow,
		shadowIntensity,
		autoCaptionSettings,
		lockedVideoDimensionsRef,
		cropRegion,
		videoRef,
	} = input;

	const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
		const video = e.currentTarget;
		onDurationChange(video.duration);

		const targetTime = clampMediaTimeToDuration(
			currentTime,
			Number.isFinite(video.duration) ? video.duration : null,
		);
		if (Math.abs(video.currentTime - targetTime) > 1e-8) video.currentTime = targetTime;
		video.pause();
		currentTimeRef.current = targetTime * 1000;
	};

	const [resolvedWallpaper, setResolvedWallpaper] = useState<string | null>(null);

	const [resolvedWallpaperKind, setResolvedWallpaperKind] = useState<"image" | "video" | "style">(
		"image",
	);

	useEffect(() => {
		let mounted = true;
		const revokeResolvedWallpaper = () => undefined;
		(async () => {
			try {
				if (!wallpaper) {
					const def = await getAssetPath(DEFAULT_WALLPAPER_RELATIVE_PATH);
					if (mounted) {
						setResolvedWallpaper(def);
						setResolvedWallpaperKind("image");
					}
					return;
				}

				if (
					wallpaper.startsWith("#") ||
					wallpaper.startsWith("linear-gradient") ||
					wallpaper.startsWith("radial-gradient")
				) {
					if (mounted) {
						setResolvedWallpaper(wallpaper);
						setResolvedWallpaperKind("style");
					}
					return;
				}

				if (isVideoWallpaperSource(wallpaper)) {
					const videoSrc = await getRenderableVideoUrl(wallpaper);
					if (mounted) {
						setResolvedWallpaper(videoSrc);
						setResolvedWallpaperKind("video");
					}
					return;
				}

				// If it's a data URL (custom uploaded image), use as-is
				if (wallpaper.startsWith("data:")) {
					if (mounted) {
						setResolvedWallpaper(wallpaper);
						setResolvedWallpaperKind("image");
					}
					return;
				}

				if (
					wallpaper.startsWith("http") ||
					wallpaper.startsWith("file://") ||
					isAbsoluteLocalAssetPath(wallpaper)
				) {
					const renderable = await getRenderableAssetUrl(wallpaper);
					if (mounted) {
						setResolvedWallpaper(renderable);
						setResolvedWallpaperKind("image");
					}
					return;
				}
				const p = await getRenderableAssetUrl(
					await getAssetPath(wallpaper.replace(/^\//, "")),
				);
				if (mounted) {
					setResolvedWallpaper(p);
					setResolvedWallpaperKind("image");
				}
			} catch (_err) {
				if (mounted) {
					setResolvedWallpaper(wallpaper || DEFAULT_WALLPAPER_PATH);
					setResolvedWallpaperKind(
						isVideoWallpaperSource(wallpaper || "") ? "video" : "image",
					);
				}
			}
		})();
		return () => {
			mounted = false;
			revokeResolvedWallpaper();
		};
	}, [wallpaper]);

	const isImageUrl =
		resolvedWallpaperKind === "image" &&
		Boolean(
			resolvedWallpaper &&
				(resolvedWallpaper.startsWith("file://") ||
					resolvedWallpaper.startsWith("http") ||
					resolvedWallpaper.startsWith("/") ||
					resolvedWallpaper.startsWith("data:")),
		);

	const backgroundStyle = isImageUrl
		? { backgroundImage: `url(${resolvedWallpaper || ""})` }
		: resolvedWallpaperKind === "video"
			? {}
			: { background: resolvedWallpaper || "" };

	const sceneEffects = getSceneEffectMetrics({
		viewportWidth: previewViewportWidth,
		backgroundBlur,
		shadowIntensity: showShadow ? shadowIntensity : 0,
	});

	const captionFontFamily = getCaptionFontFamily(autoCaptionSettings);

	// Overscan blurred wallpaper layers so the browser never samples transparent
	// pixels beyond the preview bounds, which otherwise looks like a vignette.
	const backgroundBlurOverscan = sceneEffects.backgroundOverscanPx;

	const nativeAspectRatio = (() => {
		const locked = lockedVideoDimensionsRef.current;
		if (locked) {
			return getEffectiveNativeAspectRatio(locked, cropRegion);
		}
		const video = videoRef.current;
		if (video && video.videoHeight > 0 && video.videoWidth > 0) {
			return getEffectiveNativeAspectRatio(
				{
					width: video.videoWidth,
					height: video.videoHeight,
				},
				cropRegion,
			);
		}
		return 16 / 9;
	})();
	return {
		handleLoadedMetadata,
		resolvedWallpaper,
		setResolvedWallpaper,
		resolvedWallpaperKind,
		setResolvedWallpaperKind,
		isImageUrl,
		backgroundStyle,
		sceneEffects,
		captionFontFamily,
		backgroundBlurOverscan,
		nativeAspectRatio,
	};
}
