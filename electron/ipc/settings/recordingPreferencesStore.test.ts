import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecordingPreferencesStore } from "./recordingPreferencesStore";

vi.mock("electron", () => ({
	app: {
		getPath: () => "",
	},
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, {
				recursive: true,
				force: true,
			}),
		),
	);
});

describe("recording preferences store", () => {
	it("preserves concurrent microphone and webcam preference updates", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preferences-"));
		temporaryDirectories.push(directory);
		const store = createRecordingPreferencesStore(path.join(directory, "recording.json"));

		await Promise.all([
			store.update({ microphoneEnabled: true }),
			store.update({ microphoneDeviceId: "preferred-mic" }),
			store.update({ webcamEnabled: true }),
			store.update({ webcamDeviceId: "preferred-camera" }),
		]);

		await expect(store.read()).resolves.toEqual({
			microphoneEnabled: true,
			microphoneDeviceId: "preferred-mic",
			webcamEnabled: true,
			webcamDeviceId: "preferred-camera",
		});
	});
});
