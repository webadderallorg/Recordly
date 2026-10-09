import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { type IpcMain, ipcMain, type WebContents } from "electron";
import type { AnnotationRegion } from "../../src/components/video-editor/types";
import { getFfmpegBinaryPath } from "../ipc/ffmpeg/binary";
import { probeNativeVideoMetadata } from "../ipc/ffmpeg/metadata";
import { describeFfmpegError } from "./ffmpegError";
import { type RenderedAnnotation, renderFrameAnnotations } from "./renderedFrame";
import { contactSheetArgs, planSheet } from "./reviewRecording";

const EDITOR_READY_TIMEOUT_MS = 45_000;
const EDITOR_REPLY_TIMEOUT_MS = 20_000;
const SLOW_OP_TIMEOUT_MS = 10 * 60_000;
const SLOW_OPS = new Set(["timeline.join", "captions.generate", "render_preview"]);
const SLOW_OP_WAIT_MS = 60_000;
const FRAME_TIMEOUT_MS = 30_000;
const MAX_FRAME_WIDTH = 1920;
const END_FRAME_BACKOFF_MS = 40;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const SHEET_TIMEOUT_MS = 60_000;
const MAX_SAMPLE_FRAMES = 12;
const MIN_EVERY_MS = 17;
const MAX_SHEET_BYTES = 4 * 1024 * 1024;
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const execFileAsync = promisify(execFile);

export type RunFfmpeg = (
	binary: string,
	args: string[],
	opts: { timeoutMs: number; signal?: AbortSignal },
) => Promise<Buffer>;

export const runFfmpegProcess: RunFfmpeg = async (binary, args, { timeoutMs, signal }) => {
	const { stdout } = await execFileAsync(binary, args, {
		encoding: "buffer",
		timeout: timeoutMs,
		maxBuffer: MAX_FRAME_BYTES,
		signal,
		windowsHide: true,
	});
	return stdout;
};

export type EditorClip = {
	startMs: number;
	endMs: number;
	sourceStartMs?: number;
	speed: number;
};

export type EditorState = {
	videoPath: string;
	durationMs: number;
	sourceDurationMs: number;
	clips: unknown[];
	zooms: unknown[];
	annotations: unknown[];
	audio: unknown[];
	captions: unknown[];
};

export type EditorFrameSource = "edited" | "raw";

type Pending = {
	editor: WebContents;
	settle: (result: RemoteEditorResult) => void;
};

export function timelineToSourceMs(clips: EditorClip[], atMs: number) {
	if (clips.length === 0) return atMs;
	const clip =
		clips.find((item) => atMs >= item.startMs && atMs < item.endMs) ??
		clips.find((item) => item.endMs === atMs && !clips.some((other) => other.endMs > atMs));
	if (!clip) return null;
	const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	const sourceStart = Number.isFinite(clip.sourceStartMs)
		? (clip.sourceStartMs as number)
		: clip.startMs;
	return sourceStart + (atMs - clip.startMs) * speed;
}

export function frameArgs(videoPath: string, sourceMs: number) {
	return [
		"-hide_banner",
		"-nostats",
		"-loglevel",
		"error",
		"-ss",
		(Math.max(0, sourceMs) / 1000).toFixed(3),
		"-i",
		videoPath,
		"-frames:v",
		"1",
		"-vf",
		`scale='min(${MAX_FRAME_WIDTH},iw)':-2`,
		"-f",
		"image2pipe",
		"-c:v",
		"png",
		"pipe:1",
	];
}

export const sampleSheetArgs = (...args: Parameters<typeof contactSheetArgs>) =>
	contactSheetArgs(...args).filter((arg) => arg !== "-noaccurate_seek");

export type SampledFrame = { atMs: number; sourceMs: number };

export type SampledFrames = {
	image: { data: string; mimeType: "image/jpeg"; width: number; height: number };
	cols: number;
	rows: number;
	source: EditorFrameSource;
	frames: SampledFrame[];
	skippedAtMs?: number[];
};

