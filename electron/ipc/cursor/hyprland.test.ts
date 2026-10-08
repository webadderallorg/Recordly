import type fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		getPath: vi.fn(() => "/tmp"),
	},
}));

import { activeCursorSamples, linuxCursorScreenPoint, setActiveCursorSamples } from "../state";
import {
	decodeEvdevButtonChunk,
	getHyprlandRequestSocketPath,
	hasMouseButtonCapability,
	isHyprlandCursorProviderActive,
	parseHyprlandCursorPosition,
	resolveHyprlandCursorCaptureEpochMs,
	startEvdevButtonCapture,
	startHyprlandCursorProvider,
	stopHyprlandCursorProvider,
} from "./hyprland";

const waylandEnv = {
	XDG_RUNTIME_DIR: "/run/user/1000",
	XDG_SESSION_TYPE: "wayland",
	WAYLAND_DISPLAY: "wayland-1",
	HYPRLAND_INSTANCE_SIGNATURE: "abc123_456",
};

describe("Hyprland cursor provider", () => {
	beforeEach(() => {
		stopHyprlandCursorProvider();
		vi.useRealTimers();
	});

	afterEach(() => {
		stopHyprlandCursorProvider();
		vi.useRealTimers();
	});

	it("resolves the Hyprland request socket on native Wayland", async () => {
		expect(getHyprlandRequestSocketPath(waylandEnv, "linux")).toBe(
			"/run/user/1000/hypr/abc123_456/.socket.sock",
		);
	});

	it("does not start until the cursor socket returns an initial point", async () => {
		await expect(
			startHyprlandCursorProvider({
				env: waylandEnv,
				platform: "linux",
				query: vi.fn().mockResolvedValue(null),
			}),
		).resolves.toBe(false);
		expect(isHyprlandCursorProviderActive()).toBe(false);
	});

	it("does not activate for X11 or unsafe instance signatures", () => {
		expect(
			getHyprlandRequestSocketPath({ ...waylandEnv, OZONE_PLATFORM: "x11" }, "linux"),
		).toBeNull();
		expect(
			getHyprlandRequestSocketPath(
				{ ...waylandEnv, OZONE_PLATFORM: "auto", ELECTRON_OZONE_PLATFORM_HINT: "x11" },
				"linux",
			),
		).toBeNull();
		expect(
			getHyprlandRequestSocketPath(
				{ ...waylandEnv, HYPRLAND_INSTANCE_SIGNATURE: "../../other" },
				"linux",
			),
		).toBeNull();
		expect(getHyprlandRequestSocketPath(waylandEnv, "darwin")).toBeNull();
	});

	it("parses finite logical cursor coordinates", () => {
		expect(parseHyprlandCursorPosition('{"x":-120.5,"y":480}')).toEqual({
			x: -120.5,
			y: 480,
		});
		expect(parseHyprlandCursorPosition('{"x":"12","y":4}')).toBeNull();
		expect(parseHyprlandCursorPosition("not json")).toBeNull();
	});

	it("starts cursor telemetry at the media timeline boundary", () => {
		expect(resolveHyprlandCursorCaptureEpochMs(10_000)).toBe(10_000);
	});

	it("polls serially and stops without publishing a late response", async () => {
		vi.useFakeTimers();
		let resolveQuery!: (point: { x: number; y: number }) => void;
		const query = vi.fn(
			() =>
				new Promise<{ x: number; y: number }>((resolve) => {
					resolveQuery = resolve;
				}),
		);
		const onPoint = vi.fn();

		const started = startHyprlandCursorProvider({
			env: waylandEnv,
			platform: "linux",
			query,
			onPoint,
			pollIntervalMs: 10,
		});
		expect(query).toHaveBeenCalledOnce();
		expect(isHyprlandCursorProviderActive()).toBe(false);

		stopHyprlandCursorProvider();
		expect(isHyprlandCursorProviderActive()).toBe(false);
		resolveQuery({ x: 10, y: 20 });
		await vi.runAllTimersAsync();

		await expect(started).resolves.toBe(false);
		expect(onPoint).not.toHaveBeenCalled();
		expect(query).toHaveBeenCalledOnce();
	});

	it("publishes the initial compositor response before reporting success", async () => {
		const onPoint = vi.fn();

		await expect(
			startHyprlandCursorProvider({
				env: waylandEnv,
				platform: "linux",
				query: vi.fn().mockResolvedValue({ x: 12, y: 34 }),
				onPoint,
				pollIntervalMs: 60_000,
			}),
		).resolves.toBe(true);

		expect(onPoint).toHaveBeenCalledWith({ x: 12, y: 34 });
		expect(isHyprlandCursorProviderActive()).toBe(true);
	});

	it("only refreshes provider state and clears it when polling fails", async () => {
		vi.useFakeTimers();
		setActiveCursorSamples([]);
		const query = vi.fn().mockResolvedValueOnce({ x: 12, y: 34 }).mockResolvedValueOnce(null);

		await startHyprlandCursorProvider({
			env: waylandEnv,
			platform: "linux",
			query,
			pollIntervalMs: 10,
		});

		expect(linuxCursorScreenPoint).toMatchObject({
			x: 12,
			y: 34,
			coordinateSpace: "logical",
			source: "hyprland",
		});
		expect(activeCursorSamples).toEqual([]);

		await vi.advanceTimersByTimeAsync(10);
		expect(linuxCursorScreenPoint).toBeNull();
		expect(isHyprlandCursorProviderActive()).toBe(false);
	});

	it("keeps a successful provider healthy while the next query is pending", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		let resolvePendingQuery!: (point: { x: number; y: number } | null) => void;
		const query = vi
			.fn()
			.mockResolvedValueOnce({ x: 12, y: 34 })
			.mockImplementationOnce(
				() =>
					new Promise<{ x: number; y: number } | null>((resolve) => {
						resolvePendingQuery = resolve;
					}),
			);

		await startHyprlandCursorProvider({
			env: waylandEnv,
			platform: "linux",
			query,
			pollIntervalMs: 33,
		});
		expect(isHyprlandCursorProviderActive()).toBe(true);

		await vi.advanceTimersByTimeAsync(33);
		expect(query).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(167);
		expect(isHyprlandCursorProviderActive()).toBe(true);

		resolvePendingQuery(null);
		await vi.advanceTimersByTimeAsync(0);
		expect(isHyprlandCursorProviderActive()).toBe(false);
	});
});

