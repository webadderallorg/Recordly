import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
/** Publish a complete new project without overwriting a concurrent or existing save. */
export async function createUntitledProject(directory: string, contents: string) {
	await fs.mkdir(directory, { recursive: true });
	const temporary = path.join(directory, `.recordly-new-${randomUUID()}.tmp`);
	try {
		const file = await fs.open(temporary, "wx");
		try {
			await file.writeFile(contents, "utf8");
			await file.sync();
		} finally {
			await file.close();
		}
		for (let suffix = 0; ; suffix++) {
			const target = path.join(
				directory,
				`Untitled Project${suffix ? ` ${suffix}` : ""}.recordly`,
			);
			try {
				await fs.link(temporary, target);
				return target;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
	} finally {
		await fs.rm(temporary, { force: true });
	}
}
