import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setWindowsCaptureOutputBuffer, setWindowsCaptureTargetPath } from "../state";
import {
	describeWindowsCaptureStartFailure,
	prepareWindowsCaptureTempDirectory,
	waitForWindowsCaptureStop,
} from "./windows";

vi.mock("electron", () => ({
	app: {
		getPath: () => "C:\\RecordlyTest",
	},
	BrowserWindow: {
		getAllWindows: () => [],
	},
}));

class FakeCaptureProcess extends EventEmitter {
	stdout = new PassThrough();
	stderr = new PassThrough();
	stdin = new PassThrough();
	killed = false;

	kill = vi.fn(() => {
		this.killed = true;
		return true;
	});
}

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("Windows capture temporary storage", () => {
	it("accepts a writable Unicode temporary directory and removes its probe file", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-windows-temp-"));
		temporaryRoots.push(root);
		const unicodeDirectory = path.join(root, "录屏 临时目录");

		const status = await prepareWindowsCaptureTempDirectory(unicodeDirectory, 0);

		expect(status.directory).toBe(path.resolve(unicodeDirectory));
		expect(await fs.readdir(unicodeDirectory)).toEqual([]);
	});

	it("rejects a temporary directory that does not have the required free space", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-windows-space-"));
		temporaryRoots.push(root);

		await expect(
			prepareWindowsCaptureTempDirectory(root, Number.MAX_SAFE_INTEGER),
		).rejects.toThrow("Recordly needs at least");
	});

	it("prefers the native helper error and includes an actionable temporary path", () => {
		const detail = describeWindowsCaptureStartFailure(
			new Error("Native helper exited"),
			"INFO: Initializing\nERROR: Failed to initialize Media Foundation encoder\n",
			"D:\\RecordlyTemp",
		);

		expect(detail).toContain("ERROR: Failed to initialize Media Foundation encoder");
		expect(detail).toContain("D:\\RecordlyTemp");
		expect(detail).toContain("choose another Recordly storage location");
	});
});

describe("waitForWindowsCaptureStop", () => {
	beforeEach(() => {
		setWindowsCaptureOutputBuffer("");
		setWindowsCaptureTargetPath(null);
	});

	it("resolves the helper output path when the process closes cleanly", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Recording stopped. Output path: C:\\Recordly\\capture.mp4");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe("C:\\Recordly\\capture.mp4");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("resolves the fallback target path when the helper closes cleanly without output path", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Recording stopped without output path");
		setWindowsCaptureTargetPath("C:\\Recordly\\fallback.mp4");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 0);

		await expect(stopped).resolves.toBe("C:\\Recordly\\fallback.mp4");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("rejects with helper output when the helper exits with a non-zero code", async () => {
		const proc = new FakeCaptureProcess();
		setWindowsCaptureOutputBuffer("Encoder error: insufficient memory");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("close", 1);

		await expect(stopped).rejects.toThrow("Encoder error: insufficient memory");
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("rejects when the helper emits an error", async () => {
		const proc = new FakeCaptureProcess();
		const error = new Error("spawn failed");

		const stopped = waitForWindowsCaptureStop(
			proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
			1000,
		);
		proc.emit("error", error);

		await expect(stopped).rejects.toBe(error);
		expect(proc.kill).not.toHaveBeenCalled();
	});

	it("kills the helper and rejects when stop never completes", async () => {
		const proc = new FakeCaptureProcess();

		await expect(
			waitForWindowsCaptureStop(
				proc as unknown as Parameters<typeof waitForWindowsCaptureStop>[0],
				5,
			),
		).rejects.toThrow("Timed out waiting for native Windows capture to stop");
		expect(proc.kill).toHaveBeenCalledTimes(1);
	});
});
