import path from "node:path";
import { ipcMain } from "electron";
import { isAllowedLocalReadPath } from "../project/manager";
import { importTimelineClip } from "../timelineClipImport";
import { approveUserPath, normalizeVideoSourcePath } from "../utils";

export function registerTimelineClipImportHandlers() {
	ipcMain.handle(
		"import-timeline-clip",
		async (_, options?: { sourcePath?: unknown; clipPath?: unknown }) => {
			try {
				const sourcePath = normalizeVideoSourcePath(
					typeof options?.sourcePath === "string" ? options.sourcePath : null,
				);
				const clipPath = normalizeVideoSourcePath(
					typeof options?.clipPath === "string" ? options.clipPath : null,
				);
				if (!sourcePath || !clipPath) {
					return { success: false, message: "Choose a video clip to import." };
				}

				const resolvedSourcePath = path.resolve(sourcePath);
				const resolvedClipPath = path.resolve(clipPath);
				if (
					!isAllowedLocalReadPath(resolvedSourcePath) ||
					!isAllowedLocalReadPath(resolvedClipPath)
				) {
					return { success: false, message: "The selected media path is not approved." };
				}

				const result = await importTimelineClip(resolvedSourcePath, resolvedClipPath);
				if (result.outputPath) approveUserPath(result.outputPath);
				return result;
			} catch (error) {
				console.error("[clip-import] Failed to import timeline clip:", error);
				return {
					success: false,
					message: error instanceof Error ? error.message : "Unable to import clip.",
				};
			}
		},
	);
}
