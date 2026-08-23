import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp/recordly-test" },
	BrowserWindow: { getAllWindows: () => [] },
}));

import { waitForNativeCaptureStart } from "./mac";

describe("waitForNativeCaptureStart", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the time when the helper reports capture readiness", async () => {
		const child = new EventEmitter() as EventEmitter & {
			stdout: EventEmitter;
		};
		child.stdout = new EventEmitter();
		vi.spyOn(Date, "now").mockReturnValue(123456);

		const ready = waitForNativeCaptureStart(child as never);
		child.stdout.emit("data", Buffer.from("Recording started\n"));

		await expect(ready).resolves.toBe(123456);
	});
});
