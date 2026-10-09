import { calculateMp4SourceDimensions } from "../../exportDimensions";
import { resolveVideoUrl } from "../../projectPersistence";
import {
	type ClipRegion,
	findClipAtTimelineTime,
	getTimelineDurationMs,
	mapTimelineTimeToSourceTime,
} from "../../types";
import { buildExportRenderOptions } from "../buildExportRenderOptions";
import {
	type EditorOpContext,
	type EditorOpMap,
	rejectUnknown,
	requireFiniteNumber,
	requireObject,
} from "./types";

export const MIN_PREVIEW_FRAMES = 2;
export const MAX_PREVIEW_FRAMES = 6;
export const MIN_EVERY_MS = 17;
export const MAX_SINGLE_WIDTH = 1280;
export const MAX_TILE_WIDTH = 640;
export const MIN_FRAMING_SCALE = 0.05;
export const MAX_FRAMED_SIDE = 8192;

const TILE_GAP = 6;
const JPEG_QUALITY = 0.92;
const LOAD_TIMEOUT_MS = 20_000;
const SEEK_TIMEOUT_MS = 10_000;
const INIT_TIMEOUT_MS = 20_000;
const RENDER_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 120_000;
const END_FRAME_BACKOFF_MS = 40;
const FALLBACK_PREVIEW_WIDTH = 1920;
const FALLBACK_PREVIEW_HEIGHT = 1080;
const IDLE_TEARDOWN_MS = 60_000;
const SEEK_EPSILON_S = 0.001;

const NO_PROGRESS = () => undefined;

export type PreviewFrame = { atMs: number; sourceMs: number };

export type PreviewFraming = {
	aspect?: { w: number; h: number };
	padTo?: { width: number; height: number };
	scale?: number;
};

export type PreviewPlan = {
	frames: PreviewFrame[];
	skippedAtMs: number[];
	cols: number;
	rows: number;
	durationMs: number;
	framing: PreviewFraming | null;
};

export type FramedOutput = {
	width: number;
	height: number;
	contentWidth: number;
	contentHeight: number;
	contentX: number;
	contentY: number;
};

function even(value: number) {
	return Math.max(2, 2 * Math.floor(value / 2));
}

function evenUp(value: number) {
	return Math.max(2, 2 * Math.ceil(value / 2));
}

function evenDown(value: number) {
	return 2 * Math.floor(value / 2);
}

export function parseFraming(args: Record<string, unknown>): PreviewFraming | null {
	const { aspect, padTo, scale } = args;
	if (aspect !== undefined && padTo !== undefined) {
		throw new Error("Pass either aspect or padTo, not both.");
	}
	if (padTo !== undefined && scale !== undefined) {
		throw new Error(
			"Pass either padTo or scale, not both: padTo already fixes the output size. Use aspect with scale, or padTo alone.",
		);
	}
	const framing: PreviewFraming = {};
	if (aspect !== undefined) {
		const match =
			typeof aspect === "string"
				? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim())
				: null;
		if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
			throw new Error(`aspect must look like 16:9, not ${JSON.stringify(aspect)}.`);
		}
		framing.aspect = { w: Number(match[1]), h: Number(match[2]) };
	}
	if (padTo !== undefined) {
		const match = typeof padTo === "string" ? /^(\d+)x(\d+)$/i.exec(padTo.trim()) : null;
		const [width, height] = [Number(match?.[1]), Number(match?.[2])];
		if (!match || width < 2 || height < 2 || width % 2 || height % 2) {
			throw new Error(
				`padTo must look like 2880x1600 with even sizes, not ${JSON.stringify(padTo)}.`,
			);
		}
		if (width > MAX_FRAMED_SIDE || height > MAX_FRAMED_SIDE) {
			throw new Error(`padTo cannot be larger than ${MAX_FRAMED_SIDE} px on a side.`);
		}
		framing.padTo = { width, height };
	}
	if (scale !== undefined) {
		if (
			typeof scale !== "number" ||
			!Number.isFinite(scale) ||
			scale < MIN_FRAMING_SCALE ||
			scale > 1
		) {
			throw new Error(
				`scale must be a number from ${MIN_FRAMING_SCALE} to 1 (it only shrinks), not ${JSON.stringify(scale)}.`,
			);
		}
		framing.scale = scale;
	}
	return Object.keys(framing).length > 0 ? framing : null;
}

