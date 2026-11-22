export const LINUX_PORTAL_SOURCE_ID = "screen:linux-portal";

/** A dismissed portal is terminal: audio fallback must not reopen the chooser. */
export function isCapturePermissionDismissed(error: unknown): boolean {
	return (
		error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")
	);
}

const FIRST_PORTAL_FRAME_TIMEOUT_MS = 3000;

export async function waitForBrowserCaptureFrame(track: MediaStreamTrack): Promise<boolean> {
	if (track.readyState === "ended") return false;
	const video = document.createElement("video");
	video.muted = true;
	const events = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await new Promise<boolean>((resolve) => {
			const unavailable = () => resolve(false);
			const listenerOptions = { once: true, signal: events.signal };
			video.addEventListener("loadeddata", () => resolve(true), listenerOptions);
			video.addEventListener("error", unavailable, listenerOptions);
			track.addEventListener("ended", unavailable, listenerOptions);
			timeout = setTimeout(unavailable, FIRST_PORTAL_FRAME_TIMEOUT_MS);
			video.srcObject = new MediaStream([track]);
			void video.play().catch(unavailable);
		});
	} finally {
		clearTimeout(timeout);
		events.abort();
		video.srcObject = null;
	}
}

export async function acquireBrowserScreenCapture({
	request,
	audio,
	usePortal,
	onAudioFallback,
}: {
	request: (audio: boolean) => Promise<MediaStream>;
	audio: boolean;
	usePortal: boolean;
	onAudioFallback: () => void;
}): Promise<MediaStream> {
	let stream: MediaStream;
	try {
		stream = await request(audio);
	} catch (error) {
		if (!audio || (usePortal && isCapturePermissionDismissed(error))) throw error;
		onAudioFallback();
		return request(false);
	}
	if (audio && stream.getAudioTracks().length === 0) onAudioFallback();
	return stream;
}
