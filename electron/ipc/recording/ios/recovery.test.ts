import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { allocateIOSSessionStorage, updateIOSJournal } from "./storage";
import { IOSRecoveryRegistry } from "./recovery";
vi.mock("electron", () => ({ app: { getPath: () => "/private/tmp", isPackaged: false } }));
const id = "3d594650-3436-4a5a-b6a7-5ff45ecf73d0";
const format = {
	codedWidth: 100,
	codedHeight: 200,
	displayWidth: 100,
	displayHeight: 200,
	codec: "h264",
	colorPrimaries: null,
	transferFunction: null,
	ycbcrMatrix: null,
	fullRange: null,
	transform: [1, 0, 0, 1, 0, 0] as const,
	observedFrameRate: 30,
	fingerprint: "format",
};
const roots: string[] = [];
async function fixture() {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ios-recovery-")));
	roots.push(root);
	const storage = await allocateIOSSessionStorage(root, id);
	await fs.writeFile(path.join(storage.directory, "source-video.mov"), "video");
	await updateIOSJournal(storage, { state: "recording", format, mode: "passthrough" });
	return { root, storage };
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })));
});
const inspectMedia = async () => ({
	decodable: true,
	duration: { value: "5000", timescale: 1000 },
	video: format,
});
it("does not inspect any session while disabled by default", async () => {
	const { root } = await fixture();
	const inspect = vi.fn(inspectMedia);
	expect(await new IOSRecoveryRegistry({ inspectMedia: inspect }).scan(root)).toEqual([]);
	expect(inspect).not.toHaveBeenCalled();
});
it("offers inspected video-only recovery when timing is lost and resolves only scanned UUIDs", async () => {
	const { root, storage } = await fixture();
	const registry = new IOSRecoveryRegistry({ inspectMedia }, true);
	const candidates = await registry.scan(root);
	expect(candidates).toEqual([
		{
			sessionId: id,
			status: "recoverable-video",
			durationMs: 5000,
			reasonCode: "TIMING_UNAVAILABLE",
		},
	]);
	expect(JSON.stringify(candidates)).not.toContain(root);
	await expect(registry.recover({ sessionId: "../evil", mode: "video-only" })).rejects.toThrow();
	await expect(registry.recover({ sessionId: id, mode: "with-audio" })).rejects.toThrow();
	const committed = await registry.recover({ sessionId: id, mode: "video-only" });
	expect(committed.captureMetadata.interrupted).toBe(true);
	expect(committed.videoPath).toBe(path.join(storage.directory, "source-video.mov"));
});
it("rejects invalid video, partial journal and directory symlinks; discard is explicit", async () => {
	const { root, storage } = await fixture();
	const registry = new IOSRecoveryRegistry(
		{
			inspectMedia: async () => ({
				decodable: false,
				duration: { value: "0", timescale: 1 },
			}),
		},
		true,
	);
	expect((await registry.scan(root))[0]?.status).toBe("unrecoverable");
	await registry.discard(id);
	await expect(fs.access(storage.directory)).rejects.toThrow();
	const fixture2 = await fixture();
	await fs.writeFile(fixture2.storage.journalPath, "{");
	expect(await registry.scan(fixture2.root)).toEqual([]);
});
it("uses real helper checkpoint evidence to recover a partially written main journal", async () => {
	const { root, storage } = await fixture();
	const nativeResult = {
		sessionId: id,
		mode: "passthrough",
		format,
		stopReason: "helper-exited",
		video: {
			relativeName: "source-video.mov",
			mediaKind: "video",
			firstHostTime: { value: "100", timescale: 1 },
			duration: { value: "5000", timescale: 1000 },
			sampleCount: 150,
			mediaFormat: { codec: "h264", width: 100, height: 200 },
		},
		timingFile: "native-timing.json",
	};
	await fs.writeFile(storage.journalPath, '{"state":');
	await fs.writeFile(
		path.join(storage.directory, "native-timing.json"),
		JSON.stringify({ result: nativeResult }),
	);
	const registry = new IOSRecoveryRegistry({ inspectMedia }, true);
	expect((await registry.scan(root))[0]?.status).toBe("recoverable-video");
	await registry.recover({ sessionId: id, mode: "video-only" });
	const journal = JSON.parse(await fs.readFile(storage.journalPath, "utf8"));
	expect(journal.nativeResult.video.sampleCount).toBe(150);
	expect(journal.state).toBe("committed");
});
it("never manufactures native host time or accepted counters for missing-timing recovery", async () => {
	const { root, storage } = await fixture();
	const registry = new IOSRecoveryRegistry({ inspectMedia }, true);
	await registry.scan(root);
	await registry.recover({ sessionId: id, mode: "video-only" });
	const journal = JSON.parse(await fs.readFile(storage.journalPath, "utf8"));
	expect(journal.nativeResult).toBeUndefined();
});
it("never inspects or registers an excluded active recording", async () => {
	const { root } = await fixture();
	const inspect = vi.fn(inspectMedia);
	const registry = new IOSRecoveryRegistry({ inspectMedia: inspect }, true);
	expect(await registry.scan(root, new Set([id]))).toEqual([]);
	expect(inspect).not.toHaveBeenCalled();
	await expect(registry.resolveDirectory(id)).rejects.toThrow("INVALID_RECOVERY_REQUEST");
	await expect(registry.discard(id)).rejects.toThrow("INVALID_RECOVERY_REQUEST");
});
