import { type MutableRefObject, type RefObject, useEffect, useRef, useState } from "react";
import { resolveExportStartSettings } from "../exportStartSettings";
import type { useTimelineState } from "../state/useTimelineState";
import type { ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import {
	describeExportRangeLimits,
	type ExportRange,
	readExportRangeArgs,
	resolveExportRange,
} from "./exportRange";
import type { useExportRunner } from "./useExportRunner";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";

const AUTO_ZOOM_GRACE_MS = 6_000;

type Input = {
	videoPath: string | null;
	videoSourcePath: string | null;
	error: string | null;
	loading: boolean;
	isPreviewReady: boolean;
	duration: number;
	cursorTelemetrySourcePath: string | null;
	pendingFreshRecordingAutoZoomPathRef?: MutableRefObject<string | null>;
	agentEditsSettled?: boolean;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timeline: ReturnType<typeof useTimelineState>;
	effectiveZoomRegions: ZoomRegion[];
	settings: ReturnType<typeof useExportSettings>;
	session: ReturnType<typeof useExportSession>;
	handleExport: ReturnType<typeof useExportRunner>["handleExport"];
};

export function useRemoteExportBridge(input: Input) {
	const { videoPath, videoSourcePath, pendingFreshRecordingAutoZoomPathRef: pendingRef } = input;
	const [graceElapsedFor, setGraceElapsedFor] = useState<string | null>(null);
	const activeIdRef = useRef<string | null>(null);

	const previewReady =
		!input.error &&
		Boolean(videoPath) &&
		!input.loading &&
		input.isPreviewReady &&
		input.duration > 0 &&
		(!videoSourcePath || input.cursorTelemetrySourcePath === videoSourcePath);
	const autoZoomPending =
		(pendingRef ? pendingRef.current : videoPath) === videoPath ||
		input.agentEditsSettled === false;
	const ready = previewReady && (!autoZoomPending || graceElapsedFor === videoPath);

	const latestRef = useRef({ ...input, ready });
	latestRef.current = { ...input, ready };

	useEffect(() => {
		if (!previewReady || !videoPath) return;
		const timer = window.setTimeout(() => setGraceElapsedFor(videoPath), AUTO_ZOOM_GRACE_MS);
		return () => window.clearTimeout(timer);
	}, [previewReady, videoPath]);

	useEffect(() => {
		window.electronAPI.sendRemoteEditorReady?.({ videoPath: videoSourcePath, ready });
	}, [videoSourcePath, ready]);

	const percentage = input.session.exportProgress?.percentage;
	const progress = percentage === undefined ? undefined : Math.round(percentage);
	useEffect(() => {
		const id = activeIdRef.current;
		if (id && progress !== undefined)
			window.electronAPI.sendRemoteExportProgress?.({ id, progress });
	}, [progress]);

	useEffect(
		() =>
			window.electronAPI.onRemoteExportRequest?.(async (request) => {
				const reply = (result: Omit<RemoteExportResult, "id">) =>
					window.electronAPI.sendRemoteExportResult({ id: request.id, ...result });
				const current = latestRef.current;
				if (!current.ready) {
					reply({ ok: false, error: "The editor is still loading the recording." });
					return;
				}
				if (current.session.isExporting || activeIdRef.current) {
					reply({ ok: false, error: "An export is already running in the editor." });
					return;
				}
				if (current.session.hasPendingExportSave) {
					reply({
						ok: false,
						error: "The editor has an unsaved export. Save or discard it in the editor first.",
					});
					return;
				}
				const video = current.videoPlaybackRef.current?.video;
				if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
					reply({ ok: false, error: "The video is not loaded in the editor." });
					return;
				}
				let range: ExportRange | undefined;
				let warnings: string[] = [];
				let timelineDurationMs: number | undefined;
				try {
					const requested = readExportRangeArgs(request);
					if (requested) {
						const resolved = resolveExportRange(
							requested,
							current.timeline.clipRegions,
							current.duration * 1000,
						);
						range = resolved.range;
						timelineDurationMs = resolved.timelineDurationMs;
						warnings = describeExportRangeLimits(range, current.effectiveZoomRegions);
					}
				} catch (rangeError) {
					reply({
						ok: false,
						error:
							rangeError instanceof Error ? rangeError.message : String(rangeError),
					});
					return;
				}
				const { settings } = current;
				const exportSettings = resolveExportStartSettings({
					sourceWidth: video.videoWidth,
					sourceHeight: video.videoHeight,
					exportFormat: request.format,
					includeCaptionSidecar: false,
					exportEncodingMode: "balanced",
					exportQuality: request.quality ?? "good",
					mp4FrameRate: settings.mp4FrameRate,
					exportBackendPreference: settings.exportBackendPreference,
					exportPipelineModel: settings.exportPipelineModel,
					gifFrameRate: settings.gifFrameRate,
					gifLoop: settings.gifLoop,
					gifSizePreset: settings.gifSizePreset,
				});
				activeIdRef.current = request.id;
				let error: string | undefined;
				try {
					const path = await current.handleExport(exportSettings, {
						destination: "download",
						outputPath: request.outputPath,
						range,
						onError: (message) => {
							error = message;
						},
					});
					reply(
						path
							? {
									ok: true,
									path,
									fromMs: range?.fromMs,
									toMs: range?.toMs,
									timelineDurationMs,
									warnings: warnings.length > 0 ? warnings : undefined,
								}
							: {
									ok: false,
									error: error ?? "The export was canceled in the editor.",
								},
					);
				} catch (exportError) {
					reply({ ok: false, error: String(exportError) });
				} finally {
					activeIdRef.current = null;
				}
			}),
		[],
	);

	return ready;
}
