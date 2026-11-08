import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ipcMain } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isSupportedLocalMediaPath } from "../../../mediaTypes";

const mocks = vi.hoisted(() => ({
	approved: new Set<string>(),
	resolve: vi.fn(),
	fallback: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { isPackaged: false, getAppPath: () => "/recordly" },
	ipcMain: { handle: vi.fn() },
}));
vi.mock("../../../rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:43820",
}));
vi.mock("../../../appPaths", () => ({
	USER_DATA_PATH: "/recordly-user",
	RECORDINGS_DIR: "/recordly-recordings",
}));
vi.mock("../../project/manager", () => ({
	normalizeVideoSourcePath: (value: string) =>
		value.startsWith("file://") ? fileURLToPath(value) : value.trim() || null,
	resolveApprovedLocalMediaPath: mocks.resolve,
}));
vi.mock("../../state", () => ({ approvedLocalReadPaths: mocks.approved }));
vi.mock("../diagnostics", () => ({ getCompanionAudioFallbackInfo: mocks.fallback }));
vi.mock("../mac", () => ({
	recoverNativeMacCaptureOutput: vi.fn(),
	waitForNativeCaptureCommand: vi.fn(),
}));
vi.mock("../windows", () => ({
	isNativeWindowsCaptureAvailable: vi.fn(),
	recoverNativeWindowsCaptureOutput: vi.fn(),
}));

import { registerNativeControls } from "./nativeControls";
import { isNativeWindowsCaptureAvailable } from "../windows";

const frame = { url: "http://127.0.0.1:43820/?windowType=editor" };
const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as Electron.IpcMainInvokeEvent;
let directory: string;
let source: string;
let invoke: Parameters<typeof ipcMain.handle>[1];

beforeEach(async () => {
	directory = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "recordly-fallback-security-")),
	);
	source = path.join(directory, "recording.mp4");
	await fs.writeFile(source, "synthetic recording");
	mocks.approved.clear();
	mocks.resolve.mockReset().mockImplementation(async (candidate: string) => {
		const canonical = await fs.realpath(candidate).catch(() => null);
		if (!canonical || !mocks.approved.has(canonical) || !isSupportedLocalMediaPath(canonical))
			return null;
		if (!(await fs.stat(canonical)).isFile()) return null;
		mocks.approved.add(path.resolve(candidate));
		return canonical;
	});
	mocks.fallback.mockReset().mockResolvedValue({ paths: [], startDelayMsByPath: {} });
	vi.mocked(ipcMain.handle).mockClear();
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	registerNativeControls({
		windowsFinalizer: {},
		windowsInterruptedRecovery: { current: null },
		ownerRecovery: {},
	} as Parameters<typeof registerNativeControls>[0]);
	invoke = new Map(vi.mocked(ipcMain.handle).mock.calls).get("get-video-audio-fallback-paths")!;
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(directory, { recursive: true, force: true });
});

it("rejects missing, foreign and embedded callers before inspecting or approving any path", async () => {
	mocks.approved.add(source);
	const foreign = { url: "https://foreign.test/" };
	for (const event of [
		undefined,
		{},
		{ sender: trusted.sender },
		{ sender: { mainFrame: foreign }, senderFrame: foreign },
		{ sender: trusted.sender, senderFrame: { ...frame } },
	]) {
		expect(await invoke(event as Electron.IpcMainInvokeEvent, source)).toMatchObject({
			success: false,
		});
	}
	expect(mocks.resolve).not.toHaveBeenCalled();
	expect(mocks.fallback).not.toHaveBeenCalled();
	expect([...mocks.approved]).toEqual([source]);
});

it.each([
	"pause-native-screen-recording",
	"resume-native-screen-recording",
	"is-native-windows-capture-available",
	"get-last-native-capture-diagnostics",
])("rejects foreign and embedded callers before handling %s", async (channel) => {
	const handler = new Map(vi.mocked(ipcMain.handle).mock.calls).get(channel)!;
	const foreign = { url: "https://foreign.test/" };
	for (const event of [
		{ sender: { mainFrame: foreign }, senderFrame: foreign },
		{ sender: trusted.sender, senderFrame: { ...frame } },
		{ sender: trusted.sender },
	]) {
		await expect(handler(event as Electron.IpcMainInvokeEvent)).rejects.toThrow(
			"Untrusted recording caller",
		);
	}
	expect(isNativeWindowsCaptureAvailable).not.toHaveBeenCalled();
});

