import { expect, it, vi } from "vitest";
import type { CommittedIOSRecording } from "../../../../src/shared/iosCapture";
import { IOSRecordingHandoff } from "./handoff";

it("delivers one editor when concurrent recovery and completion callers await the same session", async () => {
	let finish!: () => void;
	const deliver = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const handoff = new IOSRecordingHandoff(deliver);
	const recording = { sessionId: "one" } as CommittedIOSRecording;
	const first = handoff.run(recording);
	const second = handoff.run(recording);
	expect(second).toBe(first);
	await Promise.resolve();
	expect(deliver).toHaveBeenCalledOnce();
	finish();
	await first;
	await handoff.run(recording);
	expect(deliver).toHaveBeenCalledOnce();
});

it("allows a failed delivery to be retried without an extra successful delivery", async () => {
	const deliver = vi
		.fn()
		.mockRejectedValueOnce(new Error("editor unavailable"))
		.mockResolvedValue(undefined);
	const handoff = new IOSRecordingHandoff(deliver);
	const recording = { sessionId: "one" } as CommittedIOSRecording;
	await expect(handoff.run(recording)).rejects.toThrow("editor unavailable");
	await handoff.run(recording);
	await handoff.run(recording);
	expect(deliver).toHaveBeenCalledTimes(2);
});
