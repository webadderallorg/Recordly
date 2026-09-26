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
	it("shares writes and read barriers across store instances for the same file", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preferences-"));
		temporaryDirectories.push(directory);
		const file = path.join(directory, "recording.json");
		const recorder = createRecordingPreferencesStore(file);
		const library = createRecordingPreferencesStore(file);
		await recorder.update({ microphoneEnabled: true, webcamEnabled: true });
		const writes = [
			recorder.update({ microphoneDeviceId: "mic", systemAudioEnabled: true }),
			library.update({ recordingsDir: directory }),
			recorder.update({ webcamDeviceId: "camera" }),
		];
		await expect(library.read()).resolves.toEqual({
			microphoneEnabled: true, microphoneDeviceId: "mic", systemAudioEnabled: true,
			webcamEnabled: true, webcamDeviceId: "camera", recordingsDir: directory,
		});
		await Promise.all(writes);
	});

	it("continues accepting updates after a write fails", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preferences-"));
		temporaryDirectories.push(directory);
		const file = path.join(directory, "missing", "recording.json");
		const store = createRecordingPreferencesStore(file);
		await expect(store.update({ microphoneEnabled: true })).rejects.toThrow();
		await fs.mkdir(path.dirname(file));
		await store.update({ microphoneEnabled: false, systemAudioEnabled: true });
		await expect(store.read()).resolves.toEqual({ microphoneEnabled: false, systemAudioEnabled: true });
	});

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
