import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProjectAutosave } from "./projectAutosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("project autosave cadence", () => {
	it("saves the latest metadata every 300ms during continuous edits", async () => {
		let revision = 0;
		const saved: number[] = [];
		const stop = startProjectAutosave(async () => {
			saved.push(revision);
		});
		for (let edit = 1; edit <= 9; edit++) {
			revision = edit;
			await vi.advanceTimersByTimeAsync(100);
		}
		expect(saved).toEqual([3, 6, 9]);
		stop();
	});
	it("keeps the same cadence across clean periods and saves only dirty state", async () => {
		let dirty = false;
		const save = vi.fn(async () => {
			dirty = false;
		});
		const stop = startProjectAutosave(() => (dirty ? save() : undefined));
		await vi.advanceTimersByTimeAsync(500);
		expect(save).not.toHaveBeenCalled();
		dirty = true;
		await vi.advanceTimersByTimeAsync(99);
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(save).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(900);
		expect(save).toHaveBeenCalledOnce();
		stop();
	});
	it("does not overlap or accumulate writes when disk saves are slow", async () => {
		let finish!: () => void;
		let revision = 1;
		const saved: number[] = [];
		const save = vi.fn(async () => {
			saved.push(revision);
			if (saved.length === 1)
				await new Promise<void>((resolve) => {
					finish = resolve;
				});
		});
		const stop = startProjectAutosave(save);
		await vi.advanceTimersByTimeAsync(300);
		revision = 2;
		await vi.advanceTimersByTimeAsync(1200);
		expect(saved).toEqual([1]);
		revision = 3;
		finish();
		await vi.advanceTimersByTimeAsync(300);
		expect(saved).toEqual([1, 3]);
		stop();
	});
	it("continues after failures and stops on cleanup", async () => {
		const save = vi
			.fn()
			.mockRejectedValueOnce(new Error("Disk unavailable"))
			.mockResolvedValue(true);
		const stop = startProjectAutosave(save);
		await vi.advanceTimersByTimeAsync(600);
		expect(save).toHaveBeenCalledTimes(2);
		stop();
		await vi.advanceTimersByTimeAsync(900);
		expect(save).toHaveBeenCalledTimes(2);
	});
});
