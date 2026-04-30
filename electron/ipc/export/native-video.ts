import type { ChildProcessByStdio } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import type { WebContents } from "electron";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import type {
	NativeExportEncodingMode,
	NativeFastVideoExportOptions,
	NativeVideoAudioMuxMetrics,
	NativeVideoExportFinishOptions,
} from "../nativeVideoExport";
import {
	buildEditedTrackSourceAudioFilter,
	buildNativeFastVideoExportArgs,
	buildNativeVideoExportArgs,
	buildTrimmedSourceAudioFilter,
	canStreamCopyNativeFastVideoExport,
	getEditedAudioExtension,
	getNativeVideoInputByteSize,
	getPreferredNativeVideoEncoders,
	parseAvailableFfmpegEncoders,
	parseNativeFastVideoSourceProbe,
} from "../nativeVideoExport";
import { cachedNativeVideoEncoder, setCachedNativeVideoEncoder } from "../state";

const execFileAsync = promisify(execFile);
const getNowMs = () => performance.now();

export type NativeVideoExportSession = {
	ffmpegProcess: ChildProcessByStdio<Writable, null, Readable>;
	outputPath: string;
	inputByteSize: number;
	inputMode: "rawvideo" | "h264-stream";
	maxQueuedWriteBytes: number;
	stderrOutput: string;
	encoderName: string;
	processError: Error | null;
	stdinError: Error | null;
	terminating: boolean;
	writeSequence: Promise<void>;
	completionPromise: Promise<void>;
	sender: WebContents | null;
	pendingWriteRequestIds: Set<number>;
};

export const nativeVideoExportSessions = new Map<string, NativeVideoExportSession>();

export function cleanupNativeVideoExportSessions() {
	for (const [sessionId, session] of nativeVideoExportSessions) {
		session.terminating = true;
		try {
			if (!session.ffmpegProcess.stdin.destroyed) {
				session.ffmpegProcess.stdin.destroy();
			}
		} catch {
			/* stream may already be closed */
		}
		try {
			session.ffmpegProcess.kill("SIGKILL");
		} catch {
			/* process may already be exited */
		}
		nativeVideoExportSessions.delete(sessionId);
	}
}

export function getNativeVideoExportMaxQueuedWriteBytes(inputByteSize: number) {
	if (inputByteSize === 0) return 8 * 1024 * 1024;
	return Math.min(64 * 1024 * 1024, Math.max(16 * 1024 * 1024, inputByteSize * 4));
}

export function isHardwareAcceleratedVideoEncoder(encoderName: string) {
	return /(videotoolbox|nvenc|qsv|amf|mf)/i.test(encoderName);
}

export async function removeTemporaryExportFile(filePath: string | null | undefined) {
	if (!filePath) {
		return;
	}

	try {
		await fs.rm(filePath, { force: true });
	} catch {
		// Ignore cleanup failures for temp export artifacts.
	}
}

export function getNativeVideoExportSessionError(
	session: NativeVideoExportSession,
	fallback: string,
) {
	return (
		session.stdinError?.message ||
		session.processError?.message ||
		session.stderrOutput.trim() ||
		fallback
	);
}

export function sendNativeVideoExportWriteFrameResult(
	sender: WebContents | null | undefined,
	sessionId: string,
	requestId: number,
	result: { success: boolean; error?: string },
) {
	if (!sender || sender.isDestroyed()) {
		return;
	}

	sender.send("native-video-export-write-frame-result", {
		sessionId,
		requestId,
		...result,
	});
}

export function settleNativeVideoExportWriteFrameRequest(
	sessionId: string,
	session: NativeVideoExportSession,
	requestId: number,
	result: { success: boolean; error?: string },
) {
	session.pendingWriteRequestIds.delete(requestId);
	sendNativeVideoExportWriteFrameResult(session.sender, sessionId, requestId, result);
}

export function flushNativeVideoExportPendingWriteRequests(
	sessionId: string,
	session: NativeVideoExportSession,
	error: string,
) {
	for (const requestId of session.pendingWriteRequestIds) {
		sendNativeVideoExportWriteFrameResult(session.sender, sessionId, requestId, {
			success: false,
			error,
		});
	}

	session.pendingWriteRequestIds.clear();
}

