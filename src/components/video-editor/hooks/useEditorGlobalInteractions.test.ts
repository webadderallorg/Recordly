import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS } from "@/lib/shortcuts";
import { useEditorGlobalInteractions } from "./useEditorGlobalInteractions";

vi.mock("react", () => ({
	useEffect: (effect: () => void) => effect(),
	useRef: (current: unknown) => ({ current }),
}));
class Element {
	isContentEditable = false;
	constructor(private readonly closestSelectorMatch?: string) {}
	closest(selector: string) {
		if (!this.closestSelectorMatch) return null;
		return selector.includes(this.closestSelectorMatch) ? this : null;
	}
}
class Input extends Element {}
class Textarea extends Element {}
class Select extends Element {}
afterEach(() => vi.unstubAllGlobals());

function setup(binding = DEFAULT_SHORTCUTS.playPause) {
	vi.stubGlobal("HTMLInputElement", Input);
	vi.stubGlobal("HTMLTextAreaElement", Textarea);
	vi.stubGlobal("HTMLSelectElement", Select);
	const handlers = new Map<string, (event: KeyboardEvent) => void>();
	vi.stubGlobal("window", {
		addEventListener: (name: string, handler: (event: KeyboardEvent) => void) =>
			handlers.set(name, handler),
		removeEventListener: vi.fn(),
	});
	const playback = {
		video: {},
		isPlaying: false,
		pause: vi.fn(() => {
			playback.isPlaying = false;
		}),
	};
	const startPlayback = vi.fn(() => {
		playback.isPlaying = true;
	});
	useEditorGlobalInteractions({
		timeline: {},
		videoPlaybackRef: { current: playback },
		shortcuts: { ...DEFAULT_SHORTCUTS, playPause: binding },
		isMac: true,
		startPlayback,
		handleUndo: vi.fn(),
		handleRedo: vi.fn(),
	} as unknown as Parameters<typeof useEditorGlobalInteractions>[0]);
	const send = (type = "keydown", options: Record<string, unknown> = {}) => {
		const event = {
			key: " ",
			code: "Space",
			target: new Element(),
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			repeat: false,
			preventDefault: vi.fn(),
			stopImmediatePropagation: vi.fn(),
			...options,
		};
		handlers.get(type)!(event as unknown as KeyboardEvent);
		return event;
	};
	return { send, playback, startPlayback };
}

describe("editor playback shortcut", () => {
	it("consumes keydown and keyup and toggles once per physical press", () => {
		const { send, playback, startPlayback } = setup();
		const down = send();
		expect(down.preventDefault).toHaveBeenCalledOnce();
		expect(down.stopImmediatePropagation).toHaveBeenCalledOnce();
		send("keydown", { repeat: true });
		send(); // Even duplicate keydowns without the repeat flag belong to the held key.
		expect(startPlayback).toHaveBeenCalledOnce();
		expect(playback.pause).not.toHaveBeenCalled();
		const up = send("keyup");
		expect(up.preventDefault).toHaveBeenCalledOnce();
		expect(up.stopImmediatePropagation).toHaveBeenCalledOnce();
		send();
		expect(playback.pause).toHaveBeenCalledOnce();
		send("keyup");
		send();
		expect(startPlayback).toHaveBeenCalledTimes(2);
	});
	it("ignores repeat-only events and recovers after losing window focus", () => {
		const { send, startPlayback, playback } = setup();
		send("keydown", { repeat: true });
		expect(startPlayback).not.toHaveBeenCalled();
		send();
		send("blur");
		send();
		expect(playback.pause).toHaveBeenCalledOnce();
	});
	it.each([
		new Input(),
		new Textarea(),
		new Select(),
		Object.assign(new Element(), { isContentEditable: true }),
	])("leaves editable controls alone", (target) => {
		const { send, startPlayback } = setup();
		expect(send("keydown", { target }).preventDefault).not.toHaveBeenCalled();
		expect(send("keyup", { target }).preventDefault).not.toHaveBeenCalled();
		expect(startPlayback).not.toHaveBeenCalled();
	});
	it("leaves composition and already handled events alone", () => {
		const { send, startPlayback } = setup();
		expect(send("keydown", { isComposing: true }).preventDefault).not.toHaveBeenCalled();
		expect(send("keydown", { defaultPrevented: true }).preventDefault).not.toHaveBeenCalled();
		expect(startPlayback).not.toHaveBeenCalled();
	});
	it("supports customized shortcuts and releases even if modifiers change", () => {
		const { send, startPlayback, playback } = setup({ key: "k", ctrl: true });
		expect(send().preventDefault).not.toHaveBeenCalled();
		send("keydown", { key: "k", code: "KeyK", metaKey: true });
		expect(startPlayback).toHaveBeenCalledOnce();
		send("keyup", { key: "k", code: "KeyK", metaKey: false });
		send("keydown", { key: "k", code: "KeyK", metaKey: true });
		expect(playback.pause).toHaveBeenCalledOnce();
	});
});

