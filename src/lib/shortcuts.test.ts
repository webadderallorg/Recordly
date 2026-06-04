import { describe, expect, it } from "vitest";
import {
	DEFAULT_LAUNCH_SHORTCUTS,
	DEFAULT_SHORTCUTS,
	resolvePersistedShortcuts,
} from "./shortcuts";

describe("resolvePersistedShortcuts", () => {
	it("returns editor and launch defaults when no shortcuts are saved", () => {
		expect(resolvePersistedShortcuts(null)).toEqual({
			editor: DEFAULT_SHORTCUTS,
			launch: DEFAULT_LAUNCH_SHORTCUTS,
		});
	});

	it("keeps legacy editor-only shortcut files compatible", () => {
		expect(resolvePersistedShortcuts({ addZoom: { key: "x" } })).toEqual({
			editor: { ...DEFAULT_SHORTCUTS, addZoom: { key: "x" } },
			launch: DEFAULT_LAUNCH_SHORTCUTS,
		});
	});

	it("merges structured editor and launch shortcut files with defaults", () => {
		expect(
			resolvePersistedShortcuts({
				editor: { splitClip: { key: "b" } },
				launch: { startRecording: { key: "r", ctrl: true, alt: true } },
			}),
		).toEqual({
			editor: { ...DEFAULT_SHORTCUTS, splitClip: { key: "b" } },
			launch: {
				...DEFAULT_LAUNCH_SHORTCUTS,
				startRecording: { key: "r", ctrl: true, alt: true },
			},
		});
	});
});