it("allows the trusted document to inspect native Windows capture availability", async () => {
	vi.mocked(isNativeWindowsCaptureAvailable).mockResolvedValueOnce(true);
	const handler = new Map(vi.mocked(ipcMain.handle).mock.calls).get(
		"is-native-windows-capture-available",
	)!;
	await expect(handler(trusted)).resolves.toEqual({ available: true });
});

it("does not let a trusted renderer approve an arbitrary existing source", async () => {
	expect(await invoke(trusted, source)).toMatchObject({ success: false, paths: [] });
	expect(mocks.fallback).not.toHaveBeenCalled();
	expect(mocks.approved.size).toBe(0);
});

it.each([null, {}, 42])("rejects invalid source input %s without reading it", async (input) => {
	expect(await invoke(trusted, input)).toMatchObject({ success: false, paths: [] });
	expect(mocks.resolve).not.toHaveBeenCalled();
	expect(mocks.fallback).not.toHaveBeenCalled();
});

it("preserves the trusted empty-source response without inspecting files", async () => {
	expect(await invoke(trusted, "")).toEqual({ success: true, paths: [], startDelayMsByPath: {} });
	expect(mocks.resolve).not.toHaveBeenCalled();
});

it("keeps dialog-approved file URLs and normal recording sidecars with their timing", async () => {
	const microphone = path.join(directory, "recording.mic.wav");
	const system = path.join(directory, "recording.system.m4a");
	await Promise.all([fs.writeFile(microphone, "mic"), fs.writeFile(system, "system")]);
	mocks.approved.add(source);
	mocks.fallback.mockResolvedValue({
		paths: [source, microphone, system],
		startDelayMsByPath: { [source]: 0, [microphone]: 125, [system]: 25 },
	});
	expect(await invoke(trusted, pathToFileURL(source).href)).toEqual({
		success: true,
		paths: [source, microphone, system],
		startDelayMsByPath: { [source]: 0, [microphone]: 125, [system]: 25 },
	});
	expect(mocks.fallback).toHaveBeenCalledWith(source);
	expect(mocks.approved.has(microphone)).toBe(true);
	expect(mocks.approved.has(system)).toBe(true);
});

it.skipIf(process.platform === "win32")(
	"does not approve a recording symlink whose real source was never selected",
	async () => {
		const link = path.join(directory, "unapproved.mp4");
		await fs.symlink(source, link);
		mocks.approved.add(link);
		expect(await invoke(trusted, link)).toMatchObject({ success: false });
		expect(mocks.fallback).not.toHaveBeenCalled();
		expect(mocks.approved.has(source)).toBe(false);
	},
);

it.skipIf(process.platform === "win32")(
	"cannot grant access to unrelated files or unapproved sidecar symlink targets",
	async () => {
		const unrelated = path.join(directory, "unrelated.wav");
		const link = path.join(directory, "recording.mic.wav");
		await fs.writeFile(unrelated, "unselected private media");
		await fs.symlink(unrelated, link);
		mocks.approved.add(source);
		mocks.fallback.mockResolvedValue({
			paths: [link, unrelated],
			startDelayMsByPath: { [link]: 45, [unrelated]: 90 },
		});
		expect(await invoke(trusted, source)).toEqual({
			success: true,
			paths: [],
			startDelayMsByPath: {},
		});
		expect([...mocks.approved]).toEqual([source]);
	},
);

it.skipIf(process.platform === "win32")(
	"preserves a companion symlink when its target was already explicitly approved",
	async () => {
		const audio = path.join(directory, "selected.wav");
		const link = path.join(directory, "recording.mic.wav");
		await fs.writeFile(audio, "selected audio");
		await fs.symlink(audio, link);
		mocks.approved.add(source);
		mocks.approved.add(audio);
		mocks.fallback.mockResolvedValue({ paths: [link], startDelayMsByPath: { [link]: 30 } });
		expect(await invoke(trusted, source)).toEqual({
			success: true,
			paths: [link],
			startDelayMsByPath: { [link]: 30 },
		});
	},
);
