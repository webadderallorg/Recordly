import path from "node:path";
import fs from "node:fs/promises";
import { getProjectBackupPath } from "./atomicSave";

type Dependencies = {
	list: () => Promise<{ entries: Array<{ path: string }> }>;
	trash: (path: string) => Promise<void>;
	thumbnailPath: (path: string) => string;
};
/** Only library project files may be trashed; referenced recordings are never touched. */
export async function trashLibraryProjects(paths: unknown, deps: Dependencies) {
	if (
		!Array.isArray(paths) ||
		!paths.length ||
		paths.length > 500 ||
		paths.some((p) => typeof p !== "string")
	)
		throw new Error("Invalid project selection");
	const allowed = new Set((await deps.list()).entries.map((e) => path.resolve(e.path)));
	const selected = [...new Set((paths as string[]).map((p) => path.resolve(p)))];
	if (selected.some((p) => !allowed.has(p))) throw new Error("Project is not in the library");
	const deleted: string[] = [];
	const errors: string[] = [];
	for (const projectPath of selected) {
		try {
			await deps.trash(projectPath);
			deleted.push(projectPath);
			for (const sidecar of [
				deps.thumbnailPath(projectPath),
				getProjectBackupPath(projectPath),
			]) {
				try {
					await fs.access(sidecar);
					await deps.trash(sidecar);
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code !== "ENOENT")
						errors.push(`Could not trash project sidecar: ${sidecar}`);
				}
			}
		} catch {
			errors.push(`Could not trash ${path.basename(projectPath)}`);
		}
	}
	return { deleted, errors };
}
