import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ windows: vi.fn(), show: vi.fn(), hide: vi.fn() }));
vi.mock("../../windows", () => ({
	showRecordingFocus: mocks.show,
	hideRecordingFocus: mocks.hide,
}));
vi.mock("../windowsWindowControl", () => ({ resolveWindowsWindowBounds: mocks.windows }));
vi.mock("../cursor/bounds", () => ({
	resolveLinuxWindowBounds: vi.fn(),
	resolveMacWindowBounds: vi.fn(),
}));
vi.mock("../state", () => ({ isCursorCaptureActive: true, selectedWindowBounds: null }));
vi.mock("./ffmpeg", () => ({ getDisplayBoundsForSource: vi.fn() }));

import { recordingFocus } from "./focus";

const platform = process.platform;
afterEach(() => {
	recordingFocus.stop();
	Object.defineProperty(process, "platform", { value: platform });
	vi.resetAllMocks();
});

it("keeps a Windows surround visible during recording when the telemetry bounds cache is empty", async () => {
	Object.defineProperty(process, "platform", { value: "win32" });
	const source = { id: "window:101:0", name: "Test window" };
	const bounds = { x: 100, y: 80, width: 800, height: 600 };
	mocks.windows.mockResolvedValue(bounds);
	await recordingFocus.start(source);
	expect(mocks.windows).toHaveBeenCalledWith(source);
	expect(mocks.show).toHaveBeenCalledWith(bounds);
});