export function isIgnorableNativeVideoExportStreamError(error: Error | null | undefined): boolean {
	if (!error) {
		return false;
	}

	const errno = error as NodeJS.ErrnoException;
	return (
		errno.code === "EPIPE" ||
		errno.code === "ERR_STREAM_DESTROYED" ||
		/broken pipe|stream destroyed|eof/i.test(error.message)
	);
}

export async function waitForNativeVideoExportDrain(session: NativeVideoExportSession) {
	if (
		session.stdinError ||
		session.processError ||
		session.ffmpegProcess.stdin.destroyed ||
		session.ffmpegProcess.stdin.writableEnded ||
		!session.ffmpegProcess.stdin.writable ||
		session.ffmpegProcess.stdin.writableLength <= 0
	) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(
				new Error("Timed out while waiting for native export writer backpressure to clear"),
			);
		}, 15000);

		const cleanup = () => {
			clearTimeout(timeout);
			session.ffmpegProcess.stdin.off("drain", handleDrain);
			session.ffmpegProcess.stdin.off("error", handleError);
			session.ffmpegProcess.off("close", handleClose);
		};

		const handleDrain = () => {
			cleanup();
			resolve();
		};

		const handleError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const handleClose = () => {
			cleanup();
			reject(
				new Error(
					getNativeVideoExportSessionError(
						session,
						"Native video export writer closed before draining",
					),
				),
			);
		};

		session.ffmpegProcess.stdin.once("drain", handleDrain);
		session.ffmpegProcess.stdin.once("error", handleError);
		session.ffmpegProcess.once("close", handleClose);
	});
}

export function getNativeVideoExportFrameLength(frameData: Uint8Array | ArrayBuffer) {
	return frameData.byteLength;
}

export async function writeNativeVideoExportFrame(
	session: NativeVideoExportSession,
	frameData: Uint8Array | ArrayBuffer,
) {
	if (
		session.inputMode !== "h264-stream" &&
		getNativeVideoExportFrameLength(frameData) !== session.inputByteSize
	) {
		throw new Error(
			`Native video export expected ${session.inputByteSize} bytes per frame but received ${getNativeVideoExportFrameLength(frameData)}`,
		);
	}

	if (
		session.stdinError ||
		session.processError ||
		session.ffmpegProcess.stdin.destroyed ||
		session.ffmpegProcess.stdin.writableEnded ||
		!session.ffmpegProcess.stdin.writable
	) {
		throw new Error(
			getNativeVideoExportSessionError(
				session,
				"Native video export encoder is not accepting frames",
			),
		);
	}

	const frameBuffer =
		frameData instanceof ArrayBuffer
			? Buffer.from(frameData)
			: Buffer.from(frameData.buffer, frameData.byteOffset, frameData.byteLength);

	try {
		session.ffmpegProcess.stdin.write(frameBuffer);
	} catch (error) {
		session.stdinError = error instanceof Error ? error : new Error(String(error));
		throw session.stdinError;
	}

	if (session.ffmpegProcess.stdin.writableLength >= session.maxQueuedWriteBytes) {
		try {
			await waitForNativeVideoExportDrain(session);
		} catch (error) {
			session.stdinError = error instanceof Error ? error : new Error(String(error));
			throw session.stdinError;
		}
	}
}

export async function enqueueNativeVideoExportFrameWrite(
	session: NativeVideoExportSession,
	frameData: Uint8Array | ArrayBuffer,
) {
	const writePromise = session.writeSequence.then(async () => {
		if (session.terminating) {
			throw new Error("Native video export session was cancelled");
		}

		await writeNativeVideoExportFrame(session, frameData);
	});

	session.writeSequence = writePromise.catch(() => undefined);
	await writePromise;
}

export async function getAvailableNativeVideoEncoders(ffmpegPath: string) {
	const { stdout } = await execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	});

	return parseAvailableFfmpegEncoders(stdout);
}

