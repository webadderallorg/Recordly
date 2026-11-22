import { ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RecordingProcessGuard } from "./processGuard";

const busy = { success: false, message: "A recording is already starting or active." };

describe("recording process ownership", () => {
	it("blocks duplicate and cross-backend requests before async preparation finishes", async () => {
		const guard = new RecordingProcessGuard();
		let finish!: () => void;
		const prepare = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const start = vi.fn(async () => {
			await prepare;
			return { success: true };
		});
		const native = guard.wrap(start);
		const ffmpeg = guard.wrap(start);
		const first = native();
		expect(await native()).toEqual(busy);
		expect(await ffmpeg()).toEqual(busy);
		expect(start).toHaveBeenCalledTimes(1);
		finish();
		await first;
		expect(await ffmpeg()).toEqual({ success: true });
	});

	it("allows retry after preparation throws or returns a permission failure", async () => {
		const guard = new RecordingProcessGuard();
		await expect(
			guard.wrap(async () => {
				throw new Error("denied");
			})(),
		).rejects.toThrow("denied");
		expect(await guard.wrap(async () => ({ success: false }))()).toEqual({ success: false });
		expect(await guard.wrap(async () => ({ success: true }))()).toEqual({ success: true });
	});

	it("keeps failed or stopped children reserved until close, even after kill is requested", async () => {
		const guard = new RecordingProcessGuard();
		const child = new ChildProcess();
		const kill = vi.spyOn(child, "kill").mockReturnValue(true);
		await guard.wrap(async () => {
			guard.track(child);
			child.kill();
			return { success: false };
		})();
		const retry = guard.wrap(vi.fn(async () => ({ success: true })));
		expect(kill).toHaveBeenCalledOnce();
		expect(await retry()).toEqual(busy);
		child.emit("exit", 0, null);
		expect(await retry()).toEqual(busy);
		child.emit("close", 0, null);
		expect(await retry()).toEqual({ success: true });
	});

	it("does not release startup if a child closes before startup cleanup finishes", async () => {
		const guard = new RecordingProcessGuard();
		const child = new ChildProcess();
		let finish!: () => void;
		const cleanup = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const pending = guard.wrap(async () => {
			guard.track(child);
			await cleanup;
		})();
		child.emit("close", 1, null);
		const retry = guard.wrap(async () => true);
		expect(await retry()).toEqual(busy);
		finish();
		await pending;
		expect(await retry()).toBe(true);
	});

	it("spawns only one actual child for a burst of starts and permits the next after close", async () => {
		const guard = new RecordingProcessGuard();
		const children: ChildProcess[] = [];
		const start = guard.wrap(async () => {
			await Promise.resolve();
			children.push(
				guard.track(spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"])),
			);
			return { success: true };
		});
		try {
			const results = await Promise.all(Array.from({ length: 20 }, () => start()));
			expect(children).toHaveLength(1);
			expect(results.filter((result) => result.success)).toHaveLength(1);
			expect(await start()).toEqual(busy);
			const closed = once(children[0], "close");
			children[0].kill();
			await closed;
			expect(await start()).toEqual({ success: true });
			expect(children).toHaveLength(2);
		} finally {
			await Promise.all(
				children
					.filter((child) => child.exitCode === null && child.signalCode === null)
					.map(async (child) => {
						const closed = once(child, "close");
						child.kill();
						await closed;
					}),
			);
		}
	});
});
