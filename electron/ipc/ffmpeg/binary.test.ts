import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	spawnSync: vi.fn(),
	existsSync: vi.fn(),
	require: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("node:fs", () => ({ existsSync: mocks.existsSync }));
vi.mock("node:module", () => ({ createRequire: () => mocks.require }));
vi.mock("electron", () => ({
	app: { isPackaged: true, getAppPath: () => "/installed/app.asar" },
}));

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const bundledFfmpeg = "/installed/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg";
const bundledFfprobe = "/installed/app.asar.unpacked/node_modules/ffprobe-static/ffprobe";
const installed = new Set<string>();

beforeEach(() => {
	vi.resetModules();
	Object.defineProperty(process, "platform", { value: "linux" });
	installed.clear();
	mocks.existsSync.mockImplementation((filePath: string) => installed.has(filePath));
	mocks.require.mockImplementation((pkg: string) => {
		if (pkg === "ffmpeg-static") return bundledFfmpeg.replace(".asar.unpacked", ".asar");
		return { path: bundledFfprobe.replace(".asar.unpacked", ".asar") };
	});
	mocks.spawnSync.mockReset().mockReturnValue({ status: 0 });
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
	Object.defineProperty(process, "platform", platform);
	vi.restoreAllMocks();
});

it("probes a packaged binary once and keeps it ahead of system FFmpeg", async () => {
	installed.add(bundledFfmpeg);
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(getFfmpegBinaryPath()).toBe(bundledFfmpeg);
	expect(getFfmpegBinaryPath()).toBe(bundledFfmpeg);
	expect(mocks.spawnSync).toHaveBeenCalledExactlyOnceWith(
		bundledFfmpeg,
		["-version"],
		expect.objectContaining({ timeout: expect.any(Number), killSignal: "SIGKILL" }),
	);
});

it("tries system FFmpeg when the existing bundled executable cannot start", async () => {
	installed.add(bundledFfmpeg);
	mocks.spawnSync
		.mockReturnValueOnce({
			error: Object.assign(new Error("permission denied"), { code: "EACCES" }),
		})
		.mockReturnValue({ status: 0, stdout: "/usr/bin/ffmpeg\n" });
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(getFfmpegBinaryPath()).toBe("/usr/bin/ffmpeg");
	expect(getFfmpegBinaryPath()).toBe("/usr/bin/ffmpeg");
	expect(mocks.spawnSync.mock.calls.filter(([file]) => file === bundledFfmpeg)).toHaveLength(1);
});

it("reports the bundled failure if there is no system fallback", async () => {
	installed.add(bundledFfmpeg);
	mocks.spawnSync
		.mockReturnValueOnce({
			error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
		})
		.mockReturnValue({ status: 1 });
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(() => getFfmpegBinaryPath()).toThrow(/Bundled FFmpeg.*ETIMEDOUT.*no system FFmpeg/);
});

it("falls through a broken source-built Linux FFprobe to the bundled alternative", async () => {
	const sourceBuilt = path.join(
		"/installed/app.asar.unpacked",
		"node_modules",
		"ffmpeg-static",
		"ffprobe-recordly",
	);
	installed.add(sourceBuilt);
	installed.add(bundledFfprobe);
	mocks.spawnSync.mockReturnValueOnce({ status: null, signal: "SIGSEGV" });
	const { getFfprobeBinaryPath } = await import("./binary");
	expect(getFfprobeBinaryPath()).toBe(bundledFfprobe);
	expect(mocks.spawnSync.mock.calls.map(([file]) => file)).toEqual([sourceBuilt, bundledFfprobe]);
});
