import type { ChildProcessByStdio } from "node:child_process";
import type { Writable } from "node:stream";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import {
	getFfmpegBinaryPath,
	resolveSystemFfmpegBinaryPath,
} from "../ffmpeg/binary";

type SystemAudioProcess = ChildProcessByStdio<Writable, null, null>;

const execFileAsync = promisify(execFile);

const PACTL_TIMEOUT_MS = 5000;
const FFMPEG_PROBE_TIMEOUT_MS = 10_000;

export type LinuxSystemAudioUnavailableReason = "no-pulse-device" | "no-monitor-source";

export type LinuxSystemAudioAvailability = {
	available: boolean;
	/** PulseAudio/PipeWire source to record, e.g. "<default-sink>.monitor". */
	sourceName?: string;
	/** The ffmpeg binary that passed the pulse-support probe; use it for capture. */
	ffmpegPath?: string;
	reason?: LinuxSystemAudioUnavailableReason;
};

export function parseDefaultSinkName(pactlOutput: string): string | null {
	const match = pactlOutput.match(/^(\S+)\s*$/m);
	return match?.[1] ?? null;
}

export function parsePactlSourceNames(pactlListShortOutput: string): string[] {
	return pactlListShortOutput
		.split(/\r?\n/)
		.map((line) => line.trim().split(/\t+/)[1])
		.filter((name): name is string => Boolean(name));
}

export function resolveMonitorSourceName(
	defaultSink: string | null,
	sourceNames: string[],
): string | null {
	const expected = defaultSink ? `${defaultSink}.monitor` : null;
	if (expected && sourceNames.includes(expected)) {
		return expected;
	}
	return sourceNames.find((sourceName) => sourceName.endsWith(".monitor")) ?? null;
}

/**
 * Picks the first candidate ffmpeg that supports the pulse device. The bundled
 * binary is tried first (keeps behaviour self-contained when possible); the
 * system install is the fallback for builds like ffmpeg-static that lack it.
 */
export async function pickPulseCapableFfmpeg(
	candidates: Array<string | null | undefined>,
	hasPulseSupport: (ffmpegPath: string) => Promise<boolean>,
): Promise<string | null> {
	const tried = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate || tried.has(candidate)) continue;
		tried.add(candidate);
		if (await hasPulseSupport(candidate)) {
			return candidate;
		}
	}
	return null;
}

export async function hasPulseDeviceSupport(ffmpegPath: string): Promise<boolean> {
	try {
		const devices = await execFileAsync(ffmpegPath, ["-hide_banner", "-devices"], {
			timeout: FFMPEG_PROBE_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
		});
		return /\bpulse\b/.test(devices.stdout);
	} catch {
		return false;
	}
}

function buildFfmpegCandidates(): string[] {
	let bundled: string | null = null;
	try {
		bundled = getFfmpegBinaryPath();
	} catch {
		bundled = null;
	}
	return [bundled, resolveSystemFfmpegBinaryPath()].filter(
		(candidate): candidate is string => Boolean(candidate),
	);
}

let probeCache: Promise<LinuxSystemAudioAvailability> | null = null;

export function resetLinuxSystemAudioProbe() {
	probeCache = null;
}

/**
 * Resolves the PulseAudio source that mirrors the default output ("monitor")
 * plus the ffmpeg binary that can record it. pactl is optional: without it we
 * optimistically use the Pulse special name @DEFAULT_MONITOR@, which modern
 * PulseAudio/PipeWire servers resolve.
 */
export async function getLinuxSystemAudioCapture(): Promise<LinuxSystemAudioAvailability> {
	if (!probeCache) {
		probeCache = probeLinuxSystemAudioCapture().catch((error) => {
			probeCache = null;
			throw error;
		});
	}
	return probeCache;
}

