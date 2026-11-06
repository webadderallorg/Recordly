import fs from "node:fs/promises";
import path from "node:path";

// Suggest a free name before opening the save dialog.
export async function getAvailableExportPath(requestedPath: string): Promise<string> {
	const { dir, name, ext } = path.parse(requestedPath);
	let candidate = requestedPath;
	let suffix = 1;
	while (true) {
		try {
			await fs.lstat(candidate);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return candidate;
			}
			throw error;
		}
		candidate = path.join(dir, `${name} ${suffix++}${ext}`);
	}
}

export function getSelectedExportPath(
	selectedPath: string,
	suggestedPath: string,
	fileName: string,
): string {
	// Recalculate numbering in the chosen folder when the suggested name was
	// retained, rather than carrying Downloads' suffix into another folder.
	return path.basename(selectedPath) === path.basename(suggestedPath)
		? path.join(path.dirname(selectedPath), path.basename(fileName))
		: selectedPath;
}

export async function saveExportToAvailablePath(
	requestedPath: string,
	writeExport: (destinationPath: string) => Promise<void>,
): Promise<string> {
	while (true) {
		const destinationPath = await getAvailableExportPath(requestedPath);
		let reservation;
		try {
			reservation = await fs.open(destinationPath, "wx");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		try {
			// Reserve the name so simultaneous exports choose different files.
			await reservation.close();
			await writeExport(destinationPath);
			return destinationPath;
		} catch (error) {
			await fs.rm(destinationPath, { force: true }).catch(() => undefined);
			throw error;
		}
	}
}
