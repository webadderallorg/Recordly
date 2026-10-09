import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { type IpcMain, ipcMain, type WebContents } from "electron";
import { readExportRangeArgs } from "../../src/components/video-editor/export/exportRange";
import { getFfmpegBinaryPath } from "../ipc/ffmpeg/binary";
import { parseFfmpegFrameRate, parseNativeVideoMetadataProbeOutput } from "../ipc/ffmpeg/metadata";
import { getRecordingsDir } from "../ipc/utils";
import { verifyExportedFrames } from "./exportVerify";
import type { RunFfmpeg } from "./remoteEditor";

const EDITOR_READY_TIMEOUT_MS = 45_000;
const EXPORT_WAIT_CAP_MS = 5 * 60_000;
const PAD_TIMEOUT_MS = 5 * 60_000;
const MAX_PAD_SIDE = 8192;
const MIN_SCALE = 0.05;
const MAX_FPS = 120;
const POSTER_END_BACKOFF_MS = 40;
const PROBE_TIMEOUT_MS = 30_000;
const MAX_CHAPTER_TITLE_CHARS = 200;

type ExportFormat = RemoteExportRequest["format"];

export type RemoteExportArgs = {
	videoPath: string | null;
	outputPath?: string;
	format?: ExportFormat;
	quality?: RemoteExportRequest["quality"];
	overwrite?: boolean;
	/** Letterbox to this aspect ratio ("16:9"); never stretches or crops. */
	aspect?: string;
	/** Fit inside and letterbox to exactly this size ("2880x1600"); never stretches. */
	padTo?: string;
	/** Shrink the output by this factor (0.05 to 1); applied after aspect, not with padTo. */
	scale?: number;
	/** Output frame rate, 1 to 120. */
	fps?: number;
	/** Use the frame at this time of the edited timeline as the file's poster image. */
	posterAtMs?: number;
	/** Render only the edited timeline from here; needs toMs. */
	fromMs?: number;
	/** Render only the edited timeline up to here; needs fromMs. */
	toMs?: number;
	/** Write one chapter per rehearsed scene (mp4 only). */
	chapters?: boolean;
};

export type SceneMark = {
	title: string | null;
	startMs: number;
	endMs: number;
	failed?: boolean;
};

export type LoadScenes = (signal?: AbortSignal) => Promise<SceneMark[] | { unavailable: string }>;

export type Chapter = { title: string; startMs: number; endMs: number };

export type ExportedVideoInfo = {
	width?: number;
	height?: number;
	durationMs?: number;
	fps?: number | null;
	probeNote?: string;
	warnings?: string[];
	chapters?: number;
	chaptersNote?: string;
};

export type ExportedFragmentInfo = {
	fragment: true;
	fragmentFromMs: number;
	fragmentToMs: number;
	fragmentNote: string;
};

export function describeFragment(reply: RemoteExportResult): ExportedFragmentInfo | null {
	const { fromMs, toMs, timelineDurationMs } = reply;
	if (fromMs === undefined || toMs === undefined) return null;
	if (fromMs <= 0 && timelineDurationMs !== undefined && toMs >= timelineDurationMs) return null;
	const of = timelineDurationMs === undefined ? "" : ` of ${Math.round(timelineDurationMs)} ms`;
	return {
		fragment: true,
		fragmentFromMs: fromMs,
		fragmentToMs: toMs,
		fragmentNote:
			`This file is a ${Math.round(toMs - fromMs)} ms fragment of the edited timeline, ` +
			`from ${Math.round(fromMs)} ms to ${Math.round(toMs)} ms${of}. It is not the finished ` +
			"video, so do not hand it to anyone as one. Every time inside the file, including any " +
			"in warnings, is measured from the start of the fragment.",
	};
}

export type ProbeVideo = (videoPath: string, signal?: AbortSignal) => Promise<ExportedVideoInfo>;

export type RemoteExportStatus = {
	state: "idle" | "waiting-for-editor" | "exporting" | "done" | "failed";
	progress: number | null;
	outputPath: string | null;
	error: string | null;
};

type ActiveExport = {
	id: string;
	editor: WebContents;
	onProgress?: (pct: number) => void;
	settle: (result: RemoteExportResult) => void;
};

type PostSpec = {
	filter: string;
	posterAtMs?: number;
	chapters?: Chapter[];
	label: "padding" | "post-processing";
};

