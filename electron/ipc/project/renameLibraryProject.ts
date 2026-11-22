import fs from "node:fs/promises";
import path from "node:path";

type ProjectSidecar = string | string[] | { paths: string[]; kind: "preview" };

function sidecarGroup(value: ProjectSidecar) {
	return typeof value === "string"
		? { paths: [value], kind: "recovery" as const }
		: Array.isArray(value)
			? { paths: value, kind: "recovery" as const }
			: value;
}

export async function renameLibraryProject(
	source: string,
	name: string,
	allowedPaths: string[],
	sidecars: (path: string) => ProjectSidecar[] | Promise<ProjectSidecar[]>,
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
		const previous = (await sidecars(source)).map(sidecarGroup);
		const next = (await sidecars(target)).map(sidecarGroup);
		for (let i = 0; i < previous.length; i++) {
			let existing: { path: string; contents: Buffer; modifiedAt: number } | undefined;
			for (const candidate of previous[i].paths) {
				try {
					const contents = await fs.readFile(candidate);
					const modifiedAt = (await fs.stat(candidate)).mtimeMs;
					if (
						existing &&
						previous[i].kind !== "preview" &&
						!contents.equals(existing.contents)
					) {
						throw new Error(
							"Project recovery files conflict. Save the project before renaming it.",
						);
					}
					// Previews are disposable cached alternatives, not distinct recovery generations.
					// Prefer the newest; equal timestamps retain the managed-first ordering.
					if (
						!existing ||
						(previous[i].kind === "preview" && modifiedAt > existing.modifiedAt)
					) {
						existing = { path: candidate, contents, modifiedAt };
					}
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			}
			if (previous[i].kind === "preview" && next[i].kind === "preview") {
				// The primary target was absent before our exclusive link. Its old previews
				// are orphaned caches; unlink them without following possible symlinks.
				for (const preview of next[i].paths) await fs.rm(preview, { force: true });
			}
			if (!existing) continue;
			await fs.mkdir(path.dirname(next[i].paths[0]), { recursive: true, mode: 0o700 });
			await fs.copyFile(existing.path, next[i].paths[0], fs.constants.COPYFILE_EXCL);
			copied.push(next[i].paths[0]);
			// Renaming must not make an obsolete cached frame appear newer than the document.
			await fs.utimes(next[i].paths[0], new Date(), existing.modifiedAt / 1000);
		}
		await fs.unlink(source);
	} catch (error) {
		await Promise.all([target, ...copied].map((file) => fs.rm(file, { force: true })));
		throw error;
	}
	// Auxiliary files can be cleaned up independently once the project has moved.
	await Promise.all(
		(await sidecars(source))
			.flatMap((value) => sidecarGroup(value).paths)
			.map((file) => fs.rm(file, { force: true }).catch(() => undefined)),
	);
	return target;
}
