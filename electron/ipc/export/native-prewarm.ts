import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { app } from "electron";
import type {
	ExportEncoderPreference,
	ExportEncodingMode,
	ExportVideoCodec,
} from "../../../src/lib/exporter/types";
import { APP_SETTINGS_FILE } from "../constants";
import { formatLogTs } from "../log";
import { parseJsonWithByteOrderMark } from "../utils";
import {
	getNativeExportCapabilities,
	type NativeExportPrewarmOutcome,
	nativeStaticLayoutExportSessions,
	nativeVideoExportSessions,
	prewarmNativeExportCaches,
	registerCapabilityOnlyPrewarmChild,
} from "./native-video";

// Key under which the renderer persists normalized editor export preferences in
// the app settings store; mirrors EDITOR_PREFERENCES_STORAGE_KEY.
const EDITOR_PREFERENCES_STORAGE_KEY = "recordly.editor.preferences";

type RouteKey = string;

// Bumped whenever a new recording starts. A prewarm started under an earlier
// generation abandons its remaining work instead of committing stale results,
// so a changed/new recording is never served prewarm data from a prior one.
let prewarmGeneration = 0;

// In-flight dedupe set keyed by exact route (source path + codec + preference).
// Coalesces concurrent requests for the same recorded source; a duplicate is
// ignored without extra logging (dedup is not an error).
const activeRouteKeys = new Set<RouteKey>();

// Most recently completed prewarm route per source path within a generation,
// so an identical route is not re-warmed repeatedly.
const lastCompletedRouteKey = new Map<string, { generation: number; routeKey: RouteKey }>();

function buildRouteKey(
	inputPath: string,
	videoCodec: ExportVideoCodec,
	encoderPreference: ExportEncoderPreference,
): RouteKey {
	return `${inputPath}\u0000${videoCodec}\u0000${encoderPreference}`;
}

// Mirrors the shared high-level export codec/preference defaults (projectPersistence
// normalizeExportVideoCodec / normalizeExportEncoderPreference). Kept local to avoid
// pulling renderer-only modules into the main process; only persists high-level enums,
// never derived encoder names/settings.
function normalizeVideoCodec(value: unknown): ExportVideoCodec {
	return value === "hevc" ? "hevc" : "h264";
}

function normalizeEncoderPreference(value: unknown): ExportEncoderPreference {
	return value === "hardware" || value === "cpu" ? value : "auto";
}

function normalizeEncodingMode(value: unknown): ExportEncodingMode {
	return value === "quality" || value === "fast" ? value : "balanced";
}

export async function readPersistedExportRoute(): Promise<{
	videoCodec: ExportVideoCodec;
	encoderPreference: ExportEncoderPreference;
	encodingMode: ExportEncodingMode;
}> {
	try {
		const content = await fs.readFile(APP_SETTINGS_FILE, "utf-8");
		const parsed = parseJsonWithByteOrderMark<unknown>(content);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { videoCodec: "h264", encoderPreference: "auto", encodingMode: "balanced" };
		}
		const preferences = (parsed as Record<string, unknown>)[EDITOR_PREFERENCES_STORAGE_KEY];
		if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
			return { videoCodec: "h264", encoderPreference: "auto", encodingMode: "balanced" };
		}
		const prefs = preferences as Record<string, unknown>;
		return {
			videoCodec: normalizeVideoCodec(prefs.exportVideoCodec),
			encoderPreference: normalizeEncoderPreference(prefs.exportEncoderPreference),
			encodingMode: normalizeEncodingMode(prefs.exportEncodingMode),
		};
	} catch {
		// Unreadable settings must not block or poison prewarm; fall back to the
		// compatibility default (H.264 + Auto + balanced).
		return { videoCodec: "h264", encoderPreference: "auto", encodingMode: "balanced" };
	}
}

/**
 * Advances the prewarm generation when a new recording starts. Any in-flight
 * prewarm for a prior recording is superseded and abandons its cache commits;
 * in-flight dedupe and completed-route tracking are cleared so the new
 * recording can prewarm fresh.
 */
export function beginNewRecordingGeneration(): void {
	prewarmGeneration += 1;
	activeRouteKeys.clear();
	lastCompletedRouteKey.clear();
}

