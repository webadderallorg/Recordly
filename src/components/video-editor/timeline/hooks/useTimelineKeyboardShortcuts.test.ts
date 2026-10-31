import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS } from "@/lib/shortcuts";
import { useTimelineKeyboardShortcuts } from "./useTimelineKeyboardShortcuts";

vi.mock("react", () => ({ useEffect: (effect: () => void) => effect() }));
class Element {
	isContentEditable = false;
	inOverlay = false;
	closest() {
		return this.inOverlay ? this : null;
	}
}
class Input extends Element {}
class Textarea extends Element {}
class Select extends Element {}
afterEach(() => vi.unstubAllGlobals());
type Params = Parameters<typeof useTimelineKeyboardShortcuts>[0];
function setup(overrides: Partial<Params> = {}) {
	vi.stubGlobal("HTMLElement", Element);
	vi.stubGlobal("HTMLInputElement", Input);
	vi.stubGlobal("HTMLTextAreaElement", Textarea);
	vi.stubGlobal("HTMLSelectElement", Select);
	const addEventListener = vi.fn();
	vi.stubGlobal("window", { addEventListener, removeEventListener: vi.fn() });
	const params: Params = {
		isMac: true,
		keyShortcuts: DEFAULT_SHORTCUTS,
		isTimelineFocusedRef: { current: false },
		hasAnyZoomBlocks: true,
		activateSelectAllZooms: vi.fn(),
		annotationCount: 0,
		selectedKeyframeId: null,
		selectedZoomId: null,
		selectedClipId: null,
		selectAllBlocksActive: false,
		addKeyframe: vi.fn(),
		handleAddZoom: vi.fn(),
		handleSplitClip: vi.fn(),
		handleAddAnnotation: vi.fn(),
		deleteSelectedKeyframe: vi.fn(),
		deleteSelectedZoom: vi.fn(),
		deleteSelectedClip: vi.fn(),
		deleteSelectedAnnotation: vi.fn(),
		deleteSelectedAudio: vi.fn(),
		deleteSelectedCaption: vi.fn(),
		cycleAnnotationsAtCurrentTime: vi.fn(),
		...overrides,
	};
	// biome-ignore lint/correctness/useHookAtTopLevel: useEffect is mocked to capture the listener without a React render.
	useTimelineKeyboardShortcuts(params);
	const handler = addEventListener.mock.calls[0][1] as (event: KeyboardEvent) => void;
	const press = (options: Record<string, unknown> = {}) => {
		const event = {
			key: "Backspace",
			ctrlKey: false,
			metaKey: false,
			altKey: false,
			shiftKey: false,
			target: new Element(),
			preventDefault: vi.fn(),
			...options,
		};
		handler(event as unknown as KeyboardEvent);
		return event;
	};
	return { press, params };
}
const selections = [
	["selectedClipId", "deleteSelectedClip"],
	["selectedZoomId", "deleteSelectedZoom"],
	["selectedAnnotationId", "deleteSelectedAnnotation"],
	["selectedAudioId", "deleteSelectedAudio"],
	["selectedCaptionId", "deleteSelectedCaption"],
	["selectedKeyframeId", "deleteSelectedKeyframe"],
] as const;

describe.each(selections)("delete %s", (selection, action) => {
	it.each([false, true])("supports both delete keys with timeline focus %s", (focused) => {
		for (const key of ["Backspace", "Delete"]) {
			const { press, params } = setup({
				[selection]: "block",
				isTimelineFocusedRef: { current: focused },
			});
			expect(press({ key }).preventDefault).toHaveBeenCalledOnce();
			expect(params[action]).toHaveBeenCalledOnce();
		}
	});
	it("honors the configured delete shortcut outside the timeline", () => {
		const { press, params } = setup({ [selection]: "block" });
		expect(press({ key: "d", metaKey: true }).preventDefault).toHaveBeenCalledOnce();
		expect(params[action]).toHaveBeenCalledOnce();
	});
	it.each([
		new Input(),
		new Textarea(),
		new Select(),
		Object.assign(new Element(), { isContentEditable: true }),
		Object.assign(new Element(), { inOverlay: true }),
	])("does not delete behind an editable control or overlay", (target) => {
		const { press, params } = setup({ [selection]: "block" });
		expect(press({ target }).preventDefault).not.toHaveBeenCalled();
		expect(params[action]).not.toHaveBeenCalled();
	});
	it("ignores consumed/composing events and unrelated modifier combinations", () => {
		const { press, params } = setup({
			[selection]: "block",
			isTimelineFocusedRef: { current: true },
		});
		for (const flag of [
			"defaultPrevented",
			"isComposing",
			"ctrlKey",
			"metaKey",
			"altKey",
			"shiftKey",
		]) {
			press({ [flag]: true });
		}
		expect(params[action]).not.toHaveBeenCalled();
	});
});
it("does not consume deletion without a selection", () => {
	expect(setup().press().preventDefault).not.toHaveBeenCalled();
});
it("select-all zooms takes priority over an individual clip selection", () => {
	const { press, params } = setup({ selectAllBlocksActive: true, selectedClipId: "clip" });
	press();
	expect(params.deleteSelectedZoom).toHaveBeenCalledOnce();
	expect(params.deleteSelectedClip).not.toHaveBeenCalled();
});
it("keeps creation and select-all shortcuts scoped to the timeline", () => {
	const { press, params } = setup();
	press({ key: "z" });
	press({ key: "a", metaKey: true });
	expect(params.handleAddZoom).not.toHaveBeenCalled();
	expect(params.activateSelectAllZooms).not.toHaveBeenCalled();
});
