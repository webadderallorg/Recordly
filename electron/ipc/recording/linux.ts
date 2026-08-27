import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getLinuxWindowSystem, LINUX_PORTAL_SCREEN_SOURCE_ID } from "../register/sourceMapping";
import type { NativeMacRecordingOptions, SelectedSource } from "../types";
import { getRecordingsDir, moveFileWithOverwrite } from "../utils";
import { recordNativeCaptureDiagnostics } from "./diagnostics";
import { buildFfmpegCaptureArgs } from "./ffmpeg";
import { finalizeStoredVideo } from "./mac";

/**
 * Native Linux (X11) screen recording backend.
 *
 * Chromium's desktop capturer composites the X11 cursor into every frame and
 * ignores `googCaptureCursor` / `cursor: "never"` on Linux, which leaves the
 * editor unable to draw its own cursor overlay without showing two cursors.
 * FFmpeg's x11grab can capture the framebuffer with `-draw_mouse 0`, so on X11
 * we record through FFmpeg instead, mirroring the Windows/macOS native paths.
 *
 * FFmpeg cannot pause, so pause/resume is implemented with segments: pausing
 * stops the current FFmpeg process and resuming starts a new one. The segments
 * are stream-copied together when the recording stops. Microphone audio is
 * recorded by the renderer (browser microphone fallback sidecar), exactly like
 * the Windows path does by default.
 */

const LINUX_NATIVE_BACKEND = "linux-x11grab" as const;
const SEGMENT_START_TIMEOUT_MS = 4000;
const SEGMENT_STOP_TIMEOUT_MS = 8000;
const MAX_PROCESS_OUTPUT_CHARS = 8000;

type LinuxCaptureSegment = {
	path: string;
	startedAtMs: number;
	endedAtMs: number | null;
	process: ChildProcessWithoutNullStreams | null;
	output: string;
	firstFrameSeen: boolean;
};

type LinuxCaptureSession = {
	source: SelectedSource;
	ffmpegPath: string;
	tempDir: string;
	finalPath: string;
	segments: LinuxCaptureSegment[];
	paused: boolean;
	stopping: boolean;
};

let session: LinuxCaptureSession | null = null;

export function isLinuxNativeCaptureActive(): boolean {
	return session !== null;
}

export function isLinuxNativeCapturePaused(): boolean {
	return session?.paused ?? false;
}

export function isNativeLinuxCaptureSupportedSource(
	source: Pick<SelectedSource, "id"> | null | undefined,
): boolean {
	const id = typeof source?.id === "string" ? source.id : "";
	if (
		id === LINUX_PORTAL_SCREEN_SOURCE_ID ||
		id.startsWith("screen:fallback:") ||
		id.startsWith("window:fallback:")
	) {
		return false;
	}
	return id.startsWith("screen:") || id.startsWith("window:");
}

export function getNativeLinuxCaptureAvailability({
	env = process.env,
	platform = process.platform,
	ffmpegPath,
}: {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform | string;
	ffmpegPath: string | null;
}): { available: boolean; reason?: string } {
	if (platform !== "linux") {
		return { available: false, reason: "Native Linux capture requires Linux." };
	}
	if (getLinuxWindowSystem(env, platform) !== "x11") {
		return {
			available: false,
			reason: "Native Linux capture requires an X11 session (Wayland uses the portal).",
		};
	}
	if (!ffmpegPath) {
		return { available: false, reason: "FFmpeg is not available." };
	}
	return { available: true };
}

function resolveFfmpegPathOrNull(): string | null {
	try {
		const resolved = getFfmpegBinaryPath();
		return existsSync(resolved) ? resolved : null;
	} catch {
		return null;
	}
}

export async function isNativeLinuxCaptureAvailable(): Promise<boolean> {
	return getNativeLinuxCaptureAvailability({ ffmpegPath: resolveFfmpegPathOrNull() }).available;
}

/**
 * Inserts the progress reporting flags FFmpeg needs so we can detect the first
 * captured frame instead of guessing with a fixed delay.
 */
