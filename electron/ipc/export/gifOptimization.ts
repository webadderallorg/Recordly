import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MAX_GIF_OPTIMIZATION_BYTES = 512 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const TARGET_RATIO = 0.1;
const MIN_LONG_EDGE = 320;

/** Predict the next resolution from measured bytes, with a small safety margin.
 * Never upscale or shrink an already-small GIF just to chase an impossible target. */
export function nextGifTargetDimensions(
	width: number,
	height: number,
	bytes: number,
	targetBytes: number,
): { width: number; height: number } | null {
	const longEdge = Math.max(width, height);
	if (bytes <= targetBytes || longEdge <= MIN_LONG_EDGE) return null;
	const scale = Math.max(
		MIN_LONG_EDGE / longEdge,
		Math.min(0.85, Math.sqrt(targetBytes / bytes) * 0.9),
	);
	return {
		width: Math.max(1, Math.floor(width * scale)),
		height: Math.max(1, Math.floor(height * scale)),
	};
}

export interface GifAnimationMetadata {
	width: number;
	height: number;
	/** Original hundredths of a second, including zero/one-centisecond delays. */
	delays: number[];
	/** null means no loop extension; zero means infinite looping. */
	loopCount: number | null;
}

interface ParsedGif extends GifAnimationMetadata {
	delayOffsets: Array<number | null>;
}

function parseGif(input: Uint8Array): ParsedGif {
	const invalid = () => new Error("Invalid or unsupported GIF animation");
	if (input.byteLength < 14 || input.byteLength > MAX_GIF_OPTIMIZATION_BYTES) {
		throw invalid();
	}
	const signature = String.fromCharCode(...input.subarray(0, 6));
	if (signature !== "GIF89a" && signature !== "GIF87a") throw invalid();
	const word = (offset: number) => input[offset] | (input[offset + 1] << 8);
	const width = word(6);
	const height = word(8);
	if (width === 0 || height === 0 || width > 8192 || height > 8192) throw invalid();
	let cursor = 13 + (input[10] & 0x80 ? 3 * 2 ** ((input[10] & 7) + 1) : 0);
	const delays: number[] = [];
	const delayOffsets: Array<number | null> = [];
	let loopCount: number | null = null;
	let pendingDelayOffset: number | null = null;
	const skipBlocks = () => {
		while (cursor < input.length) {
			const length = input[cursor++];
			if (length === 0) return;
			cursor += length;
			if (cursor > input.length) throw invalid();
		}
		throw invalid();
	};
	while (cursor < input.length) {
		const marker = input[cursor++];
		if (marker === 0x3b) {
			if (delays.length === 0) throw invalid();
			return { width, height, delays, loopCount, delayOffsets };
		}
		if (marker === 0x21) {
			const label = input[cursor++];
			if (label === 0xf9) {
				if (cursor + 6 > input.length || input[cursor] !== 4 || input[cursor + 5] !== 0) {
					throw invalid();
				}
				pendingDelayOffset = cursor + 2;
				cursor += 6;
			} else {
				if (label === 0xff && input[cursor] === 11) {
					const application = String.fromCharCode(
						...input.subarray(cursor + 1, cursor + 12),
					);
					if (application === "NETSCAPE2.0" || application === "ANIMEXTS1.0") {
						if (
							cursor + 17 > input.length ||
							input[cursor + 12] !== 3 ||
							input[cursor + 13] !== 1
						) {
							throw invalid();
						}
						loopCount = word(cursor + 14);
					}
				}
				// Plain-text rendering is outside the encoder's image-only contract.
				if (label === 0x01) throw invalid();
				skipBlocks();
			}
		} else if (marker === 0x2c) {
			if (cursor + 9 > input.length) throw invalid();
			const frameWidth = word(cursor + 4);
			const frameHeight = word(cursor + 6);
			if (
				!frameWidth ||
				!frameHeight ||
				word(cursor) + frameWidth > width ||
				word(cursor + 2) + frameHeight > height
			) {
				throw invalid();
			}
			const packed = input[cursor + 8];
			cursor += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0);
			if (cursor >= input.length || input[cursor] < 2 || input[cursor] > 8) throw invalid();
			cursor++; // LZW minimum code size.
			skipBlocks();
			delays.push(pendingDelayOffset === null ? 0 : word(pendingDelayOffset));
			delayOffsets.push(pendingDelayOffset);
			pendingDelayOffset = null;
		} else {
			throw invalid();
		}
	}
	throw invalid();
}

export function inspectGifAnimation(input: Uint8Array): GifAnimationMetadata {
	const { delayOffsets: _offsets, ...metadata } = parseGif(input);
	return metadata;
}

export function buildGifOptimizationArgs(
	inputPath: string,
	outputPath: string,
	metadata: GifAnimationMetadata,
	palettePath: string,
	dimensions: { width: number; height: number } = metadata,
): string[] {
	return [
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-y",
		"-threads",
		"1",
		"-filter_complex_threads",
		"1",
		"-f",
		"gif",
		"-min_delay",
		"0",
		"-ignore_loop",
		"1",
		"-i",
		inputPath,
		"-i",
		palettePath,
		"-filter_complex",
		dimensions.width === metadata.width && dimensions.height === metadata.height
			? "[0:v][1:v]paletteuse=dither=none:diff_mode=rectangle[out]"
			: `[0:v]scale=${dimensions.width}:${dimensions.height}:flags=lanczos[scaled];[scaled][1:v]paletteuse=dither=none:diff_mode=rectangle[out]`,
		"-map",
		"[out]",
		"-an",
		"-fps_mode",
		"passthrough",
		"-gifflags",
		"+transdiff+offsetting",
		"-loop",
		String(metadata.loopCount ?? -1),
		"-final_delay",
		String(metadata.delays[metadata.delays.length - 1]),
		outputPath,
	];
}

