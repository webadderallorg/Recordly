import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	shell,
	systemPreferences,
} from "electron";
import { getHudCaptureExcludedProcessIds } from "../../../src/lib/hudCaptureProtection";
import { showCursor } from "../../cursorHider";
import { getHudOverlayCaptureProtectionEnabled, beginHudCaptureProtection } from "../../windows";
import { ALLOW_RECORDLY_WINDOW_CAPTURE } from "../constants";
import { startWindowBoundsCapture, stopWindowBoundsCapture } from "../cursor/bounds";
import { startInteractionCapture, stopInteractionCapture } from "../cursor/interaction";
import { startNativeCursorMonitor, stopNativeCursorMonitor } from "../cursor/monitor";
import {
	isCursorCapturePaused,
	normalizeCursorTelemetrySamples,
	pauseCursorCaptureAtBoundary,
	persistPendingCursorTelemetry,
	resetCursorCaptureClock,
	resumeCursorCapture,
	sampleCursorPoint,
	snapshotCursorTelemetryForPersistence,
	startCursorSampling,
	stopCursorCapture,
	writeCursorTelemetry,
} from "../cursor/telemetry";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getMonitorHandles } from "../monitorResolver";
import {
	shouldUseNativeLinuxCaptureForSource,
} from "../linuxCaptureSelection";
import {
	ensureNativeCaptureHelperBinary,
	ensureSwiftHelperBinary,
	getNativeCaptureHelperBinaryPath,
	getSystemCursorHelperBinaryPath,
	getSystemCursorHelperSourcePath,
	getWindowsCaptureExePath,
} from "../paths/binaries";
import { rememberApprovedLocalReadPath } from "../project/manager";
import {
	getBrowserMicSidecarFilters,
	shouldKeepRecordingAudioSidecars,
} from "../recording/audioFilters";
import {
	getCompanionAudioFallbackInfo,
	getFileSizeIfPresent,
	type MicrophoneChunkTimingEvent,
	type MicrophonePauseInterval,
	type RecordingDiagnosticsSnapshot,
	recordNativeCaptureDiagnostics,
	summarizeMicrophoneChunkTiming,
	validateRecordedVideo,
	writeRecordingDiagnosticsSnapshot,
} from "../recording/diagnostics";
import {
	buildFfmpegCaptureArgs,
	waitForFfmpegCaptureStart,
	waitForFfmpegCaptureStop,
} from "../recording/ffmpeg";
import {
	attachNativeCaptureLifecycle,
	finalizeStoredVideo,
	muxNativeMacRecordingWithAudio,
	recoverNativeMacCaptureOutput,
	waitForNativeCaptureCommand,
	waitForNativeCaptureStart,
	waitForNativeCaptureStop,
} from "../recording/mac";
import {
	attachLinuxCaptureLifecycle,
	describeLinuxCaptureUnavailableReason,
	probeNativeLinuxCaptureAvailability,
	stitchLinuxSegments,
	waitForLinuxCaptureStart,
	waitForLinuxCaptureStop,
} from "../recording/linux";
import { getSourcePickerVisibilityForPlatform } from "../linuxPortal";
import { getLinuxVaapiCapture } from "../recording/linuxVaapi";
import { getLinuxNvencCapture } from "../recording/linuxNvenc";
import {
	type LinuxSystemAudioUnavailableReason,
	getLinuxSystemAudioCapture,
	spawnLinuxSystemAudioSegment,
	stopLinuxSystemAudioSegment,
	waitForLinuxSystemAudioSegmentStart,
} from "../recording/linuxSystemAudio";
import { resolveRecordedVideoStoragePath } from "../recording/storagePath";
import {
	attachWindowsCaptureLifecycle,
	isNativeWindowsCaptureAvailable,
	muxNativeWindowsVideoWithAudio,
	waitForWindowsCaptureStart,
	waitForWindowsCaptureStop,
} from "../recording/windows";
import {
	shouldStartWindowsBrowserMicrophoneFallback,
	shouldUseWindowsBrowserMicrophoneFallback,
} from "../recording/windowsFallbacks";
import {
	cachedSystemCursorAssets,
	cachedSystemCursorAssetsSourceMtimeMs,
	currentVideoPath,
	ffmpegCaptureOutputBuffer,
	ffmpegCaptureProcess,
	ffmpegCaptureTargetPath,
	ffmpegScreenRecordingActive,
	activeCursorSamples,
	lastNativeCaptureDiagnostics,
	linuxCaptureOutputBuffer,
	linuxCaptureVaapi,
	linuxCaptureNvenc,
	isCursorCaptureActive,
	pendingCursorSamples,
	cursorCaptureStartTimeMs,
	linuxCapturePaused,
	linuxCaptureProcess,
	linuxCaptureSegmentPath,
	linuxCaptureSegments,
	linuxCaptureTargetPath,
	linuxNativeCaptureActive,
	linuxSystemAudioProcess,
	linuxSystemAudioFfmpegPath,
	linuxSystemAudioSegmentPath,
	linuxSystemAudioSegments,
	linuxSystemAudioSourceName,
	nativeCaptureMicrophonePath,
	nativeCaptureOutputBuffer,
	nativeCapturePaused,
	nativeCaptureProcess,
	nativeCaptureSystemAudioPath,
	nativeCaptureTargetPath,
	nativeScreenRecordingActive,
	selectedSource,
	setActiveCursorSamples,
	setCachedSystemCursorAssets,
	setCachedSystemCursorAssetsSourceMtimeMs,
	setCursorCaptureStartTimeMs,
	setFfmpegCaptureOutputBuffer,
	setFfmpegCaptureProcess,
	setFfmpegCaptureTargetPath,
	setFfmpegScreenRecordingActive,
	setIsCursorCaptureActive,
	setLastLeftClick,
	setLinuxCaptureOutputBuffer,
	setLinuxCaptureVaapi,
	setLinuxCaptureNvenc,
	setLinuxCapturePaused,
	setLinuxCaptureProcess,
	setLinuxCaptureSegmentPath,
	setLinuxCaptureSegments,
	setLinuxCaptureStopRequested,
	setLinuxCaptureTargetPath,
	setLinuxNativeCaptureActive,
	setLinuxCursorScreenPoint,
	setLinuxSystemAudioProcess,
	setLinuxSystemAudioFfmpegPath,
	setLinuxSystemAudioSegmentPath,
	setLinuxSystemAudioSegments,
	setLinuxSystemAudioSourceName,
	setNativeCaptureMicrophonePath,
	setNativeCaptureOutputBuffer,
	setNativeCapturePaused,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
	setPendingCursorSamples,
	setWindowsCaptureOutputBuffer,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsOrphanedMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCaptureOutputBuffer,
	windowsCapturePaused,
	windowsCaptureProcess,
	windowsCaptureTargetPath,
	windowsMicAudioPath,
	windowsNativeCaptureActive,
	windowsOrphanedMicAudioPath,
	windowsPendingVideoPath,
	windowsSystemAudioPath,
} from "../state";
import type { CursorTelemetryPoint, NativeMacRecordingOptions, SelectedSource } from "../types";
import {
	getMacPrivacySettingsUrl,
	getRecordingsDir,
	getScreen,
	getTelemetryPathForVideo,
	moveFileWithOverwrite,
	normalizeVideoSourcePath,
	parseJsonWithByteOrderMark,
	parseWindowId,
} from "../utils";
import { resolveWindowsCaptureTarget } from "../windowsCaptureSelection";
import { bringSelectedWindowForward } from "./sources";

const execFileAsync = promisify(execFile);