export async function probeNativeVideoEncoder(
	ffmpegPath: string,
	encoderName: string,
	encodingMode: NativeExportEncodingMode,
) {
	const outputPath = path.join(
		app.getPath("temp"),
		`recordly-export-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
	);
	const args = buildNativeVideoExportArgs(
		encoderName,
		{
			width: 64,
			height: 64,
			frameRate: 1,
			bitrate: 1_500_000,
			encodingMode,
		},
		outputPath,
	);

	return new Promise<boolean>((resolve) => {
		const process = spawn(ffmpegPath, args, {
			stdio: ["pipe", "ignore", "pipe"],
		});
		let stderrOutput = "";
		const timeout = setTimeout(() => {
			try {
				process.kill("SIGKILL");
			} catch {
				// ignore
			}
			resolve(false);
		}, 15000);

		process.stderr.on("data", (chunk: Buffer) => {
			stderrOutput += chunk.toString();
		});

		process.on("close", (code) => {
			clearTimeout(timeout);
			void removeTemporaryExportFile(outputPath);
			if (code !== 0 && stderrOutput.trim().length > 0) {
				console.warn(
					`[native-export] Encoder probe failed for ${encoderName}:`,
					stderrOutput.trim(),
				);
			}
			resolve(code === 0);
		});

		process.stdin.end(Buffer.alloc(getNativeVideoInputByteSize(64, 64), 0));
	});
}

export async function resolveNativeVideoEncoder(
	ffmpegPath: string,
	encodingMode: NativeExportEncodingMode,
) {
	if (
		cachedNativeVideoEncoder?.ffmpegPath === ffmpegPath &&
		cachedNativeVideoEncoder?.encodingMode === encodingMode
	) {
		return cachedNativeVideoEncoder.encoderName;
	}

	const availableEncoders = await getAvailableNativeVideoEncoders(ffmpegPath);
	const candidates = [
		...new Set([...getPreferredNativeVideoEncoders(process.platform), "libx264"]),
	];

	for (const encoderName of candidates) {
		if (!availableEncoders.has(encoderName)) {
			continue;
		}

		if (await probeNativeVideoEncoder(ffmpegPath, encoderName, encodingMode)) {
			setCachedNativeVideoEncoder({ ffmpegPath, encodingMode, encoderName });
			return encoderName;
		}
	}

	throw new Error("No usable FFmpeg encoder was available for native export");
}

async function shouldUseNativeFastVideoStreamCopy(
	ffmpegPath: string,
	options: NativeFastVideoExportOptions,
) {
	try {
		await execFileAsync(ffmpegPath, ["-hide_banner", "-i", options.sourcePath], {
			timeout: 15000,
			maxBuffer: 20 * 1024 * 1024,
		});
		return false;
	} catch (error) {
		const output =
			error && typeof error === "object"
				? `${"stdout" in error ? String(error.stdout ?? "") : ""}\n${"stderr" in error ? String(error.stderr ?? "") : ""}`
				: String(error);
		const probe = parseNativeFastVideoSourceProbe(output);
		return canStreamCopyNativeFastVideoExport(probe, options);
	}
}

export async function exportNativeFastVideo(options: NativeFastVideoExportOptions) {
	const ffmpegPath = getFfmpegBinaryPath();
	const useStreamCopy = await shouldUseNativeFastVideoStreamCopy(ffmpegPath, options);
	const encoderName = useStreamCopy
		? "copy"
		: await resolveNativeVideoEncoder(ffmpegPath, options.encodingMode);
	const outputPath = path.join(
		app.getPath("temp"),
		`recordly-fast-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
	);
	const args = buildNativeFastVideoExportArgs(
		encoderName,
		{
			...options,
			videoMode: useStreamCopy ? "copy" : "encode",
		},
		outputPath,
	);
	const metrics: NativeVideoAudioMuxMetrics = {};

	try {
		const ffmpegExecStartedAt = getNowMs();
		await execFileAsync(ffmpegPath, args, {
			timeout: 15 * 60 * 1000,
			maxBuffer: 20 * 1024 * 1024,
		});
		metrics.ffmpegExecMs = getNowMs() - ffmpegExecStartedAt;
		return {
			outputPath,
			encoderName,
			metrics,
		};
	} catch (error) {
		await removeTemporaryExportFile(outputPath);
		throw error;
	}
}

