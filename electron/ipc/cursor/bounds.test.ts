import { afterEach, expect, it, vi } from "vitest";

const exec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: exec }));
vi.mock("node:util", () => ({ promisify: () => exec }));
vi.mock("../paths/binaries", () => ({ ensureNativeWindowListBinary: vi.fn() }));
vi.mock("../utils", () => ({
	parseWindowId: (id: string) =>
		id.startsWith("window:") ? Number(id.split(":")[1]) || null : null,
}));
vi.mock("../windowsWindowControl", () => ({ resolveWindowsWindowBounds: vi.fn() }));

import { selectedWindowBounds, setCachedNativeMacWindowSources, setSelectedSource } from "../state";
import {
	getNativeMacWindowSources,
	resolveLinuxWindowBounds,
	startWindowBoundsCapture,
	stopWindowBoundsCapture,
} from "./bounds";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const macWindow = { id: "window:101:0", name: "Document", x: 10, y: 20, width: 640, height: 480 };
const windowList = { stdout: JSON.stringify([macWindow]) };

afterEach(() => {
	stopWindowBoundsCapture();
	setCachedNativeMacWindowSources(null);
	setSelectedSource(null);
	Object.defineProperty(process, "platform", platform);
	vi.useRealTimers();
});

it("shares a pending macOS window list and allows a fresh lookup after it settles", async () => {
	Object.defineProperty(process, "platform", { value: "darwin" });
	let finish!: (output: typeof windowList) => void;
	const pending = new Promise<typeof windowList>((resolve) => {
		finish = resolve;
	});
	exec.mockReset().mockReturnValueOnce(pending).mockResolvedValue(windowList);
	const first = getNativeMacWindowSources();
	const second = getNativeMacWindowSources({ maxAgeMs: 250 });
	await Promise.resolve();
	const callsWhilePending = exec.mock.calls.length;
	finish(windowList);

	expect(await Promise.all([first, second])).toEqual([[macWindow], [macWindow]]);
	expect(callsWhilePending).toBe(1);
	await getNativeMacWindowSources({ maxAgeMs: 0 });
	expect(exec).toHaveBeenCalledTimes(2);
});

it("limits bounds polling while a lookup stalls and ignores the result after Stop", async () => {
	Object.defineProperty(process, "platform", { value: "darwin" });
	vi.useFakeTimers();
	setSelectedSource(macWindow);
	let finish!: (output: typeof windowList) => void;
	const pending = new Promise<typeof windowList>((resolve) => {
		finish = resolve;
	});
	exec.mockReset().mockReturnValue(pending);

	startWindowBoundsCapture();
	await vi.advanceTimersByTimeAsync(1_250);
	const callsWhilePending = exec.mock.calls.length;
	stopWindowBoundsCapture();
	finish(windowList);
	await vi.advanceTimersByTimeAsync(0);

	expect(selectedWindowBounds).toBeNull();
	expect(callsWhilePending).toBe(1);
});

it("does not track a different same-title X11 window after the selected window disappears", async () => {
	exec.mockReset().mockRejectedValue(new Error("No such window"));
	expect(await resolveLinuxWindowBounds({ id: "window:101:0", name: "Document" })).toBeNull();
	expect(exec).toHaveBeenCalledExactlyOnceWith("xwininfo", ["-id", "101"], { timeout: 1500 });
});
it("returns live X11 bounds by ID", async () => {
	exec.mockReset().mockResolvedValue({
		stdout: "Absolute upper-left X: -100\nAbsolute upper-left Y: 50\nWidth: 640\nHeight: 480",
	});
	expect(await resolveLinuxWindowBounds({ id: "window:101:0", name: "Document" })).toEqual({
		x: -100,
		y: 50,
		width: 640,
		height: 480,
	});
});
