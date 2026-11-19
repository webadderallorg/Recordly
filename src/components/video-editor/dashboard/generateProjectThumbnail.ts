import type { ProjectPreviewData } from "@/types/projectPreview";
import { FrameRenderer } from "@/lib/exporter/frameRenderer";
import {
	captureProjectThumbnailCanvas,
	getProjectThumbnailRenderSize,
} from "@/lib/projectThumbnailCanvas";
import { getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { normalizeProjectEditor } from "../projectPersistence";
import { type CursorTelemetryPoint, findClipAtTimelineTime, getClipSourceStartMs } from "../types";
import { getEffectiveNativeAspectRatio } from "../videoPlayback/playbackTypes";
import type { GeneratedProjectThumbnail } from "./projectThumbnailCache";

export async function generateProjectThumbnail(
	sourceUrl: string,
	metadata: ProjectPreviewData | null,
): Promise<GeneratedProjectThumbnail> {
	const editor = metadata ? normalizeProjectEditor(metadata.project.editor) : null;
	const clip = editor ? findClipAtTimelineTime(0, editor.clipRegions) : null;
	const sourceSeconds = clip ? getClipSourceStartMs(clip) / 1000 : 0;
	const hasOpeningGap = Boolean(editor?.clipRegions.length && !clip);
	const video = document.createElement("video");
	let renderer: FrameRenderer | null = null;
	let frame: VideoFrame | null = null;
	let expired = false;
	const checkDeadline = () => {
		if (expired) throw new Error("Thumbnail render timed out");
	};
	const cleanup = () => {
		frame?.close();
		frame = null;
		renderer?.destroy();
		video.onloadeddata = video.onseeked = video.onerror = null;
		video.removeAttribute("src");
		video.load();
	};
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			expired = true;
			reject(new Error("Thumbnail render timed out"));
		}, 15000);
	});
	const render = async (): Promise<GeneratedProjectThumbnail> => {
		try {
			video.muted = true;
			video.preload = "auto";
			video.crossOrigin = "anonymous";
			await new Promise<void>((resolve, reject) => {
				const finish = (error?: Error) => {
					clearTimeout(decodeTimeout);
					video.onloadeddata = video.onseeked = video.onerror = null;
					error ? reject(error) : resolve();
				};
				const decodeTimeout = window.setTimeout(
					() => finish(new Error("Thumbnail decode timed out")),
					15000,
				);
				video.onerror = () => finish(new Error("Thumbnail source unavailable"));
				video.onloadeddata = () => {
					if (sourceSeconds > 0 && !hasOpeningGap) {
						video.onseeked = () => finish();
						video.currentTime = sourceSeconds;
					} else finish();
				};
				video.src = sourceUrl;
			});
			checkDeadline();
			if (!video.videoWidth || !video.videoHeight)
				throw new Error("Thumbnail source has no frame");
			const duration = video.duration;
			if (editor && metadata) {
				// Cursor positions live in the recording sidecar, outside saved editor settings.
				let cursorTelemetry: CursorTelemetryPoint[] = [];
				try {
					const result = await window.electronAPI?.getCursorTelemetry?.(
						metadata.project.videoPath,
					);
					if (result?.success) cursorTelemetry = result.samples;
				} catch {
					// Missing sidecars must not prevent the rest of the preview from rendering.
				}
				checkDeadline();
				const renderSize = getProjectThumbnailRenderSize(
					getAspectRatioValue(
						editor.aspectRatio,
						getEffectiveNativeAspectRatio(
							{ width: video.videoWidth, height: video.videoHeight },
							editor.cropRegion,
						),
					),
				);
				renderer = new FrameRenderer({
					...editor,
					cursorTelemetry,
					timelineEffects: true,
					preferMediaElementSampling: true,
					...renderSize,
					videoWidth: video.videoWidth,
					videoHeight: video.videoHeight,
					showShadow: editor.shadowIntensity > 0,
					webcamUrl: metadata?.webcamUrl,
				});
				await renderer.initialize();
				checkDeadline();
				if (!hasOpeningGap)
					frame = new VideoFrame(video, { timestamp: sourceSeconds * 1_000_000 });
				await renderer.renderFrame(
					frame,
					sourceSeconds * 1_000_000,
					sourceSeconds * 1_000_000,
					undefined,
					0,
				);
				checkDeadline();
				return {
					url: captureProjectThumbnailCanvas(
						renderer.getCanvas(),
						renderSize.width,
						renderSize.height,
					),
					duration,
				};
			}
			return {
				url: captureProjectThumbnailCanvas(video, video.videoWidth, video.videoHeight),
				duration,
			};
		} finally {
			cleanup();
		}
	};
	try {
		return await Promise.race([render(), deadline]);
	} finally {
		expired = true;
		clearTimeout(timeout);
		cleanup();
	}
}