export function withProgressReporting(args: string[]): string[] {
	const [first, ...rest] = args;
	const progressArgs = ["-progress", "pipe:1", "-stats_period", "0.05", "-nostats"];
	return first === "-y" ? ["-y", ...progressArgs, ...rest] : [...progressArgs, ...args];
}

export function parseFfmpegProgressFrame(chunk: string): number | null {
	let latest: number | null = null;
	for (const line of chunk.split(/\r?\n/)) {
		const match = line.match(/^frame=\s*(\d+)/);
		if (match) {
			latest = Number(match[1]);
		}
	}
	return latest;
}

export function selectSegmentPathsForConcat(
	segments: ReadonlyArray<Pick<LinuxCaptureSegment, "path" | "firstFrameSeen">>,
): string[] {
	const withFrames = segments.filter((segment) => segment.firstFrameSeen);
	const chosen = withFrames.length > 0 ? withFrames : segments.slice(-1);
	return chosen.map((segment) => segment.path);
}

export function buildConcatListContent(segmentPaths: ReadonlyArray<string>): string {
	return `${segmentPaths
		.map((segmentPath) => `file '${segmentPath.split("'").join("'\\''")}'`)
		.join("\n")}\n`;
}

function appendOutput(segment: LinuxCaptureSegment, chunk: string) {
	segment.output = (segment.output + chunk).slice(-MAX_PROCESS_OUTPUT_CHARS);
}

function collectSessionOutput(current: LinuxCaptureSession): string | undefined {
	const output = current.segments
		.map((segment) => segment.output.trim())
		.filter(Boolean)
		.join("\n---\n");
	return output || undefined;
}

