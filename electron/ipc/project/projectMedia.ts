import fs from "node:fs/promises";
import path from "node:path";
import { getMediaContentType } from "../../mediaTypes";
import { normalizeVideoSourcePath } from "../utils";

function isMissingPath(error: unknown) {
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

function extractMediaFilename(sourcePath: string): string | null {
	if (!/^file:\/\//i.test(sourcePath)) return path.win32.basename(sourcePath) || null;
	try {
		return decodeURIComponent(path.posix.basename(new URL(sourcePath).pathname)) || null;
	} catch {
		return null;
	}
}

function isInsideProjectDirectory(directory: string, candidate: string): boolean {
	const relative = path.relative(directory, candidate);
	return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isExpectedMediaType(filename: string, expectedType: "video" | "audio" | "any") {
	const type = getMediaContentType(filename);
	return expectedType === "any"
		? type.startsWith("video/") || type.startsWith("audio/")
		: type.startsWith(`${expectedType}/`);
}

async function findNearbyProjectMedia(
	sourcePath: string,
	projectPath: string,
	expectedType: "video" | "audio" | "any",
): Promise<string | null> {
	const filename = extractMediaFilename(sourcePath);
	if (!filename || /[/\\]/.test(filename) || !isExpectedMediaType(filename, expectedType)) {
		return null;
	}

	const directory = await fs.realpath(path.dirname(projectPath));
	const candidates = [
		path.join(directory, filename),
		path.join(directory, "recordings", filename),
		path.join(directory, "media", filename),
	];
	if (!path.win32.parse(sourcePath).root && !/^file:\/\//i.test(sourcePath)) {
		candidates.unshift(path.resolve(directory, sourcePath.replace(/\\/g, path.sep)));
	}

	for (const candidate of candidates) {
		if (!isInsideProjectDirectory(directory, candidate)) continue;
		try {
			if (!(await fs.lstat(candidate)).isFile()) continue;
			const realPath = await fs.realpath(candidate);
			if (
				isInsideProjectDirectory(directory, realPath) &&
				isExpectedMediaType(realPath, expectedType)
			) {
				return realPath;
			}
		} catch (error) {
			if (!isMissingPath(error)) throw error;
		}
	}
	return null;
}

async function resolveProjectMediaPath(
	sourcePath: string,
	projectPath?: string,
	expectedType: "video" | "audio" | "any" = "any",
) {
	if (!projectPath || path.isAbsolute(sourcePath)) {
		try {
			await fs.access(sourcePath);
			return sourcePath;
		} catch (error) {
			if (!projectPath || !isMissingPath(error)) throw error;
		}
	}

	const nearby = await findNearbyProjectMedia(sourcePath, projectPath, expectedType);
	if (nearby) return nearby;
	throw Object.assign(new Error(`Project media file not found: ${sourcePath}`), {
		code: "ENOENT",
	});
}

function getProjectWebcam(project: object) {
	const webcam = (project as { editor?: { webcam?: { sourcePath: string } } }).editor?.webcam;
	return typeof webcam?.sourcePath === "string" ? webcam : null;
}

export type RelinkedAudioItem = { original: string; resolved: string };

export type ProjectMediaSources = {
	success: true;
	videoPath: string;
	webcamPath: string | null;
	relinkedAudio?: RelinkedAudioItem[];
};

export async function collectRelinkedProjectMedia(project: unknown, projectPath: string) {
	const sources: string[] = [];
	let complete = true;
	if (project && typeof project === "object") {
		const editor = (project as { editor?: Record<string, unknown> }).editor;
		const savedPaths: unknown[] = [
			(project as { videoPath?: unknown }).videoPath,
			getProjectWebcam(project)?.sourcePath,
		];
		if (Array.isArray(editor?.audioTracks)) {
			for (const track of editor.audioTracks) {
				if (typeof track?.sourcePath === "string") savedPaths.push(track.sourcePath);
			}
		}
		if (Array.isArray(editor?.audioRegions)) {
			for (const region of editor.audioRegions) {
				if (typeof region?.audioPath === "string") savedPaths.push(region.audioPath);
			}
		}
		for (const savedPath of savedPaths) {
			if (typeof savedPath !== "string") continue;
			const sourcePath = normalizeVideoSourcePath(savedPath);
			if (!sourcePath) continue;
			try {
				const resolved = await resolveProjectMediaPath(sourcePath, projectPath);
				if (resolved !== sourcePath) sources.push(resolved);
			} catch (error) {
				if (!isMissingPath(error)) complete = false;
			}
		}
	}
	return { sources, complete };
}

export async function resolveProjectMediaSources(
	project: unknown,
	projectPath?: string,
): Promise<ProjectMediaSources | { success: false; message: string }> {
	if (!project || typeof project !== "object") {
		return { success: false, message: "Invalid project file format" };
	}

	const rawVideoPath = (project as { videoPath?: unknown }).videoPath;
	if (typeof rawVideoPath !== "string") {
		return { success: false, message: "Project file is missing a video path" };
	}

	const normalizedVideoPath = normalizeVideoSourcePath(rawVideoPath);
	if (!normalizedVideoPath) {
		return { success: false, message: "Project file is missing a valid video path" };
	}

	let videoPath: string;
	try {
		videoPath = await resolveProjectMediaPath(normalizedVideoPath, projectPath, "video");
	} catch (error) {
		return {
			success: false,
			message:
				(error as NodeJS.ErrnoException).code === "ENOENT"
					? `Project video file not found: ${normalizedVideoPath}`
					: `Could not access project recording: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	let webcamPath = normalizeVideoSourcePath(getProjectWebcam(project)?.sourcePath);
	if (webcamPath) {
		try {
			webcamPath = await resolveProjectMediaPath(webcamPath, projectPath, "video");
		} catch {
			webcamPath = null;
		}
	}

	const relinkedAudio: RelinkedAudioItem[] = [];
	const editor = (project as { editor?: Record<string, unknown> }).editor;
	if (projectPath && editor && typeof editor === "object") {
		const tracks = editor.audioTracks;
		if (Array.isArray(tracks)) {
			for (const track of tracks) {
				if (typeof track?.sourcePath === "string") {
					const norm = normalizeVideoSourcePath(track.sourcePath);
					if (norm) {
						try {
							const resolved = await resolveProjectMediaPath(
								norm,
								projectPath,
								"audio",
							);
							if (resolved !== norm) {
								relinkedAudio.push({ original: track.sourcePath, resolved });
							}
						} catch {
							// Missing companion audio does not block project loading
						}
					}
				}
			}
		}
		const regions = editor.audioRegions;
		if (Array.isArray(regions)) {
			for (const region of regions) {
				if (typeof region?.audioPath === "string") {
					const norm = normalizeVideoSourcePath(region.audioPath);
					if (norm) {
						try {
							const resolved = await resolveProjectMediaPath(
								norm,
								projectPath,
								"audio",
							);
							if (resolved !== norm) {
								relinkedAudio.push({ original: region.audioPath, resolved });
							}
						} catch {
							// Missing companion audio does not block project loading
						}
					}
				}
			}
		}
	}

	return { success: true, videoPath, webcamPath, relinkedAudio };
}

export function applyRelinkedProjectMedia(
	project: { videoPath: string; editor?: unknown },
	media: ProjectMediaSources,
) {
	const relinked = new Set<string>();
	if (media.videoPath !== normalizeVideoSourcePath(project.videoPath)) {
		project.videoPath = media.videoPath;
		relinked.add(media.videoPath);
	}
	const webcam = getProjectWebcam(project);
	if (
		webcam &&
		media.webcamPath &&
		media.webcamPath !== normalizeVideoSourcePath(webcam.sourcePath)
	) {
		webcam.sourcePath = media.webcamPath;
		relinked.add(media.webcamPath);
	}
	if (media.relinkedAudio && media.relinkedAudio.length > 0) {
		const audioMap = new Map(media.relinkedAudio.map((a) => [a.original, a.resolved]));
		const editor = (project as { editor?: Record<string, unknown> }).editor;
		const tracks = editor?.audioTracks;
		if (Array.isArray(tracks)) {
			for (const track of tracks) {
				if (typeof track?.sourcePath === "string" && audioMap.has(track.sourcePath)) {
					const replacement = audioMap.get(track.sourcePath)!;
					track.sourcePath = replacement;
					relinked.add(replacement);
				}
			}
		}
		const regions = editor?.audioRegions;
		if (Array.isArray(regions)) {
			for (const region of regions) {
				if (typeof region?.audioPath === "string" && audioMap.has(region.audioPath)) {
					const replacement = audioMap.get(region.audioPath)!;
					region.audioPath = replacement;
					relinked.add(replacement);
				}
			}
		}
	}
	return relinked;
}
