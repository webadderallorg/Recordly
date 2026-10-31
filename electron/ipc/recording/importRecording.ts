import { composeSequenceWebcam, sequenceWebcamOutputs } from "./sequenceWebcam";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";
import { isLibrarySequenceSource } from "./sequenceSource";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { rememberApprovedLocalReadPath, resolveApprovedLocalMediaPath } from "../project/manager";
import { getRecordingsDir, getTelemetryPathForVideo } from "../utils";
import { getUsableCompanionAudioCandidates } from "./diagnostics";
import { normalizeCursorTelemetrySamples, writeCursorTelemetry } from "../cursor/telemetry";
import { listRecordings } from "./library";
import type {
	RecordingImportResult,
	RecordingWebcamSource,
} from "../../../src/types/recordingLibrary";

const run = promisify(execFile);
async function ffmpeg(args: string[], signal?: AbortSignal) {
	await run(
		getFfmpegBinaryPath(),
		["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
		{ signal, timeout: 60 * 60 * 1000, maxBuffer: 1024 * 1024, windowsHide: true },
	);
}
async function probe(file: string, signal?: AbortSignal) {
	const meta = await probeNativeVideoMetadata(getFfmpegBinaryPath(), file, signal);
	return {
		width: meta.width,
		height: meta.height,
		fps: meta.frameRate,
		duration: meta.duration,
		audio: meta.hasAudio,
	};
}
type Format = { width: number; height: number; fps: number };

/** Normalize new media once. Existing sequence video is copied, avoiding generation loss. */
async function normalize(
	file: string,
	out: string,
	format: Format,
	copyVideo: boolean,
	signal?: AbortSignal,
) {
	const meta = await probe(file, signal);
	const candidates = await getUsableCompanionAudioCandidates(file);
	const companion = candidates[0];
	const system = companion?.usablePaths.includes(companion.systemPath)
		? companion.systemPath
		: null;
	const mic = companion?.usablePaths.includes(companion.micPath) ? companion.micPath : null;
	const args = ["-i", file];
	const filters: string[] = [];
	let input = 1;
	for (const [kind, source] of [
		["system", system],
		["mic", mic],
	] as const) {
		let label: string;
		let delay = 0;
		if (source) {
			args.push("-i", source);
			label = `${input++}:a:0`;
			try {
				delay = Math.max(
					0,
					Number(JSON.parse(await fs.readFile(`${source}.json`, "utf8")).startDelayMs) ||
						0,
				);
			} catch {
				/* Optional capture timing. */
			}
		} else if (kind === "system" && meta.audio) {
			label = "0:a:0";
		} else {
			args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
			label = `${input++}:a:0`;
		}
		filters.push(
			`[${label}]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=${Math.round(delay)}:all=1,apad,atrim=duration=${meta.duration}[${kind}]`,
		);
	}
	if (!copyVideo)
		filters.push(
			`[0:v:0]setpts=PTS-STARTPTS,scale=${format.width}:${format.height}:force_original_aspect_ratio=decrease,pad=${format.width}:${format.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${format.fps},format=yuv420p[v]`,
		);
	args.push(
		"-filter_complex",
		filters.join(";"),
		"-map",
		copyVideo ? "0:v:0" : "[v]",
		"-map",
		"[system]",
		"-map",
		"[mic]",
		"-c:v",
		copyVideo ? "copy" : "libx264",
	);
	if (!copyVideo) args.push("-preset", "fast", "-crf", "18");
	args.push("-c:a", "pcm_s16le", "-t", String(meta.duration), out);
	await ffmpeg(args, signal);
}

/** The editor and export share one immutable source, with stable offsets across imports. */
export async function importRecording(
	currentPath: string,
	recordingPath: string,
	currentWebcam?: RecordingWebcamSource,
	signal?: AbortSignal,
): Promise<RecordingImportResult> {
	const entry = (await listRecordings()).find((entry) => entry.path === recordingPath);
	if (!entry) throw new Error("Recording is no longer in Videos");
	const current = await resolveApprovedLocalMediaPath(currentPath);
	if (!current) throw new Error("Current video is no longer available");
	const server = getMediaServerBaseUrl();
	if (!server) throw new Error("Media server is not ready");
	const root = path.join(await getRecordingsDir(), ".recordly-media");
	await fs.mkdir(root, { recursive: true });
	const base = await probe(current, signal);
	const format = {
		width: Math.ceil(base.width / 2) * 2,
		height: Math.ceil(base.height / 2) * 2,
		fps: base.fps,
	};
	const id = randomUUID();
	const work = await fs.mkdtemp(path.join(root, "import-"));
	const output = path.join(root, `${id}.mp4`);
	const stem = output.slice(0, -4);
	const outputs = recordingImportOutputs(output);
	try {
		const normalizedBase = path.join(work, "base.mkv");
		const normalizedNew = path.join(work, "new.mkv");
		// Only our own normalized source format may be copied across appends.
		const copyVideo = isLibrarySequenceSource(current);
		await normalize(current, normalizedBase, format, copyVideo, signal);
		await normalize(entry.path, normalizedNew, format, false, signal);
		const baseMeta = await probe(normalizedBase, signal);
		const newMeta = await probe(normalizedNew, signal);
		await fs.writeFile(path.join(work, "list.txt"), "file 'base.mkv'\nfile 'new.mkv'\n");
		const combined = path.join(work, "combined.mkv");
		await ffmpeg(
			[
				"-f",
				"concat",
				"-safe",
				"1",
				"-i",
				path.join(work, "list.txt"),
				"-map",
				"0",
				"-c",
				"copy",
				combined,
			],
			signal,
		);
		await ffmpeg(
			[
				"-i",
				combined,
				"-filter_complex",
				"[0:a:0][0:a:1]amix=inputs=2:normalize=0[mix]",
				"-map",
				"0:v:0",
				"-map",
				"[mix]",
				"-c:v",
				"copy",
				"-c:a",
				"aac",
				"-b:a",
				"192k",
				"-movflags",
				"+faststart",
				output,
				"-map",
				"0:a:0",
				"-c:a",
				"pcm_s16le",
				`${stem}.system.wav`,
				"-map",
				"0:a:1",
				"-c:a",
				"pcm_s16le",
				`${stem}.mic.wav`,
			],
			signal,
		);
		const sourceStartMs = Math.round(baseMeta.duration * 1000);
		const samples = [];
		for (const [file, offset, meta] of [
			[current, 0, base],
			[entry.path, sourceStartMs, await probe(entry.path, signal)],
		] as const) {
			let points: ReturnType<typeof normalizeCursorTelemetrySamples> = [];
			try {
				points = normalizeCursorTelemetrySamples(
					JSON.parse(await fs.readFile(getTelemetryPathForVideo(file), "utf8")),
				);
			} catch {
				/* Recording may not contain cursor telemetry. */
			}
			const scale = Math.min(format.width / meta.width, format.height / meta.height);
			samples.push(
				...points.map((point) => ({
					...point,
					timeMs: point.timeMs + offset,
					cx:
						(point.cx * meta.width * scale + (format.width - meta.width * scale) / 2) /
						format.width,
					cy:
						(point.cy * meta.height * scale +
							(format.height - meta.height * scale) / 2) /
						format.height,
				})),
			);
		}
		await writeCursorTelemetry(output, samples);
		const webcam = await composeSequenceWebcam(
			current,
			entry.path,
			output,
			work,
			sourceStartMs,
			Math.round(newMeta.duration * 1000),
			currentWebcam,
			signal,
		);
		signal?.throwIfAborted();
		await rememberApprovedLocalReadPath(output);
		return {
			path: output,
			webcam,
			url: buildMediaUrl(server, output),
			sourceStartMs,
			durationMs: Math.round(newMeta.duration * 1000),
			totalDurationMs: sourceStartMs + Math.round(newMeta.duration * 1000),
		};
	} catch (error) {
		await Promise.all(outputs.map((file) => fs.rm(file, { force: true })));
		throw error;
	} finally {
		await fs.rm(work, { recursive: true, force: true });
	}
}

function recordingImportOutputs(output: string) {
	const stem = output.slice(0, -4);
	return [
		...sequenceWebcamOutputs(output),
		output,
		`${stem}.system.wav`,
		`${stem}.mic.wav`,
		`${output}.cursor.json`,
	];
}
export async function discardRecordingImport(output: string) {
	await Promise.all(recordingImportOutputs(output).map((file) => fs.rm(file, { force: true })));
}
