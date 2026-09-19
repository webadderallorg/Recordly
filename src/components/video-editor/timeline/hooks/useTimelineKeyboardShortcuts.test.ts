import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelineKeyboardShortcuts } from "./useTimelineKeyboardShortcuts";

vi.mock("react", () => ({ useEffect: (effect: () => void) => effect() }));

class Element {
	isContentEditable = false;
}
class Input extends Element {}
class Textarea extends Element {}
class Select extends Element {}

afterEach(() => vi.unstubAllGlobals());

function setup(selectedClipId: string | null = "clip") {
	vi.stubGlobal("HTMLElement", Element);
	vi.stubGlobal("HTMLInputElement", Input);
	vi.stubGlobal("HTMLTextAreaElement", Textarea);
	vi.stubGlobal("HTMLSelectElement", Select);
	const addEventListener = vi.fn();
	vi.stubGlobal("window", { addEventListener, removeEventListener: vi.fn() });
	const deleteSelectedClip = vi.fn();
	// React useEffect is mocked to test listener registration without mounting a component.
	useTimelineKeyboardShortcuts({
		isTimelineFocusedRef: { current: false },
		selectedClipId,
		deleteSelectedClip,
	} as unknown as Parameters<typeof useTimelineKeyboardShortcuts>[0]);
	const handler = addEventListener.mock.calls[0][1] as (event: KeyboardEvent) => void;
	const press = (options: Record<string, unknown> = {}) => {
		const event = {
			key: "Backspace",
			target: new Element(),
			preventDefault: vi.fn(),
			...options,
		};
		handler(event as unknown as KeyboardEvent);
		return event;
	};
	return { press, deleteSelectedClip };
}

describe("selected clip Backspace", () => {
	it("deletes the selected clip without requiring timeline focus", () => {
		const { press, deleteSelectedClip } = setup();
		expect(press().preventDefault).toHaveBeenCalledOnce();
		expect(deleteSelectedClip).toHaveBeenCalledOnce();
	});
	it.each([
		new Input(),
		new Textarea(),
		new Select(),
		Object.assign(new Element(), { isContentEditable: true }),
	])("does not delete a clip while editing text or a form control", (target) => {
		const { press, deleteSelectedClip } = setup();
		expect(press({ target }).preventDefault).not.toHaveBeenCalled();
		expect(deleteSelectedClip).not.toHaveBeenCalled();
	});
	it("ignores consumed events, modifier shortcuts and missing selection", () => {
		const { press, deleteSelectedClip } = setup();
		for (const option of ["defaultPrevented", "ctrlKey", "metaKey", "altKey"])
			press({ [option]: true });
		expect(deleteSelectedClip).not.toHaveBeenCalled();
		const unselected = setup(null);
		unselected.press();
		expect(unselected.deleteSelectedClip).not.toHaveBeenCalled();
	});
});
