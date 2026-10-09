import { type Display, desktopCapturer, type Size } from "electron";
import { WINDOW_OFF_SCREEN_MESSAGE, type WindowBounds } from "../ipc/types";
import { getScreen } from "../ipc/utils";

export const MAX_IMAGE_EDGE = 1568;
export const MAX_IMAGE_PIXELS = 1_150_000;
const JPEG_QUALITY = 80;
const SAMPLE_EDGE = 320;
const SAMPLE_INTERVAL_MS = 150;
const SAMPLE_QUIET_MS = 400;
const SAMPLE_NOISE_LEVEL = 16;
const SAMPLE_CHANGED_FRACTION = 0.003;
const REGION_OFF_SCREEN_MESSAGE =
	"That part of the window is off screen. Move the window fully onto a display, then try again.";

export type WindowShot = {
	data: string;
	mimeType: "image/jpeg";
	width: number;
	height: number;
	scale: number;
	originX: number;
	originY: number;
};

export type WindowSample = { width: number; height: number; pixels: Uint8Array };

export function clampRegion(window: WindowBounds, region: WindowBounds): WindowBounds {
	const { x, y, width, height } = region;
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
		throw new Error(
			"A screenshot region needs numbers x and y and a positive width and height, in window points.",
		);
	}
	const left = Math.max(0, x);
	const top = Math.max(0, y);
	const right = Math.min(window.width, x + width);
	const bottom = Math.min(window.height, y + height);
	if (right - left < 1 || bottom - top < 1) {
		throw new Error(
			`The region (${x}, ${y}, ${width} × ${height}) is outside the selected window ` +
				`(${Math.round(window.width)} × ${Math.round(window.height)} points). Use window-relative points.`,
		);
	}
	return { x: window.x + left, y: window.y + top, width: right - left, height: bottom - top };
}

export function planWindowCrop(
	window: WindowBounds,
	display: WindowBounds,
	image: { width: number; height: number },
	maxEdge = MAX_IMAGE_EDGE,
) {
	const left = Math.max(window.x, display.x);
	const top = Math.max(window.y, display.y);
	const right = Math.min(window.x + window.width, display.x + display.width);
	const bottom = Math.min(window.y + window.height, display.y + display.height);
	if (right - left < 1 || bottom - top < 1) return null;
	const ratioX = image.width / display.width;
	const ratioY = image.height / display.height;
	const cropX = Math.round((left - display.x) * ratioX);
	const cropY = Math.round((top - display.y) * ratioY);
	const crop = {
		x: cropX,
		y: cropY,
		width: Math.min(image.width - cropX, Math.round((right - left) * ratioX)),
		height: Math.min(image.height - cropY, Math.round((bottom - top) * ratioY)),
	};
	if (crop.width < 1 || crop.height < 1) return null;
	const fit = Math.min(
		1,
		maxEdge / Math.max(crop.width, crop.height),
		Math.sqrt(MAX_IMAGE_PIXELS / (crop.width * crop.height)),
	);
	const output = {
		width: Math.max(1, Math.floor(crop.width * fit + 1e-6)),
		height: Math.max(1, Math.floor(crop.height * fit + 1e-6)),
	};
	return {
		crop,
		output,
		scale: (right - left) / output.width,
		originX: left - window.x,
		originY: top - window.y,
	};
}

function displayFor(area: WindowBounds) {
	return getScreen().getDisplayMatching({
		x: Math.round(area.x),
		y: Math.round(area.y),
		width: Math.round(area.width),
		height: Math.round(area.height),
	});
}

function physicalSize(display: Display): Size {
	return {
		width: Math.round(display.size.width * display.scaleFactor),
		height: Math.round(display.size.height * display.scaleFactor),
	};
}

async function captureDisplay(display: Display, thumbnailSize: Size) {
	const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
	const source =
		sources.find((candidate) => candidate.display_id === String(display.id)) ??
		(sources.length === 1 ? sources[0] : undefined);
	if (!source || source.thumbnail.isEmpty()) {
		throw new Error(
			"Recordly could not capture the screen. Check its Screen Recording permission in System Settings > Privacy & Security.",
		);
	}
	return source.thumbnail;
}

