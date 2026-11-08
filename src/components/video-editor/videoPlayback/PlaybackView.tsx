import { formatAspectRatioForCSS } from "@/utils/aspectRatioUtils";
import { GLASS_RIM_COLOR } from "../glassRim";
import { PlaybackAnnotations } from "./PlaybackAnnotations";
import { PlaybackCaptions } from "./PlaybackCaptions";
import type { PlaybackProps } from "./playbackProps";
import type { usePlaybackCaptions } from "./usePlaybackCaptions";
import type { usePlaybackControls } from "./usePlaybackControls";
import type { usePlaybackState } from "./usePlaybackState";
import type { usePlaybackWallpaper } from "./usePlaybackWallpaper";
import type { usePlaybackWebcamLayout } from "./usePlaybackWebcamLayout";
import type { usePlaybackWebcamSync } from "./usePlaybackWebcamSync";
import { isWebcamVisibleAtSourceTime } from "./webcamSync";
export type PlaybackViewInput = Pick<
	ReturnType<typeof usePlaybackState> &
		PlaybackProps &
		ReturnType<typeof usePlaybackWallpaper> &
		ReturnType<typeof usePlaybackControls> &
		ReturnType<typeof usePlaybackWebcamLayout> &
		ReturnType<typeof usePlaybackWebcamSync> &
		ReturnType<typeof usePlaybackCaptions>,
	| "previewFrameRef"
	| "aspectRatio"
	| "nativeAspectRatio"
	| "resolvedWallpaperKind"
	| "resolvedWallpaper"
	| "bgVideoRef"
	| "sceneEffects"
	| "backgroundBlurOverscan"
	| "backgroundStyle"
	| "containerRef"
	| "isGap"
	| "pixiReady"
	| "videoReady"
	| "overlayRef"
	| "handleOverlayPointerDown"
	| "handleOverlayPointerMove"
	| "handleOverlayPointerUp"
	| "handleOverlayPointerLeave"
	| "focusIndicatorRef"
	| "webcamBlurCanvasRef"
	| "webcam"
	| "webcamVideoPath"
	| "webcamBubbleRef"
	| "currentTime"
	| "webcamBubbleInnerRef"
	| "webcamVideoDimensions"
	| "webcamMediaSynchronized"
	| "webcamMirror"
	| "webcamCropPreviewContentStyle"
	| "webcamVideoRef"
	| "handleWebcamMediaReady"
	| "captionFontReady"
	| "activeCaptionLayout"
	| "autoCaptionSettings"
	| "onEditAutoCaption"
	| "captionBoxRef"
	| "isCaptionEditing"
	| "te"
	| "beginCaptionEdit"
	| "captionFontFamily"
	| "captionEditSession"
	| "captionEditInputRef"
	| "setCaptionEditSession"
	| "captionEditSessionRef"
	| "commitCaptionEdit"
	| "cancelCaptionEdit"
	| "captionEditTextMetrics"
	| "annotationFrameStore"
	| "clipPlaybackRef"
	| "annotationRegions"
	| "onSelectAnnotation"
	| "selectedAnnotationId"
	| "annotationRecordingRect"
	| "onAnnotationPositionChange"
	| "onAnnotationSizeChange"
	| "onAnnotationContentChange"
	| "onAnnotationDelete"
	| "attachVideo"
	| "videoPath"
	| "handleLoadedMetadata"
	| "onDurationChange"
	| "onError"
