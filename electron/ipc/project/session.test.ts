import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "C:\\RecordlyTest" } }));
import {
	getRecordingSessionManifestPath,
	persistRecordingSessionManifest,
	resolveRecordingSessionManifest,
} from "./session";

const temporaryDirectories: string[] = [];

async function createRecordingFixture() {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-blur-session-"));
	temporaryDirectories.push(directory);
	const videoPath = path.join(directory, "recording.mp4");
	const webcamPath = path.join(directory, "recording-webcam.webm");
	await Promise.all([fs.writeFile(videoPath, "video"), fs.writeFile(webcamPath, "webcam")]);
	return { videoPath, webcamPath };
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

describe("recording session background blur", () => {
	it("round-trips the optional blur snapshot in a version-2 manifest", async () => {
		const { videoPath, webcamPath } = await createRecordingFixture();
		await persistRecordingSessionManifest({
			videoPath,
			webcamPath,
			timeOffsetMs: 25,
			webcamBackgroundBlur: { enabled: true, amount: 17 },
		});

		await expect(resolveRecordingSessionManifest(videoPath)).resolves.toMatchObject({
			videoPath,
			webcamPath,
			timeOffsetMs: 25,
			webcamBackgroundBlur: { enabled: true, amount: 17 },
		});
	});

	it("defaults old manifests to blur off", async () => {
		const { videoPath, webcamPath } = await createRecordingFixture();
		await fs.writeFile(
			getRecordingSessionManifestPath(videoPath),
			JSON.stringify({
				version: 2,
				videoFileName: path.basename(videoPath),
				webcamFileName: path.basename(webcamPath),
			}),
			"utf-8",
		);

		await expect(resolveRecordingSessionManifest(videoPath)).resolves.toMatchObject({
			webcamBackgroundBlur: { enabled: false, amount: 12 },
		});
	});
});
