import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), mac: vi.fn(), dip: vi.fn() }));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
vi.mock("./cursor/bounds", () => ({ getNativeMacWindowsFrontToBack: mocks.mac }));
vi.mock("./utils", () => ({ getScreen: () => ({ screenToDipRect: mocks.dip }) }));

import { resizeCaptureWindow } from "./windowResize";

const platform = process.platform;
const source = { id: "window:101:0" };
const size = { width: 1280, height: 720 };
const bounds = { x: -500, y: 30, width: 1280, height: 720 };
const setPlatform = (value: string) => Object.defineProperty(process, "platform", { value });

beforeEach(() => {
	vi.resetAllMocks();
	setPlatform("darwin");
	mocks.mac.mockResolvedValue([
		{ ...source, ownerPid: 9876, x: 10, y: 20, width: 600, height: 400 },
	]);
	mocks.exec.mockResolvedValue({ stdout: "-500,30,1280,720\n" });
	mocks.dip.mockImplementation((_: unknown, value: unknown) => value);
});
afterEach(() => {
	setPlatform(platform);
	vi.unstubAllEnvs();
});

describe("resizeCaptureWindow", () => {
	it.each([
		0,
		99,
		16385,
		Number.NaN,
		Infinity,
		100.5,
		"1280",
		undefined,
	])("rejects invalid dimensions before touching native windows: %s", async (width) => {
		await expect(
			resizeCaptureWindow(source, { width: width as number, height: 720 }),
		).rejects.toThrow("whole numbers");
		expect(mocks.exec).not.toHaveBeenCalled();
		expect(mocks.mac).not.toHaveBeenCalled();
	});
	it.each([
		"screen:101:0",
		"window:101oops",
		"window:0:0",
		"window:9007199254740992:0",
		"window:101:0;evil",
	])("rejects invalid native identity %s", async (id) => {
		await expect(resizeCaptureWindow({ id }, size)).rejects.toThrow("Select a window");
		expect(mocks.exec).not.toHaveBeenCalled();
	});
	it("targets the exact native macOS window and owning PID with argv, without title matching", async () => {
		expect(await resizeCaptureWindow(source, size)).toEqual(bounds);
		expect(mocks.mac).toHaveBeenCalledWith({ strict: true });
		const [command, args, options] = mocks.exec.mock.calls[0];
		expect(command).toBe("osascript");
		expect(args.slice(2)).toEqual([
			"--",
			"9876",
			"101",
			"1280",
			"720",
			"10",
			"20",
			"600",
			"400",
			"true",
		]);
		expect(args[1]).toContain("AXWindowNumber");
		expect(args[1]).toContain("unix id");
		expect(args[1]).not.toContain("window 1");
		expect(options).toMatchObject({ timeout: 10000 });
	});
	it("disables the geometry fallback when native windows from the same owner overlap exactly", async () => {
		mocks.mac.mockResolvedValue([
			{ ...source, ownerPid: 9876, x: 10, y: 20, width: 600, height: 400 },
			{ id: "window:102:0", ownerPid: 9876, x: 10, y: 20, width: 600, height: 400 },
		]);
		await resizeCaptureWindow(source, size);
		expect(mocks.exec.mock.calls[0][1].at(-1)).toBe("false");
	});
	it("explains ambiguous Accessibility window geometry without guessing by title", async () => {
		mocks.exec.mockRejectedValue(new Error("Window identity is ambiguous."));
		await expect(resizeCaptureWindow(source, size)).rejects.toThrow("Move the selected window");
	});
	it("returns actual app-constrained bounds rather than assuming the requested dimensions", async () => {
		mocks.exec.mockResolvedValue({ stdout: "0,50,1440,900" });
		expect(await resizeCaptureWindow(source, size)).toEqual({
			x: 0,
			y: 50,
			width: 1440,
			height: 900,
		});
	});
	it.each([
		{ windows: [] },
		{ windows: [{ id: "window:102:0", ownerPid: 9876 }] },
		{ windows: [{ ...source }] },
		{ windows: [{ ...source, ownerPid: process.pid }] },
	])("never falls back to a different macOS window", async ({ windows }) => {
		mocks.mac.mockResolvedValue(windows);
		await expect(resizeCaptureWindow(source, size)).rejects.toThrow("no longer available");
		expect(mocks.exec).not.toHaveBeenCalled();
	});
	it("explains required macOS Accessibility permission", async () => {
		mocks.exec.mockRejectedValue(new Error("Not authorized to send Apple events"));
		await expect(resizeCaptureWindow(source, size)).rejects.toThrow("Accessibility");
	});
	it("reports a nonresizable window", async () => {
		mocks.exec.mockRejectedValue(new Error("This window cannot be resized."));
		await expect(resizeCaptureWindow(source, size)).rejects.toThrow("cannot be resized");
	});
	it.each([
		"",
		"1,2,,3",
		"1,2,Infinity,3",
		"1,2,0,3",
		"1,2,3,4,5",
	])("does not report success for malformed native bounds %s", async (stdout) => {
		mocks.exec.mockResolvedValue({ stdout });
		await expect(resizeCaptureWindow(source, size)).rejects.toThrow();
	});
	it("resizes only the selected HWND, preserves position and converts actual physical bounds to display points", async () => {
		setPlatform("win32");
		mocks.exec.mockResolvedValue({
			stdout: JSON.stringify({ x: -1000, y: 60, width: 2560, height: 1440 }),
		});
		mocks.dip.mockReturnValue(bounds);
		expect(await resizeCaptureWindow(source, size)).toEqual(bounds);
		const [command, args, options] = mocks.exec.mock.calls[0];
		expect(command).toBe("powershell.exe");
		expect(options.env).toMatchObject({
			RECORDLY_RESIZE_WINDOW_ID: "101",
			RECORDLY_RESIZE_WIDTH: "1280",
			RECORDLY_RESIZE_HEIGHT: "720",
		});
		expect(args[3]).toContain("SetWindowPos");
		expect(args[3]).toContain("0x0016"); // SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE.
		expect(args[3]).toContain("GetDpiForWindow");
		expect(args[3]).toContain("DwmGetWindowAttribute(h, 9");
		expect(args[3]).toContain("GetVisibleRect($h, [ref]$visible)");
		expect(args[3]).toContain("+ $extraWidth");
		expect(args[3]).toContain("+ $extraHeight");
		expect(args[3]).toContain("GetVisibleRect($h, [ref]$r)");
		expect(args[3]).not.toContain("MainWindowTitle");
		expect(mocks.dip).toHaveBeenCalledWith(null, {
			x: -1000,
			y: 60,
			width: 2560,
			height: 1440,
		});
	});
	it("preserves actual constrained Windows visible bounds rather than replacing them with the request", async () => {
		setPlatform("win32");
		const visible = { x: -640, y: 45, width: 1440, height: 900 };
		mocks.exec.mockResolvedValue({ stdout: JSON.stringify(visible) });
		expect(await resizeCaptureWindow(source, size)).toEqual(visible);
		expect(mocks.dip).toHaveBeenCalledWith(null, visible);
	});
	it("rejects invalid Windows geometry", async () => {
		setPlatform("win32");
		mocks.exec.mockResolvedValue({ stdout: JSON.stringify({ ...bounds, width: -1 }) });
		await expect(resizeCaptureWindow(source, size)).rejects.toThrow("Unable to resize");
	});
	it("uses exact X11 window ID and returns its actual geometry", async () => {
		setPlatform("linux");
		vi.stubEnv("XDG_SESSION_TYPE", "x11");
		mocks.exec.mockResolvedValueOnce({ stdout: "" }).mockResolvedValueOnce({
			stdout: "0x00000066 0 0 0 900 600 host Duplicate title\n0x00000065 0 -500 30 1280 720 host Selected title",
		});
		expect(await resizeCaptureWindow(source, size)).toEqual(bounds);
		expect(mocks.exec.mock.calls[0].slice(0, 2)).toEqual([
			"wmctrl",
			["-i", "-r", "0x65", "-e", "0,-1,-1,1280,720"],
		]);
	});
	it("does not attempt to resize other applications on Wayland", async () => {
		setPlatform("linux");
		vi.stubEnv("XDG_SESSION_TYPE", "wayland");
		await expect(resizeCaptureWindow(source, size)).rejects.toThrow("Wayland");
		expect(mocks.exec).not.toHaveBeenCalled();
	});
});
