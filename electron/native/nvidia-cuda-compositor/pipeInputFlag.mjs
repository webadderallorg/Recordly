// Shared --pipe-input flag resolution for the NVIDIA CUDA compositor wrapper.
// Pipe mode streams the ffmpeg demux directly into the compositor's stdin
// (--input-stdin) so encoding starts before the whole source is written to
// disk. It is opt-in behind RECORDLY_NVIDIA_CUDA_PIPE_INPUT=1 (or the explicit
// --pipe-input CLI flag) so the proven file-path mode stays the default.
//
// The decision lives here so the wrapper and the focused arg-parsing test
// share one implementation (DRY/SSOT): run-mp4-pipeline.mjs executes the full
// pipeline on import, so the test cannot import it directly.

export function resolvePipeInputFlag(argv, env) {
	const argEnabled = argv.includes("--pipe-input");
	const envEnabled = String(env?.RECORDLY_NVIDIA_CUDA_PIPE_INPUT ?? "") === "1";
	return argEnabled || envEnabled;
}