function waitForSegmentStart(segment: LinuxCaptureSegment): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = segment.process;
		if (!proc) {
			reject(new Error("FFmpeg process is not running"));
			return;
		}

		const onStdout = (chunk: Buffer) => {
			const frame = parseFfmpegProgressFrame(chunk.toString());
			if (frame !== null && frame >= 1) {
				segment.firstFrameSeen = true;
				// Align the segment start with the first captured frame rather
				// than process spawn time.
				segment.startedAtMs = Date.now();
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
					segment.output.trim() ||
						`FFmpeg exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(
				new Error(
					segment.output.trim() || "FFmpeg did not report any captured frames in time",
				),
			);
		}, SEGMENT_START_TIMEOUT_MS);
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

function waitForSegmentStop(segment: LinuxCaptureSegment): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = segment.process;
		if (!proc || proc.exitCode !== null) {
			resolve();
			return;
		}

		const onClose = (code: number | null) => {
			cleanup();
			if (code === 0 || code === null || segment.output.includes("Exiting normally")) {
				resolve();
				return;
			}
			reject(new Error(segment.output.trim() || `FFmpeg exited with code ${code}`));
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const timer = setTimeout(() => {
			try {
				proc.kill("SIGINT");
			} catch {
				// ignore
			}
			setTimeout(() => {
				try {
					proc.kill("SIGKILL");
				} catch {
					// ignore
				}
			}, 1500).unref();
		}, SEGMENT_STOP_TIMEOUT_MS);
		const cleanup = () => {
			clearTimeout(timer);
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		proc.once("close", onClose);
		proc.once("error", onError);
		try {
			proc.stdin.write("q\n");
		} catch {
			try {
				proc.kill("SIGINT");
			} catch {
				// ignore
			}
		}
	});
}

async function startSegment(current: LinuxCaptureSession): Promise<void> {
	const index = current.segments.length;
	const segmentPath = path.join(current.tempDir, `segment-${String(index).padStart(3, "0")}.mp4`);
	const args = withProgressReporting(await buildFfmpegCaptureArgs(current.source, segmentPath));
	const proc = spawn(current.ffmpegPath, args, {
		cwd: current.tempDir,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const segment: LinuxCaptureSegment = {
		path: segmentPath,
		startedAtMs: Date.now(),
		endedAtMs: null,
		process: proc,
		output: "",
		firstFrameSeen: false,
	};
	proc.stdout.on("data", (chunk: Buffer) => appendOutput(segment, chunk.toString()));
	proc.stderr.on("data", (chunk: Buffer) => appendOutput(segment, chunk.toString()));
	proc.once("close", () => {
		segment.endedAtMs = segment.endedAtMs ?? Date.now();
		segment.process = null;
	});
	current.segments.push(segment);

	try {
		await waitForSegmentStart(segment);
	} catch (error) {
		try {
			proc.kill("SIGKILL");
		} catch {
			// ignore
		}
		throw error;
	}
}

async function stopCurrentSegment(current: LinuxCaptureSession): Promise<void> {
	const segment = current.segments[current.segments.length - 1];
	if (!segment || !segment.process) {
		return;
	}
	await waitForSegmentStop(segment);
	segment.endedAtMs = segment.endedAtMs ?? Date.now();
	segment.process = null;
}

async function killAllSegments(current: LinuxCaptureSession) {
	for (const segment of current.segments) {
		if (segment.process) {
			try {
				segment.process.kill("SIGKILL");
			} catch {
				// ignore
			}
			segment.process = null;
		}
	}
}

async function removeTempDir(tempDir: string) {
	try {
		await fs.rm(tempDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup failures
	}
}

async function concatSegments(current: LinuxCaptureSession, segmentPaths: string[]) {
	const listPath = path.join(current.tempDir, "segments.txt");
	await fs.writeFile(listPath, buildConcatListContent(segmentPaths), "utf8");
	const concatPath = path.join(current.tempDir, "concat.mp4");
	await new Promise<void>((resolve, reject) => {
		const proc = spawn(
			current.ffmpegPath,
			[
				"-y",
				"-nostdin",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				listPath,
				"-c",
				"copy",
				"-movflags",
				"+faststart",
				concatPath,
			],
			{ cwd: current.tempDir, stdio: ["ignore", "pipe", "pipe"] },
		);
		let output = "";
		proc.stdout.on("data", (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-MAX_PROCESS_OUTPUT_CHARS);
		});
		proc.stderr.on("data", (chunk: Buffer) => {
			output = (output + chunk.toString()).slice(-MAX_PROCESS_OUTPUT_CHARS);
		});
		proc.once("error", reject);
		proc.once("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(
					new Error(
						output.trim() || `FFmpeg concat exited with code ${code ?? "unknown"}`,
					),
				);
			}
		});
	});
	return concatPath;
}

export async function startLinuxNativeRecording(
	source: SelectedSource,
	options?: NativeMacRecordingOptions,
): Promise<{
	success: boolean;
	message?: string;
	error?: string;
	microphoneFallbackRequired?: boolean;
}> {
	if (session) {
		return { success: false, message: "A native Linux screen recording is already active." };
	}

	const ffmpegPath = resolveFfmpegPathOrNull();
	const availability = getNativeLinuxCaptureAvailability({ ffmpegPath });
	if (!availability.available || !ffmpegPath) {
		return {
			success: false,
			message: availability.reason ?? "Native Linux capture is unavailable.",
		};
	}
	if (!isNativeLinuxCaptureSupportedSource(source)) {
		return {
			success: false,
			message: "Selected source cannot be captured natively on Linux.",
		};
	}
	if (options?.capturesSystemAudio) {
		return {
			success: false,
			message: "Native Linux capture does not support system audio yet.",
		};
	}

	const timestamp = Date.now();
	const recordingsDir = await getRecordingsDir();
	const tempDir = path.join(app.getPath("temp"), `recordly-linux-${timestamp}`);
	await fs.mkdir(tempDir, { recursive: true });

	const created: LinuxCaptureSession = {
		source,
		ffmpegPath,
		tempDir,
		finalPath: path.join(recordingsDir, `recording-${timestamp}.mp4`),
		segments: [],
		paused: Boolean(options?.warmStart),
		stopping: false,
	};
	session = created;

	try {
		// Warm starts (countdown pending) begin paused: the first segment is
		// only spawned on resume so no pre-countdown frames are recorded.
		if (!created.paused) {
			await startSegment(created);
		}
		recordNativeCaptureDiagnostics({
			backend: LINUX_NATIVE_BACKEND,
			phase: "start",
			sourceId: source?.id ?? null,
			sourceType: source?.sourceType ?? "unknown",
			helperPath: ffmpegPath,
			outputPath: created.finalPath,
			supported: true,
		});
		return {
			success: true,
			microphoneFallbackRequired: Boolean(options?.capturesMicrophone),
		};
	} catch (error) {
		await killAllSegments(created);
		session = null;
		await removeTempDir(tempDir);
		const message = error instanceof Error ? error.message : String(error);
		recordNativeCaptureDiagnostics({
			backend: LINUX_NATIVE_BACKEND,
			phase: "start",
			sourceId: source?.id ?? null,
			sourceType: source?.sourceType ?? "unknown",
			helperPath: ffmpegPath,
			outputPath: created.finalPath,
			supported: true,
			processOutput: collectSessionOutput(created),
			error: message,
		});
		console.error("Failed to start native Linux capture:", error);
		return {
			success: false,
			message: "Failed to start native Linux capture",
			error: message,
		};
	}
}

export async function pauseLinuxNativeRecording(): Promise<{
	success: boolean;
	message?: string;
	error?: string;
}> {
	const current = session;
	if (!current) {
		return { success: false, message: "No native Linux screen recording is active." };
	}
	if (current.paused) {
		return { success: true };
	}
	try {
		await stopCurrentSegment(current);
		current.paused = true;
		return { success: true };
	} catch (error) {
		return {
			success: false,
			message: "Failed to pause native Linux capture",
			error: String(error),
		};
	}
}

export async function resumeLinuxNativeRecording(): Promise<{
	success: boolean;
	message?: string;
	error?: string;
}> {
	const current = session;
	if (!current) {
		return { success: false, message: "No native Linux screen recording is active." };
	}
	if (!current.paused) {
		return { success: true };
	}
	try {
		await startSegment(current);
		current.paused = false;
		return { success: true };
	} catch (error) {
		return {
			success: false,
			message: "Failed to resume native Linux capture",
			error: String(error),
		};
	}
}

export async function stopLinuxNativeRecording(): Promise<{
	success: boolean;
	path?: string;
	message?: string;
	error?: string;
}> {
	const current = session;
	if (!current) {
		return { success: false, message: "No native Linux screen recording is active." };
	}
	if (current.stopping) {
		return { success: false, message: "Native Linux capture is already stopping." };
	}
	current.stopping = true;

	try {
		await stopCurrentSegment(current);
		const segmentPaths = selectSegmentPathsForConcat(current.segments);
		if (segmentPaths.length === 0) {
			throw new Error("No video was captured");
		}

		const assembled =
			segmentPaths.length === 1
				? segmentPaths[0]
				: await concatSegments(current, segmentPaths);
		await moveFileWithOverwrite(assembled, current.finalPath);
		session = null;
		await removeTempDir(current.tempDir);

		recordNativeCaptureDiagnostics({
			backend: LINUX_NATIVE_BACKEND,
			phase: "stop",
			sourceId: current.source?.id ?? null,
			sourceType: current.source?.sourceType ?? "unknown",
			helperPath: current.ffmpegPath,
			outputPath: current.finalPath,
			supported: true,
			processOutput: collectSessionOutput(current),
		});
		return await finalizeStoredVideo(current.finalPath);
	} catch (error) {
		await killAllSegments(current);
		session = null;
		const message = error instanceof Error ? error.message : String(error);
		recordNativeCaptureDiagnostics({
			backend: LINUX_NATIVE_BACKEND,
			phase: "stop",
			sourceId: current.source?.id ?? null,
			sourceType: current.source?.sourceType ?? "unknown",
			helperPath: current.ffmpegPath,
			outputPath: current.finalPath,
			supported: true,
			processOutput: collectSessionOutput(current),
			error: message,
		});
		console.error("Failed to stop native Linux capture:", error);
		await removeTempDir(current.tempDir);
		return {
			success: false,
			message: "Failed to stop native Linux capture",
			error: message,
		};
	}
}

/** Kills any in-flight FFmpeg capture (app quit / cancelled start). */
export async function discardLinuxNativeRecording(): Promise<void> {
	const current = session;
	if (!current) {
		return;
	}
	session = null;
	await killAllSegments(current);
	await removeTempDir(current.tempDir);
}
