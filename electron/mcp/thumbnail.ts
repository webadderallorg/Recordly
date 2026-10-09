import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describeFfmpegError } from "./ffmpegError";
import type { RunFfmpeg } from "./remoteEditor";

const CONVERT_TIMEOUT_MS = 30_000;
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

type PreviewReply = {
	image?: { data?: string; width?: number; height?: number };
	rendered?: string[];
	notRendered?: string[];
	note?: string;
};

export type ThumbnailArgs = { atMs: number; outputPath: string; overwrite?: boolean };

export function createThumbnail({
	requestEditor,
	runFfmpeg,
	ffmpegBinary,
}: {
	requestEditor: (
		op: string,
		payload: unknown,
		opts: { signal?: AbortSignal },
	) => Promise<unknown>;
	runFfmpeg: RunFfmpeg;
	ffmpegBinary: () => string;
}) {
	return async function thumbnail(args: ThumbnailArgs, signal?: AbortSignal) {
		const { atMs, outputPath, overwrite } = args;
		if (typeof atMs !== "number" || !Number.isFinite(atMs) || atMs < 0) {
			throw new Error(`atMs must be 0 or more, not ${JSON.stringify(atMs)}.`);
		}
		if (typeof outputPath !== "string" || !outputPath.trim()) {
			throw new Error("outputPath is empty.");
		}
		if (!path.isAbsolute(outputPath)) {
			throw new Error(`outputPath must be an absolute path: ${outputPath}`);
		}
		const target = path.resolve(outputPath);
		const extension = path.extname(target).toLowerCase();
		if (![".png", ".jpg", ".jpeg"].includes(extension)) {
			throw new Error("outputPath must end in .png, .jpg or .jpeg.");
		}
		const folder = path.dirname(target);
		const folderStats = await fs.stat(folder).catch(() => null);
		if (!folderStats?.isDirectory()) throw new Error(`The folder does not exist: ${folder}`);
		await fs.access(folder, constants.W_OK).catch(() => {
			throw new Error(`Recordly cannot write to the folder: ${folder}`);
		});
		const existing = await fs.stat(target).catch(() => null);
		if (existing && !existing.isFile()) throw new Error(`${target} is not a regular file.`);
		if (existing && !overwrite) {
			throw new Error(`${target} already exists. Pass overwrite: true to replace it.`);
		}

		const reply = (await requestEditor("render_preview", { atMs }, { signal })) as PreviewReply;
		const jpeg = Buffer.from(reply?.image?.data ?? "", "base64");
		if (!jpeg.subarray(0, 3).equals(JPEG_SIGNATURE)) {
			throw new Error("The editor returned no picture for that moment.");
		}

		const unique = randomUUID().slice(0, 8);
		const staged = `${target}.thumb-${unique}${extension}`;
		const source = `${target}.thumb-${unique}.src.jpg`;
		try {
			if (extension === ".png") {
				await fs.writeFile(source, jpeg);
				await runFfmpeg(
					ffmpegBinary(),
					["-y", "-hide_banner", "-i", source, "-frames:v", "1", staged],
					{ timeoutMs: CONVERT_TIMEOUT_MS, signal },
				).catch((error) => {
					throw new Error(
						`The frame was rendered but could not be converted to PNG: ${describeFfmpegError(error, CONVERT_TIMEOUT_MS)}`,
					);
				});
			} else {
				await fs.writeFile(staged, jpeg);
			}
			if (overwrite) await fs.rename(staged, target);
			else {
				await fs.link(staged, target).catch((error: NodeJS.ErrnoException) => {
					throw error.code === "EEXIST"
						? new Error(`${target} already exists. Pass overwrite: true to replace it.`)
						: error;
				});
			}
		} finally {
			await Promise.all([fs.rm(staged, { force: true }), fs.rm(source, { force: true })]);
		}
		return {
			path: target,
			atMs,
			width: reply.image?.width,
			height: reply.image?.height,
			rendered: reply.rendered,
			notRendered: reply.notRendered,
			note:
				"This is the export renderer's composite of the edited timeline, not the recorded screen, " +
				"drawn at most 1280 px wide, so it is a preview-size still rather than a frame at full export size. " +
				(reply.note ?? ""),
		};
	};
}

export type Thumbnail = ReturnType<typeof createThumbnail>;
