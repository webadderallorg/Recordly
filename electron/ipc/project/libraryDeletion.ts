import path from "node:path";
import { canonicalSourceReference } from "./canonicalSourceReference";

type Sources = { sourcePaths: string[]; sourcePathsComplete: boolean };
export type LibraryDeletionDependencies = {
	list: () => Promise<{ entries: Array<{ path: string }> }>;
	readSources: (path: string) => Promise<Sources | null>;
	backupPaths: (path: string) => string[];
	recordings: () => Promise<Array<{ path: string }>>;
	activeSources?: () => string[] | Promise<string[]>;
};
const key = (value: string) => path.resolve(value).replace(/\\/g, "/").toLowerCase();

/** Companion media is owned by the same capture, including separate microphone/webcam tracks. */
export function recordingUsesSources(file: string, references: ReadonlySet<string>): boolean {
	const source = key(file);
	for (const reference of references) {
		const target = key(reference);
		if (source === target) return true;
		if (!/\.(mp4|mov|webm|mkv|m4v)$/i.test(target)) continue;
		const stem = target.replace(/\.[^.]+$/, "");
		if (
			(source.startsWith(`${stem}.`) &&
				/^\.(system|mic|microphone|audio|webcam)\./i.test(source.slice(stem.length))) ||
			source.startsWith(`${stem}-webcam.`)
		)
			return true;
	}
	return false;
}

export async function protectedLibrarySources(
	deps: LibraryDeletionDependencies,
	excluding = new Set<string>(),
): Promise<Set<string>> {
	const references = new Set<string>();
	for (const source of (await deps.activeSources?.()) ?? []) {
		try {
			references.add(await canonicalSourceReference(source));
		} catch {
			throw new Error("Active source files could not be checked. Source files were kept.");
		}
	}
	for (const entry of (await deps.list()).entries) {
		if (excluding.has(path.resolve(entry.path))) continue;
		for (const file of [entry.path, ...deps.backupPaths(entry.path)]) {
			const data = await deps.readSources(file);
			if (!data && file !== entry.path) continue;
			if (!data || !data.sourcePathsComplete)
				throw new Error(
					"Some saved projects or recovery copies could not be checked. Source files were kept.",
				);
			for (const source of data.sourcePaths) references.add(source);
		}
	}
	return references;
}

export async function prepareLibraryDeletion(paths: unknown, deps: LibraryDeletionDependencies) {
	if (
		!Array.isArray(paths) ||
		!paths.length ||
		paths.length > 500 ||
		paths.some((file) => typeof file !== "string")
	)
		throw new Error("Invalid project selection");
	const selected = [...new Set((paths as string[]).map((file) => path.resolve(file)))];
	const allowed = new Set((await deps.list()).entries.map((entry) => path.resolve(entry.path)));
	if (selected.some((file) => !allowed.has(file)))
		throw new Error("Project is not in the library");
	const sources = new Map<string, Set<string>>();
	for (const project of selected) {
		const references = new Set<string>();
		for (const file of [project, ...deps.backupPaths(project)]) {
			const data = await deps.readSources(file);
			if (!data && file !== project) continue;
			if (!data || !data.sourcePathsComplete)
				throw new Error(
					"Selected project sources could not be checked. No project files were removed.",
				);
			for (const source of data.sourcePaths) references.add(source);
		}
		sources.set(project, references);
	}
	const protectedSources = await protectedLibrarySources(deps, new Set(selected));
	const owners: Record<string, string[]> = {};
	const preserved: string[] = [];
	for (const recording of await deps.recordings()) {
		const usedBy = selected.filter((project) =>
			recordingUsesSources(recording.path, sources.get(project)!),
		);
		if (!usedBy.length) continue;
		if (recordingUsesSources(recording.path, protectedSources)) preserved.push(recording.path);
		else owners[recording.path] = usedBy;
	}
	return { selected, sourceOwners: owners, preservedSources: preserved };
}

/** A source is removable only when every selected project using it was actually trashed. */
export function removableLibrarySources(
	sourceOwners: Record<string, string[]>,
	deletedProjects: readonly string[],
	protectedSources: ReadonlySet<string>,
) {
	const deleted = new Set(deletedProjects);
	const removable: string[] = [],
		kept: string[] = [];
	for (const [file, owners] of Object.entries(sourceOwners)) {
		(owners.every((owner) => deleted.has(owner)) &&
		!recordingUsesSources(file, protectedSources)
			? removable
			: kept
		).push(file);
	}
	return { removable, kept };
}
