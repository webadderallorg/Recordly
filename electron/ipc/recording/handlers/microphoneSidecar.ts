import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import { getFfmpegBinaryPath } from "../../ffmpeg/binary";
import { getBrowserMicSidecarFilters, shouldKeepRecordingAudioSidecars } from "../audioFilters";
import { summarizeMicrophoneChunkTiming, writeRecordingDiagnosticsSnapshot } from "../diagnostics";
import {
	isRecord,
	pickAudioInputDevices,
	pickMicrophoneChunkEvents,
	pickMicrophonePauseIntervals,
	pickPrimitiveRecord,
} from "./microphoneMetadata";

const execFileAsync = promisify(execFile);

export function registerMicrophoneSidecar() {
	ipcMain.handle(
		"store-microphone-sidecar",
		async (
			_,
			audioData: ArrayBuffer,
			videoPath: string,
			options?: {
				startDelayMs?: number;
				browserMicrophoneProfile?: string;
				requestedBrowserMicrophoneProfile?: string | null;
				requestedConstraints?: unknown;
				mediaTrackSettings?: Record<string, boolean | number | string>;
				audioInputDevices?: unknown;
				mediaRecorder?: unknown;
				chunkEvents?: unknown;
				pauseIntervals?: unknown;
			},
		) => {
			const baseName = videoPath.replace(/\.[^.]+$/, "");
			const sidecarPath = `${baseName}.mic.wav`;
			const sourceWebmPath = `${baseName}.mic.source.webm`;
			const tempWebmPath = `${sourceWebmPath}.tmp`;

			try {
				await fs.writeFile(tempWebmPath, Buffer.from(audioData));
				await execFileAsync(
					getFfmpegBinaryPath(),
					[
						"-y",
						"-hide_banner",
						"-nostdin",
						"-nostats",
						"-i",
						tempWebmPath,
						"-vn",
						"-ac",
						"1",
						"-ar",
						"48000",
						"-af",
						[
							...getBrowserMicSidecarFilters(options?.browserMicrophoneProfile),
							"aresample=async=1:first_pts=0",
						].join(","),
						"-c:a",
						"pcm_s16le",
						sidecarPath,
					],
					{ timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
				);
				if (shouldKeepRecordingAudioSidecars()) {
					await fs.rename(tempWebmPath, sourceWebmPath).catch(async () => {
						await fs.copyFile(tempWebmPath, sourceWebmPath);
						await fs.rm(tempWebmPath, { force: true });
					});
				} else {
					await fs.rm(tempWebmPath, { force: true });
				}
				const startDelayMs = options?.startDelayMs;
				const mediaTrackSettings = pickPrimitiveRecord(options?.mediaTrackSettings);
				const audioInputDevices = pickAudioInputDevices(options?.audioInputDevices);
				const mediaRecorder = isRecord(options?.mediaRecorder)
					? {
							...(typeof options.mediaRecorder.mimeType === "string"
								? { mimeType: options.mediaRecorder.mimeType }
								: {}),
							...(typeof options.mediaRecorder.audioBitsPerSecond === "number"
								? {
										audioBitsPerSecond: Math.round(
											options.mediaRecorder.audioBitsPerSecond,
										),
									}
								: {}),
							...(typeof options.mediaRecorder.timesliceMs === "number"
								? { timesliceMs: Math.round(options.mediaRecorder.timesliceMs) }
								: {}),
						}
					: null;
				const chunkEvents = pickMicrophoneChunkEvents(options?.chunkEvents);
				const pauseIntervals = pickMicrophonePauseIntervals(options?.pauseIntervals);
				const chunkTiming =
					chunkEvents || pauseIntervals
						? summarizeMicrophoneChunkTiming(
								chunkEvents,
								pauseIntervals,
								mediaRecorder?.timesliceMs,
							)
						: null;
				const metadata = {
					...(Number.isFinite(startDelayMs) && (startDelayMs ?? 0) >= 0
						? { startDelayMs: Math.round(startDelayMs ?? 0) }
						: {}),
					...(typeof options?.browserMicrophoneProfile === "string"
						? { browserMicrophoneProfile: options.browserMicrophoneProfile }
						: {}),
					...(typeof options?.requestedBrowserMicrophoneProfile === "string"
						? {
								requestedBrowserMicrophoneProfile:
									options.requestedBrowserMicrophoneProfile,
							}
						: {}),
					...(isRecord(options?.requestedConstraints)
						? { requestedConstraints: options.requestedConstraints }
						: {}),
					...(mediaTrackSettings ? { mediaTrackSettings } : {}),
					...(audioInputDevices ? { audioInputDevices } : {}),
					...(mediaRecorder && Object.keys(mediaRecorder).length > 0
						? { mediaRecorder }
						: {}),
					...(chunkEvents ? { chunkEvents } : {}),
					...(pauseIntervals ? { pauseIntervals } : {}),
					...(chunkTiming ? { chunkTiming } : {}),
				};
				if (Object.keys(metadata).length > 0) {
					try {
						await fs.writeFile(`${sidecarPath}.json`, JSON.stringify(metadata));
					} catch (metadataError) {
						console.warn(
							"Failed to store microphone sidecar timing metadata:",
							metadataError,
						);
					}
				}
				await writeRecordingDiagnosticsSnapshot(videoPath, {
					backend: "browser-store",
					phase: "mic-sidecar",
					outputPath: videoPath,
					microphonePath: sidecarPath,
					details: {
						sourceBytes: audioData.byteLength,
						sourceWebmPath: shouldKeepRecordingAudioSidecars() ? sourceWebmPath : null,
						metadata,
					},
				}).catch((diagnosticsError) => {
					console.warn(
						"Failed to write microphone sidecar diagnostics:",
						diagnosticsError,
					);
				});
				return { success: true, path: sidecarPath };
			} catch (error) {
				await Promise.all([
					fs.rm(tempWebmPath, { force: true }).catch(() => undefined),
					fs.rm(sidecarPath, { force: true }).catch(() => undefined),
				]);
				console.error("Failed to store microphone sidecar:", error);
				return { success: false, error: String(error) };
			}
		},
	);
}
