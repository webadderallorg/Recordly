import { describe, expect, it } from "vitest";

import { normalizeProjectEditor } from "./projectPersistence";
import { ADVANCED_VERTICAL_PADDING_MAX } from "./types";

describe("normalizeProjectEditor", () => {
	it("preserves the extended advanced vertical padding range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: 240,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 22,
				right: 22,
				linked: false,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 240,
			bottom: ADVANCED_VERTICAL_PADDING_MAX,
			left: 22,
			right: 22,
			linked: false,
		});
	});

	it("keeps linked padding clamped to the original range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: ADVANCED_VERTICAL_PADDING_MAX,
				right: ADVANCED_VERTICAL_PADDING_MAX,
				linked: true,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 100,
			bottom: 100,
			left: 100,
			right: 100,
			linked: true,
		});
	});
});
