/** A dismissed portal is terminal: audio fallback must not reopen the chooser. */
export function isCapturePermissionDismissed(error: unknown): boolean {
	return (
		error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")
	);
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
	try {
		return await request(audio);
	} catch (error) {
		if (!audio || (usePortal && isCapturePermissionDismissed(error))) throw error;
		onAudioFallback();
		return request(false);
	}
}