describe("editor frame-by-frame and timeline stepping shortcuts", () => {
	function setupStepping() {
		vi.stubGlobal("HTMLInputElement", Input);
		vi.stubGlobal("HTMLTextAreaElement", Textarea);
		vi.stubGlobal("HTMLSelectElement", Select);
		const handlers = new Map<string, (event: KeyboardEvent) => void>();
		vi.stubGlobal("window", {
			addEventListener: (name: string, handler: (event: KeyboardEvent) => void) =>
				handlers.set(name, handler),
			removeEventListener: vi.fn(),
		});
		const stepFrameBackward = vi.fn();
		const stepFrameForward = vi.fn();
		const stepTimeSeconds = vi.fn();
		const handlePreviewSkip = vi.fn();

		useEditorGlobalInteractions({
			timeline: {},
			videoPlaybackRef: { current: { video: {}, isPlaying: false, pause: vi.fn() } },
			shortcuts: DEFAULT_SHORTCUTS,
			isMac: true,
			startPlayback: vi.fn(),
			handleUndo: vi.fn(),
			handleRedo: vi.fn(),
			stepFrameBackward,
			stepFrameForward,
			stepTimeSeconds,
			handlePreviewSkip,
		} as unknown as Parameters<typeof useEditorGlobalInteractions>[0]);

		const send = (type = "keydown", options: Record<string, unknown> = {}) => {
			const event = {
				key: "",
				code: "",
				target: new Element(),
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				repeat: false,
				preventDefault: vi.fn(),
				stopImmediatePropagation: vi.fn(),
				...options,
			};
			handlers.get(type)!(event as unknown as KeyboardEvent);
			return event;
		};

		return {
			send,
			stepFrameBackward,
			stepFrameForward,
			stepTimeSeconds,
			handlePreviewSkip,
		};
	}

	it("steps 1 frame backward with comma or ArrowLeft without passing an fps argument", () => {
		const { send, stepFrameBackward } = setupStepping();
		const e1 = send("keydown", { key: "," });
		expect(e1.preventDefault).toHaveBeenCalled();
		expect(stepFrameBackward).toHaveBeenNthCalledWith(1);

		const e2 = send("keydown", { key: "ArrowLeft" });
		expect(e2.preventDefault).toHaveBeenCalled();
		expect(stepFrameBackward).toHaveBeenNthCalledWith(2);
	});

	it("steps 1 frame forward with period or ArrowRight without passing an fps argument", () => {
		const { send, stepFrameForward } = setupStepping();
		const e1 = send("keydown", { key: "." });
		expect(e1.preventDefault).toHaveBeenCalled();
		expect(stepFrameForward).toHaveBeenNthCalledWith(1);

		const e2 = send("keydown", { key: "ArrowRight" });
		expect(e2.preventDefault).toHaveBeenCalled();
		expect(stepFrameForward).toHaveBeenNthCalledWith(2);
	});

	it("steps 1 second with Shift + Arrow keys", () => {
		const { send, stepTimeSeconds } = setupStepping();
		send("keydown", { key: "ArrowLeft", shiftKey: true });
		expect(stepTimeSeconds).toHaveBeenCalledWith(-1);

		send("keydown", { key: "ArrowRight", shiftKey: true });
		expect(stepTimeSeconds).toHaveBeenCalledWith(1);
	});

	it("skips between timeline elements with Alt + Arrow keys", () => {
		const { send, handlePreviewSkip } = setupStepping();
		send("keydown", { key: "ArrowLeft", altKey: true });
		expect(handlePreviewSkip).toHaveBeenNthCalledWith(1, "backward");

		send("keydown", { key: "ArrowRight", altKey: true });
		expect(handlePreviewSkip).toHaveBeenNthCalledWith(2, "forward");
	});

	it("does not step frames when typing in input, textarea, inline crop, dialogs, or sliders", () => {
		const { send, stepFrameForward, stepFrameBackward } = setupStepping();
		send("keydown", { key: ".", target: new Input() });
		send("keydown", { key: "ArrowLeft", target: new Textarea() });
		send("keydown", { key: "ArrowRight", target: new Element("[data-inline-crop]") });
		send("keydown", { key: "ArrowLeft", target: new Element('[role="dialog"]') });
		send("keydown", { key: "ArrowRight", target: new Element('[role="slider"]') });
		expect(stepFrameForward).not.toHaveBeenCalled();
		expect(stepFrameBackward).not.toHaveBeenCalled();
	});
});
