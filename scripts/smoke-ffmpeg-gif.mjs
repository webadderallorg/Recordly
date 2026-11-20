import { execFileSync } from "node:child_process";
import { compressGifBuffer } from "../electron/ipc/export/gifOptimization.ts";

export async function verifyFfmpegGifOptimization(ffmpegPath) {
	const source = execFileSync(
		ffmpegPath,
		[
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-filter_threads",
			"1",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=480x320:rate=4:duration=1",
			"-threads",
			"1",
			"-f",
			"gif",
			"pipe:1",
		],
		{ timeout: 15000, windowsHide: true },
	);
	const optimized = await compressGifBuffer(source, { ffmpegPath, timeoutMs: 15000 });
	if (optimized.byteLength >= source.byteLength) {
		throw new Error("GIF optimization did not reduce the smoke animation.");
	}
}