export function frameOutput(
	width: number,
	height: number,
	framing: PreviewFraming | null,
): FramedOutput {
	let outWidth = width;
	let outHeight = height;
	let contentWidth = width;
	let contentHeight = height;
	if (framing?.aspect) {
		const { w, h } = framing.aspect;
		outWidth = evenUp(Math.max(width, (height * w) / h));
		outHeight = evenUp(Math.max(height, (width * h) / w));
	} else if (framing?.padTo) {
		outWidth = framing.padTo.width;
		outHeight = framing.padTo.height;
		contentWidth = even(Math.min(outWidth, Math.round((outHeight * width) / height)));
		contentHeight = even(Math.min(outHeight, Math.round((outWidth * height) / width)));
	}
	let contentX = evenDown((outWidth - contentWidth) / 2);
	let contentY = evenDown((outHeight - contentHeight) / 2);
	if (framing?.scale !== undefined) {
		const shrunkWidth = even(outWidth * framing.scale);
		const shrunkHeight = even(outHeight * framing.scale);
		const factorX = shrunkWidth / outWidth;
		const factorY = shrunkHeight / outHeight;
		contentX *= factorX;
		contentY *= factorY;
		contentWidth *= factorX;
		contentHeight *= factorY;
		outWidth = shrunkWidth;
		outHeight = shrunkHeight;
	}
	if (outWidth > MAX_FRAMED_SIDE || outHeight > MAX_FRAMED_SIDE) {
		throw new Error(
			`Those framing settings letterbox a ${width}x${height} frame out to ${outWidth}x${outHeight}, and render_preview will not composite a side over ${MAX_FRAMED_SIDE} px. An export would still produce that size.`,
		);
	}
	return { width: outWidth, height: outHeight, contentWidth, contentHeight, contentX, contentY };
}

export function timelineToSourceMs(atMs: number, clips: ClipRegion[]): number | null {
	if (clips.length === 0) return Math.round(atMs);
	if (findClipAtTimelineTime(atMs, clips)) return mapTimelineTimeToSourceTime(atMs, clips);
	const lastEndMs = clips.reduce((end, clip) => Math.max(end, clip.endMs), 0);
	if (atMs === lastEndMs) return mapTimelineTimeToSourceTime(atMs - 1, clips);
	return null;
}

