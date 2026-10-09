import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/paths/binaries", () => ({
	AGENT_INPUT_MISSING: "Recordly's mouse and keyboard helper is missing for this platform.",
	ensureAgentInputBinary: async () => "/bin/helper",
}));

import { createAgentInput, HELPER_STOPPED, HelperUnavailableError } from "./agentInput";

async function flush() {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

function fakeProcess(exitsOnEof = true) {
	const stdout = new PassThrough();
	const written: Array<Record<string, unknown>> = [];
	const stdin = {
		write: (chunk: string) => written.push(JSON.parse(chunk)),
		end: vi.fn(() => {
			if (exitsOnEof) proc.emit("exit");
		}),
		on: () => undefined,
	};
	const proc = Object.assign(new EventEmitter(), {
		stdin,
		stdout,
		kill: vi.fn(() => proc.emit("exit")),
	});
	const reply = (message: unknown) => stdout.write(`${JSON.stringify(message)}\n`);
	return { proc, written, reply };
}

function setup(overrides: Parameters<typeof createAgentInput>[0] = {}, exitsOnEof = true) {
	const helpers: ReturnType<typeof fakeProcess>[] = [];
	const spawn = vi.fn(() => {
		const helper = fakeProcess(exitsOnEof);
		helpers.push(helper);
		return helper.proc;
	});
	const input = createAgentInput({
		resolveBinary: async () => "/bin/helper",
		spawn,
		timeoutMs: 1000,
		...overrides,
	});
	return { input, helpers, spawn };
}

afterEach(() => vi.useRealTimers());

describe("agent input helper client", () => {
	it("spawns lazily once and matches responses to requests by id", async () => {
		const { input, helpers, spawn } = setup();
		expect(spawn).not.toHaveBeenCalled();
		const cursor = input.request({ cmd: "cursor" });
		const preflight = input.request({ cmd: "preflight" });
		await flush();
		expect(spawn).toHaveBeenCalledOnce();
		const [first, second] = helpers[0].written;
		expect(first).toEqual({ cmd: "cursor", id: first.id });
		expect(second.id).not.toBe(first.id);
		helpers[0].reply({ id: second.id, ok: true, postEvents: true, accessibility: false });
		helpers[0].reply({ id: 999, ok: true, x: 0, y: 0 });
		helpers[0].reply({ id: first.id, ok: true, x: 3, y: 4 });
		await expect(cursor).resolves.toEqual({ x: 3, y: 4 });
		await expect(preflight).resolves.toEqual({ postEvents: true, accessibility: false });
	});

	it("rejects with the helper's error text", async () => {
		const { input, helpers } = setup();
		const click = input.request({
			cmd: "click",
			x: 1,
			y: 1,
			ms: 0,
			button: "left",
			count: 1,
			modifiers: [],
		});
		await flush();
		helpers[0].reply({ id: helpers[0].written[0].id, ok: false, error: "user-input" });
		await expect(click).rejects.toThrow("user-input");
	});

	it("times out after the default budget, or the action time plus 5 s, then restarts", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { input, helpers, spawn } = setup({}, false);
		const frontmost = input.request({ cmd: "frontmost_window" });
		const frontmostOutcome = expect(frontmost).rejects.toThrow(
			/did not answer "frontmost_window"/,
		);
		await flush();
		await vi.advanceTimersByTimeAsync(1000);
		await frontmostOutcome;
		expect(helpers[0].proc.stdin.end).toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(500);
		expect(helpers[0].proc.kill).toHaveBeenCalled();

		const move = input.request({ cmd: "move", x: 1, y: 1, ms: 2000 });
		let settled = false;
		const moveOutcome = expect(
			move.finally(() => {
				settled = true;
			}),
		).rejects.toThrow(/did not answer "move"/);
		await flush();
		expect(spawn).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(6999);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await moveOutcome;
	});

	it("rejects pending requests when the helper exits and starts a new one next time", async () => {
		const { input, helpers, spawn } = setup();
		const raise = input.request({
			cmd: "raise",
			pid: 1,
			windowId: 2,
			frame: { x: 0, y: 0, width: 10, height: 10 },
		});
		await flush();
		helpers[0].reply({ event: "user-input", kind: "key", escape: false });
		await flush();
		helpers[0].proc.emit("exit");
		await expect(raise).rejects.toThrow(HELPER_STOPPED);
		await expect(raise).rejects.not.toBeInstanceOf(HelperUnavailableError);
		const next = input.request({ cmd: "arm" });
		await flush();
		expect(spawn).toHaveBeenCalledTimes(2);
		helpers[1].reply({ id: helpers[1].written[0].id, ok: true });
		await expect(next).resolves.toEqual({});
	});

	it("reports the helper as unavailable when it is missing, fails to spawn, or exits before answering", async () => {
		const missing = setup({
			resolveBinary: async () => {
				throw new Error("ENOENT");
			},
		});
		await expect(missing.input.request({ cmd: "preflight" })).rejects.toBeInstanceOf(
			HelperUnavailableError,
		);

		const notBundled = setup({
			resolveBinary: async () => {
				throw new Error(
					"Recordly's mouse and keyboard helper is missing for this platform. (/bin/x)",
				);
			},
		});
		await expect(notBundled.input.request({ cmd: "preflight" })).rejects.toThrow(
			"Recordly's mouse and keyboard helper is missing for this platform. (/bin/x)",
		);

		const unspawnable = setup({
			spawn: () => {
				throw new Error("EACCES");
			},
		});
		await expect(unspawnable.input.request({ cmd: "preflight" })).rejects.toBeInstanceOf(
			HelperUnavailableError,
		);

		const silent = setup();
		const preflight = silent.input.request({ cmd: "preflight" });
		await flush();
		silent.helpers[0].proc.emit("error");
		await expect(preflight).rejects.toBeInstanceOf(HelperUnavailableError);
	});

	it("stops a helper that is still starting once it has started", async () => {
		let resolveBinary!: (path: string) => void;
		const { input, helpers } = setup({
			resolveBinary: () =>
				new Promise((resolve) => {
					resolveBinary = resolve;
				}),
		});
		const preflight = input.request({ cmd: "preflight" });
		await flush();
		input.stop();
		resolveBinary("/bin/helper");
		await expect(preflight).rejects.toThrow(HELPER_STOPPED);
		expect(helpers[0].proc.stdin.end).toHaveBeenCalledOnce();
	});

	it("emits user-input events and stop() closes the helper's input, killing it only if it lingers", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { input, helpers } = setup({}, false);
		const onInput = vi.fn();
		input.events.on("user-input", onInput);
		const disarm = input.request({ cmd: "disarm" });
		await flush();
		helpers[0].reply({ event: "user-input", kind: "move", escape: false });
		await flush();
		expect(onInput).toHaveBeenCalledWith({ event: "user-input", kind: "move", escape: false });
		input.stop();
		await expect(disarm).rejects.toThrow(HELPER_STOPPED);
		expect(helpers[0].proc.stdin.end).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(499);
		expect(helpers[0].proc.kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(helpers[0].proc.kill).toHaveBeenCalledOnce();
	});

	it("does not kill a helper that exits on end of input", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { input, helpers } = setup();
		const cursor = input.request({ cmd: "cursor" });
		await flush();
		input.stop();
		await expect(cursor).rejects.toThrow(HELPER_STOPPED);
		await vi.advanceTimersByTimeAsync(1000);
		expect(helpers[0].proc.kill).not.toHaveBeenCalled();
	});
});
