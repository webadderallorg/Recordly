import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import {
	parseNativeCaptureResult,
	parseCaptureMetadata,
	parseNativeTiming,
	validateNativeTime,
	type CaptureMetadata,
	type CommittedIOSRecording,
	type IOSAudioFormat,
	type IOSMediaInspection,
	type IOSCaptureMode,
	type IOSVideoFormat,
	type NativeCaptureResult,
	type NativeTime,
	type NativeTiming,
} from "../../../../src/shared/iosCapture";
import { getFfmpegBinaryPath } from "../../ffmpeg/binary";
import { persistRecordingSessionManifest } from "../../project/session";
import {
	availableIOSStorageBytes,
	readIOSJournal,
	resolveIOSArtifact,
	updateIOSJournal,
	type IOSSessionStorage,
} from "./storage";
export type { IOSMediaInspection } from "../../../../src/shared/iosCapture";
export interface IOSFinalizeDependencies {
	inspectMedia: (filePath: string) => Promise<IOSMediaInspection>;
	runFFmpeg?: (args: readonly string[]) => Promise<void>;
	availableBytes?: (directory: string) => Promise<number>;
	persistManifest?: typeof persistRecordingSessionManifest;
	checkpoint?: (
		phase: "native-validated" | "output-renamed" | "before-manifest",
	) => Promise<void>;
}
const zero: NativeTime = { value: "0", timescale: 1 };
export function nativeTimeDifferenceMs(a: NativeTime, b: NativeTime): number {
	if (!validateNativeTime(a) || !validateNativeTime(b)) throw new Error("INVALID_NATIVE_TIME");
	const numerator =
		(BigInt(a.value) * BigInt(b.timescale) - BigInt(b.value) * BigInt(a.timescale)) * 1000n;
	const denominator = BigInt(a.timescale) * BigInt(b.timescale);
	const quotient = numerator / denominator;
	// Limit duration arithmetic after exact common-clock subtraction (seven days).
	if (quotient > 604800000n || quotient < -604800000n) throw new Error("INVALID_MEDIA_DURATION");
	return Number(quotient) + Number(numerator % denominator) / Number(denominator);
}
export function buildAudioAlignment(offsetMs: number): { trimStartMs: number; delayMs: number } {
	if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > 604800000)
		throw new Error("INVALID_AUDIO_OFFSET");
	return { trimStartMs: Math.max(0, -offsetMs), delayMs: Math.max(0, offsetMs) };
}
export function buildIOSFFmpegArguments(input: {
	videoPath: string;
	outputPath: string;
	durationMs: number;
	audio: readonly {
		path: string;
		offsetMs: number;
		channels: number;
		kind?: "device-audio" | "microphone";
	}[];
}): string[] {
	if (
		!Number.isFinite(input.durationMs) ||
		input.durationMs <= 0 ||
		input.durationMs > 604800000 ||
		input.audio.length < 1 ||
		input.audio.length > 2
	)
		throw new Error("INVALID_AUDIO_PLAN");
	const args = ["-hide_banner", "-nostdin", "-n", "-i", input.videoPath];
	const filters: string[] = [];
	const layout =
		input.audio.length === 1 &&
		input.audio[0].channels === 1 &&
		input.audio[0].kind !== "device-audio"
			? "mono"
			: "stereo";
	input.audio.forEach((audio, index) => {
		if (![1, 2].includes(audio.channels)) throw new Error("UNSUPPORTED_CHANNEL_LAYOUT");
		args.push("-i", audio.path);
		const alignment = buildAudioAlignment(audio.offsetMs);
		// Native sidecars already map rate and gaps into host time. Resampling materializes
		// timestamp holes once; never concatenate another silence segment from the journal.
		filters.push(
			`[${index + 1}:a:0]asetpts=PTS-STARTPTS,aresample=48000:async=1:first_pts=0,atrim=start=${alignment.trimStartMs / 1000},asetpts=PTS-STARTPTS,adelay=${alignment.delayMs}:all=1,aformat=sample_rates=48000:channel_layouts=${layout},volume=${input.audio.length === 1 ? 1 : 0.5},apad,atrim=duration=${input.durationMs / 1000}[a${index}]`,
		);
	});
	filters.push(
		input.audio.length === 1
			? "[a0]anull[outa]"
			: `[a0][a1]amix=inputs=2:duration=longest:normalize=0,atrim=duration=${input.durationMs / 1000}[outa]`,
	);
	args.push(
		"-filter_complex",
		filters.join(";"),
		"-map",
		"0:v:0",
		"-map",
		"[outa]",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-b:a",
		layout === "mono" ? "128k" : "192k",
		"-ar",
		"48000",
		"-ac",
		layout === "mono" ? "1" : "2",
		"-t",
		String(input.durationMs / 1000),
		"-movflags",
		"+faststart",
		"-progress",
		"pipe:1",
		input.outputPath,
	);
	return args;
}
export async function runIOSFFmpeg(
	args: readonly string[],
	options: { stallTimeoutMs?: number; binary?: string; signal?: AbortSignal } = {},
): Promise<void> {
	if (options.signal?.aborted) throw new Error("FFMPEG_ABORTED");
	const binary = options.binary ?? getFfmpegBinaryPath();
	await new Promise<void>((resolve, reject) => {
		const child = spawn(binary, [...args], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let lastActivity = Date.now();
		let settled = false;
		let terminationError: Error | undefined;
		let progressBuffer = "";
		const progressValues = new Map<string, bigint>();
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const terminate = (error: Error) => {
			if (settled || terminationError) return;
			terminationError = error;
			child.kill("SIGTERM");
			killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
		};
		const onAbort = () => terminate(new Error("FFMPEG_ABORTED"));
		const watchdog = setInterval(
			() => {
				if (Date.now() - lastActivity > (options.stallTimeoutMs ?? 120000)) {
					terminate(new Error("FFMPEG_STALLED"));
				}
			},
			Math.min(1000, options.stallTimeoutMs ?? 120000),
		);
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearInterval(watchdog);
			options.signal?.removeEventListener("abort", onAbort);
			if (killTimer) clearTimeout(killTimer);
			if (error) reject(error);
			else resolve();
		};
		child.stdout.on("data", (chunk: Buffer) => {
			progressBuffer = (progressBuffer + chunk.toString("utf8")).slice(-65536);
			while (true) {
				const newline = progressBuffer.indexOf("\n");
				if (newline < 0) break;
				const line = progressBuffer.slice(0, newline).trim();
				progressBuffer = progressBuffer.slice(newline + 1);
				const match = /^(out_time_us|frame|total_size)=(\d+)$/.exec(line);
				if (match) {
					const value = BigInt(match[2]);
					if (value > (progressValues.get(match[1]) ?? -1n)) {
						progressValues.set(match[1], value);
						lastActivity = Date.now();
					}
				}
			}
		});
		// Always drain diagnostics, but repeated warnings are not progress.
		child.stderr.on("data", () => undefined);
		child.once("error", finish);
		child.once("close", (code) =>
			finish(terminationError ?? (code === 0 ? undefined : new Error("FFMPEG_FAILED"))),
		);
		options.signal?.addEventListener("abort", onAbort, { once: true });
		// Cover an abort between the initial check and listener registration.
		if (options.signal?.aborted) onAbort();
	});
}
export function validateIOSVideoInspection(
	inspection: IOSMediaInspection,
	format?: IOSVideoFormat,
	expectedDurationMs?: number,
): number {
	const durationMs = nativeTimeDifferenceMs(inspection.duration, zero);
	if (!inspection.decodable || !inspection.video || durationMs <= 0)
		throw new Error("INVALID_VIDEO");
	const v = inspection.video;
	if (v.codedWidth <= 0 || v.codedHeight <= 0 || v.displayWidth <= 0 || v.displayHeight <= 0)
		throw new Error("INVALID_VIDEO_GEOMETRY");
	if (
		format &&
		(v.codedWidth !== format.codedWidth ||
			v.codedHeight !== format.codedHeight ||
			v.displayWidth !== format.displayWidth ||
			v.displayHeight !== format.displayHeight ||
			JSON.stringify(v.transform) !== JSON.stringify(format.transform))
	)
		throw new Error("VIDEO_GEOMETRY_MISMATCH");
	if (
		expectedDurationMs !== undefined &&
		Math.abs(durationMs - expectedDurationMs) >
			Math.max(100, 1000 / (format?.observedFrameRate ?? 30))
	)
		throw new Error("VIDEO_DURATION_MISMATCH");
	return durationMs;
}
export async function readIOSNativeTiming(
	storage: IOSSessionStorage,
	result: NativeCaptureResult,
): Promise<NativeTiming> {
	// Read the helper-owned checkpoint even if stdout carried timing, to retain crash semantics.
	const parsed = JSON.parse(
		await fs.readFile(await resolveIOSArtifact(storage, "native-timing.json"), "utf8"),
	);
	const timing = parseNativeTiming(parsed.timing ?? parsed);
	if (result.timing && JSON.stringify(result.timing) !== JSON.stringify(timing))
		throw new Error("TIMING_MISMATCH");
	return timing;
}
const finalizations = new Map<string, Promise<CommittedIOSRecording>>();
export function finalizeIOSRecording(
	input: { storage: IOSSessionStorage; nativeResult: NativeCaptureResult },
	deps: IOSFinalizeDependencies,
): Promise<CommittedIOSRecording> {
	const existing = finalizations.get(input.storage.directory);
	if (existing) return existing;
	const work = finalize(input, deps);
	finalizations.set(input.storage.directory, work);
	void work
		.finally(() => {
			if (finalizations.get(input.storage.directory) === work)
				finalizations.delete(input.storage.directory);
		})
		.catch(() => undefined);
	return work;
}
async function finalize(
	{ storage, nativeResult }: { storage: IOSSessionStorage; nativeResult: NativeCaptureResult },
	deps: IOSFinalizeDependencies,
): Promise<CommittedIOSRecording> {
	const result = parseNativeCaptureResult(nativeResult);
	if (result.sessionId !== storage.sessionId || result.video.relativeName !== "source-video.mov")
		throw new Error("INVALID_NATIVE_RESULT");
	const journal = await readIOSJournal(storage);
	// A crash after rename must resume from the inspected movie even when optional
	// native sidecars are unavailable; no second encode or alignment pass is needed.
	if (journal.nativeResult && (result.deviceAudio || result.microphone)) {
		const existingOutput = await resolveIOSArtifact(storage, "recording.mov", true);
		const present = await fs
			.stat(existingOutput)
			.then(() => true)
			.catch(() => false);
		if (present) {
			const inspected = await deps.inspectMedia(existingOutput);
			validateIOSVideoInspection(
				inspected,
				result.format,
				nativeTimeDifferenceMs(result.video.duration, zero),
			);
			if (
				!inspected.audio ||
				inspected.audio.sampleRate !== 48000 ||
				inspected.audio.channels !==
					(result.microphone &&
					!result.deviceAudio &&
					(result.microphone.mediaFormat as IOSAudioFormat).channels === 1
						? 1
						: 2)
			)
				throw new Error("INVALID_FINAL_AUDIO");
			return commitIOSResult(
				storage,
				result,
				existingOutput,
				"recording.mov",
				journal.state === "committed",
				deps,
			);
		}
	}
	const source = await resolveIOSArtifact(storage, "source-video.mov");
	const video = await deps.inspectMedia(source);
	if (video.audio) throw new Error("INVALID_NATIVE_VIDEO_TRACKS");
	const durationMs = validateIOSVideoInspection(
		video,
		result.format,
		nativeTimeDifferenceMs(result.video.duration, zero),
	);
	await deps.checkpoint?.("native-validated");
	const artifacts = [result.deviceAudio, result.microphone].filter(
		(a): a is NonNullable<typeof a> => Boolean(a),
	);
	const audio: {
		path: string;
		offsetMs: number;
		channels: number;
		kind?: "device-audio" | "microphone";
	}[] = [];
	if (artifacts.length) {
		const timing = await readIOSNativeTiming(storage, result);
		const kinds = new Set(timing.streams.map((s) => s.mediaKind));
		if (kinds.size !== timing.streams.length) throw new Error("INVALID_TIMING");
		for (const a of artifacts) {
			const expected = a.mediaKind === "device-audio" ? "device-audio.mov" : "microphone.mov";
			if (a.relativeName !== expected) throw new Error("INVALID_NATIVE_RESULT");
			const stream = timing.streams.find((s) => s.mediaKind === a.mediaKind);
			if (!stream || nativeTimeDifferenceMs(stream.firstHostTime, a.firstHostTime) !== 0)
				throw new Error("CLOCK_MAPPING_UNAVAILABLE");
			const p = await resolveIOSArtifact(storage, expected);
			const inspection = await deps.inspectMedia(p);
			const f = a.mediaFormat as IOSAudioFormat;
			if (
				!inspection.decodable ||
				!inspection.audio ||
				inspection.audio.channels !== f.channels ||
				inspection.audio.sampleRate !== f.sampleRate ||
				nativeTimeDifferenceMs(inspection.duration, zero) <= 0
			)
				throw new Error("INVALID_AUDIO");
			audio.push({
				path: p,
				offsetMs: nativeTimeDifferenceMs(stream.firstHostTime, result.video.firstHostTime),
				channels: f.channels,
				kind: a.mediaKind as "device-audio" | "microphone",
			});
		}
	}
	const finalName = audio.length ? "recording.mov" : "source-video.mov";
	if (journal.state === "committed" && journal.committedFile !== finalName)
		throw new Error("ALREADY_COMMITTED");
	if (journal.state !== "committed")
		await updateIOSJournal(storage, { state: "finalising", nativeResult: result });
	const output = await resolveIOSArtifact(storage, finalName, true);
	if (audio.length) {
		let exists = true;
		try {
			await fs.access(output);
		} catch {
			exists = false;
		}
		if (!exists) {
			const bytes = (await fs.stat(source)).size;
			if (
				(await (deps.availableBytes ?? availableIOSStorageBytes)(storage.directory)) <
				bytes + 256 * 1024 ** 2
			)
				throw new Error("DISK_SPACE_LOW");
			const pending = await resolveIOSArtifact(storage, "recording.pending.mov", true);
			await fs.rm(pending, { force: true });
			await (deps.runFFmpeg ?? runIOSFFmpeg)(
				buildIOSFFmpegArguments({
					videoPath: source,
					outputPath: pending,
					durationMs,
					audio,
				}),
			);
			const inspected = await deps.inspectMedia(
				await resolveIOSArtifact(storage, "recording.pending.mov"),
			);
			validateIOSVideoInspection(inspected, result.format, durationMs);
			if (
				!inspected.audio ||
				inspected.audio.sampleRate !== 48000 ||
				inspected.audio.channels !==
					(audio.length === 1 && audio[0].channels === 1 && audio[0].kind === "microphone"
						? 1
						: 2)
			)
				throw new Error("INVALID_FINAL_AUDIO");
			await fs.rename(pending, output);
			await updateIOSJournal(storage, { state: "renamed", committedFile: finalName });
			await deps.checkpoint?.("output-renamed");
		}
		const inspected = await deps.inspectMedia(await resolveIOSArtifact(storage, finalName));
		validateIOSVideoInspection(inspected, result.format, durationMs);
		if (!inspected.audio) throw new Error("INVALID_FINAL_AUDIO");
	}
	return commitIOSResult(storage, result, output, finalName, journal.state === "committed", deps);
}
async function commitIOSResult(
	storage: IOSSessionStorage,
	result: Pick<
		NativeCaptureResult,
		"mode" | "format" | "stopReason" | "deviceAudio" | "microphone"
	>,
	output: string,
	finalName: "recording.mov" | "source-video.mov",
	alreadyCommitted: boolean,
	deps: IOSFinalizeDependencies,
): Promise<CommittedIOSRecording> {
	const captureMetadata: CaptureMetadata = parseCaptureMetadata({
		version: 1,
		sourceKind: "ios-device",
		mode: result.mode,
		format: result.format,
		deviceAudioRecorded: Boolean(result.deviceAudio),
		narrationRecorded: Boolean(result.microphone),
		stopReason: result.stopReason,
		interrupted: !["user-stop", "userStop", "stopped", "stop", "completed"].includes(
			result.stopReason,
		),
	});
	const committed: CommittedIOSRecording = {
		sessionId: storage.sessionId,
		videoPath: output,
		hideOverlayCursorByDefault: true,
		captureMetadata,
	};
	if (!alreadyCommitted) {
		await deps.checkpoint?.("before-manifest");
		await (deps.persistManifest ?? persistRecordingSessionManifest)({
			...committed,
			webcamPath: null,
		});
		await updateIOSJournal(storage, {
			state: "committed",
			committedFile: finalName,
			...(result.deviceAudio || result.microphone
				? {
						outputAudio: {
							codec: "aac",
							sampleRate: 48000,
							channels:
								result.microphone &&
								!result.deviceAudio &&
								(result.microphone.mediaFormat as IOSAudioFormat).channels === 1
									? 1
									: 2,
						},
					}
				: {}),
		});
	}
	return committed;
}

export async function finalizeRecoveredIOSVideo(
	input: { storage: IOSSessionStorage; mode: IOSCaptureMode; format: IOSVideoFormat },
	deps: IOSFinalizeDependencies,
): Promise<CommittedIOSRecording> {
	const { storage, mode, format } = input;
	const journal = await readIOSJournal(storage);
	if (journal.state === "committed" && journal.committedFile !== "source-video.mov")
		throw new Error("ALREADY_COMMITTED");
	const source = await resolveIOSArtifact(storage, "source-video.mov");
	validateIOSVideoInspection(await deps.inspectMedia(source), format);
	return commitIOSResult(
		storage,
		{ mode, format, stopReason: "recovered-interruption" },
		source,
		"source-video.mov",
		journal.state === "committed",
		deps,
	);
}
