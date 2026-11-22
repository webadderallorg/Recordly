import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCountdownController } from "./countdownController";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("emits 3, 2, 1 from the main-process timer and settles without a window", async () => {
	const state = vi.fn();
	const controller = createCountdownController(state);
	const pending = controller.start(3);
	expect(state).toHaveBeenLastCalledWith(3);
	await vi.advanceTimersByTimeAsync(3000);
	await expect(pending).resolves.toEqual({ success: true });
	expect(state.mock.calls).toEqual([[3], [2], [1], [null]]);
	expect(vi.getTimerCount()).toBe(0);
});

it("cancels immediately, releases the timer and allows another start", async () => {
	const state = vi.fn();
	const controller = createCountdownController(state);
	const pending = controller.start(3);
	controller.cancel();
	await expect(pending).resolves.toEqual({ success: false, cancelled: true });
	expect(state).toHaveBeenLastCalledWith(null);
	expect(vi.getTimerCount()).toBe(0);
	const next = controller.start(1);
	await vi.advanceTimersByTimeAsync(1000);
	await expect(next).resolves.toEqual({ success: true });
});

it("does not let a concurrent start replace the active recording countdown", async () => {
	const state = vi.fn();
	const controller = createCountdownController(state);
	const pending = controller.start(2);
	await expect(controller.start(3)).resolves.toMatchObject({ success: false });
	await vi.advanceTimersByTimeAsync(2000);
	await expect(pending).resolves.toEqual({ success: true });
	expect(state.mock.calls).toEqual([[2], [1], [null]]);
});

it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid delay %s", async (delay) => {
	const state = vi.fn();
	await expect(createCountdownController(state).start(delay)).resolves.toMatchObject({
		success: false,
	});
	expect(state).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});

it("settles zero delay immediately without adding a timer", async () => {
	const state = vi.fn();
	await expect(createCountdownController(state).start(0)).resolves.toEqual({ success: true });
	expect(state.mock.calls).toEqual([[null]]);
	expect(vi.getTimerCount()).toBe(0);
});
