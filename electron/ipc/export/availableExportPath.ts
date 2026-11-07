import fs from "node:fs/promises";
import path from "node:path";

// Suggest a free name before opening the save dialog.
export async function getAvailableExportPath(
	requestedPath: string,
	sidecarExtensions: readonly string[] = [],
): Promise<string> {
	const { dir, name, ext } = path.parse(requestedPath);
	let candidate = requestedPath;
	let suffix = 1;
	while (true) {
		const candidateName = path.parse(candidate).name;
		const outputs = [
			candidate,
			...sidecarExtensions.map((extension) =>
				path.join(dir, `${candidateName}.${extension}`),
			),
		];
		let occupied = false;
		for (const output of outputs) {
			try {
				await fs.lstat(output);
				occupied = true;
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		if (!occupied) return candidate;
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
	sidecarExtensions: readonly string[] = [],
): Promise<string> {
	while (true) {
		const destinationPath = await getAvailableExportPath(requestedPath, sidecarExtensions);
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