export function planPreview(
	payload: unknown,
	{ clipRegions, durationMs }: { clipRegions: ClipRegion[]; durationMs: number },
): PreviewPlan {
	const args = requireObject(payload, "render_preview");
	rejectUnknown(args, ["atMs", "count", "everyMs", "aspect", "padTo", "scale"], "render_preview");
	const framing = parseFraming(args);
	const { atMs, count, everyMs } = args;
	if (atMs !== undefined && (count !== undefined || everyMs !== undefined)) {
		throw new Error(
			"render_preview takes atMs for one frame or count/everyMs for a contact sheet, not both.",
		);
	}
	if (count !== undefined && everyMs !== undefined) {
		throw new Error("render_preview takes exactly one of count or everyMs.");
	}
	if (!(durationMs > 0)) {
		throw new Error(
			"The edited timeline has no length to preview yet. Load a recording in the editor first.",
		);
	}
	let times: number[];
	if (count !== undefined) {
		if (
			!Number.isInteger(count) ||
			(count as number) < MIN_PREVIEW_FRAMES ||
			(count as number) > MAX_PREVIEW_FRAMES
		) {
			throw new Error(
				`count must be a whole number from ${MIN_PREVIEW_FRAMES} to ${MAX_PREVIEW_FRAMES}. Each frame is composited one at a time, so a sheet is slow; pass atMs for a single frame.`,
			);
		}
		const total = count as number;
		times = Array.from({ length: total }, (_, index) =>
			Math.round((index * durationMs) / (total - 1)),
		);
	} else if (everyMs !== undefined) {
		const every = requireFiniteNumber(everyMs, "everyMs");
		if (every < MIN_EVERY_MS) {
			throw new Error(`everyMs must be at least ${MIN_EVERY_MS} ms (one frame at 60 fps).`);
		}
		const total = Math.floor(durationMs / every) + 1;
		if (total < MIN_PREVIEW_FRAMES) {
			throw new Error(
				`everyMs ${Math.round(every)} is longer than the edited timeline (${Math.round(durationMs)} ms).`,
			);
		}
		if (total > MAX_PREVIEW_FRAMES) {
			throw new Error(
				`everyMs ${Math.round(every)} would need ${total} frames over ${Math.round(durationMs)} ms; the most is ${MAX_PREVIEW_FRAMES}. Use a larger everyMs or pass count.`,
			);
		}
		times = Array.from({ length: total }, (_, index) => Math.round(index * every));
	} else {
		const at = atMs === undefined ? 0 : requireFiniteNumber(atMs, "atMs");
		if (at < 0) throw new Error("atMs must be 0 or more.");
		if (at > durationMs) {
			throw new Error(
				`atMs ${Math.round(at)} is past the end of the edited timeline (${Math.round(durationMs)} ms).`,
			);
		}
		times = [Math.round(at)];
	}
	const frames: PreviewFrame[] = [];
	const skippedAtMs: number[] = [];
	for (const time of times) {
		const sourceMs = timelineToSourceMs(time, clipRegions);
		if (sourceMs === null) skippedAtMs.push(time);
		else frames.push({ atMs: time, sourceMs });
	}
	if (frames.length === 0) {
		throw new Error(
			`Nothing plays at ${skippedAtMs.join(", ")} ms; it falls in a gap between clips.`,
		);
	}
	if (times.length > 1 && frames.length < MIN_PREVIEW_FRAMES) {
		throw new Error(
			"Fewer than two of those moments play anything; the rest fall in gaps between clips.",
		);
	}
	const cols = Math.ceil(Math.sqrt(frames.length));
	return {
		frames,
		skippedAtMs,
		cols,
		rows: Math.ceil(frames.length / cols),
		durationMs,
		framing,
	};
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, waitingFor: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		work,
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new Error(
							`Timed out after ${Math.round(timeoutMs / 1000)} seconds waiting for ${waitingFor}.`,
						),
					),
				timeoutMs,
			);
		}),
	]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function settleVideo(video: HTMLVideoElement, event: "loadeddata" | "seeked", waitingFor: string) {
	return withTimeout(
		new Promise<void>((resolve, reject) => {
			const done = (error?: Error) => {
				video.removeEventListener(event, onEvent);
				video.removeEventListener("error", onError);
				error ? reject(error) : resolve();
			};
			const onEvent = () => done();
			const onError = () =>
				done(new Error(`The recording could not be decoded for a preview.`));
			video.addEventListener(event, onEvent, { once: true });
			video.addEventListener("error", onError, { once: true });
		}),
		event === "seeked" ? SEEK_TIMEOUT_MS : LOAD_TIMEOUT_MS,
		waitingFor,
	);
}

function previewPixelSize() {
	const overlay = document.querySelector<HTMLElement>("[data-preview-overlay]");
	const width = overlay?.clientWidth || 0;
	const height = overlay?.clientHeight || 0;
	if (width > 0 && height > 0) return { width, height, measured: true };
	return { width: FALLBACK_PREVIEW_WIDTH, height: FALLBACK_PREVIEW_HEIGHT, measured: false };
}

type WarmRenderer = {
	config: Record<string, unknown>;
	cursorArtwork: string | null;
	canvas: () => HTMLCanvasElement;
	destroy: () => void;
	draw: (video: HTMLVideoElement, frame: PreviewFrame, seekMs: number) => Promise<void>;
};

let rendering = false;
let teardownPending = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let warmVideo: { sourcePath: string; element: HTMLVideoElement } | null = null;
let warmRenderer: WarmRenderer | null = null;

export function sameRendererConfig(left: Record<string, unknown>, right: Record<string, unknown>) {
	for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
		if (left[key] !== right[key]) return false;
	}
	return true;
}

function dropRenderer() {
	const held = warmRenderer;
	warmRenderer = null;
	if (held) release(() => held.destroy());
}

function dropVideo() {
	const held = warmVideo;
	warmVideo = null;
	if (held) {
		release(() => {
			held.element.removeAttribute("src");
			held.element.load();
		});
	}
}

export function teardownPreviewCache() {
	clearTimeout(idleTimer);
	idleTimer = undefined;
	if (rendering) {
		teardownPending = true;
		return false;
	}
	teardownPending = false;
	dropRenderer();
	dropVideo();
	return true;
}

