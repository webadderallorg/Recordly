import fs from "node:fs/promises";

/** Windows package filesystem redirection can make same-directory rename cross volumes. */
export async function publishCompletedFile(staging: string, destination: string) {
	try {
		await fs.rename(staging, destination);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		// Encoding has already completed. Callers notify/reload readers only after this copy.
		await fs.copyFile(staging, destination);
		await fs.unlink(staging);
	}
}
