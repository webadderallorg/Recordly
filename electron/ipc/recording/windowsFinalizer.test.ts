import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RecordingOwnerRecovery } from "./ownerRecovery";
import { WindowsRecordingFinalizer } from "./windowsFinalizer";
const drain = async () => {
	for (let i = 0; i < 30; i++) await Promise.resolve();
};
describe("Windows recording finalization ownership", () => {
	it.each([
		"crash",
		"remount",
	])("joins in-flight mux work after %s and waits for metadata cleanup", async (loss) => {
		let pendingVideo = false;
		let audioPath: string | null = "old.wav";
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const perform = vi.fn(async () => {
			pendingVideo = false;
			await gate;
			audioPath = null;
			return { success: true, path: "/old.mp4" };
		});
		const mux = new WindowsRecordingFinalizer(() => pendingVideo, perform);
		const report = vi.fn(async () => {});
		const owner = Object.assign(new EventEmitter(), { id: 1 }) as unknown as Pick<
			Electron.WebContents,
			"id" | "on" | "removeListener"
		>;
		const recovery = new RecordingOwnerRecovery({
			stop: async () => {
				pendingVideo = true;
				return { success: true, path: "/old.mp4" };
			},
			needsFinish: () => mux.needsFinish,
			finish: () => mux.run(),
			discard: async () => {},
			reset: () => {},
			report,
		});
		await recovery.start(owner, async () => ({ success: true }));
		recovery.setUserRecording(true);
		await recovery.stop();
		recovery.setUserRecording(false);
		const first = mux.run();
		await drain();
		expect(pendingVideo).toBe(false);
		expect(mux.needsFinish).toBe(true);
		expect(mux.run()).toBe(first);
		owner.on("render-process-gone", () => {});
		if (loss === "crash") (owner as unknown as EventEmitter).emit("render-process-gone");
		else void recovery.recoverOwner(owner.id);
		await drain();
		const startNew = vi.fn(async () => {
			audioPath = "new.wav";
			return { success: true };
		});
		const next = recovery.start(owner, startNew);
		await drain();
		expect(startNew).not.toHaveBeenCalled();
		expect(report).not.toHaveBeenCalled();
		release();
		await first;
		await drain();
		expect(perform).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledOnce();
		expect(await next).toEqual({ success: true });
		await drain();
		expect(audioPath).toBe("new.wav");
	});
	it("releases an invalid or rejected recovery reservation without running mux", async () => {
		const perform = vi.fn(async () => ({ success: true }));
		const finalizer = new WindowsRecordingFinalizer(() => false, perform);
		expect((await finalizer.recover(async () => null)).success).toBe(false);
		expect(finalizer.needsFinish).toBe(false);
		await expect(
			finalizer.recover(async () => {
				throw new Error("validation failed");
			}),
		).rejects.toThrow("validation failed");
		expect(finalizer.needsFinish).toBe(false);
		expect(perform).not.toHaveBeenCalled();
	});
	it("does not run metadata cleanup for a stale mux request without a stopped video", async () => {
		const perform = vi.fn(async () => ({ success: true }));
		const mux = new WindowsRecordingFinalizer(() => false, perform);
		expect((await mux.run()).success).toBe(false);
		expect(perform).not.toHaveBeenCalled();
	});
	it("keeps a failed mux reservation until its operation has settled, then permits retry", async () => {
		let release!: (value: { success: boolean }) => void;
		let pending = true;
		const perform = vi.fn(() => {
			pending = false;
			return new Promise<{ success: boolean }>((resolve) => {
				release = resolve;
			});
		});
		const mux = new WindowsRecordingFinalizer(() => pending, perform);
		const result = mux.run();
		await drain();
		expect(mux.needsFinish).toBe(true);
		release({ success: false });
		expect(await result).toEqual({ success: false });
		await drain();
		expect(mux.needsFinish).toBe(false);
	});
});
