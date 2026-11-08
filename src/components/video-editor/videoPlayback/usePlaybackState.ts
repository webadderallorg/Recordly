import type { PlaybackProps } from "./playbackProps";
import { usePreviewCaptionState } from "./usePreviewCaptionState";
import { usePreviewMediaState } from "./usePreviewMediaState";
import { usePreviewMotionState } from "./usePreviewMotionState";
import { usePreviewRedactionState } from "./usePreviewRedactionState";
import { usePreviewSceneState } from "./usePreviewSceneState";
import { usePreviewWebcamState } from "./usePreviewWebcamState";
export function usePlaybackState(input: PlaybackProps) {
	const media = usePreviewMediaState(input);
	const scene = usePreviewSceneState();
	const webcam = usePreviewWebcamState(input);
	const caption = usePreviewCaptionState();
	const motion = usePreviewMotionState(input);
	const redaction = usePreviewRedactionState(input, scene.appRef);
	return { ...media, ...scene, ...webcam, ...caption, ...motion, ...redaction };
}
