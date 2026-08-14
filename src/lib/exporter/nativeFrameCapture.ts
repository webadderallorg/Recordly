const RGBA_BYTES_PER_PIXEL = 4;

let nativeFrameCaptureMode: "video-frame-rgba" | "canvas-readback" | null = null;
let nativeFrameCaptureFallbackWarned = false;
let fallbackCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let fallbackContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getRgbaLayout(width: number): PlaneLayout[] {
	return [{ offset: 0, stride: width * RGBA_BYTES_PER_PIXEL }];
}

function getRgbaByteSize(width: number, height: number): number {
	return width * height * RGBA_BYTES_PER_PIXEL;
}

function getFallbackReadbackContext(
	width: number,
	height: number,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
	if (!fallbackCanvas || fallbackCanvas.width !== width || fallbackCanvas.height !== height) {
		if (typeof OffscreenCanvas !== "undefined") {
			fallbackCanvas = new OffscreenCanvas(width, height);
			fallbackContext = fallbackCanvas.getContext("2d", {
				willReadFrequently: true,
			});
		} else if (typeof document !== "undefined") {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			fallbackCanvas = canvas;
			fallbackContext = canvas.getContext("2d", {
				willReadFrequently: true,
			});
		} else {
			throw new Error("No canvas readback path is available for native export");
		}
	}

	if (!fallbackContext) {
		throw new Error("Failed to initialize native export frame readback context");
	}

	return fallbackContext;
}

function captureCanvasFrameWithReadback(
	canvas: HTMLCanvasElement,
	targetWidth?: number,
	targetHeight?: number,
): Uint8Array {
	const outWidth = targetWidth ?? canvas.width;
	const outHeight = targetHeight ?? canvas.height;
	const context = getFallbackReadbackContext(outWidth, outHeight);
	context.clearRect(0, 0, outWidth, outHeight);
	context.drawImage(canvas, 0, 0, outWidth, outHeight);
	const imageData = context.getImageData(0, 0, outWidth, outHeight);
	return new Uint8Array(imageData.data);
}

export async function captureCanvasFrameForNativeExport(
	canvas: HTMLCanvasElement,
	timestamp: number,
	_flipVertical = false,
	targetWidth?: number,
	targetHeight?: number,
): Promise<Uint8Array> {
	const outWidth = targetWidth ?? canvas.width;
	const outHeight = targetHeight ?? canvas.height;

	if (nativeFrameCaptureMode !== "canvas-readback") {
		const buffer = new Uint8Array(getRgbaByteSize(outWidth, outHeight));
		const frame = new VideoFrame(canvas, { timestamp });

		try {
			await frame.copyTo(buffer, {
				format: "RGBA",
				layout: getRgbaLayout(outWidth),
			});
			nativeFrameCaptureMode = "video-frame-rgba";
			return buffer;
		} catch (error) {
			nativeFrameCaptureMode = "canvas-readback";
			if (!nativeFrameCaptureFallbackWarned) {
				nativeFrameCaptureFallbackWarned = true;
				console.warn(
					"[native-export] VideoFrame RGBA copyTo failed, falling back to canvas readback",
					error,
				);
			}
		} finally {
			frame.close();
		}
	}

	return captureCanvasFrameWithReadback(canvas, outWidth, outHeight);
}
