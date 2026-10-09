import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../ipc/ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "/usr/bin/true" }));

const { probeAudioFile } = await import("./audioProbe");

describe("probeAudioFile", () => {
	it("refuses a path that is not a file, is missing, or is empty", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "recordly-probe-"));
		const empty = path.join(dir, "empty.mp3");
		await writeFile(empty, "");
		await expect(probeAudioFile(path.join(dir, "gone.mp3"))).rejects.toThrow(/no file at/);
		await expect(probeAudioFile(dir)).rejects.toThrow(/is a folder/);
		await expect(probeAudioFile(empty)).rejects.toThrow(/is empty/);
	});

	it("refuses a file ffmpeg reports no audio stream for", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "recordly-probe-"));
		const file = path.join(dir, "notaudio.mp3");
		await writeFile(file, "not really audio");
		await expect(probeAudioFile(file)).rejects.toThrow(/no audio track/);
	});
});
