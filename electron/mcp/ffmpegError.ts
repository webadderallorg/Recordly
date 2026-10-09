export function describeFfmpegError(error: unknown, timeoutMs: number) {
	const failure = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: Buffer | string };
	if (failure.name === "AbortError" || failure.code === "ABORT_ERR") {
		return "The request was canceled.";
	}
	if (failure.code === "ENOENT") return "FFmpeg was not found.";
	if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "The frame was too large.";
	if (failure.killed) return `FFmpeg took longer than ${timeoutMs / 1000} s.`;
	const stderr = failure.stderr?.toString().trim().slice(0, 300);
	return stderr || failure.message;
}
