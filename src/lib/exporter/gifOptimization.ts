export interface GifOptimizationSummary {
	originalBytes: number;
	optimizedBytes: number;
	savedBytes: number;
	reductionPercent: number;
	status: "optimized" | "unchanged" | "failed";
	originalWidth?: number;
	originalHeight?: number;
	outputWidth?: number;
	outputHeight?: number;
	targetBytes?: number;
	targetReached?: boolean;
}
export interface GifOptimizationResult extends GifOptimizationSummary {
	blob: Blob;
}

async function dimensions(blob: Blob): Promise<{ width: number; height: number } | undefined> {
	const bytes = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
	if (bytes.length < 10 || !/^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0, 6))))
		return undefined;
	const width = bytes[6] | (bytes[7] << 8);
	const height = bytes[8] | (bytes[9] << 8);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

async function result(
	original: Blob,
	candidate?: Blob,
	failed = false,
): Promise<GifOptimizationResult> {
	const blob = candidate && candidate.size < original.size ? candidate : original;
	const savedBytes = original.size - blob.size;
	const originalDimensions = await dimensions(original);
	const outputDimensions = blob === original ? originalDimensions : await dimensions(blob);
	const targetBytes = Math.floor(original.size * 0.1);
	return {
		blob,
		originalWidth: originalDimensions?.width,
		originalHeight: originalDimensions?.height,
		outputWidth: outputDimensions?.width,
		outputHeight: outputDimensions?.height,
		targetBytes,
		targetReached: !failed && blob.size <= targetBytes,
		originalBytes: original.size,
		optimizedBytes: blob.size,
		savedBytes,
		reductionPercent: original.size ? (savedBytes / original.size) * 100 : 0,
		status: failed ? "failed" : savedBytes ? "optimized" : "unchanged",
	};
}

/** Compress with bundled FFmpeg's palette/GIF encoder. Targets 90% smaller with fewer colors and pixels; never enlarge the saved file. */
export async function optimizeGif(
	blob: Blob,
	signal?: AbortSignal,
): Promise<GifOptimizationResult> {
	const requestId = crypto.randomUUID();
	const abortError = () => new DOMException("GIF optimization cancelled", "AbortError");
	if (signal?.aborted) throw abortError();
	const api = typeof window !== "undefined" ? window.electronAPI : undefined;
	if (!api?.optimizeGif) return result(blob, undefined, true);
	let started = false;
	let finished = false;
	let rejectAbort: ((error: DOMException) => void) | undefined;
	const cancelNative = () => {
		if (started) void api.cancelGifOptimization?.(requestId).catch(() => undefined);
	};
	const abort = () => {
		cancelNative();
		rejectAbort?.(abortError());
	};
	const cancelled = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	signal?.addEventListener("abort", abort, { once: true });
	const timeout = setTimeout(() => {
		cancelNative();
		rejectAbort?.(new DOMException("GIF compression timed out", "TimeoutError"));
	}, 65_000);
	try {
		return await Promise.race([
			cancelled,
			(async () => {
				const bytes = await blob.arrayBuffer();
				if (signal?.aborted || finished) throw abortError();
				started = true;
				const response = await api.optimizeGif(requestId, bytes);
				if (signal?.aborted) throw abortError();
				const output = response.data;
				if (
					!response.success ||
					!(output instanceof Uint8Array) ||
					output.length < 14 ||
					!/^GIF8[79]a$/.test(String.fromCharCode(...output.subarray(0, 6))) ||
					output[output.length - 1] !== 0x3b
				)
					return result(blob, undefined, true);
				return result(
					blob,
					new Blob([new Uint8Array(output).buffer], { type: "image/gif" }),
				);
			})(),
		]);
	} catch {
		if (signal?.aborted) throw abortError();
		return result(blob, undefined, true);
	} finally {
		finished = true;
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}