/**
 * Fire-and-forget asynchronous export prewarming. Callers must NOT await this:
 * it only warms deterministic caches and must never delay the stop/mux IPC
 * response, editor creation, or user cancellation. Skips are logged with an
 * elapsed time and reason; failures are diagnostics-only and never poison the
 * normal export probing/fallback path.
 */
export async function triggerNativeExportPrewarm(inputPath: string): Promise<void> {
	if (!inputPath) {
		return;
	}
	const startedAt = performance.now();
	const generation = prewarmGeneration;
	let videoCodec: ExportVideoCodec;
	let encoderPreference: ExportEncoderPreference;
	let encodingMode: ExportEncodingMode;
	try {
		const route = await readPersistedExportRoute();
		videoCodec = route.videoCodec;
		encoderPreference = route.encoderPreference;
		encodingMode = route.encodingMode;
	} catch {
		videoCodec = "h264";
		encoderPreference = "auto";
		encodingMode = "balanced";
	}
	const routeKey = buildRouteKey(inputPath, videoCodec, encoderPreference);

	// Lightweight NVIDIA CUDA/NVENC capability-only prewarm. Fire-and-forget
	// (never awaited): it only warms driver/NVENC state and never blocks the
	// stop/mux response, editor creation, or user cancellation.
	void warmNvidiaCudaCapabilityOnly(videoCodec);

	if (prewarmGeneration !== generation) {
		logPrewarmSkip(routeKey, "superseded-before-start", startedAt);
		return;
	}
	if (activeRouteKeys.has(routeKey)) {
		// Concurrent duplicate for the exact same route; already in flight.
		return;
	}
	const last = lastCompletedRouteKey.get(inputPath);
	if (last && last.generation === generation && last.routeKey === routeKey) {
		logPrewarmSkip(routeKey, "already-prewarmed", startedAt);
		return;
	}

	activeRouteKeys.add(routeKey);
	console.info(formatLogTs(), "[native-prewarm] start", { routeKey });
	const isSuperseded = () => prewarmGeneration !== generation;

	let outcome: NativeExportPrewarmOutcome;
	try {
		outcome = await prewarmNativeExportCaches({
			inputPath,
			videoCodec,
			encoderPreference,
			encodingMode,
			isSuperseded,
		});
	} catch (error) {
		activeRouteKeys.delete(routeKey);
		console.warn(formatLogTs(), "[native-prewarm] failed (diagnostics-only)", {
			routeKey,
			elapsedMs: Math.round(performance.now() - startedAt),
			error,
		});
		return;
	}
	activeRouteKeys.delete(routeKey);

	if (isSuperseded()) {
		logPrewarmSkip(routeKey, "superseded-during-run", startedAt);
		return;
	}
	lastCompletedRouteKey.set(inputPath, { generation, routeKey });
	console.info(formatLogTs(), "[native-prewarm] complete", {
		routeKey,
		elapsedMs: Math.round(performance.now() - startedAt),
		sourceMetadataCached: outcome.sourceMetadataCached,
		cudaAvailabilityResolved: outcome.cudaAvailabilityResolved,
		resolvedEncoders: outcome.resolvedEncoders,
		skipReasons: outcome.skipReasons,
	});
}

function logPrewarmSkip(routeKey: RouteKey, reason: string, startedAt: number): void {
	console.info(formatLogTs(), "[native-prewarm] skip", {
		routeKey,
		reason,
		elapsedMs: Math.round(performance.now() - startedAt),
	});
}

// ---------------------------------------------------------------------------
// NVIDIA CUDA/NVENC capability-only prewarm
// ---------------------------------------------------------------------------
// Wakes the NVIDIA driver/NVENC state by running the compositor helper's
// capability-only mode (--capability-only), which initializes CUDA, runs the
// NVENC capability probe for the requested codec, emits a small JSON summary
// and exits — no input/output/ffprobe/decode/encode/mux. This is a diagnostics/
// warm-up only: it never promotes a successful probe into the strict
// availability cache (normal export probes remain live) and failures never
// poison availability. It spawns the helper executable directly (never the
// run-mp4-pipeline wrapper), once per exact session/environment/codec key, with
// a short timeout that kills on expiry, no retries, and a skip while a real
// native export is active. Never persists derived encoder names or diagnostics.

// Short bounded timeout for the capability-only warm probe; killed on expiry,
// no retries. Warm-up only — a timeout is diagnostics-only, never poisoning.
const NATIVE_CUDA_COMPOSITOR_CAPABILITY_PREWARM_TIMEOUT_MS = 15_000;