export async function muxNativeVideoExportAudio(
	videoPath: string,
	options: NativeVideoExportFinishOptions,
) {
	const audioMode = options.audioMode ?? "none";
	if (audioMode === "none") {
		return {
			outputPath: videoPath,
			metrics: {} as NativeVideoAudioMuxMetrics,
		};
	}

	const ffmpegPath = getFfmpegBinaryPath();
	const metrics: NativeVideoAudioMuxMetrics = {};
	const tempArtifacts: string[] = [];
	let audioInputPath = options.audioSourcePath ?? null;
	const useEditedTrackFiltergraph =
		audioMode === "edited-track" && options.editedTrackStrategy === "filtergraph-fast-path";

	if (audioMode === "edited-track" && !useEditedTrackFiltergraph) {
		if (!options.editedAudioData) {
			throw new Error("Edited audio data is missing for native export");
		}

		const extension = getEditedAudioExtension(options.editedAudioMimeType);
		audioInputPath = path.join(
			app.getPath("temp"),
			`recordly-export-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`,
		);
		const tempAudioWriteStartedAt = getNowMs();
		await fs.writeFile(audioInputPath, Buffer.from(options.editedAudioData));
		metrics.tempEditedAudioWriteMs = getNowMs() - tempAudioWriteStartedAt;
		metrics.tempEditedAudioBytes = options.editedAudioData.byteLength;
		tempArtifacts.push(audioInputPath);
	}

	if (!audioInputPath) {
		return {
			outputPath: videoPath,
			metrics,
		};
	}

	const outputPath = path.join(
		path.dirname(videoPath),
		`${path.basename(videoPath, path.extname(videoPath))}-final.mp4`,
	);

	const args = [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-i",
		videoPath,
		"-i",
		audioInputPath,
	];

	if (audioMode === "trim-source") {
		const filter = buildTrimmedSourceAudioFilter(options.trimSegments ?? []);
		if (filter) {
			args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]");
		} else {
			args.push("-map", "0:v:0", "-map", "1:a:0");
		}
	} else if (useEditedTrackFiltergraph) {
		const filter = buildEditedTrackSourceAudioFilter(
			options.editedTrackSegments ?? [],
			options.audioSourceSampleRate ?? 0,
		);
		if (!filter) {
			throw new Error("Edited-track filtergraph inputs are incomplete for native export");
		}
		args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[aout]");
	} else {
		args.push("-map", "0:v:0", "-map", "1:a:0");
	}

	args.push(
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-shortest",
		"-movflags",
		"+faststart",
		outputPath,
	);

	try {
		const ffmpegExecStartedAt = getNowMs();
		await execFileAsync(ffmpegPath, args, {
			timeout: 15 * 60 * 1000,
			maxBuffer: 20 * 1024 * 1024,
		});
		metrics.ffmpegExecMs = getNowMs() - ffmpegExecStartedAt;
		await removeTemporaryExportFile(videoPath);
		return {
			outputPath,
			metrics,
		};
	} finally {
		await Promise.allSettled(
			tempArtifacts.map((artifactPath) => removeTemporaryExportFile(artifactPath)),
		);
	}
}

export async function muxExportedVideoAudioBuffer(
	videoData: ArrayBuffer,
	options: NativeVideoExportFinishOptions,
) {
	const tempVideoPath = path.join(
		app.getPath("temp"),
		`recordly-export-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
	);
	const metrics: NativeVideoAudioMuxMetrics = {};

	try {
		const tempVideoWriteStartedAt = getNowMs();
		await fs.writeFile(tempVideoPath, Buffer.from(videoData));
		metrics.tempVideoWriteMs = getNowMs() - tempVideoWriteStartedAt;
		metrics.tempVideoBytes = videoData.byteLength;
		const finalized = await muxNativeVideoExportAudio(tempVideoPath, options);
		Object.assign(metrics, finalized.metrics);
		const muxedVideoReadStartedAt = getNowMs();
		const muxedData = await fs.readFile(finalized.outputPath);
		metrics.muxedVideoReadMs = getNowMs() - muxedVideoReadStartedAt;
		metrics.muxedVideoBytes = muxedData.byteLength;
		return {
			data: new Uint8Array(muxedData),
			metrics,
		};
	} finally {
		await Promise.allSettled([
			removeTemporaryExportFile(tempVideoPath),
			removeTemporaryExportFile(
				path.join(
					path.dirname(tempVideoPath),
					`${path.basename(tempVideoPath, path.extname(tempVideoPath))}-final.mp4`,
				),
			),
		]);
	}
}
