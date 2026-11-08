// Test-only views of the private resources exercised by the pixel-level fixtures.
// Each case uses the corresponding implementation's view; production APIs stay unchanged.
export interface ExportRendererProbe {
	config: { zoomMotionBlur: number };
	getCanvas(): HTMLCanvasElement;
	destroy(): void;
}
interface MotionProbe {
	animationState: { appliedScale: number };
}
interface MediaProbe {
	webcamDecodedFrame: VideoFrame | null;
	lastSyncedWebcamTime: number;
}
interface FrameCacheProbe {
	webcamFrameCacheCanvas: HTMLCanvasElement | null;
	webcamFrameCacheCtx: CanvasRenderingContext2D | null;
}
export interface LegacyRendererProbe
	extends ExportRendererProbe,
		MotionProbe,
		MediaProbe,
		FrameCacheProbe {
	webcamVideoElement: Pick<HTMLVideoElement, "readyState"> | null;
	webcamMotionTimeMs: number;
	drawWebcamOverlay(context: CanvasRenderingContext2D, width: number, height: number): void;
}
export interface ModernRendererProbe extends ExportRendererProbe {
	initialize(): Promise<void>;
	motion: MotionProbe;
	webcamMedia: MediaProbe;
	webcamFrames: FrameCacheProbe;
	webcam: { updateWebcamOverlay(sourceTime: number, outputTime: number): void };
	scene: { app: { render(): void } };
}