// Capability-only warm keys, keyed by codec + environment signature. Device
// capability is a session-level fact: warming once per (codec, environment) is
// enough, so this set is intentionally NOT reset on a new recording generation
// (unlike the source-route dedup above).
const warmedCapabilityKeys = new Set<string>();

function getNvidiaCudaCapabilityEnvironmentSignature(): string {
	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	return JSON.stringify([
		process.platform,
		process.env.RECORDLY_NVIDIA_CUDA_EXPORT_EXE ?? null,
		process.env.RECORDLY_NVIDIA_CUDA_EXPORT_SCRIPT ?? null,
		resourcesPath ?? null,
		process.cwd(),
		app.getAppPath(),
	]);
}

// Resolves the compositor helper executable (recordly-nvidia-cuda-compositor),
// mirroring run-mp4-pipeline.mjs's resolveNativeProbePath so the prewarm uses
// the same helper path resolution as a real native export.
function resolveNvidiaCudaCompositorExecutablePath(): string | null {
	const configuredPath = process.env.RECORDLY_NVIDIA_CUDA_EXPORT_EXE;
	const platformArch = process.arch === "arm64" ? "win32-arm64" : "win32-x64";
	const candidates = [
		configuredPath,
		path.join(
			process.cwd(),
			"electron",
			"native",
			"nvidia-cuda-compositor",
			"build",
			"Release",
			"recordly-nvidia-cuda-compositor.exe",
		),
		path.join(
			process.cwd(),
			"electron",
			"native",
			"bin",
			platformArch,
			"recordly-nvidia-cuda-compositor.exe",
		),
		path.join(
			app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
			"electron",
			"native",
			"bin",
			platformArch,
			"recordly-nvidia-cuda-compositor.exe",
		),
	].filter((candidate): candidate is string => Boolean(candidate));
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

// Skips the capability warm while a real native export is active so the two
// never contend for the GPU/NVENC session.
function hasActiveNativeExport(): boolean {
	if (nativeVideoExportSessions.size > 0) {
		return true;
	}
	for (const session of nativeStaticLayoutExportSessions.values()) {
		if (!session.terminating && session.currentProcess) {
			return true;
		}
	}
	return false;
}

function parseCapabilityOnlySummary(output: string): {
	success: boolean;
	capabilityOnly: boolean;
	diagnostics?: Record<string, unknown>;
	error?: string;
} | null {
	const line = output
		.trim()
		.split(/\r?\n/)
		.reverse()
		.find((candidate) => candidate.trim().startsWith("{"));
	if (!line) {
		return null;
	}
	try {
		const parsed = JSON.parse(line) as Record<string, unknown>;
		return {
			success: parsed.success === true,
			capabilityOnly: parsed.capabilityOnly === true,
			diagnostics:
				(parsed.nvencDiagnostics as Record<string, unknown> | undefined) ?? undefined,
			error: typeof parsed.error === "string" ? parsed.error : undefined,
		};
	} catch {
		return null;
	}
}

/** Resets the capability-only prewarm dedup set. Test hook only. */
export function resetNvidiaCudaCapabilityPrewarmKeys(): void {
	warmedCapabilityKeys.clear();
}

/**
 * Lightweight CUDA/NVENC capability-only prewarm. Spawns the compositor
 * executable directly (never the wrapper) once per exact session/environment/
 * codec key. Bounded by a short timeout that kills on expiry, no retries, and
 * skipped while a real native export is active. Warm-up/diagnostics only: a
 * successful probe is NOT promoted into the strict availability cache and a
 * failure never poisons availability. Returns a promise that resolves when the
 * warm probe settles so tests can observe completion; callers MUST treat this
 * as fire-and-forget (void) and never block the stop/mux response on it.
 */
export async function warmNvidiaCudaCapabilityOnly(videoCodec: ExportVideoCodec): Promise<void> {
	if (process.platform !== "win32") {
		return;
	}
	const executablePath = resolveNvidiaCudaCompositorExecutablePath();
	if (!executablePath) {
		console.info(formatLogTs(), "[native-prewarm] capability skip", {
			reason: "helper-unavailable",
			capabilityOnly: true,
		});
		return;
	}
	if (typeof getNativeExportCapabilities !== "function") {
		return;
	}
	let capabilities;
	try {
		capabilities = await getNativeExportCapabilities();
	} catch {
		console.info(formatLogTs(), "[native-prewarm] capability skip", {
			reason: "capability-probe-failed",
			capabilityOnly: true,
		});
		return;
	}
	if (!capabilities?.nvidiaCuda?.available) {
		console.info(formatLogTs(), "[native-prewarm] capability skip", {
			reason: capabilities?.nvidiaCuda?.skipReason ?? "cuda-unavailable",
			capabilityOnly: true,
		});
		return;
	}
	if (hasActiveNativeExport()) {
		console.info(formatLogTs(), "[native-prewarm] capability skip", {
			reason: "active-export",
			capabilityOnly: true,
		});
		return;
	}
	const envSignature = getNvidiaCudaCapabilityEnvironmentSignature();
	const capabilityKey = `${videoCodec}\u0000${envSignature}`;
	if (warmedCapabilityKeys.has(capabilityKey)) {
		console.info(formatLogTs(), "[native-prewarm] capability skip", {
			reason: "already-warmed",
			capabilityOnly: true,
		});
		return;
	}
	warmedCapabilityKeys.add(capabilityKey);

	const startedAt = performance.now();
	const args = ["--capability-only", "--output-codec", videoCodec];
	return await new Promise<void>((resolve) => {
		const child = spawn(executablePath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		// Attach a swallowing error listener before the child is tracked for
		// cancellation: a real export (cancelInFlightCapabilityOnlyPrewarms) may
		// kill an already-exited child, and on Windows that emits an 'error' event
		// ("The process <pid> not found"). Any kill must always find a listener, so
		// it can never surface as an uncaught exception; settlement happens through
		// the dedicated handlers below.
		child.on("error", () => {
			/* handled by the dedicated handlers below */
		});
		// Track the child so a real native export can cancel it before opening
		// its own NVENC session (see cancelInFlightCapabilityOnlyPrewarms).
		const unregister = registerCapabilityOnlyPrewarmChild(child);
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timedOut = false;
		const timeout = setTimeout(() => {
			if (settled) {
				return;
			}
			timedOut = true;
			child.kill("SIGKILL");
		}, NATIVE_CUDA_COMPOSITOR_CAPABILITY_PREWARM_TIMEOUT_MS);
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		// A real native export cancels in-flight capability children before it
		// opens its own NVENC session (cancelInFlightCapabilityOnlyPrewarms). When
		// the child already exited (e.g. it completed its probe moments earlier),
		// the kill can emit an 'error' event on the child; without a listener this
		// surfaces as an uncaught "The process <pid> not found" noise line on
		// Windows. Swallow it: the close handler settles the coordinator.
		child.on("error", (error: Error) => {
			if (!settled) {
				stderr += `[prewarm child error] ${error.message}\n`;
				// A real export cancels in-flight capability children before it opens
				// its own NVENC session (cancelInFlightCapabilityOnlyPrewarms). When the
				// child already exited, kill() on Windows emits an 'error' event with
				// the ESRCH message ("The process <pid> not found"). Log it with a
				// timestamp so an operator can attribute the otherwise-bare line to the
				// capability prewarm kill race; the coordinator still settles via the
				// close handler above and this is diagnostics-only.
				if (error.message.includes("not found") && error.message.includes("The process")) {
					console.warn(
						formatLogTs(),
						"[native-prewarm] capability child kill race (process not found); awaiting close to settle",
						{
							message: error.message,
							codec: videoCodec,
						},
					);
				}
			}
		});
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			unregister();
			const summary = timedOut
				? null
				: (parseCapabilityOnlySummary(stdout) ?? parseCapabilityOnlySummary(stderr));
			if (summary?.success && summary.capabilityOnly) {
				console.info(formatLogTs(), "[native-prewarm] capability complete", {
					codec: videoCodec,
					elapsedMs: Math.round(performance.now() - startedAt),
					capabilityOnly: true,
					...summary.diagnostics,
				});
			} else {
				console.warn(
					formatLogTs(),
					"[native-prewarm] capability failed (diagnostics-only)",
					{
						codec: videoCodec,
						elapsedMs: Math.round(performance.now() - startedAt),
						reason: timedOut ? "timeout" : (summary?.error ?? "non-zero-exit"),
						capabilityOnly: true,
						stderr: (stderr || stdout).slice(0, 400),
					},
				);
			}
			resolve();
		};
		child.on("error", finish);
		child.on("close", finish);
	});
}
