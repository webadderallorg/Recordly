import { afterEach, expect, it, vi } from "vitest";
import { startHudPointerRecovery } from "./hudPointerRecovery";

afterEach(() => vi.useRealTimers());

it("leaves the webcam's transparent corners click-through while recovering its center", async () => {
	vi.useFakeTimers();
	let cursor = { x: 301, y: 501 };
	const recover = vi.fn();
	const stop = startHudPointerRecovery({
		canRecover: () => true,
		getCursor: () => cursor,
		getBounds: () => [{ left: 300, top: 500, right: 500, bottom: 700, shape: "ellipse" }],
		recover,
	});
	await vi.advanceTimersByTimeAsync(50);
	expect(recover).not.toHaveBeenCalled();
	cursor = { x: 400, y: 600 };
	await vi.advanceTimersByTimeAsync(50);
	expect(recover).toHaveBeenCalledOnce();
	stop();
});

it("restores buttons without any renderer mouse events, including after native state is lost again", async () => {
	vi.useFakeTimers();
	let cursor = { x: 500, y: 720 };
	const recover = vi.fn();
	const stop = startHudPointerRecovery({
		canRecover: () => true,
		getCursor: () => cursor,
		getBounds: () => [{ left: 300, top: 700, right: 900, bottom: 760 }],
		recover,
	});
	await vi.advanceTimersByTimeAsync(50);
	expect(recover).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(50);
	expect(recover).toHaveBeenCalledTimes(2);
	cursor = { x: 100, y: 100 };
	await vi.advanceTimersByTimeAsync(100);
	expect(recover).toHaveBeenCalledTimes(2);
	stop();
	expect(vi.getTimerCount()).toBe(0);
});

it("does not intercept the native source picker or hidden HUD and picks up new popovers", async () => {
	vi.useFakeTimers();
	let enabled = false;
	let bounds = [{ left: 300, top: 700, right: 900, bottom: 760 }];
	const recover = vi.fn();
	const stop = startHudPointerRecovery({
		canRecover: () => enabled,
		getCursor: () => ({ x: 500, y: 600 }),
		getBounds: () => bounds,
		recover,
	});
	await vi.advanceTimersByTimeAsync(100);
	expect(recover).not.toHaveBeenCalled();
	enabled = true;
	await vi.advanceTimersByTimeAsync(50);
	expect(recover).not.toHaveBeenCalled();
	bounds = [...bounds, { left: 300, top: 500, right: 900, bottom: 690 }];
	await vi.advanceTimersByTimeAsync(50);
	expect(recover).toHaveBeenCalledOnce();
	stop();
});
