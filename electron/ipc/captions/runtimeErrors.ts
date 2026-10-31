const WINDOWS_MISSING_RUNTIME_EXIT_CODES = new Set([-1073741515, 3221225781]);

export function isMissingWindowsWhisperRuntimeDependency(error: unknown) {
	if (process.platform !== "win32" || !error || typeof error !== "object") {
		return false;
	}

	const code = (error as { code?: unknown }).code;
	return typeof code === "number" && WINDOWS_MISSING_RUNTIME_EXIT_CODES.has(code);
}
