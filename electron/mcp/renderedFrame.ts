import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	type AnnotationRegion,
	type AnnotationType,
	BASE_PREVIEW_HEIGHT,
	BASE_PREVIEW_WIDTH,
	BLUR_ANNOTATION_STRENGTH,
} from "../../src/components/video-editor/types";
import { describeFfmpegError } from "./ffmpegError";
import type { RunFfmpeg } from "./remoteEditor";

const COMPOSITE_TIMEOUT_MS = 30_000;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

export type RenderedAnnotation = {
	id: string;
	type: AnnotationType;
	drawn: boolean;
	note?: string;
};

export type RenderedFrame = {
	png: Buffer;
	composited: boolean;
	width: number;
	height: number;
	annotations: RenderedAnnotation[];
	note?: string;
};

export function pngSize(png: Buffer) {
	if (png.length < 24 || !png.subarray(0, 4).equals(PNG_SIGNATURE)) return null;
	if (png.subarray(12, 16).toString("latin1") !== "IHDR") return null;
	const width = png.readUInt32BE(16);
	const height = png.readUInt32BE(20);
	if (width < 1 || height < 1) return null;
	return { width, height };
}

type BlurPlan = {
	report: RenderedAnnotation;
	draw?: { filter: string; x: number; y: number };
};

function planAnnotation(
	annotation: AnnotationRegion,
	frameWidth: number,
	frameHeight: number,
	scaleFactor: number,
): BlurPlan {
	const id = annotation.id;
	const type = annotation.type;
	if (type !== "blur") {
		return {
			report: {
				id,
				type,
				drawn: false,
				note: `A ${type} annotation covers this moment but Recordly cannot draw it faithfully on a frame, so this frame shows the recorded screen there instead of the ${type}.`,
			},
		};
	}
	const geometry = [
		annotation.position?.x,
		annotation.position?.y,
		annotation.size?.width,
		annotation.size?.height,
	];
	if (!geometry.every((value) => Number.isFinite(value))) {
		return {
			report: { id, type, drawn: false, note: "Its position or size is not a number." },
		};
	}
	const rawWidth = Math.round((annotation.size.width / 100) * frameWidth);
	const rawHeight = Math.round((annotation.size.height / 100) * frameHeight);
	if (rawWidth < 1 || rawHeight < 1) {
		return {
			report: {
				id,
				type,
				drawn: false,
				note: "It is less than one pixel wide or tall on this frame, so it hides nothing.",
			},
		};
	}
	const rawX = Math.round((annotation.position.x / 100) * frameWidth);
	const rawY = Math.round((annotation.position.y / 100) * frameHeight);
	const x = Math.max(0, rawX);
	const y = Math.max(0, rawY);
	const width = Math.min(frameWidth, rawX + rawWidth) - x;
	const height = Math.min(frameHeight, rawY + rawHeight) - y;
	if (width < 1 || height < 1) {
		return {
			report: {
				id,
				type,
				drawn: false,
				note: "It lies outside the frame, so none of it is visible here.",
			},
		};
	}
	const intensity = Number.isFinite(annotation.blurIntensity)
		? (annotation.blurIntensity as number)
		: BLUR_ANNOTATION_STRENGTH;
	const sigma = Math.max(0, intensity) * scaleFactor;
	const padding = Math.ceil(sigma * 2);
	const px = Math.max(0, x - padding);
	const py = Math.max(0, y - padding);
	const pw = Math.min(frameWidth, x + width + padding) - px;
	const ph = Math.min(frameHeight, y + height + padding) - py;
	const notes: string[] = [];
	if (width < rawWidth || height < rawHeight) {
		notes.push("Part of it falls outside the frame and was clipped, as the export clips it.");
	}
	if (annotation.style?.borderRadius) {
		notes.push("Its rounded corners were drawn square, so the corners look blurrier here.");
	}
	let fill = "";
	const blurColor = annotation.blurColor;
	if (blurColor && blurColor !== "transparent") {
		const hex = HEX_COLOR.exec(blurColor);
		if (hex) fill = `,drawbox=0:0:${width}:${height}:color=0x${hex[1]}:t=fill`;
		else {
			notes.push(
				`Its ${blurColor} fill was not drawn, so this frame shows only the blur under it; the export covers the area completely.`,
			);
		}
	}
	return {
		report: {
			id,
			type,
			drawn: true,
			...(notes.length > 0 && { note: notes.join(" ") }),
		},
		draw: {
			filter: `crop=${pw}:${ph}:${px}:${py},gblur=sigma=${sigma.toFixed(3)},crop=${width}:${height}:${x - px}:${y - py}${fill}`,
			x,
			y,
		},
	};
}

