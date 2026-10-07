import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Execute permissions and shell scripts only behave this way on POSIX systems.
describe.skipIf(process.platform === "win32")("bundled FFmpeg checks", () => {
	let tempRoot: string;
	let originalPath: string | undefined;

	async function writeScript(name: string, body: string, mode: number) {
		const scriptPath = path.join(tempRoot, name);
		await fs.writeFile(scriptPath, `#!/bin/sh\n${body}\n`);
		await fs.chmod(scriptPath, mode);
		return scriptPath;
	}

	async function importBinaryModule(bundledFfmpegPath?: string) {
		vi.resetModules();
		vi.doMock("electron", () => ({ app: { isPackaged: false } }));
		vi.doMock("node:module", () => ({
			createRequire: () => (id: string) => {
				if (id === "ffmpeg-static" && bundledFfmpegPath) {
					return bundledFfmpegPath;
				}
				throw new Error(`Cannot find module '${id}'`);
			},
		}));
		return import("./binary");
	}

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-ffmpeg-binary-"));
		originalPath = process.env.PATH;
	});

	afterEach(async () => {
		process.env.PATH = originalPath;
		vi.doUnmock("electron");
		vi.doUnmock("node:module");
		vi.resetModules();
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("accepts a binary that runs", async () => {
		const binaryPath = await writeScript("ffmpeg", "exit 0", 0o755);
		const { getBinaryRunProblem } = await importBinaryModule();

		expect(getBinaryRunProblem(binaryPath)).toBeNull();
	});

	it("explains why a binary cannot run", async () => {
		const notExecutable = await writeScript("no-exec-ffmpeg", "exit 0", 0o644);
		const failing = await writeScript("failing-ffmpeg", "exit 3", 0o755);
		const { getBinaryRunProblem } = await importBinaryModule();

		expect(getBinaryRunProblem(notExecutable)).toBe("EACCES");
		expect(getBinaryRunProblem(failing)).toBe("exited with code 3");
		expect(getBinaryRunProblem(path.join(tempRoot, "missing-ffmpeg"))).toBe("ENOENT");
	});

	it("stops waiting for a binary that hangs, even if it ignores SIGTERM", async () => {
		const hanging = await writeScript("hanging-ffmpeg", "trap '' TERM\nsleep 30", 0o755);
		const { getBinaryRunProblem } = await importBinaryModule();

		const startedAt = Date.now();
		expect(getBinaryRunProblem(hanging)).toBe("ETIMEDOUT");
		expect(Date.now() - startedAt).toBeLessThan(10_000);
	}, 15_000);

	it("checks each binary only once", async () => {
		const binaryPath = await writeScript("ffmpeg", "exit 0", 0o755);
		const { getBinaryRunProblem } = await importBinaryModule();

		expect(getBinaryRunProblem(binaryPath)).toBeNull();
		await fs.chmod(binaryPath, 0o644);
		expect(getBinaryRunProblem(binaryPath)).toBeNull();
	});

	it("falls back to FFmpeg on PATH when the bundled binary cannot run", async () => {
		const bundledPath = await writeScript("bundled-ffmpeg", "exit 0", 0o644);
		await fs.mkdir(path.join(tempRoot, "bin"));
		const systemPath = await writeScript(path.join("bin", "ffmpeg"), "exit 0", 0o755);
		process.env.PATH = `${path.dirname(systemPath)}${path.delimiter}${originalPath ?? ""}`;

		const { getFfmpegBinaryPath } = await importBinaryModule(bundledPath);

		expect(getFfmpegBinaryPath()).toBe(systemPath);
	});

	it("keeps using the bundled binary when it runs", async () => {
		const bundledPath = await writeScript("bundled-ffmpeg", "exit 0", 0o755);
		const { getFfmpegBinaryPath } = await importBinaryModule(bundledPath);

		expect(getFfmpegBinaryPath()).toBe(bundledPath);
	});
});
