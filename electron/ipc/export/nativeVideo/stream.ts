import fs from "node:fs/promises";
import { type WebContents } from "electron";
import { type NativeVideoExportSession } from "./types";

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

export async function enqueueNativeVideoExportFrameWrites(
	session: NativeVideoExportSession,
	frameDataList: Array<Uint8Array | ArrayBuffer>,
) {
	const writePromise = session.writeSequence.then(async () => {
		if (session.terminating) {
			throw new Error("Native video export session was cancelled");
		}

		for (const frameData of frameDataList) {
			await writeNativeVideoExportFrame(session, frameData);
		}
	});

	session.writeSequence = writePromise.catch(() => undefined);
	await writePromise;
}
