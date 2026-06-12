import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	beginSceneStyleSession,
	getSceneStyleEventsPath,
	persistSceneStyleEvents,
	readSceneStyleEvents,
	recordSceneStyleEvent,
} from "./sceneStyleEvents";

describe("scene style events session", () => {
	let videoPath: string;

	beforeEach(async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-scene-style-"));
		videoPath = path.join(dir, "recording.mp4");
	});

	it("persists recorded events as a sidecar and reads them back", async () => {
		beginSceneStyleSession();
		recordSceneStyleEvent({ timeMs: 5000, mode: "fill" });
		recordSceneStyleEvent({ timeMs: 9000, mode: "framed" });
		await persistSceneStyleEvents(videoPath);

		const raw = JSON.parse(await fs.readFile(getSceneStyleEventsPath(videoPath), "utf8"));
		expect(raw.version).toBe(1);
		expect(raw.events).toHaveLength(2);

		const read = await readSceneStyleEvents(videoPath);
		expect(read).toEqual([
			{ timeMs: 5000, mode: "fill" },
			{ timeMs: 9000, mode: "framed" },
		]);
	});

	it("persists the same session to every finalized output file", async () => {
		// finalizeStoredVideo runs once for the screen video and once for the
		// separate webcam video; the editor reads next to the screen video.
		beginSceneStyleSession();
		recordSceneStyleEvent({ timeMs: 5000, mode: "fill" });
		const webcamVideoPath = videoPath.replace(/\.mp4$/, "-webcam.mp4");
		await persistSceneStyleEvents(webcamVideoPath);
		await persistSceneStyleEvents(videoPath);

		expect(await readSceneStyleEvents(webcamVideoPath)).toHaveLength(1);
		expect(await readSceneStyleEvents(videoPath)).toHaveLength(1);

		// The next session clears the previous events.
		beginSceneStyleSession();
		const nextVideoPath = path.join(path.dirname(videoPath), "next.mp4");
		await persistSceneStyleEvents(nextVideoPath);
		await expect(fs.stat(getSceneStyleEventsPath(nextVideoPath))).rejects.toThrow();
	});

	it("writes nothing when no events were recorded", async () => {
		beginSceneStyleSession();
		await persistSceneStyleEvents(videoPath);
		await expect(fs.stat(getSceneStyleEventsPath(videoPath))).rejects.toThrow();
	});

	it("ignores events outside a session and invalid payloads", async () => {
		recordSceneStyleEvent({ timeMs: 5000, mode: "fill" }); // no session begun
		beginSceneStyleSession();
		recordSceneStyleEvent({ timeMs: Number.NaN, mode: "fill" } as never);
		recordSceneStyleEvent({ timeMs: 5, mode: "bogus" } as never);
		await persistSceneStyleEvents(videoPath);
		await expect(fs.stat(getSceneStyleEventsPath(videoPath))).rejects.toThrow();
	});

	it("returns empty array for missing/corrupt sidecars", async () => {
		expect(await readSceneStyleEvents(videoPath)).toEqual([]);
		await fs.writeFile(getSceneStyleEventsPath(videoPath), "not json");
		expect(await readSceneStyleEvents(videoPath)).toEqual([]);
	});
});
