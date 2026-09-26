import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { publishCompletedFile } from "./publishCompletedFile";

/** Finish encoding before publication; callers refresh readers after publication completes. */
export async function writeAtomicAudioSidecar(
	finalPath: string,
	encode: (stagingPath: string) => Promise<unknown>,
) {
	const stagingPath = `${finalPath}.pending-${randomUUID()}.wav`;
	try {
		await encode(stagingPath);
		await publishCompletedFile(stagingPath, finalPath);
	} finally {
		await fs.rm(stagingPath, { force: true }).catch(() => undefined);
	}
}