export function createRemoteEditor({
	ipc = ipcMain,
	ffmpegPath = getFfmpegBinaryPath,
	runFfmpeg = runFfmpegProcess,
	probeVideo = probeNativeVideoMetadata,
	readyTimeoutMs = EDITOR_READY_TIMEOUT_MS,
	replyTimeoutMs = EDITOR_REPLY_TIMEOUT_MS,
}: {
	ipc?: Pick<IpcMain, "on">;
	ffmpegPath?: () => string;
	runFfmpeg?: RunFfmpeg;
	probeVideo?: (
		binary: string,
		videoPath: string,
		signal?: AbortSignal,
	) => Promise<{ width: number; height: number }>;
	readyTimeoutMs?: number;
	replyTimeoutMs?: number;
} = {}) {
	const readyEditors = new Map<WebContents, string>();
	const watchedEditors = new WeakSet<WebContents>();
	const readyCheckers = new Set<() => void>();
	const pending = new Map<string, Pending>();
	const outstanding = new Map<string, { op: string; startedAt: number }>();

	function forgetEditor(editor: WebContents) {
		readyEditors.delete(editor);
		for (const [id, request] of [...pending]) {
			if (request.editor === editor) {
				request.settle({
					id,
					ok: false,
					error: "The editor closed or reloaded before it answered.",
				});
			}
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
	ipc.on("remote-editor-result", (_event, result: RemoteEditorResult) => {
		if (typeof result?.id === "string") pending.get(result.id)?.settle(result);
	});

	function waitForEditor(signal?: AbortSignal) {
		if (signal?.aborted) return Promise.reject(new Error("The request was canceled."));
		return new Promise<WebContents>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer);
				readyCheckers.delete(check);
				signal?.removeEventListener("abort", onAbort);
			};
			const stop = (message: string) => {
				cleanup();
				reject(new Error(message));
			};
			const check = () => {
				for (const editor of [...readyEditors.keys()]) {
					if (editor.isDestroyed() || editor.isCrashed()) readyEditors.delete(editor);
					else {
						cleanup();
						resolve(editor);
						return;
					}
				}
			};
			const onAbort = () => stop("The request was canceled.");
			const timer = setTimeout(
				() =>
					stop(
						`The editor did not finish loading a recording within ${readyTimeoutMs / 1000} s. Is the editor open?`,
					),
				readyTimeoutMs,
			);
			readyCheckers.add(check);
			signal?.addEventListener("abort", onAbort, { once: true });
			check();
		});
	}

	async function requestEditor<T = unknown>(
		op: string,
		payload?: unknown,
		{ signal }: { signal?: AbortSignal } = {},
	): Promise<T> {
		const editor = await waitForEditor(signal);
		if (signal?.aborted) throw new Error("The request was canceled.");
		const budget = SLOW_OPS.has(op)
			? Math.max(replyTimeoutMs, SLOW_OP_TIMEOUT_MS)
			: replyTimeoutMs;
		return new Promise<T>((resolve, reject) => {
			const id = randomUUID();
			const settle = (result: RemoteEditorResult) => {
				outstanding.delete(id);
				if (!pending.delete(id)) return;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				if (result.ok === true) resolve(result.data as T);
				else reject(new Error(result.error ?? `The editor could not run ${op}.`));
			};
			const onAbort = () => settle({ id, ok: false, error: "The request was canceled." });
			const timer = setTimeout(
				() =>
					settle({
						id,
						ok: false,
						error: `The editor did not answer ${op} within ${Math.round(budget / 1000)} s.`,
					}),
				budget,
			);
			signal?.addEventListener("abort", onAbort, { once: true });
			pending.set(id, { editor, settle });
			outstanding.set(id, { op, startedAt: Date.now() });
			try {
				editor.send("remote-editor-request", {
					id,
					op,
					payload,
				} satisfies RemoteEditorRequest);
			} catch (error) {
				readyEditors.delete(editor);
				settle({
					id,
					ok: false,
					error: `The editor could not be reached: ${(error as Error).message}`,
				});
			}
		});
	}

	const getState = async (opts?: { signal?: AbortSignal }) => {
		const state = await requestEditor<EditorState>("get_state", undefined, opts);
		const valid =
			state &&
			typeof state.videoPath === "string" &&
			Number.isFinite(state.durationMs) &&
			Number.isFinite(state.sourceDurationMs) &&
			Array.isArray(state.clips);
		if (!valid) {
			throw new Error(
				"There is no recording loaded in the editor, or it returned an unreadable state.",
			);
		}
		return state;
	};

	function resolveBinary(action: string) {
		try {
			return ffmpegPath();
		} catch (error) {
			throw new Error(
				`Recordly cannot ${action} without FFmpeg. ${(error as Error).message}`,
			);
		}
	}

	async function getFrame(
		{
			atMs,
			source = "edited",
			rendered = false,
		}: { atMs: number; source?: EditorFrameSource; rendered?: boolean },
		opts: { signal?: AbortSignal } = {},
	): Promise<{
		dataUrl: string;
		atMs: number;
		source: EditorFrameSource;
		sourceMs: number;
		annotations?: RenderedAnnotation[];
		note?: string;
	}> {
		if (!Number.isFinite(atMs) || atMs < 0) throw new Error("atMs must be 0 or more.");
		if (source !== "edited" && source !== "raw") {
			throw new Error(`source must be "edited" or "raw", not "${source}".`);
		}
		const state = await getState(opts);
		const limit = source === "raw" ? state.sourceDurationMs : state.durationMs;
		if (atMs > limit) {
			throw new Error(
				`atMs ${Math.round(atMs)} is past the end of the ${source} video (${limit} ms).`,
			);
		}
		const sourceMs =
			source === "raw" ? atMs : timelineToSourceMs(state.clips as EditorClip[], atMs);
		if (sourceMs === null) {
			throw new Error(`Nothing plays at ${Math.round(atMs)} ms; it falls in a gap.`);
		}
		// ffmpeg often cannot seek to the very last frame.
		const seekMs = Math.min(
			sourceMs,
			Math.max(0, state.sourceDurationMs - END_FRAME_BACKOFF_MS),
		);
		const binary = resolveBinary("read a frame");
		const png = await runFfmpeg(binary, frameArgs(state.videoPath, seekMs), {
			timeoutMs: FRAME_TIMEOUT_MS,
			signal: opts.signal,
		}).catch((error) => {
			throw new Error(
				`Recordly could not read that frame: ${describeFfmpegError(error, FRAME_TIMEOUT_MS)}`,
			);
		});
		if (png.length === 0) throw new Error("Recordly could not read that frame: no image.");
		if (!png.subarray(0, 4).equals(PNG_SIGNATURE)) {
			throw new Error("Recordly could not read that frame: FFmpeg did not return an image.");
		}
		const shown = rendered
			? await renderFrameAnnotations(
					{ png, atMs, annotations: (state.annotations ?? []) as AnnotationRegion[] },
					{ binary, runFfmpeg, signal: opts.signal },
				)
			: null;
		return {
			dataUrl: `data:image/png;base64,${(shown?.png ?? png).toString("base64")}`,
			atMs,
			source,
			sourceMs: Math.round(seekMs),
			...(shown ? { annotations: shown.annotations } : {}),
			...(shown?.note ? { note: shown.note } : {}),
		};
	}

	async function sampleFrames(
		{
			everyMs,
			count,
			source = "edited",
		}: { everyMs?: number; count?: number; source?: EditorFrameSource },
		opts: { signal?: AbortSignal } = {},
	): Promise<SampledFrames> {
		if ((everyMs === undefined) === (count === undefined)) {
			throw new Error("Pass exactly one of everyMs or count.");
		}
		if (source !== "edited" && source !== "raw") {
			throw new Error(`source must be "edited" or "raw", not "${source}".`);
		}
		if (everyMs !== undefined && !(Number.isFinite(everyMs) && everyMs >= MIN_EVERY_MS)) {
			throw new Error(`everyMs must be at least ${MIN_EVERY_MS} ms (one frame at 60 fps).`);
		}
		if (
			count !== undefined &&
			!(Number.isInteger(count) && count >= 2 && count <= MAX_SAMPLE_FRAMES)
		) {
			throw new Error(
				`count must be a whole number from 2 to ${MAX_SAMPLE_FRAMES}. get_frame returns a single frame.`,
			);
		}
		const state = await getState(opts);
		const limit = source === "raw" ? state.sourceDurationMs : state.durationMs;
		if (limit <= 0) throw new Error(`The ${source} video has no length to sample.`);
		let times: number[];
		if (count !== undefined) {
			times = Array.from({ length: count }, (_, i) => Math.round((i * limit) / (count - 1)));
		} else {
			const every = everyMs as number;
			const total = Math.floor(limit / every) + 1;
			if (total > MAX_SAMPLE_FRAMES) {
				throw new Error(
					`everyMs ${Math.round(every)} would need ${total} frames over ${Math.round(limit)} ms; the most is ${MAX_SAMPLE_FRAMES}. Use a larger everyMs or pass count.`,
				);
			}
			if (total < 2) {
				throw new Error(
					`everyMs ${Math.round(every)} is longer than the ${source} video (${Math.round(limit)} ms).`,
				);
			}
			times = Array.from({ length: total }, (_, i) => Math.round(i * every));
		}
		const frames: SampledFrame[] = [];
		const skippedAtMs: number[] = [];
		const lastSeekMs = Math.max(0, state.sourceDurationMs - END_FRAME_BACKOFF_MS);
		for (const atMs of times) {
			const sourceMs =
				source === "raw" ? atMs : timelineToSourceMs(state.clips as EditorClip[], atMs);
			if (sourceMs === null) skippedAtMs.push(atMs);
			else frames.push({ atMs, sourceMs: Math.round(Math.min(sourceMs, lastSeekMs)) });
		}
		if (frames.length < 2) {
			throw new Error("Fewer than two of those moments play anything; they fall in gaps.");
		}
		const binary = resolveBinary("build a contact sheet");
		const { width, height } = await probeVideo(binary, state.videoPath, opts.signal).catch(
			(error) => {
				throw new Error(
					`Recordly could not read the video's size: ${describeFfmpegError(error, FRAME_TIMEOUT_MS)}`,
				);
			},
		);
		const plan = planSheet(frames.length, width, height);
		const jpeg = await runFfmpeg(
			binary,
			sampleSheetArgs(
				state.videoPath,
				frames.map((frame) => frame.sourceMs),
				plan,
			),
			{ timeoutMs: SHEET_TIMEOUT_MS, signal: opts.signal },
		).catch((error) => {
			throw new Error(
				`Recordly could not build the contact sheet: ${describeFfmpegError(error, SHEET_TIMEOUT_MS)}`,
			);
		});
		if (jpeg.length === 0) {
			throw new Error("Recordly could not build the contact sheet: no image.");
		}
		if (!jpeg.subarray(0, 3).equals(JPEG_SIGNATURE)) {
			throw new Error(
				"Recordly could not build the contact sheet: FFmpeg did not return an image.",
			);
		}
		if (jpeg.length > MAX_SHEET_BYTES) {
			throw new Error(
				`The contact sheet is ${jpeg.length} bytes, over the ${MAX_SHEET_BYTES} byte limit. Ask for fewer frames.`,
			);
		}
		return {
			image: {
				data: jpeg.toString("base64"),
				mimeType: "image/jpeg",
				width: plan.width,
				height: plan.height,
			},
			cols: plan.cols,
			rows: plan.rows,
			source,
			frames,
			...(skippedAtMs.length > 0 && { skippedAtMs }),
		};
	}

	function runningOp() {
		let oldest: { op: string; startedAt: number } | null = null;
		for (const entry of outstanding.values()) {
			if (!oldest || entry.startedAt < oldest.startedAt) oldest = entry;
		}
		return oldest ? { op: oldest.op, forMs: Date.now() - oldest.startedAt } : null;
	}

	async function requestLong<T = unknown>(
		op: string,
		payload?: unknown,
		{ signal, waitMs = SLOW_OP_WAIT_MS }: { signal?: AbortSignal; waitMs?: number } = {},
	): Promise<
		{ status: "done"; data: T } | { status: "still-running"; op: string; waitedMs: number }
	> {
		const work = requestEditor<T>(op, payload, { signal });
		work.catch(() => undefined);
		const started = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const detached = new Promise<null>((resolve) => {
			timer = setTimeout(() => resolve(null), waitMs);
		});
		try {
			const done = await Promise.race([work.then((data) => ({ data })), detached]);
			if (!done) return { status: "still-running", op, waitedMs: Date.now() - started };
			return { status: "done", data: done.data };
		} finally {
			clearTimeout(timer);
		}
	}

	return { requestEditor, requestLong, runningOp, getState, getFrame, sampleFrames };
}

export type RemoteEditor = ReturnType<typeof createRemoteEditor>;
