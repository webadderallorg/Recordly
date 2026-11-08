import type { PointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebcamPreviewOverlay } from "./useWebcamPreviewOverlay";

type Slot = {
	value?: unknown;
	deps?: unknown[];
	set?: (next: unknown) => void;
	cleanup?: () => void;
};
const harness = vi.hoisted(() => ({
	slots: [] as Slot[],
	index: 0,
	effects: [] as { slot: Slot; effect: () => void | (() => void); deps: unknown[] }[],
}));
vi.mock("react", () => {
	const nextSlot = () => {
		const index = harness.index++;
		harness.slots[index] ??= {};
		return harness.slots[index];
	};
	const changed = (slot: Slot, deps: unknown[]) =>
		!slot.deps || deps.some((value, index) => !Object.is(value, slot.deps?.[index]));
	const effect = (callback: () => void, deps: unknown[]) => {
		const slot = nextSlot();
		if (changed(slot, deps)) harness.effects.push({ slot, effect: callback, deps });
	};
	return {
		useRef: (current: unknown) => {
			const slot = nextSlot();
			slot.value ??= { current };
			return slot.value;
		},
		useState: (initial: unknown) => {
			const slot = nextSlot();
			if (!slot.set) {
				slot.value = typeof initial === "function" ? initial() : initial;
				slot.set = (next) => {
					slot.value = typeof next === "function" ? next(slot.value) : next;
				};
			}
			return [slot.value, slot.set];
		},
		useCallback: (callback: unknown, deps: unknown[]) => {
			const slot = nextSlot();
			if (changed(slot, deps)) {
				slot.value = callback;
				slot.deps = deps;
			}
			return slot.value;
		},
		useEffect: effect,
		useLayoutEffect: effect,
	};
});
vi.mock("../../video-editor/editorPreferences", () => ({
	loadEditorPreferences: () => ({ webcam: { roundness: 69, shape: "squircle" } }),
}));

