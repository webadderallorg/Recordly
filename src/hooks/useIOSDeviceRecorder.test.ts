import { describe, expect, it, vi } from "vitest";
import { createIOSRecorderAdapter, EMPTY_IOS_SNAPSHOT } from "./useIOSDeviceRecorder";
import type { IOSCaptureAPI } from "../shared/iosCaptureAPI";
import type { IOSCaptureSnapshot } from "../shared/iosCapture";
export const phone = {
	sourceType: "ios-device" as const,
	id: "ios-device:phone",
	deviceToken: "phone",
	displayName: "Phone",
	generation: 1,
	deviceAudio: "available" as const,
};
function harness() {
	let current: IOSCaptureSnapshot = {
		...EMPTY_IOS_SNAPSHOT,
		sequence: 1,
		phase: "ready",
		sessionId: "session",
		source: phone,
		devices: [phone],
		format: { codedWidth: 10, codedHeight: 20 } as IOSCaptureSnapshot["format"],
		mode: "passthrough",
	};
	const api = {
		getSnapshot: vi.fn(async () => current),
		prepare: vi.fn(async () => current),
		start: vi.fn(async () => ({ ...current, sequence: 2, phase: "starting" as const })),
		stop: vi.fn(async () => ({})),
		cancel: vi.fn(async () => undefined),
		release: vi.fn(async () => undefined),
	};
	const adapter = createIOSRecorderAdapter(api as unknown as IOSCaptureAPI);
	adapter.accept(current);
	return {
		adapter,
		api,
		change: (patch: Partial<IOSCaptureSnapshot>) => {
			current = { ...current, ...patch };
			adapter.accept(current);
		},
	};
}
describe("native recorder adapter", () => {
	it("uses token and generation and main issued session identity", async () => {
		const { adapter, api } = harness();
		await adapter.prepare(phone, { deviceAudio: true, microphoneToken: null });
		await adapter.startPrepared();
		expect(api.prepare).toHaveBeenCalledWith({
			deviceToken: "phone",
			generation: 1,
			options: { deviceAudio: true, microphoneToken: null },
		});
		expect(api.start).toHaveBeenCalledWith("session");
		expect(adapter.getSnapshot().phase).toBe("starting");
	});
	it("does not invent recording on accepted start or accept stale snapshots", async () => {
		const { adapter } = harness();
		await adapter.startPrepared();
		adapter.accept({ ...EMPTY_IOS_SNAPSHOT, sequence: 1, phase: "recording" });
		expect(adapter.getSnapshot().phase).toBe("starting");
	});
	it("coalesces double start and stop while starting without editor handoff", async () => {
		const { adapter, api } = harness();
		await Promise.all([adapter.startPrepared(), adapter.startPrepared()]);
		await Promise.all([adapter.stop(), adapter.stop()]);
		expect(api.start).toHaveBeenCalledTimes(1);
		expect(api.stop).toHaveBeenCalledTimes(1);
	});
	it("revalidates main readiness after countdown before start", async () => {
		const { adapter, api, change } = harness();
		change({ sequence: 2, phase: "failed", devices: [] });
		await expect(adapter.startPrepared()).rejects.toThrow("NO_VIDEO_SAMPLES");
		expect(api.start).not.toHaveBeenCalled();
	});
	it("does not release on unsubscribing/recreating a view", () => {
		const { adapter, api } = harness();
		const off = adapter.subscribe(vi.fn());
		off();
		expect(adapter.getSnapshot().phase).toBe("ready");
		expect(api.release).not.toHaveBeenCalled();
	});
});

import { startIOSRecordingAfterCountdown } from "./useIOSDeviceRecorder";
describe("prepared device countdown", () => {
	it.each([0, 3, 5, 10])("uses configured %s second countdown before starting", async (delay) => {
		const countdown = vi.fn(async () => ({ success: true }));
		const start = vi.fn(async () => undefined);
		await startIOSRecordingAfterCountdown({
			delay,
			countdown,
			start,
			isCancelled: () => false,
			setActive: vi.fn(),
		});
		expect(countdown).toHaveBeenCalledTimes(delay === 0 ? 0 : 1);
		expect(start).toHaveBeenCalledTimes(1);
	});
	it("cancelled countdown keeps prepared capture and does not arm", async () => {
		const start = vi.fn();
		await startIOSRecordingAfterCountdown({
			delay: 3,
			countdown: async () => ({ success: true, cancelled: true }),
			start,
			isCancelled: () => false,
			setActive: vi.fn(),
		});
		expect(start).not.toHaveBeenCalled();
	});
	it("deselection during countdown prevents eventual start", async () => {
		let cancelled = false;
		const start = vi.fn();
		await startIOSRecordingAfterCountdown({
			delay: 3,
			countdown: async () => {
				cancelled = true;
				return { success: true };
			},
			start,
			isCancelled: () => cancelled,
			setActive: vi.fn(),
		});
		expect(start).not.toHaveBeenCalled();
	});
	it("does not start a replacement main session after a source change", async () => {
		const { adapter, api } = harness();
		api.getSnapshot.mockResolvedValue({ ...adapter.getSnapshot(), sessionId: "replacement" });
		await expect(adapter.startPrepared()).rejects.toThrow("INVALID_REQUEST");
		expect(api.start).not.toHaveBeenCalled();
	});
});

import { subscribeIOSPreview } from "./useIOSDeviceRecorder";
describe("disposable native previews", () => {
	it("drops stale/oversized frames and revokes previous and final URLs", () => {
		let receive!: Parameters<IOSCaptureAPI["onPreview"]>[0];
		const unsubscribe = vi.fn();
		const api = {
			onPreview: vi.fn((callback) => {
				receive = callback;
				return unsubscribe;
			}),
			setPreviewEnabled: vi.fn(async () => undefined),
		};
		const urls = {
			createObjectURL: vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second"),
			revokeObjectURL: vi.fn(),
		};
		const present = vi.fn();
		const off = subscribeIOSPreview(api as unknown as IOSCaptureAPI, 2, present, urls);
		receive({ generation: 1, sequence: 1, jpeg: new Uint8Array(1) });
		receive({ generation: 2, sequence: 2, jpeg: new Uint8Array(131073) });
		expect(present).not.toHaveBeenCalled();
		receive({ generation: 2, sequence: 3, jpeg: new Uint8Array(1) });
		receive({ generation: 2, sequence: 3, jpeg: new Uint8Array(1) });
		receive({ generation: 2, sequence: 4, jpeg: new Uint8Array(1) });
		expect(present.mock.calls).toEqual([["first"], ["second"]]);
		expect(urls.revokeObjectURL).toHaveBeenCalledWith("first");
		off();
		expect(urls.revokeObjectURL).toHaveBeenCalledWith("second");
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		expect(api.setPreviewEnabled).toHaveBeenLastCalledWith(false);
	});
});
