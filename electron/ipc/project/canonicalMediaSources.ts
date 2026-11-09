import fs from "node:fs/promises";
import { canonicalSourceReference } from "./canonicalSourceReference";
import { normalizeVideoSourcePath } from "../utils";

/** Resolve saved media references, including paths through a custom folder alias. */
export async function canonicalMediaSources(
	project: unknown,
	options: { preserveMissing?: boolean } = {},
): Promise<{ sourcePaths: string[]; sourcePathsComplete: boolean }> {
	const sources = new Set<string>();
	const collect = (value: unknown) => {
		if (typeof value === "string") {
			const source = normalizeVideoSourcePath(value);
			if (
				source &&
				!/^(https?:|blob:|data:)/i.test(source) &&
				/\.(mp4|mov|webm|mkv|m4v|wav|m4a|mp3|ogg|flac)$/i.test(source)
			)
				sources.add(source);
		} else if (Array.isArray(value)) value.forEach(collect);
		else if (value && typeof value === "object") Object.values(value).forEach(collect);
	};
	collect(project);
	const resolved = new Set<string>();
	let sourcePathsComplete = true;
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
