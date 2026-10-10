export interface FirstVideoFrame {
	width: number;
	height: number;
}

export interface FirstVideoFrameProbe {
	read(): Promise<FirstVideoFrame>;
	dispose(): void;
}

export interface WaitForFirstVideoFrameOptions {
	timeoutMs?: number;
	createProbe?: (track: MediaStreamTrack) => FirstVideoFrameProbe;
}

const DEFAULT_FIRST_FRAME_TIMEOUT_MS = 120_000;

function createVideoElementProbe(track: MediaStreamTrack): FirstVideoFrameProbe {
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.srcObject = new MediaStream([track]);

	return {
		read: () =>
			new Promise<FirstVideoFrame>((resolve) => {
				const report = () => {
					if (video.videoWidth > 0 && video.videoHeight > 0) {
						resolve({ width: video.videoWidth, height: video.videoHeight });
					}
				};
				video.addEventListener("loadeddata", report);
				video.addEventListener("resize", report);
				void video.play().catch(() => undefined);
				report();
			}),
		dispose: () => {
			video.pause();
			video.srcObject = null;
		},
	};
}

/**
 * Resolves once the track has produced a real frame.
 *
 * On Linux/Wayland getDisplayMedia() resolves while the xdg-desktop-portal
 * picker is still open, so a "live" track may carry no frames (and report the
 * requested rather than the actual size) until the user confirms the dialog.
 */
export function waitForFirstVideoFrame(
	track: MediaStreamTrack,
	{
		timeoutMs = DEFAULT_FIRST_FRAME_TIMEOUT_MS,
		createProbe = createVideoElementProbe,
	}: WaitForFirstVideoFrameOptions = {},
): Promise<FirstVideoFrame> {
	const cancelledError = () =>
		new Error("Screen sharing was cancelled before anything was captured.");

	if (track.readyState === "ended") {
		return Promise.reject(cancelledError());
	}

	return new Promise<FirstVideoFrame>((resolve, reject) => {
		const probe = createProbe(track);
		const cleanup = () => {
			clearTimeout(timer);
			track.removeEventListener("ended", handleEnded);
			probe.dispose();
		};
		const handleEnded = () => {
			cleanup();
			reject(cancelledError());
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(
				new Error(
					"No screen frames arrived. Confirm the screen sharing dialog and try again.",
				),
			);
		}, timeoutMs);

		track.addEventListener("ended", handleEnded);
		void probe.read().then((frame) => {
			cleanup();
			resolve(frame);
		});
	});
}
