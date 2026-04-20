import { AudioProcessor } from "../audioEncoder";
import { type DecodedVideoInfo } from "../streamingDecoder";
import type { ExportResult } from "../types";
import { VideoExporterEncoderBase } from "./encoderBase";
import type { NativeAudioPlan } from "./shared";

export abstract class VideoExporterAudioBase extends VideoExporterEncoderBase {
	protected audioProcessor: AudioProcessor | null = null;

	protected getNativeVideoSourcePath(): string | null {
		const resource = this.config.videoUrl;
		if (!resource) {
			return null;
		}

		if (/^file:\/\//i.test(resource)) {
			try {
				const url = new URL(resource);
				const pathname = decodeURIComponent(url.pathname);
				if (url.host && url.host !== "localhost") {
					return `//${url.host}${pathname}`;
				}
				if (/^\/[A-Za-z]:/.test(pathname)) {
					return pathname.slice(1);
				}
				return pathname;
			} catch {
				return resource.replace(/^file:\/\//i, "");
			}
		}

		if (
			resource.startsWith("/") ||
			/^[A-Za-z]:[\\/]/.test(resource) ||
			/^\\\\[^\\]+\\[^\\]+/.test(resource)
		) {
			return resource;
		}

		return null;
	}

	protected buildNativeTrimSegments(
		durationMs: number,
	): Array<{ startMs: number; endMs: number }> {
		const trimRegions = [...(this.config.trimRegions ?? [])].sort(
			(a, b) => a.startMs - b.startMs,
		);
		if (trimRegions.length === 0) {
			return [{ startMs: 0, endMs: Math.max(0, durationMs) }];
		}

		const segments: Array<{ startMs: number; endMs: number }> = [];
		let cursorMs = 0;

		for (const region of trimRegions) {
			const startMs = Math.max(0, Math.min(region.startMs, durationMs));
			const endMs = Math.max(startMs, Math.min(region.endMs, durationMs));
			if (startMs > cursorMs) {
				segments.push({ startMs: cursorMs, endMs: startMs });
			}
			cursorMs = Math.max(cursorMs, endMs);
		}

		if (cursorMs < durationMs) {
			segments.push({ startMs: cursorMs, endMs: durationMs });
		}

		return segments.filter((segment) => segment.endMs - segment.startMs > 0.5);
	}

	protected buildNativeAudioPlan(videoInfo: DecodedVideoInfo): NativeAudioPlan {
		const speedRegions = this.config.speedRegions ?? [];
		const audioRegions = this.config.audioRegions ?? [];
		const sourceAudioFallbackPaths = (this.config.sourceAudioFallbackPaths ?? []).filter(
			(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
		);
		const localVideoSourcePath = this.getNativeVideoSourcePath();
		const primaryAudioSourcePath =
			(videoInfo.hasAudio ? localVideoSourcePath : null) ??
			sourceAudioFallbackPaths[0] ??
			null;

		if (
			!videoInfo.hasAudio &&
			sourceAudioFallbackPaths.length === 0 &&
			audioRegions.length === 0
		) {
			return { audioMode: "none" };
		}

		if (
			speedRegions.length > 0 ||
			audioRegions.length > 0 ||
			sourceAudioFallbackPaths.length > 1
		) {
			return { audioMode: "edited-track" };
		}

		if (!primaryAudioSourcePath) {
			return { audioMode: "edited-track" };
		}

		if ((this.config.trimRegions ?? []).length > 0) {
			const sourceDurationMs = Math.max(
				0,
				Math.round((videoInfo.streamDuration ?? videoInfo.duration) * 1000),
			);
			const trimSegments = this.buildNativeTrimSegments(sourceDurationMs);
			if (trimSegments.length === 0) {
				return { audioMode: "none" };
			}

			return {
				audioMode: "trim-source",
				audioSourcePath: primaryAudioSourcePath,
				trimSegments,
			};
		}

		return {
			audioMode: "copy-source",
			audioSourcePath: primaryAudioSourcePath,
		};
	}

	protected async finishNativeVideoExport(
		audioPlan: NativeAudioPlan,
		totalFrames: number,
	): Promise<ExportResult> {
		if (!this.nativeExportSessionId) {
			return { success: false, error: "Native export session is not active" };
		}

		let editedAudioBuffer: ArrayBuffer | undefined;
		let editedAudioMimeType: string | null = null;

		if (audioPlan.audioMode === "edited-track") {
			this.audioProcessor = new AudioProcessor();
			this.audioProcessor.setOnProgress((progress) => {
				this.reportFinalizingProgress(totalFrames, 99, progress);
			});
			const audioBlob = await this.awaitWithFinalizationTimeout(
				this.audioProcessor.renderEditedAudioTrack(
					this.config.videoUrl,
					this.config.trimRegions,
					this.config.speedRegions,
					this.config.audioRegions,
					this.config.sourceAudioFallbackPaths,
				),
				"native edited audio rendering",
			);
			editedAudioBuffer = await audioBlob.arrayBuffer();
			editedAudioMimeType = audioBlob.type || null;
		}

		const sessionId = this.nativeExportSessionId;
		this.nativeExportSessionId = null;

		const result = await this.awaitWithFinalizationTimeout(
			window.electronAPI.nativeVideoExportFinish(sessionId, {
				audioMode: audioPlan.audioMode,
				audioSourcePath:
					audioPlan.audioMode === "copy-source" || audioPlan.audioMode === "trim-source"
						? audioPlan.audioSourcePath
						: null,
				trimSegments:
					audioPlan.audioMode === "trim-source" ? audioPlan.trimSegments : undefined,
				editedAudioData: editedAudioBuffer,
				editedAudioMimeType,
			}),
			"native export finalization",
		);

		if (!result.success || !result.data) {
			return {
				success: false,
				error: result.error || "Failed to finalize native video export",
			};
		}

		const blobData = new Uint8Array(result.data.byteLength);
		blobData.set(result.data);

		return {
			success: true,
			blob: new Blob([blobData.buffer], { type: "video/mp4" }),
		};
	}

	protected async finalizeExportWithFfmpegAudio(
		videoBlob: Blob,
		audioPlan: NativeAudioPlan,
		totalFrames: number,
	): Promise<ExportResult> {
		if (typeof window === "undefined" || !window.electronAPI?.muxExportedVideoAudio) {
			return {
				success: false,
				error: "FFmpeg audio fallback is unavailable in this environment.",
			};
		}

		let editedAudioBuffer: ArrayBuffer | undefined;
		let editedAudioMimeType: string | null = null;

		if (audioPlan.audioMode === "edited-track") {
			this.audioProcessor = new AudioProcessor();
			this.audioProcessor.setOnProgress((progress) => {
				this.reportFinalizingProgress(totalFrames, 99, progress);
			});
			const audioBlob = await this.awaitWithFinalizationTimeout(
				this.audioProcessor.renderEditedAudioTrack(
					this.config.videoUrl,
					this.config.trimRegions,
					this.config.speedRegions,
					this.config.audioRegions,
					this.config.sourceAudioFallbackPaths,
				),
				"ffmpeg edited audio rendering",
			);
			editedAudioBuffer = await audioBlob.arrayBuffer();
			editedAudioMimeType = audioBlob.type || null;
		}

		const videoBuffer = await videoBlob.arrayBuffer();
		const result = await this.awaitWithFinalizationTimeout(
			window.electronAPI.muxExportedVideoAudio(videoBuffer, {
				audioMode: audioPlan.audioMode,
				audioSourcePath:
					audioPlan.audioMode === "copy-source" || audioPlan.audioMode === "trim-source"
						? audioPlan.audioSourcePath
						: null,
				trimSegments:
					audioPlan.audioMode === "trim-source" ? audioPlan.trimSegments : undefined,
				editedAudioData: editedAudioBuffer,
				editedAudioMimeType,
			}),
			"ffmpeg audio muxing",
		);

		if (!result.success || !result.data) {
			return {
				success: false,
				error: result.error || "Failed to mux exported audio with FFmpeg",
			};
		}

		const blobData = new Uint8Array(result.data.byteLength);
		blobData.set(result.data);
		return {
			success: true,
			blob: new Blob([blobData.buffer], { type: "video/mp4" }),
		};
	}
}