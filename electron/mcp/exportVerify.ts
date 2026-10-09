import fs from "node:fs/promises";
import path from "node:path";
import { describeFfmpegError } from "./ffmpegError";
import type { RunFfmpeg } from "./remoteEditor";

export const DEFAULT_VERIFY_SAMPLES = 8;
export const MIN_VERIFY_SAMPLES = 1;
export const MAX_VERIFY_SAMPLES = 32;
export const EDGE_SKIP_MS = 200;
export const BLACK_LUMA_MAX = 20;
export const FLAT_LUMA_SPREAD_MAX = 3;
export const CARD_MARK_SPREAD_MIN = 40;
const PROBE_TIMEOUT_MS = 20_000;
const FRAME_TIMEOUT_MS = 20_000;
const DURATION = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;

export type ExportVerification = {
	checked: number;
	emptyAtMs: number[];
	warnings: string[];
};

type FrameKind = "black" | "flat" | "content";

export type CardSpan = { startMs: number; endMs: number };

type LumaStats = { ylow: number; yhigh: number; ymin?: number; ymax?: number };

export function classifyLuma(stats: LumaStats): FrameKind {
	if (stats.yhigh <= BLACK_LUMA_MAX) return "black";
	if (stats.yhigh - stats.ylow <= FLAT_LUMA_SPREAD_MAX) return "flat";
	return "content";
}

function parseStats(output: string) {
	const read = (key: string) => {
		const matched = new RegExp(`lavfi\\.signalstats\\.${key}=(\\d+(?:\\.\\d+)?)`).exec(output);
		return matched ? Number(matched[1]) : Number.NaN;
	};
	const ylow = read("YLOW");
	const yhigh = read("YHIGH");
	if (!Number.isFinite(ylow) || !Number.isFinite(yhigh)) return null;
	const ymin = read("YMIN");
	const ymax = read("YMAX");
	return Number.isFinite(ymin) && Number.isFinite(ymax)
		? { ylow, yhigh, ymin, ymax }
		: { ylow, yhigh };
}

function sampleTimes(durationMs: number, samples: number) {
	const start = EDGE_SKIP_MS;
	const end = durationMs - EDGE_SKIP_MS;
	if (end <= start) return [Math.round(durationMs / 2)];
	const step = (end - start) / samples;
	return Array.from({ length: samples }, (_, index) => Math.round(start + step * (index + 0.5)));
}

async function probeDurationMs(
	binary: string,
	filePath: string,
	runFfmpeg: RunFfmpeg,
	signal?: AbortSignal,
) {
	let text = "";
	try {
		text = (
			await runFfmpeg(binary, ["-hide_banner", "-i", filePath], {
				timeoutMs: PROBE_TIMEOUT_MS,
				signal,
			})
		).toString();
	} catch (error) {
		// ffmpeg -i with no output exits non-zero but prints the facts on stderr
		const stderr = (error as { stderr?: Buffer | string }).stderr?.toString();
		if (!stderr || !DURATION.test(stderr)) throw error;
		text = stderr;
	}
	const matched = DURATION.exec(text);
	if (!matched) return null;
	const [, hours, minutes, seconds] = matched;
	const ms = Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
	return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export async function verifyExportedFrames(
	filePath: string,
	opts: {
		binary: string;
		runFfmpeg: RunFfmpeg;
		durationMs?: number;
		samples?: number;
		cardSpans?: CardSpan[];
		signal?: AbortSignal;
	},
): Promise<ExportVerification> {
	const { binary, runFfmpeg, signal } = opts;
	const samples = opts.samples ?? DEFAULT_VERIFY_SAMPLES;
	if (
		!Number.isInteger(samples) ||
		samples < MIN_VERIFY_SAMPLES ||
		samples > MAX_VERIFY_SAMPLES
	) {
		throw new Error(
			`samples must be a whole number from ${MIN_VERIFY_SAMPLES} to ${MAX_VERIFY_SAMPLES}.`,
		);
	}
	if (
		opts.durationMs !== undefined &&
		!(Number.isFinite(opts.durationMs) && opts.durationMs > 0)
	) {
		throw new Error("durationMs must be more than 0.");
	}
	if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
		throw new Error("The exported file's path must be absolute.");
	}
	const stat = await fs.stat(filePath).catch(() => null);
	if (!stat) throw new Error(`There is no exported file at ${filePath}.`);
	if (!stat.isFile()) throw new Error(`${filePath} is a folder, not a file.`);
	if (stat.size <= 0) throw new Error(`The exported file at ${filePath} is empty.`);

	const result: ExportVerification = { checked: 0, emptyAtMs: [], warnings: [] };
	const unverified = (reason: string) => {
		result.warnings.push(`The exported video could not be checked for blank frames: ${reason}`);
		return result;
	};

	let durationMs = opts.durationMs ?? null;
	if (durationMs === null) {
		try {
			durationMs = await probeDurationMs(binary, filePath, runFfmpeg, signal);
		} catch (error) {
			return unverified(describeFfmpegError(error, PROBE_TIMEOUT_MS));
		}
		if (durationMs === null) return unverified("FFmpeg could not read its length.");
	}

	const kinds: Record<"black" | "flat", number[]> = { black: [], flat: [] };
	const unreadable: number[] = [];
	const times = sampleTimes(durationMs, samples);
	for (const atMs of times) {
		if (signal?.aborted) {
			return unverified(
				`the check was canceled after ${result.checked} of ${times.length} frames.`,
			);
		}
		let stats: ReturnType<typeof parseStats> = null;
		try {
			const out = await runFfmpeg(
				binary,
				[
					"-hide_banner",
					"-nostats",
					"-loglevel",
					"error",
					"-ss",
					(atMs / 1000).toFixed(3),
					"-i",
					filePath,
					"-frames:v",
					"1",
					"-vf",
					"signalstats,metadata=mode=print:file=-",
					"-f",
					"null",
					"-",
				],
				{ timeoutMs: FRAME_TIMEOUT_MS, signal },
			);
			stats = parseStats(out.toString());
		} catch (error) {
			if (signal?.aborted) {
				return unverified(
					`the check was canceled after ${result.checked} of ${times.length} frames.`,
				);
			}
			result.warnings.push(
				`The frame at ${seconds(atMs)} could not be decoded: ${describeFfmpegError(error, FRAME_TIMEOUT_MS)}`,
			);
			continue;
		}
		if (!stats) {
			unreadable.push(atMs);
			continue;
		}
		result.checked++;
		let kind = classifyLuma(stats);
		if (
			kind !== "content" &&
			stats.ymin !== undefined &&
			stats.ymax !== undefined &&
			stats.ymax - stats.ymin >= CARD_MARK_SPREAD_MIN &&
			opts.cardSpans?.some((span) => atMs >= span.startMs && atMs < span.endMs)
		) {
			kind = "content";
		}
		if (kind !== "content") {
			kinds[kind].push(atMs);
			result.emptyAtMs.push(atMs);
		}
	}

	if (unreadable.length > 0) {
		result.warnings.push(
			`FFmpeg returned no picture at ${unreadable.map(seconds).join(", ")}, so those moments were not checked.`,
		);
	}
	const share = durationMs / times.length;
	const describe = (list: number[], what: string) =>
		list.length > 0 &&
		result.warnings.push(
			`${seconds(share * list.length)} of frames ${what} (${list.map(seconds).join(", ")})`,
		);
	describe(kinds.black, "are completely black");
	describe(kinds.flat, "are a single flat colour with no video content");
	if (result.checked === 0 && result.warnings.length === 0) {
		result.warnings.push("The exported video could not be checked for blank frames.");
	}
	return result;
}
