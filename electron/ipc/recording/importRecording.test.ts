import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	directory: "",
	current: "",
	recording: "",
	args: [] as string[][],
	approve: vi.fn(),
}));
vi.mock("../../appPaths", () => ({ USER_DATA_PATH: "/tmp/recordly-test-user" }));
vi.mock("node:child_process", () => ({
	execFile: (
		_file: string,
		args: string[],
		_options: unknown,
		callback: (error: null, stdout: string, stderr: string) => void,
	) => {
		mocks.args.push(args);
		callback(null, "", "");
	},
}));
vi.mock("./sequenceWebcam", () => ({
	composeSequenceWebcam: vi.fn(),
	sequenceWebcamOutputs: () => [],
}));
vi.mock("../ffmpeg/metadata", () => ({
	probeNativeVideoMetadata: async () => ({
		width: 640,
		height: 360,
		frameRate: 30,
		duration: 1,
		hasAudio: true,
	}),
}));
vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => "ffmpeg",
	getFfprobeBinaryPath: () => "ffprobe",
}));
vi.mock("../../mediaServer", () => ({
	getMediaServerBaseUrl: () => "http://127.0.0.1:4321",
	buildMediaUrl: (_server: string, file: string) => file,
}));
vi.mock("../project/manager", () => ({
	rememberApprovedLocalReadPath: mocks.approve,
	resolveApprovedLocalMediaPath: async (file: string) => (file === mocks.current ? file : null),
}));
vi.mock("../utils", () => ({
	getRecordingsDir: async () => mocks.directory,
	getTelemetryPathForVideo: (file: string) => `${file}.cursor.json`,
	parseJsonWithByteOrderMark: (value: string) => JSON.parse(value.replace(/^\uFEFF/, "")),
}));
vi.mock("../cursor/telemetry", () => ({
	normalizeCursorTelemetrySamples: () => [],
	writeCursorTelemetry: vi.fn(),
}));
vi.mock("./library", () => ({ listRecordings: async () => [{ path: mocks.recording }] }));
import { importRecording } from "./importRecording";

beforeEach(async () => {
	mocks.directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-import-companions-"));
	mocks.current = path.join(mocks.directory, "recording-1.mp4");
	mocks.recording = path.join(mocks.directory, "recording-2.mp4");
	mocks.args.splice(0);
	mocks.approve.mockClear();
	for (const file of [mocks.current, mocks.recording]) {
		const stem = file.replace(/\.mp4$/, "");
		await Promise.all(
			[file, `${stem}.system.m4a`, `${stem}.mic.wav`].map((file) =>
				fs.writeFile(file, "media"),
			),
		);
		await fs.writeFile(
			`${stem}.mic.wav.json`,
			`\uFEFF${JSON.stringify({ startDelayMs: 273 })}`,
		);
	}
});
afterEach(async () => {
	await fs.rm(mocks.directory, { recursive: true, force: true });
});
it("imports both mixed native/browser tracks with retained microphone timing", async () => {
	const result = await importRecording(mocks.current, mocks.recording);
	const normalizations = mocks.args.filter(
		(args) => args.at(-1)?.endsWith(".mkv") && args.includes("-filter_complex"),
	);
	expect(normalizations).toHaveLength(2);
	for (const [index, file] of [mocks.current, mocks.recording].entries()) {
		const args = normalizations[index];
		const stem = file.replace(/\.mp4$/, "");
		expect(args.slice(0, 11)).toEqual([
			"-hide_banner",
			"-loglevel",
			"error",
			"-nostdin",
			"-y",
			"-i",
			file,
			"-i",
			`${stem}.system.m4a`,
			"-i",
			`${stem}.mic.wav`,
		]);
		const filter = args[args.indexOf("-filter_complex") + 1];
		expect(filter).toContain("[1:a:0]aresample");
		expect(filter).toContain("[2:a:0]aresample");
		expect(filter).toContain("adelay=273:all=1");
		expect(args).not.toContain("anullsrc=r=48000:cl=stereo");
	}
	expect(result.sourceStartMs).toBe(1000);
	expect(result.totalDurationMs).toBe(2000);
	expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(result.path);
});