function armIdleTeardown() {
	clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		idleTimer = undefined;
		teardownPreviewCache();
	}, IDLE_TEARDOWN_MS);
}

export function previewSheetGeometry(drawnCount: number, planCols: number) {
	const cols = Math.max(1, drawnCount < planCols ? drawnCount : planCols);
	return { cols, rows: Math.max(1, Math.ceil(Math.max(1, drawnCount) / cols)) };
}

function cropSheet(sheet: HTMLCanvasElement, size: { width: number; height: number }) {
	const cropped = document.createElement("canvas");
	cropped.width = size.width;
	cropped.height = size.height;
	const ctx = cropped.getContext("2d");
	if (!ctx) return sheet;
	ctx.drawImage(sheet, 0, 0, size.width, size.height, 0, 0, size.width, size.height);
	return cropped;
}

export async function renderPreview(payload: unknown, context: EditorOpContext) {
	const { timeline, appearance, videoSourcePath, duration } = context;
	if (!videoSourcePath) {
		throw new Error(
			"There is no recording loaded in the editor, so there is nothing to preview.",
		);
	}
	const sourceDurationMs = Math.round(duration * 1000);
	const plan = planPreview(payload, {
		clipRegions: timeline.clipRegions,
		durationMs: getTimelineDurationMs(timeline.clipRegions, sourceDurationMs),
	});
	if (rendering) {
		throw new Error("A preview is already rendering. Wait for it to finish, then try again.");
	}
	rendering = true;
	const reused: string[] = [];
	let settled = false;
	try {
		if (warmVideo && warmVideo.sourcePath !== videoSourcePath) {
			dropRenderer();
			dropVideo();
		}
		let video = warmVideo?.element ?? null;
		if (video) reused.push("decoded video");
		else {
			const element = document.createElement("video");
			const url = await withTimeout(
				resolveVideoUrl(videoSourcePath),
				LOAD_TIMEOUT_MS,
				"a playable URL for the recording",
			);
			element.muted = true;
			element.preload = "auto";
			const loaded = settleVideo(element, "loadeddata", "the recording to open for decoding");
			element.src = url;
			await loaded;
			video = element;
			warmVideo = { sourcePath: videoSourcePath, element };
		}
		context.assertSameRecording();
		if (!(video.videoWidth > 0 && video.videoHeight > 0)) {
			throw new Error("The recording reports no picture size, so it cannot be composited.");
		}
		const previewSize = previewPixelSize();
		const exportAspectRatio = context.exportAspectRatio ?? "native";
		const native = calculateMp4SourceDimensions(
			video.videoWidth,
			video.videoHeight,
			exportAspectRatio,
			appearance.cropRegion,
		);
		const framed = frameOutput(native.width, native.height, plan.framing);
		const cap = plan.frames.length > 1 ? MAX_TILE_WIDTH : MAX_SINGLE_WIDTH;
		const scale = Math.min(1, cap / framed.width);
		const tileWidth = even(framed.width * scale);
		const tileHeight = even(framed.height * scale);
		const pictureWidth = even(framed.contentWidth * scale);
		const pictureHeight = even(framed.contentHeight * scale);
		const pictureX = Math.round((tileWidth - pictureWidth) / 2);
		const pictureY = Math.round((tileHeight - pictureHeight) / 2);
		const config = buildRendererConfig({
			context,
			pictureWidth,
			pictureHeight,
			video,
			previewWidth: previewSize.width,
			previewHeight: previewSize.height,
		});
		if (warmRenderer && !sameRendererConfig(warmRenderer.config, config)) dropRenderer();
		if (warmRenderer) reused.push("export renderer");
		else warmRenderer = await openRenderer(config);
		const renderer = warmRenderer;
		const layers = describeLayers(context, renderer.cursorArtwork);
		const sheet = document.createElement("canvas");
		sheet.width = plan.cols * tileWidth + (plan.cols - 1) * TILE_GAP;
		sheet.height = plan.rows * tileHeight + (plan.rows - 1) * TILE_GAP;
		const sheetCtx = sheet.getContext("2d");
		if (!sheetCtx) throw new Error("This window cannot open a 2D canvas for the preview.");
		const lastSeekMs = Math.max(0, sourceDurationMs - END_FRAME_BACKOFF_MS);
		const drawn: PreviewFrame[] = [];
		const deadline = Date.now() + TOTAL_BUDGET_MS;
		let budgetNote: string | undefined;
		for (const [index, frame] of plan.frames.entries()) {
			if (drawn.length >= MIN_PREVIEW_FRAMES && Date.now() > deadline) {
				budgetNote = `Only the first ${drawn.length} of ${plan.frames.length} frames were composited: the ${TOTAL_BUDGET_MS / 1000} second budget ran out. Ask for fewer frames, or one atMs at a time.`;
				break;
			}
			context.assertSameRecording();
			const seekMs = Math.min(frame.sourceMs, lastSeekMs);
			const targetSeconds = seekMs / 1000;
			if (Math.abs(video.currentTime - targetSeconds) > SEEK_EPSILON_S) {
				const seeked = settleVideo(
					video,
					"seeked",
					`the recording to seek to ${Math.round(seekMs)} ms`,
				);
				video.currentTime = targetSeconds;
				await seeked;
			}
			await renderer.draw(video, frame, seekMs);
			const cellX = (index % plan.cols) * (tileWidth + TILE_GAP);
			const cellY = Math.floor(index / plan.cols) * (tileHeight + TILE_GAP);
			sheetCtx.fillStyle = "#000000";
			sheetCtx.fillRect(cellX, cellY, tileWidth, tileHeight);
			sheetCtx.drawImage(
				renderer.canvas(),
				cellX + pictureX,
				cellY + pictureY,
				pictureWidth,
				pictureHeight,
			);
			drawn.push(frame);
		}
		const { cols, rows } = previewSheetGeometry(drawn.length, plan.cols);
		const used =
			cols === plan.cols && rows === plan.rows
				? sheet
				: cropSheet(sheet, {
						width: cols * tileWidth + (cols - 1) * TILE_GAP,
						height: rows * tileHeight + (rows - 1) * TILE_GAP,
					});
		const dataUrl = used.toDataURL("image/jpeg", JPEG_QUALITY);
		const comma = dataUrl.indexOf(",");
		if (comma < 0) throw new Error("The preview canvas returned no image.");
		settled = true;
		return {
			image: {
				data: dataUrl.slice(comma + 1),
				mimeType: "image/jpeg" as const,
				width: used.width,
				height: used.height,
			},
			cols,
			rows,
			frames: drawn,
			...(plan.skippedAtMs.length > 0 && { skippedAtMs: plan.skippedAtMs }),
			rendered: layers.rendered,
			notRendered: layers.notRendered,
			reused,
			note: [
				`This is the export's own renderer compositing at ${tileWidth}x${tileHeight} per frame, not the recorded screen.`,
				plan.framing
					? `Those framing settings letterbox the export to ${framed.width}x${framed.height}; the bars here are drawn the way the export's letterbox pass draws them, scaled to fit the preview.`
					: undefined,
				exportAspectRatio === "native"
					? undefined
					: `The editor's export aspect ratio is ${exportAspectRatio}, so this composited on the ${native.width}x${native.height} canvas the export will use, not the recording's own shape. That setting is separate from the aspect argument, which only letterboxes.`,
				context.exportAspectRatio === undefined
					? `The editor's export aspect ratio could not be read here, so this assumed Native; an export set to another ratio renders on a differently shaped canvas, which moves the padding, wallpaper and annotations. That setting is separate from the aspect argument, which only letterboxes.`
					: undefined,
				context.effectiveSpeedRegions === undefined &&
				timeline.clipRegions.some((clip) => clip.speed !== 1)
					? `A clip here is not at 1x speed, and the export derives an extra speed region from it that this composite could not read, so cursor and camera motion can differ.`
					: undefined,
				context.effectiveShowCursor === undefined && appearance.showCursor
					? `Whether this recording's session turned the overlay cursor off could not be read here, so a cursor is drawn; the export leaves it out for a session recorded with the system cursor showing.`
					: undefined,
				previewSize.measured
					? undefined
					: `The editor preview could not be measured, so annotation, caption and cursor sizes were scaled against ${FALLBACK_PREVIEW_WIDTH}x${FALLBACK_PREVIEW_HEIGHT}, as a headless export would.`,
				budgetNote,
			]
				.filter(Boolean)
				.join(" "),
		};
	} finally {
		rendering = false;
		if (settled && !teardownPending) armIdleTeardown();
		else teardownPreviewCache();
	}
}

