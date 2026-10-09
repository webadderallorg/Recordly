import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { BrowserWindow } from "electron";
import {
	linuxCaptureOutputBuffer,
	linuxCaptureStopRequested,
	linuxNativeCaptureActive,
	selectedSource,
	setLinuxCaptureProcess,
	setLinuxCaptureStopRequested,
	setLinuxNativeCaptureActive,
} from "../state";
import { isX11CaptureSession } from "../linuxCaptureSelection";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { emitRecordingInterrupted } from "./events";

const execFileAsync = promisify(execFile);

const LINUX_CAPTURE_STOP_TIMEOUT_MS = 30_000;

let ffmpegCapabilitiesProbe: Promise<{
	x11grab: boolean;
	libx264: boolean;
}> | null = null;

export function resetLinuxCaptureCapabilitiesProbe() {
	ffmpegCapabilitiesProbe = null;
}

/**
 * Segment files share encoder settings, so they can be joined losslessly with
 * the concat demuxer + stream copy (no re-encode).
 */
export function buildLinuxConcatListContent(segmentPaths: string[]): string {
	return segmentPaths
		.map((segmentPath) => `file '${segmentPath.replace(/'/g, "'\\''")}'`)
		.join("\n");
}

export async function stitchLinuxSegments(
	ffmpegPath: string,
	segmentPaths: string[],
	outputPath: string,
) {
	if (segmentPaths.length < 2) {
		throw new Error("Segment stitching requires at least two segments");
	}

	const listPath = `${outputPath}.concat.txt`;
	await fs.writeFile(listPath, `${buildLinuxConcatListContent(segmentPaths)}\n`);
	try {
		await execFileAsync(
			ffmpegPath,
			[
				"-y",
				"-hide_banner",
				"-nostdin",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				listPath,
				"-c",
				"copy",
				outputPath,
			],
			{ timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
		);
	} finally {
		await fs.rm(listPath, { force: true }).catch(() => undefined);
	}
}

function probeFfmpegCapabilities(ffmpegPath: string) {
	if (!ffmpegCapabilitiesProbe) {
		ffmpegCapabilitiesProbe = (async () => {
			const [devices, encoders] = await Promise.all([
				execFileAsync(ffmpegPath, ["-hide_banner", "-devices"], {
					timeout: 10_000,
					maxBuffer: 1024 * 1024,
				}),
				execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
					timeout: 10_000,
					maxBuffer: 2 * 1024 * 1024,
				}),
			]);
			return {
				x11grab: /\bx11grab\b/.test(devices.stdout),
				libx264: /\blibx264\b/.test(encoders.stdout),
			};
		})().catch((error) => {
			resetLinuxCaptureCapabilitiesProbe();
			throw error;
		});
	}
	return ffmpegCapabilitiesProbe;
}

export type LinuxCaptureUnavailableReason =
	| "not-linux"
	| "wayland-session"
	| "no-x11-display"
	| "no-ffmpeg-binary"
	| "no-x11grab"
	| "no-libx264"
	| "probe-failed";

export type LinuxCaptureAvailability = {
	available: boolean;
	reason?: LinuxCaptureUnavailableReason;
};

export function describeLinuxCaptureUnavailableReason(
	reason: LinuxCaptureUnavailableReason | undefined,
): string {
	switch (reason) {
		case "wayland-session":
			return "Native Linux capture needs an X11 session, but this session is running Wayland.";
		case "no-x11-display":
			return "Native Linux capture could not find an X11 display to record.";
		case "no-ffmpeg-binary":
			return "Native Linux capture needs an ffmpeg binary, but none was found.";
		case "no-x11grab":
			return "The installed ffmpeg build does not support x11grab screen capture.";
		case "no-libx264":
			return "The installed ffmpeg build does not support the required H.264 encoder.";
		case "probe-failed":
			return "Native Linux capture could not be verified because the ffmpeg probe failed.";
		case "not-linux":
			return "Native Linux capture is only available on Linux.";
		default:
			return "Native Linux capture is not available on this system.";
	}
}

export async function probeNativeLinuxCaptureAvailability(): Promise<LinuxCaptureAvailability> {
	if (process.platform !== "linux") {
		return { available: false, reason: "not-linux" };
	}
	if (
		process.env.XDG_SESSION_TYPE === "wayland" ||
		(process.env.WAYLAND_DISPLAY && process.env.WAYLAND_DISPLAY.trim().length > 0)
	) {
		return { available: false, reason: "wayland-session" };
	}
	if (!isX11CaptureSession(process.env)) {
		return { available: false, reason: "no-x11-display" };
	}

	let ffmpegPath: string;
	try {
		ffmpegPath = getFfmpegBinaryPath();
	} catch {
		return { available: false, reason: "no-ffmpeg-binary" };
	}

	try {
		const capabilities = await probeFfmpegCapabilities(ffmpegPath);
		if (!capabilities.x11grab) {
			return { available: false, reason: "no-x11grab" };
		}
		if (!capabilities.libx264) {
			return { available: false, reason: "no-libx264" };
		}
		return { available: true };
	} catch (error) {
		console.warn("Failed to probe ffmpeg capabilities for native Linux capture:", error);
		return { available: false, reason: "probe-failed" };
	}
}

export function waitForLinuxCaptureStart(proc: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					linuxCaptureOutputBuffer.trim() ||
						`Native Linux capture exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		// x11grab signals readiness by streaming progress lines to stderr; ffmpeg
		// prints nothing deterministic on success, so a short quiescence window is
		// the same readiness heuristic the shared ffmpeg capture path uses.
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, 900);

		const cleanup = () => {
			clearTimeout(timer);
			proc.off("error", onError);
			proc.off("exit", onExit);
		};

		proc.once("error", onError);
		proc.once("exit", onExit);
	});
}

export function waitForLinuxCaptureStop(
	proc: ChildProcessWithoutNullStreams,
	outputPath: string,
	timeoutMs = LINUX_CAPTURE_STOP_TIMEOUT_MS,
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
				reject(new Error("Timed out waiting for native Linux capture to stop"));
			});
		}, timeoutMs);

		const onClose = (code: number | null) => {
			finish(async () => {
				try {
					await fs.access(outputPath);
					if (
						code === 0 ||
						code === null ||
						linuxCaptureOutputBuffer.includes("Exiting normally")
					) {
						resolve(outputPath);
						return;
					}
				} catch {
					// Output file missing — reject with the buffered output below.
				}
				reject(
					new Error(
						linuxCaptureOutputBuffer.trim() ||
							`Native Linux capture exited with code ${code ?? "unknown"}`,
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

export function attachLinuxCaptureLifecycle(proc: ChildProcessWithoutNullStreams) {
	proc.once("close", () => {
		const wasActive = linuxNativeCaptureActive;
		setLinuxCaptureProcess(null);

		if (!wasActive || linuxCaptureStopRequested) {
			return;
		}

		setLinuxNativeCaptureActive(false);
		setLinuxCaptureStopRequested(false);

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
