import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	readFile: vi.fn(),
	run: vi.fn(),
	stat: vi.fn(),
}));
vi.mock("node:util", () => ({ promisify: (fn: unknown) => fn }));
vi.mock("node:child_process", () => ({ execFile: mocks.run }));
vi.mock("node:fs/promises", () => ({
	default: {
		realpath: async (file: string) => file,
		stat: mocks.stat,
		readFile: mocks.readFile,
		mkdir: vi.fn(),
		writeFile: vi.fn(),
	},
}));
vi.mock("electron", () => ({ app: { getPath: () => "/cache" } }));
vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "ffmpeg" }));
vi.mock("../project/manager", () => ({ resolveApprovedLocalMediaPath: async (p: string) => p }));
vi.mock("../utils", () => ({ getRecordingsDir: async () => "/recordings" }));

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mocks.stat.mockResolvedValue({ isFile: () => true, mtimeMs: 1, size: 100 });
});

describe("recording thumbnail scheduling", () => {
	it("serves a disk cache hit while an uncached video is still decoding", async () => {
		let finish!: (value: { stdout: Buffer }) => void;
		mocks.readFile.mockRejectedValueOnce(
			Object.assign(new Error("missing"), { code: "ENOENT" }),
		);
		mocks.run.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const { getRecordingThumbnail } = await import("./thumbnail");
		const slow = getRecordingThumbnail("/recordings/slow.mp4");
		await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
		mocks.readFile.mockResolvedValue(Buffer.from("cached"));
		await expect(getRecordingThumbnail("/recordings/cached.mp4")).resolves.toBe(
			`data:image/jpeg;base64,${Buffer.from("cached").toString("base64")}`,
		);
		finish({ stdout: Buffer.from("generated") });
		await slow;
	});

	it("deduplicates concurrent misses and keeps expensive decodes serial", async () => {
		let finish!: (value: { stdout: Buffer }) => void;
		mocks.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
		mocks.run
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			)
			.mockResolvedValue({ stdout: Buffer.from("next") });
		const { getRecordingThumbnail } = await import("./thumbnail");
		const first = getRecordingThumbnail("/recordings/first.mp4");
		const duplicate = getRecordingThumbnail("/recordings/first.mp4");
		const second = getRecordingThumbnail("/recordings/second.mp4");
		await vi.waitFor(() => expect(mocks.readFile).toHaveBeenCalledTimes(2));
		expect(mocks.run).toHaveBeenCalledOnce();
		finish({ stdout: Buffer.from("first") });
		const [a, b] = await Promise.all([first, duplicate, second]);
		expect(a).toBe(b);
		expect(mocks.run).toHaveBeenCalledTimes(2);
	});

	it("still rejects sources outside the approved library before reading the cache", async () => {
		const { getRecordingThumbnail } = await import("./thumbnail");
		await expect(getRecordingThumbnail("/other/file.mp4")).rejects.toThrow("outside");
		expect(mocks.readFile).not.toHaveBeenCalled();
	});
});
