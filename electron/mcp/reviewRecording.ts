import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { type IpcMain, ipcMain, type WebContents } from "electron";
import { getFfmpegBinaryPath } from "../ipc/ffmpeg/binary";
import { type AgentActivityLog, readAgentActivity } from "./agentActivity";
import type { RemoteControl } from "./remoteControl";
import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS } from "./screenshot";

const EDITOR_READY_TIMEOUT_MS = 45_000;
const EDITOR_REPLY_TIMEOUT_MS = 10_000;
const SHEET_TIMEOUT_MS = 30_000;
const STILL_TIMEOUT_MS = 90_000;
const MAX_STILL_CHECK_MS = 10 * 60_000;
const MAX_TILES = 9;
const TILE_GAP = 6;
const END_FRAME_BACKOFF_MS = 200;
const SAME_FRAME_MS = 20;
const FREEZE_FILTER = "freezedetect=n=-60dB:d=1";

const execFileAsync = promisify(execFile);

export type RecordingReview = {
	summary: {
		videoPath: string;
		rawDurationMs: number;
		finalDurationMs: number;
		removedMs: number;
		cuts: number;
		zooms: number;
		captions: number;
		scenes: number;
		failedScenes: number;
		longestStillMs: number;
		longestStillNote?: string;
		frames: { timeMs: number; label: string }[];
	};
	image: { data: string; mimeType: "image/jpeg"; width: number; height: number };
};

type Range = { startMs: number; endMs: number };
export type ReviewClip = Range & { sourceStartMs: number; sourceEndMs: number; speed: number };
export type ReviewFrame = { timeMs: number; sourceMs: number; label: string };
export type SheetPlan = ReturnType<typeof planSheet>;
type RunFfmpeg = (
	binary: string,
	args: string[],
	opts: { timeoutMs: number; signal: AbortSignal },
) => Promise<{ stdout: Buffer; stderr: string }>;

const byStart = (a: Range, b: Range) => a.startMs - b.startMs;

export function mergeRanges(ranges: Range[]) {
	const merged: Range[] = [];
	for (const range of [...ranges].sort(byStart)) {
		const last = merged[merged.length - 1];
		if (last && range.startMs - last.endMs <= SAME_FRAME_MS) {
			last.endMs = Math.max(last.endMs, range.endMs);
		} else {
			merged.push({ ...range });
		}
	}
	return merged;
}

export function normalizeClips({ clips, sourceDurationMs }: RemoteReviewTimeline): ReviewClip[] {
	const normalized = clips
		.flatMap((clip) => {
			if (![clip.startMs, clip.endMs, clip.sourceStartMs].every(Number.isFinite)) return [];
			const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
			const sourceStartMs = Math.max(0, clip.sourceStartMs);
			const sourceEndMs = Math.min(
				sourceDurationMs,
				sourceStartMs + (clip.endMs - clip.startMs) * speed,
			);
			if (sourceEndMs <= sourceStartMs) return [];
			return [
				{ startMs: clip.startMs, endMs: clip.endMs, sourceStartMs, sourceEndMs, speed },
			];
		})
		.sort(byStart);
	if (normalized.length > 0) return normalized;
	return [
		{
			startMs: 0,
			endMs: sourceDurationMs,
			sourceStartMs: 0,
			sourceEndMs: sourceDurationMs,
			speed: 1,
		},
	];
}

export function removedRanges(clips: ReviewClip[], rawDurationMs: number) {
	const kept = mergeRanges(
		clips.map(({ sourceStartMs, sourceEndMs }) => ({
			startMs: sourceStartMs,
			endMs: sourceEndMs,
		})),
	);
	const removed: Range[] = [];
	let cursor = 0;
	for (const range of [...kept, { startMs: rawDurationMs, endMs: rawDurationMs }]) {
		if (range.startMs - cursor > SAME_FRAME_MS) {
			removed.push({ startMs: cursor, endMs: range.startMs });
		}
		cursor = Math.max(cursor, range.endMs);
	}
	return removed;
}

export function frameCandidates(clips: ReviewClip[]): ReviewFrame[] {
	const frames: ReviewFrame[] = [
		{ timeMs: clips[0].startMs, sourceMs: clips[0].sourceStartMs, label: "start" },
	];
	let cut = 0;
	clips.forEach((clip, index) => {
		const next = clips[index + 1];
		if (next && Math.abs(next.sourceStartMs - clip.sourceEndMs) <= SAME_FRAME_MS) return;
		const back = Math.min(END_FRAME_BACKOFF_MS, clip.sourceEndMs - clip.sourceStartMs);
		frames.push({
			timeMs: clip.startMs + (clip.sourceEndMs - back - clip.sourceStartMs) / clip.speed,
			sourceMs: clip.sourceEndMs - back,
			label: next ? `before cut ${++cut}` : "end",
		});
	});
	return frames.filter(
		(frame, index) =>
			index === 0 || Math.round(frame.timeMs) !== Math.round(frames[index - 1].timeMs),
	);
}

