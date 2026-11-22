import fs from "node:fs/promises";
import path from "node:path";

/** Preserve the capture family even when its main file is missing through a folder alias. */
export async function canonicalSourceReference(source: string): Promise<string> {
	let current = path.resolve(source);
	const missing: string[] = [];
	for (;;) {
		try {
			return path.join(await fs.realpath(current), ...missing);
		} catch (error) {
			if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
				throw error;
			const parent = path.dirname(current);
			if (parent === current) throw error;
			missing.unshift(path.basename(current));
			current = parent;
		}
	}
}