async function probeLinuxSystemAudioCapture(): Promise<LinuxSystemAudioAvailability> {
	let defaultSink: string | null = null;
	let sourceNames: string[] = [];
	let pactlSucceeded = false;

	try {
		const [sinkResult, sourcesResult] = await Promise.all([
			execFileAsync("pactl", ["get-default-sink"], { timeout: PACTL_TIMEOUT_MS }),
			execFileAsync("pactl", ["list", "short", "sources"], { timeout: PACTL_TIMEOUT_MS }),
		]);
		defaultSink = parseDefaultSinkName(sinkResult.stdout.trim());
		sourceNames = parsePactlSourceNames(sourcesResult.stdout);
		pactlSucceeded = true;
	} catch {
		// pactl missing or failed — fall through to the special-name fallback.
	}

	const ffmpegPath = await pickPulseCapableFfmpeg(
		buildFfmpegCandidates(),
		hasPulseDeviceSupport,
	);
	if (!ffmpegPath) {
		return { available: false, reason: "no-pulse-device" };
	}

	const resolved = resolveMonitorSourceName(defaultSink, sourceNames);
	if (resolved) {
		return { available: true, sourceName: resolved, ffmpegPath };
	}
	if (pactlSucceeded) {
		// The sound server answered but exposes no monitor source at all.
		return { available: false, reason: "no-monitor-source" };
	}
	return { available: true, sourceName: "@DEFAULT_MONITOR@", ffmpegPath };
}

export function buildSystemAudioArgs(sourceName: string, outputPath: string): string[] {
	// No `-nostdin` here: the segment lifecycle stops ffmpeg by sending "q" on
	// stdin, which ffmpeg only reads when stdin interaction is enabled.
	return [
		"-y",
		"-hide_banner",
		"-f",
		"pulse",
		"-i",
		sourceName,
		"-ac",
		"2",
		"-ar",
		"48000",
		"-c:a",
		"pcm_s16le",
		outputPath,
	];
}

const AUDIO_START_READINESS_MS = 900;
const AUDIO_STOP_TIMEOUT_MS = 15_000;

/**
 * Spawns one system-audio segment. Mirrors the video segment lifecycle 1:1 so
 * pause boundaries cut both streams at the same wall-clock moments. Callers
 * must register the process in their state synchronously (so pause/stop can
 * never miss it) and use waitForLinuxSystemAudioSegmentStart for readiness.
 */
export function spawnLinuxSystemAudioSegment(
	ffmpegPath: string,
	sourceName: string,
	segmentPath: string,
): SystemAudioProcess {
	return spawn(
		ffmpegPath,
		buildSystemAudioArgs(sourceName, segmentPath),
		{ stdio: ["pipe", "ignore", "ignore"] },
	) as SystemAudioProcess;
}

/**
 * Readiness heuristic matching the video capture path: resolve once ffmpeg
 * survives a short quiescence window, reject if it exits or errors first.
 */
export function waitForLinuxSystemAudioSegmentStart(proc: SystemAudioProcess) {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			proc.off("exit", onExit);
			proc.off("error", onError);
		};
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, AUDIO_START_READINESS_MS);
		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					`System audio capture exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		proc.once("error", onError);
		proc.once("exit", onExit);
	});
}

export function stopLinuxSystemAudioSegment(
	proc: SystemAudioProcess,
	segmentPath: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
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
					// already gone
				}
				reject(new Error("Timed out waiting for system audio capture to stop"));
			});
		}, AUDIO_STOP_TIMEOUT_MS);
		const onClose = (code: number | null) => {
			finish(async () => {
				try {
					await fs.access(segmentPath);
					resolve(segmentPath);
				} catch {
					reject(
						new Error(
							`System audio capture exited without output (code ${code ?? "unknown"})`,
						),
					);
				}
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
		try {
			proc.stdin.write("q\n");
		} catch (error) {
			finish(() => {
				reject(error instanceof Error ? error : new Error(String(error)));
			});
		}
	});
}
