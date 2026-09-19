import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createAudioOutputLevelMonitorManager,
	parseAudioOutputLevelLine,
	splitAudioOutputMonitorLines,
} from "./audioOutputMonitor";

class FakeMonitorProcess extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	killed = false;

	kill() {
		this.killed = true;
		this.emit("close", null);
		return true;
	}
}

describe("audio output level protocol", () => {
	it("parses and normalizes RMS and peak values", () => {
		expect(parseAudioOutputLevelLine("AUDIO_LEVEL\tdev-1\t0.2\t0.4")).toEqual({
			deviceId: "dev-1",
			rms: 0.2,
			peak: 0.4,
			level: 40,
		});
		expect(parseAudioOutputLevelLine("AUDIO_LEVEL\tdev-1\t2\t-1")?.level).toBe(100);
		expect(parseAudioOutputLevelLine("AUDIO_LEVEL\t\tbad\t0")).toBeNull();
	});

	it("keeps a trailing partial line for the next stdout chunk", () => {
		const result = splitAudioOutputMonitorLines(
			"AUDIO_LEVEL\tdev\t0.1\t0.2\nAUDIO_",
		);

		expect(result.events).toEqual([
			{ deviceId: "dev", rms: 0.1, peak: 0.2, level: 20 },
		]);
		expect(result.remainder).toBe("AUDIO_");
	});
});

describe("audio output level monitor lifecycle", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("starts one helper, broadcasts events, and writes stop only once", async () => {
		const process = new FakeMonitorProcess();
		const spawn = vi.fn(() => process);
		const write = vi.spyOn(process.stdin, "write");
		const broadcasts: unknown[] = [];
		const manager = createAudioOutputLevelMonitorManager({
			isWindows: () => true,
			getHelperPath: () => "helper.exe",
			access: async () => undefined,
			spawn,
			broadcast: (event) => broadcasts.push(event),
		});

		expect(await manager.start()).toEqual({ success: true });
		expect(await manager.start()).toEqual({ success: true });
		expect(spawn).toHaveBeenCalledTimes(1);

		process.stdout.write("AUDIO_LEVEL\tdev-1\t0.2\t0.4\n");
		await new Promise((resolve) => setImmediate(resolve));
		expect(broadcasts).toEqual([
			{ deviceId: "dev-1", rms: 0.2, peak: 0.4, level: 40 },
		]);

		const stopPromise = manager.stop();
		await manager.stop();
		process.emit("close", 0);
		await stopPromise;
		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith("stop\n");
	});

	it("serializes overlapping starts and waits before stopping", async () => {
		const process = new FakeMonitorProcess();
		const spawn = vi.fn(() => process);
		const write = vi.spyOn(process.stdin, "write");
		let resolveAccess!: () => void;
		const accessPromise = new Promise<void>((resolve) => {
			resolveAccess = resolve;
		});
		const manager = createAudioOutputLevelMonitorManager({
			isWindows: () => true,
			getHelperPath: () => "helper.exe",
			access: () => accessPromise,
			spawn,
		});

		const firstStart = manager.start();
		const secondStart = manager.start();
		const stop = manager.stop();

		resolveAccess();
		await expect(Promise.all([firstStart, secondStart, stop])).resolves.toEqual([
			{ success: true },
			{ success: true },
			{ success: true },
		]);

		expect(spawn).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith("stop\n");
	});
});
