import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { resolveSystemFfmpegBinaryPath } from "../ffmpeg/binary";

const execFileAsync = promisify(execFile);

const FFMPEG_PROBE_TIMEOUT_MS = 10_000;

export type LinuxVaapiUnavailableReason =
	| "no-render-node"
	| "no-system-ffmpeg"
	| "no-encoder"
	| "no-x11grab"
	| "encode-test-failed";

export type LinuxVaapiAvailability = {
	available: boolean;
	/** ffmpeg binary to record with — always the system install; static builds lack vaapi. */
	ffmpegPath?: string;
	/** GPU render node passed to -vaapi_device, e.g. "/dev/dri/renderD128". */
	devicePath?: string;
	reason?: LinuxVaapiUnavailableReason;
};

/** Picks the first VAAPI render node (e.g. renderD128) from a /dev/dri listing. */
export function findVaapiRenderNode(entryNames: string[]): string | null {
	const name = entryNames
		.filter((entryName) => /^renderD\d+$/.test(entryName))
		.sort()[0];
	return name ? `/dev/dri/${name}` : null;
}

export function parseVaapiEncoderSupport(ffmpegEncodersOutput: string): boolean {
	return /\bh264_vaapi\b/.test(ffmpegEncodersOutput);
}

export function parseX11grabDeviceSupport(ffmpegDevicesOutput: string): boolean {
	return /\bx11grab\b/.test(ffmpegDevicesOutput);
}

/**
 * The actual proof: listing h264_vaapi is not enough (drivers can expose the
 * encoder yet fail at init), so encode a few synthetic frames to the device.
 */
export async function canEncodeWithVaapi(
	ffmpegPath: string,
	devicePath: string,
): Promise<boolean> {
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
				"-vf",
				"format=nv12,hwupload",
				"-vaapi_device",
				devicePath,
				"-c:v",
				"h264_vaapi",
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

export type LinuxVaapiProbeDeps = {
	readdir: (path: string) => Promise<string[]>;
	listEncoders: (ffmpegPath: string) => Promise<string>;
	listDevices: (ffmpegPath: string) => Promise<string>;
	encodeTest: (ffmpegPath: string, devicePath: string) => Promise<boolean>;
};

export async function runLinuxVaapiProbe(
	deps: LinuxVaapiProbeDeps,
): Promise<LinuxVaapiAvailability> {
	let entryNames: string[];
	try {
		entryNames = await deps.readdir("/dev/dri");
	} catch {
		return { available: false, reason: "no-render-node" };
	}
	const devicePath = findVaapiRenderNode(entryNames);
	if (!devicePath) {
		return { available: false, reason: "no-render-node" };
	}

	// Recording uses the system install for VAAPI: the bundled ffmpeg-static
	// build has no vaapi support (like its missing pulse device).
	const systemFfmpeg = resolveSystemFfmpegBinaryPath();
	if (!systemFfmpeg) {
		return { available: false, reason: "no-system-ffmpeg" };
	}

	try {
		if (!parseVaapiEncoderSupport(await deps.listEncoders(systemFfmpeg))) {
			return { available: false, reason: "no-encoder" };
		}
		if (!parseX11grabDeviceSupport(await deps.listDevices(systemFfmpeg))) {
			return { available: false, reason: "no-x11grab" };
		}
	} catch {
		return { available: false, reason: "no-encoder" };
	}

	if (!(await deps.encodeTest(systemFfmpeg, devicePath))) {
		return { available: false, reason: "encode-test-failed" };
	}
	return { available: true, ffmpegPath: systemFfmpeg, devicePath };
}

const defaultDeps: LinuxVaapiProbeDeps = {
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
	encodeTest: canEncodeWithVaapi,
};

let probeCache: Promise<LinuxVaapiAvailability> | null = null;

export function resetLinuxVaapiProbe() {
	probeCache = null;
}

/**
 * One-time check (cached per session) that the machine can hardware-encode the
 * screen recording: a GPU render node exists, the system ffmpeg ships
 * h264_vaapi AND x11grab, and a real encode to the device succeeds.
 */
export async function getLinuxVaapiCapture(): Promise<LinuxVaapiAvailability> {
	if (!probeCache) {
		probeCache = runLinuxVaapiProbe(defaultDeps).catch((error) => {
			probeCache = null;
			throw error;
		});
	}
	return probeCache;
}
