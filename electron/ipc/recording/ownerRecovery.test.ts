import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { type CaptureStopResult, RecordingOwnerRecovery } from "./ownerRecovery";
function setup() {
	const owner = Object.assign(new EventEmitter(), { id: 1 });
	const deps = {
		stop: vi.fn(async () => ({ success: true, path: "/take.mp4" })),
		needsFinish: vi.fn(() => false),
		finish: vi.fn(async (r: CaptureStopResult) => r),
		discard: vi.fn(async () => {}),
		reset: vi.fn(),
		report: vi.fn(async () => {}),
	};
	return { owner, deps, recovery: new RecordingOwnerRecovery(deps) };
}
async function drain() {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}
describe("native recording owner recovery", () => {
	it.each(["result", "throw"])("allows discard to retry a failed stop (%s) and record again", async (failure) => {
		const { owner, deps, recovery } = setup();
		await recovery.start(owner, async () => ({ success: true }));
		recovery.setUserRecording(true);
		if (failure === "result") {
			deps.stop.mockResolvedValueOnce({ success: false, path: "" });
			await expect(recovery.stop()).resolves.toMatchObject({ success: false });
		} else {
			deps.stop.mockRejectedValueOnce(new Error("helper busy"));
			await expect(recovery.stop()).rejects.toThrow("helper busy");
		}
		// A failed stop must keep ownership until the actual capture is stopped.
		expect(await recovery.start(owner, async () => ({ success: true }))).toMatchObject({ success: false });
		await expect(recovery.stop()).resolves.toMatchObject({ success: true });
		expect(deps.stop).toHaveBeenCalledTimes(2);
		recovery.setUserRecording(false);
		expect(await recovery.start(owner, async () => ({ success: true }))).toMatchObject({ success: true });
	});

	it("finishes an unmounted owner's recording without a navigation event", async () => {
		const { owner, deps, recovery } = setup();
		await recovery.start(owner, async () => ({ success: true }));
		recovery.setUserRecording(true);
		await recovery.recoverOwner(2);
		expect(deps.stop).not.toHaveBeenCalled();
		await recovery.recoverOwner(owner.id);
		expect(deps.stop).toHaveBeenCalledOnce();
		expect(deps.finish).toHaveBeenCalledOnce();
		expect(deps.discard).not.toHaveBeenCalled();
		expect(await recovery.start(owner, async () => ({ success: true }))).toEqual({
			success: true,
		});
	});
	it.each([
		"destroyed",
		"render-process-gone",
		"did-start-navigation",
	])("cancels a queued recording when its controls emit %s", async (event) => {
		const { owner, deps, recovery } = setup();
		let stopped!: (result: CaptureStopResult) => void;
		deps.stop.mockImplementation(
			() =>
				new Promise((resolve) => {
					stopped = resolve;
				}),
		);
		await recovery.start(owner, async () => ({ success: true }));
		recovery.setUserRecording(true);
		const recovering = recovery.recoverOwner(owner.id);
		await drain();
		const start = vi.fn(async () => ({ success: true }));
		const next = recovery.start(owner, start);
		owner.emit(event, { isMainFrame: true, isSameDocument: false });
		stopped({ success: true, path: "/take.mp4" });
		await recovering;
		expect(await next).toMatchObject({ success: false });
		expect(start).not.toHaveBeenCalled();
	});
	it("releases a reloaded recording before its recovery notice is dismissed", async () => {
		const { owner, deps, recovery } = setup();
		let dismiss!: () => void;
		deps.report.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					dismiss = resolve;
				}),
		);
		await recovery.start(owner, async () => ({ success: true }));
		recovery.setUserRecording(true);
		owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
		await drain();
		expect(deps.stop).toHaveBeenCalledOnce();
		expect(deps.finish).toHaveBeenCalledOnce();
		expect(deps.reset).toHaveBeenCalledOnce();
		expect(await recovery.start(owner, async () => ({ success: true }))).toEqual({
			success: true,
		});
		dismiss();
		await drain();
		// Dismissing an old notice must not release the new recording's ownership.
		expect(await recovery.start(owner, async () => ({ success: true }))).toEqual(
			expect.objectContaining({ success: false }),
		);
	});
	it("waits for reload cleanup before accepting the next recording", async () => {
		const { owner, deps, recovery } = setup();
		let stopped!: (result: CaptureStopResult) => void;
		deps.stop.mockImplementation(
			() =>
				new Promise((resolve) => {
					stopped = resolve;
				}),
		);
		await recovery.start(owner, async () => ({ success: true }));
		recovery.setUserRecording(true);
		owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
		await drain();
		const start = vi.fn(async () => ({ success: true }));
		const next = recovery.start(owner, start);
		await drain();
		expect(start).not.toHaveBeenCalled();
		stopped({ success: true, path: "/take.mp4" });
		expect(await next).toEqual({ success: true });
		expect(deps.finish).toHaveBeenCalledOnce();
		expect(start).toHaveBeenCalledOnce();
	});
	it("saves on crash even if an unrelated presence hook clears UI state first", async () => {
		const { owner, deps, recovery } = setup();
		owner.on("render-process-gone", () => {});
		await recovery.start(
			owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
			async () => ({ success: true }),
		);
		recovery.setUserRecording(true);
		owner.emit("render-process-gone");
		owner.emit("destroyed");
		await drain();
		expect(deps.stop).toHaveBeenCalledTimes(1);
		expect(deps.finish).toHaveBeenCalledOnce();
		expect(deps.report).toHaveBeenCalledOnce();
		expect(deps.discard).not.toHaveBeenCalled();
	});
	it("waits for start before stopping a lost countdown owner", async () => {
		const { owner, deps, recovery } = setup();
		let resolve!: (value: { success: boolean }) => void;
		const pending = recovery.start(
			owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
			() =>
				new Promise<{ success: boolean }>((r) => {
					resolve = r;
				}),
		);
		await drain();
		owner.emit("destroyed");
		await drain();
		expect(deps.stop).not.toHaveBeenCalled();
		resolve({ success: true });
		await pending;
		await drain();
		expect(deps.discard).toHaveBeenCalledWith("/take.mp4");
		expect(deps.report).not.toHaveBeenCalled();
	});
	it("joins a manual stop and retains actual-recording classification after state reset", async () => {
		const { owner, deps, recovery } = setup();
		await recovery.start(
			owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
			async () => ({ success: true }),
		);
		recovery.setUserRecording(true);
		const stopped = recovery.stop();
		deps.needsFinish.mockReturnValue(true);
		recovery.setUserRecording(false);
		owner.emit("render-process-gone");
		await stopped;
		await drain();
		expect(deps.stop).toHaveBeenCalledTimes(1);
		expect(deps.report).toHaveBeenCalledOnce();
		expect(deps.discard).not.toHaveBeenCalled();
	});
	it("reports failure and releases reservation even when stop throws", async () => {
		const { owner, deps, recovery } = setup();
		deps.stop.mockRejectedValueOnce(new Error("failed"));
		await recovery.start(
			owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
			async () => ({ success: true }),
		);
		recovery.setUserRecording(true);
		owner.emit("destroyed");
		await drain();
		expect(deps.reset).toHaveBeenCalledOnce();
		expect(deps.report).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
		expect(
			await recovery.start(
				owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
				async () => ({ success: true }),
			),
		).toEqual({ success: true });
	});
	it("ignores same-document/subframe navigation but stops on top-level navigation", async () => {
		const { owner, deps, recovery } = setup();
		await recovery.start(
			owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
			async () => ({ success: true }),
		);
		owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
		owner.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
		await drain();
		expect(deps.stop).not.toHaveBeenCalled();
		owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
		await drain();
		expect(deps.stop).toHaveBeenCalledOnce();
	});
	it("releases an unexpectedly ended helper without deleting its recovered recording", async () => {
		const { owner, deps, recovery } = setup();
		await recovery.start(
			owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
			async () => ({ success: true }),
		);
		recovery.setUserRecording(true);
		recovery.captureExited();
		owner.emit("destroyed");
		await drain();
		expect(deps.stop).not.toHaveBeenCalled();
		expect(deps.discard).not.toHaveBeenCalled();
		expect(
			await recovery.start(
				owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
				async () => ({ success: true }),
			),
		).toEqual({ success: true });
	});
	it("does not report a crash when HUD closes after a normal completed manual stop", async () => {
		const { owner, deps, recovery } = setup();
		await recovery.start(
			owner as unknown as Pick<Electron.WebContents, "id" | "on" | "removeListener">,
			async () => ({ success: true }),
		);
		recovery.setUserRecording(true);
		await recovery.stop();
		recovery.setUserRecording(false);
		owner.emit("destroyed");
		await drain();
		expect(deps.report).not.toHaveBeenCalled();
		expect(deps.discard).not.toHaveBeenCalled();
	});
});
