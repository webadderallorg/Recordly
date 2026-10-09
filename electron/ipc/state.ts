import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import type {
	CursorInteractionType,
	CursorTelemetryPoint,
	CursorVisualType,
	NativeCaptureDiagnostics,
	RecordingSessionData,
	SelectedSource,
	SystemCursorAsset,
	WindowBounds,
} from "./types";

// ── Source selection ──────────────────────────────────────────────────────────
export let selectedSource: SelectedSource | null = null;

// ── Project / video state ─────────────────────────────────────────────────────
export let currentProjectPath: string | null = null;
export let currentVideoPath: string | null = null;
export let currentRecordingSession: RecordingSessionData | null = null;

// ── Security: approved read paths ─────────────────────────────────────────────
export const approvedLocalReadPaths = new Set<string>();

// ── Native macOS capture ──────────────────────────────────────────────────────
export let nativeScreenRecordingActive = false;
export let nativeCaptureProcess: ChildProcessWithoutNullStreams | null = null;
export let nativeCaptureOutputBuffer = "";
export let nativeCaptureTargetPath: string | null = null;
export let nativeCaptureStopRequested = false;
export let nativeCaptureSystemAudioPath: string | null = null;
export let nativeCaptureMicrophonePath: string | null = null;
export let nativeCapturePaused = false;

// ── Native cursor monitor ─────────────────────────────────────────────────────
export let nativeCursorMonitorProcess: ChildProcessWithoutNullStreams | null = null;
export let nativeCursorMonitorOutputBuffer = "";

// ── Windows native capture ────────────────────────────────────────────────────
export let windowsCaptureProcess: ChildProcessWithoutNullStreams | null = null;
export let windowsCaptureOutputBuffer = "";
export let windowsCaptureTargetPath: string | null = null;
export let windowsNativeCaptureActive = false;
export let windowsCaptureStopRequested = false;
export let windowsCapturePaused = false;
export let windowsSystemAudioPath: string | null = null;
export let windowsMicAudioPath: string | null = null;
export let windowsOrphanedMicAudioPath: string | null = null;
export let windowsPendingVideoPath: string | null = null;

// ── Linux native capture (ffmpeg x11grab) ─────────────────────────────────────
export let linuxCaptureProcess: ChildProcessWithoutNullStreams | null = null;
export let linuxCaptureOutputBuffer = "";
export let linuxCaptureTargetPath: string | null = null;
export let linuxCaptureVaapi: { ffmpegPath: string; devicePath: string } | null = null;
export let linuxCaptureNvenc: { ffmpegPath: string } | null = null;
export let linuxNativeCaptureActive = false;
export let linuxCaptureStopRequested = false;
export let linuxCapturePaused = false;
export let linuxCaptureSegmentPath: string | null = null;
export let linuxCaptureSegments: string[] = [];
export let linuxSystemAudioProcess: ChildProcess | null = null;
export let linuxSystemAudioSourceName: string | null = null;
export let linuxSystemAudioFfmpegPath: string | null = null;
export let linuxSystemAudioSegmentPath: string | null = null;
export let linuxSystemAudioSegments: string[] = [];

// ── Diagnostics ───────────────────────────────────────────────────────────────
export let lastNativeCaptureDiagnostics: NativeCaptureDiagnostics | null = null;

// ── FFmpeg capture ────────────────────────────────────────────────────────────
export let ffmpegScreenRecordingActive = false;
export let ffmpegCaptureProcess: ChildProcessWithoutNullStreams | null = null;
export let ffmpegCaptureOutputBuffer = "";
export let ffmpegCaptureTargetPath: string | null = null;

// ── Recordings directory ──────────────────────────────────────────────────────
export let customRecordingsDir: string | null = null;
export let recordingsDirLoaded = false;

// ── System cursor assets cache ────────────────────────────────────────────────
export let cachedSystemCursorAssets: Record<string, SystemCursorAsset> | null = null;
export let cachedSystemCursorAssetsSourceMtimeMs: number | null = null;

// ── Countdown ─────────────────────────────────────────────────────────────────
export let countdownTimer: ReturnType<typeof setInterval> | null = null;
export let countdownCancelled = false;
export let countdownInProgress = false;
export let countdownRemaining: number | null = null;

// ── Cursor visual type ────────────────────────────────────────────────────────
export let currentCursorVisualType: CursorVisualType | undefined = undefined;