function release(step: () => void) {
	try {
		step();
	} catch (error) {
		console.warn("[render_preview] a preview resource could not be released", error);
	}
}

export function showsCursor({ appearance, effectiveShowCursor }: EditorOpContext) {
	return effectiveShowCursor ?? appearance.showCursor;
}

export function speedRegionsFor({ timeline, effectiveSpeedRegions }: EditorOpContext) {
	return effectiveSpeedRegions ?? timeline.speedRegions;
}

export function describeLayers(context: EditorOpContext, cursorArtwork: string | null) {
	const { timeline } = context;
	const rendered = ["clips and speed", "look", "zooms", "webcam"];
	const notRendered: string[] = [];
	if (cursorArtwork) {
		notRendered.push(
			`cursor: its artwork could not be loaded here (${cursorArtwork}), so no cursor is drawn even though the export draws one`,
		);
	} else if (!showsCursor(context)) {
		notRendered.push("cursor: it is turned off for this export");
	} else if ((timeline.cursorTelemetry ?? []).length === 0) {
		notRendered.push("cursor: this recording carries no cursor telemetry");
	} else rendered.push("cursor");
	if (timeline.annotationRegions.length > 0) rendered.push("annotations");
	if (timeline.autoCaptions.length > 0) {
		if (timeline.autoCaptionSettings?.enabled) rendered.push("captions");
		else notRendered.push("captions: they are turned off in the caption settings");
	}
	return { rendered, notRendered };
}