async function writeWindowsRecordingDiagnostics(
	videoPath: string | null | undefined,
	snapshot: Omit<RecordingDiagnosticsSnapshot, "backend">,
) {
	if (!videoPath) {
		return null;
	}

	try {
		return await writeRecordingDiagnosticsSnapshot(videoPath, {
			backend: "windows-wgc",
			...snapshot,
		});
	} catch (error) {
		console.warn("Failed to write Windows recording diagnostics:", error);
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickPrimitiveRecord(value: unknown) {
	if (!isRecord(value)) {
		return null;
	}

	const entries = Object.entries(value).filter(
		(entry): entry is [string, boolean | number | string] => {
			const primitive = entry[1];
			return (
				typeof primitive === "boolean" ||
				typeof primitive === "number" ||
				typeof primitive === "string"
			);
		},
	);

	return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeRendererTimestampMs(value: unknown) {
	const nowMs = Date.now();
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return nowMs;
	}

	return Math.min(Math.max(0, Math.round(value)), nowMs);
}

function pickMicrophoneChunkEvents(value: unknown): MicrophoneChunkTimingEvent[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const events = value
		.map((event) => {
			if (!isRecord(event)) {
				return null;
			}

			const { index, size, elapsedMs, deltaMs, recordedElapsedMs, recordedDeltaMs } = event;
			if (
				typeof index !== "number" ||
				!Number.isFinite(index) ||
				index < 0 ||
				typeof size !== "number" ||
				!Number.isFinite(size) ||
				size < 0 ||
				typeof elapsedMs !== "number" ||
				!Number.isFinite(elapsedMs) ||
				elapsedMs < 0
			) {
				return null;
			}

			return {
				index: Math.round(index),
				size: Math.round(size),
				elapsedMs: Math.round(elapsedMs),
				deltaMs:
					typeof deltaMs === "number" && Number.isFinite(deltaMs)
						? Math.max(0, Math.round(deltaMs))
						: null,
				...(typeof recordedElapsedMs === "number" &&
				Number.isFinite(recordedElapsedMs) &&
				recordedElapsedMs >= 0
					? { recordedElapsedMs: Math.round(recordedElapsedMs) }
					: {}),
				recordedDeltaMs:
					typeof recordedDeltaMs === "number" && Number.isFinite(recordedDeltaMs)
						? Math.max(0, Math.round(recordedDeltaMs))
						: null,
			};
		})
		.filter((event): event is NonNullable<typeof event> => event !== null);

	return events.length > 0 ? events : null;
}

function pickMicrophonePauseIntervals(value: unknown): MicrophonePauseInterval[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const intervals = value
		.map((interval) => {
			if (
				!isRecord(interval) ||
				typeof interval.startElapsedMs !== "number" ||
				!Number.isFinite(interval.startElapsedMs) ||
				interval.startElapsedMs < 0
			) {
				return null;
			}

			const startElapsedMs = Math.max(0, Math.round(interval.startElapsedMs));
			return {
				startElapsedMs,
				...(typeof interval.endElapsedMs === "number" &&
				Number.isFinite(interval.endElapsedMs) &&
				interval.endElapsedMs >= startElapsedMs
					? { endElapsedMs: Math.round(interval.endElapsedMs) }
					: {}),
				...(typeof interval.durationMs === "number" &&
				Number.isFinite(interval.durationMs) &&
				interval.durationMs >= 0
					? { durationMs: Math.round(interval.durationMs) }
					: {}),
			};
		})
		.filter((interval): interval is NonNullable<typeof interval> => interval !== null);

	return intervals.length > 0 ? intervals : null;
}

function pickAudioInputDevices(value: unknown) {
	if (!Array.isArray(value)) {
		return null;
	}

	const devices = value
		.map((device) => {
			if (!isRecord(device) || typeof device.deviceId !== "string") {
				return null;
			}

			return {
				deviceId: device.deviceId,
				...(typeof device.groupId === "string" ? { groupId: device.groupId } : {}),
				label: typeof device.label === "string" ? device.label : "",
			};
		})
		.filter((device): device is NonNullable<typeof device> => device !== null);

	return devices.length > 0 ? devices : null;
}

async function getSystemCursorAssets() {
	if (process.platform !== "darwin") {
		setCachedSystemCursorAssets({});
		setCachedSystemCursorAssetsSourceMtimeMs(null);
		return cachedSystemCursorAssets ?? {};
	}
	const sourcePath = getSystemCursorHelperSourcePath();
	const sourceStat = await fs.stat(sourcePath);
	if (cachedSystemCursorAssets && cachedSystemCursorAssetsSourceMtimeMs === sourceStat.mtimeMs) {
		return cachedSystemCursorAssets;
	}
	const binaryPath = await ensureSwiftHelperBinary(
		sourcePath,
		getSystemCursorHelperBinaryPath(),
		"system cursor helper",
		"recordly-system-cursors",
	);
	const { stdout } = await execFileAsync(binaryPath, [], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	});
	const parsed = JSON.parse(stdout) as Record<
		string,
		Partial<import("../types").SystemCursorAsset>
	>;
	const result = Object.fromEntries(
		Object.entries(parsed).filter(
			([, asset]) =>
				typeof asset?.dataUrl === "string" &&
				typeof asset?.hotspotX === "number" &&
				typeof asset?.hotspotY === "number" &&
				typeof asset?.width === "number" &&
				typeof asset?.height === "number",
		),
	) as Record<string, import("../types").SystemCursorAsset>;
	setCachedSystemCursorAssets(result);
	setCachedSystemCursorAssetsSourceMtimeMs(sourceStat.mtimeMs);
	return result;
}

function normalizeDesktopSourceName(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function cleanupWindowsOrphanedMicAudioPath(filePath: string | null) {
	if (!filePath) {
		return;
	}

	if (shouldKeepRecordingAudioSidecars()) {
		console.log(`[recording] Keeping orphaned native mic sidecar for diagnostics: ${filePath}`);
		return;
	}

	await fs.rm(filePath, { force: true }).catch(() => undefined);
}

async function pathExists(filePath: string | null | undefined) {
	if (!filePath) {
		return false;
	}

	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function resolveExistingPath(...candidates: Array<string | null | undefined>) {
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate ?? null;
		}
	}

	return null;
}

// ── Cursor-clock startup calibration ─────────────────────────────────────────
// ffmpeg needs a moment after launch before x11grab delivers its first frame,
// so the video's true t=0 sits that far after the process spawn; the cursor
// clock is corrected onto it. The primary signal is showinfo's stderr log of
// the first frame entering the filter chain — that is GRAB time. ffmpeg's
// -progress `out_time` deliberately is NOT used as more than a fallback: it
// reports the MUX timeline, and libx264's lookahead/thread pipeline delays
// the first muxed packet ~0.4-1s past the grab, which would bias the whole
// cursor track forward ("cursor ahead") by exactly that encoder delay.

type LinuxCursorStartupCalibration = {
	segmentSpawnMs: number;
	isFirstSegment: boolean;
	calibrated: boolean;
	fallbackTimer: NodeJS.Timeout;
};

let linuxCursorStartupCalibration: LinuxCursorStartupCalibration | null = null;
// stderr line splitter state: chunks can end mid-line, so the trailing
// fragment is carried over to the next chunk before matching.
let linuxCursorStderrTail = "";

function clampCalibrationLagMs(rawLagMs: number) {
	return Math.min(Math.max(Math.round(rawLagMs), 0), 1500);
}

function shiftLinuxCursorSamples(lagMs: number) {
	if (lagMs <= 0) return;
	// Stored positions were computed against the spawn epoch (p = wall - spawn),
	// so each sits `lag` past its true video position (q = p - lag); subtract.
	const shift = (samples: CursorTelemetryPoint[]) =>
		samples.map((sample) => ({ ...sample, timeMs: sample.timeMs - lagMs }));
	setActiveCursorSamples(shift(activeCursorSamples));
	setPendingCursorSamples(shift(pendingCursorSamples));
}

function applyLinuxCursorStartupLag(
	calibration: LinuxCursorStartupCalibration,
	lagMs: number,
) {
	if (calibration.isFirstSegment || !isCursorCapturePaused()) {
		// No pause boundary to lean on: shift the epoch and the samples taken
		// so far so the whole track moves onto the video's true t=0.
		if (lagMs > 0) {
			setCursorCaptureStartTimeMs(cursorCaptureStartTimeMs + lagMs);
			shiftLinuxCursorSamples(lagMs);
		}
		return;
	}
	// The clock is parked at the previous segment's stop; the startup lag
	// belongs to the gap, so resume exactly at this segment's first frame.
	resumeCursorCapture(calibration.segmentSpawnMs + lagMs);
}

/**
 * Applies a freshly measured startup lag: marks the calibration done, cancels
 * the fallback timer, and corrects the cursor clock onto the video timeline.
 */
function finishLinuxCursorStartupCalibration(videoTimeMs: number) {
	const calibration = linuxCursorStartupCalibration;
	if (!calibration || calibration.calibrated) {
		return;
	}
	calibration.calibrated = true;
	clearTimeout(calibration.fallbackTimer);
	const rawLagMs = Date.now() - calibration.segmentSpawnMs - videoTimeMs;
	applyLinuxCursorStartupLag(
		calibration,
		clampCalibrationLagMs(rawLagMs),
	);
}

function calibrateLinuxCursorStartup(chunk: string) {
	const match =
		chunk.match(/out_time_us=(-?\d+)/) ?? chunk.match(/out_time_ms=(-?\d+)/);
	if (!match) {
		return;
	}
	const videoTimeMs = Number(match[1]) / 1000;
	if (Number.isFinite(videoTimeMs) && videoTimeMs >= 0) {
		finishLinuxCursorStartupCalibration(videoTimeMs);
	}
}

/**
 * Input-side calibration from showinfo's per-frame stderr log. Its first
 * `n: 0 pts_time:0` line fires when the first GRABBED frame enters the
 * filter chain — the same timeline the saved file's pts live on — so the
 * measured lag is the true spawn→first-frame delay, free of encoder delay.
 */
function calibrateLinuxCursorStartupFromFilterLog(line: string) {
	const match = line.match(/\bn:\s*\d+ pts:\s*-?\d+ pts_time:(\d+(?:\.\d+)?)/);
	if (!match) {
		return;
	}
	const videoTimeMs = Number.parseFloat(match[1]) * 1000;
	if (Number.isFinite(videoTimeMs) && videoTimeMs >= 0) {
		finishLinuxCursorStartupCalibration(videoTimeMs);
	}
}

function armLinuxCursorStartupCalibration(
	segmentSpawnMs: number,
	isFirstSegment: boolean,
) {
	if (linuxCursorStartupCalibration) {
		clearTimeout(linuxCursorStartupCalibration.fallbackTimer);
	}
	linuxCursorStderrTail = "";
	const calibration: LinuxCursorStartupCalibration = {
		segmentSpawnMs,
		isFirstSegment,
		calibrated: false,
		fallbackTimer: setTimeout(() => {
			if (linuxCursorStartupCalibration !== calibration || calibration.calibrated) {
				return;
			}
			calibration.calibrated = true;
			// -progress never reported; fall back to the spawn-time epoch.
			applyLinuxCursorStartupLag(calibration, 0);
		}, 3000),
	};
	linuxCursorStartupCalibration = calibration;
}

async function startLinuxCaptureSegment(
	source: SelectedSource,
	segmentPath: string,
): Promise<{ proc: ChildProcessWithoutNullStreams; startedAtMs: number }> {
	// GPU tiers record with their probing binary (the bundled static build
	// has no vaapi/nvenc support); the CPU fallback uses the bundled binary.
	const ffmpegPath =
		linuxCaptureVaapi?.ffmpegPath ?? linuxCaptureNvenc?.ffmpegPath ?? getFfmpegBinaryPath();
	const args = await buildFfmpegCaptureArgs(source, segmentPath, {
		vaapi: linuxCaptureVaapi
			? { devicePath: linuxCaptureVaapi.devicePath }
			: null,
		nvenc: Boolean(linuxCaptureNvenc),
	});
	// Route ffmpeg's progress reports to stdout for startup calibration, at a
	// fast 0.1s period so the first usable report lands well before anything
	// else touches the cursor clock (default 0.5s loses races).
	args.splice(args.length - 1, 0, "-progress", "pipe:1", "-stats_period", "0.1");
	const recordingsDir = await getRecordingsDir();

	let captureOutput = "";
	// The buffer exists for error diagnostics; keep only its tail so steady
	// chatter (status lines, progress blocks) can't grow it without bound.
	const capLinuxCaptureOutput = () => {
		if (captureOutput.length > 512 * 1024) {
			captureOutput = captureOutput.slice(-256 * 1024);
		}
	};
	setLinuxCaptureOutputBuffer("");
	setLinuxCaptureSegmentPath(segmentPath);
	const proc = spawn(ffmpegPath, args, {
		cwd: recordingsDir,
		stdio: ["pipe", "pipe", "pipe"],
	});
	// x11grab starts grabbing frames shortly after spawn; the exact instant is
	// measured via -progress and corrected onto the cursor clock. This spawn
	// instant is also what the renderer anchors the video timeline to.
	const startedAtMs = Date.now();
	setLinuxCaptureProcess(proc);
	attachLinuxCaptureLifecycle(proc);

	// Cursor session per segment kind:
	// - first segment: fresh session at the spawn instant;
	// - later segments: keep the session untouched — re-initializing here
	//   would erase the samples recorded so far. Calibration extends it.
	const isFirstSegment = linuxCaptureSegments.length === 0;
	if (isFirstSegment) {
		startCursorCaptureSession(startedAtMs);
		armLinuxCursorStartupCalibration(startedAtMs, true);
	} else {
		armLinuxCursorStartupCalibration(startedAtMs, false);
	}

	proc.stdout.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		captureOutput += text;
		capLinuxCaptureOutput();
		setLinuxCaptureOutputBuffer(captureOutput);
		calibrateLinuxCursorStartup(text);
	});
	proc.stderr.on("data", (chunk: Buffer) => {
		// Line-buffered: showinfo logs one short line per grabbed frame, and a
		// calibration line can straddle chunk boundaries. showinfo lines are
		// dropped from the retained buffer — they are calibration chatter, not
		// diagnostics, and would otherwise grow it ~18KB/s for the whole run.
		const text = linuxCursorStderrTail + chunk.toString();
		const lines = text.split(/\r\n|\r|\n/);
		linuxCursorStderrTail = lines.pop() ?? "";
		for (const line of lines) {
			if (line.includes("Parsed_showinfo")) {
				calibrateLinuxCursorStartupFromFilterLog(line);
			} else if (line.length > 0) {
				captureOutput += `${line}\n`;
			}
		}
		capLinuxCaptureOutput();
		setLinuxCaptureOutputBuffer(captureOutput);
	});

	// System audio records a parallel segment per video segment. Spawn it
	// immediately (not after the video readiness wait) so its t=0 matches the
	// video's instead of lagging ~1s behind; register the process synchronously
	// so an instant pause can never miss it. Audio failure never fails the
	// recording — we just continue video-only.
	const audioSourceName = linuxSystemAudioSourceName;
	if (audioSourceName) {
		const audioSegmentPath = `${segmentPath.replace(/\.[^.]+$/, "")}.system.wav`;
		const audioProc = spawnLinuxSystemAudioSegment(
			linuxSystemAudioFfmpegPath ?? getFfmpegBinaryPath(),
			audioSourceName,
			audioSegmentPath,
		);
		audioProc.once("close", () => {
			if (linuxSystemAudioProcess === audioProc) {
				setLinuxSystemAudioProcess(null);
			}
		});
		setLinuxSystemAudioProcess(audioProc);
		setLinuxSystemAudioSegmentPath(audioSegmentPath);
		waitForLinuxSystemAudioSegmentStart(audioProc).catch((error) => {
			console.warn("Failed to start native Linux system audio segment:", error);
			if (linuxSystemAudioProcess === audioProc) {
				setLinuxSystemAudioProcess(null);
				setLinuxSystemAudioSegmentPath(null);
			}
			try {
				audioProc.kill();
			} catch {
				/* already gone */
			}
		});
	}

	await waitForLinuxCaptureStart(proc);
	return { proc, startedAtMs };
}

