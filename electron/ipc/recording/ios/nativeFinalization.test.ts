import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { finalizeIOSRecording } from "./finalize";
import { resolveRecordingSessionManifest } from "../../project/session";
vi.mock("electron", () => ({ app: { getPath: () => "/private/tmp", isPackaged: false } }));
const generatorUrl = new URL(
	"../../../../scripts/fixtures/ios-capture/generate.mjs",
	import.meta.url,
).href;
const verifierUrl = new URL("../../../../scripts/verify-ios-capture-fixture.mjs", import.meta.url)
	.href;
it.skipIf(process.platform !== "darwin" || process.env.RECORDLY_RUN_NATIVE_MEDIA_TESTS !== "1")(
	"finalizes synthetic native-sidecar fixtures through the actual inspector and reopens provenance",
	async () => {
		const root = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "ios-native-finalization-")),
		);
		try {
			const { generateFixture } = await import(generatorUrl);
			const generated = await generateFixture(
				path.join(root, "generated"),
				"delayed-microphone",
			);
			const expected = JSON.parse(await fs.readFile(generated.expectedPath, "utf8"));
			const directory = path.join(root, `ios-${expected.sessionId}`);
			await fs.rename(generated.directory, directory);
			const journalPath = path.join(directory, "capture-journal.json");
			const journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
			journal.state = "finalising";
			delete journal.committedFile;
			await fs.writeFile(journalPath, JSON.stringify(journal));
			await fs.rm(path.join(directory, "recording.mov"));
			const { inspectFixtureMedia, verifyFixture } = await import(verifierUrl);
			const committed = await finalizeIOSRecording(
				{
					storage: { sessionId: expected.sessionId, directory, journalPath },
					nativeResult: journal.nativeResult,
				},
				{
					inspectMedia: (file) =>
						inspectFixtureMedia(directory, path.basename(file), expected.sessionId),
				},
			);
			const reopened = await resolveRecordingSessionManifest(committed.videoPath);
			expect(reopened?.captureMetadata?.narrationRecorded).toBe(true);
			expect(reopened?.webcamPath).toBeNull();
			expect(reopened?.hideOverlayCursorByDefault).toBe(true);
			const report = await verifyFixture({
				sessionDir: directory,
				expectedPath: path.join(directory, "expected.json"),
				reportPath: path.join(directory, "report.json"),
			});
			expect(report.passed).toBe(true);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	},
	30000,
);