// ── Cursor telemetry ──────────────────────────────────────────────────────────
export let cursorCaptureInterval: NodeJS.Timeout | null = null;
export let cursorCaptureStartTimeMs = 0;
export let cursorCaptureAccumulatedPausedMs = 0;
export let cursorCapturePauseStartedAtMs: number | null = null;
export let activeCursorSamples: CursorTelemetryPoint[] = [];
export let pendingCursorSamples: CursorTelemetryPoint[] = [];
export let isCursorCaptureActive = false;
export let interactionCaptureCleanup: (() => void) | null = null;
export let hasLoggedInteractionHookFailure = false;
export let lastLeftClick: { timeMs: number; cx: number; cy: number } | null = null;
export let linuxCursorScreenPoint: { x: number; y: number; updatedAt: number } | null = null;
export let selectedWindowBounds: WindowBounds | null = null;
export let windowBoundsCaptureInterval: NodeJS.Timeout | null = null;

// ── Native macOS window source cache ─────────────────────────────────────────
export let cachedNativeMacWindowSources: import("./types").NativeMacWindowSource[] | null = null;
export let cachedNativeMacWindowSourcesAtMs = 0;

// ── Native video export ───────────────────────────────────────────────────────
export let cachedNativeVideoEncoder: {
	ffmpegPath: string;
	encodingMode: string;
	encoderName: string;
} | null = null;

// ── Native helper migration ───────────────────────────────────────────────────
export let nativeHelperMigrationPromise: Promise<void> | null = null;

// ── Cursor interaction capture types ─────────────────────────────────────────
export type { CursorInteractionType, CursorTelemetryPoint };

// ── Setters (for modules that need to reassign exported lets) ─────────────────
// TypeScript exported `let` can be reassigned by the owning module but importers
// cannot assign to them directly. Provide simple setters for cross-module writes.

export function setSelectedSource(v: SelectedSource | null) {
	selectedSource = v;
}
export function setCurrentProjectPath(v: string | null) {
	currentProjectPath = v;
}
export function setCurrentVideoPath(v: string | null) {
	currentVideoPath = v;
}
export function setCurrentRecordingSession(v: RecordingSessionData | null) {
	currentRecordingSession = v;
}

export function setNativeScreenRecordingActive(v: boolean) {
	nativeScreenRecordingActive = v;
}
export function setNativeCaptureProcess(v: ChildProcessWithoutNullStreams | null) {
	nativeCaptureProcess = v;
}
export function setNativeCaptureOutputBuffer(v: string) {
	nativeCaptureOutputBuffer = v;
}
export function setNativeCaptureTargetPath(v: string | null) {
	nativeCaptureTargetPath = v;
}
export function setNativeCaptureStopRequested(v: boolean) {
	nativeCaptureStopRequested = v;
}
export function setNativeCaptureSystemAudioPath(v: string | null) {
	nativeCaptureSystemAudioPath = v;
}
export function setNativeCaptureMicrophonePath(v: string | null) {
	nativeCaptureMicrophonePath = v;
}
export function setNativeCapturePaused(v: boolean) {
	nativeCapturePaused = v;
}

export function setNativeCursorMonitorProcess(v: ChildProcessWithoutNullStreams | null) {
	nativeCursorMonitorProcess = v;
}
export function setNativeCursorMonitorOutputBuffer(v: string) {
	nativeCursorMonitorOutputBuffer = v;
}

export function setWindowsCaptureProcess(v: ChildProcessWithoutNullStreams | null) {
	windowsCaptureProcess = v;
}
export function setWindowsCaptureOutputBuffer(v: string) {
	windowsCaptureOutputBuffer = v;
}
export function setWindowsCaptureTargetPath(v: string | null) {
	windowsCaptureTargetPath = v;
}
export function setWindowsNativeCaptureActive(v: boolean) {
	windowsNativeCaptureActive = v;
}
export function setWindowsCaptureStopRequested(v: boolean) {
	windowsCaptureStopRequested = v;
}
export function setWindowsCapturePaused(v: boolean) {
	windowsCapturePaused = v;
}
export function setLinuxCaptureProcess(v: ChildProcessWithoutNullStreams | null) {
	linuxCaptureProcess = v;
}
export function setLinuxCaptureOutputBuffer(v: string) {
	linuxCaptureOutputBuffer = v;
}
export function setLinuxCaptureTargetPath(v: string | null) {
	linuxCaptureTargetPath = v;
}
export function setLinuxCaptureVaapi(v: { ffmpegPath: string; devicePath: string } | null) {
	linuxCaptureVaapi = v;
}
export function setLinuxCaptureNvenc(v: { ffmpegPath: string } | null) {
	linuxCaptureNvenc = v;
}
export function setLinuxNativeCaptureActive(v: boolean) {
	linuxNativeCaptureActive = v;
}
export function setLinuxCaptureStopRequested(v: boolean) {
	linuxCaptureStopRequested = v;
}
export function setLinuxCapturePaused(v: boolean) {
	linuxCapturePaused = v;
}
export function setLinuxCaptureSegmentPath(v: string | null) {
	linuxCaptureSegmentPath = v;
}
export function setLinuxCaptureSegments(v: string[]) {
	linuxCaptureSegments = v;
}
export function setLinuxSystemAudioProcess(v: ChildProcess | null) {
	linuxSystemAudioProcess = v;
}
export function setLinuxSystemAudioSourceName(v: string | null) {
	linuxSystemAudioSourceName = v;
}
export function setLinuxSystemAudioFfmpegPath(v: string | null) {
	linuxSystemAudioFfmpegPath = v;
}
export function setLinuxSystemAudioSegmentPath(v: string | null) {
	linuxSystemAudioSegmentPath = v;
}
export function setLinuxSystemAudioSegments(v: string[]) {
	linuxSystemAudioSegments = v;
}