async function stopLinuxCaptureSegment() {
	const proc = linuxCaptureProcess;
	const segmentPath = linuxCaptureSegmentPath;
	if (!proc || !segmentPath) {
		throw new Error("Native Linux capture process is not running");
	}

	setLinuxCaptureStopRequested(true);
	proc.stdin.write("q\n");
	const stoppedPath = await waitForLinuxCaptureStop(proc, segmentPath);
	setLinuxCaptureProcess(null);
	setLinuxCaptureSegmentPath(null);
	setLinuxCaptureStopRequested(false);
	setLinuxCaptureSegments([...linuxCaptureSegments, stoppedPath]);

	const audioProc = linuxSystemAudioProcess;
	const audioSegmentPath = linuxSystemAudioSegmentPath;
	setLinuxSystemAudioProcess(null);
	setLinuxSystemAudioSegmentPath(null);
	if (audioProc && audioSegmentPath) {
		try {
			// The process was stored through the generic ChildProcess state type;
			// segments always spawn it with a piped stdin, so the narrowing holds.
			const stoppedAudioPath = await stopLinuxSystemAudioSegment(
				audioProc as Parameters<typeof stopLinuxSystemAudioSegment>[0],
				audioSegmentPath,
			);
			setLinuxSystemAudioSegments([...linuxSystemAudioSegments, stoppedAudioPath]);
		} catch (error) {
			// A dropped audio segment desyncs nothing before it; keep the video.
			console.warn("Failed to stop native Linux system audio segment:", error);
		}
	}

	return stoppedPath;
}

function systemAudioSidecarPathFor(finalVideoPath: string) {
	return `${finalVideoPath.replace(/\.[^.]+$/, "")}.system.wav`;
}

/**
 * Joins the recorded segments into the final video, and any system-audio
 * segments into the `.system.wav` companion sidecar the editor already reads.
 * Segments share encoder settings, so joining is a lossless stream copy
 * (no re-encode).
 */
async function finalizeLinuxCaptureRecording(finalVideoPath: string) {
	const segments = [...linuxCaptureSegments];
	setLinuxCaptureSegments([]);
	if (segments.length === 0) {
		throw new Error("No Linux capture segments were recorded");
	}

	if (segments.length === 1) {
		if (segments[0] !== finalVideoPath) {
			await moveFileWithOverwrite(segments[0], finalVideoPath);
		}
	} else {
		await stitchLinuxSegments(getFfmpegBinaryPath(), segments, finalVideoPath);
	}

	await Promise.all(
		segments
			.filter((segmentPath) => segmentPath !== finalVideoPath)
			.map((segmentPath) => fs.rm(segmentPath, { force: true }).catch(() => undefined)),
	);

	const audioSegments = [...linuxSystemAudioSegments];
	setLinuxSystemAudioSegments([]);

	const sidecarPath = systemAudioSidecarPathFor(finalVideoPath);
	if (audioSegments.length > 0) {
		try {
			if (audioSegments.length === 1) {
				await moveFileWithOverwrite(audioSegments[0], sidecarPath);
			} else {
				// Stitch with the audio-capable ffmpeg the probe selected; the
				// bundled binary may be the one lacking this machine's pulse device.
				await stitchLinuxSegments(
					linuxSystemAudioFfmpegPath ?? getFfmpegBinaryPath(),
					audioSegments,
					sidecarPath,
				);
				await Promise.all(
					audioSegments.map((segmentPath) =>
						fs.rm(segmentPath, { force: true }).catch(() => undefined),
					),
				);
			}
		} catch (error) {
			console.warn("Failed to finalize Linux system audio sidecar:", error);
			await Promise.all(
				audioSegments.map((segmentPath) =>
					fs.rm(segmentPath, { force: true }).catch(() => undefined),
				),
			);
		}
	}

	return finalVideoPath;
}

/**
 * Brings every Linux capture state variable back to idle. The stop paths call
 * this while keeping the recorded segments — finalize (or the stop-failure
 * recovery below) still needs them; the start-failure path clears them
 * because nothing was recorded yet.
 */
function resetLinuxCaptureState(options: { clearSegments?: boolean } = {}) {
	setLinuxNativeCaptureActive(false);
	setNativeScreenRecordingActive(false);
	setLinuxCaptureProcess(null);
	setLinuxCaptureSegmentPath(null);
	setLinuxCaptureTargetPath(null);
	setLinuxCaptureStopRequested(false);
	setLinuxCapturePaused(false);
	setLinuxCaptureVaapi(null);
	setLinuxCaptureNvenc(null);
	try {
		linuxSystemAudioProcess?.kill();
	} catch {
		/* ignore */
	}
	setLinuxSystemAudioProcess(null);
	setLinuxSystemAudioSegmentPath(null);
	if (options.clearSegments) {
		setLinuxCaptureSegments([]);
		setLinuxSystemAudioSegments([]);
		setLinuxSystemAudioSourceName(null);
	}
}

/**
 * Turns cursor tracking on with the video timeline's epoch. Shared by the
 * set-recording-state handler and the Linux native capture spawn so sampling
 * begins at the video's first frame instead of ~1.5s later.
 */
function startCursorCaptureSession(epochMs: number) {
	stopCursorCapture();
	stopInteractionCapture();
	startWindowBoundsCapture();
	void startNativeCursorMonitor();
	setIsCursorCaptureActive(true);
	setActiveCursorSamples([]);
	setPendingCursorSamples([]);
	setCursorCaptureStartTimeMs(epochMs);
	resetCursorCaptureClock();
	setLinuxCursorScreenPoint(null);
	setLastLeftClick(null);
	sampleCursorPoint();
	startCursorSampling();
	void startInteractionCapture();
}

