import fs from "node:fs/promises";
import path from "node:path";

export type ProjectReference = { name: string; path: string };

const CASE_INSENSITIVE = process.platform === "darwin" || process.platform === "win32";

async function canonical(filePath: string) {
	const resolved = await fs.realpath(filePath).catch(() => path.resolve(filePath));
	return CASE_INSENSITIVE ? resolved.toLowerCase() : resolved;
}

export async function findProjectsReferencing(
	videoPath: string,
	projects: ProjectReference[],
	normalizeSource: (videoPath: string) => string | null,
	read: (projectPath: string) => Promise<string> = (p) => fs.readFile(p, "utf-8"),
) {
	const target = await canonical(videoPath);
	const referencing: ProjectReference[] = [];
	const unchecked: ProjectReference[] = [];
	for (const project of projects) {
		try {
			const text = await read(project.path);
			const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as {
				videoPath?: unknown;
			};
			const video =
				typeof parsed?.videoPath === "string" ? normalizeSource(parsed.videoPath) : null;
			if (video && (await canonical(video)) === target) referencing.push(project);
		} catch {
			unchecked.push(project);
		}
	}
	return { referencing, unchecked };
}
