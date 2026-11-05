import {
	ENCODER_PROGRESS_TIMEOUT_MS,
	getNowMs,
	NATIVE_ENCODER_QUEUE_LIMIT,
	NATIVE_EXPORT_ENGINE_NAME,
} from "./modernExportConstants";
import type { ModernExportHooks } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";
import { EXPORT_CANVAS_COLOR_SPACE } from "./videoColorSpace";

type Hooks = Pick<ModernExportHooks, never>;

type Session = Pick<
	ModernExportSession,
	"browser" | "cancelled" | "config" | "flow" | "native" | "metrics"
>;

export function captureRawvideoFrame(session: Session, _hooks: Hooks): Uint8Array {
	const source = session.browser.renderer!.getCanvas();
	const { width, height } = session.config;
	if (source.width !== width || source.height !== height) {
		throw new Error("Rendered canvas size does not match the requested export dimensions");
	}
	// Read the final output viewport, including Canvas2D annotation composites.
	// Extracting stage bounds instead can include offscreen zoom/shadow content.
	session.native.nativeReadbackCanvas ??= document.createElement("canvas");
	const canvas = session.native.nativeReadbackCanvas;
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Canvas readback is unavailable for bundled FFmpeg export");
	ctx.drawImage(source, 0, 0);
	const pixels = ctx.getImageData(0, 0, width, height).data;
	const bytes = new Uint8Array(width * height * 4);
	// Native FFmpeg's established rawvideo path applies vflip. Feed bottom-up
	// RGBA consistently; Canvas2D readback is always top-down on every backend.
	const stride = width * 4;
	for (let row = 0; row < height; row++) {
		bytes.set(pixels.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride);
	}
	return bytes;
}

export async function encodeRenderedFrameNative(
	session: Session,
	hooks: Hooks,
	timestamp: number,
	frameDuration: number,
	frameIndex: number,
): Promise<void> {
	if (session.cancelled) return;
	if (
		!session.native.nativeExportSessionId ||
		(!session.native.nativeH264Encoder && session.native.nativeInputMode !== "rawvideo")
	) {
		throw new Error(`${NATIVE_EXPORT_ENGINE_NAME} export session is not active`);
	}
	if (session.native.nativeEncoderError) throw session.native.nativeEncoderError;
	// Snapshot before yielding to native writes: WebGL may clear its default
	// framebuffer on the next presentation when preserveDrawingBuffer is false.
	let rawFrame: Uint8Array | null = null;
	if (session.native.nativeInputMode === "rawvideo") {
		const captureStarted = getNowMs();
		try {
			rawFrame = captureRawvideoFrame(session, hooks);
		} finally {
			session.metrics.nativeCaptureTimeMs += getNowMs() - captureStarted;
		}
	}
	while (session.flow.nativeWritePromises.size >= session.flow.maxNativeWriteInFlight) {
		const waitStarted = getNowMs();
		session.metrics.encodeWaitEvents++;
		try {
			await session.flow.awaitOldestNativeWrite();
		} finally {
			session.metrics.encodeWaitTimeMs += getNowMs() - waitStarted;
		}
		if (session.cancelled) return;
		if (session.native.nativeEncoderError) throw session.native.nativeEncoderError;
	}
	if (rawFrame) {
		session.flow.queueNativeWriteChunk(session.native.nativeExportSessionId, rawFrame);
		return;
	}
	let idleSince = getNowMs();
	let previousQueueSize = session.native.nativeH264Encoder!.encodeQueueSize;
	let previousOutputCount = session.native.nativeOutputChunkCount;
	session.metrics.peakEncodeQueueSize = Math.max(
		session.metrics.peakEncodeQueueSize,
		previousQueueSize,
	);
	while (session.native.nativeH264Encoder!.encodeQueueSize >= NATIVE_ENCODER_QUEUE_LIMIT) {
		session.flow.flushPendingNativeWriteBatch(session.native.nativeExportSessionId);
		const waitStarted = getNowMs();
		session.metrics.encodeWaitEvents++;
		try {
			await session.flow.waitForEncodeCapacity();
		} finally {
			session.metrics.encodeWaitTimeMs += getNowMs() - waitStarted;
		}
		if (session.cancelled) return;
		if (session.native.nativeEncoderError) throw session.native.nativeEncoderError;
		const queueSize = session.native.nativeH264Encoder!.encodeQueueSize;
		if (
			queueSize < previousQueueSize ||
			session.native.nativeOutputChunkCount !== previousOutputCount
		)
			idleSince = getNowMs();
		if (getNowMs() - idleSince >= ENCODER_PROGRESS_TIMEOUT_MS) {
			throw new Error("Browser H.264 encoder made no progress for 30 seconds");
		}
		previousQueueSize = queueSize;
		previousOutputCount = session.native.nativeOutputChunkCount;
	}
	// @ts-expect-error - colorSpace is supported at runtime but missing from this DOM typing.
	const frame = new VideoFrame(session.browser.renderer!.getCanvas(), {
		timestamp,
		duration: frameDuration,
		colorSpace: EXPORT_CANVAS_COLOR_SPACE,
	});
	try {
		session.native.nativeH264Encoder!.encode(frame, { keyFrame: frameIndex % 300 === 0 });
		session.metrics.peakEncodeQueueSize = Math.max(
			session.metrics.peakEncodeQueueSize,
			session.native.nativeH264Encoder!.encodeQueueSize,
		);
	} finally {
		frame.close();
	}
}
