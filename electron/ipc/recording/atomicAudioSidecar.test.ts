import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { writeAtomicAudioSidecar } from "./atomicAudioSidecar";

it("keeps partial data undiscoverable until conversion finishes", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-atomic-audio-"));
	const final = path.join(dir, "recording.mic.wav");
	try {
		await writeAtomicAudioSidecar(final, async (staging) => {
			await fs.writeFile(staging, "first 80 seconds");
			await expect(fs.stat(final)).rejects.toMatchObject({ code: "ENOENT" });
			await fs.appendFile(staging, " plus the remaining 14 minutes");
		});
		expect(await fs.readFile(final, "utf8")).toBe(
			"first 80 seconds plus the remaining 14 minutes",
		);
		expect(await fs.readdir(dir)).toEqual(["recording.mic.wav"]);
	} finally {
		await fs.rm(final, { force: true });
		await fs.rmdir(dir);
	}
});

it("does not destroy a previous complete sidecar when conversion fails", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-atomic-audio-"));
	const final = path.join(dir, "recording.mic.wav");
	try {
		await fs.writeFile(final, "complete recording");
		await expect(
			writeAtomicAudioSidecar(final, async (staging) => {
				await fs.writeFile(staging, "partial");
				throw new Error("encoder failed");
			}),
		).rejects.toThrow("encoder failed");
		expect(await fs.readFile(final, "utf8")).toBe("complete recording");
		expect(await fs.readdir(dir)).toEqual(["recording.mic.wav"]);
	} finally {
		await fs.rm(final, { force: true });
		await fs.rmdir(dir);
	}
});