>;
export function PlaybackView(input: PlaybackViewInput) {
	const {
		previewFrameRef,
		aspectRatio,
		nativeAspectRatio,
		resolvedWallpaperKind,
		resolvedWallpaper,
		bgVideoRef,
		sceneEffects,
		backgroundBlurOverscan,
		backgroundStyle,
		containerRef,
		isGap,
		pixiReady,
		videoReady,
		overlayRef,
		handleOverlayPointerDown,
		handleOverlayPointerMove,
		handleOverlayPointerUp,
		handleOverlayPointerLeave,
		focusIndicatorRef,
		webcamBlurCanvasRef,
		webcam,
		webcamVideoPath,
		webcamBubbleRef,
		currentTime,
		webcamBubbleInnerRef,
		webcamVideoDimensions,
		webcamMediaSynchronized,
		webcamMirror,
		webcamCropPreviewContentStyle,
		webcamVideoRef,
		handleWebcamMediaReady,
		te,
		annotationFrameStore,
		clipPlaybackRef,
		annotationRegions,
		onSelectAnnotation,
		selectedAnnotationId,
		annotationRecordingRect,
		onAnnotationPositionChange,
		onAnnotationSizeChange,
		onAnnotationContentChange,
		onAnnotationDelete,
		attachVideo,
		videoPath,
		handleLoadedMetadata,
		onDurationChange,
		onError,
	} = input;

	return (
		<div
			ref={previewFrameRef}
			data-preview-captions-ready={
				!input.autoCaptionSettings?.enabled || input.captionFontReady
			}
			className="relative overflow-hidden"
			style={{
				width: "100%",
				aspectRatio: formatAspectRatioForCSS(aspectRatio, nativeAspectRatio),
				borderRadius: 0,
				clipPath: "none",
			}}
		>
			{/* Background layer */}
			{resolvedWallpaperKind === "video" && resolvedWallpaper ? (
				<video
					data-preview-background
					data-background-kind="video"
					data-background-source={resolvedWallpaper}
					crossOrigin="anonymous"
					key={resolvedWallpaper}
					ref={bgVideoRef}
					className="absolute object-cover"
					src={resolvedWallpaper}
					muted
					loop
					playsInline
					style={{
						filter:
							sceneEffects.backgroundBlurPx > 0
								? `blur(${sceneEffects.backgroundBlurPx}px)`
								: "none",
						inset: -backgroundBlurOverscan,
						width: `calc(100% + ${backgroundBlurOverscan * 2}px)`,
						height: `calc(100% + ${backgroundBlurOverscan * 2}px)`,
					}}
				/>
			) : (
				<div
					data-preview-background
					data-background-kind={resolvedWallpaper ? resolvedWallpaperKind : "loading"}
					data-background-source={resolvedWallpaper ?? ""}
					className="absolute inset-0 bg-cover bg-center"
					style={{
						...backgroundStyle,
						filter:
							sceneEffects.backgroundBlurPx > 0
								? `blur(${sceneEffects.backgroundBlurPx}px)`
								: "none",
						inset: -backgroundBlurOverscan,
					}}
				/>
			)}
			<div
				ref={containerRef}
				className="absolute inset-0"
				style={{
					filter: sceneEffects.shadowFilter,
					visibility: isGap ? "hidden" : "visible",
				}}
			/>
			{/* Only render overlay after PIXI and video are fully initialized */}
			{pixiReady && videoReady && (
				<div
					ref={overlayRef}
					data-preview-overlay
					className="absolute inset-0 select-none"
					style={{
						pointerEvents: "none",
						visibility: isGap ? "hidden" : "visible",
					}}
					onPointerDown={handleOverlayPointerDown}
					onPointerMove={handleOverlayPointerMove}
					onPointerUp={handleOverlayPointerUp}
					onPointerLeave={handleOverlayPointerLeave}
				>
					<div
						ref={focusIndicatorRef}
						className="absolute rounded-md border border-[#2563EB]/80 bg-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.35)]"
						style={{ display: "none", pointerEvents: "none" }}
					/>
					<canvas
						ref={webcamBlurCanvasRef}
						data-webcam-motion-blur
						aria-hidden="true"
						className="pointer-events-none absolute"
						style={{ display: "none" }}
					/>
					{webcam && webcamVideoPath ? (
						<div
							ref={webcamBubbleRef}
							data-webcam-overlay
							data-webcam-ready={Boolean(
								webcamVideoDimensions && webcamMediaSynchronized,
							)}
							className="absolute"
							style={{
								display:
									webcam.enabled &&
									!isGap &&
									isWebcamVisibleAtSourceTime(webcam, currentTime)
										? "block"
										: "none",
								pointerEvents: "none",
							}}
						>
							<div
								ref={webcamBubbleInnerRef}
								className="relative h-full w-full overflow-hidden"
							>
								<div
									className="pointer-events-none absolute inset-0 overflow-hidden"
									style={{
										opacity:
											webcamVideoDimensions && webcamMediaSynchronized
												? 1
												: 0,
										transform: webcamMirror ? "scaleX(-1)" : undefined,
									}}
								>
									<div
										className="pointer-events-none absolute"
										style={webcamCropPreviewContentStyle}
									>
										<video
											crossOrigin="anonymous"
											ref={webcamVideoRef}
											src={webcamVideoPath}
											className="pointer-events-none absolute inset-0 block h-full w-full object-fill"
											muted
											playsInline
											preload="auto"
											aria-hidden="true"
											onLoadedMetadata={handleWebcamMediaReady}
											onLoadedData={handleWebcamMediaReady}
											onCanPlay={handleWebcamMediaReady}
											onSeeked={handleWebcamMediaReady}
										/>
									</div>
								</div>
								<svg
									data-webcam-glass-rim
									aria-hidden="true"
									focusable="false"
									className="pointer-events-none absolute inset-0 h-full w-full"
									style={{
										opacity:
											webcamVideoDimensions && webcamMediaSynchronized
												? 1
												: 0,
									}}
								>
									<path fill="none" stroke={GLASS_RIM_COLOR} />
								</svg>
							</div>
						</div>
					) : null}
					<PlaybackCaptions {...input} />
					<div
						className="absolute inset-0"
						style={{
							pointerEvents: "none",
						}}
					>
						<div
							className="absolute"
							style={{
								pointerEvents: "none",
								left: 0,
								top: 0,
								width: overlayRef.current?.clientWidth || 800,
								height: overlayRef.current?.clientHeight || 600,
							}}
						>
							{annotationRegions.length > 0 && (
								<PlaybackAnnotations
									annotationFrameStore={annotationFrameStore}
									clipPlaybackRef={clipPlaybackRef}
									annotationRegions={annotationRegions}
									overlayRef={overlayRef}
									annotationRecordingRect={annotationRecordingRect}
									onSelectAnnotation={onSelectAnnotation}
									selectedAnnotationId={selectedAnnotationId}
									onAnnotationPositionChange={onAnnotationPositionChange}
									onAnnotationSizeChange={onAnnotationSizeChange}
									onAnnotationContentChange={onAnnotationContentChange}
									onAnnotationDelete={onAnnotationDelete}
								/>
							)}
						</div>
					</div>
				</div>
			)}
			{/* Keep the source video off-screen instead of display:none so the
					browser continues producing presented frames for Pixi and preview sync. */}
			<video
				crossOrigin="anonymous"
				ref={attachVideo}
				src={videoPath}
				className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
				style={{ visibility: isGap ? "hidden" : "visible" }}
				preload="auto"
				playsInline
				aria-hidden="true"
				onLoadedMetadata={handleLoadedMetadata}
				onDurationChange={(e) => {
					onDurationChange(e.currentTarget.duration);
				}}
				onError={(e) => {
					const mediaError = e.currentTarget.error;
					const code = mediaError?.code;
					const msg = mediaError?.message;
					const detail =
						code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
							? "format not supported"
							: code === MediaError.MEDIA_ERR_NETWORK
								? "network error"
								: code === MediaError.MEDIA_ERR_DECODE
									? "decode error"
									: msg || `code ${code ?? "unknown"}`;
					console.error("[VideoPlayback] Video load error:", detail, "src:", videoPath);
					onError(te("videoLoadFailed", "Failed to load video"));
				}}
			/>
		</div>
	);
}
