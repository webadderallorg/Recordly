/** Helper markers are line-framed; keep the actual OS/writer error visible after partial recovery. */
export function parseNativeCaptureInterruption(output: string): string | null {
	return (
		/(?:^|\n)(?:CAPTURE_INTERRUPTED|STREAM_STOPPED):\s*([^\r\n]+)/.exec(output)?.[1]?.trim() ||
		null
	);
}