export function pickEvenly<T>(items: T[], max = MAX_TILES): T[] {
	if (items.length <= max) return items;
	return Array.from(
		{ length: max },
		(_, index) => items[Math.round((index * (items.length - 1)) / (max - 1))],
	);
}

export function planSheet(count: number, sourceWidth: number, sourceHeight: number) {
	const cols = Math.ceil(Math.sqrt(count));
	const rows = Math.ceil(count / cols);
	const even = (value: number) => Math.max(2, 2 * Math.floor(value / 2));
	const fit = (scale: number) => {
		const tileWidth = even(sourceWidth * scale);
		const tileHeight = even(sourceHeight * scale);
		return {
			cols,
			rows,
			tileWidth,
			tileHeight,
			width: cols * tileWidth + (cols - 1) * TILE_GAP,
			height: rows * tileHeight + (rows - 1) * TILE_GAP,
		};
	};
	let scale = Math.min(
		1,
		(MAX_IMAGE_EDGE - (cols - 1) * TILE_GAP) / (cols * sourceWidth),
		(MAX_IMAGE_EDGE - (rows - 1) * TILE_GAP) / (rows * sourceHeight),
		Math.sqrt(MAX_IMAGE_PIXELS / (cols * rows * sourceWidth * sourceHeight)),
	);
	let plan = fit(scale);
	while (plan.width * plan.height > MAX_IMAGE_PIXELS && plan.tileWidth > 2) {
		scale *= 0.98;
		plan = fit(scale);
	}
	return plan;
}

export function contactSheetArgs(videoPath: string, sourceMs: number[], plan: SheetPlan) {
	const inputs = sourceMs.flatMap((ms) => [
		"-threads",
		"1",
		"-noaccurate_seek",
		"-ss",
		(Math.max(0, ms) / 1000).toFixed(3),
		"-i",
		videoPath,
	]);
	const tiles = sourceMs.map(
		(_, index) =>
			`[${index}:v:0]tpad=stop=-1:stop_mode=clone,fps=fps=1000:start_time=0,trim=end_frame=1,setpts=PTS-STARTPTS,scale=${plan.tileWidth}:${plan.tileHeight},setsar=1[f${index}]`,
	);
	const sheet =
		`${sourceMs.map((_, index) => `[f${index}]`).join("")}concat=n=${sourceMs.length}:v=1:a=0,` +
		`tile=${plan.cols}x${plan.rows}:nb_frames=${sourceMs.length}:padding=${TILE_GAP}:color=white[sheet]`;
	return [
		"-hide_banner",
		"-nostats",
		"-loglevel",
		"error",
		...inputs,
		"-filter_complex",
		[...tiles, sheet].join(";"),
		"-map",
		"[sheet]",
		"-frames:v",
		"1",
		"-q:v",
		"5",
		"-f",
		"image2pipe",
		"-c:v",
		"mjpeg",
		"pipe:1",
	];
}

export const freezeArgs = (videoPath: string) => [
	"-hide_banner",
	"-nostats",
	"-i",
	videoPath,
	"-map",
	"0:v:0",
	"-vf",
	FREEZE_FILTER,
	"-f",
	"null",
	"-",
];

export function parseFreezes(stderr: string, rawDurationMs: number) {
	const freezes: Range[] = [];
	let startMs: number | null = null;
	for (const [, key, value] of stderr.matchAll(/freezedetect\.freeze_(start|end): ([\d.]+)/g)) {
		const ms = Number(value) * 1000;
		if (key === "start") startMs = ms;
		else if (startMs !== null) {
			freezes.push({ startMs, endMs: ms });
			startMs = null;
		}
	}
	if (startMs !== null) freezes.push({ startMs, endMs: rawDurationMs });
	return freezes;
}

export function longestStill(freezes: Range[], clips: ReviewClip[]) {
	let longest = 0;
	for (const freeze of freezes) {
		const pieces = clips.flatMap((clip) => {
			const from = Math.max(freeze.startMs, clip.sourceStartMs);
			const to = Math.min(freeze.endMs, clip.sourceEndMs);
			if (to <= from) return [];
			const toTimeline = (ms: number) =>
				clip.startMs + (ms - clip.sourceStartMs) / clip.speed;
			return [{ startMs: toTimeline(from), endMs: toTimeline(to) }];
		});
		for (const run of mergeRanges(pieces)) longest = Math.max(longest, run.endMs - run.startMs);
	}
	return Math.round(longest);
}

