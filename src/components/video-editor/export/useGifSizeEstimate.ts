import { useEffect, useMemo, useRef } from "react";
import { calculateOutputDimensions, GIF_SIZE_PRESETS } from "@/lib/exporter";
import type { GifSizeEstimate } from "@/lib/exporter/gifExporter";
import {
	cacheGifSizeEstimate,
	createGifEstimateKeyMemo,
	getCachedGifSizeEstimate,
	gifEstimateTelemetryKey,
	runGifSizeEstimate,
} from "./gifEstimateCache";
import { buildExportRenderOptions } from "./buildExportRenderOptions";
import type { ExportRunnerInput } from "./exportRunnerSupport";

const ignoreEstimateProgress = () => undefined;

export type GifSizeEstimateState =
	| { status: "calculating" }
	| { status: "ready"; estimate: GifSizeEstimate }
	| { status: "unavailable" };

/** A short, cancellable preflight; never saves files or moves the playback element. */
export function useGifSizeEstimate(input: ExportRunnerInput) {
	const { exportSession: session, exportSettings: settings } = input;
	const video = input.videoPlaybackRef.current?.video;
	const width = video?.videoWidth ?? 0;
	const height = video?.videoHeight ?? 0;
	const enabled =
		session.showExportDropdown &&
		!session.isExporting &&
		!session.exportedFilePath &&
		!session.exportError &&
		settings.publishDestination === "local" &&
		settings.exportFormat === "gif" &&
		!!input.videoPath &&
		width > 0 &&
		height > 0;
	const preview = input.videoPlaybackRef.current?.containerRef?.current;
	const config = enabled
		? {
				videoUrl: input.videoPath ?? "",
				...calculateOutputDimensions(
					width,
					height,
					settings.gifSizePreset,
					GIF_SIZE_PRESETS,
				),
				frameRate: settings.gifFrameRate,
				loop: settings.gifLoop,
				sizePreset: settings.gifSizePreset,
				...buildExportRenderOptions({
					appearance: input.appearance,
					timeline: input.timeline,
					effectiveSpeedRegions: input.effectiveSpeedRegions,
					effectiveZoomRegions: input.effectiveZoomRegions,
					effectiveCursorTelemetry: input.effectiveCursorTelemetry,
					effectiveShowCursor: input.effectiveShowCursor,
					previewWidth: preview?.clientWidth || 1920,
					previewHeight: preview?.clientHeight || 1080,
					shadowIntensity: input.appearance.shadowIntensity,
					onProgress: ignoreEstimateProgress,
				}),
				videoPadding: input.appearance.padding,
			}
		: null;
	// Telemetry can be large; track its immutable array identity separately instead
	// of serializing every cursor sample whenever playback causes a React render.
	const memoizeKey = useMemo(createGifEstimateKeyMemo, []);
	const key = config
		? memoizeKey({
				...config,
				cursorTelemetry: gifEstimateTelemetryKey(input.effectiveCursorTelemetry),
				duration: video?.duration,
			})
		: "";
	const configRef = useRef(config);
	useEffect(() => {
		if (config) configRef.current = config;
	}, [config]);
	const { setGifSizeEstimate } = session;
	useEffect(() => {
		if (!enabled) {
			setGifSizeEstimate(null);
			return;
		}
		const cached = getCachedGifSizeEstimate(key);
		if (cached) {
			setGifSizeEstimate({ status: "ready", estimate: cached });
			return;
		}
		const controller = new AbortController();
		setGifSizeEstimate({ status: "calculating" });
		const timer = setTimeout(() => {
			void (async () => {
				try {
					const { GifExporter } = await import("@/lib/exporter/gifExporter");
					if (controller.signal.aborted) return;
					const estimateConfig = configRef.current;
					if (!estimateConfig) return;
					const estimate = await runGifSizeEstimate(controller.signal, async (signal) => {
						const exporter = new GifExporter(estimateConfig);
						try {
							return await exporter.estimateSize(signal);
						} finally {
							await exporter.waitForEstimateCleanup();
						}
					});
					if (controller.signal.aborted) return;
					cacheGifSizeEstimate(key, estimate);
					setGifSizeEstimate({ status: "ready", estimate });
				} catch {
					if (!controller.signal.aborted) setGifSizeEstimate({ status: "unavailable" });
				}
			})();
		}, 500);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [enabled, key, setGifSizeEstimate]);
}