describe("Hyprland mouse buttons", () => {
	it("recognizes a left button bit in a 64-bit capability word", () => {
		expect(hasMouseButtonCapability("10000 0 0 0 0")).toBe(true);
		expect(hasMouseButtonCapability("ffffffffffffffff 0 0 0 0")).toBe(true);
		expect(hasMouseButtonCapability("0 0 0 0 0")).toBe(false);
	});

	it("keeps partial input events until the next device read", () => {
		const press = Buffer.alloc(24);
		press.writeUInt16LE(1, 16);
		press.writeUInt16LE(0x110, 18);
		press.writeInt32LE(1, 20);
		const release = Buffer.from(press);
		release.writeInt32LE(0, 20);

		const first = decodeEvdevButtonChunk(Buffer.alloc(0), press.subarray(0, 11));
		expect(first.events).toEqual([]);
		const second = decodeEvdevButtonChunk(
			first.pending,
			Buffer.concat([press.subarray(11), release]),
		);
		expect(second.events).toEqual([
			{ button: 1, pressed: true },
			{ button: 1, pressed: false },
		]);
		expect(second.pending).toHaveLength(0);
	});

	it("does not overlap reads when a device callback is delayed", async () => {
		vi.useFakeTimers();
		const onMouseDown = vi.fn();
		const onMouseUp = vi.fn();
		const read = vi.fn();
		const close = vi.fn((_fd, callback) => callback(null));
		const fsApi = {
			open: vi.fn((_path, _flags, callback) => callback(null, 42)),
			read,
			close,
		} as unknown as typeof fs;
		const stop = startEvdevButtonCapture(
			{ onMouseDown, onMouseUp },
			{
				devicePaths: ["/dev/input/event-test"],
				fsApi,
				platform: "linux",
				env: waylandEnv,
				pollIntervalMs: 10,
			},
		);
		try {
			await vi.advanceTimersByTimeAsync(35);
			expect(read).toHaveBeenCalledTimes(1);
			const buffer = read.mock.calls[0][1] as Buffer;
			buffer.writeUInt16LE(1, 16);
			buffer.writeUInt16LE(0x110, 18);
			buffer.writeInt32LE(1, 20);
			read.mock.calls[0][5](null, 24, buffer);
			expect(onMouseDown).toHaveBeenCalledWith(1);
			await vi.advanceTimersByTimeAsync(10);
			expect(read).toHaveBeenCalledTimes(2);
		} finally {
			stop();
			vi.useRealTimers();
		}
		expect(close).toHaveBeenCalledWith(42, expect.any(Function));
	});

	it("drains a full evdev buffer before the next polling interval", async () => {
		vi.useFakeTimers();
		const onMouseDown = vi.fn();
		const onMouseUp = vi.fn();
		const onDeviceOpened = vi.fn();
		const read = vi.fn((_fd, buffer: Buffer, _offset, length, _position, callback) => {
			if (read.mock.calls.length === 1) {
				expect(length).toBeGreaterThan(256);
				buffer.fill(0);
				buffer.writeUInt16LE(1, 16);
				buffer.writeUInt16LE(0x110, 18);
				buffer.writeInt32LE(1, 20);
				callback(null, length, buffer);
			} else {
				buffer.fill(0);
				buffer.writeUInt16LE(1, 16);
				buffer.writeUInt16LE(0x110, 18);
				callback(null, 24, buffer);
			}
		});
		const fsApi = {
			open: vi.fn((_path, _flags, callback) => callback(null, 42)),
			read,
			close: vi.fn((_fd, callback) => callback(null)),
		} as unknown as typeof fs;
		const stop = startEvdevButtonCapture(
			{ onMouseDown, onMouseUp },
			{
				devicePaths: ["/dev/input/event-test"],
				fsApi,
				platform: "linux",
				env: waylandEnv,
				pollIntervalMs: 10,
				onDeviceOpened,
			},
		);
		try {
			await vi.advanceTimersByTimeAsync(10);
			expect(onDeviceOpened).toHaveBeenCalledOnce();
			expect(read).toHaveBeenCalledTimes(2);
			expect(onMouseDown).toHaveBeenCalledOnce();
			expect(onMouseUp).toHaveBeenCalledOnce();
		} finally {
			stop();
			vi.useRealTimers();
		}
	});
});