export async function renderFrameAnnotations(
	{ png, atMs, annotations }: { png: Buffer; atMs: number; annotations: AnnotationRegion[] },
	{
		binary,
		runFfmpeg,
		signal,
		timeoutMs = COMPOSITE_TIMEOUT_MS,
	}: { binary: string; runFfmpeg: RunFfmpeg; signal?: AbortSignal; timeoutMs?: number },
): Promise<RenderedFrame> {
	if (!Number.isFinite(atMs) || atMs < 0) throw new Error("atMs must be 0 or more.");
	const size = pngSize(png);
	if (!size) {
		throw new Error(
			"Recordly cannot draw the annotations: that frame is not a readable PNG image.",
		);
	}
	const { width, height } = size;
	const scaleFactor = (width / BASE_PREVIEW_WIDTH + height / BASE_PREVIEW_HEIGHT) / 2;
	const active = (Array.isArray(annotations) ? annotations : [])
		.filter(
			(annotation) =>
				Number.isFinite(annotation?.startMs) &&
				Number.isFinite(annotation?.endMs) &&
				atMs >= annotation.startMs &&
				atMs <= annotation.endMs,
		)
		.sort((a, b) => a.zIndex - b.zIndex);
	const report: RenderedAnnotation[] = [];
	const steps: string[] = [];
	let base = "0:v";
	let drawn = 0;
	for (const annotation of active) {
		const plan = planAnnotation(annotation, width, height, scaleFactor);
		report.push(plan.report);
		if (!plan.draw) continue;
		const index = drawn++;
		steps.push(
			`[${base}]split=2[k${index}][s${index}]`,
			`[s${index}]${plan.draw.filter}[p${index}]`,
			`[k${index}][p${index}]overlay=${plan.draw.x}:${plan.draw.y}[v${index}]`,
		);
		base = `v${index}`;
	}
	if (base === "0:v") {
		return {
			png,
			composited: false,
			width,
			height,
			annotations: report,
			note:
				report.length === 0
					? `No annotation covers ${Math.round(atMs)} ms, so this is the recorded screen unchanged.`
					: `Nothing could be drawn at ${Math.round(atMs)} ms, so this is the recorded screen unchanged.`,
		};
	}
	if (signal?.aborted) throw new Error("The request was canceled.");
	const input = path.join(os.tmpdir(), `recordly-annotated-${randomUUID()}.png`);
	try {
		await fs.writeFile(input, png);
		const out = await runFfmpeg(
			binary,
			[
				"-hide_banner",
				"-nostats",
				"-loglevel",
				"error",
				"-i",
				input,
				"-filter_complex",
				steps.join(";"),
				"-map",
				`[${base}]`,
				"-frames:v",
				"1",
				"-f",
				"image2pipe",
				"-c:v",
				"png",
				"pipe:1",
			],
			{ timeoutMs, signal },
		).catch((error) => {
			throw new Error(
				`Recordly could not draw the annotations on that frame: ${describeFfmpegError(error, timeoutMs)}`,
			);
		});
		if (out.length === 0) {
			throw new Error("Recordly could not draw the annotations on that frame: no image.");
		}
		if (!pngSize(out)) {
			throw new Error(
				"Recordly could not draw the annotations on that frame: FFmpeg did not return an image.",
			);
		}
		if (out.length > MAX_FRAME_BYTES) {
			throw new Error(
				`The annotated frame is ${out.length} bytes, over the ${MAX_FRAME_BYTES} byte limit.`,
			);
		}
		return { png: out, composited: true, width, height, annotations: report };
	} finally {
		await fs.rm(input, { force: true }).catch(() => undefined);
	}
}
