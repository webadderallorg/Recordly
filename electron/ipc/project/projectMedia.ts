import fs from "node:fs/promises";
import path from "node:path";
import { getMediaContentType } from "../../mediaTypes";
import { normalizeVideoSourcePath } from "../utils";

async function findNearbyProjectVideo(
	sourcePath: string,
	error: unknown,
	projectPath?: string,
): Promise<string | null> {
	const code = (error as NodeJS.ErrnoException).code;
	if (!projectPath || (code !== "ENOENT" && code !== "ENOTDIR")) return null;
	const sourcePathStyle = path.isAbsolute(sourcePath) ? path : path.win32;
	if (!sourcePathStyle.isAbsolute(sourcePath)) return null;
	const filename = sourcePathStyle.basename(sourcePath);
	if (!getMediaContentType(filename).startsWith("video/")) return null;
	try {
		const directory = await fs.realpath(path.dirname(projectPath));
		const candidate = path.join(directory, filename);
		return (await fs.lstat(candidate)).isFile() ? candidate : null;
	} catch {
		return null;
	}
}

function getProjectWebcam(project: unknown) {
	const webcam = (project as { editor?: { webcam?: { sourcePath: string } } }).editor?.webcam;
	return typeof webcam?.sourcePath === "string" ? webcam : null;
}

type ProjectMediaSources = { success: true; videoPath: string; webcamPath: string | null };

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

	let videoPath = normalizedVideoPath;
	try {
		await fs.access(videoPath);
	} catch (error) {
		const nearby = await findNearbyProjectVideo(videoPath, error, projectPath);
		if (!nearby) {
			return {
				success: false,
				message:
					(error as NodeJS.ErrnoException).code === "ENOENT"
						? `Project video file not found: ${normalizedVideoPath}`
						: `Could not access project recording: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		videoPath = nearby;
	}

	let webcamPath = normalizeVideoSourcePath(getProjectWebcam(project)?.sourcePath);
	if (webcamPath) {
		try {
			await fs.access(webcamPath);
		} catch (error) {
			webcamPath = await findNearbyProjectVideo(webcamPath, error, projectPath);
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
