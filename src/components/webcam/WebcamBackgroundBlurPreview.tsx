import {
	forwardRef,
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MutableRefObject,
	type Ref,
	type VideoHTMLAttributes,
} from "react";
import type { WebcamBackgroundBlurSettings } from "@/lib/webcamBackgroundBlur";
import { getSharedWebcamBackgroundBlurEngine } from "@/lib/webcamBackgroundBlurEngine";

const INTERACTIVE_BLUR_FPS = 15;
const INTERACTIVE_BLUR_INTERVAL_MS = 1_000 / INTERACTIVE_BLUR_FPS;

type VideoWithFrameCallback = HTMLVideoElement & {
	requestVideoFrameCallback?: (
		callback: (now: number, metadata: { mediaTime?: number }) => void,
	) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
};

export function getInteractiveBlurFrameKey(sourceKey: string, mediaTimeSeconds: number): string {
	const frameIndex = Math.max(0, Math.floor(mediaTimeSeconds * INTERACTIVE_BLUR_FPS));
	return `${sourceKey}:${frameIndex}`;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
	if (typeof ref === "function") ref(value);
	else if (ref) (ref as MutableRefObject<T | null>).current = value;
}

export interface WebcamBackgroundBlurPreviewProps
	extends Omit<VideoHTMLAttributes<HTMLVideoElement>, "ref"> {
	backgroundBlur: WebcamBackgroundBlurSettings;
	sourceKey: string;
	containerClassName?: string;
	videoRef?: Ref<HTMLVideoElement>;
}

export const WebcamBackgroundBlurPreview = forwardRef<
	HTMLVideoElement,
	WebcamBackgroundBlurPreviewProps
>(function WebcamBackgroundBlurPreview(
	{
		backgroundBlur,
		sourceKey,
		containerClassName = "relative h-full w-full overflow-hidden",
		className,
		style,
		videoRef,
		...videoProps
	},
	forwardedRef,
) {
	const localVideoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [canvasReady, setCanvasReady] = useState(false);
	const setVideoNode = useCallback(
		(node: HTMLVideoElement | null) => {
			localVideoRef.current = node;
			assignRef(videoRef, node);
			assignRef(forwardedRef, node);
		},
		[forwardedRef, videoRef],
	);

	useEffect(() => {
		if (!backgroundBlur.enabled) {
			setCanvasReady(false);
			return;
		}

		const video = localVideoRef.current as VideoWithFrameCallback | null;
		if (!video) return;
		const engine = getSharedWebcamBackgroundBlurEngine();
		engine.invalidate();
		let disposed = false;
		let processing = false;
		let lastProcessAt = Number.NEGATIVE_INFINITY;
		let videoFrameHandle: number | null = null;
		let animationFrameHandle: number | null = null;

		const processFrame = async (now: number, mediaTime = video.currentTime) => {
			if (
				disposed ||
				processing ||
				video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
				now - lastProcessAt < INTERACTIVE_BLUR_INTERVAL_MS
			) {
				return;
			}
			processing = true;
			lastProcessAt = now;
			const processed = await engine.processFrame(video, {
				amount: backgroundBlur.amount,
				frameKey: getInteractiveBlurFrameKey(sourceKey, mediaTime),
			});
			processing = false;
			if (disposed || !processed || !canvasRef.current) {
				if (!disposed && engine.getSnapshot().status === "error") setCanvasReady(false);
				return;
			}

			const canvas = canvasRef.current;
			if (canvas.width !== processed.width) canvas.width = processed.width;
			if (canvas.height !== processed.height) canvas.height = processed.height;
			const context = canvas.getContext("2d");
			if (!context) return;
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(processed, 0, 0, canvas.width, canvas.height);
			setCanvasReady(true);
		};

		const scheduleNextFrame = () => {
			if (disposed) return;
			if (typeof video.requestVideoFrameCallback === "function") {
				videoFrameHandle = video.requestVideoFrameCallback((now, metadata) => {
					void processFrame(now, metadata.mediaTime ?? video.currentTime);
					scheduleNextFrame();
				});
			} else {
				animationFrameHandle = requestAnimationFrame((now) => {
					void processFrame(now);
					scheduleNextFrame();
				});
			}
		};
		const processEventFrame = () => void processFrame(performance.now(), video.currentTime);
		const processResetFrame = () => {
			engine.invalidate();
			lastProcessAt = Number.NEGATIVE_INFINITY;
			void processFrame(performance.now(), video.currentTime);
		};
		video.addEventListener("loadeddata", processResetFrame);
		video.addEventListener("seeked", processResetFrame);
		video.addEventListener("timeupdate", processEventFrame);
		processEventFrame();
		scheduleNextFrame();

		return () => {
			disposed = true;
			engine.invalidate();
			video.removeEventListener("loadeddata", processResetFrame);
			video.removeEventListener("seeked", processResetFrame);
			video.removeEventListener("timeupdate", processEventFrame);
			if (videoFrameHandle !== null) video.cancelVideoFrameCallback?.(videoFrameHandle);
			if (animationFrameHandle !== null) cancelAnimationFrame(animationFrameHandle);
		};
	}, [backgroundBlur.amount, backgroundBlur.enabled, sourceKey]);

	const mediaStyle: CSSProperties = { ...style };
	return (
		<div className={containerClassName}>
			<video {...videoProps} ref={setVideoNode} className={className} style={mediaStyle} />
			<canvas
				ref={canvasRef}
				aria-hidden
				className={`${className ?? ""} pointer-events-none absolute inset-0`}
				style={{ ...mediaStyle, opacity: backgroundBlur.enabled && canvasReady ? 1 : 0 }}
			/>
		</div>
	);
});
