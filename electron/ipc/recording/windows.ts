import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { BrowserWindow } from "electron";
import { getWindowsCaptureExePath } from "../paths/binaries";
import {
	selectedSource,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsNativeCaptureActive,
	windowsCaptureOutputBuffer,
	windowsCaptureStopRequested,
	windowsCaptureTargetPath,
	windowsNativeCaptureActive,
} from "../state";
import path from "node:path";
import { AudioSyncAdjustment } from "../types";
import { moveFileWithOverwrite } from "../utils";
import { emitRecordingInterrupted } from "./events";

const WINDOWS_CAPTURE_STOP_TIMEOUT_MS = 45_000;

export type NativeWindowsVideoPaddingResult = {
	padded: boolean;
	durationSeconds: number;
	containerDurationSeconds: number;
	targetDurationSeconds: number;
	padDurationSeconds: number;
};

export type NativeWindowsAudioMuxResult = {
	muxed: boolean;
	videoDurationSeconds: number;
	muxTimeoutMs: number;
	audioInputs: string[];
	audio: Record<
		string,
		{
			path: string;
			sizeBytes: number;
			durationSeconds: number;
			startDelayMs: number | null;
			adjustment: AudioSyncAdjustment;
		}
	>;
	outputPath?: string;
	keptAudioSidecars?: boolean;
};

export async function isNativeWindowsCaptureAvailable(): Promise<boolean> {
	if (process.platform !== "win32") return false;

	const os = await import("node:os");
	const [major, , build] = os.release().split(".").map(Number);
	const supported = major >= 10 && build >= 19041;
	if (!supported) return false;

	try {
		await fs.access(getWindowsCaptureExePath(), fsConstants.X_OK);
	} catch {
		return false;
	}

	return true;
}

