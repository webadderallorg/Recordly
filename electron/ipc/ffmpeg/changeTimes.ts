import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfprobeBinaryPath } from "./binary";

const execFileAsync = promisify(execFile);

export const MAX_CHANGE_TIMES = 50_000;
const MAX_CHANGE_TIME_SOURCE_MS = 20 * 60_000;
const KEEPALIVE_MIN_GAP_MS = 150;
const KEEPALIVE_SIZE_MULTIPLE = 2.5;
const PROBE_TIMEOUT_MS = 15_000;

interface VideoPacket {
	timeMs: number;
	bytes: number;
	keyframe: boolean;
}

function parseVideoPackets(probeOutput: string, durationMs: number): VideoPacket[] {
	const packets: VideoPacket[] = [];
	for (const line of probeOutput.split("\n")) {
		const [time, size, flags] = line.split(",");
		const seconds = Number.parseFloat(time);
		const bytes = Number.parseInt(size, 10);
		if (!Number.isFinite(seconds) || !Number.isFinite(bytes) || bytes <= 0) continue;
		const timeMs = Math.round(seconds * 1000);
		if (timeMs < 0 || timeMs > durationMs) continue;
		packets.push({ timeMs, bytes, keyframe: (flags ?? "").includes("K") });
	}
	return packets.sort((a, b) => a.timeMs - b.timeMs);
}

function keepaliveSizeLimitFor(packets: VideoPacket[]): number {
	let smallestInterFrameBytes = Number.POSITIVE_INFINITY;
	let largestInterFrameBytes = 0;
	for (const packet of packets) {
		if (packet.keyframe) continue;
		smallestInterFrameBytes = Math.min(smallestInterFrameBytes, packet.bytes);
		largestInterFrameBytes = Math.max(largestInterFrameBytes, packet.bytes);
	}
	const limit = smallestInterFrameBytes * KEEPALIVE_SIZE_MULTIPLE;
	return limit < largestInterFrameBytes ? limit : 0;
}

export function selectChangeTimesMs(probeOutput: string, durationMs: number): number[] {
	const packets = parseVideoPackets(probeOutput, durationMs);
	const keepaliveSizeLimit = keepaliveSizeLimitFor(packets);
	const times: number[] = [];
	let previousTimeMs = Number.NEGATIVE_INFINITY;
	for (const packet of packets) {
		const redrew =
			packet.keyframe ||
			packet.bytes > keepaliveSizeLimit ||
			packet.timeMs - previousTimeMs < KEEPALIVE_MIN_GAP_MS;
		previousTimeMs = packet.timeMs;
		if (redrew && times[times.length - 1] !== packet.timeMs) times.push(packet.timeMs);
	}
	const stride = Math.ceil(times.length / MAX_CHANGE_TIMES);
	return stride > 1 ? times.filter((_, index) => index % stride === 0) : times;
}

export async function extractScreenChangeTimesMs(
	videoPath: string,
	durationMs: number,
): Promise<number[] | null> {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		console.warn("[change-times] Skipped: the recording has no usable duration.");
		return null;
	}
	if (durationMs > MAX_CHANGE_TIME_SOURCE_MS) {
		console.warn(
			`[change-times] Skipped: the recording runs ${Math.round(durationMs / 60_000)} minutes, past the ${MAX_CHANGE_TIME_SOURCE_MS / 60_000} minute limit.`,
		);
		return null;
	}
	const { stdout } = await execFileAsync(
		getFfprobeBinaryPath(),
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"packet=pts_time,size,flags",
			"-of",
			"csv=p=0",
			videoPath,
		],
		{
			maxBuffer: 256 * 1024 * 1024,
			windowsHide: true,
			timeout: PROBE_TIMEOUT_MS,
			killSignal: "SIGKILL",
		},
	);
	const times = selectChangeTimesMs(stdout, durationMs);
	return times.length > 0 ? times : null;
}
