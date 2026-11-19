import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHudBarDrag } from "./useHudBarDrag";
import { useLaunchHudInteractionState } from "./useLaunchHudInteractionState";
import { useWebcamPreviewPointer } from "./useWebcamPreviewPointer";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock("react", () => ({
	useRef: <T>(current: T) => ({ current }),
	useCallback: <T>(callback: T) => callback,
	useEffect: (effect: () => void | (() => void)) => effects.push(effect),
	useState: <T>(initial: T | (() => T)) => [
		typeof initial === "function" ? (initial as () => T)() : initial,
		vi.fn(),
	],
	useLayoutEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));

const bar = { left: 300, top: 700, right: 900, bottom: 760 };
const camera = { left: 950, top: 550, right: 1180, bottom: 780 };
let cleanup: Array<void | (() => void)>;
let regions: Array<{ dataset: Record<string, string>; getBoundingClientRect: () => typeof bar }>;
let host: EventTarget;
const ignoreMouse = vi.fn();
let nativeIgnoring: boolean | undefined;
function mount(openId: string | null = null, platform: string | null = "darwin") {
	const refs = {
		isHudDraggingRef: { current: false },
		isWebcamPreviewDraggingRef: { current: false },
		webcamPreviewDragStartRef: { current: null as unknown },
	};
	const actions = useLaunchHudInteractionState({ openId, platform, ...refs });
	cleanup = effects.splice(0).map((effect) => effect());
	return { ...refs, actions };
}
function move(x: number, y: number) {
	// Forwarded events may target the transparent body, rather than a HUD descendant.
	host.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: x, clientY: y }));
	vi.runOnlyPendingTimers();
}
function mountDragHooks() {
	const target = (bounds: typeof bar) => {
		let captured = false;
		return {
			closest: () => null,
			contains: () => true,
			style: { transform: "" },
			getBoundingClientRect: () => ({
				...bounds,
				width: bounds.right - bounds.left,
				height: bounds.bottom - bounds.top,
			}),
			setPointerCapture: () => {
				captured = true;
			},
			hasPointerCapture: () => captured,
			releasePointerCapture: () => {
				captured = false;
			},
		};
	};
	const barTarget = target(bar);
	const cameraTarget = target(camera);
	const hudBarRef = { current: barTarget as unknown as HTMLDivElement };
	const cameraRef = { current: cameraTarget as unknown as HTMLDivElement };
	const hud = useHudBarDrag({
		hudBarRef,
		hudContentRef: { current: null },
		recordingWebcamPreviewContainerRef: cameraRef,
	});
	const webcam = useWebcamPreviewPointer({
		webcamEnabled: true,
		showRecordingWebcamPreview: true,
		setShowFloatingWebcamPreview: vi.fn(),
		geometry: {
			webcamPreviewOffsetRef: { current: { x: 0, y: 0 } },
			setWebcamPreviewOffset: vi.fn(),
			recordingWebcamPreviewContainerRef: cameraRef,
			getDockBounds: () => cameraTarget.getBoundingClientRect(),
			keepDockInsideViewport: vi.fn(),
		} as unknown as Parameters<typeof useWebcamPreviewPointer>[0]["geometry"],
	});
	useLaunchHudInteractionState({
		openId: null,
		platform: "darwin",
		isHudDraggingRef: hud.isHudDraggingRef,
		isWebcamPreviewDraggingRef: webcam.isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef: webcam.webcamPreviewDragStartRef,
	});
	cleanup = effects.splice(0).map((effect) => effect());
	return { hud, webcam, barTarget, cameraTarget };
}
beforeEach(() => {
	vi.useFakeTimers();
	ignoreMouse.mockReset();
	nativeIgnoring = undefined;
	ignoreMouse.mockImplementation((ignore: boolean) => {
		nativeIgnoring = ignore;
	});
	host = new EventTarget();
	Object.assign(host, {
		electronAPI: { hudOverlaySetIgnoreMouse: ignoreMouse },
		innerWidth: 1280,
		innerHeight: 800,
	});
	vi.stubGlobal("window", host);
	regions = [{ dataset: {}, getBoundingClientRect: () => bar }];
	vi.stubGlobal("document", {
		querySelectorAll: () => regions,
		documentElement: {
			getAttribute: () => null,
			setAttribute: vi.fn(),
			removeAttribute: vi.fn(),
			style: {
				getPropertyValue: () => "",
				getPropertyPriority: () => "",
				setProperty: vi.fn(),
				removeProperty: vi.fn(),
			},
		},
	});
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
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

describe("HUD mouse IPC state changes", () => {
	it.each(
		(["bar", "camera"] as const).flatMap((kind) =>
			["pointerup", "pointercancel", "lostpointercapture", "blur"].map((release) => ({
				kind,
				release,
			})),
		),
	)("restores hover after $kind $release bypasses the cache", ({ kind, release }) => {
		const { hud, webcam, barTarget, cameraTarget } = mountDragHooks();
		const target = kind === "bar" ? barTarget : cameraTarget;
		move(500, 730);
		const event = (type: string, clientX: number, clientY: number) =>
			({
				type,
				clientX,
				clientY,
				button: 0,
				pointerId: 1,
				currentTarget: target,
				target,
				preventDefault: vi.fn(),
			}) as unknown as Parameters<typeof hud.handleHudBarPointerDown>[0];
		const down =
			kind === "bar" ? hud.handleHudBarPointerDown : webcam.handleWebcamPreviewPointerDown;
		const dragging =
			kind === "bar" ? hud.handleHudBarPointerMove : webcam.handleWebcamPreviewPointerMove;
		const up = kind === "bar" ? hud.handleHudBarPointerUp : webcam.handleWebcamPreviewPointerUp;
		down(event("pointerdown", 500, 730));
		dragging(event("pointermove", -100, -100));
		// Leave an outside-hover timer pending, then return before it writes native state.
		host.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: -100, clientY: -100 }));
		host.dispatchEvent(new Event(release));
		if (release !== "blur") up(event(release, -100, -100));
		expect(nativeIgnoring, `${kind} ${release} release`).toBe(true);
		move(500, 730);
		expect(nativeIgnoring, `${kind} ${release} hover`).toBe(false);
	});
	it("retries hover after a forced native write throws instead of caching the failed request", () => {
		const { actions } = mount();
		move(500, 730);
		ignoreMouse(true);
		ignoreMouse.mockImplementationOnce(() => {
			throw new Error("Bridge unavailable");
		});
		expect(() => actions.beginInteractiveHudAction()).toThrow("Bridge unavailable");
		move(500, 730);
		expect(nativeIgnoring).toBe(false);
	});
	it("does not retain an assumed state when the native bridge is temporarily unavailable", () => {
		const { actions } = mount();
		move(500, 730);
		delete (window.electronAPI as Partial<Window["electronAPI"]>).hudOverlaySetIgnoreMouse;
		actions.beginInteractiveHudAction();
		window.electronAPI.hudOverlaySetIgnoreMouse = ignoreMouse;
		ignoreMouse(true);
		move(500, 730);
		expect(nativeIgnoring).toBe(false);
	});
	it("skips repeated ordinary moves but retains state transitions", () => {
		mount();
		move(500, 730);
		move(510, 730);
		move(520, 730);
		expect(ignoreMouse.mock.calls).toEqual([[false]]);
		move(100, 730);
		move(110, 730);
		expect(ignoreMouse.mock.calls).toEqual([[false], [true]]);
		move(500, 730);
		expect(ignoreMouse.mock.calls).toEqual([[false], [true], [false]]);
	});
	it.each(["win32", null])("retains native reassertions for platform %s", (platform) => {
		mount(null, platform);
		move(500, 730);
		move(510, 730);
		expect(ignoreMouse.mock.calls).toEqual([[false], [false]]);
	});
	it.each([
		"isHudDraggingRef",
		"isWebcamPreviewDraggingRef",
		"webcamPreviewDragStartRef",
	] as const)("retains repeated interactive updates during %s", (key) => {
		const refs = mount();
		refs[key].current = true;
		move(500, 730);
		move(510, 730);
		expect(ignoreMouse.mock.calls).toEqual([[false], [false]]);
	});
	it("forces an interactive reset after an external native override", () => {
		const { actions } = mount();
		move(500, 730);
		ignoreMouse.mockClear();
		actions.beginInteractiveHudAction();
		expect(ignoreMouse).toHaveBeenCalledExactlyOnceWith(false);
	});
});
