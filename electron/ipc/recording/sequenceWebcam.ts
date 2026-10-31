import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";
import { resolveRecordingSession, persistRecordingSessionManifest } from "../project/session";
import { rememberApprovedLocalReadPath, resolveApprovedLocalMediaPath } from "../project/manager";
import type { RecordingWebcamSource } from "../../../src/types/recordingLibrary";

const run = promisify(execFile);
type Range = { startMs: number; endMs: number };
const rangesPath = (video: string) => `${video}.webcam-ranges.json`;
export const sequenceWebcamOutputs = (video: string) => [
	video.replace(/\.mp4$/, "-webcam.mp4"),
	video.replace(/\.mp4$/, ".recordly-session.json"),
	rangesPath(video),
];
async function linked(video: string): Promise<RecordingWebcamSource | undefined> {
	const session = await resolveRecordingSession(video);
	if (!session?.webcamPath) return undefined;
	const webcamPath = await fs.realpath(session.webcamPath);
	if (path.dirname(webcamPath) !== path.dirname(video))
		throw new Error("Linked webcam is outside the recording folder");
	let visibleRanges: Range[] | undefined;
	try {
		visibleRanges = JSON.parse(await fs.readFile(rangesPath(video), "utf8"));
	} catch {
		/* Original recordings have no range file. */
	}
	return { sourcePath: webcamPath, timeOffsetMs: session.timeOffsetMs ?? 0, visibleRanges };
}
async function ffmpeg(args: string[], signal?: AbortSignal) {
	await run(
		getFfmpegBinaryPath(),
		["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
		{ signal, timeout: 60 * 60 * 1000, maxBuffer: 1024 * 1024 },
	);
}

/** Keep webcam media separate from the screen, including blank spans for screen-only clips. */
export async function composeSequenceWebcam(
	current: string,
	added: string,
	output: string,
	work: string,
	baseDurationMs: number,
	addedDurationMs: number,
	currentWebcam?: RecordingWebcamSource,
	signal?: AbortSignal,
) {
	const base = currentWebcam === undefined ? await linked(current) : currentWebcam;
	if (currentWebcam?.sourcePath) {
		const approved = await resolveApprovedLocalMediaPath(currentWebcam.sourcePath);
		if (!approved) throw new Error("Current webcam is no longer available");
		base!.sourcePath = approved;
	}
	const next = await linked(added);
	const firstPath = base?.sourcePath || next?.sourcePath;
	if (!firstPath) return undefined;
	const meta = await probeNativeVideoMetadata(getFfmpegBinaryPath(), firstPath, signal);
	const width = Math.ceil(meta.width / 2) * 2;
	const height = Math.ceil(meta.height / 2) * 2;
	const ranges: Range[] = [];
	for (const [index, source, durationMs, offsetMs] of [
		[0, base, baseDurationMs, 0],
		[1, next, addedDurationMs, baseDurationMs],
	] as const) {
		const duration = durationMs / 1000;
		const args: string[] = [];
		let filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
		if (source?.sourcePath) {
			const info = await probeNativeVideoMetadata(
				getFfmpegBinaryPath(),
				source.sourcePath,
				signal,
			);
			const delayMs = Number.isFinite(source.timeOffsetMs) ? source.timeOffsetMs : 0;
			args.push("-i", source.sourcePath);
			filter = `trim=start=${Math.max(0, -delayMs) / 1000},setpts=PTS-STARTPTS,${filter},tpad=start_mode=add:start_duration=${Math.max(0, delayMs) / 1000}:stop_mode=add:stop_duration=${duration},trim=duration=${duration}`;
			const active = source.visibleRanges ?? [
				{
					startMs: Math.max(0, delayMs),
					endMs: Math.min(durationMs, info.duration * 1000 + delayMs),
				},
			];
			for (const range of active) {
				if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) continue;
				const startMs = Math.max(0, range.startMs);
				const endMs = Math.min(durationMs, range.endMs);
				if (endMs > startMs)
					ranges.push({ startMs: offsetMs + startMs, endMs: offsetMs + endMs });
			}
		} else {
			args.push("-f", "lavfi", "-i", `color=c=black:s=${width}x${height}:r=30:d=${duration}`);
		}
		await ffmpeg(
			[
				...args,
				"-an",
				"-vf",
				filter,
				"-t",
				String(duration),
				"-c:v",
				"libx264",
				"-preset",
				"fast",
				"-crf",
				"18",
				path.join(work, `webcam-${index}.mp4`),
			],
			signal,
		);
	}
	await fs.writeFile(
		path.join(work, "webcam-list.txt"),
		"file 'webcam-0.mp4'\nfile 'webcam-1.mp4'\n",
	);
	const webcamPath = sequenceWebcamOutputs(output)[0];
	await ffmpeg(
		[
			"-f",
			"concat",
			"-safe",
			"1",
			"-i",
			path.join(work, "webcam-list.txt"),
			"-an",
			"-c:v",
			"copy",
			"-movflags",
			"+faststart",
			webcamPath,
		],
		signal,
	);
	await persistRecordingSessionManifest({ videoPath: output, webcamPath, timeOffsetMs: 0 });
	await fs.writeFile(rangesPath(output), JSON.stringify(ranges));
	await rememberApprovedLocalReadPath(webcamPath);
	return { sourcePath: webcamPath, timeOffsetMs: 0, visibleRanges: ranges };
}
