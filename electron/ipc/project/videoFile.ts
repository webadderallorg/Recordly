import fs from "node:fs/promises";
import path from "node:path";

export type VideoFileProblem =
	| "missing"
	| "volume-not-mounted"
	| "not-a-file"
	| "empty"
	| "unreadable";

export type VideoFileInspection =
	| { ok: true; sizeBytes: number }
	| { ok: false; problem: VideoFileProblem; message: string };

const MOUNT_ROOTS = [
	/^(\/Volumes\/[^/]+)/,
	/^(\/run\/media\/[^/]+\/[^/]+)/,
	/^(\/media\/[^/]+\/[^/]+)/,
	/^(\/mnt\/[^/]+)/,
];

function mountRootOf(filePath: string) {
	const drive = /^([A-Za-z]:[\\/])/.exec(filePath);
	if (drive) return drive[1];
	for (const pattern of MOUNT_ROOTS) {
		const match = pattern.exec(filePath);
		if (match) return match[1];
	}
	return null;
}

export async function inspectVideoFile(videoPath: string): Promise<VideoFileInspection> {
	try {
		const stat = await fs.stat(videoPath);
		if (!stat.isFile()) {
			return {
				ok: false,
				problem: "not-a-file",
				message: `Project video is not a file: ${videoPath}`,
			};
		}
		if (stat.size === 0) {
			return {
				ok: false,
				problem: "empty",
				message: `Project video file is empty (0 bytes): ${videoPath}`,
			};
		}
		return { ok: true, sizeBytes: stat.size };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") {
			const root = mountRootOf(videoPath);
			if (
				root &&
				root !== videoPath &&
				!(await fs.access(root).then(
					() => true,
					() => false,
				))
			) {
				return {
					ok: false,
					problem: "volume-not-mounted",
					message: `Project video file not found: ${videoPath}. ${root} is not available, so the drive it was on may be unplugged or unmounted.`,
				};
			}
			return {
				ok: false,
				problem: "missing",
				message: `Project video file not found: ${videoPath}`,
			};
		}
		return {
			ok: false,
			problem: "unreadable",
			message: `Project video file cannot be read: ${videoPath} (${code ?? (error as Error).message})`,
		};
	}
}

export function undecodableVideoMessage(videoPath: string, sizeBytes: number) {
	return `Project video file ${path.basename(videoPath)} was found (${sizeBytes} bytes) but could not be decoded. It may be truncated, still being written, or in a format Recordly cannot play: ${videoPath}`;
}
