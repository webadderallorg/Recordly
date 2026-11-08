import fs from "node:fs/promises";
import path from "node:path";

/** Caller must first validate that this is an auto-generated recording path. */
export async function discardRecordingFiles(videoPath: string) {
	const base = videoPath.slice(0, -path.extname(videoPath).length);
	const files = [
		videoPath,
		`${videoPath}.cursor.json`,
		...[
			".recording-diagnostics.json",
			".recordly-session.json",
			".system.m4a",
			".mic.m4a",
			".system.wav",
			".mic.wav",
			".system.wav.json",
			".mic.wav.json",
		].map((suffix) => `${base}${suffix}`),
	];
	// Idempotent: a partial deletion must be safe to retry, including when the
	// video was removed but one of its audio tracks was temporarily locked.
	await Promise.all(files.map((file) => fs.rm(file, { force: true })));
}
