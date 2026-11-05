import { beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	previous: { current: null as unknown },
	effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: () => hooks.previous,
	useEffect: (effect: () => void) => hooks.effects.push(effect),
}));
vi.mock("../editorPreferences", async (original) => ({
	...(await original<typeof import("../editorPreferences")>()),
	saveEditorPreferences: vi.fn(),
}));

import { DEFAULT_EDITOR_PREFERENCES, saveEditorPreferences } from "../editorPreferences";
import { useEditorPreferencesPersistence } from "./useEditorPreferencesPersistence";

type Input = Parameters<typeof useEditorPreferencesPersistence>[0];
const restoringPreferencesRef = { current: false };

function render(appearance: Partial<Input["appearance"]> = {}, enabled = true) {
	hooks.effects = [];
	useEditorPreferencesPersistence({
		enabled,
		restoringPreferencesRef,
		appearance: { ...DEFAULT_EDITOR_PREFERENCES, ...appearance } as Input["appearance"],
		aspectRatio: "native",
		whisperExecutablePath: null,
		whisperModelPath: null,
	});
	for (const effect of hooks.effects) effect();
}

beforeEach(() => {
	hooks.previous.current = null;
	restoringPreferencesRef.current = false;
	vi.clearAllMocks();
});

it("opening a project does not save its look; editing another control saves only that control", () => {
	render();
	restoringPreferencesRef.current = true;
	const webcam = { ...DEFAULT_EDITOR_PREFERENCES.webcam, shadow: 0.67 };
	render({ webcam, shadowIntensity: 0.5 });
	expect(saveEditorPreferences).not.toHaveBeenCalled();
	render({ webcam: { ...webcam, width: 55 }, shadowIntensity: 0.5 });
	expect(saveEditorPreferences).toHaveBeenCalledExactlyOnceWith({ webcam: { width: 55 } });
});

it("an explicit webcam shadow edit saves zero without overwriting other webcam preferences", () => {
	render();
	render({ webcam: { ...DEFAULT_EDITOR_PREFERENCES.webcam, shadow: 0 } });
	expect(saveEditorPreferences).toHaveBeenCalledExactlyOnceWith({ webcam: { shadow: 0 } });
});

it("smoke exports never save appearance overrides into user preferences", () => {
	render({}, false);
	render({ webcam: { ...DEFAULT_EDITOR_PREFERENCES.webcam, shadow: 0.67 } }, false);
	expect(saveEditorPreferences).not.toHaveBeenCalled();
});