function buildRendererConfig({
	context,
	pictureWidth,
	pictureHeight,
	video,
	previewWidth,
	previewHeight,
}: {
	context: EditorOpContext;
	pictureWidth: number;
	pictureHeight: number;
	video: HTMLVideoElement;
	previewWidth: number;
	previewHeight: number;
}): Record<string, unknown> {
	const { timeline, appearance } = context;
	return {
		...buildExportRenderOptions({
			appearance,
			timeline,
			effectiveSpeedRegions: speedRegionsFor(context),
			effectiveZoomRegions: timeline.zoomRegions,
			effectiveCursorTelemetry: timeline.cursorTelemetry ?? [],
			effectiveShowCursor: showsCursor(context),
			previewWidth,
			previewHeight,
			shadowIntensity: appearance.shadowIntensity,
			onProgress: NO_PROGRESS,
		}),
		timelineEffects: true,
		width: pictureWidth,
		height: pictureHeight,
		videoWidth: video.videoWidth,
		videoHeight: video.videoHeight,
	};
}

async function openRenderer(config: Record<string, unknown>): Promise<WarmRenderer> {
	const { preloadCursorAssets } = await import("../../videoPlayback/cursorRenderer");
	let cursorArtwork: string | null = null;
	try {
		await withTimeout(preloadCursorAssets(), INIT_TIMEOUT_MS, "the cursor artwork to load");
	} catch (error) {
		cursorArtwork = error instanceof Error ? error.message : String(error);
	}
	const { FrameRenderer } = await import("@/lib/exporter/modernFrameRenderer");
	const renderer = new FrameRenderer(
		config as unknown as ConstructorParameters<typeof FrameRenderer>[0],
	);
	await withTimeout(
		renderer.initialize(),
		INIT_TIMEOUT_MS,
		"the export renderer to start up (it needs a GPU context)",
	);
	return {
		config,
		cursorArtwork,
		canvas: () => renderer.getCanvas(),
		destroy: () => renderer.destroy(),
		draw: async (video: HTMLVideoElement, frame: PreviewFrame, seekMs: number) => {
			const videoFrame = new VideoFrame(video, { timestamp: seekMs * 1000 });
			try {
				await withTimeout(
					renderer.renderFrame(
						videoFrame,
						seekMs * 1000,
						seekMs * 1000,
						undefined,
						frame.atMs * 1000,
					),
					RENDER_TIMEOUT_MS,
					`the export renderer to composite the frame at ${Math.round(frame.atMs)} ms`,
				);
			} finally {
				videoFrame.close();
			}
		},
	};
}

export const previewOps: EditorOpMap = {
	render_preview: renderPreview,
};
