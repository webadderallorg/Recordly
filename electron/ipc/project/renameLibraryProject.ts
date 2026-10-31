import fs from "node:fs/promises";
import path from "node:path";

export async function renameLibraryProject(
	source: string,
	name: string,
	allowedPaths: string[],
	sidecars: (path: string) => string[],
) {
	if (!allowedPaths.includes(source)) throw new Error("Project is not in the library");
	const clean = name.trim();
	if (
		!clean ||
		clean === "." ||
		clean === ".." ||
		/[<>:"/\\|?*]/.test(clean) ||
		[...clean].some((char) => char.charCodeAt(0) < 32) ||
		/[. ]$/.test(clean)
	)
		throw new Error("Choose a valid project name");
	const target = path.join(path.dirname(source), `${clean}${path.extname(source)}`);
	if (target === source) return target;
	// An exclusive link prevents a rename from overwriting another project.
	await fs.link(source, target);
	const copied: string[] = [];
	try {
		const previous = sidecars(source),
			next = sidecars(target);
		for (let i = 0; i < previous.length; i++) {
			try {
				await fs.copyFile(previous[i], next[i], fs.constants.COPYFILE_EXCL);
				copied.push(next[i]);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		await fs.unlink(source);
	} catch (error) {
		await Promise.all([target, ...copied].map((file) => fs.rm(file, { force: true })));
		throw error;
	}
	// Auxiliary files can be cleaned up independently once the project has moved.
	await Promise.all(
		sidecars(source).map((file) => fs.rm(file, { force: true }).catch(() => undefined)),
	);
	return target;
}
