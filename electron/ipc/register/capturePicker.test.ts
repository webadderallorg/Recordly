import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	list: vi.fn(),
	resize: vi.fn(),
	broadcast: vi.fn(),
	pickSourceList: vi.fn(),
	validate: vi.fn(),

	selected: vi.fn(),
	recording: false,
	currentSource: null as Record<string, unknown> | null,
	create: vi.fn(),
	close: vi.fn(),
	overlay: {},
	outsider: {},
	windows: [] as object[],
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(name, handler),
	},
}));
vi.mock("../../windows", () => ({
	createCapturePickerWindows: mocks.create,
	closeCapturePickerWindows: mocks.close,
	getCapturePickerWindows: () => [
		{ isDestroyed: () => false, webContents: { send: mocks.broadcast } },
	],
	isCapturePickerWebContents: (sender: object) => mocks.windows.includes(sender),
}));
vi.mock("../windowResize", () => ({ resizeCaptureWindow: mocks.resize }));
vi.mock("../captureSelection", () => ({
	validateCaptureSource: mocks.validate,
}));
vi.mock("../capturePickerSources", () => ({ listCapturePickerWindows: mocks.list }));
vi.mock("../cursor/bounds", () => ({ stopWindowBoundsCapture: vi.fn() }));
vi.mock("../state", () => ({
	setSelectedSource: mocks.selected,
	get isCursorCaptureActive() {
		return mocks.recording;
	},
	get selectedSource() {
		return mocks.currentSource;
	},
}));
vi.mock("../utils", () => ({
	getScreen: () => ({
		getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 1000 } }],
		getPrimaryDisplay: () => ({ id: 1 }),
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
	}),
}));
vi.mock("./sources", () => ({
	bringSelectedWindowForward: vi.fn(),
	broadcastSelectedSourceChange: vi.fn(),
	getDesktopSources: vi.fn().mockResolvedValue([{ id: "screen:1:0", display_id: "1" }]),
}));

import { registerCapturePickerHandlers } from "./capturePicker";

const platform = process.platform;
afterEach(() => {
	Object.defineProperty(process, "platform", { value: platform });
	vi.unstubAllEnvs();
});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.handlers.clear();
	mocks.currentSource = null;
	mocks.recording = false;
	mocks.windows = [mocks.overlay];
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.list.mockResolvedValue([]);
	mocks.validate.mockImplementation(async (source) => source);
	registerCapturePickerHandlers({ pickSourceList: mocks.pickSourceList });
});
const call = (name: string, sender: object, input?: unknown) =>
	mocks.handlers.get(name)!({ sender }, input);
describe("selection-only picker IPC", () => {
	it("ignores completion from other windows and forces selection-only completion", async () => {
		const pending = call("pick-capture-target", mocks.outsider);
		await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
		await call("complete-capture-pick", mocks.outsider, {
			kind: "screen",
			displayId: 1,
			record: true,
		});
		expect(mocks.selected).not.toHaveBeenCalled();
		await call("complete-capture-pick", mocks.overlay, {
			kind: "screen",
			displayId: 1,
			record: true,
		});
		expect(await pending).toMatchObject({ success: true, source: { id: "screen:1:0" } });
		expect(await pending).not.toHaveProperty("record");
	});
	it("coalesces simultaneous opens into one picker", async () => {
		const first = call("pick-capture-target", mocks.outsider);
		const second = call("pick-capture-target", mocks.outsider);
		await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
		await call("complete-capture-pick", mocks.overlay, null);
		expect(await first).toEqual({ success: false, canceled: true });
		expect(await second).toEqual({ success: false, canceled: true });
	});
	it("keeps Wayland on the existing portal path without overlays or geometry probes", async () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		vi.stubEnv("XDG_SESSION_TYPE", "wayland");
		expect(await call("pick-capture-target", mocks.outsider)).toMatchObject({
			success: true,
			source: { id: "screen:linux-portal" },
		});
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.list).not.toHaveBeenCalled();
	});
});

it("rejects a window that disappeared while the picker was open", async () => {
	mocks.list.mockResolvedValue([
		{
			id: "window:101:0",
			title: "Document",
			appName: "Notes",
			x: 0,
			y: 0,
			width: 400,
			height: 300,
		},
	]);
	mocks.validate.mockResolvedValue(null);
	const pending = call("pick-capture-target", mocks.outsider);
	await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
	await call("complete-capture-pick", mocks.overlay, {
		kind: "window",
		windowId: "window:101:0",
		displayId: 1,
	});
	expect(await pending).toMatchObject({
		success: false,
		message: "That window or screen is no longer available.",
	});
	expect(mocks.selected).not.toHaveBeenCalled();
});
it("surfaces detection failures instead of opening a screen-only overlay", async () => {
	mocks.list.mockRejectedValue(new Error("Unable to detect windows"));
	expect(await call("pick-capture-target", mocks.outsider)).toMatchObject({
		success: false,
		message: "Unable to detect windows",
	});
	expect(mocks.create).not.toHaveBeenCalled();
	expect(mocks.selected).not.toHaveBeenCalled();
});

