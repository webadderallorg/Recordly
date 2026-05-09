import fs from "node:fs/promises";
import path from "node:path";
import {
	AUTO_RECORDING_MAX_AGE_MS,
	AUTO_RECORDING_RETENTION_COUNT,
	COMPANION_AUDIO_LAYOUTS,
	LEGACY_PROJECT_FILE_EXTENSIONS,
	PROJECT_FILE_EXTENSION,
	PROJECTS_DIRECTORY_NAME,
} from "../constants";
import { currentVideoPath } from "../state";
import {
	getRecordingsDir,
	getTelemetryPathForVideo,
	isAutoRecordingPath,
	normalizePath,
	normalizeVideoSourcePath,
	parseJsonWithByteOrderMark,
} from "../utils";

export async function hasSiblingProjectFile(videoPath: string) {
	const baseName = path.basename(videoPath, path.extname(videoPath));
	const candidateExtensions = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS];

	for (const extension of candidateExtensions) {
		const projectPath = path.join(path.dirname(videoPath), `${baseName}.${extension}`);

		try {
			await fs.access(projectPath);
			return true;
		} catch {
			continue;
		}
	}

	return false;
}

export { isAutoRecordingPath };

async function loadSavedProjectMediaPaths() {
	const recordingsDir = await getRecordingsDir();
	const projectsDir = path.join(recordingsDir, PROJECTS_DIRECTORY_NAME);
	const protectedPaths = new Set<string>();
	const candidateExtensions = new Set([
		PROJECT_FILE_EXTENSION,
		...LEGACY_PROJECT_FILE_EXTENSIONS,
	]);

	let projectEntries: Array<{ isFile(): boolean; name: string }>;
	try {
		projectEntries = await fs.readdir(projectsDir, { withFileTypes: true });
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		if (code === "ENOENT") {
			return protectedPaths;
		}

		throw error;
	}

	await Promise.all(
		projectEntries
			.filter((entry) => {
				if (!entry.isFile()) {
					return false;
				}

				const extension = path.extname(entry.name).replace(/^\./, "").toLowerCase();
				return candidateExtensions.has(extension);
			})
			.map(async (entry) => {
				const projectPath = path.join(projectsDir, entry.name);
				let rawProject: {
					videoPath?: unknown;
					editor?: { webcam?: { sourcePath?: unknown } };
				};
				try {
					rawProject = parseJsonWithByteOrderMark<{
						videoPath?: unknown;
						editor?: { webcam?: { sourcePath?: unknown } };
					}>(await fs.readFile(projectPath, "utf-8"));
				} catch (error) {
					console.warn("[prune] Skipping unreadable project while pruning recordings", {
						projectPath,
						error,
					});
					return;
				}
				const candidatePaths = [
					rawProject.videoPath,
					rawProject.editor?.webcam?.sourcePath,
				];

				for (const candidatePath of candidatePaths) {
					if (typeof candidatePath !== "string" || candidatePath.trim().length === 0) {
						continue;
					}

					const normalizedCandidatePath = normalizePath(
						normalizeVideoSourcePath(candidatePath) ?? candidatePath,
					);
					protectedPaths.add(normalizedCandidatePath);
					try {
						protectedPaths.add(await fs.realpath(normalizedCandidatePath));
					} catch {
						// Ignore missing project media; project loading already surfaces that error.
					}
				}
			}),
	);

	return protectedPaths;
}

export async function pruneAutoRecordings(exemptPaths: string[] = []) {
	const recordingsDir = await getRecordingsDir();
	await fs.mkdir(recordingsDir, { recursive: true });
	const protectedProjectMediaPaths = await loadSavedProjectMediaPaths();
	const exempt = new Set(
		[currentVideoPath, ...exemptPaths]
			.filter((value): value is string => Boolean(value))
			.map((value) => normalizePath(value)),
	);

	const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
	const autoRecordingStats = await Promise.all(
		entries
			.filter((entry) => entry.isFile() && /^recording-.*\.(mp4|mov|webm)$/i.test(entry.name))
			.map(async (entry) => {
				const filePath = path.join(recordingsDir, entry.name);
				const stats = await fs.stat(filePath);
				return { filePath, stats };
			}),
	);

	const sorted = autoRecordingStats.sort(
		(left, right) => right.stats.mtimeMs - left.stats.mtimeMs,
	);
	const now = Date.now();

	for (const [index, entry] of sorted.entries()) {
		const normalizedFilePath = normalizePath(entry.filePath);
		if (exempt.has(normalizedFilePath)) {
			continue;
		}

		if (await hasSiblingProjectFile(entry.filePath)) {
			continue;
		}

		const resolvedFilePath = await fs.realpath(entry.filePath).catch(() => normalizedFilePath);
		if (
			protectedProjectMediaPaths.has(normalizedFilePath) ||
			protectedProjectMediaPaths.has(resolvedFilePath)
		) {
			continue;
		}

		const tooOld = now - entry.stats.mtimeMs > AUTO_RECORDING_MAX_AGE_MS;
		const overLimit = index >= AUTO_RECORDING_RETENTION_COUNT;
		if (!tooOld && !overLimit) {
			continue;
		}

		try {
			await fs.rm(entry.filePath, { force: true });
			await fs.rm(getTelemetryPathForVideo(entry.filePath), { force: true });
			// Clean up companion audio files left from recording (macOS .m4a, Windows .wav)
			const base = entry.filePath.replace(/\.(mp4|mov|webm)$/i, "");
			const companionSuffixes = Array.from(
				new Set(
					COMPANION_AUDIO_LAYOUTS.flatMap((layout) => [
						layout.systemSuffix,
						layout.micSuffix,
					]),
				),
			);
			for (const suffix of companionSuffixes) {
				await fs.rm(base + suffix, { force: true }).catch(() => undefined);
			}
		} catch (error) {
			console.warn("Failed to prune old auto recording:", entry.filePath, error);
		}
	}
}
