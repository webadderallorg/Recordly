import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.fn<(path: string, mode: number) => Promise<void>>();
const spawnMock = vi.fn();

vi.mock("node:fs/promises", () => ({
	default: { access: (path: string, mode: number) => accessMock(path, mode) },
}));

vi.mock("node:child_process", () => ({
	spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("electron", () => ({
	BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("../paths/binaries", () => ({
	getPrebundledNativeHelperPath: () => "/bundled/cursor-monitor",
	getCursorMonitorExePath: () => "C:\\cursor-monitor.exe",
	ensureNativeCursorMonitorBinary: async () => "/built/cursor-monitor",
}));

vi.mock("./interaction", () => ({
	recordCursorMouseDown: vi.fn(),
	recordCursorMouseUp: vi.fn(),
}));

import * as state from "../state";
import {
	handleCursorMonitorStdout,
	startNativeCursorMonitor,
	stopNativeCursorMonitor,
} from "./monitor";

type FakeHelper = EventEmitter & {
	stdin: { write: ReturnType<typeof vi.fn> };
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill: ReturnType<typeof vi.fn>;
};

function makeFakeHelper(): ChildProcessWithoutNullStreams {
	const child = new EventEmitter() as FakeHelper;
	child.stdin = { write: vi.fn() };
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = vi.fn();
	return child as unknown as ChildProcessWithoutNullStreams;
}

function latestSpawned(): ChildProcessWithoutNullStreams {
	const last = spawnMock.mock.results.at(-1);
	if (!last || last.type !== "return") {
		throw new Error("no spawned helper recorded");
	}
	return last.value as ChildProcessWithoutNullStreams;
}

describe("handleCursorMonitorStdout", () => {
	beforeEach(() => {
		state.setCurrentCursorVisualType("arrow");
		state.setNativeCursorMonitorOutputBuffer("");
	});

	it("updates the cursor type on STATE lines and deduplicates repeats", () => {
		handleCursorMonitorStdout(Buffer.from("STATE:text\nSTATE:text\nSTATE:pointer\n"));
		expect(state.currentCursorVisualType).toBe("pointer");
	});

	it("records POSITION lines as the authoritative Linux cursor point", () => {
		handleCursorMonitorStdout(Buffer.from("POSITION:101:202\n"));
		expect(state.linuxCursorScreenPoint).toEqual({
			x: 101,
			y: 202,
			updatedAt: expect.any(Number),
		});
	});

	it("keeps partial lines in the buffer across chunks", () => {
		handleCursorMonitorStdout(Buffer.from("STATE:te"));
		expect(state.currentCursorVisualType).toBe("arrow");
		handleCursorMonitorStdout(Buffer.from("xt\n"));
		expect(state.currentCursorVisualType).toBe("text");
	});
});

describe("cursor monitor respawn", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		accessMock.mockReset();
		spawnMock.mockReset();
		accessMock.mockResolvedValue(undefined);
	});

	afterEach(async () => {
		stopNativeCursorMonitor();
		await vi.advanceTimersByTimeAsync(10_000);
		vi.useRealTimers();
	});

	it("respawns the helper after an unexpected close", async () => {
		spawnMock.mockImplementation(() => makeFakeHelper());
		await startNativeCursorMonitor();
		expect(spawnMock).toHaveBeenCalledTimes(1);

		latestSpawned().emit("close", 139, "SIGSEGV");
		await vi.advanceTimersByTimeAsync(500);

		expect(spawnMock).toHaveBeenCalledTimes(2);
	});

	it("does not respawn after an intentional stop", async () => {
		spawnMock.mockImplementation(() => makeFakeHelper());
		await startNativeCursorMonitor();

		stopNativeCursorMonitor();
		latestSpawned().emit("close", 0, null);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it("gives up after repeated immediate crashes and resets on the next start", async () => {
		spawnMock.mockImplementation(() => makeFakeHelper());
		await startNativeCursorMonitor();

		// Five respawn delays (500..8000 ms) with instant crashes each time.
		for (let delayMs = 500; delayMs <= 8000; delayMs *= 2) {
			latestSpawned().emit("close", 1, null);
			await vi.advanceTimersByTimeAsync(delayMs);
		}
		const spawnsAfterLadder = spawnMock.mock.calls.length;
		expect(spawnsAfterLadder).toBe(6);

		// A sixth crash finds the ladder exhausted: no more spawns.
		latestSpawned().emit("close", 1, null);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(spawnMock.mock.calls.length).toBe(spawnsAfterLadder);

		// Starting again (e.g. the next recording) resets the ladder.
		await startNativeCursorMonitor();
		latestSpawned().emit("close", 1, null);
		await vi.advanceTimersByTimeAsync(500);
		expect(spawnMock.mock.calls.length).toBe(spawnsAfterLadder + 2);
	});
});