export interface GifCompressionOptions {
	ffmpegPath: string;
	signal?: AbortSignal;
	/** Bounded to the production deadline; useful for deterministic cancellation tests. */
	timeoutMs?: number;
}

/** Target 90% smaller using a shared 64-color palette and measured resolution steps.
 * Preserve every frame, its exact delay, and looping; never return a larger GIF. */
export async function compressGifBuffer(
	input: Uint8Array,
	options: GifCompressionOptions,
): Promise<Uint8Array> {
	const metadata = parseGif(input);
	const controller = new AbortController();
	const forwardAbort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener("abort", forwardAbort, { once: true });
	if (options.signal?.aborted) forwardAbort();
	const timeout = setTimeout(
		() => controller.abort(new Error("GIF optimization timed out")),
		Math.min(DEFAULT_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
	);
	const checkAborted = () => {
		if (controller.signal.aborted) {
			throw controller.signal.reason instanceof Error
				? controller.signal.reason
				: new Error("GIF optimization canceled");
		}
	};
	let tempDirectory: string | undefined;
	let best = input;
	try {
		checkAborted();
		tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-gif-"));
		checkAborted();
		const inputPath = path.join(tempDirectory, "input.gif");
		const outputPath = path.join(tempDirectory, "optimized.gif");
		await fs.writeFile(inputPath, input);
		checkAborted();
		const runFfmpeg = (args: string[]) =>
			new Promise<void>((resolve, reject) => {
				checkAborted();
				const process = spawn(options.ffmpegPath, args, {
					windowsHide: true,
					stdio: ["ignore", "ignore", "pipe"],
				});
				let stderr = "";
				process.stderr.on("data", (chunk: Buffer) => {
					stderr = (stderr + chunk.toString()).slice(-4096);
				});
				const abort = () => process.kill("SIGKILL");
				controller.signal.addEventListener("abort", abort, { once: true });
				if (controller.signal.aborted) abort();
				// Waiting for close also waits for stdio and process exit before removing its files.
				process.once("error", reject);
				process.once("close", (code) => {
					controller.signal.removeEventListener("abort", abort);
					if (controller.signal.aborted) {
						reject(
							controller.signal.reason instanceof Error
								? controller.signal.reason
								: new Error("GIF optimization canceled"),
						);
					} else if (code !== 0) {
						reject(
							new Error(`FFmpeg GIF optimization failed (${code}): ${stderr.trim()}`),
						);
					} else resolve();
				});
			});
		const palettePath = path.join(tempDirectory, "palette.png");
		// Separate passes keep memory bounded: a split/palettegen graph buffers the
		// entire decoded animation while waiting for the global palette.
		await runFfmpeg([
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-y",
			"-threads",
			"1",
			"-filter_threads",
			"1",
			"-f",
			"gif",
			"-min_delay",
			"0",
			"-ignore_loop",
			"1",
			"-i",
			inputPath,
			"-vf",
			"palettegen=max_colors=64:reserve_transparent=1:stats_mode=full",
			"-frames:v",
			"1",
			palettePath,
		]);
		const targetBytes = Math.max(1, Math.floor(input.byteLength * TARGET_RATIO));
		let dimensions = { width: metadata.width, height: metadata.height };
		// Keep the original source and palette for each pass: no cumulative resampling.
		// Most exports need only the full-size pass and one predicted smaller size.
		for (let attempt = 0; attempt < 4; attempt++) {
			await runFfmpeg(
				buildGifOptimizationArgs(inputPath, outputPath, metadata, palettePath, dimensions),
			);
			checkAborted();
			const stat = await fs.stat(outputPath);
			if (stat.size > MAX_GIF_OPTIMIZATION_BYTES)
				throw new Error("Optimized GIF is too large");
			const output = await fs.readFile(outputPath);
			checkAborted();
			const compressed = parseGif(output);
			if (
				compressed.width !== dimensions.width ||
				compressed.height !== dimensions.height ||
				compressed.delays.length !== metadata.delays.length ||
				compressed.loopCount !== metadata.loopCount
			)
				throw new Error("GIF optimization changed animation structure");
			// FFmpeg normalizes very short delays; restore their exact encoded values.
			for (const [index, delay] of metadata.delays.entries()) {
				const offset = compressed.delayOffsets[index];
				if (offset === null) {
					if (delay !== 0) throw new Error("GIF optimization omitted frame timing");
				} else output.writeUInt16LE(delay, offset);
			}
			if (output.byteLength < best.byteLength) best = output;
			if (best.byteLength <= targetBytes) break;
			const smaller = nextGifTargetDimensions(
				dimensions.width,
				dimensions.height,
				output.byteLength,
				targetBytes,
			);
			if (!smaller) break;
			dimensions = smaller;
		}
		return best;
	} catch (error) {
		// A failed/deadline-limited later pass must not discard an earlier valid win.
		// Explicit cancellation still stops the export rather than saving a partial result.
		if (best !== input && !options.signal?.aborted) return best;
		throw error;
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", forwardAbort);
		if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
	}
}
