import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS } from "@/lib/shortcuts";
import { useEditorGlobalInteractions } from "./useEditorGlobalInteractions";

vi.mock("react", () => ({
	useEffect: (effect: () => void) => effect(),
	useRef: (current: unknown) => ({ current }),
}));
class Element {
	isContentEditable = false;
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