it("opens a fresh picker even when an area is already selected", async () => {
	mocks.currentSource = {
		id: "area:1",
		display_id: "1",
		area: { x: 100, y: 200, width: 400, height: 300 },
	};
	expect(await call("get-capture-picker-context", mocks.overlay, 1)).toMatchObject({
		lastArea: null,
	});
	mocks.currentSource = { id: "window:101:0", display_id: "1" };
	expect(await call("get-capture-picker-context", mocks.overlay, 1)).toMatchObject({
		lastArea: null,
	});
});

it("does not open any source picker during recording or pause", async () => {
	mocks.recording = true;
	expect(await call("pick-capture-target", mocks.outsider)).toEqual({
		success: false,
		canceled: true,
	});
	expect(mocks.list).not.toHaveBeenCalled();
	expect(mocks.create).not.toHaveBeenCalled();
	expect(mocks.selected).not.toHaveBeenCalled();
});

it("rejects a pending selection if recording starts while the picker is open", async () => {
	const pending = call("pick-capture-target", mocks.outsider);
	await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
	mocks.recording = true;
	await call("complete-capture-pick", mocks.overlay, { kind: "screen", displayId: 1 });
	expect(await pending).toEqual({ success: false, canceled: true });
	expect(mocks.selected).not.toHaveBeenCalled();
});

it("does not open overlays if recording starts while listing windows", async () => {
	mocks.list.mockImplementation(async () => {
		mocks.recording = true;
		return [];
	});
	expect(await call("pick-capture-target", mocks.outsider)).toEqual({
		success: false,
		canceled: true,
	});
	expect(mocks.create).not.toHaveBeenCalled();
});

it("keeps X11 on the source list and coalesces concurrent opens", async () => {
	Object.defineProperty(process, "platform", { value: "linux" });
	vi.stubEnv("XDG_SESSION_TYPE", "x11");
	let finish!: (result: unknown) => void;
	mocks.pickSourceList.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const first = call("pick-capture-target", mocks.outsider);
	const second = call("pick-capture-target", mocks.outsider);
	expect(mocks.pickSourceList).toHaveBeenCalledOnce();
	expect(mocks.list).not.toHaveBeenCalled();
	expect(mocks.create).not.toHaveBeenCalled();
	finish({ success: false, canceled: true });
	expect(await first).toEqual({ success: false, canceled: true });
	expect(await second).toEqual({ success: false, canceled: true });
});
it("keeps the X11 source list closed during recording", async () => {
	Object.defineProperty(process, "platform", { value: "linux" });
	vi.stubEnv("XDG_SESSION_TYPE", "x11");
	mocks.recording = true;
	expect(await call("pick-capture-target", mocks.outsider)).toEqual({
		success: false,
		canceled: true,
	});
	expect(mocks.pickSourceList).not.toHaveBeenCalled();
});

