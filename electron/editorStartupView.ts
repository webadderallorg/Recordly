/** Resolve the destination before renderer code or project hydration runs. */
export function resolveEditorStartupView({
	projectPath,
	videoPath,
	recordingVideoPath,
	devInput,
	smokeExport,
}: {
	projectPath?: string | null;
	videoPath?: string | null;
	recordingVideoPath?: string | null;
	devInput?: string;
	smokeExport?: boolean;
}): "home" | "editor" {
	return projectPath || videoPath || recordingVideoPath || devInput || smokeExport
		? "editor"
		: "home";
}