export async function captureWindow(
	frame: WindowBounds,
	region?: WindowBounds,
): Promise<WindowShot> {
	const area = region ? clampRegion(frame, region) : frame;
	const display = displayFor(area);
	const thumbnail = await captureDisplay(display, physicalSize(display));
	const plan = planWindowCrop(area, display.bounds, thumbnail.getSize());
	if (!plan) throw new Error(region ? REGION_OFF_SCREEN_MESSAGE : WINDOW_OFF_SCREEN_MESSAGE);
	const image = thumbnail.crop(plan.crop).resize({ ...plan.output, quality: "best" });
	return {
		data: image.toJPEG(JPEG_QUALITY).toString("base64"),
		mimeType: "image/jpeg",
		width: plan.output.width,
		height: plan.output.height,
		scale: plan.scale,
		originX: plan.originX + area.x - frame.x,
		originY: plan.originY + area.y - frame.y,
	};
}

export function windowSampleChanged(a: WindowSample, b: WindowSample) {
	if (a.width !== b.width || a.height !== b.height) return true;
	const limit = a.width * a.height * SAMPLE_CHANGED_FRACTION;
	let changed = 0;
	for (let i = 0; i < a.pixels.length; i += 4) {
		if (
			Math.abs(a.pixels[i] - b.pixels[i]) > SAMPLE_NOISE_LEVEL ||
			Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) > SAMPLE_NOISE_LEVEL ||
			Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > SAMPLE_NOISE_LEVEL
		) {
			changed += 1;
			if (changed > limit) return true;
		}
	}
	return false;
}

async function sampleWindow(frame: WindowBounds): Promise<WindowSample> {
	const display = displayFor(frame);
	const physical = physicalSize(display);
	const full = planWindowCrop(frame, display.bounds, physical, SAMPLE_EDGE);
	if (!full) throw new Error(WINDOW_OFF_SCREEN_MESSAGE);
	const fit = full.output.width / full.crop.width;
	const thumbnail = await captureDisplay(display, {
		width: Math.max(1, Math.round(physical.width * fit)),
		height: Math.max(1, Math.round(physical.height * fit)),
	});
	const plan = planWindowCrop(frame, display.bounds, thumbnail.getSize(), SAMPLE_EDGE);
	if (!plan) throw new Error(WINDOW_OFF_SCREEN_MESSAGE);
	const { width, height } = plan.crop;
	return { width, height, pixels: thumbnail.crop(plan.crop).toBitmap() };
}

export async function waitForStillWindow(
	frame: WindowBounds,
	options: { timeoutMs: number; quietMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<{ settled: boolean; elapsedMs: number }> {
	const {
		timeoutMs,
		quietMs = SAMPLE_QUIET_MS,
		intervalMs = SAMPLE_INTERVAL_MS,
		signal,
	} = options;
	signal?.throwIfAborted();
	let onAbort!: () => void;
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal?.reason);
	});
	aborted.catch(() => undefined);
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const started = Date.now();
		const deadline = started + timeoutMs;
		const sampleBefore = (time: number) =>
			Promise.race([
				sampleWindow(frame),
				aborted,
				new Promise<null>((resolve) => setTimeout(() => resolve(null), time - Date.now())),
			]);
		const unsettled = () => ({ settled: false, elapsedMs: Date.now() - started });
		let sampledAt = started;
		let stillSince = started;
		let compared = false;
		let previous = await sampleBefore(deadline);
		if (!previous) return unsettled();
		for (;;) {
			const now = Date.now();
			if (compared && now - stillSince >= quietMs)
				return { settled: true, elapsedMs: now - started };
			if (now >= deadline) return { settled: false, elapsedMs: now - started };
			const wait = Math.min(sampledAt + intervalMs, deadline) - now;
			await Promise.race([new Promise((resolve) => setTimeout(resolve, wait)), aborted]);
			sampledAt = Date.now();
			const next = await sampleBefore(deadline);
			if (!next) return unsettled();
			if (windowSampleChanged(previous, next)) stillSince = sampledAt;
			compared = true;
			previous = next;
		}
	} finally {
		signal?.removeEventListener("abort", onAbort);
	}
}
