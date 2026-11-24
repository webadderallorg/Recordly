import { ensureRedistributableFfmpeg } from "./ffmpeg-distribution.mjs";

try {
	await ensureRedistributableFfmpeg({
		buildLinuxFromSource: process.argv.includes("--linux-from-source"),
	});
} catch (error) {
	console.error(`[ffmpeg] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
