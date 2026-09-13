import path from "node:path";

export interface WhisperArgAttempt {
	args: string[];
	jsonEnabled: boolean;
}

// whisper.cpp ships DTW alignment heads only for the official OpenAI model sizes.
const DTW_MODEL_FILE_PATTERN =
	/^ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3-turbo|large-v3)(\.en)?(?:[-.]q\d+_\d+)?\.bin$/i;

/** Returns the whisper.cpp `--dtw` preset for a ggml model file, or null when unknown. */
export function getWhisperDtwPreset(modelPath: string): string | null {
	const fileName = path.basename(modelPath.replace(/\\/g, "/"));
	const match = fileName.match(DTW_MODEL_FILE_PATTERN);
	if (!match) {
		return null;
	}
	const size = match[1].toLowerCase().replace(/-/g, ".");
	return `${size}${match[2]?.toLowerCase() ?? ""}`;
}

/**
 * Ordered Whisper invocations, from most to least precise timing. DTW token timestamps
 * track speech onsets far better than whisper.cpp's default heuristic, but require flash
 * attention to be disabled and a runtime that supports `--dtw`; older runtimes fall back.
 */
export function buildWhisperArgAttempts(
	baseArgs: string[],
	modelPath: string,
): WhisperArgAttempt[] {
	const attempts: WhisperArgAttempt[] = [];
	const dtwPreset = getWhisperDtwPreset(modelPath);
	if (dtwPreset) {
		attempts.push({
			args: [...baseArgs, "-ojf", "-dtw", dtwPreset, "-nfa"],
			jsonEnabled: true,
		});
	}
	attempts.push({ args: [...baseArgs, "-ojf"], jsonEnabled: true });
	attempts.push({ args: baseArgs, jsonEnabled: false });
	return attempts;
}