export function registerRecordingHandlers(
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	ipcMain.handle(
		"start-native-screen-recording",
		async (_, source: SelectedSource, options?: NativeMacRecordingOptions) => {
			// Protect the HUD at the capture boundary, before the renderer publishes recording state.
			beginHudCaptureProtection();
			const visibleWindowBounds = source.id?.startsWith("window:")
				? await bringSelectedWindowForward(source)
				: null;

			// Windows native capture path
			if (process.platform === "win32") {
				const windowsCaptureAvailable = await isNativeWindowsCaptureAvailable();
				if (!windowsCaptureAvailable) {
					return {
						success: false,
						message: "Native Windows capture is not available on this system.",
					};
				}

				if (windowsCaptureProcess && !windowsNativeCaptureActive) {
					try {
						windowsCaptureProcess.kill();
					} catch {
						/* ignore */
					}
					setWindowsCaptureProcess(null);
					setWindowsCaptureTargetPath(null);
					setWindowsCaptureStopRequested(false);
				}

				if (windowsCaptureProcess) {
					return {
						success: false,
						message: "A native Windows screen recording is already active.",
					};
				}

				let wcProc: ChildProcessWithoutNullStreams | null = null;
				let tempVideoPath: string | null = null;
				let tempSystemAudioPath: string | null = null;
				let tempMicPath: string | null = null;
				try {
					const exePath = getWindowsCaptureExePath();
					const recordingsDir = await getRecordingsDir();
					const timestamp = Date.now();
					const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`);
					tempVideoPath = path.join(
						app.getPath("temp"),
						`recordly-native-${timestamp}.mp4`,
					);

					let captureOutput = "";
					let systemAudioPath: string | null = null;
					let microphonePath: string | null = null;
					let orphanedMicAudioPath: string | null = null;

					const browserMicFallbackRequested =
						shouldStartWindowsBrowserMicrophoneFallback(options);
					const captureTarget = resolveWindowsCaptureTarget(
						source,
						getScreen().getAllDisplays(),
						getScreen().getPrimaryDisplay(),
					);
					const displayBounds =
						captureTarget.kind === "display" ? captureTarget.bounds : null;
					setWindowsOrphanedMicAudioPath(null);

					const config: Record<string, unknown> = {
						outputPath: tempVideoPath,
						fps: 60,
					};

					if (captureTarget.kind === "invalid-window") {
						return {
							success: false,
							message:
								"Selected window is no longer available. Please choose the window again.",
						};
					}

					if (captureTarget.kind === "window") {
						config.windowHandle = captureTarget.windowHandle;
					} else {
						// Windows Graphics Capture (WGC) requires a raw HMONITOR handle.
						// We attempt to resolve the handle by matching the physical coordinates of the target display.
						const monitors = getMonitorHandles();
						const matchedMonitor = monitors.find(
							(monitor) =>
								monitor.x === Math.round(captureTarget.bounds.x) &&
								monitor.y === Math.round(captureTarget.bounds.y),
						);

						if (matchedMonitor) {
							config.displayId = matchedMonitor.handle;
						} else {
							// Fallback to coordinate-based matching if handle resolution fails
							config.displayId = captureTarget.displayId;
						}

						config.displayX = Math.round(captureTarget.bounds.x);
						config.displayY = Math.round(captureTarget.bounds.y);
						config.displayW = Math.round(captureTarget.bounds.width);
						config.displayH = Math.round(captureTarget.bounds.height);
					}

					if (options?.capturesSystemAudio) {
						systemAudioPath = path.join(
							recordingsDir,
							`recording-${timestamp}.system.wav`,
						);
						tempSystemAudioPath = path.join(
							app.getPath("temp"),
							`recordly-native-${timestamp}.system.wav`,
						);
						config.captureSystemAudio = true;
						config.audioOutputPath = tempSystemAudioPath;
						setWindowsSystemAudioPath(systemAudioPath);
					} else {
						setWindowsSystemAudioPath(null);
					}

					if (options?.capturesMicrophone && !browserMicFallbackRequested) {
						microphonePath = path.join(recordingsDir, `recording-${timestamp}.mic.wav`);
						tempMicPath = path.join(
							app.getPath("temp"),
							`recordly-native-${timestamp}.mic.wav`,
						);
						config.captureMic = true;
						config.micOutputPath = tempMicPath;
						if (options.microphoneDeviceId) {
							config.micDeviceId = options.microphoneDeviceId;
						}
						if (options.microphoneLabel) {
							config.micDeviceName = options.microphoneLabel;
						}
						setWindowsMicAudioPath(microphonePath);
					} else if (browserMicFallbackRequested) {
						config.captureMic = false;
						setWindowsMicAudioPath(null);
					} else {
						setWindowsMicAudioPath(null);
					}

					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						displayId: typeof config.displayId === "number" ? config.displayId : null,
						displayBounds,
						windowHandle:
							typeof config.windowHandle === "number" ? config.windowHandle : null,
						helperPath: exePath,
						outputPath,
						systemAudioPath,
						microphonePath,
					});

					setWindowsCaptureOutputBuffer("");
					setWindowsCaptureTargetPath(outputPath);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);

					wcProc = spawn(exePath, [JSON.stringify(config)], {
						cwd: recordingsDir,
						stdio: ["pipe", "pipe", "pipe"],
						env: process.env,
					});
					setWindowsCaptureProcess(wcProc);
					attachWindowsCaptureLifecycle(wcProc);

					wcProc.stdout.on("data", (chunk: Buffer) => {
						const msg = chunk.toString();
						captureOutput += msg;
						setWindowsCaptureOutputBuffer(captureOutput);
					});
					wcProc.stderr.on("data", (chunk: Buffer) => {
						const msg = chunk.toString();
						captureOutput += msg;
						setWindowsCaptureOutputBuffer(captureOutput);
					});

					await waitForWindowsCaptureStart(wcProc);
					const microphoneFallbackRequired =
						browserMicFallbackRequested ||
						shouldUseWindowsBrowserMicrophoneFallback(captureOutput, options);
					if (microphoneFallbackRequired) {
						orphanedMicAudioPath = tempMicPath ?? microphonePath;
						setWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
						microphonePath = null;
						setWindowsMicAudioPath(null);
					}
					setWindowsNativeCaptureActive(true);
					setNativeScreenRecordingActive(true);
					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						displayId: typeof config.displayId === "number" ? config.displayId : null,
						displayBounds,
						windowHandle:
							typeof config.windowHandle === "number" ? config.windowHandle : null,
						helperPath: exePath,
						outputPath,
						systemAudioPath,
						microphonePath,
						processOutput: captureOutput.trim() || undefined,
					});
					return { success: true, microphoneFallbackRequired };
				} catch (error) {
					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						helperPath: windowsCaptureTargetPath ? getWindowsCaptureExePath() : null,
						outputPath: windowsCaptureTargetPath,
						systemAudioPath: windowsSystemAudioPath,
						microphonePath: windowsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						error: String(error),
					});
					console.error("Failed to start native Windows capture:", error);
					try {
						if (wcProc) wcProc.kill();
					} catch {
						/* ignore */
					}
					await Promise.allSettled([
						tempVideoPath
							? fs.rm(tempVideoPath, { force: true }).catch(() => undefined)
							: Promise.resolve(),
						tempSystemAudioPath
							? fs.rm(tempSystemAudioPath, { force: true }).catch(() => undefined)
							: Promise.resolve(),
						tempMicPath
							? fs.rm(tempMicPath, { force: true }).catch(() => undefined)
							: Promise.resolve(),
					]);
					setWindowsNativeCaptureActive(false);
					setNativeScreenRecordingActive(false);
					setWindowsCaptureProcess(null);
					setWindowsCaptureTargetPath(null);
					setWindowsSystemAudioPath(null);
					setWindowsMicAudioPath(null);
					setWindowsOrphanedMicAudioPath(null);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);
					return {
						success: false,
						message: "Failed to start native Windows capture",
						error: String(error),
					};
				}
			}

			// Linux native capture path (ffmpeg x11grab — records without the OS cursor)
			if (process.platform === "linux") {
				const linuxAvailability = await probeNativeLinuxCaptureAvailability();
				if (!linuxAvailability.available) {
					return {
						success: false,
						message: describeLinuxCaptureUnavailableReason(linuxAvailability.reason),
					};
				}

				if (!shouldUseNativeLinuxCaptureForSource(source)) {
					return {
						success: false,
						message:
							"Native Linux capture only supports screen sources; falling back to browser capture.",
					};
				}

				if (linuxCaptureProcess && !linuxNativeCaptureActive) {
					try {
						linuxCaptureProcess.kill();
					} catch {
						/* ignore */
					}
					setLinuxCaptureProcess(null);
					setLinuxCaptureTargetPath(null);
					setLinuxCaptureStopRequested(false);
				}

				if (linuxCaptureProcess || linuxNativeCaptureActive) {
					return {
						success: false,
						message: "A native Linux screen recording is already active.",
					};
				}

				try {
					const recordingsDir = await getRecordingsDir();
					const sessionTimestamp = Date.now();
					const finalVideoPath = path.join(
						recordingsDir,
						`recording-${sessionTimestamp}.mp4`,
					);
					const firstSegmentPath = path.join(
						recordingsDir,
						`recording-${sessionTimestamp}.segment-0.mp4`,
					);

					// Resolve the system-audio monitor source up front; when it is
					// missing we still record video-only and let the renderer explain.
					let systemAudioUnavailable: LinuxSystemAudioUnavailableReason | null =
						null;
					if (options?.capturesSystemAudio) {
						const systemAudio = await getLinuxSystemAudioCapture();
						if (systemAudio.available && systemAudio.sourceName) {
							setLinuxSystemAudioSourceName(systemAudio.sourceName);
							setLinuxSystemAudioFfmpegPath(systemAudio.ffmpegPath ?? null);
						} else {
							console.warn(
								"Native Linux system audio unavailable:",
								systemAudio.reason,
							);
							setLinuxSystemAudioSourceName(null);
							setLinuxSystemAudioFfmpegPath(null);
							systemAudioUnavailable = systemAudio.reason ?? "no-pulse-device";
						}
					} else {
						setLinuxSystemAudioSourceName(null);
						setLinuxSystemAudioFfmpegPath(null);
					}
					setLinuxSystemAudioSegments([]);

					recordNativeCaptureDiagnostics({
						backend: "linux-x11grab",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						outputPath: finalVideoPath,
						systemAudioPath: linuxSystemAudioSourceName
							? systemAudioSidecarPathFor(finalVideoPath)
							: null,
					});

					setLinuxCaptureTargetPath(finalVideoPath);
					setLinuxCaptureSegments([]);
					setLinuxCapturePaused(false);
					setLinuxCaptureStopRequested(false);
					// Prefer GPU encoding when the machine can do it (keeps the
					// desktop smooth at 60fps); otherwise the CPU fallback tier
					// applies. Probe result is cached per session.
					try {
						const vaapi = await getLinuxVaapiCapture();
						if (vaapi.available && vaapi.ffmpegPath && vaapi.devicePath) {
							setLinuxCaptureVaapi({
								ffmpegPath: vaapi.ffmpegPath,
								devicePath: vaapi.devicePath,
							});
							setLinuxCaptureNvenc(null);
							console.info(
								`Native Linux capture encoder: h264_vaapi (${vaapi.devicePath})`,
							);
						} else {
							setLinuxCaptureVaapi(null);
							setLinuxCaptureNvenc(null);
							// NVIDIA machines have no VAAPI — offer them NVENC
							// before falling back to the CPU tier.
							const nvenc = await getLinuxNvencCapture();
							if (nvenc.available && nvenc.ffmpegPath) {
								setLinuxCaptureNvenc({ ffmpegPath: nvenc.ffmpegPath });
								console.info(
									`Native Linux capture encoder: h264_nvenc (${nvenc.ffmpegPath})`,
								);
							} else {
								setLinuxCaptureNvenc(null);
								console.info(
									`Native Linux capture encoder: libx264 (VAAPI unavailable: ${vaapi.reason ?? "unknown"}; NVENC unavailable: ${nvenc.reason ?? "unknown"})`,
								);
							}
						}
					} catch (error) {
						setLinuxCaptureVaapi(null);
						setLinuxCaptureNvenc(null);
						console.warn("Native Linux GPU encoder probe failed:", error);
					}
					const { startedAtMs } = await startLinuxCaptureSegment(
						source,
						firstSegmentPath,
					);
					setLinuxNativeCaptureActive(true);
					setNativeScreenRecordingActive(true);
					recordNativeCaptureDiagnostics({
						backend: "linux-x11grab",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						outputPath: finalVideoPath,
						processOutput: linuxCaptureOutputBuffer.trim() || undefined,
					});
					// Mic capture is handled by the renderer's browser-microphone
					// sidecar flow (same as the Windows orphaned-mic fallback).
					return {
						success: true,
						microphoneFallbackRequired: Boolean(options?.capturesMicrophone),
						systemAudioFallbackRequired: systemAudioUnavailable !== null,
						systemAudioFallbackReason: systemAudioUnavailable ?? undefined,
						startedAtMs,
					};
				} catch (error) {
					recordNativeCaptureDiagnostics({
						backend: "linux-x11grab",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						outputPath: linuxCaptureTargetPath,
						processOutput: linuxCaptureOutputBuffer.trim() || undefined,
						error: String(error),
					});
					console.error("Failed to start native Linux capture:", error);
					// TypeScript sees the earlier "already active" guard as proving this
					// is null, but startLinuxCaptureSegment may have spawned since.
					const startedProcess = linuxCaptureProcess as ChildProcessWithoutNullStreams | null;
					try {
						startedProcess?.kill();
					} catch {
						/* ignore */
					}
					const failedSegmentPath = linuxCaptureSegmentPath;
					resetLinuxCaptureState({ clearSegments: true });
					if (failedSegmentPath) {
						await fs.rm(failedSegmentPath, { force: true }).catch(() => undefined);
					}
					return {
						success: false,
						message: "Failed to start native Linux capture",
						error: String(error),
					};
				}
			}

			if (process.platform !== "darwin") {
				return {
					success: false,
					message: "Native screen recording is only available on macOS.",
				};
			}

			if (nativeCaptureProcess && !nativeScreenRecordingActive) {
				try {
					nativeCaptureProcess.kill();
				} catch {
					// ignore stale helper cleanup failures
				}
				setNativeCaptureProcess(null);
				setNativeCaptureTargetPath(null);
				setNativeCaptureStopRequested(false);
			}

			if (nativeCaptureProcess) {
				return { success: false, message: "A native screen recording is already active." };
			}

			let captProc: ChildProcessWithoutNullStreams | null = null;
			try {
				const recordingsDir = await getRecordingsDir();

				// Warm up TCC: trigger an Electron-level screen capture API call so macOS
				// activates the screen-recording grant for this process tree before the
				// native helper binary spawns and calls SCStream.startCapture().
				try {
					await desktopCapturer.getSources({
						types: ["screen"],
						thumbnailSize: { width: 1, height: 1 },
					});
				} catch {
					// non-fatal – the helper will report its own TCC status
				}

				// Ensure microphone TCC is granted for this process tree when mic capture
				// is requested, so the child helper inherits the grant.
				if (options?.capturesMicrophone) {
					const micStatus = systemPreferences.getMediaAccessStatus("microphone");
					if (micStatus !== "granted") {
						await systemPreferences.askForMediaAccess("microphone");
					}
				}

				const appName = normalizeDesktopSourceName(String(source?.appName ?? ""));
				const ownAppName = normalizeDesktopSourceName(app.getName());
				if (
					!ALLOW_RECORDLY_WINDOW_CAPTURE &&
					source?.id?.startsWith("window:") &&
					appName &&
					(appName === ownAppName || appName === "recordly")
				) {
					return {
						success: false,
						message:
							"Cannot record Recordly windows. Please select another app window.",
					};
				}

				const helperPath = await ensureNativeCaptureHelperBinary();
				const timestamp = Date.now();
				const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`);
				const capturesSystemAudio = Boolean(options?.capturesSystemAudio);
				const capturesMicrophone = Boolean(options?.capturesMicrophone);
				const systemAudioOutputPath = capturesSystemAudio
					? path.join(recordingsDir, `recording-${timestamp}.system.m4a`)
					: null;
				const microphoneOutputPath = capturesMicrophone
					? path.join(recordingsDir, `recording-${timestamp}.mic.m4a`)
					: null;
				const config: Record<string, unknown> = {
					fps: 60,
					outputPath,
					capturesSystemAudio,
					capturesMicrophone,
				};

				const excludedProcessIds = getHudCaptureExcludedProcessIds(
					process.platform,
					getHudOverlayCaptureProtectionEnabled(),
					process.pid,
				);
				if (excludedProcessIds.length > 0) {
					config.excludedProcessIds = excludedProcessIds;
				}

				if (options?.microphoneDeviceId) {
					config.microphoneDeviceId = options.microphoneDeviceId;
				}

				if (options?.microphoneLabel) {
					config.microphoneLabel = options.microphoneLabel;
				}

				if (systemAudioOutputPath) {
					config.systemAudioOutputPath = systemAudioOutputPath;
				}

				if (microphoneOutputPath) {
					config.microphoneOutputPath = microphoneOutputPath;
				}

				const windowId = parseWindowId(source?.id);
				const screenId = Number(source?.display_id);

				if (Number.isFinite(windowId) && windowId && source?.id?.startsWith("window:")) {
					config.windowId = windowId;
					if (visibleWindowBounds) {
						config.windowX = visibleWindowBounds.x;
						config.windowY = visibleWindowBounds.y;
						config.windowWidth = visibleWindowBounds.width;
						config.windowHeight = visibleWindowBounds.height;
					}
				} else if (Number.isFinite(screenId) && screenId > 0) {
					config.displayId = screenId;
				} else {
					config.displayId = Number(getScreen().getPrimaryDisplay().id);
				}

				setNativeCaptureOutputBuffer("");
				setNativeCaptureTargetPath(outputPath);
				setNativeCaptureSystemAudioPath(systemAudioOutputPath);
				setNativeCaptureMicrophonePath(microphoneOutputPath);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);
				captProc = spawn(helperPath, [JSON.stringify(config)], {
					cwd: recordingsDir,
					stdio: ["pipe", "pipe", "pipe"],
				});
				setNativeCaptureProcess(captProc);
				attachNativeCaptureLifecycle(captProc);

				captProc.stdout.on("data", (chunk: Buffer) => {
					setNativeCaptureOutputBuffer(nativeCaptureOutputBuffer + chunk.toString());
				});
				captProc.stderr.on("data", (chunk: Buffer) => {
					setNativeCaptureOutputBuffer(nativeCaptureOutputBuffer + chunk.toString());
				});

				await waitForNativeCaptureStart(captProc);
				setNativeScreenRecordingActive(true);

				// If the native helper reported MICROPHONE_CAPTURE_UNAVAILABLE, it started
				// capture without microphone.  Clear the mic path so the renderer can fall
				// back to a browser-side sidecar recording for the microphone track.
				const micUnavailableNatively = nativeCaptureOutputBuffer.includes(
					"MICROPHONE_CAPTURE_UNAVAILABLE",
				);
				if (micUnavailableNatively) {
					setNativeCaptureMicrophonePath(null);
				}

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "start",
					sourceId: source?.id ?? null,
					sourceType: source?.sourceType ?? "unknown",
					displayId: typeof config.displayId === "number" ? config.displayId : null,
					helperPath,
					outputPath,
					systemAudioPath: systemAudioOutputPath,
					microphonePath: nativeCaptureMicrophonePath,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
				});
				return {
					success: true,
					microphoneFallbackRequired: micUnavailableNatively,
				};
			} catch (error) {
				console.error("Failed to start native ScreenCaptureKit recording:", error);
				const errorStr = String(error);

				// Detect TCC (screen recording permission) errors and show a helpful dialog
				if (
					errorStr.includes("declined TCC") ||
					errorStr.includes("declined TCCs") ||
					errorStr.includes("SCREEN_RECORDING_PERMISSION_DENIED")
				) {
					const { response } = await dialog.showMessageBox({
						type: "warning",
						title: "Screen Recording Permission Required",
						message:
							"Recordly needs screen recording permission to capture your screen.",
						detail: "Please open System Settings > Privacy & Security > Screen Recording, make sure Recordly is toggled ON, then try recording again.",
						buttons: ["Open System Settings", "Cancel"],
						defaultId: 0,
						cancelId: 1,
					});
					if (response === 0) {
						await shell.openExternal(getMacPrivacySettingsUrl("screen"));
					}
					try {
						if (captProc) captProc.kill();
					} catch {
						/* ignore */
					}
					setNativeScreenRecordingActive(false);
					setNativeCaptureProcess(null);
					setNativeCaptureTargetPath(null);
					setNativeCaptureSystemAudioPath(null);
					setNativeCaptureMicrophonePath(null);
					setNativeCaptureStopRequested(false);
					setNativeCapturePaused(false);
					return {
						success: false,
						message:
							"Screen recording permission not granted. Please allow access in System Settings and restart the app.",
						userNotified: true,
					};
				}

				if (errorStr.includes("MICROPHONE_PERMISSION_DENIED")) {
					const { response } = await dialog.showMessageBox({
						type: "warning",
						title: "Microphone Permission Required",
						message: "Recordly needs microphone permission to record audio.",
						detail: "Please open System Settings > Privacy & Security > Microphone, make sure Recordly is toggled ON, then try recording again.",
						buttons: ["Open System Settings", "Cancel"],
						defaultId: 0,
						cancelId: 1,
					});
					if (response === 0) {
						await shell.openExternal(getMacPrivacySettingsUrl("microphone"));
					}
					try {
						if (captProc) captProc.kill();
					} catch {
						/* ignore */
					}
					setNativeScreenRecordingActive(false);
					setNativeCaptureProcess(null);
					setNativeCaptureTargetPath(null);
					setNativeCaptureSystemAudioPath(null);
					setNativeCaptureMicrophonePath(null);
					setNativeCaptureStopRequested(false);
					setNativeCapturePaused(false);
					return {
						success: false,
						message:
							"Microphone permission not granted. Please allow access in System Settings.",
						userNotified: true,
					};
				}

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "start",
					sourceId: source?.id ?? null,
					sourceType: source?.sourceType ?? "unknown",
					helperPath: getNativeCaptureHelperBinaryPath(),
					outputPath: nativeCaptureTargetPath,
					systemAudioPath: nativeCaptureSystemAudioPath,
					microphonePath: nativeCaptureMicrophonePath,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: await getFileSizeIfPresent(nativeCaptureTargetPath),
					error: String(error),
				});
				try {
					if (captProc) captProc.kill();
				} catch {
					// ignore cleanup failures
				}
				setNativeScreenRecordingActive(false);
				setNativeCaptureProcess(null);
				setNativeCaptureTargetPath(null);
				setNativeCaptureSystemAudioPath(null);
				setNativeCaptureMicrophonePath(null);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);
				return {
					success: false,
					message: "Failed to start native ScreenCaptureKit recording",
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle("stop-native-screen-recording", async () => {
		const start = Date.now();
		console.log("[PERF:MAIN] Handler: stop-native-screen-recording: STARTED");
		try {
			// Windows native capture stop path
			if (process.platform === "win32" && windowsNativeCaptureActive) {
				let stagedTempVideoPath: string | null = null;
				let stagedTempSystemAudioPath: string | null = null;
				let stagedTempMicAudioPath: string | null = null;
				try {
					if (!windowsCaptureProcess) {
						throw new Error("Native Windows capture process is not running");
					}

					const proc = windowsCaptureProcess;
					const preferredVideoPath = windowsCaptureTargetPath;
					const preferredOrphanedMicAudioPath = windowsOrphanedMicAudioPath;
					const diagnosticsSystemAudioPath = windowsSystemAudioPath;
					const diagnosticsMicAudioPath = windowsMicAudioPath;
					setWindowsCaptureStopRequested(true);
					proc.stdin.write("stop\n");
					const tempVideoPath = await waitForWindowsCaptureStop(proc);
					stagedTempVideoPath = tempVideoPath;
					const finalVideoPath = preferredVideoPath ?? tempVideoPath;

					// Native Windows capture results are initially written to a safe temporary path
					// (to avoid encoding failures with non-ASCII characters). We move them to the final
					// destination now using Node.js, which handles Unicode paths correctly.
					if (tempVideoPath !== finalVideoPath) {
						await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
					}

					if (windowsSystemAudioPath && tempVideoPath.endsWith(".mp4")) {
						const tempAudioPath = tempVideoPath.replace(".mp4", ".system.wav");
						stagedTempSystemAudioPath = tempAudioPath;
						const finalAudioPath = windowsSystemAudioPath;
						if (await pathExists(tempAudioPath)) {
							await moveFileWithOverwrite(tempAudioPath, finalAudioPath);
							const tempJson = tempAudioPath + ".json";
							if (await pathExists(tempJson)) {
								await moveFileWithOverwrite(tempJson, finalAudioPath + ".json");
							}
						}
					}

					if (windowsMicAudioPath && tempVideoPath.endsWith(".mp4")) {
						const tempMicPath = tempVideoPath.replace(".mp4", ".mic.wav");
						stagedTempMicAudioPath = tempMicPath;
						const finalMicPath = windowsMicAudioPath;
						if (await pathExists(tempMicPath)) {
							await moveFileWithOverwrite(tempMicPath, finalMicPath);
							const tempJson = tempMicPath + ".json";
							if (await pathExists(tempJson)) {
								await moveFileWithOverwrite(tempJson, finalMicPath + ".json");
							}
						}
					}
					const validation = await validateRecordedVideo(finalVideoPath);

					setWindowsCaptureProcess(null);
					setWindowsNativeCaptureActive(false);
					setNativeScreenRecordingActive(false);
					setWindowsCaptureTargetPath(null);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);
					setWindowsOrphanedMicAudioPath(null);
					await cleanupWindowsOrphanedMicAudioPath(preferredOrphanedMicAudioPath);
					setWindowsPendingVideoPath(finalVideoPath);
					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "stop",
						outputPath: finalVideoPath,
						systemAudioPath: diagnosticsSystemAudioPath,
						microphonePath: diagnosticsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						fileSizeBytes: validation.fileSizeBytes,
					});
					await writeWindowsRecordingDiagnostics(finalVideoPath, {
						phase: "stop",
						outputPath: finalVideoPath,
						systemAudioPath: diagnosticsSystemAudioPath,
						microphonePath: diagnosticsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						details: {
							fileSizeBytes: validation.fileSizeBytes,
							durationSeconds: validation.durationSeconds,
						},
					});

					// Persist cursor telemetry before returning so the editor can find it immediately
					snapshotCursorTelemetryForPersistence();
					try {
						await persistPendingCursorTelemetry(finalVideoPath);
					} catch (error) {
						console.warn(
							"Failed to persist cursor telemetry during native stop:",
							error,
						);
					}

					return { success: true, path: finalVideoPath };
				} catch (error) {
					console.error("Failed to stop native Windows capture:", error);
					const fallbackPath = await resolveExistingPath(
						windowsCaptureTargetPath,
						stagedTempVideoPath,
					);
					const recoveredSystemAudioPath = await resolveExistingPath(
						windowsSystemAudioPath,
						stagedTempSystemAudioPath,
					);
					const recoveredMicAudioPath = await resolveExistingPath(
						windowsMicAudioPath,
						stagedTempMicAudioPath,
					);
					const fallbackOrphanedMicAudioPath = windowsOrphanedMicAudioPath;
					const diagnosticsSystemAudioPath =
						recoveredSystemAudioPath ?? windowsSystemAudioPath;
					const diagnosticsMicAudioPath = recoveredMicAudioPath ?? windowsMicAudioPath;
					setWindowsNativeCaptureActive(false);
					setNativeScreenRecordingActive(false);
					setWindowsCaptureProcess(null);
					setWindowsCaptureTargetPath(null);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);
					setWindowsOrphanedMicAudioPath(null);

					if (fallbackPath) {
						try {
							const validation = await validateRecordedVideo(fallbackPath);
							setWindowsPendingVideoPath(fallbackPath);
							setWindowsSystemAudioPath(recoveredSystemAudioPath);
							setWindowsMicAudioPath(recoveredMicAudioPath);
							await cleanupWindowsOrphanedMicAudioPath(fallbackOrphanedMicAudioPath);
							recordNativeCaptureDiagnostics({
								backend: "windows-wgc",
								phase: "stop",
								outputPath: fallbackPath,
								systemAudioPath: diagnosticsSystemAudioPath,
								microphonePath: diagnosticsMicAudioPath,
								processOutput: windowsCaptureOutputBuffer.trim() || undefined,
								fileSizeBytes: validation.fileSizeBytes,
								error: String(error),
							});
							await writeWindowsRecordingDiagnostics(fallbackPath, {
								phase: "stop",
								outputPath: fallbackPath,
								systemAudioPath: diagnosticsSystemAudioPath,
								microphonePath: diagnosticsMicAudioPath,
								processOutput: windowsCaptureOutputBuffer.trim() || undefined,
								error: String(error),
								details: {
									fileSizeBytes: validation.fileSizeBytes,
									durationSeconds: validation.durationSeconds,
									recoveredAfterStopFailure: true,
								},
							});
							return { success: true, path: fallbackPath };
						} catch {
							// File is absent or failed validation.
						}
					}

					setWindowsSystemAudioPath(null);
					setWindowsMicAudioPath(null);
					setWindowsPendingVideoPath(null);
					await cleanupWindowsOrphanedMicAudioPath(fallbackOrphanedMicAudioPath);

					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "stop",
						outputPath: fallbackPath,
						systemAudioPath: diagnosticsSystemAudioPath,
						microphonePath: diagnosticsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
						error: String(error),
					});
					await writeWindowsRecordingDiagnostics(fallbackPath, {
						phase: "stop",
						outputPath: fallbackPath,
						systemAudioPath: diagnosticsSystemAudioPath,
						microphonePath: diagnosticsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						error: String(error),
						details: {
							fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
						},
					});

					return {
						success: false,
						message: "Failed to stop native Windows capture",
						error: String(error),
					};
				}
			}

			// Linux native capture stop path
			if (process.platform === "linux" && linuxNativeCaptureActive) {
				const finalVideoPath = linuxCaptureTargetPath;
				try {
					if (!finalVideoPath) {
						throw new Error("Native Linux capture output path is missing");
					}

					if (linuxCaptureProcess) {
						await stopLinuxCaptureSegment();
					}
					if (linuxCapturePaused && linuxCaptureSegmentPath) {
						// Stopped while paused with a segment still open (pause raced the
						// stop); make sure the open segment file lands in the list.
						setLinuxCaptureSegments([...linuxCaptureSegments, linuxCaptureSegmentPath]);
						setLinuxCaptureSegmentPath(null);
					}

					resetLinuxCaptureState();

					const stitchedPath = await finalizeLinuxCaptureRecording(finalVideoPath);

					recordNativeCaptureDiagnostics({
						backend: "linux-x11grab",
						phase: "stop",
						outputPath: stitchedPath,
						processOutput: linuxCaptureOutputBuffer.trim() || undefined,
					});

					return await finalizeStoredVideo(stitchedPath);
				} catch (error) {
					console.error("Failed to stop native Linux capture:", error);
					const segments = linuxCaptureSegments;
					const openSegmentPath = linuxCaptureSegmentPath;
					resetLinuxCaptureState();

					recordNativeCaptureDiagnostics({
						backend: "linux-x11grab",
						phase: "stop",
						outputPath: finalVideoPath,
						processOutput: linuxCaptureOutputBuffer.trim() || undefined,
						fileSizeBytes: await getFileSizeIfPresent(finalVideoPath),
						error: String(error),
					});

					// Best-effort recovery: an unclean ffmpeg exit still leaves usable
					// segment files, and the final mp4 may exist from an earlier stage.
					if (finalVideoPath && segments.length > 0) {
						try {
							const recoveredPath = await finalizeLinuxCaptureRecording(finalVideoPath);
							return await finalizeStoredVideo(recoveredPath);
						} catch (recoveryError) {
							console.warn(
								"Failed to recover Linux capture segments after stop failure:",
								recoveryError,
							);
						}
					}
					if (finalVideoPath && (await pathExists(finalVideoPath))) {
						try {
							return await finalizeStoredVideo(finalVideoPath);
						} catch {
							// File failed validation.
						}
					}
					if (openSegmentPath && (await pathExists(openSegmentPath))) {
						try {
							return await finalizeStoredVideo(openSegmentPath);
						} catch {
							// File failed validation.
						}
					}

					return {
						success: false,
						message: "Failed to stop native Linux capture",
						error: String(error),
					};
				}
			}

			if (process.platform !== "darwin") {
				return {
					success: false,
					message: "Native screen recording is only available on macOS.",
				};
			}

			if (!nativeScreenRecordingActive) {
				const recovered = await recoverNativeMacCaptureOutput();
				if (recovered) {
					return recovered;
				}

				return { success: false, message: "No native screen recording is active." };
			}

			try {
				if (!nativeCaptureProcess) {
					throw new Error("Native capture helper process is not running");
				}

				const process = nativeCaptureProcess;
				const preferredVideoPath = nativeCaptureTargetPath;
				const preferredSystemAudioPath = nativeCaptureSystemAudioPath;
				const preferredMicrophonePath = nativeCaptureMicrophonePath;
				console.log(
					"[stop-native] Audio paths — system:",
					preferredSystemAudioPath,
					"mic:",
					preferredMicrophonePath,
				);
				setNativeCaptureStopRequested(true);
				process.stdin.write("stop\n");
				const tempVideoPath = await waitForNativeCaptureStop(process);
				console.log("[stop-native] Helper stopped, tempVideoPath:", tempVideoPath);
				setNativeCaptureProcess(null);
				setNativeScreenRecordingActive(false);
				setNativeCaptureTargetPath(null);
				setNativeCaptureSystemAudioPath(null);
				setNativeCaptureMicrophonePath(null);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);

				const finalVideoPath = preferredVideoPath ?? tempVideoPath;
				if (tempVideoPath !== finalVideoPath) {
					await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
				}

				if (preferredSystemAudioPath || preferredMicrophonePath) {
					console.log(
						"[stop-native] Attempting audio mux (merging separate tracks) into:",
						finalVideoPath,
					);
					try {
						await muxNativeMacRecordingWithAudio(
							finalVideoPath,
							preferredSystemAudioPath,
							preferredMicrophonePath,
						);
						console.log("[stop-native] Audio mux completed successfully");
					} catch (error) {
						console.warn(
							"[stop-native] Audio mux failed (video still has inline audio):",
							error,
						);
					}
				} else {
					console.log("[stop-native] No separate audio tracks to mux");
				}

				return await finalizeStoredVideo(finalVideoPath);
			} catch (error) {
				console.error("Failed to stop native ScreenCaptureKit recording:", error);
				const fallbackPath = nativeCaptureTargetPath;
				const fallbackSystemAudioPath = nativeCaptureSystemAudioPath;
				const fallbackMicrophonePath = nativeCaptureMicrophonePath;
				const fallbackFileSizeBytes = await getFileSizeIfPresent(fallbackPath);
				setNativeScreenRecordingActive(false);
				setNativeCaptureProcess(null);
				setNativeCaptureTargetPath(null);
				setNativeCaptureSystemAudioPath(null);
				setNativeCaptureMicrophonePath(null);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "stop",
					sourceId: lastNativeCaptureDiagnostics?.sourceId ?? null,
					sourceType: lastNativeCaptureDiagnostics?.sourceType ?? "unknown",
					displayId: lastNativeCaptureDiagnostics?.displayId ?? null,
					displayBounds: lastNativeCaptureDiagnostics?.displayBounds ?? null,
					windowHandle: lastNativeCaptureDiagnostics?.windowHandle ?? null,
					helperPath: lastNativeCaptureDiagnostics?.helperPath ?? null,
					outputPath: fallbackPath,
					systemAudioPath: fallbackSystemAudioPath,
					microphonePath: fallbackMicrophonePath,
					osRelease: lastNativeCaptureDiagnostics?.osRelease,
					supported: lastNativeCaptureDiagnostics?.supported,
					helperExists: lastNativeCaptureDiagnostics?.helperExists,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: fallbackFileSizeBytes,
					error: String(error),
				});

				// Try to recover: if the target file exists on disk, finalize with it
				if (fallbackPath) {
					try {
						await fs.access(fallbackPath);
						console.log(
							"[stop-native-screen-recording] Recovering with fallback path:",
							fallbackPath,
						);
						if (fallbackSystemAudioPath || fallbackMicrophonePath) {
							try {
								await muxNativeMacRecordingWithAudio(
									fallbackPath,
									fallbackSystemAudioPath,
									fallbackMicrophonePath,
								);
							} catch (muxError) {
								console.warn(
									"Failed to mux recovered native macOS audio into capture:",
									muxError,
								);
							}
						}
						return await finalizeStoredVideo(fallbackPath);
					} catch {
						// File doesn't exist or isn't accessible
					}
				}

				const recovered = await recoverNativeMacCaptureOutput();
				if (recovered) {
					return recovered;
				}

				return {
					success: false,
					message: "Failed to stop native ScreenCaptureKit recording",
					error: String(error),
				};
			}
		} finally {
			console.log(
				`[PERF:MAIN] Handler: stop-native-screen-recording: COMPLETED in ${Date.now() - start}ms`,
			);
		}
	});

	ipcMain.handle("recover-native-screen-recording", async () => {
		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording recovery is only available on macOS.",
			};
		}

		const recovered = await recoverNativeMacCaptureOutput();
		if (recovered) {
			return recovered;
		}

		return {
			success: false,
			message: "No recoverable native macOS recording output was found.",
		};
	});

	ipcMain.handle("pause-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: "No native Windows screen recording is active." };
			}

			if (windowsCapturePaused) {
				return { success: true };
			}

			try {
				windowsCaptureProcess.stdin.write("pause\n");
				setWindowsCapturePaused(true);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					message: "Failed to pause native Windows capture",
					error: String(error),
				};
			}
		}

		if (process.platform === "linux") {
			if (!linuxNativeCaptureActive) {
				return { success: false, message: "No native Linux screen recording is active." };
			}

			if (linuxCapturePaused) {
				return { success: true };
			}

			try {
				await stopLinuxCaptureSegment();
				setLinuxCapturePaused(true);
				// The video piece kept recording until the clean stop completed, so
				// the cursor timeline must treat this instant — not the button-press
				// moment the renderer used — as where the video freezes. Applied
				// natively here; the renderer's echo call no-ops (already paused).
				const pausedAtMs = Date.now();
				pauseCursorCaptureAtBoundary(pausedAtMs);
				recordNativeCaptureDiagnostics({
					backend: "linux-x11grab",
					phase: "stop",
					outputPath: linuxCaptureTargetPath,
					processOutput: linuxCaptureOutputBuffer.trim() || undefined,
				});
				return { success: true, pausedAtMs };
			} catch (error) {
				return {
					success: false,
					message: "Failed to pause native Linux capture",
					error: String(error),
				};
			}
		}

		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording is only available on macOS.",
			};
		}

		if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
			return { success: false, message: "No native screen recording is active." };
		}

		if (nativeCapturePaused) {
			return { success: true };
		}

		try {
			const commandApplied = waitForNativeCaptureCommand(
				nativeCaptureProcess,
				"Recording paused",
			);
			nativeCaptureProcess.stdin.write("pause\n");
			await commandApplied;
			setNativeCapturePaused(true);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: "Failed to pause native screen recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("resume-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: "No native Windows screen recording is active." };
			}

			if (!windowsCapturePaused) {
				return { success: true };
			}

			try {
				windowsCaptureProcess.stdin.write("resume\n");
				setWindowsCapturePaused(false);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					message: "Failed to resume native Windows capture",
					error: String(error),
				};
			}
		}

		if (process.platform === "linux") {
			if (!linuxNativeCaptureActive) {
				return { success: false, message: "No native Linux screen recording is active." };
			}

			if (!linuxCapturePaused) {
				return { success: true };
			}

			const source = selectedSource;
			if (!source || !shouldUseNativeLinuxCaptureForSource(source)) {
				return {
					success: false,
					message: "Native Linux capture source is no longer available.",
				};
			}

			try {
				const finalVideoPath = linuxCaptureTargetPath;
				if (!finalVideoPath) {
					return {
						success: false,
						message: "Native Linux capture output path is missing.",
					};
				}
				const nextSegmentPath = `${finalVideoPath.replace(
					/\.[^.]+$/,
					"",
				)}.segment-${linuxCaptureSegments.length}.mp4`;
				const { startedAtMs } = await startLinuxCaptureSegment(
					source,
					nextSegmentPath,
				);
				setLinuxCapturePaused(false);
				return { success: true, startedAtMs };
			} catch (error) {
				// Resume failed: clean up the half-started segment but keep the
				// session alive so Stop still finalizes what was recorded before
				// the pause.
				console.error("Failed to resume native Linux capture:", error);
				try {
					linuxCaptureProcess?.kill();
				} catch {
					/* ignore */
				}
				setLinuxCaptureProcess(null);
				setLinuxCaptureSegmentPath(null);
				setLinuxCapturePaused(false);
				return {
					success: false,
					message: "Failed to resume native Linux capture",
					error: String(error),
				};
			}
		}

		if (process.platform !== "darwin") {
			return {
				success: false,
				message: "Native screen recording is only available on macOS.",
			};
		}

		if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
			return { success: false, message: "No native screen recording is active." };
		}

		if (!nativeCapturePaused) {
			return { success: true };
		}

		try {
			const commandApplied = waitForNativeCaptureCommand(
				nativeCaptureProcess,
				"Recording resumed",
			);
			nativeCaptureProcess.stdin.write("resume\n");
			await commandApplied;
			setNativeCapturePaused(false);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: "Failed to resume native screen recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-system-cursor-assets", async () => {
		try {
			return { success: true, cursors: await getSystemCursorAssets() };
		} catch (error) {
			console.error("Failed to load system cursor assets:", error);
			return { success: false, cursors: {}, error: String(error) };
		}
	});

	ipcMain.handle("is-native-windows-capture-available", async () => {
		return { available: await isNativeWindowsCaptureAvailable() };
	});

	ipcMain.handle("is-native-linux-capture-available", async () => {
		const availability = await probeNativeLinuxCaptureAvailability();
		recordNativeCaptureDiagnostics({
			backend: "linux-x11grab",
			phase: "availability",
			unavailableReason: availability.available ? undefined : availability.reason,
		});
		return availability;
	});

	// Whether Recordly's own Screen/Window picker should be shown. On Linux
	// X11 sessions without a ScreenCast portal it is the only working capture
	// path; with a portal (GNOME/KDE) the system dialog covers it and the
	// picker stays hidden as before.
	ipcMain.handle("get-source-picker-visibility", async () => {
		const visibility = await getSourcePickerVisibilityForPlatform();
		if (visibility.reason === "no-portal-screencast") {
			console.log(
				"[source-picker] shown: no ScreenCast portal on this X11 session — the picker is the only working capture path",
			);
		}
		return visibility;
	});

	ipcMain.handle("get-last-native-capture-diagnostics", async () => {
		return { success: true, diagnostics: lastNativeCaptureDiagnostics };
	});

	ipcMain.handle("get-video-audio-fallback-paths", async (_event, videoPath: string) => {
		if (!videoPath) {
			return { success: true, paths: [], startDelayMsByPath: {} };
		}

		try {
			const { paths, startDelayMsByPath } = await getCompanionAudioFallbackInfo(videoPath);
			await Promise.all([
				rememberApprovedLocalReadPath(videoPath),
				...paths.map((fallbackPath) => rememberApprovedLocalReadPath(fallbackPath)),
			]);
			return { success: true, paths, startDelayMsByPath };
		} catch (error) {
			console.error("Failed to resolve companion audio fallback paths:", error);
			return { success: false, paths: [], startDelayMsByPath: {}, error: String(error) };
		}
	});

	ipcMain.handle("mux-native-windows-recording", async (_event, expectedDurationMs?: number) => {
		const start = Date.now();
		console.log("[PERF:MAIN] Handler: mux-native-windows-recording: STARTED");
		try {
			const videoPath = windowsPendingVideoPath;
			const orphanedMicAudioPath = windowsOrphanedMicAudioPath;
			const diagnosticsSystemAudioPath = windowsSystemAudioPath;
			const diagnosticsMicAudioPath = windowsMicAudioPath;
			setWindowsPendingVideoPath(null);
			setWindowsOrphanedMicAudioPath(null);

			if (!videoPath) {
				return { success: false, message: "No native Windows video pending for mux" };
			}

			try {
				await writeWindowsRecordingDiagnostics(videoPath, {
					phase: "mux-start",
					expectedDurationMs,
					outputPath: videoPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					details: {
						hasSystemAudio: Boolean(diagnosticsSystemAudioPath),
						hasMicrophone: Boolean(diagnosticsMicAudioPath),
						hasOrphanedMicrophone: Boolean(orphanedMicAudioPath),
					},
				});
				console.log("[mux-win] Optimization active: skipping video padding.");

				let muxDetails: unknown = null;
				if (diagnosticsSystemAudioPath || diagnosticsMicAudioPath) {
					muxDetails = await muxNativeWindowsVideoWithAudio(
						videoPath,
						diagnosticsSystemAudioPath,
						diagnosticsMicAudioPath,
					);
					setWindowsSystemAudioPath(null);
					setWindowsMicAudioPath(null);
				}

				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "mux",
					outputPath: videoPath,
					fileSizeBytes: await getFileSizeIfPresent(videoPath),
				});
				await writeWindowsRecordingDiagnostics(videoPath, {
					phase: "mux-complete",
					expectedDurationMs,
					outputPath: videoPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					details: {
						fileSizeBytes: await getFileSizeIfPresent(videoPath),
						mux: muxDetails,
					},
				});
				await cleanupWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
				return await finalizeStoredVideo(videoPath);
			} catch (error) {
				console.error("Failed to mux native Windows recording:", error);
				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "mux",
					outputPath: videoPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					fileSizeBytes: await getFileSizeIfPresent(videoPath),
					error: String(error),
				});
				await writeWindowsRecordingDiagnostics(videoPath, {
					phase: "mux-error",
					expectedDurationMs,
					outputPath: videoPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					error: String(error),
					details: {
						fileSizeBytes: await getFileSizeIfPresent(videoPath),
					},
				});
				setWindowsSystemAudioPath(null);
				setWindowsMicAudioPath(null);
				await cleanupWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
				try {
					return await finalizeStoredVideo(videoPath);
				} catch {
					try {
						await validateRecordedVideo(videoPath);
						return {
							success: false,
							path: videoPath,
							message: "Failed to mux native Windows recording",
							error: String(error),
						};
					} catch {
						// The fallback path is not safely playable; surface the original mux error.
					}

					return {
						success: false,
						message: "Failed to mux native Windows recording",
						error: String(error),
					};
				}
			}
		} finally {
			console.log(
				`[PERF:MAIN] Handler: mux-native-windows-recording: COMPLETED in ${Date.now() - start}ms`,
			);
		}
	});

	ipcMain.handle("start-ffmpeg-recording", async (_, source: SelectedSource) => {
		if (ffmpegCaptureProcess) {
			return { success: false, message: "An FFmpeg recording is already active." };
		}

		try {
			const recordingsDir = await getRecordingsDir();
			const ffmpegPath = getFfmpegBinaryPath();
			const outputPath = path.join(recordingsDir, `recording-${Date.now()}.mp4`);
			const args = await buildFfmpegCaptureArgs(source, outputPath);

			setFfmpegCaptureOutputBuffer("");
			setFfmpegCaptureTargetPath(outputPath);
			const ffProc = spawn(ffmpegPath, args, {
				cwd: recordingsDir,
				stdio: ["pipe", "pipe", "pipe"],
			});
			setFfmpegCaptureProcess(ffProc);

			ffProc.stdout.on("data", (chunk: Buffer) => {
				setFfmpegCaptureOutputBuffer(ffmpegCaptureOutputBuffer + chunk.toString());
			});
			ffProc.stderr.on("data", (chunk: Buffer) => {
				setFfmpegCaptureOutputBuffer(ffmpegCaptureOutputBuffer + chunk.toString());
			});

			await waitForFfmpegCaptureStart(ffProc);
			setFfmpegScreenRecordingActive(true);
			return { success: true };
		} catch (error) {
			console.error("Failed to start FFmpeg recording:", error);
			setFfmpegScreenRecordingActive(false);
			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			return {
				success: false,
				message: "Failed to start FFmpeg recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("stop-ffmpeg-recording", async () => {
		if (!ffmpegScreenRecordingActive) {
			return { success: false, message: "No FFmpeg recording is active." };
		}

		try {
			if (!ffmpegCaptureProcess || !ffmpegCaptureTargetPath) {
				throw new Error("FFmpeg process is not running");
			}

			const process = ffmpegCaptureProcess;
			const outputPath = ffmpegCaptureTargetPath;
			process.stdin.write("q\n");
			const finalVideoPath = await waitForFfmpegCaptureStop(process, outputPath);

			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			setFfmpegScreenRecordingActive(false);

			return await finalizeStoredVideo(finalVideoPath);
		} catch (error) {
			console.error("Failed to stop FFmpeg recording:", error);
			try {
				ffmpegCaptureProcess?.kill();
			} catch {
				// ignore cleanup failures
			}
			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			setFfmpegScreenRecordingActive(false);
			return {
				success: false,
				message: "Failed to stop FFmpeg recording",
				error: String(error),
			};
		}
	});

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

	ipcMain.handle("store-recorded-video", async (_, videoData: ArrayBuffer, fileName: unknown) => {
		try {
			const recordingsDir = await getRecordingsDir();
			const videoPath = resolveRecordedVideoStoragePath(recordingsDir, fileName);
			await fs.writeFile(videoPath, Buffer.from(videoData));
			return await finalizeStoredVideo(videoPath);
		} catch (error) {
			console.error("Failed to store video:", error);
			return {
				success: false,
				message: "Failed to store video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-recorded-video-path", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
			const candidates = await Promise.all(
				entries
					.filter(
						(entry) =>
							entry.isFile() && /^recording-\d+\.(webm|mov|mp4)$/i.test(entry.name),
					)
					.map(async (entry) => {
						const fullPath = path.join(recordingsDir, entry.name);
						const stat = await fs.stat(fullPath).catch(() => null);
						return stat ? { path: fullPath, mtimeMs: stat.mtimeMs } : null;
					}),
			);
			const sortedCandidates = candidates
				.filter(
					(candidate): candidate is { path: string; mtimeMs: number } =>
						candidate !== null,
				)
				.sort((left, right) => right.mtimeMs - left.mtimeMs);

			for (const candidate of sortedCandidates) {
				try {
					await validateRecordedVideo(candidate.path);
					return { success: true, path: candidate.path };
				} catch (error) {
					console.warn(
						"Skipping unusable recovered recording candidate:",
						candidate.path,
						error,
					);
				}
			}

			if (sortedCandidates.length === 0) {
				return { success: false, message: "No recorded video found" };
			}

			return { success: false, message: "No usable recorded video found" };
		} catch (error) {
			console.error("Failed to get video path:", error);
			return { success: false, message: "Failed to get video path", error: String(error) };
		}
	});

	ipcMain.handle("set-recording-state", (_, recording: boolean, startedAtMs?: unknown) => {
		if (recording) {
			if (process.platform === "linux" && linuxNativeCaptureActive && isCursorCaptureActive) {
				// Native Linux capture already began the cursor session at the
				// segment spawn with the video's exact epoch; re-initializing here
				// would discard the samples collected since.
			} else {
				const requestedEpochMs = typeof startedAtMs === "number" ? startedAtMs : NaN;
				const cursorEpochMs =
					Number.isFinite(requestedEpochMs) && requestedEpochMs > 0
						? Math.min(requestedEpochMs, Date.now())
						: Date.now();
				startCursorCaptureSession(cursorEpochMs);
			}
		} else {
			setIsCursorCaptureActive(false);
			stopCursorCapture();
			stopInteractionCapture();
			stopWindowBoundsCapture();
			stopNativeCursorMonitor();
			showCursor();
			setLinuxCursorScreenPoint(null);
			resetCursorCaptureClock();
			snapshotCursorTelemetryForPersistence();
			setActiveCursorSamples([]);
		}

		const source = selectedSource || { name: "Screen" };
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording,
					sourceName: source.name,
				});
			}
		});

		if (onRecordingStateChange) {
			onRecordingStateChange(recording, source.name);
		}
	});

	ipcMain.handle("pause-cursor-capture", (_, pausedAtMs?: unknown) => {
		pauseCursorCaptureAtBoundary(normalizeRendererTimestampMs(pausedAtMs));
		return { success: true };
	});

	ipcMain.handle("resume-cursor-capture", (_, resumedAtMs?: unknown) => {
		resumeCursorCapture(normalizeRendererTimestampMs(resumedAtMs));
		sampleCursorPoint();
		return { success: true };
	});

	ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
		if (!targetVideoPath) {
			return { success: true, samples: [] };
		}

		const telemetryPath = getTelemetryPathForVideo(targetVideoPath);
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			const samples = normalizeCursorTelemetrySamples(parsed);

			return { success: true, samples };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, samples: [] };
			}
			console.error("Failed to load cursor telemetry:", error);
			return {
				success: false,
				message: "Failed to load cursor telemetry",
				error: String(error),
				samples: [],
			};
		}
	});

	ipcMain.handle(
		"set-cursor-telemetry",
		async (_, videoPath: string | undefined, samples: CursorTelemetryPoint[]) => {
			const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
			if (!targetVideoPath) {
				return {
					success: false,
					samples: [],
					message: "No video path available for cursor telemetry",
					error: "Missing video path",
				};
			}

			try {
				const normalizedSamples = await writeCursorTelemetry(targetVideoPath, samples);
				return { success: true, samples: normalizedSamples };
			} catch (error) {
				console.error("Failed to save cursor telemetry:", error);
				return {
					success: false,
					samples: [],
					message: "Failed to save cursor telemetry",
					error: String(error),
				};
			}
		},
	);
}
