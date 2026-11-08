import { useRef, useState } from "react";
import { WebcamMotionBlur } from "../webcamMotionBlur";
import type { PlaybackProps } from "./playbackProps";
export function usePreviewWebcamState(input: Pick<PlaybackProps, "webcamVideoPath">) {
	const { webcamVideoPath } = input;

	const webcamVideoRef = useRef<HTMLVideoElement | null>(null);

	const webcamBlurCanvasRef = useRef<HTMLCanvasElement | null>(null);

	const webcamMotionBlurRef = useRef(new WebcamMotionBlur());

	const webcamBubbleRef = useRef<HTMLDivElement | null>(null);

	const webcamBubbleInnerRef = useRef<HTMLDivElement | null>(null);

	const [webcamVideoDimensions, setWebcamVideoDimensions] = useState<{
		width: number;
		height: number;
	} | null>(null);

	const webcamSynchronizedPathRef = useRef<string | null>(null);

	const [webcamSynchronizedPath, setWebcamSynchronizedPath] = useState<string | null>(null);

	const webcamMediaSynchronized =
		Boolean(webcamVideoPath) && webcamSynchronizedPath === webcamVideoPath;

	const lastWebcamSyncTimeRef = useRef<number | null>(null);
	return {
		webcamVideoRef,
		webcamBlurCanvasRef,
		webcamMotionBlurRef,
		webcamBubbleRef,
		webcamBubbleInnerRef,
		webcamVideoDimensions,
		setWebcamVideoDimensions,
		webcamSynchronizedPathRef,
		webcamSynchronizedPath,
		setWebcamSynchronizedPath,
		webcamMediaSynchronized,
		lastWebcamSyncTimeRef,
	};
}