export function waitForWindowsCaptureStart(proc: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for native Windows capture to start"));
		}, 12000);

		let stdoutBuffer = "";
		const onStdout = (chunk: Buffer) => {
			stdoutBuffer += chunk.toString();
			if (stdoutBuffer.includes("Recording started")) {
				cleanup();
				resolve();
			}
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					windowsCaptureOutputBuffer.trim() ||
						`Native Windows capture exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const cleanup = () => {
			clearTimeout(timer);
			proc.stdout.off("data", onStdout);
			proc.off("error", onError);
			proc.off("exit", onExit);
		};

		proc.stdout.on("data", onStdout);
		proc.once("error", onError);
		proc.once("exit", onExit);
	});
}

export function waitForWindowsCaptureStop(
	proc: ChildProcessWithoutNullStreams,
	timeoutMs = WINDOWS_CAPTURE_STOP_TIMEOUT_MS,
) {
	return new Promise<string>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};

		const timer = setTimeout(() => {
			finish(() => {
				try {
					if (!proc.killed) proc.kill();
				} catch {
					// The process may already be gone; the caller only needs the timeout error.
				}
				reject(new Error("Timed out waiting for native Windows capture to stop"));
			});
		}, timeoutMs);

		const onClose = (code: number | null) => {
			finish(() => {
				const match = windowsCaptureOutputBuffer.match(
					/Recording stopped\. Output path: (.+)/,
				);
				if (match?.[1]) {
					resolve(match[1].trim());
					return;
				}
				if (code === 0 && windowsCaptureTargetPath) {
					resolve(windowsCaptureTargetPath);
					return;
				}
				reject(
					new Error(
						windowsCaptureOutputBuffer.trim() ||
							`Native Windows capture exited with code ${code ?? "unknown"}`,
					),
				);
			});
		};

		const onError = (error: Error) => {
			finish(() => {
				reject(error);
			});
		};

		const cleanup = () => {
			clearTimeout(timer);
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		proc.once("close", onClose);
		proc.once("error", onError);
	});
}

export function attachWindowsCaptureLifecycle(proc: ChildProcessWithoutNullStreams) {
	proc.once("close", () => {
		const wasActive = windowsNativeCaptureActive;
		setWindowsCaptureProcess(null);

		if (!wasActive || windowsCaptureStopRequested) {
			return;
		}

		setWindowsNativeCaptureActive(false);
		setWindowsCaptureStopRequested(false);

		const sourceName = selectedSource?.name ?? "Screen";
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording: false,
					sourceName,
				});
			}
		});

		emitRecordingInterrupted("capture-stopped", "Recording stopped unexpectedly.");
	});
}

/**
 * Prepend silence to a WAV file matching the startDelayMs from its companion JSON metadata.
 * This physically aligns the audio timeline with the video from t = 0.0s,
 * removing playback lag, start desynchronization, and preview timing gaps.
 */
async function alignWavSidecarWithSilence(wavPath: string, videoPath?: string | null): Promise<number> {
	const jsonPath = `${wavPath}.json`;
	let fileHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
	let writeHandle: Awaited<ReturnType<typeof fs.open>> | null = null;
	const tempPath = `${wavPath}.sync.tmp`;

	try {
		const jsonRaw = await fs.readFile(jsonPath, "utf8").catch(() => null);
		if (!jsonRaw) return 0;
		const metadata = JSON.parse(jsonRaw);
		const startDelayMs = metadata?.startDelayMs;
		if (!Number.isFinite(startDelayMs) || startDelayMs <= 0) {
			return 0;
		}

		const fileStat = await fs.stat(wavPath).catch(() => null);
		if (!fileStat || fileStat.size < 44) return 0;

		fileHandle = await fs.open(wavPath, "r");
		const headerScanBuf = Buffer.alloc(Math.min(1024, fileStat.size));
		const { bytesRead } = await fileHandle.read(headerScanBuf, 0, headerScanBuf.length, 0);

		if (
			bytesRead < 44 ||
			headerScanBuf.toString("ascii", 0, 4) !== "RIFF" ||
			headerScanBuf.toString("ascii", 8, 12) !== "WAVE"
		) {
			return 0;
		}

		let audioFormat = 1;
		let channels = 2;
		let sampleRate = 48000;
		let blockAlign = 4;
		let dataChunkOffset = -1;
		let declaredDataSize = 0;

		let offset = 12;
		while (offset + 8 <= bytesRead) {
			const chunkId = headerScanBuf.toString("ascii", offset, offset + 4);
			const chunkSize = headerScanBuf.readUInt32LE(offset + 4);
			if (chunkId === "fmt ") {
				audioFormat = headerScanBuf.readUInt16LE(offset + 8);
				channels = headerScanBuf.readUInt16LE(offset + 10);
				sampleRate = headerScanBuf.readUInt32LE(offset + 12);
				blockAlign = headerScanBuf.readUInt16LE(offset + 20);
			} else if (chunkId === "data") {
				dataChunkOffset = offset;
				declaredDataSize = chunkSize;
				break;
			}
			// WAV chunks are padded to even size; include pad byte in walk.
			offset += 8 + chunkSize + (chunkSize & 1);
		}

		if (dataChunkOffset < 0 || audioFormat !== 1 || channels <= 0 || sampleRate <= 0 || blockAlign <= 0) {
			return 0;
		}

		const dataPayloadOffset = dataChunkOffset + 8;
		const availableBytes = Math.max(0, fileStat.size - dataPayloadOffset);
		// Native recorder may write 0 or 0xFFFFFFFF as streaming placeholder; fall back to available bytes.
		const isPlaceholder = declaredDataSize === 0 || declaredDataSize === 0xffffffff;
		const actualDataSize = isPlaceholder ? availableBytes : Math.min(declaredDataSize, availableBytes);
		// Round down to full frames.
		const boundedDataSize = actualDataSize - (actualDataSize % blockAlign);
		const audioDurationMs = Math.round((boundedDataSize / (sampleRate * blockAlign)) * 1000);

		let effectiveDelayMs = startDelayMs;
		if (videoPath) {
			try {
				const videoStat = await fs.stat(videoPath).catch(() => null);
				if (videoStat && videoStat.size > 0) {
					const { probeVideoStreamDurationSeconds } = await import("./diagnostics");
					const videoDurationSec = await probeVideoStreamDurationSeconds(videoPath);
					if (videoDurationSec && videoDurationSec > 0) {
						const videoDurationMs = Math.round(videoDurationSec * 1000);
						const maxRealisticDelayMs = Math.max(0, videoDurationMs - audioDurationMs);
						if (startDelayMs > maxRealisticDelayMs) {
							console.log(
								`[mux-win] Correcting inflated startDelayMs from ${startDelayMs}ms to ${maxRealisticDelayMs}ms (video: ${videoDurationMs}ms, audio: ${audioDurationMs}ms)`,
							);
							effectiveDelayMs = maxRealisticDelayMs;
						}
					}
				}
			} catch {
				// Fallback to startDelayMs
			}
		}

		const numSilenceFrames = Math.round((effectiveDelayMs / 1000) * sampleRate);
		const silenceBytes = numSilenceFrames * blockAlign;
		if (silenceBytes <= 0) {
			metadata.startDelayMs = 0;
			await fs.writeFile(jsonPath, JSON.stringify(metadata, null, 2), "utf8");
			return 0;
		}

		const totalNewDataSize = boundedDataSize + silenceBytes;
		const totalNewRiffSize = dataPayloadOffset - 8 + totalNewDataSize;

		const headerToCopy = Buffer.alloc(dataPayloadOffset);
		await fileHandle.read(headerToCopy, 0, dataPayloadOffset, 0);
		headerToCopy.writeUInt32LE(totalNewRiffSize, 4);
		headerToCopy.writeUInt32LE(totalNewDataSize, dataChunkOffset + 4);

		writeHandle = await fs.open(tempPath, "w");
		await writeHandle.write(headerToCopy);

		const zeroChunkSize = 65536;
		const zeroBuf = Buffer.alloc(zeroChunkSize, 0);
		let remainingSilence = silenceBytes;
		while (remainingSilence > 0) {
			const toWrite = Math.min(remainingSilence, zeroChunkSize);
			await writeHandle.write(zeroBuf, 0, toWrite);
			remainingSilence -= toWrite;
		}

		const copyBuf = Buffer.alloc(65536);
		let readPos = dataPayloadOffset;
		const copyEnd = dataPayloadOffset + boundedDataSize;
		while (readPos < copyEnd) {
			const toRead = Math.min(copyBuf.length, copyEnd - readPos);
			const { bytesRead: count } = await fileHandle.read(copyBuf, 0, toRead, readPos);
			if (count <= 0) break;
			await writeHandle.write(copyBuf, 0, count);
			readPos += count;
		}

		// Trailing chunks after 'data' (e.g., LIST) are dropped; they are not audio samples.
		// If needed later, they can be preserved by appending them after the copy loop.

		await writeHandle.close();
		writeHandle = null;
		await fileHandle.close();
		fileHandle = null;

		await fs.rename(tempPath, wavPath);

		metadata.startDelayMs = 0;
		metadata.capturedDurationMs = (metadata.capturedDurationMs ?? 0) + effectiveDelayMs;
		metadata.dataBytes = totalNewDataSize;
		metadata.insertedSilenceFrames = (metadata.insertedSilenceFrames ?? 0) + numSilenceFrames;
		metadata.prePaddedSilenceMs = effectiveDelayMs;
		await fs.writeFile(jsonPath, JSON.stringify(metadata, null, 2), "utf8");

		console.log(
			`[mux-win] Pre-padded ${effectiveDelayMs}ms (${silenceBytes} bytes) of silence to ${path.basename(wavPath)}. Sidecar is now self-synced with startDelayMs=0.`,
		);
		return effectiveDelayMs;
	} catch (error) {
		// Clean up temp file on any failure after it was created.
		// Close writeHandle first (Windows cannot remove an open file).
		await writeHandle?.close().catch(() => { /* ignore close failure */ });
		writeHandle = null;
		await fs.rm(tempPath, { force: true }).catch(() => { /* ignore cleanup failure */ });
		console.warn(`[mux-win] Failed to align WAV sidecar ${wavPath}:`, error);
		return 0;
	} finally {
		// Ensure handles are closed on all paths (including early returns above).
		await writeHandle?.close().catch(() => { /* ignore close failure */ });
		await fileHandle?.close().catch(() => { /* ignore close failure */ });
	}
}

export async function muxNativeWindowsVideoWithAudio(
	videoPath: string,
	systemAudioPath: string | null,
	micAudioPath: string | null,
): Promise<NativeWindowsAudioMuxResult> {
	const start = Date.now();
	console.log("[PERF:MAIN] muxNativeWindowsVideoWithAudio: STARTED");
	const audio: NativeWindowsAudioMuxResult["audio"] = {};
	const audioInputs: string[] = [];

	const videoPathWithoutExt = videoPath.replace(/\.[^.]+$/u, "");

	// Optimization: instead of heavy FFmpeg muxing, we move audio sidecars
	// to companion paths and pre-pad silence so tracks are self-synced from 0.0s.
	if (systemAudioPath) {
		const finalSystemPath = `${videoPathWithoutExt}.system.wav`;
		try {
			const stat = await fs.stat(systemAudioPath);
			if (stat.size > 0) {
				if (systemAudioPath !== finalSystemPath) {
					await moveFileWithOverwrite(systemAudioPath, finalSystemPath);
					const sourceJson = `${systemAudioPath}.json`;
					const targetJson = `${finalSystemPath}.json`;
					try {
						await moveFileWithOverwrite(sourceJson, targetJson);
					} catch {
						// Ignored if json doesn't exist
					}
				}
				await alignWavSidecarWithSilence(finalSystemPath, videoPath);
				const finalStat = await fs.stat(finalSystemPath);
				audioInputs.push("system");
				audio.system = {
					path: finalSystemPath,
					sizeBytes: finalStat.size,
					durationSeconds: 0,
					startDelayMs: 0,
					adjustment: { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs: 0 },
				};
			}
		} catch (err) {
			console.error(`[mux-win] Failed to handle system audio:`, err);
		}
	}

	if (micAudioPath) {
		const finalMicPath = `${videoPathWithoutExt}.mic.wav`;
		try {
			const stat = await fs.stat(micAudioPath);
			if (stat.size > 0) {
				if (micAudioPath !== finalMicPath) {
					await moveFileWithOverwrite(micAudioPath, finalMicPath);
					const sourceJson = `${micAudioPath}.json`;
					const targetJson = `${finalMicPath}.json`;
					try {
						await moveFileWithOverwrite(sourceJson, targetJson);
					} catch {
						// Ignored if json doesn't exist
					}
				}
				await alignWavSidecarWithSilence(finalMicPath, videoPath);
				const finalStat = await fs.stat(finalMicPath);
				audioInputs.push("mic");
				audio.mic = {
					path: finalMicPath,
					sizeBytes: finalStat.size,
					durationSeconds: 0,
					startDelayMs: 0,
					adjustment: { mode: "none", delayMs: 0, tempoRatio: 1, durationDeltaMs: 0 },
				};
			}
		} catch (err) {
			console.error(`[mux-win] Failed to handle mic audio:`, err);
		}
	}

	console.log(`[PERF:MAIN] muxNativeWindowsVideoWithAudio: COMPLETED in ${Date.now() - start}ms`);

	return {
		muxed: false,
		videoDurationSeconds: 0, // No longer needed here
		muxTimeoutMs: 0,
		audioInputs,
		audio,
		keptAudioSidecars: true,
	};
}
