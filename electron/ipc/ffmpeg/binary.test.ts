import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	accessSync: vi.fn(),
	spawnSync: vi.fn(),
	existsSync: vi.fn(),
	statSync: vi.fn(),
	require: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }));
vi.mock("node:fs", () => ({
	accessSync: mocks.accessSync,
	constants: { X_OK: 1 },
	existsSync: mocks.existsSync,
	statSync: mocks.statSync,
}));
vi.mock("node:module", () => ({ createRequire: () => mocks.require }));
vi.mock("electron", () => ({
	app: { isPackaged: true, getAppPath: () => "/installed/app.asar" },
}));

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const bundledFfmpeg = "/installed/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg";
const bundledFfprobe = "/installed/app.asar.unpacked/node_modules/ffprobe-static/ffprobe";
const systemFfmpeg = "/usr/bin/ffmpeg";
const linuxEncoderList = ["libx264", "aac", "gif", "png", "mjpeg", "h264_nvenc"]
	.map((encoder) => ` V..... ${encoder}`)
	.join("\n");
const linuxFilterList = ["scale", "palettegen", "paletteuse"]
	.map((filter) => ` ... ${filter} V->V`)
	.join("\n");
const installed = new Set<string>();

beforeEach(() => {
	vi.resetModules();
	vi.stubEnv("RECORDLY_FFMPEG_PATH", undefined);
	Object.defineProperty(process, "platform", { value: "linux" });
	installed.clear();
	mocks.existsSync.mockImplementation((filePath: string) => installed.has(filePath));
	mocks.statSync.mockReset().mockImplementation((filePath: string) => ({
		isFile: () => installed.has(filePath),
	}));
	mocks.accessSync.mockReset();
	mocks.require.mockImplementation((pkg: string) => {
		if (pkg === "ffmpeg-static") return bundledFfmpeg.replace(".asar.unpacked", ".asar");
		return { path: bundledFfprobe.replace(".asar.unpacked", ".asar") };
	});
	mocks.spawnSync.mockReset().mockReturnValue({ status: 0 });
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
	Object.defineProperty(process, "platform", platform);
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

it.each(["win32", "darwin"])("probes bundled FFmpeg once and uses it first on %s", async (os) => {
	Object.defineProperty(process, "platform", { value: os });
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
	Object.defineProperty(process, "platform", { value: "darwin" });
	installed.add(bundledFfmpeg);
	installed.add(systemFfmpeg);
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
	Object.defineProperty(process, "platform", { value: "darwin" });
	installed.add(bundledFfmpeg);
	mocks.spawnSync
		.mockReturnValueOnce({
			error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
		})
		.mockReturnValue({ status: 1 });
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(() => getFfmpegBinaryPath()).toThrow(/Bundled FFmpeg.*ETIMEDOUT.*no system FFmpeg/);
});

it.each([
	"...",
	"..",
])("prefers a compatible system FFmpeg on Linux with %s filter flags", async (filterFlags) => {
	installed.add(bundledFfmpeg);
	installed.add(systemFfmpeg);
	mocks.spawnSync.mockImplementation((_file, args: string[]) => {
		if (args.includes("-encoders")) return { status: 0, stdout: linuxEncoderList };
		if (args.includes("-filters")) {
			return { status: 0, stdout: linuxFilterList.replaceAll("...", filterFlags) };
		}
		return { status: 0, stdout: `${systemFfmpeg}\n` };
	});
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(getFfmpegBinaryPath()).toBe(systemFfmpeg);
	expect(getFfmpegBinaryPath()).toBe(systemFfmpeg);
	expect(mocks.spawnSync.mock.calls.filter(([file]) => file === systemFfmpeg)).toHaveLength(2);
	expect(mocks.spawnSync.mock.calls.some(([file]) => file === bundledFfmpeg)).toBe(false);
});

it.each([
	["H.264 software fallback", linuxEncoderList.replace("libx264", "mpeg4"), linuxFilterList],
	["GIF palette support", linuxEncoderList, linuxFilterList.replace("paletteuse", "pad")],
])("keeps the Linux bundle if system FFmpeg lacks %s", async (_feature, encoders, filters) => {
	installed.add(bundledFfmpeg);
	installed.add(systemFfmpeg);
	mocks.spawnSync
		.mockReturnValueOnce({ status: 0, stdout: `${systemFfmpeg}\n` })
		.mockReturnValueOnce({ status: 0, stdout: encoders })
		.mockReturnValue({ status: 0, stdout: filters });
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(getFfmpegBinaryPath()).toBe(bundledFfmpeg);
});

it("uses a working system binary as the fallback when no Linux bundle is installed", async () => {
	installed.add(systemFfmpeg);
	mocks.spawnSync
		.mockReturnValueOnce({ status: 0, stdout: `${systemFfmpeg}\n` })
		.mockReturnValueOnce({ status: 0, stdout: "" })
		.mockReturnValue({ status: 0 });
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(getFfmpegBinaryPath()).toBe(systemFfmpeg);
});

it("reports a bundled failure when system FFmpeg also cannot run", async () => {
	installed.add(bundledFfmpeg);
	installed.add(systemFfmpeg);
	mocks.spawnSync
		.mockReturnValueOnce({ status: 0, stdout: `${systemFfmpeg}\n` })
		.mockReturnValue({ status: 127 });
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(() => getFfmpegBinaryPath()).toThrow(/Bundled FFmpeg.*127.*no system FFmpeg/);
});

it.each([
	"win32",
	"darwin",
	"linux",
])("uses a working explicit override first on %s", async (os) => {
	Object.defineProperty(process, "platform", { value: os });
	installed.add(bundledFfmpeg);
	const override = path.resolve("custom-ffmpeg");
	installed.add(override);
	vi.stubEnv("RECORDLY_FFMPEG_PATH", " custom-ffmpeg ");
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(getFfmpegBinaryPath()).toBe(override);
	expect(mocks.spawnSync).toHaveBeenCalledExactlyOnceWith(
		override,
		["-version"],
		expect.anything(),
	);
});

it("continues with the bundle when an override points to a directory", async () => {
	Object.defineProperty(process, "platform", { value: "darwin" });
	installed.add(bundledFfmpeg);
	vi.stubEnv("RECORDLY_FFMPEG_PATH", process.cwd());
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(getFfmpegBinaryPath()).toBe(bundledFfmpeg);
	expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("RECORDLY_FFMPEG_PATH"));
});

it("continues with the bundle when an executable override cannot run", async () => {
	Object.defineProperty(process, "platform", { value: "darwin" });
	installed.add(bundledFfmpeg);
	const override = path.resolve("broken-ffmpeg");
	installed.add(override);
	vi.stubEnv("RECORDLY_FFMPEG_PATH", override);
	mocks.spawnSync.mockReturnValueOnce({ status: 127 });
	const { getFfmpegBinaryPath } = await import("./binary");
	expect(getFfmpegBinaryPath()).toBe(bundledFfmpeg);
	expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("RECORDLY_FFMPEG_PATH"));
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
