import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	getRecordingSessionManifestPath,
	persistRecordingSessionManifest,
	resolveRecordingSessionManifest,
} from "./session";
vi.mock("electron", () => ({
	app: { getPath: () => "/private/tmp", getName: () => "Recordly", isPackaged: false },
}));
const roots: string[] = [];
const metadata = {
	version: 1 as const,
	sourceKind: "ios-device" as const,
	mode: "passthrough" as const,
	format: {
		codedWidth: 1920,
		codedHeight: 1080,
		displayWidth: 1080,
		displayHeight: 1920,
		codec: "h264",
		colorPrimaries: null,
		transferFunction: null,
		ycbcrMatrix: null,
		fullRange: null,
		transform: [0, 1, -1, 0, 1080, 0] as const,
		observedFrameRate: 30,
		fingerprint: "format1",
	},
	deviceAudioRecorded: false,
	narrationRecorded: false,
	stopReason: "user-stop",
	interrupted: false,
};
async function fixture() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ios-session-"));
	roots.push(dir);
	const videoPath = path.join(dir, "source-video.mov");
	await fs.writeFile(videoPath, "fixture");
	return {
		videoPath,
		webcamPath: null,
		captureMetadata: metadata,
		hideOverlayCursorByDefault: true,
	};
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })));
});
it("keeps device metadata without a webcam", async () => {
	const session = await fixture();
	await persistRecordingSessionManifest(session);
	const result = await resolveRecordingSessionManifest(session.videoPath);
	expect(result?.captureMetadata).toEqual(metadata);
	expect(result?.hideOverlayCursorByDefault).toBe(true);
	expect(result?.webcamPath).toBeNull();
});
it("ignores malformed optional provenance and rejects linked traversal or symlinks", async () => {
	const session = await fixture();
	const manifest = getRecordingSessionManifestPath(session.videoPath);
	await fs.writeFile(
		manifest,
		JSON.stringify({
			version: 3,
			videoFileName: "source-video.mov",
			webcamFileName: "../outside.mov",
			captureMetadata: { sourceKind: "ios-device", secret: "x" },
		}),
	);
	const result = await resolveRecordingSessionManifest(session.videoPath);
	expect(result?.webcamPath).toBeNull();
	expect(result?.captureMetadata).toBeUndefined();
	const outside = await fixture();
	await fs.symlink(outside.videoPath, path.join(path.dirname(session.videoPath), "webcam.mov"));
	await fs.writeFile(
		manifest,
		JSON.stringify({
			version: 2,
			videoFileName: "source-video.mov",
			webcamFileName: "webcam.mov",
		}),
	);
	expect((await resolveRecordingSessionManifest(session.videoPath))?.webcamPath).toBeNull();
});
it.each([1, 2])("reads legacy manifest v%s", async (version) => {
	const s = await fixture();
	await fs.writeFile(
		getRecordingSessionManifestPath(s.videoPath),
		JSON.stringify({ version, videoFileName: "source-video.mov", timeOffsetMs: 12 }),
	);
	expect((await resolveRecordingSessionManifest(s.videoPath))?.timeOffsetMs).toBe(12);
});
