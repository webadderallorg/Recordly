import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";

export async function ensureReadableFile(filePath: string, options?: { executable?: boolean }) {
	await fs.access(filePath, fsConstants.R_OK);
	if (options?.executable) {
		try {
			await fs.access(filePath, fsConstants.X_OK);
		} catch {
			throw new Error("The selected executable is not marked as executable.");
		}
	}
}

export async function isExecutableFile(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}
