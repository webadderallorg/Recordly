import { expect, it, vi } from "vitest";
const exec = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: exec }));
vi.mock("node:util", () => ({ promisify: () => exec }));
vi.mock("../paths/binaries", () => ({ ensureNativeWindowListBinary: vi.fn() }));
vi.mock("../state", () => ({}));
vi.mock("../utils", () => ({
	parseWindowId: (id: string) =>
		id.startsWith("window:") ? Number(id.split(":")[1]) || null : null,
}));
vi.mock("../windowsWindowControl", () => ({ resolveWindowsWindowBounds: vi.fn() }));
import { resolveLinuxWindowBounds } from "./bounds";

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