export function rebaseChapters(
	scenes: SceneMark[],
	range?: { fromMs: number; toMs: number },
): Chapter[] {
	const fromMs = range?.fromMs ?? 0;
	const toMs = range?.toMs ?? Number.POSITIVE_INFINITY;
	const kept: Chapter[] = [];
	scenes
		.filter((scene) => Number.isFinite(scene.startMs) && Number.isFinite(scene.endMs))
		.sort((a, b) => a.startMs - b.startMs)
		.forEach((scene, index) => {
			const startMs = Math.round(Math.max(scene.startMs, fromMs) - fromMs);
			const endMs = Math.round(Math.min(scene.endMs, toMs) - fromMs);
			if (endMs <= startMs) return;
			kept.push({ title: scene.title?.trim() || `Scene ${index + 1}`, startMs, endMs });
		});
	return kept.flatMap((chapter, index) => {
		const next = kept[index + 1];
		const endMs = next ? Math.min(chapter.endMs, next.startMs) : chapter.endMs;
		return endMs > chapter.startMs ? [{ ...chapter, endMs }] : [];
	});
}

export function escapeChapterTitle(title: string) {
	const flat = title.replace(/[\p{Cc}\u2028\u2029]+/gu, " ").trim();
	const chars = Array.from(flat);
	const cut =
		chars.length > MAX_CHAPTER_TITLE_CHARS
			? `${chars.slice(0, MAX_CHAPTER_TITLE_CHARS - 1).join("")}…`
			: flat;
	return cut.replace(/[\\=;#]/g, "\\$&");
}

export function buildChapterMetadata(chapters: Chapter[]) {
	return chapters.reduce(
		(text, chapter, index) =>
			`${text}[CHAPTER]\nTIMEBASE=1/1000\nSTART=${chapter.startMs}\nEND=${chapter.endMs}\n` +
			`title=${escapeChapterTitle(chapter.title) || `Chapter ${index + 1}`}\n`,
		";FFMETADATA1\n",
	);
}

function requireNumber(name: string, value: unknown, ok: (value: number) => boolean, rule: string) {
	if (typeof value !== "number" || !Number.isFinite(value) || !ok(value)) {
		throw new Error(`${name} must be ${rule}, not ${JSON.stringify(value)}.`);
	}
}

/** One ffmpeg pass: aspect or padTo letterboxes, then scale shrinks, then fps resamples. */
export function buildPostSpec(args: RemoteExportArgs): PostSpec | null {
	const pad = buildPadFilter(args);
	if (args.padTo !== undefined && args.scale !== undefined) {
		throw new Error(
			"Pass either padTo or scale, not both: padTo already fixes the output size. Use aspect with scale, or padTo alone.",
		);
	}
	if (args.scale !== undefined) {
		requireNumber(
			"scale",
			args.scale,
			(value) => value >= MIN_SCALE && value <= 1,
			`a number from ${MIN_SCALE} to 1 (it only shrinks)`,
		);
	}
	if (args.fps !== undefined) {
		requireNumber(
			"fps",
			args.fps,
			(value) => value >= 1 && value <= MAX_FPS,
			`a number from 1 to ${MAX_FPS}`,
		);
	}
	if (args.posterAtMs !== undefined) {
		requireNumber("posterAtMs", args.posterAtMs, (value) => value >= 0, "0 or more");
	}
	const filter = [
		pad?.filter,
		args.scale !== undefined && `scale=trunc(iw*${args.scale}/2)*2:trunc(ih*${args.scale}/2)*2`,
		args.fps !== undefined && `fps=${args.fps}`,
	]
		.filter(Boolean)
		.join(",");
	if (args.chapters !== undefined && typeof args.chapters !== "boolean") {
		throw new Error(`chapters must be true or false, not ${JSON.stringify(args.chapters)}.`);
	}
	if (!filter && args.posterAtMs === undefined && !args.chapters) return null;
	return { filter, posterAtMs: args.posterAtMs, label: pad ? "padding" : "post-processing" };
}

/** Letterbox filters. Only ever add bars: scale keeps the aspect ratio, pad fills the rest. */
export function buildPadFilter(args: {
	aspect?: string;
	padTo?: string;
}): { filter: string } | null {
	if (args.aspect !== undefined && args.padTo !== undefined) {
		throw new Error("Pass either aspect or padTo, not both.");
	}
	if (args.aspect !== undefined) {
		if (typeof args.aspect !== "string") {
			throw new Error(`aspect must look like 16:9, not "${args.aspect}".`);
		}
		const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(args.aspect.trim());
		if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
			throw new Error(`aspect must look like 16:9, not "${args.aspect}".`);
		}
		const ratio = `${match[1]}/${match[2]}`;
		return {
			filter:
				`pad='ceil(max(iw,ih*${ratio})/2)*2':'ceil(max(ih,iw/(${ratio}))/2)*2'` +
				`:'(ow-iw)/2':'(oh-ih)/2':black`,
		};
	}
	if (args.padTo !== undefined) {
		const match = /^(\d+)x(\d+)$/i.exec(args.padTo.trim());
		const [width, height] = [Number(match?.[1]), Number(match?.[2])];
		if (!match || width < 2 || height < 2 || width % 2 || height % 2) {
			throw new Error(`padTo must look like 2880x1600 with even sizes, not "${args.padTo}".`);
		}
		if (width > MAX_PAD_SIDE || height > MAX_PAD_SIDE) {
			throw new Error(`padTo cannot be larger than ${MAX_PAD_SIDE} px on a side.`);
		}
		return {
			filter:
				`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
				`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
		};
	}
	return null;
}

export function buildPostArgs(
	input: string,
	output: string,
	spec: Pick<PostSpec, "filter" | "posterAtMs">,
	posterSeekMs = spec.posterAtMs,
	chaptersFile?: string,
) {
	const chapterInput = chaptersFile ? ["-i", chaptersFile] : [];
	const chapterMap = (index: number) =>
		chaptersFile ? ["-map_metadata", "0", "-map_chapters", String(index)] : [];
	const encode = [
		"-c:v:0",
		"libx264",
		"-crf",
		"16",
		"-preset",
		"medium",
		"-pix_fmt:v:0",
		"yuv420p",
		"-c:a",
		"copy",
		"-movflags",
		"+faststart",
	];
	if (posterSeekMs === undefined) {
		if (!spec.filter) {
			return [
				"-y",
				"-hide_banner",
				"-i",
				input,
				...chapterInput,
				...chapterMap(1),
				"-c",
				"copy",
				"-movflags",
				"+faststart",
				output,
			];
		}
		return [
			"-y",
			"-hide_banner",
			"-i",
			input,
			...chapterInput,
			...chapterMap(1),
			"-vf",
			spec.filter,
			...encode,
			output,
		];
	}
	const main = spec.filter || "null";
	const poster = [
		spec.filter.replace(/,?fps=[^,]+$/, ""),
		"format=yuvj420p",
		"trim=end_frame=1",
		"setpts=PTS-STARTPTS",
	]
		.filter(Boolean)
		.join(",");
	return [
		"-y",
		"-hide_banner",
		"-i",
		input,
		"-ss",
		(posterSeekMs / 1000).toFixed(3),
		"-i",
		input,
		...chapterInput,
		...chapterMap(2),
		"-filter_complex",
		`[0:v]${main}[v];[1:v]${poster}[p]`,
		"-map",
		"[v]",
		"-map",
		"0:a?",
		"-map",
		"[p]",
		...encode,
		"-c:v:1",
		"mjpeg",
		"-disposition:v:1",
		"attached_pic",
		output,
	];
}

const VERIFY_MAX_BUFFER = 16 * 1024 * 1024;

export type CardSpan = { startMs: number; endMs: number };

export type LoadCardSpans = (signal?: AbortSignal) => Promise<CardSpan[]>;

export type VerifyFrames = (
	filePath: string,
	durationMs: number | undefined,
	signal?: AbortSignal,
	cardSpans?: CardSpan[],
) => Promise<{ warnings: string[] }>;

const runFfmpegForStdout: RunFfmpeg = (binary, args, { timeoutMs, signal }) =>
	new Promise<Buffer>((resolve, reject) => {
		execFile(
			binary,
			args,
			{
				encoding: "buffer",
				timeout: timeoutMs,
				maxBuffer: VERIFY_MAX_BUFFER,
				signal,
				windowsHide: true,
			},
			(error, stdout, stderr) => {
				if (!error) return resolve(stdout);
				reject(Object.assign(error, { stderr }));
			},
		);
	});

const defaultVerifyFrames: VerifyFrames = (filePath, durationMs, signal, cardSpans) =>
	verifyExportedFrames(filePath, {
		binary: getFfmpegBinaryPath(),
		runFfmpeg: runFfmpegForStdout,
		durationMs,
		signal,
		cardSpans,
	});

const defaultRunFfmpeg = (args: string[]) =>
	new Promise<void>((resolve, reject) => {
		execFile(
			getFfmpegBinaryPath(),
			args,
			{ timeout: PAD_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
			(error, _stdout, stderr) =>
				error
					? reject(new Error(stderr.trim().split("\n").pop() || error.message))
					: resolve(),
		);
	});

const defaultProbe: ProbeVideo = async (videoPath, signal) => {
	const output = await new Promise<string>((resolve, reject) => {
		execFile(
			getFfmpegBinaryPath(),
			["-hide_banner", "-i", videoPath],
			{ timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, signal },
			(error, stdout, stderr) => {
				const text = `${stdout}\n${stderr}`;
				// ffmpeg -i with no output exits 1 after printing the stream info.
				if (error && !/Duration:/.test(text)) reject(error);
				else resolve(text);
			},
		);
	});
	const meta = parseNativeVideoMetadataProbeOutput(output);
	if (!meta) throw new Error("FFmpeg did not report a video stream.");
	const videoLine = output.split(/\r?\n/).find((line) => /\bVideo:\s*/i.test(line)) ?? "";
	return {
		width: meta.width,
		height: meta.height,
		durationMs: Math.round(meta.duration * 1000),
		fps: parseFfmpegFrameRate(videoLine),
	};
};

const fileExists = (filePath: string) =>
	fs.stat(filePath, { bigint: true }).then(
		(stats) => stats,
		() => null,
	);

type FileIdentity = { dev: bigint; ino: bigint };

export function isSameFile(
	first: string,
	firstStats: FileIdentity,
	second: string,
	secondStats: FileIdentity,
	platform: NodeJS.Platform = process.platform,
) {
	const normalize = (filePath: string) =>
		platform === "win32" ? path.resolve(filePath).toLowerCase() : path.resolve(filePath);
	if (normalize(first) === normalize(second)) return true;
	return (
		firstStats.ino !== 0n &&
		firstStats.dev === secondStats.dev &&
		firstStats.ino === secondStats.ino
	);
}

async function resolveTarget(args: RemoteExportArgs, recordingsDir: () => Promise<string>) {
	if (!args.videoPath) throw new Error("There is no recording to export yet.");
	const videoPath = path.resolve(args.videoPath);
	const requested = args.outputPath;
	if (requested !== undefined && !requested.trim()) throw new Error("outputPath is empty.");
	if (requested && !path.isAbsolute(requested)) {
		throw new Error(`outputPath must be an absolute path: ${requested}`);
	}
	const format: ExportFormat =
		args.format ?? (requested?.toLowerCase().endsWith(".gif") ? "gif" : "mp4");
	if (args.chapters && format !== "mp4") {
		throw new Error(
			"chapters only work with mp4 exports: a gif has no chapter track to hold them.",
		);
	}
	const range = readExportRangeArgs(args);
	if (range && args.posterAtMs !== undefined) {
		if (args.posterAtMs < range.fromMs || args.posterAtMs > range.toMs) {
			throw new Error(
				`posterAtMs ${Math.round(args.posterAtMs)} is outside the range being rendered (${range.fromMs} to ${range.toMs} ms). It is a time on the edited timeline, so it has to fall inside the range.`,
			);
		}
	}
	const pad = buildPostSpec(
		range && args.posterAtMs !== undefined
			? { ...args, posterAtMs: args.posterAtMs - range.fromMs }
			: args,
	);
	if (pad && format !== "mp4") {
		throw new Error(
			"aspect, padTo, scale, fps, posterAtMs and chapters only work with mp4 exports.",
		);
	}
	const outputPath = requested
		? path.resolve(requested)
		: path.join(await recordingsDir(), `${path.parse(videoPath).name}-export.${format}`);
	if (path.extname(outputPath).toLowerCase() !== `.${format}`) {
		throw new Error(`outputPath must end in .${format} for a ${format} export.`);
	}
	const folder = path.dirname(outputPath);
	if (!(await fileExists(folder))?.isDirectory()) {
		throw new Error(`The folder does not exist: ${folder}`);
	}
	await fs.access(folder, constants.W_OK).catch(() => {
		throw new Error(`Recordly cannot write to the folder: ${folder}`);
	});
	const [existing, recording] = await Promise.all([
		fileExists(outputPath),
		fileExists(videoPath),
	]);
	if (!recording?.isFile()) throw new Error(`There is no recording file at ${videoPath}.`);
	if (existing && recording && isSameFile(outputPath, existing, videoPath, recording)) {
		throw new Error("outputPath cannot be the recording itself.");
	}
	if (existing && !existing.isFile()) throw new Error(`${outputPath} is not a regular file.`);
	if (existing && !args.overwrite) {
		throw new Error(`${outputPath} already exists. Pass overwrite: true to replace it.`);
	}
	return { videoPath, outputPath, format, pad, range };
}

export function createRemoteExport({
	ipc = ipcMain,
	recordingsDir = getRecordingsDir,
	runFfmpeg = defaultRunFfmpeg,
	probeVideo = defaultProbe,
	verifyFrames = defaultVerifyFrames,
	loadScenes,
	loadCardSpans,
}: {
	ipc?: Pick<IpcMain, "on">;
	recordingsDir?: () => Promise<string>;
	runFfmpeg?: (args: string[]) => Promise<void>;
	probeVideo?: ProbeVideo;
	verifyFrames?: VerifyFrames;
	loadScenes?: LoadScenes;
	loadCardSpans?: LoadCardSpans;
} = {}) {
	const readyEditors = new Map<WebContents, string>();
	const watchedEditors = new WeakSet<WebContents>();
	const readyCheckers = new Set<() => void>();
	let status: RemoteExportStatus = {
		state: "idle",
		progress: null,
		outputPath: null,
		error: null,
	};
	let busy = false;
	let active: ActiveExport | null = null;

	function forgetEditor(editor: WebContents) {
		readyEditors.delete(editor);
		if (active?.editor === editor) {
			active.settle({
				id: active.id,
				ok: false,
				error: "The editor closed or reloaded during the export.",
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
	ipc.on("remote-export-progress", (_event, update: RemoteExportProgress) => {
		if (!active || update?.id !== active.id || !Number.isFinite(update.progress)) return;
		const pct = Math.round(Math.min(100, Math.max(0, update.progress)));
		if (pct <= (status.progress ?? -1)) return;
		status = { ...status, progress: pct };
		active.onProgress?.(pct);
	});
	ipc.on("remote-export-result", (_event, result: RemoteExportResult) => {
		if (active && result?.id === active.id) active.settle(result);
	});

	function fail(message: string) {
		status = { ...status, state: "failed", error: message };
		busy = false;
	}

	function waitForEditor(videoPath: string, signal?: AbortSignal) {
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
				for (const [editor, readyPath] of readyEditors) {
					if (editor.isDestroyed() || editor.isCrashed()) readyEditors.delete(editor);
					else if (readyPath === videoPath) {
						cleanup();
						resolve(editor);
						return;
					}
				}
			};
			const onAbort = () => stop("The export was canceled.");
			const timer = setTimeout(
				() =>
					stop(
						`The editor did not finish loading ${videoPath} within ${EDITOR_READY_TIMEOUT_MS / 1000} s. Is the editor open?`,
					),
				EDITOR_READY_TIMEOUT_MS,
			);
			readyCheckers.add(check);
			signal?.addEventListener("abort", onAbort, { once: true });
			check();
		});
	}

	function runInEditor(
		editor: WebContents,
		request: RemoteExportRequest,
		onProgress?: (pct: number) => void,
	) {
		return new Promise<RemoteExportResult>((resolve) => {
			const settle = (result: RemoteExportResult) => {
				if (active?.id !== request.id) return;
				active = null;
				if (result.ok) {
					status = {
						state: "done",
						progress: 100,
						outputPath: result.path ?? request.outputPath,
						error: null,
					};
					busy = false;
				} else {
					fail(result.error ?? "The export failed.");
				}
				resolve(result);
			};
			active = { id: request.id, editor, onProgress, settle };
			try {
				editor.send("remote-export-request", request);
			} catch {
				forgetEditor(editor);
			}
		});
	}

	async function exportVideo(
		args: RemoteExportArgs,
		opts: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
	): Promise<
		| ({ status: "done"; path: string } & ExportedVideoInfo & Partial<ExportedFragmentInfo>)
		| { status: "still-exporting" }
	> {
		if (busy) throw new Error("An export is already running. get_status shows its progress.");
		busy = true;
		let target: Awaited<ReturnType<typeof resolveTarget>>;
		try {
			opts.signal?.throwIfAborted();
			target = await resolveTarget(args, recordingsDir);
		} catch (error) {
			busy = false;
			throw error;
		}
		status = {
			state: "waiting-for-editor",
			progress: null,
			outputPath: target.outputPath,
			error: null,
		};
		let editor: WebContents;
		try {
			editor = await waitForEditor(target.videoPath, opts.signal);
		} catch (error) {
			fail((error as Error).message);
			throw error;
		}
		let pad = target.pad;
		let chapterInfo: Pick<ExportedVideoInfo, "chapters" | "chaptersNote"> = {};
		if (args.chapters && pad) {
			try {
				if (!loadScenes) throw new Error("Chapters are not available in this build.");
				const scenes = await loadScenes(opts.signal);
				if ("unavailable" in scenes) {
					chapterInfo = {
						chapters: 0,
						chaptersNote: `No chapters were written. ${scenes.unavailable}`,
					};
				} else {
					const chapters = rebaseChapters(scenes, target.range);
					chapterInfo = chapters.length
						? { chapters: chapters.length }
						: {
								chapters: 0,
								chaptersNote: target.range
									? "No chapters were written: no rehearsed scene falls inside the exported range."
									: "No chapters were written: the recording has no rehearsed scenes.",
							};
					pad = { ...pad, chapters };
				}
			} catch (error) {
				fail((error as Error).message);
				throw error;
			}
			if (!pad.chapters?.length && !pad.filter && pad.posterAtMs === undefined) pad = null;
		}
		status = { ...status, state: "exporting", progress: 0 };
		// The editor renders at its own size; padding is a second ffmpeg pass over its file.
		const id = randomUUID();
		const unique = id.slice(0, 8);
		const rendered = pad
			? path.join(
					path.dirname(target.outputPath),
					`.${path.parse(target.outputPath).name}.prepad-${unique}.mp4`,
				)
			: target.outputPath;
		const request: RemoteExportRequest = {
			id,
			outputPath: rendered,
			format: target.format,
			quality: args.quality,
			...target.range,
		};
		const describeFile = async (
			filePath: string,
			signal?: AbortSignal,
		): Promise<ExportedVideoInfo> => {
			let info: ExportedVideoInfo;
			try {
				info = await probeVideo(filePath, signal);
			} catch (error) {
				return {
					probeNote: `The file was written but could not be read back: ${(error as Error).message}`,
				};
			}
			let spans: CardSpan[] | undefined;
			if (loadCardSpans) {
				try {
					const fromMs = target.range?.fromMs ?? 0;
					spans = (await loadCardSpans(signal))
						.map((span) => ({
							startMs: span.startMs - fromMs,
							endMs: span.endMs - fromMs,
						}))
						.filter((span) => span.endMs > 0);
				} catch {
					spans = undefined;
				}
			}
			try {
				const checked = await verifyFrames(filePath, info.durationMs, signal, spans);
				return checked.warnings.length > 0 ? { ...info, warnings: checked.warnings } : info;
			} catch (error) {
				return {
					...info,
					warnings: [
						`The exported frames could not be checked: ${(error as Error).message}`,
					],
				};
			}
		};
		const withFragment = <T extends ExportedVideoInfo>(reply: RemoteExportResult, info: T) => {
			const warnings = [...(reply.warnings ?? []), ...(info.warnings ?? [])];
			return {
				...info,
				...(warnings.length > 0 ? { warnings } : {}),
				...describeFragment(reply),
			};
		};
		const padRendered = async (
			renderedPath: string,
			reply: RemoteExportResult,
			signal?: AbortSignal,
		) => {
			const staged = `${target.outputPath}.padding-${unique}.mp4`;
			const chaptersFile = path.join(
				path.dirname(target.outputPath),
				`.${path.parse(target.outputPath).name}.chapters-${unique}.txt`,
			);
			busy = true;
			status = { ...status, state: "exporting", progress: 99, outputPath: target.outputPath };
			try {
				const spec = pad as PostSpec;
				let posterSeekMs = spec.posterAtMs;
				if (posterSeekMs !== undefined) {
					const { durationMs } = await probeVideo(renderedPath, signal);
					if (durationMs === undefined || posterSeekMs > durationMs) {
						throw new Error(
							`posterAtMs ${Math.round(posterSeekMs)} is past the end of the exported video (${durationMs ?? "unknown"} ms)`,
						);
					}
					posterSeekMs = Math.min(
						posterSeekMs,
						Math.max(0, durationMs - POSTER_END_BACKOFF_MS),
					);
				}
				if (spec.chapters?.length) {
					await fs.writeFile(chaptersFile, buildChapterMetadata(spec.chapters), "utf8");
				}
				await runFfmpeg(
					buildPostArgs(
						renderedPath,
						staged,
						spec,
						posterSeekMs,
						spec.chapters?.length ? chaptersFile : undefined,
					),
				);
				await fs.rename(staged, target.outputPath);
				status = { ...status, state: "done", progress: 100, outputPath: target.outputPath };
			} catch (error) {
				const reason = (error as Error).message;
				const kept = await fs.rename(renderedPath, target.outputPath).then(
					() => true,
					() => false,
				);
				status = { ...status, state: "failed", error: reason };
				const label = pad?.label ?? "post-processing";
				throw new Error(
					kept
						? `The export finished but ${label} it failed: ${reason}. The ${label === "padding" ? "unpadded" : "unprocessed"} video is at ${target.outputPath}.`
						: `The export finished but ${label} it failed: ${reason}`,
				);
			} finally {
				busy = false;
				await Promise.all([
					fs.rm(staged, { force: true }),
					fs.rm(chaptersFile, { force: true }),
					fs.rm(renderedPath, { force: true }),
				]);
			}
			return {
				status: "done" as const,
				path: target.outputPath,
				...withFragment(reply, await describeFile(target.outputPath, signal)),
				...chapterInfo,
			};
		};
		const completion = runInEditor(editor, request, opts.onProgress);
		const result = await new Promise<RemoteExportResult | null>((resolve) => {
			const detach = () => resolve(null);
			const timer = setTimeout(detach, EXPORT_WAIT_CAP_MS);
			opts.signal?.addEventListener("abort", detach, { once: true });
			void completion.then((done) => {
				clearTimeout(timer);
				opts.signal?.removeEventListener("abort", detach);
				resolve(done);
			});
		});
		if (!result) {
			if (active?.id === request.id) active.onProgress = undefined;
			// A padded export that outlives the wait finishes padding in the background.
			if (pad) {
				void completion
					.then(async (done) => {
						if (done.ok) await padRendered(done.path ?? rendered, done);
						else await fs.rm(rendered, { force: true });
					})
					.catch(() => undefined);
			}
			return { status: "still-exporting" };
		}
		if (!result.ok) {
			if (pad) await fs.rm(rendered, { force: true });
			throw new Error(result.error ?? "The export failed.");
		}
		if (!pad) {
			const donePath = result.path ?? request.outputPath;
			return {
				status: "done",
				path: donePath,
				...withFragment(result, await describeFile(donePath, opts.signal)),
				...chapterInfo,
			};
		}
		return padRendered(result.path ?? rendered, result, opts.signal);
	}

	const verifyFile = async (filePath: string, samples?: number, signal?: AbortSignal) => {
		if (!path.isAbsolute(filePath)) {
			throw new Error(`path must be an absolute path: ${filePath}`);
		}
		const target = path.resolve(filePath);
		await fs.access(target, constants.R_OK).catch(() => {
			throw new Error(`There is no readable file at ${target}.`);
		});
		const checked = await verifyExportedFrames(target, {
			binary: getFfmpegBinaryPath(),
			runFfmpeg: runFfmpegForStdout,
			samples,
			signal,
		});
		return {
			path: target,
			checked: checked.checked,
			emptyAtMs: checked.emptyAtMs,
			warnings: checked.warnings,
			note:
				checked.warnings.length === 0
					? `Every one of the ${checked.checked} frames sampled has a picture.`
					: "A deliberate fade or a plain card looks the same as a fault here; check the moments named before deciding.",
		};
	};

	return {
		exportVideo,
		verifyFile,
		getStatus: (): RemoteExportStatus => ({ ...status }),
	};
}

export type RemoteExport = ReturnType<typeof createRemoteExport>;
