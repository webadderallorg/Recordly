import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../constants", () => ({ RECORDING_SESSION_MANIFEST_SUFFIX: ".recordly-session.json" }));
vi.mock("../utils", () => ({
	normalizeVideoSourcePath: (value: string | null | undefined) => value || null,
	parseJsonWithByteOrderMark: (value: string) => JSON.parse(value.replace(/^\uFEFF/, "")),
}));

import {
	getRecordingSessionManifestPath,
	persistRecordingSessionManifest,
	resolveRecordingSession,
} from "./session";

let directory: string;
let videoPath: string;
beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-session-"));
	videoPath = path.join(directory, "recording-1.mp4");
	await fs.writeFile(videoPath, "");
});
afterEach(() => fs.rm(directory, { recursive: true, force: true }));

it("restores the capture kind of a reopened recording without a webcam", async () => {
	await persistRecordingSessionManifest({ videoPath, captureSourceKind: "window" });

	await expect(resolveRecordingSession(videoPath)).resolves.toMatchObject({
		videoPath,
		webcamPath: null,
		captureSourceKind: "window",
	});
});

it("keeps older manifests without a capture kind readable", async () => {
	const webcamPath = path.join(directory, "recording-1-webcam.mp4");
	await fs.writeFile(webcamPath, "");
	await fs.writeFile(
		getRecordingSessionManifestPath(videoPath),
		JSON.stringify({
			version: 2,
			videoFileName: "recording-1.mp4",
			webcamFileName: "recording-1-webcam.mp4",
		}),
	);

	const session = await resolveRecordingSession(videoPath);
	expect(session).toMatchObject({ videoPath, webcamPath });
	expect(session).not.toHaveProperty("captureSourceKind");
});

it("removes the manifest when there is neither a webcam nor a capture kind", async () => {
	await persistRecordingSessionManifest({ videoPath, captureSourceKind: "screen" });
	await persistRecordingSessionManifest({ videoPath });

	await expect(fs.access(getRecordingSessionManifestPath(videoPath))).rejects.toThrow();
});
