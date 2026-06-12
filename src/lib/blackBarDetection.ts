/**
 * Black-bar detection for fresh recordings.
 *
 * Fullscreen apps on notched MacBooks render the menu-bar band as pure black,
 * so screen captures carry a black strip at the top (and letterboxed sources
 * carry them elsewhere). These are literal black pixels in the file; the only
 * fix is cropping. This module finds such bands conservatively so dark UI
 * themes and dark slides are never mistaken for bars.
 */

export interface EdgeInsets {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

export const ZERO_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** A pixel counts as "black" only when every channel is below this (0..255). */
const BLACK_CHANNEL_MAX = 12;
/** A row/column is a bar row only when at least this fraction of it is black. */
const ROW_BLACK_FRACTION = 0.99;
/** Bands wider than this fraction are content (e.g. a black slide), not bars. */
const MAX_BAND_FRACTION = 0.12;
/** Bands narrower than this are noise; ignore. */
const MIN_BAND_FRACTION = 0.008;

function isBlackPixel(data: Uint8ClampedArray, index: number): boolean {
	return (
		data[index] < BLACK_CHANNEL_MAX &&
		data[index + 1] < BLACK_CHANNEL_MAX &&
		data[index + 2] < BLACK_CHANNEL_MAX
	);
}

function rowIsBlack(data: Uint8ClampedArray, width: number, y: number): boolean {
	let black = 0;
	const rowStart = y * width * 4;
	for (let x = 0; x < width; x++) {
		if (isBlackPixel(data, rowStart + x * 4)) {
			black += 1;
		}
	}
	return black / width >= ROW_BLACK_FRACTION;
}

function columnIsBlack(data: Uint8ClampedArray, width: number, height: number, x: number): boolean {
	let black = 0;
	for (let y = 0; y < height; y++) {
		if (isBlackPixel(data, (y * width + x) * 4)) {
			black += 1;
		}
	}
	return black / height >= ROW_BLACK_FRACTION;
}

/**
 * Scans RGBA pixel data for uniform black bands at each edge. Returns
 * normalized inset fractions; an edge whose band exceeds MAX_BAND_FRACTION
 * reports 0 (treated as content, not a bar).
 */
export function detectBlackBarInsets(
	data: Uint8ClampedArray,
	width: number,
	height: number,
): EdgeInsets {
	if (width <= 0 || height <= 0 || data.length < width * height * 4) {
		return ZERO_INSETS;
	}

	const maxRows = Math.floor(height * MAX_BAND_FRACTION);
	const maxCols = Math.floor(width * MAX_BAND_FRACTION);

	let top = 0;
	while (top < maxRows + 1 && rowIsBlack(data, width, top)) {
		top += 1;
	}
	let bottom = 0;
	while (bottom < maxRows + 1 && rowIsBlack(data, width, height - 1 - bottom)) {
		bottom += 1;
	}
	let left = 0;
	while (left < maxCols + 1 && columnIsBlack(data, width, height, left)) {
		left += 1;
	}
	let right = 0;
	while (right < maxCols + 1 && columnIsBlack(data, width, height, width - 1 - right)) {
		right += 1;
	}

	const clampBand = (count: number, total: number, maxCount: number) => {
		if (count > maxCount) {
			return 0; // too wide to be a bar — dark content
		}
		const fraction = count / total;
		return fraction >= MIN_BAND_FRACTION ? fraction : 0;
	};

	return {
		top: clampBand(top, height, maxRows),
		bottom: clampBand(bottom, height, maxRows),
		left: clampBand(left, width, maxCols),
		right: clampBand(right, width, maxCols),
	};
}

/** Per-edge minimum across samples: a bar must be present in EVERY frame. */
export function intersectInsets(samples: EdgeInsets[]): EdgeInsets {
	if (samples.length === 0) {
		return ZERO_INSETS;
	}
	return samples.reduce((acc, s) => ({
		top: Math.min(acc.top, s.top),
		bottom: Math.min(acc.bottom, s.bottom),
		left: Math.min(acc.left, s.left),
		right: Math.min(acc.right, s.right),
	}));
}

export function hasMeaningfulInsets(insets: EdgeInsets): boolean {
	return (
		insets.top >= MIN_BAND_FRACTION ||
		insets.bottom >= MIN_BAND_FRACTION ||
		insets.left >= MIN_BAND_FRACTION ||
		insets.right >= MIN_BAND_FRACTION
	);
}

const SAMPLE_WIDTH = 480;
/** Fractions of the duration to sample; a bar must persist across all. */
const SAMPLE_POSITIONS = [0.2, 0.5, 0.85];

/**
 * Samples a few frames of a video URL (via a detached element, so the editor's
 * player is untouched) and returns black-bar insets consistent across all
 * samples, or null when none are found / the video can't be read.
 */
export async function detectVideoBlackBars(videoUrl: string): Promise<EdgeInsets | null> {
	const video = document.createElement("video");
	video.muted = true;
	video.preload = "auto";
	video.src = videoUrl;

	const waitFor = (eventName: string) =>
		new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error(`timeout waiting for ${eventName}`)),
				8000,
			);
			const done = () => {
				clearTimeout(timer);
				video.removeEventListener(eventName, done);
				video.removeEventListener("error", fail);
				resolve();
			};
			const fail = () => {
				clearTimeout(timer);
				reject(new Error("video error"));
			};
			video.addEventListener(eventName, done);
			video.addEventListener("error", fail);
		});

	try {
		await waitFor("loadeddata");
		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		if (duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
			return null;
		}

		const width = SAMPLE_WIDTH;
		const height = Math.max(
			1,
			Math.round((SAMPLE_WIDTH * video.videoHeight) / video.videoWidth),
		);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) {
			return null;
		}

		const samples: EdgeInsets[] = [];
		for (const position of SAMPLE_POSITIONS) {
			video.currentTime = Math.min(duration * position, Math.max(0, duration - 0.05));
			await waitFor("seeked");
			ctx.drawImage(video, 0, 0, width, height);
			const pixels = ctx.getImageData(0, 0, width, height).data;
			samples.push(detectBlackBarInsets(pixels, width, height));
		}

		const insets = intersectInsets(samples);
		return hasMeaningfulInsets(insets) ? insets : null;
	} catch {
		return null;
	} finally {
		video.src = "";
		video.load();
	}
}
