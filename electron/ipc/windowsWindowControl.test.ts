import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), geometry: vi.fn() }));
vi.mock("./windowsWindowGeometry", () => ({ readWindowsWindowGeometry: mocks.geometry }));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
vi.mock("./utils", () => ({
	parseWindowId: (id: string) => Number(id.split(":")[1]),
	getScreen: () => ({}),
}));

import { resolveWindowsWindowBounds } from "./windowsWindowControl";

afterEach(() => vi.resetAllMocks());
beforeEach(() => mocks.geometry.mockRejectedValue(new Error("older helper")));

it("uses the native helper for HWND bounds and accepts a closed window without falling back", async () => {
	const source = { id: "window:103:0", name: "Test window" };
	const bounds = { x: 100, y: 80, width: 800, height: 600 };
	mocks.geometry.mockResolvedValueOnce(bounds).mockResolvedValueOnce(null);
	expect(await resolveWindowsWindowBounds(source)).toEqual(bounds);
	expect(await resolveWindowsWindowBounds(source)).toBeNull();
	expect(mocks.geometry).toHaveBeenCalledWith(["--window-bounds", "103"]);
	expect(mocks.exec).not.toHaveBeenCalled();
});

it("shares slow HWND lookups between preview and telemetry, then refreshes moved windows", async () => {
	const source = { id: "window:101:0", name: "Test window" };
	const bounds = { x: 100, y: 80, width: 800, height: 600 };
	let finish!: (result: { stdout: string }) => void;
	mocks.exec.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const preview = resolveWindowsWindowBounds(source);
	const telemetry = resolveWindowsWindowBounds(source);
	await Promise.resolve();
	expect(mocks.exec).toHaveBeenCalledOnce();
	finish({ stdout: JSON.stringify(bounds) });
	expect(await preview).toEqual(bounds);
	expect(await telemetry).toEqual(bounds);
	mocks.exec.mockResolvedValueOnce({ stdout: JSON.stringify({ ...bounds, x: 200 }) });
	expect(await resolveWindowsWindowBounds(source)).toEqual({ ...bounds, x: 200 });
	expect(mocks.exec).toHaveBeenCalledTimes(2);
});

it("retries after a failed lookup rather than keeping a failed query cached", async () => {
	const source = { id: "window:102:0", name: "Test window" };
	mocks.exec.mockRejectedValueOnce(new Error("timeout"));
	expect(await resolveWindowsWindowBounds(source)).toBeNull();
	const bounds = { x: 100, y: 80, width: 800, height: 600 };
	mocks.exec.mockResolvedValueOnce({ stdout: JSON.stringify(bounds) });
	expect(await resolveWindowsWindowBounds(source)).toEqual(bounds);
});