describe("floating webcam preview lifecycle and pointer ownership", () => {
	let options: Parameters<typeof useWebcamPreviewOverlay>[0];
	let editorModeChanged: (editor: boolean) => void;
	let getEditorMode: ReturnType<typeof vi.fn>;
	let getUserMedia: ReturnType<typeof vi.fn>;
	let ignoreMouse: ReturnType<typeof vi.fn>;
	let trackStop: ReturnType<typeof vi.fn>;
	let stream: MediaStream;
	let windowEvents: Map<string, () => void>;
	let camera: HTMLDivElement;
	let captured: Set<number>;
	let styles: Map<string, string>;
	let attributes: Map<string, string>;
	let frame: (() => void) | null;
	const video = () => ({
		srcObject: null as MediaStream | null,
		play: vi.fn().mockResolvedValue(undefined),
		pause: vi.fn(),
	});
	const render = (overrides: Partial<typeof options> = {}) => {
		options = { ...options, ...overrides };
		harness.index = 0;
		harness.effects = [];
		const preview = useWebcamPreviewOverlay(options);
		for (const { slot, effect, deps } of harness.effects) {
			slot.cleanup?.();
			slot.deps = deps;
			slot.cleanup = effect() || undefined;
		}
		return preview;
	};
	const pointer = (x: number, y: number, type = "pointermove") =>
		({
			button: 0,
			pointerId: 7,
			clientX: x,
			clientY: y,
			type,
			currentTarget: camera,
			target: { closest: () => null },
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		}) as unknown as PointerEvent<HTMLDivElement>;

	beforeEach(() => {
		harness.slots = [];
		harness.index = 0;
		harness.effects = [];
		options = {
			webcamEnabled: true,
			showWebcamControls: true,
			webcamPopoverOpen: false,
			hudOverlayMousePassthroughSupported: true,
			hudBarRef: { current: null },
		};
		trackStop = vi.fn();
		stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
		getEditorMode = vi.fn().mockResolvedValue(false);
		getUserMedia = vi.fn().mockResolvedValue(stream);
		ignoreMouse = vi.fn();
		windowEvents = new Map();
		frame = null;
		captured = new Set();
		styles = new Map([["--webcam-preview-cursor", "crosshair"]]);
		attributes = new Map([["data-webcam-preview-cursor", "crosshair"]]);
		camera = {
			style: {},
			dataset: {},
			contains: () => true,
			getBoundingClientRect: () => ({
				left: 100,
				top: 100,
				right: 330,
				bottom: 330,
				width: 230,
				height: 230,
			}),
			setPointerCapture: (id: number) => captured.add(id),
			hasPointerCapture: (id: number) => captured.has(id),
			releasePointerCapture: (id: number) => captured.delete(id),
		} as unknown as HTMLDivElement;
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
		vi.stubGlobal("window", {
			innerWidth: 1_000,
			innerHeight: 800,
			addEventListener: (name: string, callback: () => void) =>
				windowEvents.set(name, callback),
			removeEventListener: (name: string) => windowEvents.delete(name),
			electronAPI: {
				getEditorMode: () => getEditorMode(),
				onEditorModeChanged: (callback: typeof editorModeChanged) => {
					editorModeChanged = callback;
					return vi.fn();
				},
				hudOverlaySetIgnoreMouse: ignoreMouse,
			},
		});
		vi.stubGlobal("document", {
			documentElement: {
				getAttribute: (name: string) => attributes.get(name) ?? null,
				setAttribute: (name: string, value: string) => attributes.set(name, value),
				removeAttribute: (name: string) => attributes.delete(name),
				style: {
					getPropertyValue: (name: string) => styles.get(name) ?? "",
					getPropertyPriority: () => "important",
					setProperty: (name: string, value: string) => styles.set(name, value),
					removeProperty: (name: string) => styles.delete(name),
				},
			},
		});
		vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
			frame = callback;
			return 1;
		});
		vi.stubGlobal(
			"cancelAnimationFrame",
			vi.fn(() => {
				frame = null;
			}),
		);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
		vi.stubGlobal(
			"DOMRect",
			class {
				constructor(
					public left: number,
					public top: number,
					public width: number,
					public height: number,
				) {}
				get right() {
					return this.left + this.width;
				}
				get bottom() {
					return this.top + this.height;
				}
			},
		);
	});

	afterEach(() => {
		for (const slot of harness.slots) slot.cleanup?.();
		vi.unstubAllGlobals();
	});

	it("waits for known launch mode and keeps stream/node callback identities across renders", async () => {
		const initial = render();
		expect(getUserMedia).not.toHaveBeenCalled();
		await Promise.resolve();
		const preview = render();
		await Promise.resolve();
		const popoverVideo = video();
		const floatingVideo = video();
		preview.setWebcamPreviewNode(popoverVideo as unknown as HTMLVideoElement);
		preview.setRecordingWebcamPreviewNode(floatingVideo as unknown as HTMLVideoElement);
		expect(popoverVideo.srcObject).toBe(stream);
		expect(floatingVideo.srcObject).toBe(stream);
		expect(preview.setWebcamPreviewNode).toBe(initial.setWebcamPreviewNode);
		expect(preview.setRecordingWebcamPreviewNode).toBe(initial.setRecordingWebcamPreviewNode);
		expect(preview.webcamPreviewRoundness).toBe(69);
		expect(preview.webcamPreviewShape).toBe("squircle");
		render({ webcamEnabled: false });
		expect(popoverVideo.pause).toHaveBeenCalledOnce();
		expect(floatingVideo.pause).toHaveBeenCalledOnce();
		expect(popoverVideo.srcObject).toBeNull();
		expect(floatingVideo.srcObject).toBeNull();
		expect(trackStop).toHaveBeenCalledOnce();
	});

	it("keeps a newer editor-mode event when the initial query resolves later", async () => {
		let resolveEditor!: (editor: boolean) => void;
		getEditorMode.mockReturnValue(
			new Promise<boolean>((resolve) => {
				resolveEditor = resolve;
			}),
		);
		render();
		editorModeChanged(false);
		resolveEditor(true);
		await Promise.resolve();
		render();
		await Promise.resolve();
		expect(getUserMedia).toHaveBeenCalledOnce();
	});

	it("releases a stream acquired after the preview was disabled", async () => {
		let resolveStream!: (value: MediaStream) => void;
		getUserMedia.mockReturnValue(
			new Promise<MediaStream>((resolve) => {
				resolveStream = resolve;
			}),
		);
		render();
		await Promise.resolve();
		const preview = render();
		const node = video();
		preview.setRecordingWebcamPreviewNode(node as unknown as HTMLVideoElement);
		render({ webcamEnabled: false });
		resolveStream(stream);
		await Promise.resolve();
		expect(trackStop).toHaveBeenCalledOnce();
		expect(node.srcObject).toBeNull();
		expect(node.play).not.toHaveBeenCalled();
	});

	it("commits the final drag position before its animation frame and preserves handler identity", () => {
		const preview = render();
		preview.recordingWebcamPreviewContainerRef.current = camera;
		preview.handleWebcamPreviewPointerDown(pointer(150, 150, "pointerdown"));
		preview.handleWebcamPreviewPointerMove(pointer(200, 200));
		expect(frame).not.toBeNull();
		preview.handleWebcamPreviewPointerUp(pointer(220, 240, "pointerup"));
		expect(frame).toBeNull();
		expect(camera.style.transform).toBe("translate(70px, 90px)");
		expect(captured.size).toBe(0);
		expect(styles.get("--webcam-preview-cursor")).toBe("crosshair");
		const updated = render();
		expect(updated.webcamPreviewOffset).toEqual({ x: 70, y: 90 });
		expect(updated.handleWebcamPreviewPointerDown).toBe(preview.handleWebcamPreviewPointerDown);
		expect(updated.handleWebcamPreviewPointerMove).toBe(preview.handleWebcamPreviewPointerMove);
		expect(updated.handleWebcamPreviewPointerUp).toBe(preview.handleWebcamPreviewPointerUp);
	});

	it("uses the last real move when pointer cancellation has synthetic coordinates", () => {
		const preview = render();
		preview.recordingWebcamPreviewContainerRef.current = camera;
		preview.handleWebcamPreviewPointerDown(pointer(150, 150, "pointerdown"));
		preview.handleWebcamPreviewPointerMove(pointer(200, 210));
		preview.handleWebcamPreviewPointerUp(pointer(0, 0, "pointercancel"));
		expect(camera.style.transform).toBe("translate(50px, 60px)");
		expect(preview.isWebcamPreviewDraggingRef.current).toBe(false);
	});

	it("releases pointer capture and restores the cursor and passthrough on blur", () => {
		const preview = render();
		preview.recordingWebcamPreviewContainerRef.current = camera;
		preview.handleWebcamPreviewPointerDown(pointer(150, 150, "pointerdown"));
		preview.handleWebcamPreviewPointerMove(pointer(200, 210));
		windowEvents.get("blur")?.();
		expect(preview.isWebcamPreviewDraggingRef.current).toBe(false);
		expect(captured.size).toBe(0);
		expect(ignoreMouse).toHaveBeenLastCalledWith(true);
		expect(attributes.get("data-webcam-preview-cursor")).toBe("crosshair");
	});
});