export function summarize(
	videoPath: string,
	timeline: RemoteReviewTimeline,
	log: AgentActivityLog | null,
) {
	const clips = normalizeClips(timeline);
	const removed = removedRanges(clips, timeline.sourceDurationMs);
	const frames = pickEvenly(frameCandidates(clips));
	return {
		clips,
		frames,
		summary: {
			videoPath,
			rawDurationMs: Math.round(timeline.sourceDurationMs),
			finalDurationMs: Math.round(timeline.durationMs),
			removedMs: Math.round(
				removed.reduce((sum, range) => sum + range.endMs - range.startMs, 0),
			),
			cuts: removed.length,
			zooms: timeline.zooms,
			captions: timeline.captions,
			scenes: log?.scenes.length ?? 0,
			failedScenes: log?.scenes.filter((scene) => scene.failed).length ?? 0,
			frames: frames.map(({ timeMs, label }) => ({ timeMs: Math.round(timeMs), label })),
		},
	};
}

function describeFfmpegError(error: unknown) {
	const failure = error as { killed?: boolean; stderr?: Buffer | string; message?: string };
	if (failure.killed) return "FFmpeg took too long.";
	const stderr = failure.stderr?.toString().trim();
	return stderr ? stderr.split(/\r?\n/).slice(-3).join(" ") : (failure.message ?? String(error));
}

const runFfmpegProcess: RunFfmpeg = async (binary, args, { timeoutMs, signal }) => {
	const { stdout, stderr } = await execFileAsync(binary, args, {
		encoding: "buffer",
		timeout: timeoutMs,
		maxBuffer: 64 * 1024 * 1024,
		signal,
		windowsHide: true,
	});
	return { stdout, stderr: stderr.toString() };
};

