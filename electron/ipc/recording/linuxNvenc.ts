import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import {
	getFfmpegBinaryPath,
	resolveSystemFfmpegBinaryPath,
} from "../ffmpeg/binary";
import { parseX11grabDeviceSupport } from "./linuxVaapi";

const execFileAsync = promisify(execFile);

const FFMPEG_PROBE_TIMEOUT_MS = 10_000;

export type LinuxNvencUnavailableReason =
	| "no-nvidia-device"
	| "no-ffmpeg-binary"
	| "no-encoder"
	| "no-x11grab"
	| "encode-test-failed";

export type LinuxNvencAvailability = {
	available: boolean;
	/** ffmpeg binary to record with — the one that passed the nvenc probe. */
	ffmpegPath?: string;
	reason?: LinuxNvencUnavailableReason;
};

/**
 * NVIDIA GPUs don't do VAAPI — they need the NVENC route. Cheap pre-check for
 * the driver's device nodes so non-NVIDIA machines get a clean reason without
 * spawning ffmpeg probes. The real proof stays the encode test below: the
 * device nodes can exist while the encode library or license is missing.
 */
export function findNvidiaDeviceNode(entryNames: string[]): string | null {
	return entryNames.find((entryName) => /^nvidia\d*$/.test(entryName)) ?? null;
}

export function parseNvencEncoderSupport(ffmpegEncodersOutput: string): boolean {
	return /\bh264_nvenc\b/.test(ffmpegEncodersOutput);
}

/**
 * The actual proof: h264_nvenc init dlopens the driver's encode library at
 * runtime, so listing the encoder is not enough — encode a few synthetic
 * frames. This is also what makes static ffmpeg builds viable for NVENC (they
 * only need the nvenc headers at compile time, unlike vaapi/pulse which talk
 * to host libraries).
 */
export async function canEncodeWithNvenc(ffmpegPath: string): Promise<boolean> {
	try {
		await execFileAsync(
			ffmpegPath,
			[
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"testsrc=duration=0.3:size=320x240:rate=30",
				"-c:v",
				"h264_nvenc",
				"-frames:v",
				"5",
				"-f",
				"null",
				"-",
			],
			{ timeout: FFMPEG_PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Picks the first candidate ffmpeg that has h264_nvenc. System install first
 * (the bundled ffmpeg-static build is known to lack the nvenc headers); the
 * bundled binary stays in the list in case a future static build ships them.
 */
export async function pickNvencCapableFfmpeg(
	candidates: Array<string | null | undefined>,
	hasNvencSupport: (ffmpegPath: string) => Promise<boolean>,
): Promise<string | null> {
	const tried = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate || tried.has(candidate)) continue;
		tried.add(candidate);
		if (await hasNvencSupport(candidate)) {
			return candidate;
		}
	}
	return null;
}

export type LinuxNvencProbeDeps = {
	readdir: (path: string) => Promise<string[]>;
	listEncoders: (ffmpegPath: string) => Promise<string>;
	listDevices: (ffmpegPath: string) => Promise<string>;
	encodeTest: (ffmpegPath: string) => Promise<boolean>;
};

export async function runLinuxNvencProbe(
	deps: LinuxNvencProbeDeps,
): Promise<LinuxNvencAvailability> {
	let entryNames: string[];
	try {
		entryNames = await deps.readdir("/dev");
	} catch {
		return { available: false, reason: "no-nvidia-device" };
	}
	if (!findNvidiaDeviceNode(entryNames)) {
		return { available: false, reason: "no-nvidia-device" };
	}

	let ffmpegPath: string;
	try {
		const candidates = [resolveSystemFfmpegBinaryPath(), tryGetBundledFfmpegPath()];
		const nvencFfmpeg = await pickNvencCapableFfmpeg(
			candidates,
			async (candidate) =>
				parseNvencEncoderSupport(await deps.listEncoders(candidate)),
		);
		ffmpegPath = nvencFfmpeg ?? "";
	} catch {
		return { available: false, reason: "no-encoder" };
	}
	if (!ffmpegPath) {
		return { available: false, reason: "no-encoder" };
	}

	try {
		if (!parseX11grabDeviceSupport(await deps.listDevices(ffmpegPath))) {
			return { available: false, reason: "no-x11grab" };
		}
	} catch {
		return { available: false, reason: "no-x11grab" };
	}

	if (!(await deps.encodeTest(ffmpegPath))) {
		return { available: false, reason: "encode-test-failed" };
	}
	return { available: true, ffmpegPath };
}

function tryGetBundledFfmpegPath(): string | null {
	try {
		return getFfmpegBinaryPath();
	} catch {
		return null;
	}
}

const defaultDeps: LinuxNvencProbeDeps = {
	readdir: async (path) => (await fs.readdir(path)).map((entry) => entry.toString()),
	listEncoders: async (ffmpegPath) =>
		(
			await execFileAsync(ffmpegPath, ["-hide_banner", "-encoders"], {
				timeout: FFMPEG_PROBE_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
			})
		).stdout,
	listDevices: async (ffmpegPath) =>
		(
			await execFileAsync(ffmpegPath, ["-hide_banner", "-devices"], {
				timeout: FFMPEG_PROBE_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
			})
		).stdout,
	encodeTest: canEncodeWithNvenc,
};

let probeCache: Promise<LinuxNvencAvailability> | null = null;

export function resetLinuxNvencProbe() {
	probeCache = null;
}

/**
 * One-time check (cached per session) that the machine can hardware-encode
 * the screen recording through NVENC: an NVIDIA device node exists, a
 * candidate ffmpeg ships h264_nvenc AND x11grab, and a real encode succeeds.
 * Only consulted when the VAAPI probe already said no.
 */
export async function getLinuxNvencCapture(): Promise<LinuxNvencAvailability> {
	if (!probeCache) {
		probeCache = runLinuxNvencProbe(defaultDeps).catch((error) => {
			probeCache = null;
			throw error;
		});
	}
	return probeCache;
}
