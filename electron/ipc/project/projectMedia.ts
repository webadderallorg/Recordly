import fs from "node:fs/promises";
import path from "node:path";
import { getMediaContentType } from "../../mediaTypes";
import { normalizeVideoSourcePath } from "../utils";

function isMissingPath(error: unknown) {
	const code = (error as NodeJS.ErrnoException).code;
	return code === "ENOENT" || code === "ENOTDIR";
}

async function findNearbyProjectVideo(sourcePath: string, projectPath: string) {
	const sourcePathStyle = path.isAbsolute(sourcePath) ? path : path.win32;
	if (!sourcePathStyle.isAbsolute(sourcePath)) return null;
	const filename = sourcePathStyle.basename(sourcePath);
	if (!getMediaContentType(filename).startsWith("video/")) return null;
	try {
		const directory = await fs.realpath(path.dirname(projectPath));
		const candidate = path.join(directory, filename);
		return (await fs.lstat(candidate)).isFile() ? candidate : null;
	} catch (error) {
		if (!isMissingPath(error)) throw error;
		return null;
	}
}

async function resolveProjectMediaPath(sourcePath: string, projectPath?: string) {
	try {
		await fs.access(sourcePath);
		return sourcePath;
	} catch (error) {
		if (projectPath && isMissingPath(error)) {
			const nearby = await findNearbyProjectVideo(sourcePath, projectPath);
			if (nearby) return nearby;
		}
		throw error;
	}
}

function getProjectWebcam(project: object) {
	const webcam = (project as { editor?: { webcam?: { sourcePath: string } } }).editor?.webcam;
	return typeof webcam?.sourcePath === "string" ? webcam : null;
}

type ProjectMediaSources = { success: true; videoPath: string; webcamPath: string | null };

export async function collectRelinkedProjectMedia(project: unknown, projectPath: string) {
	const sources: string[] = [];
	let complete = true;
	if (project && typeof project === "object") {
		const savedPaths = [
			(project as { videoPath?: unknown }).videoPath,
			getProjectWebcam(project)?.sourcePath,
		];
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
		videoPath = await resolveProjectMediaPath(normalizedVideoPath, projectPath);
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
			webcamPath = await resolveProjectMediaPath(webcamPath, projectPath);
		} catch {
			webcamPath = null;
		}
	}
	return { success: true, videoPath, webcamPath };
}

export function applyRelinkedProjectMedia(
	project: { videoPath: string },
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
	return relinked;
}