export function createRemoteReview({
	remote,
	ipc = ipcMain,
	ffmpegPath = getFfmpegBinaryPath,
	runFfmpeg = runFfmpegProcess,
	readActivity = readAgentActivity,
}: {
	remote: Pick<RemoteControl, "getStatus">;
	ipc?: Pick<IpcMain, "on">;
	ffmpegPath?: () => string;
	runFfmpeg?: RunFfmpeg;
	readActivity?: (videoPath: string) => Promise<AgentActivityLog | null>;
}) {
	const readyEditors = new Map<WebContents, string>();
	const watchedEditors = new WeakSet<WebContents>();
	const readyCheckers = new Set<() => void>();
	let pending: {
		id: string;
		editor: WebContents;
		settle: (result: RemoteReviewResult) => void;
	} | null = null;
	let busy = false;

	function forgetEditor(editor: WebContents) {
		readyEditors.delete(editor);
		if (pending?.editor === editor) {
			pending.settle({
				id: pending.id,
				ok: false,
				error: "The editor closed or reloaded during the review.",
			});
		}
	}

	function watchEditor(editor: WebContents) {
		if (watchedEditors.has(editor)) return;
		watchedEditors.add(editor);
		editor.once("destroyed", () => forgetEditor(editor));
		editor.on("render-process-gone", () => forgetEditor(editor));
		editor.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
			if (isMainFrame && !isInPlace) forgetEditor(editor);
		});
	}

	ipc.on("remote-editor-ready", (event, state: RemoteEditorReadyState) => {
		watchEditor(event.sender);
		if (state?.ready && typeof state.videoPath === "string") {
			readyEditors.set(event.sender, path.resolve(state.videoPath));
		} else {
			readyEditors.delete(event.sender);
		}
		for (const check of [...readyCheckers]) check();
	});
	ipc.on("remote-review-result", (_event, result: RemoteReviewResult) => {
		if (pending && result?.id === pending.id) pending.settle(result);
	});

	function waitForEditor(videoPath: string, signal: AbortSignal) {
		return new Promise<WebContents>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer);
				readyCheckers.delete(check);
				signal.removeEventListener("abort", onAbort);
			};
			const stop = (message: string) => {
				cleanup();
				reject(new Error(message));
			};
			const check = () => {
				for (const [editor, readyPath] of readyEditors) {
					if (editor.isDestroyed() || editor.isCrashed()) readyEditors.delete(editor);
					else if (readyPath === videoPath) {
						cleanup();
						resolve(editor);
						return;
					}
				}
			};
			const onAbort = () => stop("The review was canceled.");
			const timer = setTimeout(
				() =>
					stop(
						`The editor did not finish loading ${videoPath} within ${EDITOR_READY_TIMEOUT_MS / 1000} s. Is the editor open?`,
					),
				EDITOR_READY_TIMEOUT_MS,
			);
			readyCheckers.add(check);
			signal.addEventListener("abort", onAbort, { once: true });
			check();
		});
	}

	function askEditor(editor: WebContents, signal: AbortSignal) {
		return new Promise<RemoteReviewTimeline>((resolve, reject) => {
			const id = randomUUID();
			const settle = (result: RemoteReviewResult) => {
				if (pending?.id !== id) return;
				pending = null;
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				if (result.ok && Array.isArray(result.timeline?.clips)) resolve(result.timeline);
				else
					reject(
						new Error(result.error ?? "The editor could not describe its timeline."),
					);
			};
			const onAbort = () => settle({ id, ok: false, error: "The review was canceled." });
			const timer = setTimeout(
				() =>
					settle({
						id,
						ok: false,
						error: `The editor did not answer within ${EDITOR_REPLY_TIMEOUT_MS / 1000} s.`,
					}),
				EDITOR_REPLY_TIMEOUT_MS,
			);
			signal.addEventListener("abort", onAbort, { once: true });
			pending = { id, editor, settle };
			try {
				editor.send("remote-review-request", { id } satisfies RemoteReviewRequest);
			} catch {
				forgetEditor(editor);
			}
		});
	}

	async function checkStills(
		binary: string,
		videoPath: string,
		clips: ReviewClip[],
		rawDurationMs: number,
		signal: AbortSignal,
	): Promise<Pick<RecordingReview["summary"], "longestStillMs" | "longestStillNote">> {
		if (rawDurationMs > MAX_STILL_CHECK_MS) {
			return {
				longestStillMs: 0,
				longestStillNote: `Not checked: the recording is longer than ${MAX_STILL_CHECK_MS / 60_000} min.`,
			};
		}
		try {
			const { stderr } = await runFfmpeg(binary, freezeArgs(videoPath), {
				timeoutMs: STILL_TIMEOUT_MS,
				signal,
			});
			return { longestStillMs: longestStill(parseFreezes(stderr, rawDurationMs), clips) };
		} catch (error) {
			return {
				longestStillMs: 0,
				longestStillNote: `Not checked: ${describeFfmpegError(error)}`,
			};
		}
	}

	async function buildSheet(
		binary: string,
		videoPath: string,
		frames: ReviewFrame[],
		timeline: RemoteReviewTimeline,
		signal: AbortSignal,
	): Promise<RecordingReview["image"]> {
		const plan = planSheet(frames.length, timeline.width, timeline.height);
		const args = contactSheetArgs(
			videoPath,
			frames.map((frame) => frame.sourceMs),
			plan,
		);
		const { stdout } = await runFfmpeg(binary, args, {
			timeoutMs: SHEET_TIMEOUT_MS,
			signal,
		}).catch((error) => {
			throw new Error(
				`Recordly could not build the contact sheet: ${describeFfmpegError(error)}`,
			);
		});
		if (stdout.length === 0) {
			throw new Error(
				"Recordly could not build the contact sheet: FFmpeg returned no image.",
			);
		}
		return {
			data: stdout.toString("base64"),
			mimeType: "image/jpeg",
			width: plan.width,
			height: plan.height,
		};
	}

	async function reviewRecording({
		signal,
	}: {
		signal?: AbortSignal;
	} = {}): Promise<RecordingReview> {
		const { state, lastRecordingPath } = remote.getStatus();
		if (state !== "idle" && state !== "finalizing") {
			throw new Error(
				`Recordly is ${state}. Finish with stop_recording before calling review_recording.`,
			);
		}
		if (!lastRecordingPath) {
			throw new Error(
				"There is no recording to review yet. Record one with start_recording and stop_recording first.",
			);
		}
		if (busy) throw new Error("A review is already running.");
		busy = true;
		const controller = new AbortController();
		const abort = () => controller.abort();
		signal?.addEventListener("abort", abort, { once: true });
		try {
			signal?.throwIfAborted();
			let binary: string;
			try {
				binary = ffmpegPath();
			} catch (error) {
				throw new Error(
					`Recordly cannot review the video without FFmpeg. ${(error as Error).message}`,
				);
			}
			const videoPath = path.resolve(lastRecordingPath);
			const editor = await waitForEditor(videoPath, controller.signal);
			const timeline = await askEditor(editor, controller.signal);
			const log = await readActivity(videoPath).catch(() => null);
			const { clips, frames, summary } = summarize(videoPath, timeline, log);
			const [image, still] = await Promise.all([
				buildSheet(binary, videoPath, frames, timeline, controller.signal),
				checkStills(binary, videoPath, clips, summary.rawDurationMs, controller.signal),
			]);
			return { summary: { ...summary, ...still }, image };
		} catch (error) {
			if (signal?.aborted) throw new Error("The review was canceled.");
			throw error;
		} finally {
			signal?.removeEventListener("abort", abort);
			controller.abort();
			busy = false;
		}
	}

	return { reviewRecording };
}

export type RemoteReview = ReturnType<typeof createRemoteReview>;
