import { afterEach, expect, it, vi } from "vitest";
import { createSaveBeforeCloseController } from "./saveBeforeClose";
afterEach(() => vi.useRealTimers());
function fixture(discard = false) {
	let reply!: (saved: boolean) => void;
	const unsubscribe = vi.fn();
	const options = {
		requestSave: vi.fn(),
		subscribe: vi.fn((done: (saved: boolean) => void) => {
			reply = done;
			return unsubscribe;
		}),
		offerDiscard: vi.fn().mockResolvedValue(discard),
		close: vi.fn(),
		cancel: vi.fn(),
		timeoutMs: 100,
	};
	return {
		options,
		unsubscribe,
		reply: (saved: boolean) => reply(saved),
		controller: createSaveBeforeCloseController(options),
	};
}
it("closes once after saving and removes the listener", () => {
	const f = fixture();
	f.controller.start();
	f.controller.start();
	f.reply(true);
	f.reply(true);
	expect(f.options.requestSave).toHaveBeenCalledTimes(1);
	expect(f.options.close).toHaveBeenCalledTimes(1);
	expect(f.unsubscribe).toHaveBeenCalledTimes(1);
	expect(f.options.offerDiscard).not.toHaveBeenCalled();
});
it.each([true, false])("offers discard/cancel after failed save (discard=%s)", async (discard) => {
	const f = fixture(discard);
	f.controller.start();
	f.reply(false);
	await vi.waitFor(() =>
		expect(discard ? f.options.close : f.options.cancel).toHaveBeenCalledTimes(1),
	);
	expect(f.unsubscribe).toHaveBeenCalledTimes(1);
	if (!discard) {
		f.controller.start();
		expect(f.options.requestSave).toHaveBeenCalledTimes(2);
	}
});
it("recovers a hung renderer on timeout and ignores late replies", async () => {
	vi.useFakeTimers();
	const f = fixture();
	f.controller.start();
	await vi.advanceTimersByTimeAsync(100);
	f.reply(true);
	expect(f.options.offerDiscard).toHaveBeenCalledTimes(1);
	expect(f.options.cancel).toHaveBeenCalledTimes(1);
	expect(f.options.close).not.toHaveBeenCalled();
	f.controller.start();
	expect(f.options.requestSave).toHaveBeenCalledTimes(2);
});
it("removes a pending timeout/listener when the window is destroyed", async () => {
	vi.useFakeTimers();
	const f = fixture();
	f.controller.start();
	f.controller.dispose();
	await vi.advanceTimersByTimeAsync(100);
	f.reply(true);
	expect(f.unsubscribe).toHaveBeenCalledTimes(1);
	expect(f.options.close).not.toHaveBeenCalled();
	expect(f.options.offerDiscard).not.toHaveBeenCalled();
});
