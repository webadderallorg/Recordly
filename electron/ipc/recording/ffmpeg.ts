import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { resolveLinuxWindowBounds } from "../cursor/bounds";
import {
	ffmpegCaptureOutputBuffer,
} from "../state";
import type { SelectedSource } from "../types";
import { getScreen, parseWindowId } from "../utils";
import { resolveWindowsCaptureDisplay } from "../windowsCaptureSelection";

export function getDisplayBoundsForSource(source: SelectedSource) {
	return resolveWindowsCaptureDisplay(
		source,
		getScreen().getAllDisplays(),
		getScreen().getPrimaryDisplay(),
	).bounds;
}

export function getDisplayWorkAreaForSource(source: SelectedSource) {
	const allDisplays = getScreen().getAllDisplays();
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { displayId } = resolveWindowsCaptureDisplay(source, allDisplays, primaryDisplay);
	const matched = allDisplays.find((d) => d.id === displayId) ?? primaryDisplay;
	return matched.workArea;
}

export async function buildFfmpegCaptureArgs(source: SelectedSource, outputPath: string) {
	const commonOutputArgs = [
		"-an",
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		outputPath,
	];

	if (process.platform === "win32") {
		if (source?.id?.startsWith("window:")) {
			const windowId = parseWindowId(source.id);
			const windowTitle =
				typeof source.windowTitle === "string"
					? source.windowTitle.trim()
					: source.name.trim();
			if (!windowId && !windowTitle) {
				throw new Error("Missing window identifier for FFmpeg window capture");
			}

			return [
				"-y",
				"-f",
				"gdigrab",
				"-framerate",
				"60",
				"-draw_mouse",
				"0",
				"-i",
				windowId ? `hwnd=${windowId}` : `title=${windowTitle}`,
				...commonOutputArgs,
			];
		}

		return [
			"-y",
			"-f",
			"gdigrab",
			"-framerate",
			"60",
			"-draw_mouse",
			"0",
			"-i",
			"desktop",
			...commonOutputArgs,
		];
	}

	if (process.platform === "linux") {
		const displayEnv = process.env.DISPLAY || ":0.0";
		if (source?.id?.startsWith("window:")) {
			const bounds = await resolveLinuxWindowBounds(source);
			if (!bounds) {
				throw new Error("Unable to resolve Linux window bounds for FFmpeg capture");
			}

			return [
				"-y",
				"-f",
				"x11grab",
				"-framerate",
				"60",
				"-draw_mouse",
				"0",
				"-video_size",
				`${Math.max(2, bounds.width)}x${Math.max(2, bounds.height)}`,
				"-i",
				`${displayEnv}+${Math.round(bounds.x)},${Math.round(bounds.y)}`,
				...commonOutputArgs,
			];
		}

		const bounds = getDisplayBoundsForSource(source);
		return [
			"-y",
			"-f",
			"x11grab",
			"-framerate",
			"60",
			"-draw_mouse",
			"0",
			"-video_size",
			`${Math.max(2, bounds.width)}x${Math.max(2, bounds.height)}`,
			"-i",
			`${displayEnv}+${Math.round(bounds.x)},${Math.round(bounds.y)}`,
			...commonOutputArgs,
		];
	}

	if (process.platform === "darwin") {
		return [
			"-y",
			"-f",
			"avfoundation",
			"-capture_cursor",
			"0",
			"-framerate",
			"60",
			"-i",
			"1:none",
			...commonOutputArgs,
		];
	}

	throw new Error(`FFmpeg capture is not supported on ${process.platform}`);
}

export function waitForFfmpegCaptureStart(process: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					ffmpegCaptureOutputBuffer.trim() ||
						`FFmpeg exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, 900);

		const cleanup = () => {
			clearTimeout(timer);
			process.off("error", onError);
			process.off("exit", onExit);
		};

		process.once("error", onError);
		process.once("exit", onExit);
	});
}

export function waitForFfmpegCaptureStop(process: ChildProcessWithoutNullStreams, outputPath: string) {
	return new Promise<string>((resolve, reject) => {
		const onClose = async (code: number | null) => {
			cleanup();

			try {
				await fs.access(outputPath);
				if (code === 0 || code === null) {
					resolve(outputPath);
					return;
				}

				if (ffmpegCaptureOutputBuffer.includes("Exiting normally")) {
					resolve(outputPath);
					return;
				}
			} catch {
				// handled below
			}

			reject(
				new Error(
					ffmpegCaptureOutputBuffer.trim() ||
						`FFmpeg exited with code ${code ?? "unknown"}`,
				),
			);
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
			process.off("close", onClose);
			process.off("error", onError);
		};

		process.once("close", onClose);
		process.once("error", onError);
	});
}