const resizeWindow = {
	id: "window:101:0",
	appName: "Notes",
	title: "Document",
	x: 160,
	y: 140,
	width: 620,
	height: 460,
};
async function openResizePicker() {
	mocks.list.mockResolvedValue([resizeWindow]);
	const pending = call("pick-capture-target", mocks.outsider);
	await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
	return { pending };
}
it("restricts native resizing to an active picker and valid dimensions", async () => {
	const request = { windowId: resizeWindow.id, width: 1280, height: 720 };
	expect(await call("resize-capture-window", mocks.overlay, request)).toMatchObject({
		success: false,
	});
	const { pending } = await openResizePicker();
	expect(await call("resize-capture-window", mocks.outsider, request)).toMatchObject({
		success: false,
	});
	for (const width of [0, 99, 16385, 1280.5, "1280"])
		expect(
			await call("resize-capture-window", mocks.overlay, { ...request, width }),
		).toMatchObject({ success: false });
	expect(
		await call("resize-capture-window", mocks.overlay, {
			...request,
			windowId: "window:999:0",
		}),
	).toMatchObject({ success: false });
	expect(mocks.resize).not.toHaveBeenCalled();
	await call("complete-capture-pick", mocks.overlay, null);
	await pending;
});
it("resizes the offered live window and updates picker geometry without starting capture", async () => {
	const { pending } = await openResizePicker();
	const actual = { x: 160, y: 140, width: 1000, height: 700 };
	mocks.resize.mockResolvedValue(actual);
	expect(
		await call("resize-capture-window", mocks.overlay, {
			windowId: resizeWindow.id,
			width: 1280,
			height: 720,
		}),
	).toEqual({ success: true, window: { ...resizeWindow, ...actual } });
	expect(mocks.resize).toHaveBeenCalledWith(resizeWindow, { width: 1280, height: 720 });
	expect(mocks.broadcast).toHaveBeenCalledWith("capture-picker-window-resized", {
		...resizeWindow,
		...actual,
	});
	expect(await call("get-capture-picker-context", mocks.overlay, 1)).toMatchObject({
		windows: [{ ...resizeWindow, ...actual }],
	});
	expect(mocks.selected).not.toHaveBeenCalled();
	await call("complete-capture-pick", mocks.overlay, {
		kind: "window",
		windowId: resizeWindow.id,
		displayId: 1,
	});
	expect(await pending).toMatchObject({ success: true, source: { id: resizeWindow.id } });
});
it("reports resize failures and preserves a usable picker", async () => {
	const { pending } = await openResizePicker();
	mocks.resize.mockRejectedValue(new Error("Allow Accessibility access."));
	expect(
		await call("resize-capture-window", mocks.overlay, {
			windowId: resizeWindow.id,
			width: 1280,
			height: 720,
		}),
	).toEqual({ success: false, error: "Allow Accessibility access." });
	await call("complete-capture-pick", mocks.overlay, {
		kind: "window",
		windowId: resizeWindow.id,
		displayId: 1,
	});
	expect(await pending).toMatchObject({ success: true });
});
it("rejects overlapping resizes and queues completion until a resize finishes", async () => {
	const { pending } = await openResizePicker();
	let release!: (v: unknown) => void;
	mocks.resize.mockReturnValue(
		new Promise((resolve) => {
			release = resolve;
		}),
	);
	const request = { windowId: resizeWindow.id, width: 1280, height: 720 };
	const first = call("resize-capture-window", mocks.overlay, request);
	await vi.waitFor(() => expect(mocks.resize).toHaveBeenCalledOnce());
	expect(await call("resize-capture-window", mocks.overlay, request)).toMatchObject({
		success: false,
	});
	const completion = call("complete-capture-pick", mocks.overlay, {
		kind: "window",
		windowId: resizeWindow.id,
		displayId: 1,
	});
	expect(mocks.selected).not.toHaveBeenCalled();
	release({ x: 160, y: 140, width: 1280, height: 720 });
	await first;
	await completion;
	expect(await pending).toMatchObject({ success: true });
});
it("does not resize a disappeared window or resize during recording", async () => {
	const { pending } = await openResizePicker();
	const request = { windowId: resizeWindow.id, width: 1280, height: 720 };
	mocks.list.mockResolvedValue([]);
	expect(await call("resize-capture-window", mocks.overlay, request)).toMatchObject({
		success: false,
	});
	mocks.recording = true;
	expect(await call("resize-capture-window", mocks.overlay, request)).toMatchObject({
		success: false,
	});
	expect(mocks.resize).not.toHaveBeenCalled();
	await call("complete-capture-pick", mocks.overlay, null);
	await pending;
});
it("cancellation while resizing releases queued completions without selecting a source", async () => {
	const { pending } = await openResizePicker();
	let release!: (v: unknown) => void;
	mocks.resize.mockReturnValue(
		new Promise((resolve) => {
			release = resolve;
		}),
	);
	const resize = call("resize-capture-window", mocks.overlay, {
		windowId: resizeWindow.id,
		width: 1280,
		height: 720,
	});
	await vi.waitFor(() => expect(mocks.resize).toHaveBeenCalledOnce());
	const completion = call("complete-capture-pick", mocks.overlay, {
		kind: "screen",
		displayId: 1,
	});
	await call("complete-capture-pick", mocks.overlay, null);
	expect(await pending).toEqual({ success: false, canceled: true });
	release({ x: 160, y: 140, width: 1280, height: 720 });
	expect(await resize).toMatchObject({ success: false });
	await completion;
	expect(mocks.selected).not.toHaveBeenCalled();
});
it("shares global stacking order with every display overlay for later window expansion", async () => {
	const outside = { ...resizeWindow, id: "window:202:0", x: -500, width: 400 };
	mocks.list.mockResolvedValue([outside, resizeWindow]);
	const pending = call("pick-capture-target", mocks.outsider);
	await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
	expect(await call("get-capture-picker-context", mocks.overlay, 1)).toMatchObject({
		windows: [outside, resizeWindow],
	});
	await call("complete-capture-pick", mocks.overlay, null);
	await pending;
});
