import { describe, expect, it, vi } from "vitest";
import { createNonOverlappingRunner, createSingleFlight } from "./concurrency";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

describe("cursor task concurrency", () => {
	it("shares one operation until it settles, then starts another", async () => {
		const run = createSingleFlight<string>();
		const first = deferred<string>();
		const operation = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce("second");

		const firstResult = run(operation);
		const sharedResult = run(operation);
		expect(operation).toHaveBeenCalledTimes(1);

		first.resolve("first");
		await expect(Promise.all([firstResult, sharedResult])).resolves.toEqual(["first", "first"]);
		await expect(run(operation)).resolves.toBe("second");
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it("skips overlap and runs again after settlement", async () => {
		const run = createNonOverlappingRunner();
		const first = deferred<void>();
		const operation = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockResolvedValueOnce(undefined);

		const firstResult = run(operation);
		await expect(run(operation)).resolves.toBe(false);
		expect(operation).toHaveBeenCalledTimes(1);

		first.resolve();
		await expect(firstResult).resolves.toBe(true);
		await expect(run(operation)).resolves.toBe(true);
		expect(operation).toHaveBeenCalledTimes(2);
	});
});