export function setWindowsSystemAudioPath(v: string | null) {
	windowsSystemAudioPath = v;
}
export function setWindowsMicAudioPath(v: string | null) {
	windowsMicAudioPath = v;
}
export function setWindowsOrphanedMicAudioPath(v: string | null) {
	windowsOrphanedMicAudioPath = v;
}
export function setWindowsPendingVideoPath(v: string | null) {
	windowsPendingVideoPath = v;
}

export function setLastNativeCaptureDiagnostics(v: NativeCaptureDiagnostics | null) {
	lastNativeCaptureDiagnostics = v;
}

export function setFfmpegScreenRecordingActive(v: boolean) {
	ffmpegScreenRecordingActive = v;
}
export function setFfmpegCaptureProcess(v: ChildProcessWithoutNullStreams | null) {
	ffmpegCaptureProcess = v;
}
export function setFfmpegCaptureOutputBuffer(v: string) {
	ffmpegCaptureOutputBuffer = v;
}
export function setFfmpegCaptureTargetPath(v: string | null) {
	ffmpegCaptureTargetPath = v;
}

export function setCustomRecordingsDir(v: string | null) {
	customRecordingsDir = v;
}
export function setRecordingsDirLoaded(v: boolean) {
	recordingsDirLoaded = v;
}

export function setCachedSystemCursorAssets(v: Record<string, SystemCursorAsset> | null) {
	cachedSystemCursorAssets = v;
}
export function setCachedSystemCursorAssetsSourceMtimeMs(v: number | null) {
	cachedSystemCursorAssetsSourceMtimeMs = v;
}

export function setCountdownTimer(v: ReturnType<typeof setInterval> | null) {
	countdownTimer = v;
}
export function setCountdownCancelled(v: boolean) {
	countdownCancelled = v;
}
export function setCountdownInProgress(v: boolean) {
	countdownInProgress = v;
}
export function setCountdownRemaining(v: number | null) {
	countdownRemaining = v;
}

export function setCurrentCursorVisualType(v: CursorVisualType | undefined) {
	currentCursorVisualType = v;
}

export function setCursorCaptureInterval(v: NodeJS.Timeout | null) {
	cursorCaptureInterval = v;
}
export function setCursorCaptureStartTimeMs(v: number) {
	cursorCaptureStartTimeMs = v;
}
export function setCursorCaptureAccumulatedPausedMs(v: number) {
	cursorCaptureAccumulatedPausedMs = v;
}
export function setCursorCapturePauseStartedAtMs(v: number | null) {
	cursorCapturePauseStartedAtMs = v;
}
export function setActiveCursorSamples(v: CursorTelemetryPoint[]) {
	activeCursorSamples = v;
}
export function setPendingCursorSamples(v: CursorTelemetryPoint[]) {
	pendingCursorSamples = v;
}
export function setIsCursorCaptureActive(v: boolean) {
	isCursorCaptureActive = v;
}
export function setInteractionCaptureCleanup(v: (() => void) | null) {
	interactionCaptureCleanup = v;
}
export function setHasLoggedInteractionHookFailure(v: boolean) {
	hasLoggedInteractionHookFailure = v;
}
export function setLastLeftClick(v: { timeMs: number; cx: number; cy: number } | null) {
	lastLeftClick = v;
}
export function setLinuxCursorScreenPoint(v: { x: number; y: number; updatedAt: number } | null) {
	linuxCursorScreenPoint = v;
}
export function setSelectedWindowBounds(v: WindowBounds | null) {
	selectedWindowBounds = v;
}
export function setWindowBoundsCaptureInterval(v: NodeJS.Timeout | null) {
	windowBoundsCaptureInterval = v;
}

export function setCachedNativeMacWindowSources(
	v: import("./types").NativeMacWindowSource[] | null,
) {
	cachedNativeMacWindowSources = v;
}
export function setCachedNativeMacWindowSourcesAtMs(v: number) {
	cachedNativeMacWindowSourcesAtMs = v;
}

export function setCachedNativeVideoEncoder(
	v: { ffmpegPath: string; encodingMode: string; encoderName: string } | null,
) {
	cachedNativeVideoEncoder = v;
}

export function setNativeHelperMigrationPromise(v: Promise<void> | null) {
	nativeHelperMigrationPromise = v;
}
