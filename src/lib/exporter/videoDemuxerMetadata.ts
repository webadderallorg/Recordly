import { WebDemuxer } from "web-demuxer";
import { recordExportDiagnostic } from "../feedback/exportDiagnostics";
import {
	createFallbackDemuxerSource,
	getLocalFilePath,
	resolveMediaResourceUrl,
} from "./localMediaSource";
import { withMediaDeadline } from "./mediaDeadline";
import type { ExportDiagnosticCallbacks } from "./types";
import { getVideoDemuxerSignal, VideoDemuxerWorkerError } from "./videoDemuxerSignal";

const LOCAL_METADATA_TIMEOUT_MS = 8_000;
const REMOTE_METADATA_TIMEOUT_MS = 30_000;

export async function loadVideoDemuxerMetadata(
	videoUrl: string,
	signal: AbortSignal,
	useFallbackMediaSource = false,
	recordDiagnostic: NonNullable<
		ExportDiagnosticCallbacks["onDiagnostic"]
	> = recordExportDiagnostic,
) {
	const local = Boolean(getLocalFilePath(videoUrl));
	const timeoutMs = local ? LOCAL_METADATA_TIMEOUT_MS : REMOTE_METADATA_TIMEOUT_MS;
	const load = async (fallback: boolean) => {
		signal.throwIfAborted();
		const wasmFilePath = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
		const demuxer = new WebDemuxer({ wasmFilePath });
		try {
			return await withMediaDeadline(
				async (attemptSignal) => {
					const source = fallback
						? await createFallbackDemuxerSource(videoUrl, attemptSignal)
						: await resolveMediaResourceUrl(videoUrl);
					attemptSignal.throwIfAborted();
					await demuxer.load(source);
					attemptSignal.throwIfAborted();
					return { demuxer, mediaInfo: await demuxer.getMediaInfo() };
				},
				{
					signal: getVideoDemuxerSignal(demuxer, signal, recordDiagnostic),
					timeoutMs,
					message: "Reading video metadata timed out",
				},
			);
		} catch (error) {
			if (error instanceof DOMException && error.name === "TimeoutError") {
				recordDiagnostic("video-reader-metadata-timeout", {
					local,
					timeoutMs,
					fallback,
				});
			}
			try {
				demuxer.destroy();
			} catch {
				// Preserve the original load failure if cleanup also fails.
			}
			throw error;
		}
	};

	if (useFallbackMediaSource) return load(true);
	try {
		return await load(false);
	} catch (error) {
		signal.throwIfAborted();
		recordDiagnostic("video-reader-retry", {
			local,
			reason: error instanceof Error ? error.message : String(error),
		});
		console.warn("[VideoDemuxer] Retrying video metadata with a fresh reader:", error);
		return load(!(error instanceof VideoDemuxerWorkerError));
	}
}
