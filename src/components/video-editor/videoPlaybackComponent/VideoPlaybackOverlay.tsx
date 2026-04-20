import { formatAspectRatioForCSS, type AspectRatio } from "@/utils/aspectRatioUtils";
import { AnnotationOverlay } from "../AnnotationOverlay";
import {
	CAPTION_FONT_WEIGHT,
	CAPTION_LINE_HEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionWordVisualState,
} from "../captionStyle";
import { getDefaultCaptionFontFamily, type AnnotationRegion, type AutoCaptionSettings } from "../types";
import type { buildActiveCaptionLayout } from "../captionLayout";

interface VideoPlaybackOverlayProps {
	aspectRatio: AspectRatio;
	nativeAspectRatio: number;
	resolvedWallpaper: string | null;
	resolvedWallpaperKind: "image" | "video" | "style";
	backgroundBlur: number;
	showShadow?: boolean;
	shadowIntensity: number;
	pixiReady: boolean;
	videoReady: boolean;
	videoPath: string;
	onDurationChange: (duration: number) => void;
	onError: (error: string) => void;
	handleLoadedMetadata: (event: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
	containerRef: React.MutableRefObject<HTMLDivElement | null>;
	cursorEffectsCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
	overlayRef: React.MutableRefObject<HTMLDivElement | null>;
	focusIndicatorRef: React.MutableRefObject<HTMLDivElement | null>;
	webcamVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	webcamBubbleRef: React.MutableRefObject<HTMLDivElement | null>;
	webcamBubbleInnerRef: React.MutableRefObject<HTMLDivElement | null>;
	bgVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	captionBoxRef: React.MutableRefObject<HTMLDivElement | null>;
	handleOverlayPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
	handleOverlayPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
	handleOverlayPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
	handleOverlayPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => void;
	webcam?: {
		enabled?: boolean;
		mirror?: boolean;
	};
	webcamVideoPath?: string | null;
	autoCaptionSettings?: AutoCaptionSettings;
	activeCaptionLayout: ReturnType<typeof buildActiveCaptionLayout> | null;
	annotationRegions: AnnotationRegion[];
	selectedAnnotationId?: string | null;
	currentTime: number;
	onSelectAnnotation?: (id: string | null) => void;
	onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
	videoRef: React.MutableRefObject<HTMLVideoElement | null>;
}

export function VideoPlaybackOverlay({
	aspectRatio,
	nativeAspectRatio,
	resolvedWallpaper,
	resolvedWallpaperKind,
	backgroundBlur,
	showShadow,
	shadowIntensity,
	pixiReady,
	videoReady,
	videoPath,
	onDurationChange,
	onError,
	handleLoadedMetadata,
	containerRef,
	cursorEffectsCanvasRef,
	overlayRef,
	focusIndicatorRef,
	webcamVideoRef,
	webcamBubbleRef,
	webcamBubbleInnerRef,
	bgVideoRef,
	captionBoxRef,
	handleOverlayPointerDown,
	handleOverlayPointerMove,
	handleOverlayPointerUp,
	handleOverlayPointerLeave,
	webcam,
	webcamVideoPath,
	autoCaptionSettings,
	activeCaptionLayout,
	annotationRegions,
	selectedAnnotationId,
	currentTime,
	onSelectAnnotation,
	onAnnotationPositionChange,
	onAnnotationSizeChange,
	videoRef,
}: VideoPlaybackOverlayProps) {
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
	const overlayWidth = overlayRef.current?.clientWidth || 960;
	const captionFontSize = autoCaptionSettings
		? getCaptionScaledFontSize(autoCaptionSettings.fontSize, overlayWidth, autoCaptionSettings.maxWidth)
		: 0;
	const captionPadding = getCaptionPadding(captionFontSize);

	return (
		<div className="relative overflow-hidden rounded-sm" style={{ width: "100%", aspectRatio: formatAspectRatioForCSS(aspectRatio, nativeAspectRatio) }}>
			{resolvedWallpaperKind === "video" && resolvedWallpaper ? (
				<video
					key={resolvedWallpaper}
					ref={bgVideoRef}
					className="absolute inset-0 h-full w-full object-cover"
					src={resolvedWallpaper}
					muted
					loop
					playsInline
					style={{ filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : "none" }}
				/>
			) : (
				<div className="absolute inset-0 bg-cover bg-center" style={{ ...backgroundStyle, filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : "none" }} />
			)}
			<div
				ref={containerRef}
				className="absolute inset-0"
				style={{
					filter:
						showShadow && shadowIntensity > 0
							? `drop-shadow(0 ${shadowIntensity * 12}px ${shadowIntensity * 48}px rgba(0,0,0,${shadowIntensity * 0.7})) drop-shadow(0 ${shadowIntensity * 4}px ${shadowIntensity * 16}px rgba(0,0,0,${shadowIntensity * 0.5})) drop-shadow(0 ${shadowIntensity * 2}px ${shadowIntensity * 8}px rgba(0,0,0,${shadowIntensity * 0.3}))`
							: "none",
				}}
			/>
			<canvas ref={cursorEffectsCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ zIndex: 1 }} />
			{pixiReady && videoReady ? (
				<div
					ref={overlayRef}
					className="absolute inset-0 select-none"
					style={{ pointerEvents: "none" }}
					onPointerDown={handleOverlayPointerDown}
					onPointerMove={handleOverlayPointerMove}
					onPointerUp={handleOverlayPointerUp}
					onPointerLeave={handleOverlayPointerLeave}
				>
					<div ref={focusIndicatorRef} className="absolute rounded-md border border-[#2563EB]/80 bg-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.35)]" style={{ display: "none", pointerEvents: "none" }} />
					{webcam && webcamVideoPath ? (
						<div ref={webcamBubbleRef} className="absolute" style={{ display: webcam.enabled ? "block" : "none", pointerEvents: "none" }}>
							<div ref={webcamBubbleInnerRef} className="h-full w-full overflow-hidden bg-black/80">
								<video
									ref={webcamVideoRef}
									src={webcamVideoPath}
									className="h-full w-full object-cover"
									muted
									playsInline
									preload="auto"
									style={{ transform: webcam.mirror ? "scaleX(-1)" : undefined }}
								/>
							</div>
						</div>
					) : null}
					{activeCaptionLayout && autoCaptionSettings ? (
						<div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ bottom: `${autoCaptionSettings.bottomOffset}%` }}>
							<div
								style={{
									maxWidth: `${autoCaptionSettings.maxWidth}%`,
									opacity: activeCaptionLayout.opacity,
									transform: `translateY(${activeCaptionLayout.translateY}px) scale(${activeCaptionLayout.scale})`,
									transformOrigin: "center bottom",
									filter: "drop-shadow(0 12px 30px rgba(0, 0, 0, 0.28))",
								}}
							>
								<div
									ref={captionBoxRef}
									style={{
										backgroundColor: `rgba(0, 0, 0, ${autoCaptionSettings.backgroundOpacity})`,
										fontFamily: getDefaultCaptionFontFamily(),
										fontSize: `${captionFontSize}px`,
										lineHeight: CAPTION_LINE_HEIGHT,
										textAlign: "center",
										fontWeight: CAPTION_FONT_WEIGHT,
										padding: `${captionPadding.y}px ${captionPadding.x}px`,
										borderRadius: `${getCaptionScaledRadius(autoCaptionSettings.boxRadius, captionFontSize)}px`,
										boxSizing: "border-box",
									}}
								>
									{activeCaptionLayout.visibleLines.map((line) => (
										<div key={`${activeCaptionLayout.blockKey}-${line.startWordIndex}`} style={{ display: "flex", justifyContent: "center", flexWrap: "nowrap", whiteSpace: "nowrap" }}>
											{line.words.map((word) => {
												const visualState = getCaptionWordVisualState(activeCaptionLayout.hasWordTimings, word.state);
												return (
													<span
														key={`${activeCaptionLayout.blockKey}-${word.index}`}
														style={{
															display: "inline-block",
															whiteSpace: "pre",
															color: visualState.isInactive ? autoCaptionSettings.inactiveTextColor : autoCaptionSettings.textColor,
															opacity: visualState.opacity,
														}}
													>
														{`${word.leadingSpace ? " " : ""}${word.text}`}
													</span>
												);
											})}
										</div>
									))}
								</div>
							</div>
						</div>
					) : null}
					{(() => {
						const filtered = annotationRegions.filter((annotation) => {
							if (typeof annotation.startMs !== "number" || typeof annotation.endMs !== "number") return false;
							if (annotation.id === selectedAnnotationId) return true;
							const timeMs = Math.round(currentTime * 1000);
							return timeMs >= annotation.startMs && timeMs <= annotation.endMs;
						});

						const sorted = [...filtered].sort((left, right) => left.zIndex - right.zIndex);

						const handleAnnotationClick = (clickedId: string) => {
							if (!onSelectAnnotation) return;
							if (clickedId === selectedAnnotationId && sorted.length > 1) {
								const currentIndex = sorted.findIndex((annotation) => annotation.id === clickedId);
								const nextIndex = (currentIndex + 1) % sorted.length;
								onSelectAnnotation(sorted[nextIndex].id);
							} else {
								onSelectAnnotation(clickedId);
							}
						};

						return sorted.map((annotation) => (
							<AnnotationOverlay
								key={annotation.id}
								annotation={annotation}
								isSelected={annotation.id === selectedAnnotationId}
								containerWidth={overlayRef.current?.clientWidth || 800}
								containerHeight={overlayRef.current?.clientHeight || 600}
								onPositionChange={(id, position) => onAnnotationPositionChange?.(id, position)}
								onSizeChange={(id, size) => onAnnotationSizeChange?.(id, size)}
								onClick={handleAnnotationClick}
								zIndex={annotation.zIndex}
								isSelectedBoost={annotation.id === selectedAnnotationId}
							/>
						));
					})()}
				</div>
			) : null}
			<video
				ref={videoRef}
				src={videoPath}
				className="hidden"
				preload="metadata"
				playsInline
				onLoadedMetadata={handleLoadedMetadata}
				onDurationChange={(event) => onDurationChange(event.currentTarget.duration)}
				onError={(event) => {
					const mediaError = event.currentTarget.error;
					const code = mediaError?.code;
					const message = mediaError?.message;
					const detail =
						code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
							? "format not supported"
							: code === MediaError.MEDIA_ERR_NETWORK
								? "network error"
								: code === MediaError.MEDIA_ERR_DECODE
									? "decode error"
									: message || `code ${code ?? "unknown"}`;
					console.error("[VideoPlayback] Video load error:", detail, "src:", videoPath);
					onError(`Failed to load video (${detail})`);
				}}
			/>
		</div>
	);
}