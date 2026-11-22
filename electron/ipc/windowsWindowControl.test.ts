import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), geometry: vi.fn(), toDip: vi.fn() }));
vi.mock("./windowsWindowGeometry", () => ({ readWindowsWindowGeometry: mocks.geometry }));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
vi.mock("./utils", () => ({
	parseWindowId: (id: string) => Number(id.split(":")[1]),
	getScreen: () => ({ screenToDipPoint: mocks.toDip }),
}));

import { resolveWindowsWindowBounds } from "./windowsWindowControl";

afterEach(() => vi.resetAllMocks());
beforeEach(() => {
	mocks.geometry.mockRejectedValue(new Error("older helper"));
	mocks.toDip.mockImplementation((point) => point);
});

it("uses the native helper for HWND bounds and accepts a closed window without falling back", async () => {
	const source = { id: "window:103:0", name: "Test window" };
	const bounds = { x: 100, y: 80, width: 800, height: 600 };
	mocks.geometry.mockResolvedValueOnce(bounds).mockResolvedValueOnce(null);
	expect(await resolveWindowsWindowBounds(source)).toMatchObject(bounds);
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
	expect(await preview).toMatchObject(bounds);
	expect(await telemetry).toMatchObject(bounds);
	mocks.exec.mockResolvedValueOnce({ stdout: JSON.stringify({ ...bounds, x: 200 }) });
	expect(await resolveWindowsWindowBounds(source)).toMatchObject({ ...bounds, x: 200 });
	expect(mocks.exec).toHaveBeenCalledTimes(2);
});

it("retries after a failed lookup rather than keeping a failed query cached", async () => {
	const source = { id: "window:102:0", name: "Test window" };
	mocks.exec.mockRejectedValueOnce(new Error("timeout"));
	expect(await resolveWindowsWindowBounds(source)).toBeNull();
	const bounds = { x: 100, y: 80, width: 800, height: 600 };
	mocks.exec.mockResolvedValueOnce({ stdout: JSON.stringify(bounds) });
	expect(await resolveWindowsWindowBounds(source)).toMatchObject(bounds);
});

it("retains the physical origin when converting to desktop coordinates", async () => {
	const source = { id: "window:103:0", name: "Test window" };
	mocks.geometry.mockResolvedValueOnce({ x: 140, y: 100, width: 640, height: 500 });
	mocks.toDip.mockImplementation(({ x, y }) => ({ x: x / 1.25, y: y / 1.25 }));
	expect(await resolveWindowsWindowBounds(source)).toEqual({
		x: 112,
		y: 80,
		width: 512,
		height: 400,
		physicalOrigin: { x: 140, y: 100 },
	});
});
