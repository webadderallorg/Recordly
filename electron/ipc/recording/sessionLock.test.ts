import { EventEmitter } from "node:events";
import { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { RecordingSessionLock } from "./sessionLock";
import { RecordingProcessGuard } from "./processGuard";
const owner = (id = 1) => Object.assign(new EventEmitter(), { id });
function setup() {
	const lost = vi.fn();
	return {
		lost,
		first: new RecordingSessionLock(lost),
		second: new RecordingSessionLock(vi.fn()),
	};
}
describe("recording session scope", () => {
	it("keeps browser ownership during a navigation attempt and ignores stale startup release", () => {
		const { first } = setup();
		const controls = owner();
		first.reserve(controls, "old");
		controls.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
		expect(first.reserve(owner(2))).toBe(false);
		first.finishStartup(1, "old");
		expect(first.reserve(controls, "new")).toBe(true);
		first.finishStartup(1, "old");
		expect(first.reserve(owner(2))).toBe(false);
		first.finishStartup(1, "new");
		expect(first.reserve(owner(2))).toBe(true);
	});
	it("allows each instance to record while blocking duplicate starts within an instance", () => {
		const { first, second } = setup();
		expect(first.reserve(owner(1))).toBe(true);
		// WebContents IDs are process-local, so both instances may use the same ID.
		expect(second.reserve(owner(1))).toBe(true);
		for (const session of [first, second]) {
			expect(session.reserve(owner(1))).toBe(false);
			expect(session.reserve(owner(2))).toBe(false);
			session.setRecording(1, true);
			session.finishStartup(1);
			expect(session.reserve(owner(2))).toBe(false);
		}
		first.setRecording(1, false);
		expect(first.reserve(owner(2))).toBe(true);
		expect(second.reserve(owner(2))).toBe(false);
		second.setRecording(1, false);
		expect(second.reserve(owner(2))).toBe(true);
	});
	it("releases cancelled startup and ignores state changes from other windows", () => {
		const { first } = setup();
		expect(first.reserve(owner())).toBe(true);
		first.setRecording(2, false);
		first.finishStartup(2);
		expect(first.reserve(owner(2))).toBe(false);
		first.finishStartup(1);
		expect(first.reserve(owner(2))).toBe(true);
	});
	it.each([
		"destroyed",
		"render-process-gone",
		"did-navigate",
	])("releases browser ownership on %s", (event) => {
		const { first, lost } = setup();
		const controls = owner();
		first.reserve(controls);
		controls.emit(event, { isMainFrame: true, isSameDocument: false });
		expect(lost).toHaveBeenCalledOnce();
		expect(first.reserve(owner(2))).toBe(true);
		expect(controls.listenerCount("destroyed")).toBe(0);
	});
	it("keeps capture owned after controls disappear until the child closes", async () => {
		const { first, lost } = setup();
		const controls = owner();
		first.reserve(controls);
		const guard = new RecordingProcessGuard(() => first.acquire(controls.id));
		const child = new ChildProcess();
		await guard.wrap(async () => {
			guard.track(child);
			return { success: true };
		})();
		controls.emit("destroyed");
		expect(lost).not.toHaveBeenCalled();
		expect(first.reserve(owner(2))).toBe(false);
		child.emit("exit", 0);
		expect(first.reserve(owner(2))).toBe(false);
		child.emit("close", 0);
		expect(first.reserve(owner(2))).toBe(true);
	});
	it("rejects capture in a different window and releases failed direct starts", async () => {
		const { first } = setup();
		first.reserve(owner());
		expect(first.acquire(2)).toBeNull();
		first.finishStartup(1);
		const guard = new RecordingProcessGuard(() => first.acquire(1));
		await expect(
			guard.wrap(async () => {
				throw Error("denied");
			})(),
		).rejects.toThrow("denied");
		expect(first.reserve(owner(2))).toBe(true);
	});
	it("releases a remounted native owner's renderer hold during recovery reset", () => {
		const { first } = setup();
		first.reserve(owner());
		first.setRecording(1, true);
		const releaseCapture = first.acquire(1)!;
		releaseCapture();
		first.setRecording(undefined, false);
		expect(first.reserve(owner(2))).toBe(true);
	});
});
