import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLaunchHudInteractionState } from "./useLaunchHudInteractionState";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock("react", () => ({
	useRef: <T>(current: T) => ({ current }),
	useCallback: <T>(callback: T) => callback,
	useEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));

const bar = { left: 300, top: 700, right: 900, bottom: 760 };
const camera = { left: 950, top: 550, right: 1180, bottom: 780 };
let cleanup: Array<void | (() => void)>;
let regions: Array<{ dataset: Record<string, string>; getBoundingClientRect: () => typeof bar }>;
let host: EventTarget;
const ignoreMouse = vi.fn();
function mount(openId: string | null = null) {
	const refs = {
		isHudDraggingRef: { current: false },
		isWebcamPreviewDraggingRef: { current: false },
		webcamPreviewDragStartRef: { current: null as unknown },
	};
	useLaunchHudInteractionState({ openId, ...refs });
	cleanup = effects.splice(0).map((effect) => effect());
	return refs;
}
function move(x: number, y: number) {
	// Forwarded events may target the transparent body, rather than a HUD descendant.
	host.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: x, clientY: y }));
	vi.runOnlyPendingTimers();
}
beforeEach(() => {
	vi.useFakeTimers();
	ignoreMouse.mockClear();
	host = new EventTarget();
	Object.assign(host, { electronAPI: { hudOverlaySetIgnoreMouse: ignoreMouse } });
	vi.stubGlobal("window", host);
	regions = [{ dataset: {}, getBoundingClientRect: () => bar }];
	vi.stubGlobal("document", { querySelectorAll: () => regions });
	cleanup = [];
});
afterEach(() => {
	cleanup.forEach((fn) => fn?.());
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
describe("HUD forwarded mouse movement", () => {
	it("cancels a pending close timer when a popover reopens", () => {
		mount();
		cleanup.forEach((fn) => fn?.());
		mount("microphone");
		vi.runOnlyPendingTimers();
		expect(ignoreMouse).toHaveBeenLastCalledWith(false);
		expect(ignoreMouse).not.toHaveBeenCalledWith(true);
	});
	it("does not write native mouse state after unmounting with a close timer pending", () => {
		mount();
		cleanup.forEach((fn) => fn?.());
		cleanup = [];
		vi.runOnlyPendingTimers();
		expect(ignoreMouse).not.toHaveBeenCalled();
	});
	it("re-enables actual controls and releases transparent horizontal side areas", () => {
		mount();
		move(500, 730);
		expect(ignoreMouse).toHaveBeenLastCalledWith(false);
		move(100, 730);
		expect(ignoreMouse).toHaveBeenLastCalledWith(true);
		move(1000, 730);
		expect(ignoreMouse).toHaveBeenLastCalledWith(true);
		move(800, 730);
		expect(ignoreMouse).toHaveBeenLastCalledWith(false);
	});
	it("keeps an open popover dismissible even outside its visible panel", () => {
		mount("microphone");
		move(100, 730);
		expect(ignoreMouse).toHaveBeenLastCalledWith(false);
	});
	it("keeps whole popup cards interactive and excludes space between camera and bar", () => {
		regions.push({ dataset: {}, getBoundingClientRect: () => camera });
		regions.push({
			dataset: {},
			getBoundingClientRect: () => ({ left: 350, top: 400, right: 750, bottom: 680 }),
		});
		mount();
		move(360, 410);
		expect(ignoreMouse).toHaveBeenLastCalledWith(false);
		move(1000, 600);
		expect(ignoreMouse).toHaveBeenLastCalledWith(false);
		move(925, 730);
		expect(ignoreMouse).toHaveBeenLastCalledWith(true);
	});
	it.each([
		"isHudDraggingRef",
		"isWebcamPreviewDraggingRef",
		"webcamPreviewDragStartRef",
	] as const)("does not release active %s gestures", (name) => {
		const refs = mount();
		refs[name].current = true;
		move(100, 730);
		expect(ignoreMouse).not.toHaveBeenCalledWith(true);
	});
	it("ignores exiting or hidden toast cards and removes listeners on unmount", () => {
		regions = [{ dataset: { hidden: "true" }, getBoundingClientRect: () => bar }];
		mount();
		move(500, 730);
		expect(ignoreMouse).toHaveBeenLastCalledWith(true);
		cleanup.forEach((fn) => fn?.());
		cleanup = [];
		ignoreMouse.mockClear();
		move(500, 730);
		expect(ignoreMouse).not.toHaveBeenCalled();
	});
});
