import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import {
	PROJECT_THUMBNAIL_WIDTH,
	PROJECT_THUMBNAIL_HEIGHT,
} from "../../../src/lib/projectThumbnail";
const run = promisify(execFile);
let queue = Promise.resolve();

export function createProjectFirstFrameThumbnail(sourcePath: string): Promise<Buffer> {
	const task = queue.then(async () => {
		const result = await run(
			getFfmpegBinaryPath(),
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-nostdin",
				"-threads",
				"1",
				"-i",
				sourcePath,
				"-frames:v",
				"1",
				"-an",
				"-vf",
				`scale=${PROJECT_THUMBNAIL_WIDTH}:${PROJECT_THUMBNAIL_HEIGHT}:force_original_aspect_ratio=increase,crop=${PROJECT_THUMBNAIL_WIDTH}:${PROJECT_THUMBNAIL_HEIGHT}`,
				"-f",
				"image2pipe",
				"-c:v",
				"png",
				"pipe:1",
			],
			{ encoding: "buffer", maxBuffer: 4 * 1024 * 1024, timeout: 15000, windowsHide: true },
		);
		if (!result.stdout.length) throw new Error("Project source has no preview frame");
		return result.stdout;
	});
	queue = task.then(
		() => undefined,
		() => undefined,
	);
	return task;
}
