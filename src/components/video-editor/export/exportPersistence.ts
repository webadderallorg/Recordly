export interface PendingExportSave {
	fileName: string;
	arrayBuffer?: ArrayBuffer;
	tempFilePath?: string;
	captionSidecar?: {
		format: "srt" | "vtt" | "both";
		cues: Array<{
			startMs: number;
			endMs: number;
			text: string;
		}>;
	};
}

const EXPORT_BLOB_STREAM_CHUNK_BYTES = 16 * 1024 * 1024;

export async function streamExportBlobToTempFile(
	blob: Blob,
	extension: string,
): Promise<string | null> {
	if (
		typeof window === "undefined" ||
		!window.electronAPI?.openExportStream ||
		!window.electronAPI?.writeExportStreamChunk ||
		!window.electronAPI?.closeExportStream
	) {
		return null;
	}

	const openResult = await window.electronAPI.openExportStream({ extension });
	if (!openResult.success || !openResult.streamId || !openResult.tempPath) {
		throw new Error(openResult.error || "Failed to open export stream");
	}

	const { streamId } = openResult;
	let position = 0;
	try {
		while (position < blob.size) {
			const chunk = blob.slice(position, position + EXPORT_BLOB_STREAM_CHUNK_BYTES);
			const chunkBuffer = await chunk.arrayBuffer();
			const writeResult = await window.electronAPI.writeExportStreamChunk(
				streamId,
				position,
				new Uint8Array(chunkBuffer),
			);
			if (!writeResult.success) {
				throw new Error(writeResult.error || "Failed to write export stream chunk");
			}
			position += chunkBuffer.byteLength;
		}

		const closeResult = await window.electronAPI.closeExportStream(streamId);
		if (!closeResult.success || !closeResult.tempPath) {
			throw new Error(closeResult.error || "Failed to close export stream");
		}
		return closeResult.tempPath;
	} catch (error) {
		try {
			await window.electronAPI.closeExportStream(streamId, { abort: true });
		} catch {
			// Best-effort cleanup; preserve the original error.
		}
		throw error;
	}
}

export async function saveExportBlob(
	blob: Blob,
	fileName: string,
	outputPath: string | null = null,
	captionSidecar?: PendingExportSave["captionSidecar"],
) {
	const extension = fileName.split(".").pop()?.toLowerCase() || "bin";
	const hasExportStreamApi =
		typeof window !== "undefined" &&
		typeof window.electronAPI?.openExportStream === "function" &&
		typeof window.electronAPI?.writeExportStreamChunk === "function" &&
		typeof window.electronAPI?.closeExportStream === "function";
	let streamError: unknown = null;

	try {
		const tempFilePath = await streamExportBlobToTempFile(blob, extension);
		if (tempFilePath) {
			return {
				saveResult: await window.electronAPI.finalizeExportedVideo({
					tempPath: tempFilePath,
					fileName,
					outputPath,
					captionSidecar,
				}),
				pendingSave: { fileName, tempFilePath, captionSidecar } satisfies PendingExportSave,
			};
		}
	} catch (error) {
		streamError = error;
		console.warn("[export] Temp-file blob save failed", error);
	}

	if (!canUseInMemoryExportSaveFallback({ blobSize: blob.size, extension, hasExportStreamApi })) {
		const message = describeBlockedInMemoryExportSave({ blobSize: blob.size, extension });
		console.error("[export] Refusing in-memory blob save fallback", {
			fileName,
			blobSize: blob.size,
			extension,
			hasExportStreamApi,
			streamError,
		});
		throw new Error(message);
	}

	console.warn("[export] Falling back to in-memory blob save", {
		fileName,
		blobSize: blob.size,
		extension,
		hasExportStreamApi,
	});
	const arrayBuffer = await blob.arrayBuffer();
	return {
		saveResult: outputPath
			? await window.electronAPI.writeExportedVideoToPath(
					arrayBuffer,
					outputPath,
					captionSidecar,
				)
			: await window.electronAPI.saveExportedVideo(arrayBuffer, fileName, captionSidecar),
		pendingSave: { fileName, arrayBuffer, captionSidecar } satisfies PendingExportSave,
	};
}

export async function writeSmokeExportReport(
	outputPath: string | null,
	report: Record<string, unknown>,
): Promise<void> {
	if (!outputPath || typeof window === "undefined") return;

	try {
		const reportBytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
		const reportBuffer = reportBytes.buffer.slice(
			reportBytes.byteOffset,
			reportBytes.byteOffset + reportBytes.byteLength,
		) as ArrayBuffer;
		await window.electronAPI.writeExportedVideoToPath(
			reportBuffer,
			`${outputPath}.report.json`,
		);
	} catch (error) {
		console.error("[smoke-export] Failed to write report", error);
	}
}

import {
	canUseInMemoryExportSaveFallback,
	describeBlockedInMemoryExportSave,
} from "@/lib/exporter/exportSavePolicy";
