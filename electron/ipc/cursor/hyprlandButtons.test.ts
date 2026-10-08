import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("node:net", () => ({ default: { createConnection: connection.create } }));
vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

import {
	buildHyprlandButtonCommand,
	requestHyprlandCommand,
	startHyprlandButtonCapture,
} from "./hyprlandButtons";

class Socket extends EventEmitter {
	destroyed = false;
	setEncoding = vi.fn();
	setTimeout = vi.fn();
	end = vi.fn();
	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		this.emit("close");
	}
}

const env = {
	XDG_RUNTIME_DIR: "/tmp/recordly-fixture",
	XDG_SESSION_TYPE: "wayland",
	HYPRLAND_INSTANCE_SIGNATURE: "synthetic",
};

async function flush() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("Hyprland button capture", () => {
	let socket: Socket;
	let request: ReturnType<typeof vi.fn>;
	let handlers: { onMouseDown: ReturnType<typeof vi.fn>; onMouseUp: ReturnType<typeof vi.fn> };
	const stops: (() => void)[] = [];
	const options = () => ({ env, platform: "linux" as const, request });
	const token = () => /s.token = "(recordly-[a-z0-9-]+)"/.exec(request.mock.calls[0][1])?.[1];
	const start = async () => {
		const capture = await startHyprlandButtonCapture(handlers, options());
		stops.push(capture.stop);
		return capture;
	};
	beforeEach(() => {
		vi.useFakeTimers();
		connection.create.mockReset();
		socket = new Socket();
		request = vi.fn().mockResolvedValue(true);
		handlers = { onMouseDown: vi.fn(), onMouseUp: vi.fn() };
		connection.create.mockImplementation(() => {
			Promise.resolve().then(() => socket.emit("connect"));
			return socket;
		});
	});
	afterEach(async () => {
		for (const stop of stops.splice(0)) stop();
		await flush();
		vi.useRealTimers();
	});

	it("subscribes before registration and decodes only this recording's fragmented events", async () => {
		expect((await start()).available).toBe(true);
		expect(connection.create).toHaveBeenCalledWith(
			"/tmp/recordly-fixture/hypr/synthetic/.socket2.sock",
		);
		socket.emit("data", `custom>>foreign-down-1\ncustom>>${token()}-do`);
		expect(handlers.onMouseDown).not.toHaveBeenCalled();
		socket.emit(
			"data",
			`wn-1\ncustom>>${token()}-up-1\ncustom>>${token()}-down-2\ncustom>>${token()}-down-3\ncustom>>${token()}-down-4\n`,
		);
		expect(handlers.onMouseDown.mock.calls).toEqual([[1], [2], [3]]);
		expect(handlers.onMouseUp).toHaveBeenCalledOnce();
	});

	it("separates the eval verb from Lua with a space for Hyprland IPC", () => {
		for (const action of ["start", "renew", "stop"] as const) {
			expect(buildHyprlandButtonCommand(action, "recordly-fixture")).toMatch(/^eval /);
		}
		expect(() => buildHyprlandButtonCommand("start", 'unsafe";hl.unbind()')).toThrow();
	});

	it("does not emit during startup, and cleans up once on stop", async () => {
		let registered!: (ok: boolean) => void;
		request.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					registered = resolve;
				}),
		);
		const starting = start();
		await flush();
		socket.emit("data", `custom>>${token()}-down-1\n`);
		expect(handlers.onMouseDown).not.toHaveBeenCalled();
		registered(true);
		const capture = await starting;
		capture.stop();
		capture.stop();
		socket.emit("data", `custom>>${token()}-down-1\n`);
		await flush();
		expect(handlers.onMouseDown).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[1][1]).toContain("s.stop()");
		expect(socket.destroyed).toBe(true);
	});

	it("aborts pending registration and disables its binds after the response", async () => {
		let registered!: (ok: boolean) => void;
		request.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					registered = resolve;
				}),
		);
		const controller = new AbortController();
		const starting = startHyprlandButtonCapture(handlers, {
			...options(),
			signal: controller.signal,
		});
		await flush();
		controller.abort();
		registered(true);
		expect((await starting).available).toBe(false);
		await flush();
		expect(request).toHaveBeenCalledTimes(2);
		expect(socket.destroyed).toBe(true);
	});

	it("serializes old cleanup before restart and gives the new capture a distinct token", async () => {
		const first = await start();
		const oldToken = token();
		first.stop();
		socket = new Socket();
		expect((await start()).available).toBe(true);
		expect(request.mock.calls[1][1]).toContain(`s.token == "${oldToken}" then s.stop()`);
		const newToken = /s.token = "(recordly-[a-z0-9-]+)"/.exec(request.mock.calls[2][1])?.[1];
		expect(newToken).not.toBe(oldToken);
		socket.emit("data", `custom>>${oldToken}-down-1\ncustom>>${newToken}-down-1\n`);
		expect(handlers.onMouseDown).toHaveBeenCalledOnce();
	});

	it("renews the lease serially and falls back once on failure", async () => {
		const onUnavailable = vi.fn();
		const capture = await startHyprlandButtonCapture(handlers, { ...options(), onUnavailable });
		stops.push(capture.stop);
		request.mockResolvedValueOnce(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(request.mock.calls[1][1]).toContain("capture lease lost");
		expect(onUnavailable).toHaveBeenCalledOnce();
		socket.emit("error", new Error("closed"));
		expect(onUnavailable).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reinstalls after reload while suppressing events during registration", async () => {
		await start();
		let registered!: (ok: boolean) => void;
		request.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					registered = resolve;
				}),
		);
		socket.emit("data", `configreloaded>>\ncustom>>${token()}-down-1\n`);
		await flush();
		expect(handlers.onMouseDown).not.toHaveBeenCalled();
		registered(true);
		await flush();
		expect(request.mock.calls[1][1]).toContain('schema = "recordly-1"');
		socket.emit("data", `custom>>${token()}-down-1\n`);
		expect(handlers.onMouseDown).toHaveBeenCalledOnce();
	});

	it("ignores a stale failed renewal when reload is already reinstalling", async () => {
		const onUnavailable = vi.fn();
		const capture = await startHyprlandButtonCapture(handlers, { ...options(), onUnavailable });
		stops.push(capture.stop);
		let renewed!: (ok: boolean) => void;
		request.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					renewed = resolve;
				}),
		);
		await vi.advanceTimersByTimeAsync(1000);
		socket.emit("data", "configreloaded>>\n");
		renewed(false);
		await flush();
		expect(onUnavailable).not.toHaveBeenCalled();
		expect(socket.destroyed).toBe(false);
		socket.emit("data", `custom>>${token()}-down-1\n`);
		expect(handlers.onMouseDown).toHaveBeenCalledOnce();
	});

	it("suppresses subsequent lines when a handler stops capture within a chunk", async () => {
		const capture = await start();
		handlers.onMouseDown.mockImplementationOnce(capture.stop);
		socket.emit("data", `custom>>${token()}-down-1\ncustom>>${token()}-down-2\n`);
		expect(handlers.onMouseDown).toHaveBeenCalledOnce();
	});

	it("cancels queued reloads after stop without extending the compositor lease", async () => {
		const capture = await start();
		let registered!: (ok: boolean) => void;
		request.mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					registered = resolve;
				}),
		);
		socket.emit("data", "configreloaded>>\n");
		await flush();
		socket.emit("data", "configreloaded>>\nconfigreloaded>>\nconfigreloaded>>\n");
		capture.stop();
		registered(true);
		await flush();
		expect(request).toHaveBeenCalledTimes(3);
		expect(request.mock.calls[2][1]).toContain("s.stop()");
		expect(socket.destroyed).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects unavailable capabilities without attempting legacy binds", async () => {
		request.mockResolvedValue(false);
		expect((await start()).available).toBe(false);
		expect(request.mock.calls.every(([, command]) => !command.includes("keyword"))).toBe(true);
		expect(socket.destroyed).toBe(true);
	});

	it.each([
		false,
		true,
	])("discards oversized foreign lines without losing capture (terminated=%s)", async (terminated) => {
		const onUnavailable = vi.fn();
		const capture = await startHyprlandButtonCapture(handlers, { ...options(), onUnavailable });
		stops.push(capture.stop);
		socket.emit("data", "activewindow>>" + "x".repeat(4097) + (terminated ? "\n" : ""));
		if (!terminated) {
			socket.emit("data", `custom>>${token()}-down-2`);
			socket.emit("data", "\n");
		}
		socket.emit("data", `custom>>${token()}-down-1\n`);
		expect(socket.destroyed).toBe(false);
		expect(onUnavailable).not.toHaveBeenCalled();
		expect(handlers.onMouseDown.mock.calls).toEqual([[1]]);
	});

	it("bounds UTF-8 byte length and discards through the delimiter before decoding later events", async () => {
		await start();
		socket.emit("data", "windowtitlev2>>" + "ü".repeat(2048));
		socket.emit(
			"data",
			"ignored fragment\n" + "x".repeat(5000) + `\ncustom>>${token()}-down-3\n`,
		);
		expect(socket.destroyed).toBe(false);
		expect(handlers.onMouseDown.mock.calls).toEqual([[3]]);
	});

	it("times out event connection without registering binds", async () => {
		connection.create.mockReturnValue(socket);
		const starting = start();
		await vi.advanceTimersByTimeAsync(250);
		expect((await starting).available).toBe(false);
		await flush();
		expect(request.mock.calls.every(([, command]) => !command.includes("hl.bind"))).toBe(true);
	});

	it("does not touch X11, non-Linux, unsafe signatures or already aborted captures", async () => {
		for (const extra of [
			{ platform: "darwin" as const },
			{ env: { ...env, XDG_SESSION_TYPE: "x11" } },
			{ env: { ...env, HYPRLAND_INSTANCE_SIGNATURE: "../unsafe" } },
			{ signal: AbortSignal.abort() },
		]) {
			expect(
				(await startHyprlandButtonCapture(handlers, { ...options(), ...extra })).available,
			).toBe(false);
		}
		expect(connection.create).not.toHaveBeenCalled();
	});

	it("accepts only a complete successful IPC response and bounds failures", async () => {
		const result = requestHyprlandCommand("/tmp/synthetic", "eval test");
		await flush();
		expect(socket.end).toHaveBeenCalledWith("eval test");
		socket.emit("data", "o");
		socket.emit("data", "k\n");
		socket.emit("end");
		expect(await result).toBe(true);
		for (const response of ["error: unsupported", "ok\nerror", "x".repeat(4097)]) {
			socket = new Socket();
			const failed = requestHyprlandCommand("/tmp/synthetic", "eval test");
			socket.emit("data", response);
			socket.emit("end");
			expect(await failed).toBe(false);
		}
		socket = new Socket();
		const timedOut = requestHyprlandCommand("/tmp/synthetic", "eval test");
		socket.setTimeout.mock.calls[0][1]();
		expect(await timedOut).toBe(false);
	});
});
