import { forwardRef } from "react";
import { PlaybackView } from "./videoPlayback/PlaybackView";
import { resolveVideoPlaybackProps } from "./videoPlayback/playbackProps";
import type { VideoPlaybackProps, VideoPlaybackRef } from "./videoPlayback/playbackTypes";
import { usePlaybackCaptions } from "./videoPlayback/usePlaybackCaptions";
import { usePlaybackControls } from "./videoPlayback/usePlaybackControls";
import { usePlaybackCursorSettings } from "./videoPlayback/usePlaybackCursorSettings";
import { usePlaybackLayout } from "./videoPlayback/usePlaybackLayout";
import { usePlaybackLayoutEffects } from "./videoPlayback/usePlaybackLayoutEffects";
import { usePlaybackMediaEffects } from "./videoPlayback/usePlaybackMediaEffects";
import { usePlaybackOptionEffects } from "./videoPlayback/usePlaybackOptionEffects";
import { usePlaybackRenderer } from "./videoPlayback/usePlaybackRenderer";
import { usePlaybackState } from "./videoPlayback/usePlaybackState";
import { usePlaybackTicker } from "./videoPlayback/usePlaybackTicker";
import { usePlaybackTransport } from "./videoPlayback/usePlaybackTransport";
import { usePlaybackWallpaper } from "./videoPlayback/usePlaybackWallpaper";
import { usePlaybackWebcamLayout } from "./videoPlayback/usePlaybackWebcamLayout";
import { usePlaybackWebcamSync } from "./videoPlayback/usePlaybackWebcamSync";

export type { VideoPlaybackRef } from "./videoPlayback/playbackTypes";

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>((props, ref) => {
	const input = { ...resolveVideoPlaybackProps(props), ref };
	const state = usePlaybackState({ ...input });
	const captions = usePlaybackCaptions({ ...input, ...state });
	const webcamLayout = usePlaybackWebcamLayout({ ...input, ...state });
	const layout = usePlaybackLayout({ ...input, ...state, ...webcamLayout });
	const controls = usePlaybackControls({ ...input, ...state, ...layout, ...captions });
	usePlaybackMediaEffects({ ...input, ...state });
	usePlaybackOptionEffects({ ...input, ...state });
	usePlaybackLayoutEffects({ ...input, ...state, ...layout });
	const webcamSync = usePlaybackWebcamSync({
		...input,
		...state,
		...webcamLayout,
		...layout,
	});
	usePlaybackRenderer({ ...input, ...state, ...layout });
	usePlaybackTransport({ ...input, ...state });
	usePlaybackTicker({ ...input, ...state, ...webcamLayout });
	usePlaybackCursorSettings({ ...input, ...state });
	const wallpaper = usePlaybackWallpaper({ ...input, ...state });
	return (
		<PlaybackView
			{...input}
			{...state}
			{...captions}
			{...webcamLayout}
			{...controls}
			{...webcamSync}
			{...wallpaper}
		/>
	);
});
VideoPlayback.displayName = "VideoPlayback";
export default VideoPlayback;
