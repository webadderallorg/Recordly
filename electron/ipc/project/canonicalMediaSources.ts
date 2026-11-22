import fs from "node:fs/promises";
import { normalizeVideoSourcePath } from "../utils";
import { canonicalSourceReference } from "./canonicalSourceReference";
import { collectRelinkedProjectMedia } from "./projectMedia";

/** Resolve saved media references, including paths through a custom folder alias. */
export async function canonicalMediaSources(
	project: unknown,
	options: { preserveMissing?: boolean; projectPath?: string } = {},
): Promise<{ sourcePaths: string[]; sourcePathsComplete: boolean }> {
	const sources = new Set<string>();
	const collect = (value: unknown) => {
		if (typeof value === "string") {
			const source = normalizeVideoSourcePath(value);
			if (
				source &&
				!/^(https?:|blob:|data:)/i.test(source) &&
				/\.(mp4|mov|webm|mkv|m4v|avi|wav|m4a|mp3|ogg|flac)$/i.test(source)
			)
				sources.add(source);
		} else if (Array.isArray(value)) value.forEach(collect);
		else if (value && typeof value === "object") Object.values(value).forEach(collect);
	};
	collect(project);
	let sourcePathsComplete = true;
	if (options.projectPath) {
		const nearby = await collectRelinkedProjectMedia(project, options.projectPath);
		nearby.sources.forEach(collect);
		sourcePathsComplete = nearby.complete;
	}
	const resolved = new Set<string>();
	for (const source of sources) {
		try {
			resolved.add(
				options.preserveMissing
					? await canonicalSourceReference(source)
					: await fs.realpath(source),
			);
		} catch (error) {
			// Missing references cannot point at a present library file. Other
			// failures leave dependency analysis incomplete, so fail closed.
			if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
				sourcePathsComplete = false;
		}
	}
	return { sourcePaths: [...resolved], sourcePathsComplete };
}
